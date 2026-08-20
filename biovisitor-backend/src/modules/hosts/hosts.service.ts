/**
 * @file hosts.service.ts
 * @description Servicio de gestión de anfitriones (hosts).
 *
 * Administra los hosts que pueden recibir visitantes. Soporta dos modos:
 * - LOCAL: Creación manual de hosts en la base de datos propia.
 * - SUPREMA: Importación desde el directorio de usuarios de BioStar 2 / BioStar X.
 *
 * @module modules/hosts
 */

import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as https from 'https';
import * as bcrypt from 'bcrypt';
import { Host, HostSource } from '../../database/entities/host.entity';
import { User, UserRole } from '../../database/entities/user.entity';
import { SupremaApiConnection } from '../../database/entities';
import { BioStarPlatform } from '../../database/entities/tenant.entity';
import { CreateHostDto } from './dto/create-host.dto';
import { UpdateHostDto } from './dto/update-host.dto';
import { EncryptionService } from '../../core/crypto/encryption.service';

@Injectable()
export class HostsService {
  private readonly logger = new Logger(HostsService.name);
  private readonly httpsAgent = new https.Agent({ rejectUnauthorized: false });

  constructor(
    @InjectRepository(Host)
    private readonly hostRepository: Repository<Host>,
    @InjectRepository(SupremaApiConnection)
    private readonly supremaConnectionRepository: Repository<SupremaApiConnection>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly httpService: HttpService,
    private readonly encryptionService: EncryptionService,
  ) {}

  // ─── CRUD Local ────────────────────────────────────────────────────────────

  async findAll(tenantId: string, onlyActive = false): Promise<Host[]> {
    const where: any = { tenantId };
    if (onlyActive) where.isActive = true;
    return this.hostRepository.find({
      where,
      order: { fullName: 'ASC' },
    });
  }

  async findOne(id: string, tenantId: string): Promise<Host> {
    const host = await this.hostRepository.findOne({ where: { id, tenantId } });
    if (!host) throw new NotFoundException(`Host ${id} no encontrado.`);
    return host;
  }

  async create(tenantId: string, dto: CreateHostDto): Promise<Host> {
    if (dto.email) {
      const existing = await this.hostRepository.findOne({
        where: { tenantId, email: dto.email },
      });
      if (existing) {
        throw new ConflictException(
          `Ya existe un host con el email ${dto.email}.`,
        );
      }
    }

    const host = this.hostRepository.create({
      tenantId,
      fullName: dto.fullName,
      email: dto.email ?? null,
      phone: dto.phone ?? null,
      department: dto.department ?? null,
      jobTitle: dto.jobTitle ?? null,
      source: dto.source ?? HostSource.LOCAL,
      isActive: dto.isActive ?? true,
      supremaUserId: dto.supremaUserId ?? null,
      supremaLoginId: dto.supremaLoginId ?? null,
      supremaConnectionId: dto.supremaConnectionId ?? null,
      syncStatus: null,
    });

    const saved = await this.hostRepository.save(host);
    this.logger.log(
      `👤 Host creado: ${saved.fullName} (${saved.id}) [${saved.source}]`,
    );
    return saved;
  }

  async update(
    id: string,
    tenantId: string,
    dto: UpdateHostDto,
  ): Promise<Host> {
    const host = await this.findOne(id, tenantId);
    Object.assign(host, dto);
    return this.hostRepository.save(host);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    const host = await this.findOne(id, tenantId);
    host.isActive = false;
    await this.hostRepository.save(host);
    this.logger.log(`🚫 Host desactivado: ${host.fullName} (${id})`);
  }

  // ─── Importación desde Suprema BioStar ────────────────────────────────────

  /**
   * Importa usuarios desde BioStar y los registra como hosts locales.
   *
   * Proceso:
   * 1. Login en BioStar con las credenciales almacenadas (descifradas)
   * 2. GET /api/users?limit=1000 → lista de usuarios
   * 3. Upsert: crea nuevos hosts, actualiza existentes por supremaUserId
   * 4. Logout (siempre, en finally)
   */
  async syncFromSuprema(
    tenantId: string,
    connectionId?: string,
  ): Promise<{ imported: number; updated: number; errors: number }> {
    const where: any = { tenantId, isActive: true };
    if (connectionId) where.id = connectionId;

    const connections = await this.supremaConnectionRepository.find({ where });

    if (!connections.length) {
      this.logger.warn(
        '⚠️ No hay conexiones Suprema activas para importar hosts.',
      );
      return { imported: 0, updated: 0, errors: 0 };
    }

    let imported = 0;
    let updated = 0;
    let errors = 0;

    for (const conn of connections) {
      const baseUrl = conn.apiUrl.replace(/\/$/, '');
      let sessionCookie = '';

      // Descifrar credenciales
      let loginId: string;
      let password: string;
      try {
        loginId = this.encryptionService.decrypt(conn.loginIdEncrypted);
        password = this.encryptionService.decrypt(conn.passwordEncrypted);
      } catch {
        this.logger.error(
          `❌ No se pudieron descifrar las credenciales de ${conn.name}`,
        );
        errors++;
        continue;
      }

      try {
        // 1. Login
        const loginResp = await firstValueFrom(
          this.httpService.post(
            `${baseUrl}/api/login`,
            { login_id: loginId, password },
            { timeout: 10000, httpsAgent: this.httpsAgent },
          ),
        );

        const setCookieHeader = loginResp.headers['set-cookie'];
        if (setCookieHeader) {
          const cookies = (
            Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader as string]
          );
          sessionCookie = cookies.map((c: string) => c.split(';')[0]).join('; ');
        }

        // 2. GET /api/users
        const usersResp = await firstValueFrom(
          this.httpService.get(`${baseUrl}/api/users`, {
            headers: { Cookie: sessionCookie },
            params: { limit: 1000 },
            timeout: 15000,
            httpsAgent: this.httpsAgent,
          }),
        );

        const biostarUsers: any[] =
          usersResp.data?.UserCollection?.rows ?? [];
        this.logger.log(
          `📥 BioStar devolvió ${biostarUsers.length} usuarios desde ${conn.name}`,
        );

        for (const bu of biostarUsers) {
          try {
            const uid: string = bu.user_id?.id ?? String(bu.user_id);
            if (!uid) continue;

            const fullName = String(bu.name ?? uid).trim() || uid;

            const existingHost = await this.hostRepository.findOne({
              where: {
                tenantId,
                supremaUserId: uid,
                supremaConnectionId: conn.id,
              },
            });

            if (existingHost) {
              existingHost.fullName = fullName;
              if (bu.email) existingHost.email = bu.email;
              if (bu.phone) existingHost.phone = bu.phone;
              if (bu.department_code?.code_name)
                existingHost.department = bu.department_code.code_name;
              existingHost.syncStatus = 'SYNCED';
              existingHost.lastSyncAt = new Date();
              existingHost.lastSyncError = null;
              await this.hostRepository.save(existingHost);
              updated++;
            } else {
              await this.hostRepository.save(
                this.hostRepository.create({
                  tenantId,
                  fullName,
                  email: bu.email ?? null,
                  phone: bu.phone ?? null,
                  department: bu.department_code?.code_name ?? null,
                  jobTitle: null,
                  source:
                    conn.platform === BioStarPlatform.BIOSTAR_X
                      ? HostSource.BIOSTAR_X
                      : HostSource.BIOSTAR2,
                  isActive: true,
                  supremaUserId: uid,
                  supremaLoginId: bu.login_id ?? null,
                  supremaConnectionId: conn.id,
                  syncStatus: 'SYNCED',
                  lastSyncAt: new Date(),
                  lastSyncError: null,
                }),
              );
              imported++;
            }
          } catch (err: any) {
            this.logger.error(
              `❌ Error procesando usuario BioStar ${bu.user_id}: ${err.message}`,
            );
            errors++;
          }
        }
      } catch (err: any) {
        this.logger.error(
          `❌ Error sincronizando hosts desde conexión ${conn.name}: ${err.message}`,
        );
        errors++;
      } finally {
        if (sessionCookie) {
          try {
            await firstValueFrom(
              this.httpService.post(
                `${baseUrl}/api/logout`,
                {},
                {
                  headers: { Cookie: sessionCookie },
                  httpsAgent: this.httpsAgent,
                },
              ),
            );
          } catch {
            // Ignorar errores de logout
          }
        }
      }
    }

    this.logger.log(
      `✅ Sync hosts completada: +${imported} nuevos, ${updated} actualizados, ${errors} errores`,
    );
    return { imported, updated, errors };
  }

  // ─── Cuenta de usuario VMS para un Host ───────────────────────────────────

  /**
   * Crea una cuenta de usuario (rol HOST) y la vincula al Host indicado.
   * Si el Host ya tiene una cuenta vinculada, lanza ConflictException.
   */
  async createUserAccount(
    hostId: string,
    tenantId: string,
    dto: { email: string; password: string; language?: string },
  ): Promise<{ userId: string; email: string; fullName: string; role: UserRole }> {
    const host = await this.hostRepository.findOne({ where: { id: hostId, tenantId } });
    if (!host) throw new NotFoundException('Anfitrión no encontrado.');
    if (host.userId) throw new ConflictException('Este anfitrión ya tiene una cuenta de acceso vinculada.');

    // Verificar que el email no esté en uso en este tenant
    const existing = await this.userRepository.findOne({
      where: { tenantId, email: dto.email.toLowerCase() },
    });
    if (existing) throw new ConflictException('El correo ya está registrado para otro usuario en este tenant.');

    if (!dto.password || dto.password.length < 8) {
      throw new BadRequestException('La contraseña debe tener al menos 8 caracteres.');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const newUser = this.userRepository.create({
      tenantId,
      email: dto.email.toLowerCase().trim(),
      passwordHash,
      fullName: host.fullName,
      role: UserRole.HOST,
      department: host.department ?? undefined,
      phone: host.phone ?? undefined,
      language: dto.language ?? 'es',
      isActive: true,
    });
    const savedUser = await this.userRepository.save(newUser) as User;

    // Vincular el Host al User
    await this.hostRepository.update(hostId, { userId: savedUser.id });

    this.logger.log(`✅ Cuenta HOST creada: ${savedUser.email} → Host ${host.fullName}`);
    return { userId: savedUser.id, email: savedUser.email, fullName: savedUser.fullName, role: savedUser.role };
  }

  /**
   * Revoca la cuenta de usuario de un Host (desactiva el User y desvincula el Host).
   */
  async revokeUserAccount(hostId: string, tenantId: string): Promise<{ success: boolean }> {
    const host = await this.hostRepository.findOne({ where: { id: hostId, tenantId } });
    if (!host) throw new NotFoundException('Anfitrión no encontrado.');
    if (!host.userId) throw new BadRequestException('Este anfitrión no tiene una cuenta de acceso vinculada.');

    await this.userRepository.update(host.userId, { isActive: false });
    await this.hostRepository.update(hostId, { userId: null });

    this.logger.log(`🔒 Cuenta HOST revocada para host ${host.fullName}`);
    return { success: true };
  }

  /**
   * Restablece la contraseña de la cuenta de usuario vinculada a un Host.
   */
  async resetHostPassword(
    hostId: string,
    tenantId: string,
    newPassword: string,
  ): Promise<{ success: boolean }> {
    const host = await this.hostRepository.findOne({ where: { id: hostId, tenantId } });
    if (!host) throw new NotFoundException('Anfitrión no encontrado.');
    if (!host.userId) throw new BadRequestException('Este anfitrión no tiene cuenta de acceso.');

    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('La contraseña debe tener al menos 8 caracteres.');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.userRepository.update(host.userId, { passwordHash, failedLoginAttempts: 0, lockedUntil: null as any });

    this.logger.log(`🔑 Contraseña restablecida para cuenta HOST del host ${host.fullName}`);
    return { success: true };
  }
}

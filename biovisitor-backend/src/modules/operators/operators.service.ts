/**
 * @file operators.service.ts
 * @description Servicio de gestión de operadores del VMS.
 *
 * Permite a los administradores crear, editar, activar/desactivar
 * y configurar permisos y seguridad de usuarios ADMIN y OPERATOR.
 * Cada acción queda registrada en el módulo de auditoría con valores
 * de transición (anterior → nuevo) para cumplimiento normativo.
 *
 * @module modules/operators
 */

import {
  Injectable, Logger, NotFoundException, ConflictException,
  ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';

import {
  User, UserRole,
  DEFAULT_OPERATOR_PERMISSIONS,
  DEFAULT_SECURITY_CONFIG,
} from '../../database/entities/user.entity';
import { StructuredLoggerService } from '../../core/logging/structured-logger.service';
import { CreateOperatorDto } from './dto/create-operator.dto';
import { UpdateOperatorDto, ResetPasswordDto } from './dto/update-operator.dto';

@Injectable()
export class OperatorsService {
  private readonly logger = new Logger(OperatorsService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly structuredLogger: StructuredLoggerService,
  ) {}

  /**
   * Lista todos los operadores (ADMIN y OPERATOR) del tenant.
   * Excluye el campo passwordHash de la respuesta.
   */
  async listOperators(tenantId: string): Promise<Omit<User, 'passwordHash'>[]> {
    const users = await this.userRepository.find({
      where: [
        { tenantId, role: UserRole.ADMIN, isActive: true },
        { tenantId, role: UserRole.OPERATOR, isActive: true },
      ],
      order: { createdAt: 'DESC' },
    });
    return users.map(({ passwordHash, ...rest }) => rest as any);
  }

  /**
   * Obtiene el detalle de un operador específico.
   */
  async getOperator(id: string, tenantId: string): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.findOrFail(id, tenantId);
    const { passwordHash, ...rest } = user;
    return rest as any;
  }

  /**
   * Crea un nuevo operador (ADMIN u OPERATOR).
   * Genera hash bcrypt de la contraseña temporal.
   * Si el rol es OPERATOR, asigna permisos granulares por defecto.
   */
  async createOperator(
    dto: CreateOperatorDto,
    tenantId: string,
    actorId: string,
    actorIp: string,
  ): Promise<Omit<User, 'passwordHash'>> {
    const existing = await this.userRepository.findOne({
      where: { tenantId, email: dto.email.toLowerCase() },
    });
    if (existing) {
      throw new ConflictException('Ya existe un usuario con ese email en este tenant.');
    }

    const passwordHash = await bcrypt.hash(dto.temporaryPassword, 12);

    const user = this.userRepository.create() as User;
    user.tenantId           = tenantId;
    user.email              = dto.email.toLowerCase().trim();
    user.passwordHash       = passwordHash;
    user.fullName           = dto.fullName.trim();
    user.role               = dto.role;
    user.department         = dto.department ?? null as any;
    user.phone              = dto.phone ?? null as any;
    user.notes              = dto.notes ?? null as any;
    user.isActive           = true;
    user.mustChangePassword = true;
    user.passwordChangedAt  = null as any;
    user.permissions        = dto.role === UserRole.OPERATOR
      ? (dto.permissions ?? DEFAULT_OPERATOR_PERMISSIONS)
      : null;
    user.allowedSites       = dto.allowedSites ?? [];
    user.securityConfig     = dto.securityConfig ?? DEFAULT_SECURITY_CONFIG;

    await this.userRepository.save(user);

    this.structuredLogger.logUserAction(
      'operator.created',
      actorId,
      {
        newUserId: user.id,
        email: user.email,
        role: user.role,
        actorIp,
        transition: { before: null, after: { email: user.email, role: user.role, isActive: true } },
      },
      tenantId,
    );

    const { passwordHash: _, ...rest } = user;
    return rest as any;
  }

  /**
   * Actualiza datos básicos de un operador (nombre, email, rol, dept, teléfono, notas).
   * Registra valores de transición en auditoría.
   */
  async updateOperator(
    id: string,
    dto: UpdateOperatorDto,
    tenantId: string,
    actorId: string,
    actorIp: string,
  ): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.findOrFail(id, tenantId);
    const before = this.snapshot(user);

    if (dto.email && dto.email.toLowerCase() !== user.email) {
      const conflict = await this.userRepository.findOne({
        where: { tenantId, email: dto.email.toLowerCase() },
      });
      if (conflict) throw new ConflictException('El email ya está en uso por otro operador.');
    }

    if (dto.fullName  !== undefined) user.fullName   = dto.fullName.trim();
    if (dto.email     !== undefined) user.email      = dto.email.toLowerCase().trim();
    if (dto.role      !== undefined) {
      user.role        = dto.role;
      if (dto.role === UserRole.ADMIN)    user.permissions = null;
      if (dto.role === UserRole.OPERATOR && !user.permissions)
        user.permissions = DEFAULT_OPERATOR_PERMISSIONS;
    }
    if (dto.department !== undefined) user.department = dto.department ?? null;
    if (dto.phone      !== undefined) user.phone      = dto.phone ?? null;
    if (dto.notes      !== undefined) user.notes      = dto.notes ?? null;
    if (dto.permissions !== undefined && user.role === UserRole.OPERATOR)
      user.permissions = dto.permissions as any;
    if (dto.allowedSites !== undefined) user.allowedSites = dto.allowedSites;
    if (dto.securityConfig !== undefined) user.securityConfig = dto.securityConfig as any;

    await this.userRepository.save(user);

    this.structuredLogger.logUserAction(
      'operator.updated',
      actorId,
      { targetUserId: id, actorIp, transition: { before, after: this.snapshot(user) } },
      tenantId,
    );

    const { passwordHash, ...rest } = user;
    return rest as any;
  }

  /**
   * Activa o desactiva la cuenta de un operador.
   * Un admin no puede desactivarse a sí mismo.
   */
  async toggleActive(
    id: string,
    tenantId: string,
    actorId: string,
    actorIp: string,
  ): Promise<{ isActive: boolean }> {
    const user = await this.findOrFail(id, tenantId);
    if (id === actorId) throw new ForbiddenException('No puedes desactivar tu propia cuenta.');

    const wasActive = user.isActive;
    user.isActive = !wasActive;
    if (user.isActive) {
      user.failedLoginAttempts = 0;
      user.lockedUntil = null as any;
    }
    await this.userRepository.save(user);

    this.structuredLogger.logUserAction(
      user.isActive ? 'operator.activated' : 'operator.deactivated',
      actorId,
      {
        targetUserId: id,
        email: user.email,
        actorIp,
        transition: { before: { isActive: wasActive }, after: { isActive: user.isActive } },
      },
      tenantId,
    );

    return { isActive: user.isActive };
  }

  /**
   * Fuerza el reseteo de contraseña de un operador.
   * Genera nuevo hash y activa el flag mustChangePassword.
   */
  async resetPassword(
    id: string,
    dto: ResetPasswordDto,
    tenantId: string,
    actorId: string,
    actorIp: string,
  ): Promise<{ message: string }> {
    const user = await this.findOrFail(id, tenantId);

    user.passwordHash       = await bcrypt.hash(dto.newPassword, 12);
    user.mustChangePassword = dto.mustChangePassword ?? true;
    user.passwordChangedAt  = new Date();
    user.failedLoginAttempts = 0;
    user.lockedUntil         = null as any;
    await this.userRepository.save(user);

    this.structuredLogger.logUserAction(
      'operator.password_reset',
      actorId,
      {
        targetUserId: id,
        email: user.email,
        actorIp,
        mustChangePassword: user.mustChangePassword,
        transition: { before: { mustChangePassword: !user.mustChangePassword }, after: { mustChangePassword: user.mustChangePassword } },
      },
      tenantId,
    );

    return { message: 'Contraseña actualizada correctamente.' };
  }

  /**
   * Actualiza únicamente los permisos granulares de un OPERATOR.
   */
  async updatePermissions(
    id: string,
    permissions: any,
    tenantId: string,
    actorId: string,
    actorIp: string,
  ): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.findOrFail(id, tenantId);
    if (user.role !== UserRole.OPERATOR) {
      throw new BadRequestException('Los permisos granulares solo aplican a usuarios OPERATOR.');
    }
    const before = user.permissions;
    user.permissions = permissions;
    await this.userRepository.save(user);

    this.structuredLogger.logUserAction(
      'operator.permissions_updated',
      actorId,
      { targetUserId: id, email: user.email, actorIp, transition: { before, after: permissions } },
      tenantId,
    );

    const { passwordHash, ...rest } = user;
    return rest as any;
  }

  /**
   * Actualiza la configuración de seguridad avanzada de un operador.
   */
  async updateSecurityConfig(
    id: string,
    securityConfig: any,
    tenantId: string,
    actorId: string,
    actorIp: string,
  ): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.findOrFail(id, tenantId);
    const before = user.securityConfig;
    user.securityConfig = securityConfig;
    await this.userRepository.save(user);

    this.structuredLogger.logUserAction(
      'operator.security_updated',
      actorId,
      { targetUserId: id, email: user.email, actorIp, transition: { before, after: securityConfig } },
      tenantId,
    );

    const { passwordHash, ...rest } = user;
    return rest as any;
  }

  /**
   * Elimina permanentemente un operador.
   * Un admin no puede eliminarse a sí mismo.
   */
  async deleteOperator(
    id: string,
    tenantId: string,
    actorId: string,
    actorIp: string,
  ): Promise<void> {
    const user = await this.findOrFail(id, tenantId);
    if (id === actorId) throw new ForbiddenException('No puedes eliminar tu propia cuenta.');

    const originalEmail = user.email;

    user.isActive = false;
    user.email = `deleted_${id}@deleted`;
    user.passwordHash = '';
    await this.userRepository.save(user);

    this.structuredLogger.logUserAction(
      'operator.deleted',
      actorId,
      { targetUserId: id, email: originalEmail, role: user.role, actorIp },
      tenantId,
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────────────

  private async findOrFail(id: string, tenantId: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id, tenantId },
    });
    if (!user) throw new NotFoundException('Operador no encontrado.');
    if (user.role === UserRole.HOST) {
      throw new ForbiddenException('Este endpoint no gestiona usuarios tipo HOST.');
    }
    return user;
  }

  private snapshot(user: User) {
    return {
      fullName:      user.fullName,
      email:         user.email,
      role:          user.role,
      department:    user.department,
      phone:         user.phone,
      isActive:      user.isActive,
      permissions:   user.permissions,
      allowedSites:  user.allowedSites,
      securityConfig: user.securityConfig,
    };
  }
}

/**
 * @file suprema-connections.service.ts
 * @description Servicio para gestión de conexiones a la API de Suprema BioStar.
 *
 * Responsabilidades:
 * 1. CRUD de conexiones con cifrado/descifrado de credenciales.
 * 2. Prueba de conexión en tiempo real contra el servidor BioStar objetivo.
 * 3. Parseo compatible de respuestas BioStar 2 y BioStar X.
 * 4. Registro de auditoría de todas las operaciones sensibles.
 *
 * Seguridad:
 * - Las credenciales nunca se retornan al cliente (ni en listados ni en detalle).
 * - El descifrado ocurre solo en runtime para operaciones de prueba.
 * - Todas las llamadas al servidor BioStar usan HTTPS obligatoriamente.
 *
 * @module modules/settings
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as https from 'https';
import * as fs from 'fs';

import { SupremaApiConnection, ConnectionTestStatus } from '../../database/entities/suprema-api-connection.entity';
import { BioStarPlatform } from '../../database/entities';
import { EncryptionService } from '../../core/crypto/encryption.service';
import {
  StructuredLoggerService,
} from '../../core/logging/structured-logger.service';
import { CreateSupremaConnectionDto } from './dto/create-suprema-connection.dto';
import { UpdateSupremaConnectionDto } from './dto/update-suprema-connection.dto';

/**
 * Resultado de una prueba de conexión a BioStar.
 */
export interface ConnectionTestResult {
  success: boolean;
  message: string;
  serverInfo?: {
    platform: string;
    version?: string;
    buildDate?: string;
    licenseInfo?: Record<string, unknown>;
  };
  latencyMs?: number;
  testedAt: Date;
}

/**
 * Vista segura de una conexión (sin credenciales descifradas).
 */
export interface SafeConnectionView {
  id: string;
  tenantId: string | null;
  name: string;
  description: string | null;
  platform: BioStarPlatform;
  apiUrl: string;
  hasCaCert: boolean;
  isActive: boolean;
  lastTestedAt: Date | null;
  lastTestStatus: ConnectionTestStatus;
  lastTestMessage: string | null;
  serverMetadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class SupremaConnectionsService {
  private readonly logger = new Logger(SupremaConnectionsService.name);

  constructor(
    @InjectRepository(SupremaApiConnection)
    private readonly connectionRepo: Repository<SupremaApiConnection>,
    private readonly encryptionService: EncryptionService,
    private readonly httpService: HttpService,
    private readonly structuredLogger: StructuredLoggerService,
  ) {}

  /**
   * Transforma una entidad en una vista segura sin credenciales.
   */
  private toSafeView(conn: SupremaApiConnection): SafeConnectionView {
    return {
      id: conn.id,
      tenantId: conn.tenantId,
      name: conn.name,
      description: conn.description,
      platform: conn.platform,
      apiUrl: conn.apiUrl,
      hasCaCert: !!conn.caCertPath,
      isActive: conn.isActive,
      lastTestedAt: conn.lastTestedAt,
      lastTestStatus: conn.lastTestStatus,
      lastTestMessage: conn.lastTestMessage,
      serverMetadata: conn.serverMetadata,
      createdAt: conn.createdAt,
      updatedAt: conn.updatedAt,
    };
  }

  /**
   * Crea una nueva conexión a BioStar.
   * Las credenciales se cifran con AES-256-GCM antes de persistir.
   */
  async create(
    dto: CreateSupremaConnectionDto,
    requestUserId: string,
  ): Promise<SafeConnectionView> {
    this.logger.log(
      `🔧 Creando conexión BioStar: "${dto.name}" (${dto.platform})`,
    );

    const connection = this.connectionRepo.create({
      tenantId: dto.tenantId ?? null,
      name: dto.name,
      description: dto.description ?? null,
      platform: dto.platform,
      apiUrl: dto.apiUrl,
      loginIdEncrypted: this.encryptionService.encrypt(dto.loginId),
      passwordEncrypted: this.encryptionService.encrypt(dto.password),
      caCertPath: dto.caCertPath ?? null,
      isActive: dto.isActive ?? true,
      lastTestStatus: ConnectionTestStatus.NEVER_TESTED,
    });

    const saved = await this.connectionRepo.save(connection);

    this.structuredLogger.logAuditEvent(
      'settings.suprema_connection.created',
      requestUserId,
      { connectionId: saved.id, name: saved.name, platform: saved.platform },
    );

    this.logger.log(`✅ Conexión BioStar creada con ID: ${saved.id}`);
    return this.toSafeView(saved);
  }

  /**
   * Lista todas las conexiones, sin exponer credenciales.
   */
  async findAll(tenantId?: string): Promise<SafeConnectionView[]> {
    const where = tenantId ? { tenantId } : {};
    const connections = await this.connectionRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
    return connections.map((c) => this.toSafeView(c));
  }

  /**
   * Retorna una conexión por ID (sin credenciales).
   */
  async findOne(id: string): Promise<SafeConnectionView> {
    const connection = await this.connectionRepo.findOne({ where: { id } });
    if (!connection) {
      throw new NotFoundException(`Conexión con ID ${id} no encontrada`);
    }
    return this.toSafeView(connection);
  }

  /**
   * Actualiza una conexión existente.
   * Si se proveen nuevas credenciales, se re-cifran.
   */
  async update(
    id: string,
    dto: UpdateSupremaConnectionDto,
    requestUserId: string,
  ): Promise<SafeConnectionView> {
    const connection = await this.connectionRepo.findOne({ where: { id } });
    if (!connection) {
      throw new NotFoundException(`Conexión con ID ${id} no encontrada`);
    }

    if (dto.name !== undefined) connection.name = dto.name;
    if (dto.description !== undefined) connection.description = dto.description ?? null;
    if (dto.platform !== undefined) connection.platform = dto.platform;
    if (dto.apiUrl !== undefined) connection.apiUrl = dto.apiUrl;
    if (dto.caCertPath !== undefined) connection.caCertPath = dto.caCertPath ?? null;
    if (dto.isActive !== undefined) connection.isActive = dto.isActive;

    if (dto.loginId !== undefined) {
      connection.loginIdEncrypted = this.encryptionService.encrypt(dto.loginId);
    }
    if (dto.password !== undefined) {
      connection.passwordEncrypted = this.encryptionService.encrypt(dto.password);
    }

    const saved = await this.connectionRepo.save(connection);

    this.structuredLogger.logAuditEvent(
      'settings.suprema_connection.updated',
      requestUserId,
      { connectionId: saved.id, name: saved.name },
    );

    this.logger.log(`✅ Conexión ${id} actualizada`);
    return this.toSafeView(saved);
  }

  /**
   * Elimina una conexión.
   */
  async remove(id: string, requestUserId: string): Promise<void> {
    const connection = await this.connectionRepo.findOne({ where: { id } });
    if (!connection) {
      throw new NotFoundException(`Conexión con ID ${id} no encontrada`);
    }

    await this.connectionRepo.remove(connection);

    this.structuredLogger.logAuditEvent(
      'settings.suprema_connection.deleted',
      requestUserId,
      { connectionId: id, name: connection.name },
    );

    this.logger.log(`🗑️ Conexión ${id} eliminada`);
  }

  /**
   * Prueba la conexión contra el servidor BioStar real.
   *
   * Flujo:
   * 1. Descifra las credenciales en memoria (no persiste descifrado).
   * 2. Intenta autenticación POST /api/login → captura bs-session-id.
   * 3. Hace una llamada ligera para verificar el servidor y recoger info.
   * 4. Cierra sesión POST /api/logout.
   * 5. Persiste el resultado de la prueba en la BD.
   *
   * @throws BadRequestException si la conexión está inactiva
   */
  async testConnection(
    id: string,
    requestUserId: string,
  ): Promise<ConnectionTestResult> {
    const connection = await this.connectionRepo.findOne({ where: { id } });
    if (!connection) {
      throw new NotFoundException(`Conexión con ID ${id} no encontrada`);
    }

    if (!connection.isActive) {
      throw new BadRequestException(
        'La conexión está inactiva. Actívala antes de probarla.',
      );
    }

    this.logger.log(
      `🔍 Probando conexión "${connection.name}" → ${connection.apiUrl}`,
    );

    const startTime = Date.now();
    let sessionId: string | null = null;

    try {
      const loginId = this.encryptionService.decrypt(connection.loginIdEncrypted);
      const password = this.encryptionService.decrypt(connection.passwordEncrypted);

      const httpsAgent = new https.Agent({
        rejectUnauthorized: !!connection.caCertPath,
        ca:
          connection.caCertPath && fs.existsSync(connection.caCertPath)
            ? fs.readFileSync(connection.caCertPath)
            : undefined,
      });

      // BioStar X puede usar /api/v1/login; BioStar 2 usa /api/login.
      // Probamos en orden hasta encontrar el que responde con 200 + bs-session-id.
      const loginPaths =
        connection.platform === BioStarPlatform.BIOSTAR_X
          ? ['/api/login', '/api/v1/login']
          : ['/api/login'];

      let loginResponse: any = null;
      let usedLoginPath = '';
      const pathResults: { path: string; status: number }[] = [];

      for (const lpath of loginPaths) {
        let resp: any;
        try {
          resp = await firstValueFrom(
            this.httpService.post(
              `${connection.apiUrl}${lpath}`,
              { User: { login_id: loginId, password: password } },
              { httpsAgent, timeout: 15000, validateStatus: (s) => s < 500 },
            ),
          );
        } catch (axiosErr: any) {
          // Network-level error (ECONNREFUSED, ETIMEDOUT, etc.)
          throw new Error(
            `No se puede alcanzar el servidor BioStar en ${connection.apiUrl}. ` +
            `Verifica que la URL sea correcta y el servidor esté encendido. (${axiosErr.message})`,
          );
        }

        pathResults.push({ path: lpath, status: resp.status });
        this.logger.debug(
          `🔍 Test login path ${lpath} → HTTP ${resp.status}`,
        );

        if (resp.status === 200 && resp.headers['bs-session-id']) {
          loginResponse = resp;
          usedLoginPath = lpath;
          break;
        }
      }

      if (!loginResponse) {
        const allStatuses = pathResults
          .map((r) => `${r.path} → HTTP ${r.status}`)
          .join('; ');
        this.logger.warn(`❌ Login fallido. Resultados: ${allStatuses}`);

        const all403 = pathResults.every((r) => r.status === 403);
        const any401 = pathResults.some((r) => r.status === 401);
        const any200NoSession = pathResults.some((r) => r.status === 200);

        let hint: string;
        if (all403) {
          hint =
            `HTTP 403 en todas las rutas — el servidor BioStar rechaza peticiones desde esta IP. ` +
            `Solución: en BioStar X → Configuración → Seguridad, agrega la IP del servidor ` +
            `BioVisitor a la lista blanca. Si usas ngrok, verifica que el túnel no tenga ` +
            `restricción de IP o autenticación adicional.`;
        } else if (any401) {
          hint =
            `HTTP 401 — credenciales incorrectas. Verifica usuario y contraseña del administrador BioStar.`;
        } else if (any200NoSession) {
          hint =
            `HTTP 200 recibido pero sin header bs-session-id. ` +
            `Verifica que la URL apunte directamente al API de BioStar (no a un proxy o página web).`;
        } else {
          const bsMsg = pathResults
            .map((r) => r.status)
            .join(', ');
          hint = `Códigos recibidos: ${bsMsg}. Detalle: ${allStatuses}`;
        }

        throw new Error(hint);
      }

      this.logger.log(`✅ Login exitoso vía ${usedLoginPath}`);
      sessionId = loginResponse.headers['bs-session-id'];
      if (!sessionId) {
        throw new Error(
          'BioStar respondió con 200 pero no retornó el header bs-session-id. ' +
          'Verifica que la URL apunte al endpoint correcto.',
        );
      }

      const authHeaders = {
        'bs-session-id': sessionId,
        'Content-Type': 'application/json',
      };

      let serverInfo: Record<string, unknown> = {};

      try {
        if (connection.platform === BioStarPlatform.BIOSTAR_X) {
          const infoResp = await firstValueFrom(
            this.httpService.get(`${connection.apiUrl}/api/setting/biostar`, {
              headers: authHeaders,
              httpsAgent,
              timeout: 8000,
            }),
          );
          serverInfo = this.parseBioStarXInfo(infoResp.data);
        } else {
          const infoResp = await firstValueFrom(
            this.httpService.get(`${connection.apiUrl}/api/setting/biostar`, {
              headers: authHeaders,
              httpsAgent,
              timeout: 8000,
            }),
          );
          serverInfo = this.parseBioStar2Info(infoResp.data);
        }
      } catch (infoError: any) {
        this.logger.warn(
          `⚠️ Login exitoso pero no se pudo obtener info del servidor: ${infoError.message}`,
        );
        serverInfo = { note: 'Login exitoso. Info del servidor no disponible.' };
      }

      try {
        await firstValueFrom(
          this.httpService.post(
            `${connection.apiUrl}/api/logout`,
            {},
            { headers: authHeaders, httpsAgent, timeout: 5000 },
          ),
        );
      } catch {
        // El logout es best-effort; no falla la prueba si falla el logout
      }

      const latencyMs = Date.now() - startTime;

      const result: ConnectionTestResult = {
        success: true,
        message: `Conexión exitosa con ${connection.name}. Latencia: ${latencyMs}ms`,
        serverInfo: {
          platform: connection.platform,
          ...serverInfo,
        },
        latencyMs,
        testedAt: new Date(),
      };

      connection.lastTestedAt = result.testedAt;
      connection.lastTestStatus = ConnectionTestStatus.SUCCESS;
      connection.lastTestMessage = result.message;
      connection.serverMetadata = serverInfo;
      await this.connectionRepo.save(connection);

      this.structuredLogger.logAuditEvent(
        'settings.suprema_connection.test_success',
        requestUserId,
        { connectionId: id, latencyMs },
      );

      this.logger.log(
        `✅ Prueba exitosa para "${connection.name}". Latencia: ${latencyMs}ms`,
      );

      return result;
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = this.buildErrorMessage(error);

      connection.lastTestedAt = new Date();
      connection.lastTestStatus = ConnectionTestStatus.FAILED;
      connection.lastTestMessage = errorMessage;
      connection.serverMetadata = null;
      await this.connectionRepo.save(connection);

      this.structuredLogger.logAuditEvent(
        'settings.suprema_connection.test_failed',
        requestUserId,
        { connectionId: id, error: errorMessage },
      );

      this.logger.warn(
        `❌ Prueba fallida para "${connection.name}": ${errorMessage}`,
      );

      return {
        success: false,
        message: errorMessage,
        latencyMs,
        testedAt: new Date(),
      };
    }
  }

  /**
   * Parsea la respuesta de info de BioStar X.
   * BioStar X tiene estructura de licencias con subcampos base/capacity/feature.
   */
  private parseBioStarXInfo(data: any): Record<string, unknown> {
    const setting = data?.BioStar || data?.biostar || data || {};
    const licenses = setting.licenses;

    let licenseInfo: Record<string, unknown> = {};
    if (licenses) {
      if (Array.isArray(licenses)) {
        licenseInfo = { licenses_bs2_format: licenses };
      } else if (typeof licenses === 'object') {
        licenseInfo = {
          base: licenses.base,
          capacity: licenses.capacity,
          feature: licenses.feature,
        };
      }
    }

    return {
      version: setting.version || setting.server_version,
      buildDate: setting.build_date || setting.buildDate,
      licenseInfo,
      platform: 'BioStar X',
    };
  }

  /**
   * Parsea la respuesta de info de BioStar 2.
   * BioStar 2 tiene array plano de licencias.
   */
  private parseBioStar2Info(data: any): Record<string, unknown> {
    const setting = data?.BioStar || data?.biostar || data || {};
    return {
      version: setting.version || setting.server_version,
      buildDate: setting.build_date || setting.buildDate,
      licenseInfo: setting.licenses || [],
      platform: 'BioStar 2',
    };
  }

  /**
   * Construye un mensaje de error descriptivo y seguro para el cliente.
   */
  private buildErrorMessage(error: any): string {
    if (error.code === 'ECONNREFUSED') {
      return 'Conexión rechazada. Verifica que el servidor BioStar esté activo y accesible desde esta red.';
    }
    if (error.code === 'ENOTFOUND') {
      return 'No se pudo resolver el hostname. Verifica que la URL sea correcta y que haya conectividad de red.';
    }
    if (error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || error.code === 'CERT_HAS_EXPIRED') {
      return 'Error de certificado SSL. El servidor usa un certificado autofirmado o expirado. Configura el CA cert o contacta al administrador de BioStar.';
    }
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      return 'Tiempo de espera agotado. El servidor no respondió en 15 segundos. Verifica conectividad y firewall.';
    }
    if (error.response?.status === 401) {
      return 'Credenciales incorrectas. Verifica el login_id y password del administrador en BioStar.';
    }
    if (error.response?.status === 403) {
      return 'Acceso denegado. El usuario no tiene permisos de administrador en BioStar.';
    }
    if (error.response?.status === 404) {
      return 'Endpoint no encontrado. Verifica que la URL base sea correcta (debe incluir la ruta /api).';
    }

    return error.message || 'Error desconocido al conectar con el servidor BioStar';
  }
}

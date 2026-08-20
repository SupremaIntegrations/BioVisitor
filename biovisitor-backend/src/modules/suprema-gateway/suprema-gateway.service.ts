/**
 * @file suprema-gateway.service.ts
 * @description Servicio orquestador del Gateway de Suprema.
 *
 * Este servicio es el punto de entrada único para todas las operaciones
 * con BioStar (2 o X). Selecciona automáticamente el cliente correcto
 * según la configuración del tenant y envuelve las llamadas con el
 * Circuit Breaker para resiliencia.
 *
 * Patrón: Facade + Strategy + Circuit Breaker
 *
 * @module modules/suprema-gateway
 */

import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import Redis from 'ioredis';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { BioStar2Client } from './biostar2/biostar2.client';
import { BioStarXClient } from './biostarx/biostarx.client';
import { CircuitBreakerService } from './circuit-breaker/circuit-breaker.service';
import {
  ISupremaClient,
  CreateSupremaUserPayload,
  SupremaUserResult,
  AccessEvent,
  FaceValidationResult,
} from './interfaces/suprema-client.interface';
import {
  StructuredLoggerService,
  LogCategory,
} from '../../core/logging/structured-logger.service';
import { EncryptionService } from '../../core/crypto/encryption.service';
import { Tenant, BioStarPlatform } from '../../database/entities';

/**
 * Gateway de Suprema - Orquesta operaciones contra BioStar 2 y BioStar X.
 *
 * Responsabilidades:
 * 1. Crear el cliente correcto (BS2 o BSX) según el tenant.
 * 2. Descifrar las credenciales del tenant.
 * 3. Envolver operaciones con Circuit Breaker.
 * 4. Registrar todas las operaciones en el logger estructurado.
 *
 * @example
 * // Crear un visitante en BioStar del tenant
 * const result = await supremaGateway.createUser(tenant, payload);
 */
@Injectable()
export class SupremaGatewayService {
  private readonly logger = new Logger(SupremaGatewayService.name);
  /** Caché de clientes por tenant para reutilización */
  private readonly clientCache = new Map<string, ISupremaClient>();
  /** Caché de Circuit Breakers por tenant */
  private readonly breakerCache = new Map<string, CircuitBreakerService>();

  constructor(
    private readonly httpService: HttpService,
    @InjectRedis() private readonly redis: Redis,
    private readonly encryptionService: EncryptionService,
    private readonly structuredLogger: StructuredLoggerService,
  ) {}

  /**
   * Obtiene o crea el cliente de BioStar correcto para un tenant.
   * Los clientes se cachean en memoria para reutilización.
   *
   * @param tenant - Entidad del tenant con la configuración de BioStar
   * @returns Cliente ISupremaClient listo para usar
   */
  private getClient(tenant: Tenant): ISupremaClient {
    const cacheKey = `${tenant.id}:${tenant.biostarPlatform}`;

    if (this.clientCache.has(cacheKey)) {
      return this.clientCache.get(cacheKey)!;
    }

    // Descifrar credenciales almacenadas
    let credentials: { loginId: string; password: string };
    try {
      const decrypted = this.encryptionService.decrypt(
        tenant.biostarCredentialsEncrypted,
      );
      credentials = JSON.parse(decrypted);
    } catch (error) {
      this.logger.error(
        `❌ Error descifrando credenciales del tenant ${tenant.id}`,
      );
      throw new Error('No se pudieron descifrar las credenciales de BioStar');
    }

    let client: ISupremaClient;

    if (tenant.biostarPlatform === BioStarPlatform.BIOSTAR_2) {
      client = new BioStar2Client(this.httpService, this.redis, {
        apiUrl: tenant.biostarApiUrl,
        adminUser: credentials.loginId,
        adminPassword: credentials.password,
        caCertPath: tenant.biostarCaCertPath,
        tenantId: tenant.id,
      });
    } else {
      client = new BioStarXClient(this.httpService, this.redis, {
        apiUrl: tenant.biostarApiUrl,
        adminUser: credentials.loginId,
        adminPassword: credentials.password,
        caCertPath: tenant.biostarCaCertPath,
        tenantId: tenant.id,
      });
    }

    this.clientCache.set(cacheKey, client);
    return client;
  }

  /**
   * Obtiene o crea el Circuit Breaker para un tenant.
   */
  private getBreaker(tenantId: string): CircuitBreakerService {
    if (!this.breakerCache.has(tenantId)) {
      this.breakerCache.set(
        tenantId,
        new CircuitBreakerService(
          {
            failureThreshold: 3,
            failureWindow: 60000,
            resetTimeout: 30000,
            name: `BioStar-${tenantId.substring(0, 8)}`,
          },
          this.structuredLogger,
        ),
      );
    }
    return this.breakerCache.get(tenantId)!;
  }

  /**
   * Crea un usuario visitante en BioStar, protegido por Circuit Breaker.
   *
   * @param tenant - Tenant con la configuración de BioStar
   * @param payload - Datos normalizados del visitante
   * @returns Resultado con el ID de referencia de BioStar
   */
  async createUser(
    tenant: Tenant,
    payload: CreateSupremaUserPayload,
  ): Promise<SupremaUserResult> {
    const client = this.getClient(tenant);
    const breaker = this.getBreaker(tenant.id);

    this.structuredLogger.logUserAction(
      'suprema.create_user.attempt',
      'system',
      { visitorId: payload.visitorId, fullName: payload.fullName },
      tenant.id,
    );

    const result = await breaker.execute(() => client.createUser(payload));

    this.structuredLogger.logUserAction(
      'suprema.create_user.success',
      'system',
      { supremaRefId: result.supremaRefId, visitorId: payload.visitorId },
      tenant.id,
    );

    return result;
  }

  /**
   * Elimina un usuario visitante de BioStar (check-out / limpieza).
   */
  async deleteUser(tenant: Tenant, supremaRefId: string): Promise<void> {
    const client = this.getClient(tenant);
    const breaker = this.getBreaker(tenant.id);

    this.structuredLogger.logUserAction(
      'suprema.delete_user.attempt',
      'system',
      { supremaRefId },
      tenant.id,
    );

    await breaker.execute(() => client.deleteUser(supremaRefId));

    this.structuredLogger.logUserAction(
      'suprema.delete_user.success',
      'system',
      { supremaRefId },
      tenant.id,
    );
  }

  /**
   * Enrolla una foto facial en BioStar.
   */
  async enrollFace(
    tenant: Tenant,
    supremaRefId: string,
    photoBase64: string,
  ): Promise<void> {
    const client = this.getClient(tenant);
    const breaker = this.getBreaker(tenant.id);
    await breaker.execute(() => client.enrollFace(supremaRefId, photoBase64));
  }

  /**
   * Enrolla huella dactilar en BioStar.
   */
  async enrollFingerprint(
    tenant: Tenant,
    supremaRefId: string,
    templateData: unknown,
  ): Promise<void> {
    const client = this.getClient(tenant);
    const breaker = this.getBreaker(tenant.id);
    await breaker.execute(() =>
      client.enrollFingerprint(supremaRefId, templateData),
    );
  }

  /**
   * Asigna tarjeta RFID o código QR en BioStar.
   */
  async assignCard(
    tenant: Tenant,
    supremaRefId: string,
    cardId: string,
  ): Promise<void> {
    const client = this.getClient(tenant);
    const breaker = this.getBreaker(tenant.id);
    await breaker.execute(() => client.assignCard(supremaRefId, cardId));
  }

  /**
   * Abre una puerta vía BioStar (para validación de QR dinámico).
   */
  async openDoor(tenant: Tenant, doorId: string): Promise<void> {
    const client = this.getClient(tenant);
    const breaker = this.getBreaker(tenant.id);

    this.structuredLogger.logAuditEvent('suprema.open_door', 'system', {
      doorId,
    });

    await breaker.execute(() => client.openDoor(doorId));
  }

  /**
   * Obtiene eventos de acceso desde BioStar.
   */
  async getEvents(
    tenant: Tenant,
    fromDate: Date,
    toDate: Date,
  ): Promise<AccessEvent[]> {
    const client = this.getClient(tenant);
    const breaker = this.getBreaker(tenant.id);
    return breaker.execute(() => client.getEvents(fromDate, toDate));
  }

  /**
   * Valida una imagen facial contra el motor de IA de BioStar.
   * Retorna los templates extraídos si la imagen es válida.
   */
  async validateFaceTemplate(
    tenant: Tenant,
    photoBase64: string,
  ): Promise<FaceValidationResult> {
    const client = this.getClient(tenant);
    const breaker = this.getBreaker(tenant.id);

    this.structuredLogger.logUserAction(
      'suprema.validate_face.attempt',
      'system',
      { imageSize: photoBase64.length },
      tenant.id,
    );

    const result = await breaker.execute(() =>
      client.validateFaceTemplate(photoBase64),
    );

    if (result.valid) {
      this.structuredLogger.logUserAction(
        'suprema.validate_face.success',
        'system',
        { hasTemplate: !!result.imageTemplate },
        tenant.id,
      );
    } else {
      this.structuredLogger.logUserAction(
        'suprema.validate_face.failed',
        'system',
        { error: result.errorMessage },
        tenant.id,
      );
    }

    return result;
  }

  /**
   * Captura una fotografía facial desde un dispositivo BioStar.
   * Delega al cliente específico de la plataforma del tenant.
   * @param tenant - Tenant con configuración BioStar
   * @param deviceId - ID del dispositivo en BioStar
   * @returns Imagen base64 pura (sin prefijo data:image)
   */
  async capturePhotoFromDevice(tenant: Tenant, deviceId: string): Promise<string> {
    const client = this.getClient(tenant);
    const breaker = this.getBreaker(tenant.id);

    this.structuredLogger.logUserAction(
      'suprema.capture_device.attempt',
      'system',
      { deviceId },
      tenant.id,
    );

    const imageBase64 = await breaker.execute(() =>
      client.capturePhotoFromDevice(deviceId),
    );

    this.structuredLogger.logUserAction(
      'suprema.capture_device.success',
      'system',
      { deviceId, imageSize: imageBase64.length },
      tenant.id,
    );

    return imageBase64;
  }

  /**
   * Verifica la conexión con BioStar para el health check.
   */
  async healthCheck(tenant: Tenant): Promise<{
    connected: boolean;
    circuitState: string;
    platform: string;
  }> {
    const client = this.getClient(tenant);
    const breaker = this.getBreaker(tenant.id);

    try {
      const connected = await client.healthCheck();
      return {
        connected,
        circuitState: breaker.getState(),
        platform: tenant.biostarPlatform,
      };
    } catch {
      return {
        connected: false,
        circuitState: breaker.getState(),
        platform: tenant.biostarPlatform,
      };
    }
  }
}

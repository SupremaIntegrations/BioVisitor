/**
 * @file auth.service.ts
 * @description Servicio de autenticación del VMS.
 *
 * Maneja el login de usuarios del sistema (operadores, administradores, hosts),
 * generación de JWT para acceso al API, y gestión de sesiones.
 *
 * Características de seguridad:
 * - Passwords hasheados con bcrypt (12 rounds)
 * - JWT con expiración configurable
 * - Bloqueo de cuenta tras intentos fallidos consecutivos
 * - Registro de auditoría de todos los intentos de login
 * - Rate limiting por IP (configurado a nivel de controller)
 *
 * @module modules/auth
 */

import { Injectable, Logger, UnauthorizedException, BadRequestException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { User, UserRole, Host, Tenant, BioStarPlatform } from '../../database/entities';
import {
  StructuredLoggerService,
  LogCategory,
} from '../../core/logging/structured-logger.service';
import { NotificationsService } from '../notifications/notifications.service';

/** Número de rounds para el hash bcrypt (12 es un buen balance seguridad/performance) */
const BCRYPT_ROUNDS = 12;
/** Máximo de intentos de login fallidos antes de bloquear la cuenta */
const MAX_FAILED_ATTEMPTS = 5;
/** Duración del bloqueo de cuenta en minutos */
const LOCKOUT_DURATION_MINUTES = 15;

/**
 * Payload del JWT de autenticación del VMS.
 * Se incluye en el token y se decodifica en cada petición autenticada.
 */
export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  tenantId: string;
  fullName: string;
  hostId?: string | null;
  /** Permisos granulares — solo presente para role=OPERATOR */
  permissions?: import('../../database/entities/user.entity').OperatorPermissions | null;
  /** Timeout de inactividad en minutos (del securityConfig del operador) */
  sessionTimeoutMinutes?: number | null;
}

/**
 * Resultado del login exitoso.
 */
export interface LoginResult {
  accessToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: UserRole;
    tenantId: string;
    language: string;
    hostId?: string | null;
    permissions?: import('../../database/entities/user.entity').OperatorPermissions | null;
    sessionTimeoutMinutes?: number | null;
  };
}

/**
 * Servicio de autenticación del VMS.
 *
 * @example
 * // Login de un operador
 * const result = await authService.login('operator@company.com', 'password123', '10.0.1.5');
 * // result.accessToken contiene el JWT para peticiones autenticadas
 */
const PASSWORD_RESET_TTL_SECONDS = 30 * 60; // 30 minutos
const PASSWORD_RESET_REDIS_PREFIX = 'pwd_reset:';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Host)
    private readonly hostRepository: Repository<Host>,
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    private readonly jwtService: JwtService,
    private readonly structuredLogger: StructuredLoggerService,
    @InjectRedis() private readonly redis: Redis,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Autentica un usuario del VMS con email y contraseña.
   *
   * Flujo de seguridad:
   * 1. Buscar usuario por email (case insensitive).
   * 2. Verificar que la cuenta no esté bloqueada.
   * 3. Comparar contraseña con hash bcrypt.
   * 4. Si falla: incrementar contador, bloquear si excede umbral.
   * 5. Si éxito: resetear contador, generar JWT, registrar en auditoría.
   *
   * @param email - Email del usuario
   * @param password - Contraseña en texto plano
   * @param ipAddress - IP del cliente (para auditoría)
   * @param userAgent - User-Agent del navegador (para auditoría)
   * @returns Resultado del login con JWT y datos del usuario
   * @throws UnauthorizedException si las credenciales son inválidas o la cuenta está bloqueada
   */
  async login(
    email: string,
    password: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<LoginResult> {
    // 1. Buscar usuario por email (case insensitive)
    const user = await this.userRepository.findOne({
      where: { email: email.toLowerCase(), isActive: true },
    });

    if (!user) {
      // Registrar intento con email inexistente (posible reconocimiento)
      this.structuredLogger.logAuditEvent(
        'auth.login_failed',
        'unknown',
        { email, reason: 'Usuario no encontrado' },
        ipAddress,
      );
      // Por seguridad, no revelamos si el email existe o no
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // 2. Verificar bloqueo de cuenta
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const remainingMinutes = Math.ceil(
        (user.lockedUntil.getTime() - Date.now()) / 60000,
      );

      this.structuredLogger.logAuditEvent(
        'auth.login_blocked',
        user.id,
        {
          email: user.email,
          reason: 'Cuenta bloqueada por intentos fallidos',
          lockedUntil: user.lockedUntil.toISOString(),
          remainingMinutes,
        },
        ipAddress,
      );

      throw new UnauthorizedException(
        `Cuenta bloqueada. Intente nuevamente en ${remainingMinutes} minutos.`,
      );
    }

    // 3. Verificar contraseña con bcrypt
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      // Incrementar contador de intentos fallidos
      const newFailedAttempts = user.failedLoginAttempts + 1;
      const updateFields: Record<string, unknown> = {
        failedLoginAttempts: newFailedAttempts,
      };

      // Si excede el umbral, bloquear la cuenta
      if (newFailedAttempts >= MAX_FAILED_ATTEMPTS) {
        updateFields.lockedUntil = new Date(
          Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000,
        );

        this.structuredLogger.logAuditEvent(
          'auth.account_locked',
          user.id,
          {
            email: user.email,
            failedAttempts: newFailedAttempts,
            lockoutMinutes: LOCKOUT_DURATION_MINUTES,
          },
          ipAddress,
        );

        this.logger.warn(
          `🔒 Cuenta bloqueada: ${user.email} tras ${newFailedAttempts} intentos fallidos.`,
        );
      }

      await this.userRepository.update(user.id, updateFields as any);

      this.structuredLogger.logAuditEvent(
        'auth.login_failed',
        user.id,
        {
          email: user.email,
          failedAttempts: newFailedAttempts,
          reason: 'Contraseña incorrecta',
        },
        ipAddress,
      );

      throw new UnauthorizedException('Credenciales inválidas');
    }

    // 4. Login exitoso: resetear contador y actualizar último login
    await this.userRepository.update(user.id, {
      failedLoginAttempts: 0,
      lockedUntil: null as any,
      lastLoginAt: new Date(),
    });

    // 5. Si el usuario es HOST, buscar el Host vinculado para incluir hostId en el JWT
    let hostId: string | null = null;
    if (user.role === UserRole.HOST) {
      const linkedHost = await this.hostRepository.findOne({
        where: { tenantId: user.tenantId, userId: user.id },
        select: ['id'],
      });
      hostId = linkedHost?.id ?? null;
    }

    // 6. Generar JWT (incluye permisos y timeout de sesión para operadores)
    const jwtPayload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      fullName: user.fullName,
      ...(user.role === UserRole.HOST && { hostId }),
      ...(user.role === UserRole.OPERATOR && user.permissions && { permissions: user.permissions }),
      ...(user.securityConfig?.sessionTimeoutMinutes != null && {
        sessionTimeoutMinutes: user.securityConfig.sessionTimeoutMinutes,
      }),
    };

    const accessToken = this.jwtService.sign(jwtPayload);

    // 7. Registrar login exitoso en auditoría
    this.structuredLogger.logAuditEvent(
      'auth.login_success',
      user.id,
      {
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        ...(hostId && { hostId }),
      },
      ipAddress,
    );

    this.logger.log(
      `✅ Login exitoso: ${user.fullName} (${user.role}) - Tenant: ${user.tenantId}`,
    );

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        tenantId: user.tenantId,
        language: user.language,
        hostId,
        permissions: user.role === UserRole.OPERATOR ? (user.permissions ?? null) : null,
        sessionTimeoutMinutes: user.securityConfig?.sessionTimeoutMinutes ?? null,
      },
    };
  }

  /**
   * Inicia el flujo de recuperación de contraseña.
   * Genera un token seguro, lo guarda en Redis con TTL de 30 min,
   * y envía el email al operador. Siempre responde igual
   * para no revelar si el email existe.
   */
  async forgotPassword(email: string, frontendUrl: string): Promise<void> {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await this.userRepository.findOne({
      where: { email: normalizedEmail, isActive: true },
    });

    if (!user) {
      // Respuesta silenciosa — no revelar si el email existe
      this.logger.warn(`[FORGOT_PWD] Email no encontrado o inactivo: ${normalizedEmail}`);
      return;
    }

    // Generar token criptográficamente seguro
    const token = crypto.randomBytes(32).toString('hex');
    const redisKey = `${PASSWORD_RESET_REDIS_PREFIX}${token}`;

    // Guardar en Redis: key → userId
    await this.redis.set(redisKey, user.id, 'EX', PASSWORD_RESET_TTL_SECONDS);

    const resetUrl = `${frontendUrl}/auth/reset-password?token=${token}`;

    this.logger.log(`[FORGOT_PWD] Token generado para ${user.email}, expira en 30 min`);

    // Enviar email (soft-fail: no bloquea el flujo si falla el SMTP)
    const sent = await this.notifications.sendPasswordResetEmail(user.email, {
      fullName: user.fullName,
      resetUrl,
    });

    if (!sent) {
      this.logger.error(`[FORGOT_PWD] Falló el envío de email a ${user.email}`);
    }

    this.structuredLogger.logAuditEvent(
      'auth.password_reset_requested',
      user.id,
      { email: user.email },
    );
  }

  /**
   * Completa el reset de contraseña validando el token de Redis
   * y actualizando el hash en la BD.
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const redisKey = `${PASSWORD_RESET_REDIS_PREFIX}${token}`;
    const userId = await this.redis.get(redisKey);

    if (!userId) {
      throw new BadRequestException('El enlace de recuperación es inválido o ya expiró.');
    }

    const user = await this.userRepository.findOne({
      where: { id: userId, isActive: true },
    });

    if (!user) {
      throw new BadRequestException('El enlace de recuperación es inválido o ya expiró.');
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await this.userRepository.update(user.id, {
      passwordHash,
      failedLoginAttempts: 0,
      lockedUntil: null as any,
    });

    // Invalidar el token inmediatamente (uso único)
    await this.redis.del(redisKey);

    this.logger.log(`[RESET_PWD] Contraseña actualizada para usuario ${user.email}`);

    this.structuredLogger.logAuditEvent(
      'auth.password_reset_completed',
      user.id,
      { email: user.email },
    );
  }

  /**
   * Hashea una contraseña con bcrypt.
   * Utilidad para la creación de usuarios.
   *
   * @param password - Contraseña en texto plano
   * @returns Hash bcrypt de la contraseña
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  /**
   * Verifica si el sistema necesita configuración inicial (no existe ningún ADMIN activo).
   */
  async checkSystemStatus(): Promise<{ needsSetup: boolean }> {
    const adminCount = await this.userRepository.count({
      where: { role: UserRole.ADMIN, isActive: true },
    });
    return { needsSetup: adminCount === 0 };
  }

  /**
   * Crea el administrador inicial del sistema.
   * Solo funciona cuando no existe ningún usuario ADMIN activo.
   * Crea también el tenant por defecto si la tabla está vacía.
   *
   * @throws ConflictException si ya existe un administrador
   * @throws BadRequestException si las contraseñas no coinciden o no cumplen requisitos
   */
  async systemSetup(adminFullName: string, adminEmail: string, password: string, confirmPassword: string): Promise<{ success: boolean; email: string }> {
    const { needsSetup } = await this.checkSystemStatus();
    if (!needsSetup) {
      throw new ConflictException(
        'El sistema ya está configurado. No es posible crear un nuevo administrador desde este endpoint.',
      );
    }

    if (password !== confirmPassword) {
      throw new BadRequestException('Las contraseñas no coinciden.');
    }
    if (password.length < 8) {
      throw new BadRequestException('La contraseña debe tener al menos 8 caracteres.');
    }
    if (!/[A-Z]/.test(password)) {
      throw new BadRequestException('La contraseña debe contener al menos una letra mayúscula.');
    }
    if (!/[0-9]/.test(password)) {
      throw new BadRequestException('La contraseña debe contener al menos un número.');
    }

    // Crear tenant por defecto si no existe ninguno
    let tenant = await this.tenantRepository.findOne({ where: {} });
    if (!tenant) {
      tenant = this.tenantRepository.create({
        code: 'BVXDEFAULT',
        name: 'BioVisitor X',
        timezone: 'America/Bogota',
        biostarPlatform: BioStarPlatform.BIOSTAR_X,
        biostarApiUrl: '',
        biostarCredentialsEncrypted: '',
      });
      await this.tenantRepository.save(tenant);
      this.logger.log('✅ [SETUP] Tenant por defecto creado.');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const admin = this.userRepository.create({
      email: adminEmail,
      passwordHash,
      fullName: adminFullName,
      role: UserRole.ADMIN,
      tenantId: tenant.id,
      language: 'es',
      isActive: true,
    });
    await this.userRepository.save(admin);

    this.logger.log(`✅ [SETUP] Administrador del sistema creado: ${adminEmail}`);
    this.structuredLogger.logAuditEvent(
      'auth.system_setup_completed',
      admin.id,
      { email: adminEmail, fullName: adminFullName },
      tenant.id,
    );

    return { success: true, email: adminEmail };
  }

  /**
   * Valida el payload de un JWT decodificado.
   * Se usa en el JwtStrategy de Passport para verificar que el usuario
   * aún existe y está activo.
   *
   * @param payload - Payload decodificado del JWT
   * @returns Datos del usuario si es válido
   * @throws UnauthorizedException si el usuario no existe o está inactivo
   */
  /**
   * Cambia la contraseña de un usuario autenticado.
   * Verifica la contraseña actual antes de aplicar el cambio.
   *
   * @param userId - ID del usuario que solicita el cambio
   * @param currentPassword - Contraseña actual (para verificación)
   * @param newPassword - Nueva contraseña
   * @throws UnauthorizedException si la contraseña actual no coincide
   * @throws BadRequestException si la nueva contraseña no cumple requisitos
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<{ message: string }> {
    const user = await this.userRepository.findOne({ where: { id: userId, isActive: true } });
    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado o inactivo.');
    }

    const matches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!matches) {
      await this.structuredLogger.logUserAction(
        'auth.change_password_failed',
        userId,
        { tenantId: user.tenantId, reason: 'invalid_current_password' },
      );
      throw new UnauthorizedException('La contraseña actual no es correcta.');
    }

    if (newPassword.length < 8) {
      throw new BadRequestException('La nueva contraseña debe tener al menos 8 caracteres.');
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await this.userRepository.save(user);

    await this.structuredLogger.logUserAction(
      'auth.change_password_success',
      userId,
      { tenantId: user.tenantId },
    );

    return { message: 'Contraseña actualizada exitosamente.' };
  }

  async validateJwtPayload(payload: JwtPayload): Promise<JwtPayload> {
    const user = await this.userRepository.findOne({
      where: { id: payload.sub, isActive: true },
    });

    if (!user) {
      throw new UnauthorizedException(
        'Sesión inválida. Inicie sesión nuevamente.',
      );
    }

    // Devolver siempre el tenantId actual de la BD, no el del JWT.
    // Esto garantiza que migraciones de tenant o re-seeds no dejen sesiones
    // activas apuntando al tenant incorrecto.
    return { ...payload, tenantId: user.tenantId };
  }
}

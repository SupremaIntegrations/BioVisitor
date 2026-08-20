/**
 * @file encryption.service.ts
 * @description Servicio de cifrado y descifrado de datos sensibles usando AES-256-GCM.
 *
 * Este servicio es fundamental para la ciberseguridad del VMS. Se utiliza para:
 * - Cifrar credenciales de BioStar almacenadas en la base de datos (por tenant).
 * - Cifrar datos sensibles de visitantes (documentos, fotos de identificación).
 * - Proteger cualquier dato PII (Personally Identifiable Information) en reposo.
 *
 * AES-256-GCM proporciona tanto confidencialidad como autenticidad (AEAD),
 * lo que significa que además de cifrar, verifica que los datos no han sido
 * alterados (integridad). Esto es un requisito de nivel enterprise.
 *
 * La clave maestra se carga desde la variable de entorno ENCRYPTION_MASTER_KEY.
 * En producción, esta clave debería provenir de un servicio de vault de secretos
 * (HashiCorp Vault, AWS KMS, Azure Key Vault).
 *
 * @module core/crypto
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/** Algoritmo de cifrado: AES-256-GCM (Galois/Counter Mode) */
const ALGORITHM = 'aes-256-gcm';
/** Longitud del vector de inicialización (IV) en bytes */
const IV_LENGTH = 16;
/** Longitud del tag de autenticación en bytes */
const AUTH_TAG_LENGTH = 16;
/** Longitud esperada de la clave maestra en bytes (256 bits) */
const KEY_LENGTH = 32;

/**
 * Servicio de cifrado AES-256-GCM para protección de datos sensibles en reposo.
 *
 * @example
 * // Cifrar credenciales de BioStar para almacenar en BD
 * const encrypted = encryptionService.encrypt('mi_password_biostar');
 * // Resultado: "iv_hex:ciphertext_hex:authtag_hex"
 *
 * // Descifrar cuando se necesita usar la credencial
 * const decrypted = encryptionService.decrypt(encrypted);
 * // Resultado: "mi_password_biostar"
 */
@Injectable()
export class EncryptionService implements OnModuleInit {
  private readonly logger = new Logger(EncryptionService.name);
  private masterKey: Buffer;

  constructor(private readonly configService: ConfigService) {}

  /**
   * Inicialización del módulo.
   * Valida que la clave maestra de cifrado esté configurada correctamente.
   * Si no está configurada, genera una clave temporal para desarrollo
   * y emite una advertencia severa en los logs.
   */
  onModuleInit(): void {
    const keyHex = this.configService.get<string>('app.encryptionMasterKey');

    if (!keyHex || keyHex.length === 0) {
      // En desarrollo, generamos una clave temporal para no bloquear el arranque.
      // En producción, esto DEBE ser un error fatal.
      if (this.configService.get<string>('app.nodeEnv') === 'production') {
        throw new Error(
          '🔴 CRITICAL: ENCRYPTION_MASTER_KEY no está configurada. ' +
            'El sistema NO puede iniciarse en producción sin una clave de cifrado.',
        );
      }
      this.logger.warn(
        '⚠️ ENCRYPTION_MASTER_KEY no configurada. Usando clave temporal de desarrollo. ' +
          'NO usar en producción.',
      );
      this.masterKey = crypto.scryptSync(
        'dev-temp-key-DO-NOT-USE',
        'salt',
        KEY_LENGTH,
      );
    } else {
      // La clave debe ser un hex string de 64 caracteres (32 bytes = 256 bits)
      if (keyHex.length !== 64) {
        throw new Error(
          `ENCRYPTION_MASTER_KEY debe ser un hex string de 64 caracteres (256 bits). ` +
            `Longitud actual: ${keyHex.length}`,
        );
      }
      this.masterKey = Buffer.from(keyHex, 'hex');
    }

    this.logger.log(
      '🔐 Servicio de cifrado AES-256-GCM inicializado correctamente.',
    );
  }

  /**
   * Cifra un texto plano usando AES-256-GCM.
   *
   * El resultado incluye el IV y el tag de autenticación, necesarios para
   * el descifrado. El formato es: "iv_hex:ciphertext_hex:authtag_hex"
   *
   * @param plaintext - Texto a cifrar
   * @returns String cifrado en formato "iv:ciphertext:tag" (hexadecimal)
   * @throws Error si el plaintext está vacío
   */
  encrypt(plaintext: string): string {
    if (!plaintext) {
      throw new Error('No se puede cifrar un texto vacío');
    }

    // IV (Initialization Vector) aleatorio para cada operación de cifrado.
    // Esto garantiza que cifrar el mismo texto dos veces produce resultados diferentes.
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.masterKey, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // El tag de autenticación permite verificar la integridad al descifrar
    const authTag = cipher.getAuthTag();

    // Formato: iv:ciphertext:tag (todo en hexadecimal)
    return `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`;
  }

  /**
   * Descifra un texto cifrado con AES-256-GCM.
   *
   * @param encryptedData - String cifrado en formato "iv:ciphertext:tag"
   * @returns Texto plano original
   * @throws Error si el formato es inválido o el tag de autenticación falla
   *         (indicando posible manipulación de datos)
   */
  decrypt(encryptedData: string): string {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error(
        'Formato de datos cifrados inválido. Esperado: "iv:ciphertext:tag"',
      );
    }

    const [ivHex, ciphertext, authTagHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, this.masterKey, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Genera un hash seguro de un valor (uso único: no reversible).
   * Útil para almacenar tokens QR hasheados en la base de datos.
   *
   * @param value - Valor a hashear
   * @returns Hash SHA-256 en hexadecimal
   */
  hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  /**
   * Genera una clave maestra aleatoria para uso en producción.
   * Este método es una utilidad para generar la clave inicial que se
   * almacenará en el vault de secretos.
   *
   * @returns Clave hexadecimal de 64 caracteres (256 bits)
   */
  static generateMasterKey(): string {
    return crypto.randomBytes(KEY_LENGTH).toString('hex');
  }
}

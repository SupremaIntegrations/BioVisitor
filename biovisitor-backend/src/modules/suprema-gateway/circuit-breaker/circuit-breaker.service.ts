/**
 * @file circuit-breaker.service.ts
 * @description Implementación del patrón Circuit Breaker para resiliencia.
 *
 * El Circuit Breaker protege al VMS cuando BioStar está caído o lento:
 *
 * Estados del circuito:
 * - CLOSED (normal): Las peticiones pasan normalmente a BioStar.
 * - OPEN (fallo detectado): Las peticiones se rechazan inmediatamente
 *   sin intentar contactar a BioStar. Se espera un periodo de "cooling down".
 * - HALF_OPEN (prueba): Se permite UNA petición de prueba para verificar
 *   si BioStar se ha recuperado. Si tiene éxito, vuelve a CLOSED.
 *   Si falla, vuelve a OPEN.
 *
 * Beneficios:
 * - Evita que una caída de BioStar colapse todo el VMS.
 * - Los visitantes quedan en estado "pending_sync" para reintento posterior.
 * - Emite métricas y alertas para el dashboard en tiempo real.
 *
 * @module modules/suprema-gateway/circuit-breaker
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  StructuredLoggerService,
  LogCategory,
} from '../../../core/logging/structured-logger.service';

/**
 * Estados posibles del Circuit Breaker.
 */
export enum CircuitState {
  /** Normal: las peticiones pasan a BioStar */
  CLOSED = 'CLOSED',
  /** Abierto: las peticiones se rechazan inmediatamente (BioStar falla) */
  OPEN = 'OPEN',
  /** Semi-abierto: se permite una petición de prueba */
  HALF_OPEN = 'HALF_OPEN',
}

/**
 * Opciones de configuración del Circuit Breaker.
 */
export interface CircuitBreakerOptions {
  /** Número de fallos consecutivos para abrir el circuito (default: 3) */
  failureThreshold: number;
  /** Ventana de tiempo en ms para contar fallos (default: 60000 = 60s) */
  failureWindow: number;
  /** Tiempo en ms que el circuito permanece abierto antes de probar (default: 30000 = 30s) */
  resetTimeout: number;
  /** Nombre del circuito para logging (ej: "BioStar2-tenant1") */
  name: string;
}

/**
 * Circuit Breaker para proteger llamadas a BioStar.
 *
 * @example
 * const breaker = new CircuitBreakerService(logger, {
 *   failureThreshold: 3,
 *   failureWindow: 60000,
 *   resetTimeout: 30000,
 *   name: 'BioStar2-tenant1',
 * });
 *
 * try {
 *   const result = await breaker.execute(() => biostar2Client.createUser(payload));
 * } catch (error) {
 *   if (error.message.includes('Circuit breaker is OPEN')) {
 *     // BioStar no disponible, marcar visita como pending_sync
 *   }
 * }
 */
@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0;
  private lastStateChangeTime = Date.now();
  private readonly options: CircuitBreakerOptions;
  private structuredLogger?: StructuredLoggerService;

  constructor(
    options: CircuitBreakerOptions,
    structuredLogger?: StructuredLoggerService,
  ) {
    this.options = {
      failureThreshold: options.failureThreshold || 3,
      failureWindow: options.failureWindow || 60000,
      resetTimeout: options.resetTimeout || 30000,
      name: options.name || 'default',
    };
    this.structuredLogger = structuredLogger;
  }

  /**
   * Ejecuta una función protegida por el Circuit Breaker.
   *
   * - Si el circuito está CLOSED: ejecuta normalmente.
   * - Si está OPEN: rechaza inmediatamente sin llamar a la función.
   * - Si está HALF_OPEN: permite la ejecución como prueba.
   *
   * @param fn - Función asíncrona a ejecutar (ej: llamada a BioStar)
   * @returns Resultado de la función
   * @throws Error si el circuito está abierto o la función falla
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Verificar si debemos transicionar de OPEN a HALF_OPEN
    if (this.state === CircuitState.OPEN) {
      const elapsed = Date.now() - this.lastStateChangeTime;
      if (elapsed >= this.options.resetTimeout) {
        this.transitionTo(CircuitState.HALF_OPEN);
      } else {
        const remainingSeconds = Math.ceil(
          (this.options.resetTimeout - elapsed) / 1000,
        );
        throw new Error(
          `Circuit breaker [${this.options.name}] is OPEN. ` +
            `BioStar no disponible. Reintento en ${remainingSeconds}s.`,
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error as Error);
      throw error;
    }
  }

  /**
   * Registra un éxito y resetea el contador de fallos.
   * Si estábamos en HALF_OPEN, el éxito cierra el circuito.
   */
  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.logger.log(
        `✅ Circuit breaker [${this.options.name}]: BioStar recuperado. Cerrando circuito.`,
      );
      this.logCircuitEvent(
        'circuit_breaker.closed',
        'BioStar recuperado, circuito cerrado',
      );
    }
    this.failureCount = 0;
    this.transitionTo(CircuitState.CLOSED);
  }

  /**
   * Registra un fallo y evalúa si debe abrir el circuito.
   *
   * Lógica: Si acumulamos {failureThreshold} fallos dentro de una
   * ventana de {failureWindow} ms, el circuito se abre.
   */
  private onFailure(error: Error): void {
    const now = Date.now();

    // Si el último fallo fue fuera de la ventana, resetear el contador
    if (now - this.lastFailureTime > this.options.failureWindow) {
      this.failureCount = 0;
    }

    this.failureCount++;
    this.lastFailureTime = now;

    this.logger.warn(
      `⚠️ Circuit breaker [${this.options.name}]: Fallo ${this.failureCount}/${this.options.failureThreshold}. ` +
        `Error: ${error.message}`,
    );

    // Si excedemos el umbral, abrir el circuito
    if (this.failureCount >= this.options.failureThreshold) {
      this.transitionTo(CircuitState.OPEN);
      this.logger.error(
        `🔴 Circuit breaker [${this.options.name}]: CIRCUITO ABIERTO. ` +
          `BioStar no disponible. Reintentando en ${this.options.resetTimeout / 1000}s.`,
      );
      this.logCircuitEvent(
        'circuit_breaker.opened',
        `Circuito abierto tras ${this.failureCount} fallos: ${error.message}`,
      );
    }
  }

  /**
   * Transiciona el circuito a un nuevo estado.
   */
  private transitionTo(state: CircuitState): void {
    if (this.state !== state) {
      this.state = state;
      this.lastStateChangeTime = Date.now();
    }
  }

  /**
   * Registra evento del circuit breaker en el logger estructurado.
   */
  private logCircuitEvent(action: string, detail: string): void {
    if (this.structuredLogger) {
      this.structuredLogger.log({
        category: LogCategory.OPERATIONAL,
        action,
        details: {
          circuitName: this.options.name,
          state: this.state,
          failureCount: this.failureCount,
          detail,
        },
      });
    }
  }

  /**
   * Obtiene el estado actual del circuito.
   * Útil para el health check y el dashboard.
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Obtiene métricas del Circuit Breaker.
   */
  getMetrics(): {
    name: string;
    state: CircuitState;
    failureCount: number;
    lastFailureTime: number;
    lastStateChangeTime: number;
  } {
    return {
      name: this.options.name,
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      lastStateChangeTime: this.lastStateChangeTime,
    };
  }
}

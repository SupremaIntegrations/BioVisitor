/**
 * @file jwt.strategy.ts
 * @description Estrategia de Passport para validar tokens JWT.
 *
 * Se utiliza automáticamente por el decorador @UseGuards(AuthGuard('jwt'))
 * extraído del Header "Authorization: Bearer <token>".
 *
 * @module modules/auth/strategies
 */

import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService, JwtPayload } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      // Extrae el JWT del header Authorization (Bearer token)
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // Rechaza peticiones con token expirado
      ignoreExpiration: false,
      // La clave secreta para verificar la firma
      secretOrKey: configService.get<string>('jwt.secret') || 'default-secret',
    });
  }

  /**
   * Valida el payload decodificado del JWT.
   * Si esta función se ejecuta, significa que la firma es válida y no ha expirado.
   * Usamos el servicio de Auth para asegurar que el usuario sigue activo en la BD.
   *
   * @param payload Payload contenido en el JWT
   * @returns Datos del usuario que se inyectarán en req.user
   */
  async validate(payload: JwtPayload): Promise<JwtPayload> {
    // Validar contra la BD que el usuario sigue activo (ej: no fue dado de baja después de emitir el JWT)
    return this.authService.validateJwtPayload(payload);
  }
}

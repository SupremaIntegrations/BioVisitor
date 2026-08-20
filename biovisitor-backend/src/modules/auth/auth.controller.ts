/**
 * @file auth.controller.ts
 * @description Controlador REST para la autenticación de usuarios VMS.
 * Expone endpoints para inicio de sesión y obtención del perfil actual.
 */

import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { IsString, IsEmail, MinLength } from 'class-validator';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';

class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}

class SetupDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @MinLength(8)
  confirmPassword: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Endpoint de inicio de sesión.
   * Recibe email y password, y retorna un JWT y los datos públicos del usuario.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto, @Req() req: any) {
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'];

    return this.authService.login(
      loginDto.email,
      loginDto.password,
      ipAddress,
      userAgent,
    );
  }

  /**
   * Solicita el restablecimiento de contraseña.
   * Siempre devuelve 200 para no revelar si el email existe.
   */
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: any) {
    const frontendUrl =
      this.configService.get<string>('app.frontendUrl') ||
      `${req.protocol}://${req.get('host')}`;
    await this.authService.forgotPassword(dto.email, frontendUrl);
    return { message: 'Si el correo está registrado, recibirás las instrucciones en breve.' };
  }

  /**
   * Completa el restablecimiento de contraseña con el token recibido por email.
   */
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return { message: 'Contraseña actualizada exitosamente. Ya puedes iniciar sesión.' };
  }

  /**
   * Obtiene la información del perfil del usuario logueado actualmente.
   */
  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  getProfile(@Req() req: any) {
    return req.user;
  }

  /**
   * Cambia la contraseña del usuario autenticado.
   * Requiere verificar la contraseña actual.
   */
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt'))
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: any) {
    return this.authService.changePassword(req.user.sub, dto.currentPassword, dto.newPassword);
  }

  /**
   * Verifica si el sistema necesita configuración inicial.
   * Endpoint público — no requiere JWT.
   * Retorna { needsSetup: true } si no existe ningún ADMIN en la base de datos.
   */
  @Get('system-status')
  @HttpCode(HttpStatus.OK)
  async systemStatus() {
    return this.authService.checkSystemStatus();
  }

  /**
   * Configura el administrador inicial del sistema.
   * Endpoint público — solo funciona cuando no existe ningún ADMIN.
   * Una vez creado el admin, responde 409 en cualquier intento posterior.
   */
  @Post('setup')
  @HttpCode(HttpStatus.CREATED)
  async setup(@Body() dto: SetupDto) {
    return this.authService.systemSetup(dto.name, dto.email, dto.password, dto.confirmPassword);
  }
}

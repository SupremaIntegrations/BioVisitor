/**
 * @file suprema-connections.controller.ts
 * @description Controlador REST para gestión de conexiones a la API de Suprema BioStar.
 *
 * Todos los endpoints están protegidos por JWT (JwtAuthGuard) y
 * requieren rol ADMIN (RolesGuard). Las credenciales nunca se retornan
 * en las respuestas.
 *
 * Rutas:
 *   GET    /api/v1/settings/suprema-connections         → Listar conexiones
 *   GET    /api/v1/settings/suprema-connections/:id     → Obtener una conexión
 *   POST   /api/v1/settings/suprema-connections         → Crear conexión
 *   PATCH  /api/v1/settings/suprema-connections/:id     → Actualizar conexión
 *   DELETE /api/v1/settings/suprema-connections/:id     → Eliminar conexión
 *   POST   /api/v1/settings/suprema-connections/:id/test → Probar conexión
 *
 * @module modules/settings
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../database/entities';
import { SupremaConnectionsService } from './suprema-connections.service';
import { CreateSupremaConnectionDto } from './dto/create-suprema-connection.dto';
import { UpdateSupremaConnectionDto } from './dto/update-suprema-connection.dto';

@Controller('settings/suprema-connections')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class SupremaConnectionsController {
  constructor(
    private readonly connectionsService: SupremaConnectionsService,
  ) {}

  /**
   * Lista todas las conexiones configuradas.
   * Las credenciales NO se incluyen en la respuesta.
   *
   * @param tenantId - Filtro opcional por tenant ID
   */
  @Get()
  async findAll(@Query('tenantId') tenantId?: string) {
    return this.connectionsService.findAll(tenantId);
  }

  /**
   * Obtiene el detalle de una conexión por ID.
   * Las credenciales NO se incluyen en la respuesta.
   */
  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.connectionsService.findOne(id);
  }

  /**
   * Crea una nueva conexión a BioStar.
   * Las credenciales se cifran con AES-256-GCM antes de persistir.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateSupremaConnectionDto,
    @Request() req: any,
  ) {
    if (!dto.tenantId && req.user?.tenantId) {
      dto.tenantId = req.user.tenantId;
    }
    return this.connectionsService.create(dto, req.user?.id || 'system');
  }

  /**
   * Actualiza una conexión existente.
   * Si se proveen nuevas credenciales, se re-cifran automáticamente.
   */
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupremaConnectionDto,
    @Request() req: any,
  ) {
    return this.connectionsService.update(id, dto, req.user?.id || 'system');
  }

  /**
   * Elimina una conexión de forma permanente.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    await this.connectionsService.remove(id, req.user?.id || 'system');
  }

  /**
   * Prueba la conexión en tiempo real contra el servidor BioStar.
   *
   * El backend descifra las credenciales en memoria, intenta autenticación,
   * verifica el servidor y retorna el resultado detallado.
   * Las credenciales descifradas NUNCA se incluyen en la respuesta.
   */
  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  async testConnection(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.connectionsService.testConnection(id, req.user?.id || 'system');
  }
}

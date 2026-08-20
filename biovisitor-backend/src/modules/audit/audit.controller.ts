import {
  Controller,
  Get,
  Query,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AuditService, AuditLogsQuery } from './audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * GET /api/v1/audit/logs
   * Recupera los registros de auditoría con filtros y paginación.
   * Solo accesible para ADMIN.
   */
  @Get('logs')
  @Roles('admin')
  async getLogs(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('category') category?: string,
    @Query('action') action?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
        throw new HttpException(
          'startDate no puede ser posterior a endDate',
          HttpStatus.BAD_REQUEST,
        );
      }

      const query: AuditLogsQuery = {
        startDate,
        endDate,
        category,
        action,
        search,
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : 50,
      };

      return await this.auditService.findAll(query);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        'Error al obtener el registro de auditoría',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * GET /api/v1/audit/event-types
   * Devuelve los tipos de eventos distintos (para el filtro de la UI).
   */
  @Get('event-types')
  @Roles('admin')
  async getEventTypes() {
    try {
      return await this.auditService.getEventTypes();
    } catch {
      throw new HttpException('Error al obtener tipos de evento', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * GET /api/v1/audit/actors
   * Devuelve los actores distintos (para el filtro de la UI).
   */
  @Get('actors')
  @Roles('admin')
  async getActors() {
    try {
      return await this.auditService.getActors();
    } catch {
      throw new HttpException('Error al obtener actores', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}

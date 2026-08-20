/**
 * @file access-groups.controller.ts
 * @description Endpoint para consultar los Grupos de Acceso configurados en BioStar.
 *
 * Expone GET /api/v1/access-groups que retorna la lista de grupos de acceso
 * disponibles para el tenant del operador autenticado.
 *
 * Los datos se obtienen directamente de BioStar y se cachean en Redis (1 h).
 *
 * @module modules/visitors
 */

import {
  Controller,
  Get,
  UseGuards,
  Req,
  InternalServerErrorException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SupremaSyncService, BioStarAccessGroup } from './suprema-sync.service';

@Controller('access-groups')
@UseGuards(AuthGuard('jwt'))
export class AccessGroupsController {
  constructor(private readonly supremaSyncService: SupremaSyncService) {}

  /**
   * Retorna la lista de Grupos de Acceso de BioStar disponibles para el tenant.
   *
   * GET /api/v1/access-groups
   *
   * Respuesta: [{ id: number, name: string }, ...]
   * - 200: Lista de grupos (puede estar vacía si no hay conexión BioStar)
   * - 500: Error al conectar con BioStar
   */
  @Get()
  async getAccessGroups(@Req() req: any): Promise<BioStarAccessGroup[]> {
    const tenantId: string = req.user?.tenantId;
    try {
      return await this.supremaSyncService.getAccessGroups(tenantId);
    } catch (error: any) {
      throw new InternalServerErrorException(
        error.message || 'Error al obtener los grupos de acceso de BioStar',
      );
    }
  }
}

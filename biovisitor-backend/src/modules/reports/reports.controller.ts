import {
  Controller,
  Get,
  Query,
  Req,
  Res,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { StructuredLoggerService, LogCategory } from '../../core/logging/structured-logger.service';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly structuredLogger: StructuredLoggerService,
  ) {}

  /**
   * Devuelve el resumen de métricas para el dashboard principal (SOC view).
   */
  @Get('dashboard')
  @Roles('admin', 'operator')
  async getDashboardStats(@Query('range') range?: string, @Query('tz') tz?: string, @Query('month') month?: string) {
    const validRange = ['today', '7d', 'month', 'year'].includes(range ?? '') ? (range as 'today' | '7d' | 'month' | 'year') : 'today';
    const tzOffset = tz !== undefined && !isNaN(parseInt(tz, 10)) ? parseInt(tz, 10) : 0;
    return this.reportsService.getDashboardStats(validRange, tzOffset, month);
  }

  /**
   * Devuelve los datos de visitas como JSON (KPIs + filas) para la tabla en la UI.
   */
  @Get('visits')
  @Roles('admin', 'operator')
  async getVisitsData(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('status') status?: string,
    @Query('accessMethod') accessMethod?: string,
  ) {
    try {
      const start = startDate
        ? new Date(startDate)
        : new Date(new Date().setMonth(new Date().getMonth() - 1));
      const end = endDate ? new Date(endDate) : new Date();

      return await this.reportsService.getVisitsData(start, end, status, accessMethod);
    } catch (error) {
      throw new HttpException(
        'Error al obtener los datos del reporte',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('visits/csv')
  @Roles('admin', 'operator')
  async exportVisitsCsv(
    @Req() req: any,
    @Res() res: Response,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    try {
      const start = startDate
        ? new Date(startDate)
        : new Date(new Date().setMonth(new Date().getMonth() - 1));
      const end = endDate ? new Date(endDate) : new Date();

      const csvBuffer = await this.reportsService.generateVisitsCsvReport(start, end);
      const filename = `visitas_${start.toISOString().split('T')[0]}_${end.toISOString().split('T')[0]}.csv`;

      this.structuredLogger.log({
        category: LogCategory.AUDIT_EVENT,
        action: 'report.export_csv',
        userId: req.user?.sub ?? req.user?.id ?? 'unknown',
        userName: req.user?.email ?? req.user?.fullName,
        tenantId: req.user?.tenantId,
        ipAddress: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip,
        userAgent: req.headers['user-agent'],
        details: {
          format: 'CSV',
          filename,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          rowsApprox: csvBuffer.length,
        },
      });

      res.set({
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      });
      res.send(csvBuffer);
    } catch (error) {
      throw new HttpException('Error al generar el reporte CSV', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('visits/pdf')
  @Roles('admin', 'operator')
  async exportVisitsPdf(
    @Req() req: any,
    @Res() res: Response,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('columns') columns?: string,
  ) {
    try {
      const start = startDate
        ? new Date(startDate)
        : new Date(new Date().setMonth(new Date().getMonth() - 1));
      const end = endDate ? new Date(endDate) : new Date();

      const selectedCols = columns ? columns.split(',').map((c) => c.trim()).filter(Boolean) : undefined;
      const pdfBuffer = await this.reportsService.generateVisitsPdfReport(start, end, selectedCols);
      const filename = `visitas_${start.toISOString().split('T')[0]}_${end.toISOString().split('T')[0]}.pdf`;

      this.structuredLogger.log({
        category: LogCategory.AUDIT_EVENT,
        action: 'report.export_pdf',
        userId: req.user?.sub ?? req.user?.id ?? 'unknown',
        userName: req.user?.email ?? req.user?.fullName,
        tenantId: req.user?.tenantId,
        ipAddress: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip,
        userAgent: req.headers['user-agent'],
        details: {
          format: 'PDF',
          filename,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          bytes: pdfBuffer.length,
        },
      });

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': pdfBuffer.length,
      });
      res.send(pdfBuffer);
    } catch (error) {
      throw new HttpException('Error al generar el reporte PDF', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThan } from 'typeorm';
import { Visit, VisitStatus, AccessMethod, VisitorType } from '../../database/entities/visit.entity';
import { createObjectCsvStringifier } from 'csv-writer';
import PDFDocument from 'pdfkit';

export interface VisitReportRow {
  id: string;
  visitorName: string;
  visitorDocument: string;
  visitorCompany: string;
  visitorEmail: string;
  hostName: string;
  purpose: string;
  serviceOrder: string;
  accessMethod: string;
  status: string;
  scheduledAt: string;
  expectedEndAt: string;
  checkedInAt: string;
  checkedOutAt: string;
  durationMinutes: number | null;
}

export interface VisitsReportData {
  kpis: {
    total: number;
    scheduled: number;
    preRegistered: number;
    checkedIn: number;
    checkedOut: number;
    noShow: number;
    cancelled: number;
    avgDurationMinutes: number | null;
  };
  rows: VisitReportRow[];
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @InjectRepository(Visit)
    private readonly visitRepository: Repository<Visit>,
  ) {}

  private resolveHostName(v: Visit): string {
    return v.host?.fullName ?? v.hostUser?.fullName ?? 'N/A';
  }

  private durationMins(v: Visit): number | null {
    if (v.checkedInAt && v.checkedOutAt) {
      return Math.round(
        (v.checkedOutAt.getTime() - v.checkedInAt.getTime()) / 60000,
      );
    }
    return null;
  }

  private fmtDate(d: Date | null | undefined): string {
    if (!d) return '';
    return d.toLocaleString('es-ES', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  }

  private statusLabel(s: VisitStatus): string {
    const map: Record<VisitStatus, string> = {
      [VisitStatus.SCHEDULED]: 'Programada',
      [VisitStatus.PRE_REGISTERED]: 'Pre-registrada',
      [VisitStatus.CHECKED_IN]: 'En instalaciones',
      [VisitStatus.CHECKED_OUT]: 'Salió',
      [VisitStatus.CANCELLED]: 'Cancelada',
      [VisitStatus.NO_SHOW]: 'No se presentó',
      [VisitStatus.FALSE_EXIT_REPORTED]: 'Falsa salida reportada',
    };
    return map[s] ?? s;
  }

  private accessLabel(a: AccessMethod): string {
    const map: Record<AccessMethod, string> = {
      [AccessMethod.FACE]: 'Reconocimiento facial',
      [AccessMethod.FINGERPRINT]: 'Huella dactilar',
      [AccessMethod.RFID]: 'Tarjeta RFID',
      [AccessMethod.QR_DYNAMIC]: 'QR Dinámico',
      [AccessMethod.MANUAL]: 'Manual',
    };
    return map[a] ?? a;
  }

  private async fetchVisits(startDate: Date, endDate: Date): Promise<Visit[]> {
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    return this.visitRepository.find({
      where: { scheduledAt: Between(startDate, end) },
      relations: ['visitor', 'hostUser', 'host'],
      order: { scheduledAt: 'DESC' },
    });
  }

  async getVisitsData(
    startDate: Date,
    endDate: Date,
    status?: string,
    accessMethod?: string,
  ): Promise<VisitsReportData> {
    const all = await this.fetchVisits(startDate, endDate);

    const filtered = all.filter((v) => {
      if (status && status !== 'ALL' && v.status !== status) return false;
      if (accessMethod && accessMethod !== 'ALL' && v.accessMethod !== accessMethod) return false;
      return true;
    });

    const durations = filtered
      .map((v) => this.durationMins(v))
      .filter((d): d is number => d !== null);
    const avgDuration =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null;

    const count = (s: VisitStatus) => filtered.filter((v) => v.status === s).length;

    return {
      kpis: {
        total: filtered.length,
        scheduled: count(VisitStatus.SCHEDULED),
        preRegistered: count(VisitStatus.PRE_REGISTERED),
        checkedIn: count(VisitStatus.CHECKED_IN),
        checkedOut: count(VisitStatus.CHECKED_OUT),
        noShow: count(VisitStatus.NO_SHOW),
        cancelled: count(VisitStatus.CANCELLED),
        avgDurationMinutes: avgDuration,
      },
      rows: filtered.map((v) => ({
        id: v.id,
        visitorName: `${v.visitor?.firstName ?? ''} ${v.visitor?.lastName ?? ''}`.trim(),
        visitorDocument: v.visitor?.documentNumber ?? '',
        visitorCompany: v.visitor?.company ?? '',
        visitorEmail: v.visitor?.email ?? '',
        hostName: this.resolveHostName(v),
        purpose: v.purpose ?? '',
        serviceOrder: v.visitorType === VisitorType.CONTRACTOR ? (v.serviceOrder ?? '') : '',
        accessMethod: this.accessLabel(v.accessMethod),
        status: this.statusLabel(v.status),
        scheduledAt: v.scheduledAt?.toISOString() ?? '',
        expectedEndAt: v.expectedEndAt?.toISOString() ?? '',
        checkedInAt: v.checkedInAt?.toISOString() ?? '',
        checkedOutAt: v.checkedOutAt?.toISOString() ?? '',
        durationMinutes: this.durationMins(v),
      })),
    };
  }

  async generateVisitsCsvReport(
    startDate: Date,
    endDate: Date,
  ): Promise<Buffer> {
    this.logger.log(`Generando CSV entre ${startDate.toISOString()} y ${endDate.toISOString()}`);
    const visits = await this.fetchVisits(startDate, endDate);

    const csvStringifier = createObjectCsvStringifier({
      header: [
        { id: 'id', title: 'ID' },
        { id: 'visitorName', title: 'VISITANTE' },
        { id: 'visitorDocument', title: 'DOCUMENTO' },
        { id: 'visitorCompany', title: 'EMPRESA' },
        { id: 'visitorEmail', title: 'EMAIL VISITANTE' },
        { id: 'hostName', title: 'ANFITRIÓN' },
        { id: 'purpose', title: 'PROPÓSITO' },
        { id: 'serviceOrder', title: 'ORDEN DE SERVICIO' },
        { id: 'accessMethod', title: 'MÉTODO ACCESO' },
        { id: 'status', title: 'ESTADO' },
        { id: 'scheduledAt', title: 'INICIO VIGENCIA' },
        { id: 'expectedEndAt', title: 'FIN VIGENCIA' },
        { id: 'checkInAt', title: 'ENTRADA REAL' },
        { id: 'checkOutAt', title: 'SALIDA REAL' },
        { id: 'durationMinutes', title: 'DURACIÓN (min)' },
      ],
    });

    const records = visits.map((v) => ({
      id: v.id,
      visitorName: `${v.visitor?.firstName ?? ''} ${v.visitor?.lastName ?? ''}`.trim(),
      visitorDocument: v.visitor?.documentNumber ?? '',
      visitorCompany: v.visitor?.company ?? '',
      visitorEmail: v.visitor?.email ?? '',
      hostName: this.resolveHostName(v),
      purpose: v.purpose ?? '',
      serviceOrder: v.visitorType === VisitorType.CONTRACTOR ? (v.serviceOrder ?? '') : '',
      accessMethod: this.accessLabel(v.accessMethod),
      status: this.statusLabel(v.status),
      scheduledAt: v.scheduledAt ? this.fmtDate(v.scheduledAt) : '',
      expectedEndAt: v.expectedEndAt ? this.fmtDate(v.expectedEndAt) : '',
      checkInAt: v.checkedInAt ? this.fmtDate(v.checkedInAt) : '',
      checkOutAt: v.checkedOutAt ? this.fmtDate(v.checkedOutAt) : '',
      durationMinutes: this.durationMins(v) ?? '',
    }));

    const csvContent = '\uFEFF' + csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(records);
    return Buffer.from(csvContent, 'utf-8');
  }

  async generateVisitsPdfReport(
    startDate: Date,
    endDate: Date,
    selectedColKeys?: string[],
  ): Promise<Buffer> {
    this.logger.log(`Generando PDF entre ${startDate.toISOString()} y ${endDate.toISOString()}`);
    const visits = await this.fetchVisits(startDate, endDate);

    // ── Column definitions ────────────────────────────────────────
    const COL_DEFS: Record<string, { label: string; weight: number; getter: (v: Visit) => string }> = {
      visitorName:     { label: 'Visitante',       weight: 15, getter: (v) => `${v.visitor?.firstName ?? ''} ${v.visitor?.lastName ?? ''}`.trim() },
      visitorDocument: { label: 'Documento',       weight: 10, getter: (v) => v.visitor?.documentNumber ?? '' },
      visitorCompany:  { label: 'Empresa',         weight: 12, getter: (v) => v.visitor?.company ?? '' },
      visitorEmail:    { label: 'Email',           weight: 13, getter: (v) => v.visitor?.email ?? '' },
      hostName:        { label: 'Anfitrión',       weight: 12, getter: (v) => this.resolveHostName(v) },
      purpose:         { label: 'Propósito',       weight: 11, getter: (v) => v.purpose ?? '' },
      serviceOrder:    { label: 'Orden Servicio',  weight: 11, getter: (v) => v.serviceOrder ?? '' },
      accessMethod:    { label: 'Método',          weight:  9, getter: (v) => this.accessLabel(v.accessMethod) },
      status:          { label: 'Estado',          weight:  9, getter: (v) => this.statusLabel(v.status) },
      scheduledAt:     { label: 'Inicio Vigencia', weight: 12, getter: (v) => v.scheduledAt ? this.fmtDate(v.scheduledAt) : '' },
      expectedEndAt:   { label: 'Fin Vigencia',    weight: 12, getter: (v) => v.expectedEndAt ? this.fmtDate(v.expectedEndAt) : '' },
      checkedInAt:     { label: 'Entrada',         weight: 11, getter: (v) => v.checkedInAt ? this.fmtDate(v.checkedInAt) : '' },
      checkedOutAt:    { label: 'Salida',          weight: 11, getter: (v) => v.checkedOutAt ? this.fmtDate(v.checkedOutAt) : '' },
      durationMinutes: { label: 'Duración (min)',  weight:  8, getter: (v) => this.durationMins(v) != null ? `${this.durationMins(v)} min` : '' },
    };

    const DEFAULT_KEYS = ['visitorName', 'visitorCompany', 'hostName', 'accessMethod', 'status', 'scheduledAt', 'expectedEndAt', 'checkedInAt', 'checkedOutAt'];
    const keys = (selectedColKeys && selectedColKeys.length > 0)
      ? selectedColKeys.filter((k) => COL_DEFS[k])
      : DEFAULT_KEYS;

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
        const buffers: Buffer[] = [];

        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        const W = doc.page.width - 80;
        const red = '#A11A36';

        // ─── Header ───────────────────────────────────────────────
        doc.rect(40, 40, W, 36).fill(red);
        doc.fillColor('#ffffff').fontSize(14).font('Helvetica-Bold')
          .text('BioVisitor X — Reporte de Visitas', 55, 51, { width: W - 200 });
        doc.fontSize(10).font('Helvetica')
          .text(`${this.fmtDate(startDate)} → ${this.fmtDate(endDate)}`, W - 110, 55, { width: 160, align: 'right' });

        // ─── KPIs ──────────────────────────────────────────────────
        const kpiY = 90;
        const counts = {
          Total: visits.length,
          'En instalaciones': visits.filter((v) => v.status === VisitStatus.CHECKED_IN).length,
          'Salieron': visits.filter((v) => v.status === VisitStatus.CHECKED_OUT).length,
          'No se presentaron': visits.filter((v) => v.status === VisitStatus.NO_SHOW).length,
        };
        const kpiW = W / Object.keys(counts).length;
        Object.entries(counts).forEach(([label, val], i) => {
          const x = 40 + i * kpiW;
          doc.rect(x, kpiY, kpiW - 4, 38).fill('#f8f8f8').stroke('#e0e0e0');
          doc.fillColor(red).fontSize(18).font('Helvetica-Bold')
            .text(String(val), x + 6, kpiY + 4, { width: kpiW - 12, align: 'center' });
          doc.fillColor('#555').fontSize(8).font('Helvetica')
            .text(label, x + 6, kpiY + 24, { width: kpiW - 12, align: 'center' });
        });

        // ─── Build dynamic column widths ──────────────────────────
        const totalWeight = keys.reduce((sum, k) => sum + COL_DEFS[k].weight, 0);
        const cols = keys.map((k) => ({
          label: COL_DEFS[k].label,
          w: Math.floor((COL_DEFS[k].weight / totalWeight) * W),
          getter: COL_DEFS[k].getter,
        }));

        // ─── Table ─────────────────────────────────────────────────
        let tableX = 40;
        let tableY = kpiY + 52;
        const rowH = 18;

        // Table header
        doc.rect(tableX, tableY, W, rowH).fill('#2d2d2d');
        let cx = tableX;
        cols.forEach((col) => {
          doc.fillColor('#ffffff').fontSize(7).font('Helvetica-Bold')
            .text(col.label, cx + 3, tableY + 5, { width: col.w - 6, ellipsis: true });
          cx += col.w;
        });
        tableY += rowH;

        // Table rows
        visits.forEach((v, i) => {
          if (tableY > doc.page.height - 60) {
            doc.addPage({ layout: 'landscape' });
            tableY = 40;
          }

          const bg = i % 2 === 0 ? '#ffffff' : '#f5f5f5';
          doc.rect(tableX, tableY, W, rowH).fill(bg).stroke('#e8e8e8');

          cx = tableX;
          cols.forEach((col) => {
            const cell = col.getter(v);
            doc.fillColor('#333').fontSize(7).font('Helvetica')
              .text(cell, cx + 3, tableY + 5, { width: col.w - 6, ellipsis: true });
            cx += col.w;
          });
          tableY += rowH;
        });

        // Footer
        doc.fillColor('#999').fontSize(8)
          .text(`Generado el ${new Date().toLocaleString('es-ES')} — BioVisitor X`, 40, doc.page.height - 30, { align: 'center', width: W });

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // ─── Dashboard Stats ────────────────────────────────────────────────────────

  async getDashboardStats(range: 'today' | '7d' | 'month' | 'year' = 'today', tzOffset = 0, month?: string) {
    const now = new Date();

    // ── Helpers de zona horaria ──
    // tzOffset = minutos que getTimezoneOffset() devuelve (positivo para zonas al oeste de UTC)
    // Colombia UTC-5 → tzOffset = 300 → localTime = utcTime - 300 min
    const offsetMs = tzOffset * 60_000;

    /** Convierte un Date UTC a su equivalente "local" (para operar con setUTCHours) */
    const toLocal = (d: Date) => new Date(d.getTime() - offsetMs);
    /** Convierte un Date "local" de vuelta a UTC real */
    const toUTC   = (d: Date) => new Date(d.getTime() + offsetMs);

    // ── Today boundaries en hora LOCAL del cliente ──
    const localNow = toLocal(now);
    const localTodayStart = new Date(localNow); localTodayStart.setUTCHours(0, 0, 0, 0);
    const localTodayEnd   = new Date(localNow); localTodayEnd.setUTCHours(23, 59, 59, 999);
    const todayStart = toUTC(localTodayStart);
    const todayEnd   = toUTC(localTodayEnd);

    // ── Range boundaries for chart ──
    let chartStart: Date;
    let chartEnd: Date = todayEnd;
    if (range === '7d') {
      const localChartStart = new Date(localNow);
      localChartStart.setUTCDate(localChartStart.getUTCDate() - 6);
      localChartStart.setUTCHours(0, 0, 0, 0);
      chartStart = toUTC(localChartStart);
    } else if (range === 'month') {
      if (month && /^\d{4}-\d{2}$/.test(month)) {
        const [yr, mo] = month.split('-').map(Number);
        const localMonthStart = new Date(Date.UTC(yr, mo - 1, 1, 0, 0, 0, 0));
        chartStart = toUTC(localMonthStart);
        const daysInMonth = new Date(Date.UTC(yr, mo, 0)).getUTCDate();
        const localMonthEnd = new Date(Date.UTC(yr, mo - 1, daysInMonth, 23, 59, 59, 999));
        chartEnd = toUTC(localMonthEnd);
      } else {
        const localChartStart = new Date(localNow);
        localChartStart.setUTCDate(1);
        localChartStart.setUTCHours(0, 0, 0, 0);
        chartStart = toUTC(localChartStart);
      }
    } else if (range === 'year') {
      const localYearStart = new Date(localNow);
      localYearStart.setUTCMonth(0, 1);
      localYearStart.setUTCHours(0, 0, 0, 0);
      chartStart = toUTC(localYearStart);
      const localYearEnd = new Date(localNow);
      localYearEnd.setUTCMonth(11, 31);
      localYearEnd.setUTCHours(23, 59, 59, 999);
      chartEnd = toUTC(localYearEnd);
    } else {
      chartStart = todayStart;
    }

    // ── In-building (all tenants) ──
    const inBuildingVisits = await this.visitRepository.find({
      where: { status: VisitStatus.CHECKED_IN },
      relations: ['visitor', 'hostUser', 'host'],
      order: { checkedInAt: 'DESC' },
      take: 200,
    });
    const inBuilding = inBuildingVisits.length;

    // ── Overstay: checked-in past expectedEndAt ──
    const overstayVisits = inBuildingVisits.filter(
      (v) => v.expectedEndAt && v.expectedEndAt < now,
    );
    const overstayCount = overstayVisits.length;

    // ── Today's visits ──
    const todayVisits = await this.visitRepository.find({
      where: { scheduledAt: Between(todayStart, todayEnd) },
      relations: ['visitor', 'hostUser', 'host'],
    });
    const totalToday = todayVisits.length;

    // ── Pre-registration rate (QR_DYNAMIC) ──
    const preRegCount = todayVisits.filter((v) => v.accessMethod === AccessMethod.QR_DYNAMIC).length;
    const preRegRate  = totalToday > 0 ? Math.round((preRegCount / totalToday) * 100) : 0;

    // ── Sync health ──
    const [synced, pending, failed] = await Promise.all([
      this.visitRepository.count({ where: { syncStatus: 'SYNCED' } }),
      this.visitRepository.count({ where: { syncStatus: 'PENDING' } }),
      this.visitRepository.count({ where: { syncStatus: 'FAILED' } }),
    ]);

    // ── Chart visits ──
    const chartVisits = await this.visitRepository.find({
      where: { scheduledAt: Between(chartStart, chartEnd) },
    });

    // ── Hourly or daily aggregation (en hora local del cliente) ──
    let chartData: { label: string; count: number }[] = [];
    if (range === 'today') {
      const hourMap: Record<number, number> = {};
      for (let h = 0; h < 24; h++) hourMap[h] = 0;
      chartVisits.forEach((v) => {
        const localHour = toLocal(new Date(v.scheduledAt)).getUTCHours();
        hourMap[localHour]++;
      });
      chartData = Array.from({ length: 24 }, (_, h) => ({
        label: `${String(h).padStart(2, '0')}h`,
        count: hourMap[h],
      }));
    } else if (range === 'year') {
      const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
      const monthMap: Record<number, number> = {};
      for (let m = 0; m < 12; m++) monthMap[m] = 0;
      chartVisits.forEach((v) => {
        const localMonth = toLocal(new Date(v.scheduledAt)).getUTCMonth();
        monthMap[localMonth]++;
      });
      chartData = monthNames.map((label, i) => ({ label, count: monthMap[i] }));
    } else {
      // 7d or month (including specific past month)
      const localNowForMonth = toLocal(now);
      let days: number;
      if (range === '7d') {
        days = 7;
      } else if (month && /^\d{4}-\d{2}$/.test(month)) {
        const [yr, mo] = month.split('-').map(Number);
        days = new Date(Date.UTC(yr, mo, 0)).getUTCDate();
      } else {
        days = new Date(localNowForMonth.getUTCFullYear(), localNowForMonth.getUTCMonth() + 1, 0).getUTCDate();
      }
      const dayMap: Record<string, number> = {};
      for (let i = 0; i < days; i++) {
        const d = new Date(chartStart); d.setUTCDate(d.getUTCDate() + i);
        const localD = toLocal(d);
        const key = localD.toISOString().split('T')[0];
        dayMap[key] = 0;
      }
      chartVisits.forEach((v) => {
        const key = toLocal(new Date(v.scheduledAt)).toISOString().split('T')[0];
        if (key in dayMap) dayMap[key]++;
      });
      const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
      chartData = Object.entries(dayMap).map(([date, count]) => {
        const d = new Date(date + 'T12:00:00Z');
        const label = range === '7d' ? dayNames[d.getUTCDay()] : String(d.getUTCDate());
        return { label, count };
      });
    }

    // ── Purpose distribution (today) ──
    const purposeMap: Record<string, number> = {};
    todayVisits.forEach((v) => {
      const p = v.purpose?.trim() || 'Sin especificar';
      purposeMap[p] = (purposeMap[p] || 0) + 1;
    });
    const purposeData = Object.entries(purposeMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // ── In-building list for evacuation modal ──
    const inBuildingList = inBuildingVisits.map((v) => ({
      id: v.id,
      visitorName: `${v.visitor?.firstName ?? ''} ${v.visitor?.lastName ?? ''}`.trim(),
      company: v.visitor?.company ?? '',
      hostName: v.host?.fullName ?? v.hostUser?.fullName ?? '',
      checkedInAt: v.checkedInAt?.toISOString() ?? '',
      expectedEndAt: v.expectedEndAt?.toISOString() ?? '',
      isOverstay: !!v.expectedEndAt && v.expectedEndAt < now,
      photoPath: v.visitor?.photoPath ?? null,
      visitorId: v.visitor?.id ?? '',
    }));

    // ── Last 5 arrivals (today) ──
    const recentArrivals = todayVisits
      .filter((v) => v.status === VisitStatus.CHECKED_IN || v.status === VisitStatus.SCHEDULED)
      .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())
      .slice(0, 6)
      .map((v) => ({
        id: v.id,
        visitorName: `${v.visitor?.firstName ?? ''} ${v.visitor?.lastName ?? ''}`.trim(),
        company: v.visitor?.company ?? '',
        hostName: v.host?.fullName ?? v.hostUser?.fullName ?? '',
        status: v.status,
        scheduledAt: v.scheduledAt?.toISOString() ?? '',
        checkedInAt: v.checkedInAt?.toISOString() ?? '',
        photoPath: v.visitor?.photoPath ?? null,
        visitorId: v.visitor?.id ?? '',
        visitorUpdatedAt: v.visitor?.updatedAt?.toISOString() ?? '',
      }));

    return {
      inBuilding,
      totalToday,
      overstayCount,
      preRegCount,
      preRegRate,
      syncCounts: { synced, pending, failed },
      biostarHealthy: failed === 0,
      chartData,
      purposeData,
      inBuildingList,
      recentArrivals,
    };
  }
}

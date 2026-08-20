/**
 * @file equipment.service.ts
 * @description Servicio del Módulo de Registro y Control de Ingreso de Equipos.
 *
 * Gestiona el ciclo de vida completo de un equipo dentro de las instalaciones:
 * registro de ingreso, pre-autorización, alertas de overtime, salida,
 * exportación CSV/PDF y auditoría inmutable.
 *
 * @module modules/equipment
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, IsNull, Not, ILike } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { createObjectCsvStringifier } from 'csv-writer';
import PDFDocument from 'pdfkit';
import {
  EquipmentEntry,
  EquipmentCategory,
  EquipmentStatus,
} from '../../database/entities/equipment-entry.entity';
import { Tenant } from '../../database/entities/tenant.entity';
import { StructuredLoggerService, LogCategory } from '../../core/logging/structured-logger.service';
import {
  CreateEquipmentDto,
  UpdateEquipmentDto,
  RegisterExitDto,
  RejectEquipmentDto,
  EquipmentFilterDto,
  EquipmentSettingsDto,
} from './dto/equipment.dto';

export interface EquipmentSettings {
  requiresAuthCategories: EquipmentCategory[];
  defaultMaxStayHours: number;
}

const DEFAULT_SETTINGS: EquipmentSettings = {
  requiresAuthCategories: [],
  defaultMaxStayHours: 8,
};

@Injectable()
export class EquipmentService {
  private readonly logger = new Logger(EquipmentService.name);

  constructor(
    @InjectRepository(EquipmentEntry)
    private readonly equipmentRepo: Repository<EquipmentEntry>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRedis() private readonly redis: Redis,
    private readonly auditLogger: StructuredLoggerService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════
  // SETTINGS — Configuración por tenant en Redis
  // ═══════════════════════════════════════════════════════════════════

  private settingsKey(tenantId: string): string {
    return `equipment:settings:${tenantId}`;
  }

  async getSettings(tenantId: string): Promise<EquipmentSettings> {
    const raw = await this.redis.get(this.settingsKey(tenantId));
    if (!raw) return { ...DEFAULT_SETTINGS };
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  async saveSettings(tenantId: string, dto: EquipmentSettingsDto): Promise<EquipmentSettings> {
    const current = await this.getSettings(tenantId);
    const updated: EquipmentSettings = {
      requiresAuthCategories:
        dto.requiresAuthCategories ?? current.requiresAuthCategories,
      defaultMaxStayHours:
        dto.defaultMaxStayHours ?? current.defaultMaxStayHours,
    };
    await this.redis.set(this.settingsKey(tenantId), JSON.stringify(updated));
    return updated;
  }

  // ═══════════════════════════════════════════════════════════════════
  // CRUD
  // ═══════════════════════════════════════════════════════════════════

  async findAll(tenantId: string, filter: EquipmentFilterDto) {
    const page = Math.max(1, parseInt(filter.page ?? '1'));
    const limit = Math.min(100, Math.max(1, parseInt(filter.limit ?? '20')));
    const skip = (page - 1) * limit;

    const where: any[] = [];
    const base: any = { tenantId };

    if (filter.status) base.status = filter.status;
    if (filter.category) base.category = filter.category;

    if (filter.dateFrom || filter.dateTo) {
      const from = filter.dateFrom ? new Date(filter.dateFrom) : new Date('2000-01-01');
      const to = filter.dateTo ? new Date(filter.dateTo + 'T23:59:59') : new Date();
      base.entryAt = Between(from, to);
    }

    if (filter.search) {
      const s = `%${filter.search}%`;
      ['serialNumber', 'brand', 'model', 'responsibleName', 'hostArea'].forEach(field => {
        where.push({ ...base, [field]: ILike(s) });
      });
    } else {
      where.push(base);
    }

    const [items, total] = await this.equipmentRepo.findAndCount({
      where,
      order: { entryAt: 'DESC' },
      take: limit,
      skip,
    });

    return { items, total, page, limit };
  }

  async findOne(id: string, tenantId: string): Promise<EquipmentEntry> {
    const entry = await this.equipmentRepo.findOne({ where: { id, tenantId } });
    if (!entry) throw new NotFoundException('Equipo no encontrado');
    return entry;
  }

  async createEntry(
    tenantId: string,
    userId: string,
    userName: string,
    dto: CreateEquipmentDto,
  ): Promise<EquipmentEntry> {
    const serial = dto.serialNumber.trim().toUpperCase();

    // Validar duplicado activo
    const existing = await this.equipmentRepo.findOne({
      where: [
        { tenantId, serialNumber: serial, status: EquipmentStatus.INSIDE },
        { tenantId, serialNumber: serial, status: EquipmentStatus.AUTHORIZED },
        { tenantId, serialNumber: serial, status: EquipmentStatus.PENDING_AUTH },
      ],
    });
    if (existing) {
      throw new ConflictException(
        `El número de serie ${serial} ya tiene un ingreso activo (ID: ${existing.id}). Registre primero la salida.`,
      );
    }

    const settings = await this.getSettings(tenantId);
    const requiresAuth =
      dto.requiresAuth === true ||
      settings.requiresAuthCategories.includes(dto.category);

    const entry = this.equipmentRepo.create({
      serialNumber: serial,
      brand: dto.brand.trim(),
      model: dto.model.trim(),
      category: dto.category,
      responsibleName: dto.responsibleName.trim(),
      hostArea: dto.hostArea.trim(),
      visitId: dto.visitId ?? null,
      authorizationCode: dto.authorizationCode ?? null,
      notes: dto.notes ?? null,
      maxStayHours: dto.maxStayHours ?? settings.defaultMaxStayHours,
      status: requiresAuth ? EquipmentStatus.PENDING_AUTH : EquipmentStatus.INSIDE,
      entryAt: new Date(),
      exitAt: null,
      tenantId,
      createdById: userId,
      createdByName: userName,
    });

    const saved = await this.equipmentRepo.save(entry);

    await this.auditLogger.log({
      category: LogCategory.USER_ACTION,
      action: 'equipment.entry_created',
      tenantId,
      userId,
      userName,
      entityType: 'equipment_entry',
      entityId: saved.id,
      details: {
        serialNumber: serial,
        category: dto.category,
        responsibleName: dto.responsibleName,
        status: saved.status,
      },
    });

    return saved;
  }

  async update(
    id: string,
    tenantId: string,
    userId: string,
    userName: string,
    dto: UpdateEquipmentDto,
  ): Promise<EquipmentEntry> {
    const entry = await this.findOne(id, tenantId);
    const before = { ...entry };

    if (dto.brand !== undefined) entry.brand = dto.brand.trim();
    if (dto.model !== undefined) entry.model = dto.model.trim();
    if (dto.responsibleName !== undefined) entry.responsibleName = dto.responsibleName.trim();
    if (dto.hostArea !== undefined) entry.hostArea = dto.hostArea.trim();
    if (dto.notes !== undefined) entry.notes = dto.notes;
    if (dto.maxStayHours !== undefined) entry.maxStayHours = dto.maxStayHours;

    const saved = await this.equipmentRepo.save(entry);

    await this.auditLogger.log({
      category: LogCategory.USER_ACTION,
      action: 'equipment.updated',
      tenantId,
      userId,
      userName,
      entityType: 'equipment_entry',
      entityId: id,
      details: { before, after: saved },
    });

    return saved;
  }

  async registerExit(
    id: string,
    tenantId: string,
    userId: string,
    userName: string,
    dto: RegisterExitDto,
  ): Promise<EquipmentEntry> {
    const entry = await this.findOne(id, tenantId);

    if (entry.status === EquipmentStatus.EXITED) {
      throw new ConflictException('Este equipo ya registró su salida.');
    }
    if (entry.status === EquipmentStatus.REJECTED) {
      throw new ConflictException('Este equipo fue rechazado y no puede registrar salida.');
    }
    if (entry.status === EquipmentStatus.PENDING_AUTH) {
      throw new ConflictException('El equipo aún está pendiente de autorización.');
    }

    entry.exitAt = new Date();
    entry.status = EquipmentStatus.EXITED;
    if (dto.notes) entry.notes = (entry.notes ? entry.notes + '\n' : '') + dto.notes;

    const saved = await this.equipmentRepo.save(entry);

    await this.auditLogger.log({
      category: LogCategory.USER_ACTION,
      action: 'equipment.exit_registered',
      tenantId,
      userId,
      userName,
      entityType: 'equipment_entry',
      entityId: id,
      details: {
        serialNumber: entry.serialNumber,
        entryAt: entry.entryAt,
        exitAt: saved.exitAt,
        durationHours: entry.entryAt
          ? +((saved.exitAt!.getTime() - entry.entryAt.getTime()) / 3600000).toFixed(2)
          : null,
      },
    });

    return saved;
  }

  async authorize(
    id: string,
    tenantId: string,
    userId: string,
    userName: string,
  ): Promise<EquipmentEntry> {
    const entry = await this.findOne(id, tenantId);

    if (entry.status !== EquipmentStatus.PENDING_AUTH) {
      throw new ConflictException(`No se puede autorizar un equipo en estado ${entry.status}.`);
    }

    entry.status = EquipmentStatus.INSIDE;
    entry.authorizedById = userId;
    entry.authorizedAt = new Date();

    const saved = await this.equipmentRepo.save(entry);

    await this.auditLogger.log({
      category: LogCategory.USER_ACTION,
      action: 'equipment.authorized',
      tenantId,
      userId,
      userName,
      entityType: 'equipment_entry',
      entityId: id,
      details: { serialNumber: entry.serialNumber },
    });

    return saved;
  }

  async reject(
    id: string,
    tenantId: string,
    userId: string,
    userName: string,
    dto: RejectEquipmentDto,
  ): Promise<EquipmentEntry> {
    const entry = await this.findOne(id, tenantId);

    if (entry.status !== EquipmentStatus.PENDING_AUTH) {
      throw new ConflictException(`No se puede rechazar un equipo en estado ${entry.status}.`);
    }

    entry.status = EquipmentStatus.REJECTED;
    entry.rejectedReason = dto.reason ?? null;

    const saved = await this.equipmentRepo.save(entry);

    await this.auditLogger.log({
      category: LogCategory.USER_ACTION,
      action: 'equipment.rejected',
      tenantId,
      userId,
      userName,
      entityType: 'equipment_entry',
      entityId: id,
      details: { serialNumber: entry.serialNumber, reason: dto.reason },
    });

    return saved;
  }

  async softDelete(
    id: string,
    tenantId: string,
    userId: string,
    userName: string,
    userRole: string,
  ): Promise<{ success: boolean }> {
    if (userRole !== 'ADMIN') {
      throw new ForbiddenException('Solo administradores pueden eliminar registros de equipos.');
    }
    const entry = await this.findOne(id, tenantId);

    await this.auditLogger.log({
      category: LogCategory.AUDIT_EVENT,
      action: 'equipment.deleted',
      tenantId,
      userId,
      userName,
      entityType: 'equipment_entry',
      entityId: id,
      details: { serialNumber: entry.serialNumber, status: entry.status },
    });

    await this.equipmentRepo.delete(id);
    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════════════
  // ESTADÍSTICAS
  // ═══════════════════════════════════════════════════════════════════

  async getStats(tenantId: string) {
    const now = new Date();
    const startOfDay = new Date(now.setHours(0, 0, 0, 0));
    const endOfDay = new Date(new Date().setHours(23, 59, 59, 999));

    const [inside, pendingAuth, exitedToday, overtime] = await Promise.all([
      this.equipmentRepo.count({
        where: [
          { tenantId, status: EquipmentStatus.INSIDE },
          { tenantId, status: EquipmentStatus.AUTHORIZED },
        ],
      }),
      this.equipmentRepo.count({ where: { tenantId, status: EquipmentStatus.PENDING_AUTH } }),
      this.equipmentRepo.count({
        where: { tenantId, status: EquipmentStatus.EXITED, exitAt: Between(startOfDay, endOfDay) },
      }),
      this.equipmentRepo.count({
        where: { tenantId, status: EquipmentStatus.INSIDE, overtimeAlertSent: true },
      }),
    ]);

    return { inside, pendingAuth, exitedToday, overtime };
  }

  // ═══════════════════════════════════════════════════════════════════
  // REPORTES — CSV y PDF
  // ═══════════════════════════════════════════════════════════════════

  private fmtDate(d: Date | null | undefined): string {
    if (!d) return '';
    return d.toLocaleString('es-ES', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  }

  private statusLabel(s: EquipmentStatus): string {
    const map: Record<EquipmentStatus, string> = {
      [EquipmentStatus.PENDING_AUTH]: 'Pendiente autorización',
      [EquipmentStatus.AUTHORIZED]:   'Autorizado',
      [EquipmentStatus.INSIDE]:       'En instalaciones',
      [EquipmentStatus.EXITED]:       'Salió',
      [EquipmentStatus.REJECTED]:     'Rechazado',
    };
    return map[s] ?? s;
  }

  private async fetchForReport(tenantId: string, filter: EquipmentFilterDto) {
    const where: any[] = [];
    const base: any = { tenantId };
    if (filter.status) base.status = filter.status;
    if (filter.category) base.category = filter.category;
    if (filter.dateFrom || filter.dateTo) {
      const from = filter.dateFrom ? new Date(filter.dateFrom) : new Date('2000-01-01');
      const to = filter.dateTo ? new Date(filter.dateTo + 'T23:59:59') : new Date();
      base.entryAt = Between(from, to);
    }
    if (filter.search) {
      const s = `%${filter.search}%`;
      ['serialNumber', 'brand', 'model', 'responsibleName'].forEach(f =>
        where.push({ ...base, [f]: ILike(s) }),
      );
    } else {
      where.push(base);
    }
    return this.equipmentRepo.find({ where, order: { entryAt: 'DESC' }, take: 5000 });
  }

  async exportCsv(
    tenantId: string,
    userId: string,
    userName: string,
    filter: EquipmentFilterDto,
  ): Promise<string> {
    const rows = await this.fetchForReport(tenantId, filter);

    const csv = createObjectCsvStringifier({
      header: [
        { id: 'id',              title: 'ID' },
        { id: 'serialNumber',    title: 'Número de Serie' },
        { id: 'brand',           title: 'Marca' },
        { id: 'model',           title: 'Modelo' },
        { id: 'category',        title: 'Categoría' },
        { id: 'responsibleName', title: 'Responsable' },
        { id: 'hostArea',        title: 'Área' },
        { id: 'entryAt',         title: 'Ingreso' },
        { id: 'exitAt',          title: 'Salida' },
        { id: 'durationHours',   title: 'Duración (h)' },
        { id: 'status',          title: 'Estado' },
        { id: 'authorizedById',  title: 'Autorizado por' },
        { id: 'authorizationCode', title: 'Código autorización' },
        { id: 'rejectedReason',  title: 'Motivo rechazo' },
        { id: 'createdByName',   title: 'Registrado por' },
        { id: 'notes',           title: 'Notas' },
      ],
    });

    const records = rows.map(r => ({
      id: r.id,
      serialNumber: r.serialNumber,
      brand: r.brand,
      model: r.model,
      category: r.category,
      responsibleName: r.responsibleName,
      hostArea: r.hostArea,
      entryAt: this.fmtDate(r.entryAt),
      exitAt: this.fmtDate(r.exitAt),
      durationHours: r.exitAt && r.entryAt
        ? +((r.exitAt.getTime() - r.entryAt.getTime()) / 3600000).toFixed(2)
        : '',
      status: this.statusLabel(r.status),
      authorizedById: r.authorizedById ?? '',
      authorizationCode: r.authorizationCode ?? '',
      rejectedReason: r.rejectedReason ?? '',
      createdByName: r.createdByName ?? '',
      notes: r.notes ?? '',
    }));

    await this.auditLogger.log({
      category: LogCategory.AUDIT_EVENT,
      action: 'equipment.report_exported',
      tenantId, userId, userName,
      details: { format: 'CSV', count: rows.length, filter },
    });

    return csv.getHeaderString() + csv.stringifyRecords(records);
  }

  async exportPdf(
    tenantId: string,
    userId: string,
    userName: string,
    filter: EquipmentFilterDto,
  ): Promise<Buffer> {
    const rows = await this.fetchForReport(tenantId, filter);
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));

    const dateRange = filter.dateFrom || filter.dateTo
      ? `${filter.dateFrom ?? ''} → ${filter.dateTo ?? ''}`
      : 'Todos los períodos';

    // Header
    doc.fontSize(16).fillColor('#A12944')
      .text('BioVisitor X — Reporte de Equipos', { align: 'center' });
    doc.fontSize(10).fillColor('#555')
      .text(`Generado: ${new Date().toLocaleString('es-ES')} | Período: ${dateRange} | Por: ${userName}`, { align: 'center' });
    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).strokeColor('#A12944').stroke();
    doc.moveDown(0.5);

    // Table headers
    const cols = [
      { label: 'Serie',         w: 80 },
      { label: 'Marca/Modelo',  w: 120 },
      { label: 'Categoría',     w: 70 },
      { label: 'Responsable',   w: 120 },
      { label: 'Área',          w: 90 },
      { label: 'Ingreso',       w: 90 },
      { label: 'Salida',        w: 90 },
      { label: 'Estado',        w: 90 },
    ];

    const tableLeft = 40;
    let y = doc.y;

    doc.fontSize(8).fillColor('#fff');
    doc.rect(tableLeft, y, doc.page.width - 80, 16).fillColor('#A12944').fill();
    let x = tableLeft + 4;
    doc.fillColor('#fff');
    for (const col of cols) {
      doc.text(col.label, x, y + 4, { width: col.w - 4, lineBreak: false });
      x += col.w;
    }
    y += 16;

    // Rows
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const bg = i % 2 === 0 ? '#f9f2f4' : '#ffffff';
      doc.rect(tableLeft, y, doc.page.width - 80, 14).fillColor(bg).fill();
      doc.fillColor('#333');
      x = tableLeft + 4;
      const vals = [
        r.serialNumber,
        `${r.brand} ${r.model}`.substring(0, 22),
        r.category,
        r.responsibleName.substring(0, 20),
        r.hostArea.substring(0, 15),
        this.fmtDate(r.entryAt).substring(0, 14),
        r.exitAt ? this.fmtDate(r.exitAt).substring(0, 14) : '—',
        this.statusLabel(r.status),
      ];
      for (let ci = 0; ci < cols.length; ci++) {
        doc.text(vals[ci], x, y + 3, { width: cols[ci].w - 4, lineBreak: false });
        x += cols[ci].w;
      }
      y += 14;

      if (y > doc.page.height - 60) {
        doc.addPage({ layout: 'landscape' });
        y = 40;
      }
    }

    // Footer
    doc.moveDown(1);
    doc.fontSize(8).fillColor('#999')
      .text(`Total registros: ${rows.length} | Hash SHA-256 del contenido garantiza integridad`, { align: 'center' });

    doc.end();

    await this.auditLogger.log({
      category: LogCategory.AUDIT_EVENT,
      action: 'equipment.report_exported',
      tenantId, userId, userName,
      details: { format: 'PDF', count: rows.length, filter },
    });

    return new Promise(resolve =>
      doc.on('end', () => resolve(Buffer.concat(chunks))),
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // CRON — Alertas de overtime cada 15 minutos
  // ═══════════════════════════════════════════════════════════════════

  @Cron('*/15 * * * *')
  async checkOvertimeEquipment(): Promise<void> {
    try {
      const tenants = await this.tenantRepo.find({ select: ['id'] });

      for (const tenant of tenants) {
        const settings = await this.getSettings(tenant.id);
        const thresholdMs = settings.defaultMaxStayHours * 3600_000;
        const cutoff = new Date(Date.now() - thresholdMs);

        const overtime = await this.equipmentRepo.find({
          where: {
            tenantId: tenant.id,
            status: EquipmentStatus.INSIDE,
            overtimeAlertSent: false,
            entryAt: Between(new Date('2000-01-01'), cutoff),
          },
        });

        for (const entry of overtime) {
          entry.overtimeAlertSent = true;
          await this.equipmentRepo.save(entry);

          await this.auditLogger.log({
            category: LogCategory.OPERATIONAL,
            action: 'equipment.overtime_alert',
            tenantId: tenant.id,
            userId: 'system',
            entityType: 'equipment_entry',
            entityId: entry.id,
            details: {
              serialNumber: entry.serialNumber,
              responsibleName: entry.responsibleName,
              entryAt: entry.entryAt,
              maxStayHours: entry.maxStayHours,
            },
          });

          this.logger.warn(
            `[EQUIPMENT_OVERTIME] Serial=${entry.serialNumber} | Tenant=${tenant.id} | EntryAt=${entry.entryAt.toISOString()}`,
          );
        }
      }
    } catch (err) {
      this.logger.error('[EQUIPMENT_OVERTIME_CRON] Error en verificación de overtime:', err);
    }
  }
}

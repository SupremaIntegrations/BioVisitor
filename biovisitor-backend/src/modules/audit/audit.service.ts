import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, Like, FindManyOptions, In } from 'typeorm';
import { AuditLog, User } from '../../database/entities';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuditLogsQuery {
  startDate?: string;
  endDate?: string;
  category?: string;
  action?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface AuditLogsResult {
  data: AuditLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async findAll(query: AuditLogsQuery): Promise<AuditLogsResult> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));
    const skip = (page - 1) * limit;

    const start = query.startDate ? new Date(query.startDate) : (() => {
      const d = new Date(); d.setDate(d.getDate() - 30); return d;
    })();
    const end = query.endDate ? new Date(query.endDate) : new Date();

    const qb = this.auditLogRepo.createQueryBuilder('al')
      .where('al.createdAt BETWEEN :start AND :end', { start, end });

    if (query.category) {
      qb.andWhere('al.category = :category', { category: query.category });
    }

    if (query.action) {
      qb.andWhere('al.action ILIKE :action', { action: `%${query.action}%` });
    }

    if (query.search) {
      qb.andWhere(
        '(al.userName ILIKE :search OR al.userId ILIKE :search OR al.action ILIKE :search OR al.ipAddress ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    qb.orderBy('al.createdAt', 'DESC').skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    await this.fillMissingUserNames(data);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Rellena en memoria el `userName` de registros históricos que quedaron
   * con la columna vacía (bug previo: algunos call-sites de logUserAction
   * no pasaban el nombre). No modifica la BD, solo enriquece la respuesta
   * consultando la tabla de usuarios por los userId faltantes.
   */
  private async fillMissingUserNames(logs: AuditLog[]): Promise<void> {
    const missingIds = Array.from(
      new Set(
        logs
          .filter((l) => !l.userName && l.userId && UUID_REGEX.test(l.userId))
          .map((l) => l.userId),
      ),
    );
    if (missingIds.length === 0) return;

    const users = await this.userRepo.find({
      where: { id: In(missingIds) },
      select: ['id', 'fullName', 'email'],
    });

    const nameById = new Map<string, string>(
      users.map((u: User) => [u.id, u.fullName || u.email]),
    );

    for (const log of logs) {
      if (!log.userName && nameById.has(log.userId)) {
        log.userName = nameById.get(log.userId)!;
      }
    }
  }

  async getEventTypes(): Promise<string[]> {
    const rows = await this.auditLogRepo
      .createQueryBuilder('al')
      .select('DISTINCT al.action', 'action')
      .orderBy('al.action', 'ASC')
      .getRawMany<{ action: string }>();
    return rows.map((r) => r.action);
  }

  async getActors(): Promise<{ userId: string; userName: string }[]> {
    const rows = await this.auditLogRepo
      .createQueryBuilder('al')
      .select('DISTINCT al.userId', 'userId')
      .addSelect('al.userName', 'userName')
      .orderBy('al.userName', 'ASC')
      .getRawMany<{ userId: string; userName: string }>();
    return rows;
  }
}

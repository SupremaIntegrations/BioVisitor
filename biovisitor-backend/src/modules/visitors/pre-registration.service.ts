/**
 * @file pre-registration.service.ts
 * @description Servicio para gestionar el flujo de pre-registro remoto.
 *
 * Permite generar tokens (UUID) seguros para enviar por correo/WhatsApp a los visitantes,
 * de forma que puedan llenar sus datos personales (nombre, doc, foto) antes de llegar
 * a las instalaciones, acelerando el proceso de recepción.
 *
 * @module modules/visitors
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  PreRegistration,
  Visit,
  Visitor,
  VisitStatus,
} from '../../database/entities';
import { GeneratePreRegistrationDto } from './dto/generate-preregistration.dto';
import { CompletePreRegistrationDto } from './dto/complete-preregistration.dto';
import {
  StructuredLoggerService,
  LogCategory,
} from '../../core/logging/structured-logger.service';

@Injectable()
export class PreRegistrationService {
  private readonly logger = new Logger(PreRegistrationService.name);

  constructor(
    @InjectRepository(PreRegistration)
    private readonly preRegRepository: Repository<PreRegistration>,
    @InjectRepository(Visit)
    private readonly visitRepository: Repository<Visit>,
    @InjectRepository(Visitor)
    private readonly visitorRepository: Repository<Visitor>,
    private readonly structuredLogger: StructuredLoggerService,
  ) {}

  /**
   * Genera un token único y seguro para una visita agendada.
   * Este token se añade a la URL que se le envía al visitante.
   */
  async generateToken(
    dto: GeneratePreRegistrationDto,
    auditorUserId: string,
  ): Promise<PreRegistration> {
    const visit = await this.visitRepository.findOne({
      where: { id: dto.visitId, tenantId: dto.tenantId },
      relations: ['visitor'],
    });

    if (!visit)
      throw new NotFoundException('Visita no encontrada en este tenant.');

    // Solo permitir pre-registro si está SCHEDULED (aún no ha ingresado ni ya llenó los datos)
    if (visit.status !== VisitStatus.SCHEDULED) {
      throw new BadRequestException(
        `No se puede generar link para visita en estado ${visit.status}`,
      );
    }

    // Invalidar tokens previos de esta visita
    await this.preRegRepository.update(
      { visitId: visit.id, formCompleted: false },
      { formCompleted: true }, // Marcamos como completados/invalidados
    );

    const token = randomUUID();

    // Por defecto expira en 24 horas si no se especifica
    const expiresAt =
      dto.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000);

    const preReg = this.preRegRepository.create({
      visitId: visit.id,
      token,
      expiresAt,
      formCompleted: false,
    });

    await this.preRegRepository.save(preReg);

    this.structuredLogger.logUserAction(
      'preregistration.link_generated',
      auditorUserId,
      { visitId: visit.id, expiresAt },
      dto.tenantId,
    );

    return preReg;
  }

  /**
   * Valida un token de pre-registro y retorna los datos públicos necesarios
   * para cargar el formulario web.
   */
  async validateTokenAndGetVisit(token: string) {
    const preReg = await this.preRegRepository.findOne({
      where: { token, formCompleted: false },
      relations: ['visit', 'visit.tenant', 'visit.hostUser', 'visit.visitor'],
    });

    if (!preReg || preReg.expiresAt < new Date()) {
      throw new BadRequestException('El enlace es inválido o ha expirado.');
    }

    const { visit } = preReg;
    return {
      visitId: visit.id,
      scheduledAt: visit.scheduledAt,
      tenantName: visit.tenant?.name,
      tenantLogoUrl: (visit.tenant?.brandingConfig as any)?.logoUrl, // Muestra el logo del tenant en el front
      hostName: visit.hostUser ? visit.hostUser.fullName : 'Recepción',
      visitor: {
        firstName: visit.visitor?.firstName,
        lastName: visit.visitor?.lastName,
        email: visit.visitor?.email,
        phone: visit.visitor?.phone,
      },
    };
  }

  /**
   * Procesa el formulario enviado por el visitante, actualiza los datos y marca la visita
   * como PRE_REGISTERED listo para sincronizar con BioStar a su llegada (o inmediato).
   */
  async completePreRegistration(
    token: string,
    dto: CompletePreRegistrationDto,
  ) {
    const preReg = await this.preRegRepository.findOne({
      where: { token, formCompleted: false },
      relations: ['visit', 'visit.visitor'],
    });

    if (!preReg || preReg.expiresAt < new Date()) {
      throw new BadRequestException('El enlace es inválido o ha expirado.');
    }

    const { visit } = preReg;

    if (visit.status !== VisitStatus.SCHEDULED) {
      throw new BadRequestException(
        'La visita ya no está en estado programado.',
      );
    }

    // Actualizar datos del Visitante
    const visitor = visit.visitor;
    visitor.firstName = dto.firstName;
    visitor.lastName = dto.lastName;

    if (dto.documentType) visitor.documentType = dto.documentType;
    if (dto.documentNumber) visitor.documentNumber = dto.documentNumber;
    if (dto.photoPath) {
      visitor.photoPath = dto.photoPath;
      preReg.photoUploaded = true;
    }
    if (dto.ocrData) visitor.ocrData = { ...visitor.ocrData, ...dto.ocrData };

    await this.visitorRepository.save(visitor);

    // Actualizar estado de Visita
    visit.status = VisitStatus.PRE_REGISTERED;
    await this.visitRepository.save(visit);

    // Invalidar token al completar
    preReg.formCompleted = true;
    await this.preRegRepository.save(preReg);

    this.structuredLogger.log({
      category: LogCategory.USER_ACTION, // Considerado una acción del visitante indirectamente
      action: 'preregistration.completed',
      tenantId: visit.tenantId,
      details: { visitId: visit.id, visitorId: visitor.id },
    });

    return { success: true, message: 'Pre-registro completado exitosamente.' };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';

export interface PreRegistrationEmailData {
  visitorName: string;
  hostName: string;
  companyName: string;
  scheduledDate: string;
  registrationLink: string;
}

export interface QrDeliveryEmailData {
  visitorName: string;
  hostName: string;
  scheduledDate: string;
  qrCodeDataUrl: string; // Base64 image
}

export interface QrPortalEmailData {
  visitorName: string;
  hostName: string;
  scheduledDate: string;
  portalToken: string;
}

export interface VisitorInviteEmailData {
  hostName: string;
  companyName: string;
  scheduledAt: Date;
  expectedEndAt: Date | null;
  purpose: string | null;
  onboardingToken: string;
}

export interface PasswordResetEmailData {
  fullName: string;
  resetUrl: string;
}

export interface HostCheckinEmailData {
  hostName: string;
  visitorName: string;
  visitorCompany: string | null;
  visitorDocument: string | null;
  purpose: string | null;
  checkedInAt: Date;
}

export interface ExitSurveyEmailData {
  visitorName: string;
  checkedOutAt: Date;
  surveyToken: string;
  falseExitToken: string;
  timeZone?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly frontendUrl: string;

  constructor(
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
  ) {
    this.frontendUrl =
      this.configService.get<string>('app.frontendUrl') ||
      'http://localhost:3000';
  }

  /**
   * Envía un email al visitante con el link para completar su pre-registro.
   */
  async sendPreRegistrationLink(
    to: string,
    data: PreRegistrationEmailData,
  ): Promise<boolean> {
    try {
      this.logger.log(`Enviando email de pre-registro a ${to}`);

      await this.mailerService.sendMail({
        to,
        subject: `Pre-registro de visita a ${data.companyName}`,
        template: './pre-registration',
        context: {
          ...data,
          frontendUrl: this.frontendUrl,
        },
      });

      this.logger.log(`Email de pre-registro enviado exitosamente a ${to}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Error enviando email de pre-registro a ${to}: ${error.message}`,
        error.stack,
      );
      return false;
    }
  }

  /**
   * Envía un email al visitante con su código QR de acceso.
   */
  async sendQrCode(to: string, data: QrDeliveryEmailData): Promise<boolean> {
    try {
      this.logger.log(`Enviando código QR a ${to}`);

      await this.mailerService.sendMail({
        to,
        subject: `Tu código de acceso QR para tu visita`,
        template: './qr-delivery',
        context: {
          ...data,
          frontendUrl: this.frontendUrl,
        },
        attachments: [
          {
            filename: 'qrcode.png',
            content: data.qrCodeDataUrl.split('base64,')[1],
            encoding: 'base64',
            cid: 'qrcode-img', // permite usar en template con cid:qrcode-img
          },
        ],
      });

      this.logger.log(`QR enviado exitosamente a ${to}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Error enviando QR a ${to}: ${error.message}`,
        error.stack,
      );
      return false;
    }
  }

  /**
   * Envía al visitante su "Magic Link" — enlace personal al portal QR dinámico.
   * Se llama automáticamente al registrar una visita con accessMethod = QR_DYNAMIC.
   */
  async sendQrPortalLink(
    to: string,
    data: QrPortalEmailData,
  ): Promise<boolean> {
    try {
      this.logger.log(`Enviando Magic Link QR a ${to}`);
      const portalUrl = `${this.frontendUrl}/visitor/qr/${data.portalToken}`;

      await this.mailerService.sendMail({
        to,
        subject: `Tu código QR de acceso está listo`,
        template: './qr-portal',
        context: {
          ...data,
          portalUrl,
          frontendUrl: this.frontendUrl,
        },
      });

      this.logger.log(`Magic Link QR enviado exitosamente a ${to}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Error enviando Magic Link QR a ${to}: ${error.message}`,
        error.stack,
      );
      return false;
    }
  }

  /**
   * Envía al visitante invitado su Magic Link de onboarding para completar su registro.
   */
  async sendInvitationEmail(
    to: string,
    data: VisitorInviteEmailData,
  ): Promise<boolean> {
    try {
      this.logger.log(`Enviando invitación de visita a ${to}`);
      const onboardingUrl = `${this.frontendUrl}/visitor/onboarding/${data.onboardingToken}`;
      const localeStr = 'es-CO';
      const dateOpts: Intl.DateTimeFormatOptions = {
        weekday: 'long', year: 'numeric', month: 'long',
        day: 'numeric', hour: '2-digit', minute: '2-digit',
      };

      await this.mailerService.sendMail({
        to,
        subject: `Invitación de visita a ${data.companyName} — ${data.hostName}`,
        template: './visitor-invite',
        context: {
          hostName: data.hostName,
          companyName: data.companyName,
          scheduledDate: data.scheduledAt.toLocaleString(localeStr, dateOpts),
          expectedEndDate: data.expectedEndAt
            ? data.expectedEndAt.toLocaleString(localeStr, dateOpts)
            : null,
          purpose: data.purpose,
          onboardingUrl,
          year: new Date().getFullYear(),
          frontendUrl: this.frontendUrl,
        },
      });

      this.logger.log(`Invitación enviada exitosamente a ${to}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Error enviando invitación a ${to}: ${error.message}`,
        error.stack,
      );
      return false;
    }
  }

  /**
   * Notifica al anfitrión que su visitante acaba de realizar check-in en recepción.
   * Se llama automáticamente desde checkInVisit (fire-and-forget).
   * Si el anfitrión no tiene email registrado, la llamada es silenciosamente omitida.
   * Si se pasan customSettings, se usa el asunto/cuerpo personalizado configurado por el admin.
   */
  async sendHostCheckinNotification(
    to: string,
    data: HostCheckinEmailData,
    customSettings?: { subject: string; bodyText: string },
  ): Promise<boolean> {
    try {
      this.logger.log(`Notificando check-in al anfitrión ${to} — visitante: ${data.visitorName}`);
      const localeStr = 'es-CO';
      const timeOpts: Intl.DateTimeFormatOptions = {
        weekday: 'long', year: 'numeric', month: 'long',
        day: 'numeric', hour: '2-digit', minute: '2-digit',
      };
      const checkedInTime = data.checkedInAt.toLocaleString(localeStr, timeOpts);

      if (customSettings?.bodyText) {
        // Sustituir variables en asunto y cuerpo personalizado
        const vars: Record<string, string> = {
          visitorName: data.visitorName,
          hostName: data.hostName,
          visitorCompany: data.visitorCompany ?? '',
          visitorDocument: data.visitorDocument ?? '',
          purpose: data.purpose ?? '',
          checkedInTime,
        };
        const interpolate = (tpl: string) =>
          tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');

        const subject = interpolate(customSettings.subject);
        const logoHtml = (customSettings as any).logoUrl
          ? `<img src="${(customSettings as any).logoUrl}" alt="Logo" style="max-height:56px;max-width:200px;object-fit:contain;margin:0 auto 12px;display:block;">`
          : '';
        const bodyHtml = `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#333">
            <div style="background:#1a1a2e;border-bottom:4px solid #A12944;padding:28px 32px;border-radius:12px 12px 0 0;text-align:center">
              ${logoHtml}
              <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700">BioVisitor X</h1>
              <p style="color:rgba(255,255,255,0.5);font-size:12px;margin:4px 0 0">Sistema de Gestión de Visitantes</p>
            </div>
            <div style="background:#fff;padding:32px;border:1px solid #e8eaed;border-top:none;border-radius:0 0 12px 12px;font-size:14px;line-height:1.75;color:#374151">
              ${interpolate(customSettings.bodyText).replace(/\n/g, '<br>')}
            </div>
            <p style="text-align:center;font-size:11px;color:#9ca3af;margin-top:20px">© ${new Date().getFullYear()} BioVisitor X · Todos los derechos reservados</p>
          </div>`;

        await this.mailerService.sendMail({ to, subject, html: bodyHtml });
      } else {
        await this.mailerService.sendMail({
          to,
          subject: `Tu visitante ${data.visitorName} ha llegado al edificio`,
          template: './host-checkin-notification',
          context: {
            hostName: data.hostName,
            visitorName: data.visitorName,
            visitorCompany: data.visitorCompany,
            visitorDocument: data.visitorDocument,
            purpose: data.purpose,
            checkedInTime,
            year: new Date().getFullYear(),
            frontendUrl: this.frontendUrl,
          },
        });
      }

      this.logger.log(`Notificación de check-in enviada exitosamente a ${to}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Error enviando notificación de check-in a ${to}: ${error.message}`,
        error.stack,
      );
      return false;
    }
  }

  /**
   * Envía al visitante, tras el auto-checkout por dispositivo de salida, un
   * correo con: (1) link a la encuesta de satisfacción y (2) un aviso
   * destacado para reportar si en realidad sigue dentro de las instalaciones
   * (válido 1 hora).
   */
  async sendExitSurvey(to: string, data: ExitSurveyEmailData): Promise<boolean> {
    try {
      this.logger.log(`Enviando encuesta de salida + aviso de falsa salida a ${to}`);
      const surveyUrl = `${this.frontendUrl}/visitor/survey/${data.surveyToken}`;
      const falseExitUrl = `${this.frontendUrl}/visitor/false-exit/${data.falseExitToken}`;
      const localeStr = 'es-CO';
      const timeOpts: Intl.DateTimeFormatOptions = {
        weekday: 'long', year: 'numeric', month: 'long',
        day: 'numeric', hour: '2-digit', minute: '2-digit',
        timeZone: data.timeZone || 'America/Bogota',
      };

      await this.mailerService.sendMail({
        to,
        subject: `¿Cómo estuvo tu visita? Cuéntanos`,
        template: './exit-survey',
        context: {
          visitorName: data.visitorName,
          checkedOutTime: data.checkedOutAt.toLocaleString(localeStr, timeOpts),
          surveyUrl,
          falseExitUrl,
          year: new Date().getFullYear(),
          frontendUrl: this.frontendUrl,
        },
      });

      this.logger.log(`Encuesta de salida enviada exitosamente a ${to}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Error enviando encuesta de salida a ${to}: ${error.message}`,
        error.stack,
      );
      return false;
    }
  }

  /**
   * Envía el email de recuperación de contraseña al operador.
   */
  async sendPasswordResetEmail(
    to: string,
    data: PasswordResetEmailData,
  ): Promise<boolean> {
    try {
      this.logger.log(`Enviando email de recuperación de contraseña a ${to}`);

      await this.mailerService.sendMail({
        to,
        subject: `Recuperación de contraseña — BioVisitor X`,
        template: './password-reset',
        context: {
          fullName: data.fullName,
          resetUrl: data.resetUrl,
          year: new Date().getFullYear(),
        },
      });

      this.logger.log(`Email de recuperación enviado exitosamente a ${to}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Error enviando email de recuperación a ${to}: ${error.message}`,
        error.stack,
      );
      return false;
    }
  }
}

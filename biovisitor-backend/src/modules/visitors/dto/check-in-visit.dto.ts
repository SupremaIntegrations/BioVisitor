import { IsBoolean, IsDateString, IsNotEmpty, IsOptional } from 'class-validator';

export class CheckInVisitDto {
  /**
   * Inicio de vigencia del acceso (opcional).
   * Si no se envía, se usa la hora actual del check-in.
   * Se sincroniza como start_datetime en BioStar.
   */
  @IsOptional()
  @IsDateString({}, { message: 'La fecha de entrada debe ser una fecha/hora válida.' })
  startsAt?: string;

  /**
   * Fecha y hora exacta en que expira la visita (obligatorio).
   * Se sincroniza como expiry_datetime en BioStar.
   */
  @IsNotEmpty({ message: 'La fecha de salida programada es obligatoria.' })
  @IsDateString({}, { message: 'La fecha de salida debe ser una fecha/hora válida.' })
  expiresAt: string;

  /**
   * Permite activar/desactivar el auto-checkout de esta visita en el
   * momento del check-in (opcional). Si no se envía, se conserva el
   * valor previamente configurado en la visita.
   */
  @IsOptional()
  @IsBoolean({ message: 'autoCheckoutEnabled debe ser un valor booleano.' })
  autoCheckoutEnabled?: boolean;
}

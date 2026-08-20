/**
 * @file suprema-client.interface.ts
 * @description Interfaz común para clientes de BioStar 2 y BioStar X.
 *
 * Esta interfaz define el contrato que deben cumplir ambas implementaciones
 * (BioStar2Client y BioStarXClient). Permite al SupremaGatewayService
 * trabajar de forma agnóstica sin conocer la plataforma específica.
 *
 * Patrón de diseño: Strategy Pattern.
 * El gateway selecciona la implementación correcta según la configuración
 * del tenant (tenant.biostarPlatform).
 *
 * @module modules/suprema-gateway/interfaces
 */

/**
 * Payload normalizado para crear un usuario en cualquier plataforma BioStar.
 * El gateway traduce este payload al formato específico de BS2 o BSX.
 */
export interface CreateSupremaUserPayload {
  /** ID alfanumérico del visitante (se usa como user_id en BioStar) */
  visitorId: string;
  /** Nombre completo del visitante */
  fullName: string;
  /** Email del visitante */
  email: string;
  /** Fecha y hora de inicio de validez del acceso */
  validFrom: Date;
  /** Fecha y hora de fin de validez del acceso */
  validTo: Date;
  /** ID del grupo de usuarios en BioStar (generalmente "Visitantes") */
  userGroupId?: number;
  /** Foto del visitante en base64 (para enrolamiento facial) */
  photoBase64?: string;
  /** ID de tarjeta RFID o valor de QR para asignar como credencial de acceso */
  cardId?: string;
}

/**
 * Evento de acceso recibido desde BioStar.
 * Se usa para detectar check-outs y sincronizar el estado de las visitas.
 */
export interface AccessEvent {
  /** ID del evento en BioStar */
  eventId: string;
  /** ID del usuario en BioStar que generó el evento */
  userId: string;
  /** Tipo de evento (entrada, salida, denegado, etc.) */
  eventType: string;
  /** ID del dispositivo/lector que registró el evento */
  deviceId: string;
  /** Nombre del dispositivo */
  deviceName: string;
  /** Fecha y hora del evento */
  timestamp: Date;
  /** Indica si el acceso fue concedido o denegado */
  isGranted: boolean;
}

/**
 * Resultado de la creación de un usuario en BioStar.
 */
export interface SupremaUserResult {
  /** ID de referencia asignado por BioStar al usuario creado */
  supremaRefId: string;
  /** Indica si la creación fue exitosa */
  success: boolean;
  /** Mensaje de error si falló */
  errorMessage?: string;
}

/**
 * Interfaz común para clientes de BioStar.
 *
 * Ambas implementaciones (BioStar2Client y BioStarXClient) deben
 * cumplir este contrato, permitiendo al gateway ser agnóstico.
 *
 * @example
 * // Uso desde el SupremaGatewayService:
 * const client: ISupremaClient = this.getClientForTenant(tenant);
 * const result = await client.createUser(payload);
 */
export interface FaceValidationResult {
  valid: boolean;
  image?: string;
  imageTemplate?: string;
  imageTemplate2?: string;
  errorMessage?: string;
}

export interface ISupremaClient {
  /**
   * Autentica con el servidor BioStar y obtiene/renueva las credenciales de sesión.
   * - BioStar 2: Obtiene el bs-session-id vía POST /api/login
   * - BioStar X: Autenticación vía microservicio de auth
   * @throws Error si las credenciales son inválidas o el servidor no responde
   */
  authenticate(): Promise<void>;

  /**
   * Crea un usuario visitante en BioStar.
   * Incluye: datos personales, periodo de validez, y credentials si se proporcionan.
   * @param payload - Datos normalizados del visitante
   * @returns Resultado con el ID de referencia de BioStar
   */
  createUser(payload: CreateSupremaUserPayload): Promise<SupremaUserResult>;

  /**
   * Elimina un usuario visitante de BioStar.
   * Esto libera la memoria de los lectores físicos que tenían al usuario sincronizado.
   * Se ejecuta durante el check-out automático.
   * @param supremaRefId - ID de referencia del usuario en BioStar
   */
  deleteUser(supremaRefId: string): Promise<void>;

  /**
   * Enrolla una fotografía facial en el perfil del usuario en BioStar.
   * BioStar genera automáticamente el template biométrico facial.
   * @param supremaRefId - ID del usuario en BioStar
   * @param photoBase64 - Fotografía del rostro en base64
   */
  enrollFace(supremaRefId: string, photoBase64: string): Promise<void>;

  /**
   * Enrolla un template de huella dactilar.
   * El template se obtiene de los lectores de huella Suprema conectados vía SDK/USB.
   * @param supremaRefId - ID del usuario en BioStar
   * @param templateData - Template de huella en formato BioStar
   */
  enrollFingerprint(supremaRefId: string, templateData: unknown): Promise<void>;

  /**
   * Asigna una tarjeta (RFID o código de barras/QR) al usuario.
   * @param supremaRefId - ID del usuario en BioStar
   * @param cardId - ID de la tarjeta (CSN, Wiegand, o valor del código QR/barcode)
   */
  assignCard(supremaRefId: string, cardId: string): Promise<void>;

  /**
   * Envía comando de apertura de puerta a un dispositivo específico.
   * Se usa cuando el VMS valida un código QR dinámico y necesita abrir la puerta.
   * @param doorId - ID de la puerta/zona de acceso en BioStar
   */
  openDoor(doorId: string): Promise<void>;

  /**
   * Obtiene los eventos de acceso registrados en BioStar en un rango de fechas.
   * Se usa para detectar check-outs automáticos y generar reportes.
   * @param fromDate - Fecha de inicio del rango
   * @param toDate - Fecha de fin del rango
   * @returns Lista de eventos de acceso
   */
  getEvents(fromDate: Date, toDate: Date): Promise<AccessEvent[]>;

  /**
   * Valida una imagen facial contra el motor de IA de BioStar.
   * Envía la foto al endpoint de verificación y retorna los templates extraídos.
   * @param photoBase64 - Foto del rostro en base64 puro (sin prefijo data:image)
   * @returns Resultado con los templates faciales extraídos
   */
  validateFaceTemplate(photoBase64: string): Promise<FaceValidationResult>;

  /**
   * Captura una fotografía facial desde un dispositivo BioStar conectado.
   * Se usa cuando el operador activa un enrolador de tipo 'face' para capturar
   * la biometría del visitante directamente desde la pantalla de registro.
   * Maneja respuestas 202 (async) con polling cada 2s hasta 30s.
   * @param deviceId - ID del dispositivo en BioStar
   * @returns Imagen en base64 puro (sin prefijo data:image)
   */
  capturePhotoFromDevice(deviceId: string): Promise<string>;

  /**
   * Verifica que la conexión con BioStar esté activa.
   * Se usa para el health check del Circuit Breaker.
   * @returns true si la conexión está operativa
   */
  healthCheck(): Promise<boolean>;
}

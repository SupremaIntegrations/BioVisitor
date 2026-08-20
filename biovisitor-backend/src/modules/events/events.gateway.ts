import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@WebSocketGateway({
  cors: {
    origin: '*', // TODO: Cargar desde env en produccion
  },
  namespace: '/events',
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      // Extraer token de headers o auth
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.split(' ')[1];

      if (!token) {
        this.logger.warn(`Conexión no autenticada rechazada: ${client.id}`);
        client.disconnect();
        return;
      }

      // Validar Token
      const payload = this.jwtService.verify(token);

      // Unir al cliente a un "room" especifico de su Tenant,
      // para que solo reciba eventos de su propio tenant.
      const tenantRoom = `tenant_${payload.tenantId}`;
      client.join(tenantRoom);

      // Guardar informacion de la sesion en el socket
      client.data.user = payload;

      this.logger.log(
        `Cliente conectado: ${client.id} | User: ${payload.email} | Room: ${tenantRoom}`,
      );
    } catch (error) {
      this.logger.error(
        `Error de autenticación WS: ${error.message} (${client.id})`,
      );
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Cliente desconectado: ${client.id}`);
  }

  /**
   * Broadcast genérico a un Tenant específico.
   * Útil para eventos de visitantes (Check-In, Nuevo Visitante, etc).
   */
  broadcastToTenant(tenantId: string, eventName: string, payload: any) {
    const tenantRoom = `tenant_${tenantId}`;
    this.server.to(tenantRoom).emit(eventName, payload);
    this.logger.debug(`Broadcast '${eventName}' a ${tenantRoom}`);
  }

  // Ejemplo de cliente enviando un "ping"
  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    return { event: 'pong', data: 'VMS WebSocket Online' };
  }
}

import { useEffect, useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

// NEXT_PUBLIC_API_URL en producción es "/api/v1" (ruta relativa — ver
// .env.production), y tras quitarle el sufijo queda "" a propósito: eso
// es lo que Socket.IO necesita para conectarse al mismo origen desde el
// que se sirvió la página (que es donde nginx expone /socket.io/). Por
// eso el fallback a localhost:3001 solo debe aplicar cuando la variable
// NO está definida en absoluto (modo desarrollo sin build de producción),
// no cuando el resultado de quitarle el sufijo da un string vacío.
const API_URL_RAW = process.env.NEXT_PUBLIC_API_URL;
const BACKEND_WS_URL = API_URL_RAW ? API_URL_RAW.replace(/\/api\/v1$/, '') : 'http://localhost:3001';

export function useSocket() {
    const [isConnected, setIsConnected] = useState(false);
    const socketRef = useRef<Socket | null>(null);

    useEffect(() => {
        const token = localStorage.getItem('biovisitor_token');

        if (!token) {
            return;
        }

        const socket = io(`${BACKEND_WS_URL}/events`, {
            auth: {
                token,
            },
            transports: ['websocket'],
        });

        socketRef.current = socket;

        socket.on('connect', () => {
            console.log('🔗 WebSocket Connected:', socket.id);
            setIsConnected(true);
        });

        socket.on('disconnect', () => {
            console.log('❌ WebSocket Disconnected');
            setIsConnected(false);
        });

        return () => {
            socket.disconnect();
            socketRef.current = null;
        };
    }, []);

    const listenToEvent = useCallback((eventName: string, callback: (data: any) => void): (() => void) => {
        const socket = socketRef.current;
        if (socket) {
            socket.on(eventName, callback);
        }
        return () => {
            if (socket) {
                socket.off(eventName, callback);
            }
        };
    }, []);

    const removeEventListener = useCallback((eventName: string, callback?: (data: any) => void) => {
        if (socketRef.current) {
            if (callback) {
                socketRef.current.off(eventName, callback);
            } else {
                socketRef.current.off(eventName);
            }
        }
    }, []);

    return { isConnected, socket: socketRef.current, listenToEvent, removeEventListener };
}

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Puerto por defecto del agente local Suprema BioMini.
 * El software Suprema Device Manager / BioMini Web Agent debe estar
 * corriendo en la PC de recepción y escuchando en este puerto.
 */
export const BIOMINI_AGENT_DEFAULT_URL = 'ws://127.0.0.1:14578';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type CaptureStatus = 'idle' | 'waiting_finger' | 'sample_ok' | 'complete' | 'error';

/** Resultado de una huella completamente enrolada (3 muestras fusionadas). */
export interface EnrolledFinger {
  fingerIndex: number;
  /** Template final fusionado (base64). Se envía a BioStar. */
  template: string;
  /** Templates de muestras individuales (2-3). */
  samples: string[];
  /** Calidad consolidada 0-100. */
  quality: number;
}

export interface DeviceInfo {
  deviceModel: string;
  serialNumber?: string;
  firmwareVersion?: string;
}

export interface UseBioMiniScannerReturn {
  connectionStatus: ConnectionStatus;
  deviceInfo: DeviceInfo | null;
  captureStatus: CaptureStatus;
  /** Índice del dedo que está siendo capturado actualmente (0-9). */
  currentFinger: number | null;
  /** Número de muestras capturadas para el dedo actual (0-3). */
  sampleCount: number;
  /** Calidad de la última muestra (0-100). */
  quality: number;
  /** Huellas ya enroladas, indexadas por fingerIndex. */
  enrolledFingers: Map<number, EnrolledFinger>;
  lastError: string | null;
  connect: () => void;
  disconnect: () => void;
  startCapture: (fingerIndex: number) => void;
  cancelCapture: () => void;
  clearFinger: (fingerIndex: number) => void;
  clearAll: () => void;
}

export function useBioMiniScanner(agentUrl = BIOMINI_AGENT_DEFAULT_URL): UseBioMiniScannerReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const samplesRef = useRef<string[]>([]);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>('idle');
  const [currentFinger, setCurrentFinger] = useState<number | null>(null);
  const [sampleCount, setSampleCount] = useState(0);
  const [quality, setQuality] = useState(0);
  const [enrolledFingers, setEnrolledFingers] = useState<Map<number, EnrolledFinger>>(new Map());
  const [lastError, setLastError] = useState<string | null>(null);

  const sendMessage = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const handleMessage = useCallback((event: MessageEvent) => {
    let data: any;
    try {
      data = JSON.parse(event.data as string);
    } catch {
      return;
    }

    switch (data.type) {
      case 'status':
        if (data.connected) {
          setDeviceInfo({
            deviceModel: data.deviceModel || 'BioMini Slim 2',
            serialNumber: data.serialNumber,
            firmwareVersion: data.firmwareVersion,
          });
        }
        break;

      case 'captureStarted':
        setCaptureStatus('waiting_finger');
        setSampleCount(0);
        setQuality(0);
        samplesRef.current = [];
        setLastError(null);
        break;

      case 'sample':
        // Each sample is one successful placement. Need 3 total.
        samplesRef.current = [...samplesRef.current, data.template || ''];
        setSampleCount(samplesRef.current.length);
        setQuality(data.quality ?? 0);
        setCaptureStatus('sample_ok');
        // Brief visual feedback then back to waiting
        setTimeout(() => setCaptureStatus('waiting_finger'), 700);
        break;

      case 'captureComplete': {
        const finger: EnrolledFinger = {
          fingerIndex: data.fingerIndex ?? 0,
          template: data.template || '',
          samples: [...samplesRef.current],
          quality: data.quality ?? 0,
        };
        setEnrolledFingers(prev => new Map(prev).set(finger.fingerIndex, finger));
        setCaptureStatus('complete');
        setCurrentFinger(null);
        setQuality(data.quality ?? 0);
        samplesRef.current = [];
        break;
      }

      case 'captureCancelled':
        setCaptureStatus('idle');
        setCurrentFinger(null);
        setSampleCount(0);
        samplesRef.current = [];
        break;

      case 'error':
        setCaptureStatus('error');
        setLastError(data.message || 'Error desconocido del escáner');
        setCurrentFinger(null);
        samplesRef.current = [];
        break;
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    setConnectionStatus('connecting');
    setLastError(null);

    try {
      const ws = new WebSocket(agentUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnectionStatus('connected');
        sendMessage({ action: 'getStatus' });
      };

      ws.onmessage = handleMessage;

      ws.onerror = () => {
        setConnectionStatus('error');
        setLastError(
          'No se pudo conectar al agente BioMini en el puerto 14578. ' +
          'Verifique que el Suprema Device Manager esté en ejecución.',
        );
        wsRef.current = null;
      };

      ws.onclose = () => {
        setConnectionStatus('disconnected');
        setDeviceInfo(null);
        setCaptureStatus('idle');
        setCurrentFinger(null);
        wsRef.current = null;
      };
    } catch {
      setConnectionStatus('error');
      setLastError('Error al inicializar WebSocket. Revise la configuración del agente.');
    }
  }, [agentUrl, handleMessage, sendMessage]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  const startCapture = useCallback((fingerIndex: number) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    setCurrentFinger(fingerIndex);
    setCaptureStatus('waiting_finger');
    setSampleCount(0);
    setQuality(0);
    samplesRef.current = [];
    setLastError(null);
    sendMessage({ action: 'startCapture', fingerIndex });
  }, [sendMessage]);

  const cancelCapture = useCallback(() => {
    sendMessage({ action: 'cancelCapture' });
    setCaptureStatus('idle');
    setCurrentFinger(null);
    setSampleCount(0);
    samplesRef.current = [];
  }, [sendMessage]);

  const clearFinger = useCallback((fingerIndex: number) => {
    setEnrolledFingers(prev => {
      const next = new Map(prev);
      next.delete(fingerIndex);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setEnrolledFingers(new Map());
    setCaptureStatus('idle');
    setCurrentFinger(null);
    setSampleCount(0);
    samplesRef.current = [];
    setLastError(null);
  }, []);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  return {
    connectionStatus,
    deviceInfo,
    captureStatus,
    currentFinger,
    sampleCount,
    quality,
    enrolledFingers,
    lastError,
    connect,
    disconnect,
    startCapture,
    cancelCapture,
    clearFinger,
    clearAll,
  };
}

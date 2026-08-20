'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, Pencil, Loader2, CheckCircle2, AlertCircle, RefreshCw,
  CheckCircle, Clock, WifiOff, Camera, Upload, Trash2, Plus,
  CreditCard, Wifi, QrCode, XCircle, LogIn, LogOut, ZoomIn,
  Briefcase, PackageCheck, Package, Car, CarFront, Printer, Fingerprint, ScanLine,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n/I18nContext';
import AuthImage from './AuthImage';
import FaceCaptureModal from './FaceCaptureModal';
import PrintBadgeModal from './PrintBadgeModal';
import FingerprintEnrollModal from './FingerprintEnrollModal';
import AccessGroupSelect, { type AccessGroup } from './AccessGroupSelect';
import CheckInModal from './CheckInModal';
import { analyzeFaceQuality, detectFaceBox, ensureFaceApiLoaded, type FaceBox, type FaceQualityIssue } from '@/lib/face-quality';
import { useVisitorTypeCatalog } from '@/lib/visitor-types';

interface AssetDetail {
  id: string;
  description: string;
  serialNumber: string | null;
  category: string;
  verifiedAtCheckout: boolean;
  createdAt: string;
}

interface VehicleDetail {
  id: string;
  licensePlate: string;
  brand: string | null;
  model: string | null;
  color: string | null;
  vehicleType: string;
  parkingZone: string | null;
  hasEntered: boolean;
  verifiedAtCheckout: boolean;
  createdAt: string;
}

interface CredentialDetail {
  id: string;
  type: string;
  cardNumber: string | null;
  cardSubtype: string | null;
  supremaCardId: string | null;
  syncStatus: string | null;
  lastSyncError: string | null;
  lastSyncAttemptAt: string | null;
  supremaTemplateCount: number;
  expiresAt: string | null;
  isRevoked: boolean;
  createdAt: string;
}

interface HostDetail {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  department: string | null;
  jobTitle: string | null;
  source: string;
}

interface VisitDetailData {
  id: string;
  visitorId: string;
  purpose: string;
  scheduledAt: string;
  expectedEndAt: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  accessMethod: string;
  status: string;
  syncStatus: string | null;
  lastSyncError: string | null;
  lastSyncAttemptAt: string | null;
  supremaUserRefId: string | null;
  visitorType?: string | null;
  serviceOrder?: string | null;
  notes?: string | null;
  autoCheckoutEnabled?: boolean;
  surveyRating?: number | null;
  surveyComment?: string | null;
  surveyRespondedAt?: string | null;
  falseExitReportedAt?: string | null;
  falseExitResolvedAt?: string | null;
  falseExitResolutionNote?: string | null;
  temporaryReenableUntil?: string | null;
  wasTemporaryReenabled?: boolean;
  hasAssets?: boolean;
  assets?: AssetDetail[];
  hasVehicles?: boolean;
  vehicles?: VehicleDetail[];
  accessGroups?: { id: number; name: string }[] | null;
  credentials?: CredentialDetail[];
  host?: HostDetail | null;
  hostUser?: { fullName: string; email: string; department?: string } | null;
  visitor?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    company: string | null;
    position: string | null;
    documentType: string;
    documentNumber: string;
    nationality: string | null;
    photoPath: string | null;
    updatedAt: string;
  };
}

interface EditableFields {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  position: string;
  nationality: string;
}

interface VisitorDetailModalProps {
  isOpen: boolean;
  visitId: string | null;
  onClose: () => void;
  onUpdated?: () => void;
}

const DOC_TYPE_KEYS: Record<string, string> = {
  NATIONAL_ID:     'detail.docNationalId',
  PASSPORT:        'detail.docPassport',
  FOREIGN_ID:      'detail.docForeignId',
  DRIVERS_LICENSE: 'detail.docDriversLicense',
  OTHER:           'detail.docOther',
};

const CREDENTIAL_TYPES = [
  { value: 'RFID',            label: 'Tarjeta RFID',            icon: Wifi,        needsCard: true,  canScan: true,  scanCap: 'card'        },
  { value: 'SMART_CARD',      label: 'Smart Card',              icon: CreditCard,  needsCard: true,  canScan: true,  scanCap: 'card'        },
  { value: 'QR_JWT',          label: 'QR Dinámico',             icon: QrCode,      needsCard: false, canScan: false, scanCap: null          },
  { value: 'VISUAL_FACE',     label: 'Rostro Visual (BioStar)', icon: Camera,      needsCard: false, canScan: true,  scanCap: 'face'        },
  { value: 'FINGERPRINT_REF', label: 'Huella Dactilar',         icon: Fingerprint, needsCard: false, canScan: true,  scanCap: 'fingerprint' },
];

type PhotoValidationState = 'idle' | 'validating' | 'accepted' | 'rejected';

export default function VisitorDetailModal({ isOpen, visitId, onClose, onUpdated }: VisitorDetailModalProps) {
  const { t } = useI18n();
  const { labels: visitorTypeLabels } = useVisitorTypeCatalog();
  const [visit, setVisit] = useState<VisitDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // ── Historial de visitas ───────────────────────────────────────────
  const [visitHistory, setVisitHistory] = useState<Array<{
    id: string;
    status: string;
    purpose: string | null;
    scheduledAt: string | null;
    checkedInAt: string | null;
    checkedOutAt: string | null;
    hostName: string | null;
  }>>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── Photo ────────────────────────────────────────────────────────────────────
  const [newPhotoDataUrl, setNewPhotoDataUrl] = useState<string | null>(null);
  const [newFaceBox, setNewFaceBox] = useState<FaceBox | null>(null);
  const [showFaceCapture, setShowFaceCapture] = useState(false);
  const [photoValidation, setPhotoValidation] = useState<PhotoValidationState>('idle');
  const [photoIssues, setPhotoIssues] = useState<FaceQualityIssue[]>([]);
  const [photoLightboxOpen, setPhotoLightboxOpen] = useState(false);
  const [photoKey, setPhotoKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Credential management ────────────────────────────────────────────────────
  const [credentials, setCredentials] = useState<CredentialDetail[]>([]);
  const [showAddCredential, setShowAddCredential] = useState(false);
  const [showCredHistory, setShowCredHistory] = useState(false);
  const [credType, setCredType] = useState('RFID');
  const [credCardNumber, setCredCardNumber] = useState('');
  const [credCardSubtype, setCredCardSubtype] = useState<'CSN' | 'WIEGAND' | 'MOBILE_CSN'>('CSN');
  const [addingCred, setAddingCred] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // ── Device capability (enroladores) ─────────────────────────────────────────
  interface DeviceCap { deviceId: string; deviceName: string; face: boolean; fingerprint: boolean; card: boolean; qr: boolean; }
  interface EnrollerEntry { deviceId: string; deviceName: string; typeName: string; type: string; }
  const [enrollers, setEnrollers] = useState<EnrollerEntry[]>([]);
  const [enrollersLoaded, setEnrollersLoaded] = useState(false);
  const [selectedEnrollerId, setSelectedEnrollerId] = useState<string>('');
  const [deviceCap, setDeviceCap] = useState<DeviceCap | null>(null);
  const [deviceCapLoading, setDeviceCapLoading] = useState(false);

  // ── Device scan state ────────────────────────────────────────────────────────
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scannedData, setScannedData] = useState<Record<string, unknown> | null>(null);
  const scanAbortRef = useRef<AbortController | null>(null);

  // ── Form — visitor personal data ─────────────────────────────────────────────
  const [editForm, setEditForm] = useState<EditableFields>({
    firstName: '', lastName: '', email: '', phone: '',
    company: '', position: '', nationality: '',
  });

  // ── Form — visit-level fields ─────────────────────────────────────────────────
  const [editVisitForm, setEditVisitForm] = useState({
    purpose: '', visitorType: 'WALK_IN', scheduledAt: '', expectedEndAt: '', autoCheckoutEnabled: false,
  });
  const [editAccessGroups, setEditAccessGroups] = useState<AccessGroup[]>([]);
  const [availableGroups, setAvailableGroups] = useState<AccessGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsError, setGroupsError] = useState(false);
  const [autoCheckoutTouched, setAutoCheckoutTouched] = useState(false);
  const [autoCheckoutDefaults, setAutoCheckoutDefaults] = useState<Record<string, boolean>>({});

  // ── Host picker ───────────────────────────────────────────────────────────────
  const [selectedHostId, setSelectedHostId] = useState<string>('');
  const [hosts, setHosts] = useState<{ id: string; fullName: string; department?: string | null; email?: string | null }[]>([]);
  const [hostsLoading, setHostsLoading] = useState(false);

  const fetchVisitDetail = useCallback(async () => {
    if (!visitId) return;
    setLoading(true);
    try {
      const response = await api.get(`/visitors/visit/${visitId}`);
      setVisit(response.data);
      setCredentials(response.data.credentials ?? []);

      // Fetch visit history in parallel (non-blocking)
      if (response.data.visitor?.id) {
        setHistoryLoading(true);
        api.get(`/visitors/${response.data.visitor.id}/history?limit=6`)
          .then(hr => {
            setVisitHistory((hr.data.visits ?? []).filter((h: any) => h.id !== visitId));
            setHistoryTotal(Math.max(0, (hr.data.total ?? 0) - 1));
          })
          .catch(() => {})
          .finally(() => setHistoryLoading(false));
      }
      setSelectedHostId(response.data.host?.id ?? '');
      if (response.data.visitor) {
        setEditForm({
          firstName:   response.data.visitor.firstName   || '',
          lastName:    response.data.visitor.lastName    || '',
          email:       response.data.visitor.email       || '',
          phone:       response.data.visitor.phone       || '',
          company:     response.data.visitor.company     || '',
          position:    response.data.visitor.position    || '',
          nationality: response.data.visitor.nationality || '',
        });
      }
      const toLocal = (iso: string | null | undefined) => {
        if (!iso) return '';
        const d = new Date(iso);
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      };
      setEditVisitForm({
        purpose:      response.data.purpose      || '',
        visitorType:  response.data.visitorType  || 'WALK_IN',
        scheduledAt:  toLocal(response.data.scheduledAt),
        expectedEndAt: toLocal(response.data.expectedEndAt),
        autoCheckoutEnabled: !!response.data.autoCheckoutEnabled,
      });
      setEditAccessGroups(Array.isArray(response.data.accessGroups) ? response.data.accessGroups : []);
    } catch (err) {
      console.error('Failed to load visit detail:', err);
    } finally {
      setLoading(false);
    }
  }, [visitId]);

  useEffect(() => {
    if (isOpen && visitId) {
      setVisit(null);
      fetchVisitDetail();
      setIsEditing(false);
      setToast(null);
      setNewPhotoDataUrl(null);
      setNewFaceBox(null);
      setPhotoValidation('idle');
      setPhotoIssues([]);
      setShowAddCredential(false);
      setShowCredHistory(false);
      setPhotoKey(0);
    }
  }, [isOpen, visitId, fetchVisitDetail]);

  useEffect(() => {
    if (!isEditing) return;
    setAutoCheckoutTouched(false);
    setHostsLoading(true);
    api.get('/hosts?active=true')
      .then(r => setHosts(Array.isArray(r.data) ? r.data : []))
      .catch(() => setHosts([]))
      .finally(() => setHostsLoading(false));
    setGroupsLoading(true);
    setGroupsError(false);
    api.get('/access-groups')
      .then(r => setAvailableGroups(Array.isArray(r.data) ? r.data : []))
      .catch(() => setGroupsError(true))
      .finally(() => setGroupsLoading(false));
    api.get('/visitors/settings/auto-checkout/visitor-types')
      .then(r => setAutoCheckoutDefaults(r.data && typeof r.data === 'object' ? r.data : {}))
      .catch(() => setAutoCheckoutDefaults({}));
  }, [isEditing]);

  // ── Image compression helper ─────────────────────────────────────────────────
  const compressImage = (dataUrl: string, maxPx = 1200, quality = 0.85): Promise<string> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = dataUrl;
    });

  // ── File upload handler (with biometric quality check) ───────────────────────
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png'];
    if (!ALLOWED_TYPES.includes(file.type)) {
      setToast({ type: 'error', message: 'Solo se permiten archivos JPG, JPEG o PNG (estándar Suprema BioStar).' });
      return;
    }
    const MAX_SIZE_MB = 10;
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setToast({ type: 'error', message: `La imagen supera el límite de ${MAX_SIZE_MB} MB permitido por Suprema BioStar.` });
      return;
    }

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const raw = ev.target?.result as string;
      const dataUrl = await compressImage(raw);
      setNewPhotoDataUrl(dataUrl);
      setPhotoValidation('validating');
      setPhotoIssues([]);

      try {
        await ensureFaceApiLoaded();
        const result = await analyzeFaceQuality(dataUrl);

        if (!result.passed) {
          setPhotoIssues(result.issues.filter(i => i.severity === 'error'));
          setPhotoValidation('rejected');
          setNewFaceBox(null);
          return;
        }

        // Store faceBox for backend Visual Face cropping
        if (result.faceBox) setNewFaceBox(result.faceBox);

        // Backend BioStar validation
        try {
          const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
          await api.post('/visitors/validate-face', { imageBase64: `data:image/jpeg;base64,${base64}` });
        } catch (err: any) {
          if (err.response?.status === 400) {
            setPhotoIssues([{
              code: 'BIOSTAR_REJECTED',
              message: err.response.data.message || t('face.errorBiostar'),
              severity: 'error',
            }]);
            setPhotoValidation('rejected');
            setNewFaceBox(null);
            return;
          }
          // If BioStar not configured, allow anyway (non-critical)
        }

        setPhotoValidation('accepted');
      } catch {
        // If face API fails to load, allow the photo (graceful degradation)
        setPhotoValidation('accepted');
      }
    };
    reader.readAsDataURL(file);
  };

  // FaceCaptureModal callback — photo already passed all quality checks inside modal
  const handleFaceCapture = async (imageDataUrl: string) => {
    const compressed = await compressImage(imageDataUrl, 1200, 0.85);
    setNewPhotoDataUrl(compressed);
    setPhotoValidation('accepted');
    setPhotoIssues([]);
    setShowFaceCapture(false);
    // Detect faceBox for backend Visual Face cropping (fire-and-forget, non-blocking)
    ensureFaceApiLoaded().then(() => detectFaceBox(compressed)).then((box) => {
      setNewFaceBox(box ?? null);
    }).catch(() => setNewFaceBox(null));
  };

  const discardNewPhoto = () => {
    setNewPhotoDataUrl(null);
    setNewFaceBox(null);
    setPhotoValidation('idle');
    setPhotoIssues([]);
  };

  // ── Save visitor ──────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!visit?.visitor?.id) return;

    if (newPhotoDataUrl && photoValidation !== 'accepted') {
      setToast({ type: 'error', message: 'La foto no pasó la validación biométrica. Captura o sube una nueva.' });
      return;
    }

    setSaving(true);
    setToast(null);
    try {
      // Filtrar campos vacíos — @IsEmail y otros validadores rechazan '' (no undefined)
      const payload: any = {};
      (Object.entries(editForm) as [string, string][]).forEach(([k, v]) => {
        if (v !== '') payload[k] = v;
      });
      if (newPhotoDataUrl && photoValidation === 'accepted') {
        payload.photoBase64 = newPhotoDataUrl.replace(/^data:image\/\w+;base64,/, '');
        if (newFaceBox) payload.faceBox = newFaceBox;
      }
      await api.patch(`/visitors/${visit.visitor.id}`, payload);

      await api.patch(`/visitors/visit/${visit.id}`, {
        hostId: selectedHostId || null,
        purpose: editVisitForm.purpose || null,
        visitorType: editVisitForm.visitorType || null,
        scheduledAt: editVisitForm.scheduledAt ? new Date(editVisitForm.scheduledAt).toISOString() : null,
        expectedEndAt: editVisitForm.expectedEndAt ? new Date(editVisitForm.expectedEndAt).toISOString() : null,
        accessGroups: editAccessGroups,
        autoCheckoutEnabled: editVisitForm.autoCheckoutEnabled,
      });

      setToast({ type: 'success', message: t('detail.saveSuccess') });
      setIsEditing(false);
      setPhotoValidation('idle');
      setPhotoIssues([]);
      await fetchVisitDetail();
      setPhotoKey(k => k + 1);
      setNewPhotoDataUrl(null);
      setNewFaceBox(null);
      onUpdated?.();
    } catch {
      setToast({ type: 'error', message: t('detail.saveError') });
    } finally {
      setSaving(false);
    }
  };

  // ── Enrollers & device capability ────────────────────────────────────────────
  useEffect(() => {
    if (!showAddCredential || enrollersLoaded) return;
    api.get('/settings/enrollers')
      .then(r => { setEnrollers(Array.isArray(r.data) ? r.data : []); setEnrollersLoaded(true); })
      .catch(() => { setEnrollers([]); setEnrollersLoaded(true); });
  }, [showAddCredential, enrollersLoaded]);

  useEffect(() => {
    if (!selectedEnrollerId) { setDeviceCap(null); return; }
    setDeviceCapLoading(true);
    // Cambiar de dispositivo borra cualquier scan previo (evita cross-contamination de templates)
    setScannedData(null);
    setScanError(null);
    setCredCardNumber('');
    if (scanAbortRef.current) { scanAbortRef.current.abort(); scanAbortRef.current = null; }
    api.get(`/devices/${selectedEnrollerId}/capability`)
      .then(r => {
        setDeviceCap(r.data);
        // Si el credType actual no es compatible con el nuevo dispositivo, resetear al primero compatible
        const cap = r.data as DeviceCap;
        const supported = credTypeCompatible(credType, cap);
        if (!supported) {
          const first = CREDENTIAL_TYPES.find(ct => credTypeCompatible(ct.value, cap));
          if (first) setCredType(first.value);
        }
      })
      .catch(() => setDeviceCap(null))
      .finally(() => setDeviceCapLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEnrollerId]);

  // Limpiar datos de scan al cambiar tipo de credencial (evita cross-contamination entre tipos)
  // También limpiar el enrolador seleccionado si no es compatible con el nuevo tipo
  useEffect(() => {
    setScannedData(null);
    setScanError(null);
    if (scanning) {
      scanAbortRef.current?.abort();
      setScanning(false);
      scanAbortRef.current = null;
    }
    // Si el enrolador actualmente seleccionado no es del tipo requerido, deseleccionarlo
    if (selectedEnrollerId && enrollers.length > 0) {
      const scanCap = CREDENTIAL_TYPES.find(ct => ct.value === credType)?.scanCap;
      if (scanCap) {
        const stillValid = enrollers.some(e => e.deviceId === selectedEnrollerId && e.type === scanCap);
        if (!stillValid) setSelectedEnrollerId('');
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credType]);

  const credTypeCompatible = (type: string, cap: DeviceCap | null): boolean => {
    if (!cap) return true;
    switch (type) {
      case 'RFID':            return cap.card;
      case 'SMART_CARD':      return cap.card;
      case 'QR_JWT':          return true; // siempre: es generado por servidor
      case 'VISUAL_FACE':     return cap.face;
      case 'FINGERPRINT_REF': return cap.fingerprint;
      default:                return true;
    }
  };

  const resetAddCredential = (open: boolean) => {
    setShowAddCredential(open);
    if (!open) {
      setSelectedEnrollerId('');
      setDeviceCap(null);
      setCredCardNumber('');
      setScanning(false);
      setScanError(null);
      setScannedData(null);
      if (scanAbortRef.current) { scanAbortRef.current.abort(); scanAbortRef.current = null; }
    }
  };

  const handleDeviceScan = async () => {
    if (!selectedEnrollerId) return;
    scanAbortRef.current?.abort();
    const ctrl = new AbortController();
    scanAbortRef.current = ctrl;
    setScanning(true);
    setScanError(null);
    setScannedData(null);
    setCredCardNumber('');

    try {
      let res: any;
      if (credType === 'RFID' || credType === 'SMART_CARD') {
        res = await api.post(`/devices/${selectedEnrollerId}/scan-card`, {}, { signal: ctrl.signal });
        const data = res.data ?? {};
        const cardId: string = data.cardId || data.card_id || '';
        setCredCardNumber(cardId);
        // Auto-detect card subtype from BioStar response
        if (credType === 'RFID') {
          const rawType: string = data.cardType || data.card_type || '';
          // BioStar 2 numeric codes: "0"=CSN, "1"=Wiegand, "2"=Smart/Secure
          // BioStar X text codes: "CSN_CARD", "WIEGAND_CARD", "MOBILE_CSN", etc.
          const upper = rawType.toUpperCase();
          // BioStar 2 numeric codes confirmed on FaceStation F2:
          // "0" = Unknown/empty, "1" = CSN (Mifare UID / HID CSN), "2" = Wiegand
          if (rawType === '0') setCredCardSubtype('CSN');
          else if (rawType === '1') setCredCardSubtype('CSN');
          else if (rawType === '2') setCredCardSubtype('WIEGAND');
          else if (upper.includes('WIEGAND')) setCredCardSubtype('WIEGAND');
          else if (upper.includes('MOBILE')) setCredCardSubtype('MOBILE_CSN');
          else if (upper.includes('CSN')) setCredCardSubtype('CSN');
          // unknown type → leave current selection unchanged
        }
      } else if (credType === 'VISUAL_FACE') {
        res = await api.get(`/devices/${selectedEnrollerId}/scan-face-credential`, { signal: ctrl.signal });
        setScannedData(res.data);
      } else if (credType === 'FINGERPRINT_REF') {
        res = await api.post(`/devices/${selectedEnrollerId}/scan-fingerprint-credential`, {}, { signal: ctrl.signal });
        setScannedData(res.data);
      }
    } catch (err: any) {
      if (err.name === 'CanceledError' || err.name === 'AbortError' || err.code === 'ERR_CANCELED') return;
      setScanError(err.response?.data?.message || 'Error al escanear. Verifique que el dispositivo esté listo.');
    } finally {
      setScanning(false);
      scanAbortRef.current = null;
    }
  };

  // ── Credential actions ────────────────────────────────────────────────────────
  const handleAddCredential = async () => {
    if (!visit) return;
    setAddingCred(true);
    try {
      const payload: any = { type: credType };
      if (credCardNumber.trim()) payload.cardNumber = credCardNumber;
      if (credType === 'RFID') payload.cardSubtype = credCardSubtype;
      if (credType === 'VISUAL_FACE' && scannedData) payload.faceTemplates = scannedData;
      if (credType === 'FINGERPRINT_REF' && scannedData) payload.fingerprintTemplate = scannedData;
      const res = await api.post(`/visitors/visit/${visit.id}/credentials`, payload);
      setCredentials(prev => [...prev, res.data]);
      resetAddCredential(false);
      setCredType('RFID');
      setCredCardSubtype('CSN');
    } catch (err: any) {
      setToast({ type: 'error', message: err.response?.data?.message || 'Error al agregar credencial.' });
    } finally {
      setAddingCred(false);
    }
  };

  const handleRevokeCredential = async (credId: string) => {
    if (!confirm('¿Revocar esta credencial? El acceso quedará bloqueado en BioStar en la próxima sincronización.')) return;
    setRevokingId(credId);
    try {
      await api.delete(`/visitors/credentials/${credId}`);
      setCredentials(prev => prev.map(c => c.id === credId ? { ...c, isRevoked: true } : c));
    } catch {
      setToast({ type: 'error', message: 'Error al revocar la credencial.' });
    } finally {
      setRevokingId(null);
    }
  };

  // ── BioStar sync ──────────────────────────────────────────────────────────────
  const handleForceSync = async () => {
    if (!visit) return;
    setIsSyncing(true);
    setToast(null);
    try {
      const response = await api.post(`/visitors/visit/${visit.id}/force-sync`);
      const result = response.data;
      setToast({ type: result.success ? 'success' : 'error', message: result.message });
      await fetchVisitDetail();
      onUpdated?.();
    } catch (err: any) {
      setToast({ type: 'error', message: err?.response?.data?.message || 'Error al intentar sincronizar con BioStar.' });
    } finally {
      setIsSyncing(false);
    }
  };

  // ── Asset verification ──────────────────────────────────────────────────────
  const [verifyingAssetId, setVerifyingAssetId] = useState<string | null>(null);

  const handleVerifyAsset = async (assetId: string, verified: boolean) => {
    if (!visit) return;
    setVerifyingAssetId(assetId);
    try {
      await api.patch(`/visitors/visit/${visit.id}/assets/${assetId}/verify`, { verified });
      await fetchVisitDetail();
    } catch (err: any) {
      setToast({ type: 'error', message: err?.response?.data?.message || 'Error al verificar el activo.' });
    } finally {
      setVerifyingAssetId(null);
    }

  // ── Vehicle verification ─────────────────────────────────────────────────────
  };
  const [verifyingVehicleId, setVerifyingVehicleId] = useState<string | null>(null);

  const handleVerifyVehicle = async (vehicleId: string, verified: boolean) => {
    if (!visit) return;
    setVerifyingVehicleId(vehicleId);
    try {
      await api.patch(`/visitors/visit/${visit.id}/vehicles/${vehicleId}/verify`, { verified });
      await fetchVisitDetail();
    } catch (err: any) {
      setToast({ type: 'error', message: err?.response?.data?.message || 'Error al verificar el vehículo.' });
    } finally {
      setVerifyingVehicleId(null);
    }
  };

  // ── Badge print ───────────────────────────────────────────────────────────────
  const [showBadgeModal, setShowBadgeModal] = useState(false);
  const [badgeAutoTrigger, setBadgeAutoTrigger] = useState(false);
  const [autoPrintEnabled, setAutoPrintEnabled] = useState(false);
  const [showFingerprintModal, setShowFingerprintModal] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    api.get<{ enabled: boolean }>('/visitors/settings/auto-print')
      .then(r => setAutoPrintEnabled(r.data.enabled))
      .catch(() => setAutoPrintEnabled(false));
  }, [isOpen]);

  // ── Check-in / Check-out actions ─────────────────────────────────────────────
  const [isActioning, setIsActioning] = useState(false);
  const [showCheckInModal, setShowCheckInModal] = useState(false);

  const handleCheckIn = () => {
    if (!visit) return;
    setShowCheckInModal(true);
  };

  const handleCheckInSuccess = async () => {
    setShowCheckInModal(false);
    setToast({ type: 'success', message: 'Check-in realizado correctamente.' });
    await fetchVisitDetail();
    onUpdated?.();
    if (autoPrintEnabled) {
      setBadgeAutoTrigger(true);
      setShowBadgeModal(true);
    }
  };

  const handleCheckOut = async () => {
    if (!visit) return;
    setIsActioning(true);
    setToast(null);
    try {
      await api.put(`/visitors/checkout/${visit.id}`);
      setToast({ type: 'success', message: 'Check-out realizado correctamente.' });
      await fetchVisitDetail();
      onUpdated?.();
    } catch (err: any) {
      setToast({ type: 'error', message: err?.response?.data?.message || 'Error al realizar el check-out.' });
    } finally {
      setIsActioning(false);
    }
  };

  const handleClose = () => {
    setIsEditing(false);
    setToast(null);
    setVisit(null);
    setNewPhotoDataUrl(null);
    setNewFaceBox(null);
    setPhotoValidation('idle');
    setPhotoIssues([]);
    setShowAddCredential(false);
    setShowFaceCapture(false);
    onClose();
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setNewPhotoDataUrl(null);
    setNewFaceBox(null);
    setPhotoValidation('idle');
    setPhotoIssues([]);
    setShowAddCredential(false);
    if (visit?.visitor) {
      setEditForm({
        firstName:   visit.visitor.firstName   || '',
        lastName:    visit.visitor.lastName    || '',
        email:       visit.visitor.email       || '',
        phone:       visit.visitor.phone       || '',
        company:     visit.visitor.company     || '',
        position:    visit.visitor.position    || '',
        nationality: visit.visitor.nationality || '',
      });
    }
    if (visit) {
      const toLocal = (iso: string | null | undefined) => {
        if (!iso) return '';
        const d = new Date(iso);
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      };
      setEditVisitForm({
        purpose:      visit.purpose      || '',
        visitorType:  visit.visitorType  || 'WALK_IN',
        scheduledAt:  toLocal(visit.scheduledAt),
        expectedEndAt: toLocal(visit.expectedEndAt),
        autoCheckoutEnabled: !!visit.autoCheckoutEnabled,
      });
      setEditAccessGroups(Array.isArray(visit.accessGroups) ? visit.accessGroups : []);
    }
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return t('detail.notAvailable');
    return new Date(dateStr).toLocaleString();
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'SCHEDULED':      return 'bg-amber-100 text-amber-800';
      case 'PRE_REGISTERED': return 'bg-amber-100 text-amber-800';
      case 'CHECKED_IN':     return 'bg-emerald-100 text-emerald-800';
      case 'CHECKED_OUT':    return 'bg-gray-100 text-gray-800';
      case 'NO_SHOW':        return 'bg-purple-100 text-purple-800';
      case 'CANCELLED':      return 'bg-red-100 text-red-800';
      default:               return 'bg-gray-100 text-gray-800';
    }
  };

  const statusLabel = (status: string) => {
    const labels: Record<string, string> = {
      SCHEDULED:      'Agendado',
      PRE_REGISTERED: 'Pre-registrado',
      CHECKED_IN:     'En edificio',
      CHECKED_OUT:    'Checkout',
      NO_SHOW:        'No-Show',
      CANCELLED:      'Cancelado',
    };
    return labels[status] ?? status.replace(/_/g, ' ');
  };

  const selectedCredType = CREDENTIAL_TYPES.find(c => c.value === credType);
  // Filtrar enroladores por el tipo de credencial seleccionado (card/face/fingerprint)
  const relevantEnrollers = selectedCredType?.scanCap
    ? enrollers.filter(e => e.type === selectedCredType.scanCap)
    : enrollers;
  const revokedCredCount = credentials.filter(c => c.isRevoked).length;
  const visibleCredentials = showCredHistory ? credentials : credentials.filter(c => !c.isRevoked);

  if (!isOpen) return null;

  // photoKey is incremented on every successful save so AuthImage always re-fetches
  // even when updatedAt hasn't changed due to React batching timing.
  const photoSrc = visit?.visitor?.id && visit.visitor.photoPath
    ? `/visitors/${visit.visitor.id}/photo?v=${visit.visitor.updatedAt ? new Date(visit.visitor.updatedAt).getTime() : 1}&k=${photoKey}`
    : null;

  return (
    <>
      {/* FaceCaptureModal — uses the full biometric quality pipeline */}
      <FaceCaptureModal
        isOpen={showFaceCapture}
        onClose={() => setShowFaceCapture(false)}
        onCapture={handleFaceCapture}
      />

      {/* PrintBadgeModal — thermal badge (Sewoo LK-B30IIE) */}
      <PrintBadgeModal
        isOpen={showBadgeModal}
        onClose={() => { setShowBadgeModal(false); setBadgeAutoTrigger(false); }}
        visitId={visit?.id ?? null}
        autoTrigger={badgeAutoTrigger}
      />

      {/* FingerprintEnrollModal — Suprema BioMini Slim 2 */}
      <FingerprintEnrollModal
        isOpen={showFingerprintModal}
        onClose={() => setShowFingerprintModal(false)}
        visitId={visit?.id ?? null}
        visitorName={visit?.visitor ? `${visit.visitor.firstName} ${visit.visitor.lastName}` : undefined}
      />

      {/* CheckInModal — recoge entrada/salida programada antes de confirmar check-in */}
      {showCheckInModal && visit && (
        <CheckInModal
          visitId={visit.id}
          visitorName={visit.visitor ? `${visit.visitor.firstName} ${visit.visitor.lastName}` : 'Visitante'}
          onClose={() => setShowCheckInModal(false)}
          onSuccess={handleCheckInSuccess}
        />
      )}

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleClose} />

        <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-suprema-gray-100 bg-gradient-to-r from-suprema-burgundy to-suprema-burgundy-dark">
            <h2 className="text-lg font-bold text-white">{t('detail.title')}</h2>
            <button onClick={handleClose} className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors">
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-suprema-burgundy" />
              </div>
            ) : visit ? (
              <>
                {toast && (
                  <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                    {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                    {toast.message}
                  </div>
                )}

                {/* ── Visitor header ───────────────────────────────────────── */}
                <div className="flex items-start gap-4">
                  {/* Photo */}
                  <div className="flex-shrink-0">
                    {/* Show new local preview if available */}
                    {newPhotoDataUrl ? (
                      <div
                        className="relative group cursor-pointer"
                        onClick={() => setPhotoLightboxOpen(true)}
                        title="Ver foto completa"
                      >
                        <img
                          src={newPhotoDataUrl}
                          alt="Nueva foto"
                          className={`h-16 w-16 rounded-full object-cover border-2 ${
                            photoValidation === 'accepted' ? 'border-emerald-400' :
                            photoValidation === 'rejected' ? 'border-red-400 opacity-60' :
                            'border-amber-400'
                          }`}
                        />
                        <div className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
                          <ZoomIn size={18} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        {photoValidation === 'validating' && (
                          <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                            <Loader2 size={16} className="text-white animate-spin" />
                          </div>
                        )}
                        {photoValidation === 'accepted' && (
                          <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-white">
                            <CheckCircle2 size={11} className="text-white" />
                          </div>
                        )}
                        {photoValidation === 'rejected' && (
                          <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center border-2 border-white">
                            <XCircle size={11} className="text-white" />
                          </div>
                        )}
                      </div>
                    ) : photoSrc && visit.visitor?.photoPath ? (
                      <div
                        className="relative group cursor-pointer"
                        onClick={() => setPhotoLightboxOpen(true)}
                        title="Ver foto completa"
                      >
                        <AuthImage
                          src={photoSrc}
                          alt={`${visit.visitor.firstName} ${visit.visitor.lastName}`}
                          className="h-16 w-16 rounded-full object-cover border-2 border-suprema-gray-200"
                          fallback={
                            <div className="h-16 w-16 rounded-full bg-suprema-gray-100 flex items-center justify-center text-2xl font-bold text-suprema-gray-800/50">
                              {visit.visitor?.firstName?.[0] || 'V'}
                            </div>
                          }
                        />
                        <div className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
                          <ZoomIn size={18} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                    ) : (
                      <div className="h-16 w-16 rounded-full bg-suprema-gray-100 flex items-center justify-center text-2xl font-bold text-suprema-gray-800/50">
                        {visit.visitor?.firstName?.[0] || 'V'}
                      </div>
                    )}
                  </div>

                  {/* Hidden file input */}
                  <input ref={fileInputRef} type="file" accept="image/jpeg,image/jpg,image/png" className="hidden" onChange={handleFileSelect} />

                  <div className="flex-1 min-w-0">
                    <h3 className="text-xl font-bold text-suprema-gray-900">
                      {visit.visitor?.firstName} {visit.visitor?.lastName}
                    </h3>
                    <p className="text-sm text-suprema-gray-800/60">
                      {visit.visitor?.company || t('detail.notAvailable')}
                      {visit.visitor?.position ? ` — ${visit.visitor.position}` : ''}
                    </p>

                    {/* Photo controls — only in edit mode */}
                    {isEditing && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        <button
                          onClick={() => setShowFaceCapture(true)}
                          className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-suprema-gray-200 hover:border-suprema-burgundy hover:text-suprema-burgundy text-suprema-gray-700 font-semibold transition-colors"
                        >
                          <Camera size={12} /> Tomar foto
                        </button>
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          disabled={photoValidation === 'validating'}
                          className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-suprema-gray-200 hover:border-suprema-burgundy hover:text-suprema-burgundy text-suprema-gray-700 font-semibold transition-colors disabled:opacity-50"
                        >
                          {photoValidation === 'validating' ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                          {photoValidation === 'validating' ? 'Validando...' : 'Subir foto'}
                        </button>
                        {newPhotoDataUrl && (
                          <button
                            onClick={discardNewPhoto}
                            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 font-semibold transition-colors"
                          >
                            <X size={12} /> Descartar
                          </button>
                        )}
                      </div>
                    )}

                    {/* Photo validation feedback */}
                    {isEditing && photoValidation === 'rejected' && photoIssues.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {photoIssues.map((issue, idx) => (
                          <div key={idx} className="flex items-start gap-1.5 p-2 bg-red-50 border border-red-200 rounded-lg">
                            <XCircle size={12} className="text-red-500 mt-0.5 flex-shrink-0" />
                            <p className="text-xs text-red-800 font-medium">{issue.message}</p>
                          </div>
                        ))}
                        <p className="text-xs text-red-600 font-semibold">Usa el botón "Tomar foto" para una captura guiada.</p>
                      </div>
                    )}
                    {isEditing && photoValidation === 'accepted' && (
                      <p className="mt-1 text-xs text-emerald-700 font-semibold flex items-center gap-1">
                        <CheckCircle2 size={11} /> Foto validada — se guardará al confirmar
                      </p>
                    )}
                  </div>

                  {!isEditing && (
                    <div className="flex flex-col gap-2 flex-shrink-0">
                      <button
                        onClick={() => {
                          // Auto-configurar scheduledAt con la hora actual al entrar en edición
                          const now = new Date();
                          now.setSeconds(0, 0);
                          const pad = (n: number) => String(n).padStart(2, '0');
                          const nowLocal = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
                          setEditVisitForm(f => ({
                            ...f,
                            scheduledAt: nowLocal,
                            // Limpiar salida si es anterior a la nueva entrada
                            expectedEndAt: f.expectedEndAt && new Date(f.expectedEndAt) > now ? f.expectedEndAt : '',
                          }));
                          setIsEditing(true);
                        }}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl border border-suprema-gray-200 text-suprema-gray-900 hover:border-suprema-burgundy hover:text-suprema-burgundy hover:bg-suprema-burgundy/5 transition-colors font-semibold text-sm"
                      >
                        <Pencil size={14} />
                        {t('detail.edit')}
                      </button>

                      <button
                        onClick={() => { setBadgeAutoTrigger(false); setShowBadgeModal(true); }}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl border border-suprema-gray-200 text-suprema-gray-900 hover:border-suprema-burgundy hover:text-suprema-burgundy hover:bg-suprema-burgundy/5 transition-colors font-semibold text-sm"
                        title="Imprimir gafete físico (Sewoo LK-B30IIE)"
                      >
                        <Printer size={14} />
                        Gafete
                      </button>

                      <button
                        onClick={() => setShowFingerprintModal(true)}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl border border-suprema-gray-200 text-suprema-gray-900 hover:border-[#6366f1] hover:text-[#6366f1] hover:bg-indigo-50 transition-colors font-semibold text-sm"
                        title="Enrolar huellas dactilares (BioMini Slim 2)"
                      >
                        <Fingerprint size={14} />
                        Huellas
                      </button>

                      {(visit.status === 'SCHEDULED' || visit.status === 'PRE_REGISTERED' || visit.status === 'CHECKED_OUT') && (
                        <button
                          onClick={handleCheckIn}
                          disabled={isActioning}
                          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white transition-colors font-semibold text-sm disabled:opacity-60"
                        >
                          {isActioning ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
                          Check-in
                        </button>
                      )}

                      {visit.status === 'CHECKED_IN' && (
                        <button
                          onClick={handleCheckOut}
                          disabled={isActioning}
                          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-suprema-burgundy hover:bg-suprema-burgundy-dark text-white transition-colors font-semibold text-sm disabled:opacity-60"
                        >
                          {isActioning ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
                          Check-out
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Visit Info ───────────────────────────────────────────── */}
                <div>
                  <h4 className="text-sm font-bold text-suprema-gray-800/50 uppercase tracking-wider mb-3">{t('detail.visitInfo')}</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-suprema-gray-100/30 rounded-xl p-4">
                    {/* Tipo de Visitante */}
                    <div>
                      <span className="block text-xs font-semibold text-suprema-gray-800/50 mb-1">Tipo de Visitante</span>
                      {isEditing ? (
                        <select
                          value={editVisitForm.visitorType}
                          onChange={e => {
                            const newType = e.target.value;
                            setEditVisitForm(f => ({
                              ...f,
                              visitorType: newType,
                              autoCheckoutEnabled: autoCheckoutTouched ? f.autoCheckoutEnabled : !!autoCheckoutDefaults[newType],
                            }));
                          }}
                          className="w-full px-3 py-2 border border-suprema-gray-300 rounded-lg text-sm text-suprema-gray-900 bg-white focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none"
                        >
                          {Object.entries(visitorTypeLabels).map(([val, meta]) => (
                            <option key={val} value={val}>{meta.icon} {meta.label}</option>
                          ))}
                        </select>
                      ) : (
                        (() => {
                          const meta = visitorTypeLabels[visit.visitorType ?? 'WALK_IN'] ?? visitorTypeLabels.WALK_IN;
                          return (
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${meta.color}`}>
                              <span>{meta.icon}</span> {meta.label}
                            </span>
                          );
                        })()
                      )}
                    </div>

                    {/* Motivo de visita */}
                    <div>
                      <span className="block text-xs font-semibold text-suprema-gray-800/50 mb-1">{t('detail.purpose')}</span>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editVisitForm.purpose}
                          onChange={e => setEditVisitForm(f => ({ ...f, purpose: e.target.value }))}
                          placeholder="Motivo de la visita"
                          className="w-full px-3 py-2 border border-suprema-gray-300 rounded-lg text-sm text-suprema-gray-900 bg-white focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none"
                        />
                      ) : (
                        <span className={`text-sm font-semibold ${visit.purpose ? 'text-suprema-gray-900' : 'text-suprema-gray-400 italic'}`}>
                          {visit.purpose || t('detail.notAvailable')}
                        </span>
                      )}
                    </div>

                    {/* Auto-checkout */}
                    <div className="sm:col-span-2">
                      <span className="block text-xs font-semibold text-suprema-gray-800/50 mb-1">Auto-checkout</span>
                      {isEditing ? (
                        <button
                          type="button"
                          onClick={() => { setAutoCheckoutTouched(true); setEditVisitForm(f => ({ ...f, autoCheckoutEnabled: !f.autoCheckoutEnabled })); }}
                          className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border transition-colors ${
                            editVisitForm.autoCheckoutEnabled
                              ? 'border-suprema-burgundy bg-suprema-burgundy/5'
                              : 'border-suprema-gray-300 bg-white hover:bg-suprema-gray-50'
                          }`}
                        >
                          <span className="text-left">
                            <span className="block text-sm font-semibold text-suprema-gray-800">Auto-checkout</span>
                            <span className="block text-xs text-suprema-gray-500">Cambia el estado a check-out automáticamente al detectar un evento de salida en BioStar o en los dispositivos Suprema</span>
                          </span>
                          <span
                            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                              editVisitForm.autoCheckoutEnabled ? 'bg-suprema-burgundy' : 'bg-suprema-gray-300'
                            }`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                                editVisitForm.autoCheckoutEnabled ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </span>
                        </button>
                      ) : (
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${visit.autoCheckoutEnabled ? 'bg-suprema-burgundy/10 text-suprema-burgundy' : 'bg-suprema-gray-100 text-suprema-gray-500'}`}>
                          {visit.autoCheckoutEnabled ? 'Activado' : 'Desactivado'}
                        </span>
                      )}
                    </div>

                    {/* Orden de Servicio (solo CONTRACTOR, read-only) */}
                    {(visit.visitorType === 'CONTRACTOR' || editVisitForm.visitorType === 'CONTRACTOR') && (
                      <div>
                        <span className="block text-xs font-semibold text-suprema-gray-800/50 mb-1">Orden de Servicio</span>
                        <span className={`text-sm font-semibold ${visit.serviceOrder ? 'text-suprema-gray-900' : 'text-suprema-gray-400 italic'}`}>
                          {visit.serviceOrder || 'No registrada'}
                        </span>
                      </div>
                    )}

                    <InfoRow label={t('detail.host')} value={visit.host?.fullName || visit.hostUser?.fullName || t('detail.notAvailable')} />

                    {/* Fecha de entrada programada */}
                    <div>
                      <span className="block text-xs font-semibold text-suprema-gray-800/50 mb-1">
                        {t('detail.scheduledEntry')} {isEditing && <span className="text-red-500">*</span>}
                      </span>
                      {isEditing ? (
                        <>
                          <input
                            type="datetime-local"
                            value={editVisitForm.scheduledAt}
                            min={(() => {
                              const d = new Date(); d.setSeconds(0, 0);
                              const p = (n: number) => String(n).padStart(2, '0');
                              return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
                            })()}
                            onChange={e => {
                              const newStart = e.target.value;
                              setEditVisitForm(f => ({
                                ...f,
                                scheduledAt: newStart,
                                // Limpiar salida si queda anterior a la nueva entrada
                                expectedEndAt: f.expectedEndAt && new Date(f.expectedEndAt) > new Date(newStart)
                                  ? f.expectedEndAt
                                  : '',
                              }));
                            }}
                            className="w-full px-3 py-2 border border-suprema-gray-300 rounded-lg text-sm text-suprema-gray-900 bg-white focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none"
                          />
                          <p className="text-xs text-slate-400 mt-0.5">Auto-configurada al momento actual. Puede adelantarse.</p>
                        </>
                      ) : (
                        <span className="text-sm font-semibold text-suprema-gray-900">{formatDate(visit.scheduledAt)}</span>
                      )}
                    </div>

                    {/* Fecha de salida programada */}
                    <div>
                      <span className="block text-xs font-semibold text-suprema-gray-800/50 mb-1">
                        {t('detail.scheduledExit')} {isEditing && <span className="text-red-500">*</span>}
                      </span>
                      {isEditing ? (
                        <input
                          type="datetime-local"
                          value={editVisitForm.expectedEndAt}
                          min={(() => {
                            if (!editVisitForm.scheduledAt) return '';
                            const d = new Date(new Date(editVisitForm.scheduledAt).getTime() + 60000);
                            const p = (n: number) => String(n).padStart(2, '0');
                            return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
                          })()}
                          onChange={e => setEditVisitForm(f => ({ ...f, expectedEndAt: e.target.value }))}
                          className="w-full px-3 py-2 border border-suprema-gray-300 rounded-lg text-sm text-suprema-gray-900 bg-white focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none"
                        />
                      ) : (
                        <span className="text-sm font-semibold text-suprema-gray-900">{formatDate(visit.expectedEndAt)}</span>
                      )}
                    </div>

                    <InfoRow label={t('detail.checkInTime')} value={formatDate(visit.checkedInAt)} />
                    <InfoRow label={t('detail.checkOutTime')} value={formatDate(visit.checkedOutAt)} />
                    <InfoRow label={t('detail.accessMethod')} value={visit.accessMethod?.replace('_', ' ') || t('detail.notAvailable')} />
                    <div>
                      <span className="block text-xs font-semibold text-suprema-gray-800/50 mb-1">{t('detail.status')}</span>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-bold ${statusColor(visit.status)}`}>
                        {statusLabel(visit.status)}
                      </span>
                    </div>
                  </div>

                  {/* Notes */}
                  {visit.notes && (
                    <div className="mt-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-amber-600 mb-1">Observaciones / Notas</span>
                      <p className="text-sm text-amber-900 whitespace-pre-wrap">{visit.notes}</p>
                    </div>
                  )}

                  {/* Encuesta de salida */}
                  {(visit.surveyRating != null || visit.surveyComment) && (
                    <div className="mt-3 px-4 py-3 bg-suprema-gray-50 border border-suprema-gray-200 rounded-xl">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-suprema-gray-800/50 mb-1.5">Encuesta de salida</span>
                      {visit.surveyRating != null && (
                        <div className="flex items-center gap-0.5 mb-1">
                          {[1, 2, 3, 4, 5].map(n => (
                            <span key={n} className={`text-sm ${n <= (visit.surveyRating || 0) ? 'text-amber-400' : 'text-suprema-gray-300'}`}>★</span>
                          ))}
                          <span className="text-xs text-suprema-gray-800/50 ml-1">
                            {visit.surveyRespondedAt ? formatDate(visit.surveyRespondedAt) : ''}
                          </span>
                        </div>
                      )}
                      {visit.surveyComment && (
                        <p className="text-sm text-suprema-gray-900 whitespace-pre-wrap">&ldquo;{visit.surveyComment}&rdquo;</p>
                      )}
                    </div>
                  )}

                  {/* Reporte de falsa salida / habilitación temporal */}
                  {(visit.falseExitReportedAt || visit.wasTemporaryReenabled) && (
                    <div className="mt-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl space-y-1">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-red-600 mb-1">Reporte de falsa salida</span>
                      {visit.falseExitReportedAt && (
                        <p className="text-xs text-red-800">Reportado: {formatDate(visit.falseExitReportedAt)}</p>
                      )}
                      {visit.falseExitResolvedAt && (
                        <p className="text-xs text-red-800">Resuelto: {formatDate(visit.falseExitResolvedAt)}</p>
                      )}
                      {visit.temporaryReenableUntil && (
                        <p className="text-xs text-red-800">Acceso temporal vigente hasta: {formatDate(visit.temporaryReenableUntil)}</p>
                      )}
                      {visit.falseExitResolutionNote && (
                        <p className="text-sm text-red-900 whitespace-pre-wrap mt-1">&ldquo;{visit.falseExitResolutionNote}&rdquo;</p>
                      )}
                      {visit.wasTemporaryReenabled && (
                        <p className="text-[11px] text-red-700/70 italic mt-1">Esta visita fue re-habilitada temporalmente tras un auto-checkout erróneo.</p>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Grupos de Acceso ──────────────────────────────────────── */}
                <div>
                  <h4 className="text-sm font-bold text-suprema-gray-800/50 uppercase tracking-wider mb-3">Grupos de Acceso BioStar</h4>
                  {isEditing ? (
                    <div>
                      <AccessGroupSelect
                        groups={availableGroups}
                        selected={editAccessGroups}
                        onChange={setEditAccessGroups}
                        loading={groupsLoading}
                        error={groupsError}
                      />
                      {groupsError && (
                        <p className="mt-1 text-xs text-red-500">No se pudieron cargar los grupos de acceso de BioStar.</p>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {visit.accessGroups && visit.accessGroups.length > 0 ? (
                        visit.accessGroups.map(g => (
                          <span key={g.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-100 text-blue-700">
                            🛡 {g.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-suprema-gray-400 italic">Sin niveles de acceso asignados</span>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Activos del Visitante ────────────────────────────────── */}
                {visit.hasAssets && visit.assets && visit.assets.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Briefcase size={14} className="text-suprema-gray-800/50" />
                      <h4 className="text-sm font-bold text-suprema-gray-800/50 uppercase tracking-wider">Activos del Visitante</h4>
                      <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${
                        visit.assets.every(a => a.verifiedAtCheckout)
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}>
                        {visit.assets.every(a => a.verifiedAtCheckout)
                          ? '✓ Todos verificados'
                          : `${visit.assets.filter(a => a.verifiedAtCheckout).length}/${visit.assets.length} verificados`}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {visit.assets.map(asset => {
                        const categoryLabels: Record<string, string> = {
                          LAPTOP: 'Laptop / PC', TABLET: 'Tablet', PHONE: 'Teléfono',
                          CAMERA: 'Cámara', TOOL: 'Herramienta', USB_DRIVE: 'USB', OTHER: 'Otro',
                        };
                        return (
                          <div key={asset.id} className={`flex items-start justify-between gap-3 px-3 py-2.5 rounded-xl border transition-colors ${asset.verifiedAtCheckout ? 'bg-emerald-50 border-emerald-200' : 'bg-suprema-gray-50 border-suprema-gray-200'}`}>
                            <div className="flex items-start gap-2 min-w-0">
                              {asset.verifiedAtCheckout
                                ? <PackageCheck size={15} className="text-emerald-600 mt-0.5 flex-shrink-0" />
                                : <Package size={15} className="text-suprema-gray-400 mt-0.5 flex-shrink-0" />}
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-suprema-gray-900 truncate">{asset.description}</p>
                                <p className="text-xs text-suprema-gray-800/50">
                                  {categoryLabels[asset.category] || asset.category}
                                  {asset.serialNumber ? ` · S/N: ${asset.serialNumber}` : ''}
                                </p>
                              </div>
                            </div>
                            {visit.status === 'CHECKED_IN' && (
                              <button
                                onClick={() => handleVerifyAsset(asset.id, !asset.verifiedAtCheckout)}
                                disabled={verifyingAssetId === asset.id}
                                className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                                  asset.verifiedAtCheckout
                                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                    : 'border border-suprema-gray-300 text-suprema-gray-600 hover:bg-suprema-gray-100'
                                } disabled:opacity-60`}
                              >
                                {verifyingAssetId === asset.id
                                  ? <Loader2 size={11} className="animate-spin" />
                                  : asset.verifiedAtCheckout ? <CheckCircle2 size={11} /> : null}
                                {asset.verifiedAtCheckout ? 'Verificado' : 'Verificar'}
                              </button>
                            )}
                            {visit.status === 'CHECKED_OUT' && (
                              <span className={`flex-shrink-0 text-xs font-bold px-2 py-1 rounded-lg ${asset.verifiedAtCheckout ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                                {asset.verifiedAtCheckout ? '✓ Verificado' : '✗ No verificado'}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {visit.status === 'CHECKED_IN' && !visit.assets.every(a => a.verifiedAtCheckout) && (
                      <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                        <AlertCircle size={12} /> Verifica todos los activos antes del check-out.
                      </p>
                    )}
                  </div>
                )}

                {/* ── Vehículos del Visitante ──────────────────────────────── */}
                {visit.hasVehicles && visit.vehicles && visit.vehicles.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Car size={14} className="text-suprema-gray-800/50" />
                      <h4 className="text-sm font-bold text-suprema-gray-800/50 uppercase tracking-wider">Vehículos del Visitante</h4>
                      <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${
                        visit.vehicles.every(v => v.verifiedAtCheckout)
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}>
                        {visit.vehicles.every(v => v.verifiedAtCheckout)
                          ? '✓ Todos verificados'
                          : `${visit.vehicles.filter(v => v.verifiedAtCheckout).length}/${visit.vehicles.length} verificados`}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {visit.vehicles.map(vehicle => {
                        const typeLabels: Record<string, string> = {
                          CAR: 'Automóvil', MOTORCYCLE: 'Moto', TRUCK: 'Camión / Camioneta',
                          BICYCLE: 'Bicicleta', OTHER: 'Otro',
                        };
                        const vehicleDesc = [vehicle.brand, vehicle.model, vehicle.color].filter(Boolean).join(' · ');
                        return (
                          <div key={vehicle.id} className={`flex items-start justify-between gap-3 px-3 py-2.5 rounded-xl border transition-colors ${vehicle.verifiedAtCheckout ? 'bg-emerald-50 border-emerald-200' : 'bg-suprema-gray-50 border-suprema-gray-200'}`}>
                            <div className="flex items-start gap-2 min-w-0">
                              {vehicle.verifiedAtCheckout
                                ? <CarFront size={15} className="text-emerald-600 mt-0.5 flex-shrink-0" />
                                : <Car size={15} className="text-suprema-gray-400 mt-0.5 flex-shrink-0" />}
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-suprema-gray-900 font-mono tracking-wider">{vehicle.licensePlate}</p>
                                <p className="text-xs text-suprema-gray-800/50">
                                  {typeLabels[vehicle.vehicleType] || vehicle.vehicleType}
                                  {vehicleDesc ? ` · ${vehicleDesc}` : ''}
                                  {vehicle.parkingZone ? ` · 🅿 ${vehicle.parkingZone}` : ''}
                                </p>
                                {vehicle.hasEntered && (
                                  <span className="inline-block mt-0.5 text-xs font-semibold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Ingresó al parqueadero</span>
                                )}
                              </div>
                            </div>
                            {visit.status === 'CHECKED_IN' && (
                              <button
                                onClick={() => handleVerifyVehicle(vehicle.id, !vehicle.verifiedAtCheckout)}
                                disabled={verifyingVehicleId === vehicle.id}
                                className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                                  vehicle.verifiedAtCheckout
                                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                    : 'border border-suprema-gray-300 text-suprema-gray-600 hover:bg-suprema-gray-100'
                                } disabled:opacity-60`}
                              >
                                {verifyingVehicleId === vehicle.id
                                  ? <Loader2 size={11} className="animate-spin" />
                                  : vehicle.verifiedAtCheckout ? <CheckCircle2 size={11} /> : null}
                                {vehicle.verifiedAtCheckout ? 'Verificado' : 'Verificar'}
                              </button>
                            )}
                            {visit.status === 'CHECKED_OUT' && (
                              <span className={`flex-shrink-0 text-xs font-bold px-2 py-1 rounded-lg ${vehicle.verifiedAtCheckout ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                                {vehicle.verifiedAtCheckout ? '✓ Verificado' : '✗ No verificado'}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {visit.status === 'CHECKED_IN' && !visit.vehicles.every(v => v.verifiedAtCheckout) && (
                      <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                        <AlertCircle size={12} /> Verifica todos los vehículos antes del check-out.
                      </p>
                    )}
                  </div>
                )}

                {/* ── BioStar sync ─────────────────────────────────────────── */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-bold text-suprema-gray-800/50 uppercase tracking-wider">BioStar / Suprema</h4>
                    <button
                      onClick={handleForceSync}
                      disabled={isSyncing}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-suprema-burgundy text-white text-xs font-bold hover:bg-suprema-burgundy-dark disabled:opacity-60 transition-colors shadow-sm shadow-suprema-burgundy/20"
                    >
                      <RefreshCw size={12} className={isSyncing ? 'animate-spin' : ''} />
                      {isSyncing ? 'Sincronizando...' : 'Forzar Sync'}
                    </button>
                  </div>
                  <div className="rounded-xl border border-suprema-gray-100 overflow-hidden">
                    <SyncStatusPanel
                      syncStatus={visit.syncStatus}
                      lastSyncError={visit.lastSyncError}
                      lastSyncAttemptAt={visit.lastSyncAttemptAt}
                      supremaUserRefId={visit.supremaUserRefId}
                    />
                  </div>
                </div>

                {/* ── Host ─────────────────────────────────────────────────── */}
                <div>
                  <h4 className="text-sm font-bold text-suprema-gray-800/50 uppercase tracking-wider mb-3">Anfitrión</h4>
                  {isEditing ? (
                    <div className="space-y-1">
                      <select
                        value={selectedHostId}
                        onChange={e => setSelectedHostId(e.target.value)}
                        disabled={hostsLoading}
                        className="w-full px-3 py-2.5 border border-suprema-gray-300 rounded-lg text-sm text-suprema-gray-900 bg-white focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none transition-colors disabled:opacity-50"
                      >
                        <option value="">— Sin anfitrión —</option>
                        {hosts.map(h => (
                          <option key={h.id} value={h.id}>
                            {h.fullName}{h.department ? ` · ${h.department}` : ''}
                          </option>
                        ))}
                      </select>
                      {hostsLoading && <p className="text-xs text-suprema-gray-800/40">Cargando anfitriones…</p>}
                    </div>
                  ) : (visit.host || visit.hostUser) ? (
                    <HostCard host={visit.host} hostUser={visit.hostUser} />
                  ) : (
                    <p className="text-sm text-suprema-gray-800/40 italic">Sin anfitrión asignado</p>
                  )}
                </div>

                {/* ── Credentials ──────────────────────────────────────────── */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-bold text-suprema-gray-800/50 uppercase tracking-wider">Credenciales de Acceso</h4>
                    <div className="flex items-center gap-2">
                      {revokedCredCount > 0 && (
                        <button
                          onClick={() => setShowCredHistory(v => !v)}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-suprema-gray-200 hover:border-suprema-burgundy hover:text-suprema-burgundy text-suprema-gray-700 font-semibold transition-colors"
                        >
                          <Clock size={12} />
                          {showCredHistory ? 'Ocultar historial' : `Historial de credenciales (${revokedCredCount})`}
                        </button>
                      )}
                      {isEditing && (
                        <button
                          onClick={() => resetAddCredential(!showAddCredential)}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-suprema-gray-200 hover:border-suprema-burgundy hover:text-suprema-burgundy text-suprema-gray-700 font-semibold transition-colors"
                        >
                          <Plus size={12} /> Agregar credencial
                        </button>
                      )}
                    </div>
                  </div>

                  {isEditing && showAddCredential && (
                    <div className="mb-3 p-4 bg-suprema-gray-50 rounded-xl border border-suprema-gray-100 space-y-3">

                      {/* ── Selector de dispositivo enrolador ── */}
                      {relevantEnrollers.length > 0 && (
                        <div>
                          <p className="text-xs font-bold text-suprema-gray-700 mb-1.5">
                            Dispositivo enrolador
                            <span className="ml-1 font-normal text-suprema-gray-800/50">(opcional — filtra tipos compatibles)</span>
                          </p>
                          <div className="relative">
                            <select
                              value={selectedEnrollerId}
                              onChange={e => setSelectedEnrollerId(e.target.value)}
                              className="w-full px-3 py-2 border border-suprema-gray-200 rounded-lg text-sm text-suprema-gray-900 bg-white focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none"
                              disabled={deviceCapLoading}
                            >
                              <option value="">— Sin filtro de dispositivo —</option>
                              {relevantEnrollers.map(e => (
                                <option key={`${e.deviceId}-${e.type}`} value={e.deviceId}>
                                  {e.deviceName} ({e.typeName})
                                </option>
                              ))}
                            </select>
                            {deviceCapLoading && (
                              <Loader2 size={14} className="animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-suprema-burgundy" />
                            )}
                          </div>
                          {deviceCap && (
                            <div className="flex gap-1.5 mt-1.5 flex-wrap">
                              {deviceCap.face        && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">✓ Rostro</span>}
                              {deviceCap.fingerprint && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">✓ Huella</span>}
                              {deviceCap.card        && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">✓ Tarjeta</span>}
                              {deviceCap.qr          && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">✓ QR</span>}
                              {!deviceCap.face        && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold">✗ Rostro</span>}
                              {!deviceCap.fingerprint && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold">✗ Huella</span>}
                              {!deviceCap.card        && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold">✗ Tarjeta</span>}
                            </div>
                          )}
                        </div>
                      )}

                      {/* ── Tipo de credencial ── */}
                      <p className="text-xs font-bold text-suprema-gray-700">Tipo de credencial</p>
                      <div className="flex gap-2 flex-wrap">
                        {CREDENTIAL_TYPES.map(ct => {
                          const Icon = ct.icon;
                          const compatible = credTypeCompatible(ct.value, deviceCap);
                          return (
                            <button
                              key={ct.value}
                              onClick={() => compatible && setCredType(ct.value)}
                              disabled={!compatible}
                              title={!compatible ? `No compatible con ${deviceCap?.deviceName || 'este dispositivo'}` : ct.label}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors
                                ${!compatible
                                  ? 'opacity-40 cursor-not-allowed border-suprema-gray-200 text-suprema-gray-500 bg-suprema-gray-100'
                                  : credType === ct.value
                                    ? 'bg-suprema-burgundy text-white border-suprema-burgundy'
                                    : 'border-suprema-gray-200 text-suprema-gray-700 hover:border-suprema-burgundy hover:text-suprema-burgundy'
                                }`}
                            >
                              <Icon size={12} /> {ct.label}
                              {!compatible && <span className="ml-0.5 text-[9px]">✗</span>}
                            </button>
                          );
                        })}
                      </div>

                      {credType === 'RFID' && (
                        <select
                          value={credCardSubtype}
                          onChange={e => setCredCardSubtype(e.target.value as 'CSN' | 'WIEGAND' | 'MOBILE_CSN')}
                          className="w-full px-3 py-2 border border-suprema-gray-200 rounded-lg text-sm text-suprema-gray-900 bg-white focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none"
                        >
                          <option value="CSN">CSN card</option>
                          <option value="WIEGAND">Wiegand Card</option>
                          <option value="MOBILE_CSN">Mobile CSN Card</option>
                        </select>
                      )}
                      {/* ── Panel de escaneo desde dispositivo ── */}
                      {selectedCredType?.canScan && (() => {
                        const scanLabel =
                          credType === 'RFID' || credType === 'SMART_CARD' ? 'Escanear tarjeta desde dispositivo' :
                          credType === 'VISUAL_FACE' ? 'Capturar rostro desde dispositivo' :
                          credType === 'FINGERPRINT_REF' ? 'Capturar huella desde dispositivo' : '';

                        const compatible = credTypeCompatible(credType, deviceCap);
                        const readyToScan = !!selectedEnrollerId && compatible && !deviceCapLoading;

                        return (
                          <div className="rounded-lg border border-suprema-burgundy/20 bg-suprema-burgundy/5 p-3 space-y-2">
                            <p className="text-[11px] font-bold text-suprema-burgundy uppercase tracking-wide flex items-center gap-1.5">
                              <ScanLine size={12} /> Escaneo desde dispositivo
                            </p>

                            {/* Sin enroladores del tipo requerido configurados */}
                            {enrollersLoaded && relevantEnrollers.length === 0 && (
                              <p className="text-[11px] text-suprema-gray-500">
                                Sin dispositivos enroladores de este tipo.{' '}
                                <a href="/dashboard/settings/enrollers" className="underline hover:text-suprema-burgundy font-semibold">
                                  Configura uno en Ajustes →
                                </a>
                              </p>
                            )}

                            {/* Hay enroladores del tipo correcto pero ninguno seleccionado */}
                            {relevantEnrollers.length > 0 && !selectedEnrollerId && (
                              <p className="text-[11px] text-suprema-burgundy/70">
                                Selecciona un dispositivo enrolador arriba para habilitar el escaneo.
                              </p>
                            )}

                            {/* Cargando capacidades del dispositivo */}
                            {selectedEnrollerId && deviceCapLoading && (
                              <div className="flex items-center gap-2 text-[11px] text-suprema-gray-500">
                                <Loader2 size={11} className="animate-spin" /> Verificando capacidades del dispositivo…
                              </div>
                            )}

                            {/* Dispositivo incompatible con el tipo de credencial */}
                            {selectedEnrollerId && !deviceCapLoading && !compatible && (
                              <p className="text-[11px] text-amber-700 flex items-center gap-1">
                                <AlertCircle size={11} /> Este dispositivo no soporta este tipo de credencial.
                              </p>
                            )}

                            {/* UI de escaneo activa */}
                            {readyToScan && (
                              <>
                                {/* Estado: escaneando */}
                                {scanning && (
                                  <div className="flex items-center justify-between gap-3 py-1">
                                    <div className="flex items-center gap-2 text-xs text-suprema-gray-700">
                                      <Loader2 size={14} className="animate-spin text-suprema-burgundy" />
                                      <span>Esperando escaneo… <span className="text-suprema-gray-500">(máx. 30 s)</span></span>
                                    </div>
                                    <button
                                      onClick={() => { scanAbortRef.current?.abort(); setScanning(false); }}
                                      className="text-[11px] text-suprema-gray-500 hover:text-red-600 font-semibold underline"
                                    >
                                      Cancelar
                                    </button>
                                  </div>
                                )}

                                {/* Estado: error */}
                                {!scanning && scanError && (
                                  <div className="space-y-1.5">
                                    <p className="text-[11px] text-red-600 flex items-center gap-1"><AlertCircle size={11} /> {scanError}</p>
                                    <button
                                      onClick={handleDeviceScan}
                                      className="text-[11px] font-bold text-suprema-burgundy underline"
                                    >
                                      Reintentar
                                    </button>
                                  </div>
                                )}

                                {/* Estado: template biométrico capturado */}
                                {!scanning && !scanError && scannedData && (credType === 'VISUAL_FACE' || credType === 'FINGERPRINT_REF') && (
                                  <div className="space-y-2">
                                    {/* Face preview thumbnail — shown when device provides a normalized image */}
                                    {credType === 'VISUAL_FACE' && (scannedData as any).template_ex_normalized_image && (
                                      <div className="flex flex-col items-center gap-1.5 py-1">
                                        <img
                                          src={`data:image/jpeg;base64,${(scannedData as any).template_ex_normalized_image}`}
                                          alt="Rostro capturado"
                                          className="w-24 h-24 rounded-lg object-cover border-2 border-green-400 shadow-sm"
                                        />
                                        <p className="text-[10px] text-green-700 font-semibold">Vista previa del rostro capturado</p>
                                      </div>
                                    )}
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-1.5 text-xs text-green-700 font-semibold">
                                        <CheckCircle size={14} className="text-green-600" />
                                        {credType === 'VISUAL_FACE' ? 'Template facial capturado' : 'Huella capturada'}
                                      </div>
                                      <button
                                        onClick={handleDeviceScan}
                                        className="text-[11px] font-bold text-suprema-gray-500 hover:text-suprema-burgundy underline"
                                      >
                                        Re-escanear
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {/* Botón principal de escaneo */}
                                {!scanning && !scannedData && (
                                  <button
                                    onClick={handleDeviceScan}
                                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-suprema-burgundy text-white text-xs font-bold hover:bg-suprema-burgundy/90 transition-colors"
                                  >
                                    <ScanLine size={13} /> {scanLabel}
                                  </button>
                                )}

                                {/* Re-escanear para tarjeta (el número ya fue autorellenado) */}
                                {!scanning && credCardNumber && (credType === 'RFID' || credType === 'SMART_CARD') && (
                                  <button
                                    onClick={handleDeviceScan}
                                    className="text-[11px] font-bold text-suprema-gray-500 hover:text-suprema-burgundy underline"
                                  >
                                    Volver a escanear
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })()}

                      {/* Input manual de número de tarjeta */}
                      {selectedCredType?.needsCard && (
                        <input
                          type="text"
                          value={credCardNumber}
                          onChange={e => setCredCardNumber(e.target.value)}
                          placeholder={selectedEnrollerId ? 'Auto-rellenado al escanear, o ingrese manualmente' : 'Número de tarjeta (decimal)'}
                          className="w-full px-3 py-2 border border-suprema-gray-200 rounded-lg text-sm text-suprema-gray-900 bg-white font-mono focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none"
                        />
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => resetAddCredential(false)}
                          className="px-3 py-1.5 text-xs text-suprema-gray-600 hover:bg-suprema-gray-100 rounded-lg font-semibold"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={handleAddCredential}
                          disabled={
                            addingCred ||
                            scanning ||
                            (selectedCredType?.needsCard && !credCardNumber.trim()) ||
                            (credType === 'FINGERPRINT_REF' && !scannedData) ||
                            !credTypeCompatible(credType, deviceCap)
                          }
                          className="px-4 py-1.5 text-xs bg-suprema-burgundy text-white rounded-lg font-bold disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {addingCred ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                          Agregar
                        </button>
                      </div>
                    </div>
                  )}

                  {credentials.length === 0 ? (
                    <p className="text-sm text-suprema-gray-800/40 italic">Sin credenciales registradas.</p>
                  ) : visibleCredentials.length === 0 ? (
                    <p className="text-sm text-suprema-gray-800/40 italic">Sin credenciales activas.</p>
                  ) : (
                    <div className="space-y-2">
                      {visibleCredentials.map(cred => (
                        <CredentialRow
                          key={cred.id}
                          credential={cred}
                          isEditing={isEditing}
                          revoking={revokingId === cred.id}
                          onRevoke={() => handleRevokeCredential(cred.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* ── Historial de Visitas ──────────────────────────────── */}
                {(historyLoading || visitHistory.length > 0) && (
                  <div>
                    <h4 className="text-sm font-bold text-suprema-gray-800/50 uppercase tracking-wider mb-3">
                      Historial de Visitas
                      {historyTotal > 0 && (
                        <span className="ml-2 text-xs font-normal text-suprema-gray-800/40 normal-case">
                          ({historyTotal} anterior{historyTotal !== 1 ? 'es' : ''})
                        </span>
                      )}
                    </h4>
                    {historyLoading ? (
                      <div className="flex items-center gap-2 text-xs text-suprema-gray-800/40 py-2">
                        <Loader2 size={12} className="animate-spin" /> Cargando historial…
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {visitHistory.map(h => {
                          const statusColors: Record<string, string> = {
                            CHECKED_OUT:   'bg-gray-100 text-gray-600',
                            CHECKED_IN:    'bg-emerald-100 text-emerald-700',
                            SCHEDULED:     'bg-blue-100 text-blue-700',
                            PRE_REGISTERED:'bg-violet-100 text-violet-700',
                            CANCELLED:     'bg-red-100 text-red-600',
                            NO_SHOW:       'bg-amber-100 text-amber-700',
                          };
                          const statusLabels: Record<string, string> = {
                            CHECKED_OUT:   'Completada',
                            CHECKED_IN:    'En curso',
                            SCHEDULED:     'Agendada',
                            PRE_REGISTERED:'Pre-registrada',
                            CANCELLED:     'Cancelada',
                            NO_SHOW:       'No se presentó',
                          };
                          const dateStr = h.checkedInAt ?? h.scheduledAt;
                          return (
                            <div key={h.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-suprema-gray-100 bg-suprema-gray-50/50">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${statusColors[h.status] ?? 'bg-gray-100 text-gray-600'}`}>
                                    {statusLabels[h.status] ?? h.status}
                                  </span>
                                  {h.purpose && (
                                    <span className="text-xs text-suprema-gray-700 truncate">{h.purpose}</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                  {dateStr && (
                                    <span className="text-[11px] text-suprema-gray-800/50">
                                      {new Date(dateStr).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                                    </span>
                                  )}
                                  {h.hostName && (
                                    <span className="text-[11px] text-suprema-gray-800/50">· {h.hostName}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Personal Info ─────────────────────────────────────────── */}
                <div>
                  <h4 className="text-sm font-bold text-suprema-gray-800/50 uppercase tracking-wider mb-3">{t('detail.personalInfo')}</h4>
                  {isEditing ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-suprema-gray-100/30 rounded-xl p-4">
                      <EditField label={t('detail.firstName')} value={editForm.firstName} onChange={v => setEditForm(p => ({ ...p, firstName: v }))} />
                      <EditField label={t('detail.lastName')}  value={editForm.lastName}  onChange={v => setEditForm(p => ({ ...p, lastName: v }))} />
                      <EditField label={t('detail.email')}     value={editForm.email}     onChange={v => setEditForm(p => ({ ...p, email: v }))} type="email" />
                      <EditField label={t('detail.phone')}     value={editForm.phone}     onChange={v => setEditForm(p => ({ ...p, phone: v }))} />
                      <EditField label={t('detail.company')}   value={editForm.company}   onChange={v => setEditForm(p => ({ ...p, company: v }))} />
                      <EditField label={t('detail.position')}  value={editForm.position}  onChange={v => setEditForm(p => ({ ...p, position: v }))} />
                      <EditField label={t('detail.nationality')} value={editForm.nationality} onChange={v => setEditForm(p => ({ ...p, nationality: v }))} />
                      <InfoRow label={t('detail.documentType')} value={t(DOC_TYPE_KEYS[visit.visitor?.documentType || ''] || 'detail.docOther')} />
                      <InfoRow label={t('detail.documentNumber')} value={visit.visitor?.documentNumber || t('detail.notAvailable')} />
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-suprema-gray-100/30 rounded-xl p-4">
                      <InfoRow label={t('detail.firstName')} value={visit.visitor?.firstName || t('detail.notAvailable')} />
                      <InfoRow label={t('detail.lastName')}  value={visit.visitor?.lastName  || t('detail.notAvailable')} />
                      <InfoRow label={t('detail.email')}     value={visit.visitor?.email     || t('detail.notAvailable')} />
                      <InfoRow label={t('detail.phone')}     value={visit.visitor?.phone     || t('detail.notAvailable')} />
                      <InfoRow label={t('detail.company')}   value={visit.visitor?.company   || t('detail.notAvailable')} />
                      <InfoRow label={t('detail.position')}  value={visit.visitor?.position  || t('detail.notAvailable')} />
                      <InfoRow label={t('detail.nationality')} value={visit.visitor?.nationality || t('detail.notAvailable')} />
                      <InfoRow label={t('detail.documentType')} value={t(DOC_TYPE_KEYS[visit.visitor?.documentType || ''] || 'detail.docOther')} />
                      <InfoRow label={t('detail.documentNumber')} value={visit.visitor?.documentNumber || t('detail.notAvailable')} />
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-suprema-gray-100 flex justify-end gap-3">
            {isEditing ? (
              <>
                <button
                  onClick={cancelEdit}
                  className="px-5 py-2.5 rounded-xl border border-suprema-gray-200 text-suprema-gray-900 font-semibold hover:bg-suprema-gray-100 transition-colors"
                  disabled={saving}
                >
                  {t('detail.cancel')}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || photoValidation === 'validating' || (!!newPhotoDataUrl && photoValidation === 'rejected')}
                  className="px-5 py-2.5 rounded-xl bg-suprema-burgundy text-white font-bold hover:bg-suprema-burgundy-dark transition-colors shadow-md shadow-suprema-burgundy/20 disabled:opacity-60 flex items-center gap-2"
                >
                  {saving && <Loader2 size={16} className="animate-spin" />}
                  {saving ? t('detail.saving') : t('detail.save')}
                </button>
              </>
            ) : (
              <button
                onClick={handleClose}
                className="px-5 py-2.5 rounded-xl border border-suprema-gray-200 text-suprema-gray-900 font-semibold hover:bg-suprema-gray-100 transition-colors"
              >
                {t('detail.close')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Photo lightbox ─────────────────────────────────────────────────── */}
      {photoLightboxOpen && (newPhotoDataUrl || photoSrc) && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
          onClick={() => setPhotoLightboxOpen(false)}
        >
          <button
            onClick={() => setPhotoLightboxOpen(false)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
          >
            <X size={20} />
          </button>
          <div
            className="relative max-w-[90vw] max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {newPhotoDataUrl ? (
              <img
                src={newPhotoDataUrl}
                alt="Foto del visitante"
                className="max-w-full max-h-[85vh] rounded-2xl object-contain shadow-2xl"
              />
            ) : photoSrc ? (
              <AuthImage
                src={photoSrc}
                alt={`${visit?.visitor?.firstName} ${visit?.visitor?.lastName}`}
                className="max-w-full max-h-[85vh] rounded-2xl object-contain shadow-2xl"
                fallback={
                  <div className="w-64 h-64 rounded-2xl bg-gray-800 flex items-center justify-center text-6xl font-bold text-white/30">
                    {visit?.visitor?.firstName?.[0] || 'V'}
                  </div>
                }
              />
            ) : null}
            <p className="text-center text-white/60 text-sm mt-3">
              {visit?.visitor?.firstName} {visit?.visitor?.lastName}
            </p>
          </div>
        </div>
      )}
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-xs font-semibold text-suprema-gray-800/50 mb-1">{label}</span>
      <span className="text-sm font-medium text-suprema-gray-900">{value}</span>
    </div>
  );
}

function EditField({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-suprema-gray-800/50 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-suprema-gray-200 rounded-lg text-sm text-suprema-gray-900 bg-white focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none transition-colors"
      />
    </div>
  );
}

function HostCard({
  host,
  hostUser,
}: {
  host?: HostDetail | null;
  hostUser?: { fullName: string; email: string; department?: string } | null;
}) {
  const name       = host?.fullName   ?? hostUser?.fullName   ?? '—';
  const email      = host?.email      ?? hostUser?.email      ?? null;
  const department = host?.department ?? hostUser?.department ?? null;
  const phone      = host?.phone      ?? null;
  const jobTitle   = host?.jobTitle   ?? null;
  const sourceBadge =
    host?.source === 'BIOSTAR2'  ? { label: 'BioStar 2', color: 'bg-blue-100 text-blue-700' }    :
    host?.source === 'BIOSTAR_X' ? { label: 'BioStar X', color: 'bg-indigo-100 text-indigo-700' } :
    host?.source === 'LOCAL'     ? { label: 'Local',     color: 'bg-gray-100 text-gray-600' }     :
    null;

  return (
    <div className="flex items-start gap-4 p-4 bg-gradient-to-r from-suprema-gray-50 to-white rounded-xl border border-suprema-gray-100">
      <div className="w-10 h-10 rounded-full bg-suprema-burgundy/10 flex items-center justify-center flex-shrink-0">
        <span className="text-lg text-suprema-burgundy font-bold leading-none select-none">{name.charAt(0).toUpperCase()}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-suprema-gray-900 text-sm">{name}</span>
          {sourceBadge && <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${sourceBadge.color}`}>{sourceBadge.label}</span>}
        </div>
        <div className="mt-1 space-y-0.5">
          {jobTitle   && <p className="text-xs text-suprema-gray-800/60">{jobTitle}</p>}
          {department && <p className="text-xs text-suprema-gray-800/60">📁 {department}</p>}
          {email      && <p className="text-xs text-suprema-gray-800/60">✉️ {email}</p>}
          {phone      && <p className="text-xs text-suprema-gray-800/60">📞 {phone}</p>}
        </div>
      </div>
    </div>
  );
}

const CREDENTIAL_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  QR_JWT:            { icon: '▦',  label: 'QR Dinámico',        color: 'bg-blue-50 text-blue-700 border-blue-200' },
  RFID:              { icon: '📡', label: 'Tarjeta RFID',       color: 'bg-violet-50 text-violet-700 border-violet-200' },
  SMART_CARD:        { icon: '💳', label: 'Smart Card',         color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  MOBILE_CARD:       { icon: '📱', label: 'Móvil (NFC/BLE)',    color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  FACE_TEMPLATE_REF: { icon: '👁', label: 'Rostro (IR/Visual)', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  VISUAL_FACE:       { icon: '📸', label: 'Rostro Visual',      color: 'bg-teal-50 text-teal-700 border-teal-200' },
  FINGERPRINT_REF:   { icon: '🔏', label: 'Huella Dactilar',    color: 'bg-amber-50 text-amber-700 border-amber-200' },
};

function CredentialRow({
  credential,
  isEditing,
  revoking,
  onRevoke,
}: {
  credential: CredentialDetail;
  isEditing: boolean;
  revoking: boolean;
  onRevoke: () => void;
}) {
  const cfg = CREDENTIAL_CONFIG[credential.type] || { icon: '🔑', label: credential.type, color: 'bg-gray-50 text-gray-700 border-gray-200' };
  const RFID_SUBTYPE_LABELS: Record<string, string> = {
    CSN: 'CSN card',
    WIEGAND: 'Wiegand Card',
    MOBILE_CSN: 'Mobile CSN Card',
  };
  const syncDot =
    credential.isRevoked            ? '⛔' :
    credential.syncStatus === 'SYNCED'  ? '🟢' :
    credential.syncStatus === 'PENDING' ? '🟡' :
    credential.syncStatus === 'FAILED'  ? '🔴' : '⚪';

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${cfg.color} ${credential.isRevoked ? 'opacity-50' : ''}`}>
      <span className="text-lg leading-none">{cfg.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold">{cfg.label}</span>
          {credential.type === 'RFID' && credential.cardSubtype && (
            <span className="text-[10px] px-1.5 py-0.5 bg-white/60 rounded font-semibold opacity-80">
              {RFID_SUBTYPE_LABELS[credential.cardSubtype] || credential.cardSubtype}
            </span>
          )}
          {credential.isRevoked && <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded font-bold">REVOCADA</span>}
        </div>
        {credential.cardNumber && (
          <p className="text-[11px] font-mono mt-0.5 opacity-70">
            {credential.cardNumber}
            {credential.supremaCardId && credential.supremaCardId !== credential.cardNumber && (
              <span className="ml-1.5 text-[10px] opacity-60">→ BioStar: {credential.supremaCardId}</span>
            )}
          </p>
        )}
        {credential.lastSyncError && (
          <p className="text-[10px] mt-0.5 text-red-600 truncate" title={credential.lastSyncError}>{credential.lastSyncError}</p>
        )}
      </div>
      <span title={credential.syncStatus || 'No sincronizado'}>{syncDot}</span>
      {isEditing && !credential.isRevoked && (
        <button
          onClick={onRevoke}
          disabled={revoking}
          className="ml-1 p-1.5 rounded-lg hover:bg-red-100 text-red-400 hover:text-red-700 transition-colors disabled:opacity-50"
          title="Revocar credencial"
        >
          {revoking ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
        </button>
      )}
    </div>
  );
}

function SyncStatusPanel({
  syncStatus, lastSyncError, lastSyncAttemptAt, supremaUserRefId,
}: {
  syncStatus: string | null;
  lastSyncError: string | null;
  lastSyncAttemptAt: string | null;
  supremaUserRefId: string | null;
}) {
  const statusMap: Record<string, { icon: React.ReactNode; color: string; label: string; description: string }> = {
    SYNCED: {
      icon: <CheckCircle size={16} className="text-emerald-600" />,
      color: 'bg-emerald-50',
      label: 'Sincronizado',
      description: supremaUserRefId ? `Usuario BioStar: ${supremaUserRefId}` : 'Credenciales activas en BioStar.',
    },
    PENDING: {
      icon: <Clock size={16} className="text-amber-600" />,
      color: 'bg-amber-50',
      label: 'Pendiente de sincronización',
      description: 'Los datos serán enviados a BioStar en la próxima ejecución.',
    },
    FAILED: {
      icon: <AlertCircle size={16} className="text-red-600" />,
      color: 'bg-red-50',
      label: 'Error de sincronización',
      description: lastSyncError || 'Ocurrió un error durante la última sincronización.',
    },
    NOT_CONFIGURED: {
      icon: <WifiOff size={16} className="text-gray-500" />,
      color: 'bg-gray-50',
      label: 'BioStar no configurado',
      description: 'No hay conexión a BioStar configurada para este tenant.',
    },
  };

  const current = syncStatus ? statusMap[syncStatus] : {
    icon: <WifiOff size={16} className="text-gray-400" />,
    color: 'bg-gray-50',
    label: 'Sin estado de sincronización',
    description: 'Esta visita aún no ha sido procesada.',
  };

  return (
    <div className={`flex items-start gap-3 p-4 ${current.color}`}>
      <div className="mt-0.5">{current.icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-suprema-gray-900">{current.label}</p>
        <p className="text-xs text-suprema-gray-800/60 mt-0.5">{current.description}</p>
        {lastSyncAttemptAt && (
          <p className="text-[11px] text-suprema-gray-800/40 mt-1">
            Último intento: {new Date(lastSyncAttemptAt).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    X, UserPlus, CheckCircle2, Loader2, Camera, CreditCard,
    Fingerprint, ChevronDown, Upload, AlertCircle,
    XCircle, RefreshCw, UserCheck, Search, Lock, ArrowRight,
    QrCode, Copy, ExternalLink, Briefcase, Plus, Trash2, Car, ScanLine,
} from 'lucide-react';

import { api } from '@/lib/api';
import { useI18n } from '@/i18n/I18nContext';
import FaceCaptureModal from './FaceCaptureModal';
import AuthImage from './AuthImage';
import { analyzeFaceQuality, detectFaceBox, ensureFaceApiLoaded, type FaceBox, type FaceQualityIssue } from '@/lib/face-quality';
import AccessGroupSelect, { type AccessGroup } from './AccessGroupSelect';
import { useVisitorTypeCatalog } from '@/lib/visitor-types';

type AssetCategory = 'LAPTOP' | 'TABLET' | 'PHONE' | 'CAMERA' | 'TOOL' | 'USB_DRIVE' | 'OTHER';

interface AssetEntry {
    description: string;
    serialNumber: string;
    category: AssetCategory;
}

const ASSET_CATEGORIES: { value: AssetCategory; label: string }[] = [
    { value: 'LAPTOP',    label: 'Laptop / PC' },
    { value: 'TABLET',    label: 'Tablet' },
    { value: 'PHONE',     label: 'Teléfono' },
    { value: 'CAMERA',    label: 'Cámara' },
    { value: 'TOOL',      label: 'Herramienta' },
    { value: 'USB_DRIVE', label: 'USB / Almacenamiento' },
    { value: 'OTHER',     label: 'Otro' },
];

type VehicleType = 'CAR' | 'MOTORCYCLE' | 'TRUCK' | 'BICYCLE' | 'OTHER';

interface VehicleEntry {
    licensePlate: string;
    brand: string;
    model: string;
    color: string;
    vehicleType: VehicleType;
    parkingZone: string;
}

const VEHICLE_TYPES: { value: VehicleType; label: string }[] = [
    { value: 'CAR',        label: 'Automóvil' },
    { value: 'MOTORCYCLE', label: 'Moto' },
    { value: 'TRUCK',      label: 'Camión / Camioneta' },
    { value: 'BICYCLE',    label: 'Bicicleta' },
    { value: 'OTHER',      label: 'Otro' },
];

interface RegisterWalkInModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    prefillDocument?: { documentType: string; documentNumber: string } | null;
}

interface CredentialOption {
    type: string;
    cardNumber?: string;
    cardSubtype?: 'CSN' | 'WIEGAND' | 'MOBILE_CSN';
}

interface HostOption {
    id: string;
    fullName: string;
    email: string | null;
    department: string | null;
    jobTitle: string | null;
    source: string;
}

interface ExistingVisitor {
    id: string;
    firstName: string;
    lastName: string;
    company: string;
    email: string;
    phone: string;
    hasPhoto: boolean;
    photoPath: string | null;
    updatedAt: string;
}

interface ActiveVisitInfo {
    id: string;
    status: 'SCHEDULED' | 'PRE_REGISTERED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED';
    checkedInAt: string | null;
    scheduledAt: string | null;
    maxStayMinutes: number | null;
}

export default function RegisterWalkInModal({ isOpen, onClose, onSuccess, prefillDocument }: RegisterWalkInModalProps) {
    const { t } = useI18n();
    const { labels: visitorTypeLabels } = useVisitorTypeCatalog();
    const [done, setDone] = useState(false);
    const [isUnlocked, setIsUnlocked] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    const [startDatetime, setStartDatetime] = useState('');
    const [expiryDatetime, setExpiryDatetime] = useState('');
    const [datetimeError, setDatetimeError] = useState<string | null>(null);
    const [portalToken, setPortalToken] = useState<string | null>(null);
    const [showFaceCapture, setShowFaceCapture] = useState(false);

    const [formData, setFormData] = useState({
        firstName: '',
        lastName: '',
        documentType: 'NATIONAL_ID',
        documentNumber: '',
        email: '',
        phone: '',
        company: '',
        purpose: 'Meeting',
    });

    const [existingVisitor, setExistingVisitor] = useState<ExistingVisitor | null>(null);
    const [activeVisitsToday, setActiveVisitsToday] = useState(0);
    const [activeVisit, setActiveVisit] = useState<ActiveVisitInfo | null>(null);
    const [lookupDone, setLookupDone] = useState(false);
    const [isLookingUp, setIsLookingUp] = useState(false);
    const [isCheckingOut, setIsCheckingOut] = useState(false);
    const [checkoutDone, setCheckoutDone] = useState(false);
    const [checkInDone, setCheckInDone] = useState(false);
    const [isCheckingIn, setIsCheckingIn] = useState(false);

    // ── Visitante recurrente: sugerencias y estadísticas ──────────────
    const [visitCount, setVisitCount] = useState(0);
    const [isFrecuent, setIsFrecuent] = useState(false);
    const [suggestedHostId, setSuggestedHostId] = useState<string | null>(null);
    const [suggestedHostName, setSuggestedHostName] = useState<string | null>(null);
    const [suggestionsApplied, setSuggestionsApplied] = useState<string[]>([]);
    const [lastVisitDate, setLastVisitDate] = useState<string | null>(null);

    const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
    const [photoValidation, setPhotoValidation] = useState<'idle' | 'validating' | 'accepted' | 'rejected'>('idle');
    const [photoIssues, setPhotoIssues] = useState<FaceQualityIssue[]>([]);
    const [faceBox, setFaceBox] = useState<FaceBox | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [rfidEnabled, setRfidEnabled] = useState(false);
    const [rfidCardNumber, setRfidCardNumber] = useState('');
    const [rfidCardSubtype, setRfidCardSubtype] = useState<'CSN' | 'WIEGAND' | 'MOBILE_CSN'>('CSN');
    const [smartCardEnabled, setSmartCardEnabled] = useState(false);
    const [smartCardNumber, setSmartCardNumber] = useState('');
    const [qrEnabled, setQrEnabled] = useState(false);
    const [faceEnabled, setFaceEnabled] = useState(false);

    const [cardEnrollers, setCardEnrollers] = useState<{ deviceId: string; deviceName: string }[]>([]);
    const [selectedCardEnrollerId, setSelectedCardEnrollerId] = useState('');
    const [cardScanning, setCardScanning] = useState(false);
    const [cardScanError, setCardScanError] = useState<string | null>(null);
    const [rfidScanSuccess, setRfidScanSuccess] = useState(false);
    const [smartCardScanSuccess, setSmartCardScanSuccess] = useState(false);
    const cardScanAbortRef = useRef<AbortController | null>(null);

    const [hosts, setHosts] = useState<HostOption[]>([]);
    const [hostsLoading, setHostsLoading] = useState(false);
    const [selectedHostId, setSelectedHostId] = useState('');
    const [showNewHostForm, setShowNewHostForm] = useState(false);
    const [newHost, setNewHost] = useState({ fullName: '', email: '', department: '', phone: '' });
    const [savingHost, setSavingHost] = useState(false);

    const [availableAccessGroups, setAvailableAccessGroups] = useState<AccessGroup[]>([]);
    const [accessGroupsLoading, setAccessGroupsLoading] = useState(false);
    const [accessGroupsError, setAccessGroupsError] = useState(false);
    const [selectedAccessGroups, setSelectedAccessGroups] = useState<AccessGroup[]>([]);

    const [visitorType, setVisitorType] = useState<string>('WALK_IN');
    const [serviceOrder, setServiceOrder] = useState('');
    const [visitNotes, setVisitNotes] = useState('');
    const [autoCheckoutEnabled, setAutoCheckoutEnabled] = useState(false);
    const [autoCheckoutTouched, setAutoCheckoutTouched] = useState(false);
    const [autoCheckoutDefaults, setAutoCheckoutDefaults] = useState<Record<string, boolean>>({});

    const [hasAssets, setHasAssets] = useState(false);
    const [assets, setAssets] = useState<AssetEntry[]>([{ description: '', serialNumber: '', category: 'LAPTOP' }]);
    const [assetErrors, setAssetErrors] = useState<string[]>([]);

    const [hasVehicles, setHasVehicles] = useState(false);
    const [vehicles, setVehicles] = useState<VehicleEntry[]>([{ licensePlate: '', brand: '', model: '', color: '', vehicleType: 'CAR', parkingZone: '' }]);
    const [vehicleErrors, setVehicleErrors] = useState<string[]>([]);

    useEffect(() => {
        if (isOpen) {
            if (successTimerRef.current) {
                clearTimeout(successTimerRef.current);
                successTimerRef.current = null;
            }
            setDone(false);
            setIsUnlocked(false);
            setLookupDone(false);
            setExistingVisitor(null);
            setActiveVisit(null);
            setActiveVisitsToday(0);
            setCheckoutDone(false);
            setCheckInDone(false);
            setIsLookingUp(false);
            setSubmitError(null);
            setVisitCount(0);
            setIsFrecuent(false);
            setSuggestedHostId(null);
            setSuggestedHostName(null);
            setSuggestionsApplied([]);
            setLastVisitDate(null);
            setPhotoDataUrl(null);
            setPhotoValidation('idle');
            setPhotoIssues([]);
            setFaceBox(null);
            setShowFaceCapture(false);
            setRfidEnabled(false);
            setRfidCardNumber('');
            setRfidCardSubtype('CSN');
            setSmartCardEnabled(false);
            setSmartCardNumber('');
            setQrEnabled(false);
            setFaceEnabled(false);
            setSelectedCardEnrollerId('');
            setCardScanning(false);
            setCardScanError(null);
            setRfidScanSuccess(false);
            setSmartCardScanSuccess(false);
            setCardEnrollers([]);
            setSelectedHostId('');
            setShowNewHostForm(false);
            setNewHost({ fullName: '', email: '', department: '', phone: '' });
            setFormData({
                firstName: '',
                lastName: '',
                documentType: prefillDocument?.documentType || 'NATIONAL_ID',
                documentNumber: prefillDocument?.documentNumber || '',
                email: '',
                phone: '',
                company: '',
                purpose: 'Meeting',
            });
            setPortalToken(null);
            setDatetimeError(null);
            const _now = new Date();
            const _endOfDay = new Date(_now);
            _endOfDay.setHours(23, 59, 0, 0);
            const _pad = (n: number) => String(n).padStart(2, '0');
            const _fmt = (d: Date) => `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}T${_pad(d.getHours())}:${_pad(d.getMinutes())}`;
            setStartDatetime(_fmt(_now));
            setExpiryDatetime(_fmt(_endOfDay));
            setSelectedAccessGroups([]);
            setAvailableAccessGroups([]);
            setAccessGroupsError(false);
            setHasAssets(false);
            setAssets([{ description: '', serialNumber: '', category: 'LAPTOP' }]);
            setAssetErrors([]);
            setVisitorType('WALK_IN');
            setVisitNotes('');
            setAutoCheckoutEnabled(false);
            setAutoCheckoutTouched(false);

            setHostsLoading(true);
            api.get('/hosts?active=true')
                .then(r => setHosts(r.data))
                .catch(() => setHosts([]))
                .finally(() => setHostsLoading(false));


            setAccessGroupsLoading(true);
            api.get('/access-groups')
                .then(r => {
                    setAvailableAccessGroups(Array.isArray(r.data) ? r.data : []);
                    setAccessGroupsError(false);
                })
                .catch(() => setAccessGroupsError(true))
                .finally(() => setAccessGroupsLoading(false));

            api.get('/visitors/settings/auto-checkout/visitor-types')
                .then(r => setAutoCheckoutDefaults(r.data && typeof r.data === 'object' ? r.data : {}))
                .catch(() => setAutoCheckoutDefaults({}));

            api.get('/settings/enrollers')
                .then(r => setCardEnrollers(Array.isArray(r.data) ? r.data : []))
                .catch(() => setCardEnrollers([]));
        }
    }, [isOpen]);

    // Auto-seleccionar anfitrión sugerido cuando se carguen los hosts
    useEffect(() => {
        if (suggestedHostId && hosts.length > 0 && !selectedHostId) {
            const found = hosts.find(h => h.id === suggestedHostId);
            if (found) setSelectedHostId(suggestedHostId);
        }
    }, [hosts, suggestedHostId, selectedHostId]);

    // Aplica el default de auto-checkout configurado para el tipo de visitante
    // seleccionado, salvo que el operador ya haya tocado el toggle manualmente.
    useEffect(() => {
        if (!isOpen || autoCheckoutTouched) return;
        setAutoCheckoutEnabled(!!autoCheckoutDefaults[visitorType]);
    }, [isOpen, visitorType, autoCheckoutDefaults, autoCheckoutTouched]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
        if (name === 'documentNumber' || name === 'documentType') {
            setExistingVisitor(null);
            setLookupDone(false);
            setIsUnlocked(false);
            setPhotoDataUrl(null);
            setPhotoValidation('idle');
            setPhotoIssues([]);
        }
    };

    /** Maps BioStar card_type (numeric or text) → our subtype enum.
     *  BioStar 2 numeric: "0"=CSN, "1"=Wiegand, "2"=Smart/Secure
     *  BioStar X text: "CSN_CARD", "WIEGAND_CARD", "MOBILE_CSN", etc. */
    const mapBioStarCardType = (cardType: string | undefined): 'CSN' | 'WIEGAND' | 'MOBILE_CSN' | null => {
        if (!cardType) return null;
        // Numeric type codes from BioStar 2
        // BioStar 2 numeric codes confirmed on FaceStation F2:
        // "0" = Unknown/empty, "1" = CSN (Mifare UID / HID CSN), "2" = Wiegand
        if (cardType === '0') return 'CSN';
        if (cardType === '1') return 'CSN';
        if (cardType === '2') return 'WIEGAND';
        const upper = cardType.toUpperCase();
        if (upper.includes('WIEGAND')) return 'WIEGAND';
        if (upper.includes('MOBILE')) return 'MOBILE_CSN';
        if (upper.includes('CSN')) return 'CSN';
        return null; // unknown — leave current selection
    };

    const handleCardScan = useCallback(async (
        onSuccess: (cardNum: string) => void,
        onSubtype?: (subtype: 'CSN' | 'WIEGAND' | 'MOBILE_CSN') => void,
        onScanSuccess?: () => void,
    ) => {
        if (!selectedCardEnrollerId) return;
        if (cardScanAbortRef.current) cardScanAbortRef.current.abort();
        const ctrl = new AbortController();
        cardScanAbortRef.current = ctrl;
        setCardScanning(true);
        setCardScanError(null);
        try {
            const res = await api.post(
                `/devices/${selectedCardEnrollerId}/scan-card`,
                {},
                { signal: ctrl.signal, timeout: 35000 },
            );
            const data = res.data ?? {};
            const cardId: string =
                data.cardId ||
                data.card_id ||
                data.id ||
                String(data.card?.id ?? '');
            if (!cardId) throw new Error('No se recibió número de tarjeta del dispositivo');
            // Update the card number field
            onSuccess(cardId);
            // Auto-detect and update the card subtype if BioStar provided it
            const detectedSubtype = mapBioStarCardType(data.cardType || data.card_type);
            if (detectedSubtype && onSubtype) onSubtype(detectedSubtype);
            // Signal visual success
            if (onScanSuccess) onScanSuccess();
            setCardScanError(null);
        } catch (err: any) {
            if (
                err.name === 'CanceledError' ||
                err.name === 'AbortError' ||
                err.code === 'ERR_CANCELED'
            ) return;
            setCardScanError(err.response?.data?.message || err.message || 'Error al escanear tarjeta');
        } finally {
            setCardScanning(false);
            cardScanAbortRef.current = null;
        }
    }, [selectedCardEnrollerId]);

    const handleConsultar = useCallback(async (overrideDoc?: { documentType: string; documentNumber: string }) => {
        const docType = overrideDoc?.documentType ?? formData.documentType;
        const docNum = (overrideDoc?.documentNumber ?? formData.documentNumber).trim();
        if (!docNum) return;
        setIsLookingUp(true);
        setExistingVisitor(null);
        setActiveVisit(null);
        setActiveVisitsToday(0);
        setSubmitError(null);
        setSuggestedHostId(null);
        setSuggestedHostName(null);
        setSuggestionsApplied([]);
        setLastVisitDate(null);
        setVisitCount(0);
        setIsFrecuent(false);
        try {
            const res = await api.get('/visitors/lookup', {
                params: { documentType: docType, documentNumber: docNum },
            });
            if (res.data.found && res.data.visitor) {
                const v: ExistingVisitor = res.data.visitor;
                setExistingVisitor(v);
                setActiveVisitsToday(res.data.activeVisitsToday ?? 0);
                setActiveVisit(res.data.activeVisit ?? null);
                setFormData(prev => ({
                    ...prev,
                    firstName: v.firstName || '',
                    lastName: v.lastName || '',
                    email: v.email || '',
                    phone: v.phone || '',
                    company: v.company || '',
                    // Auto-aplicar propósito sugerido si existe
                    ...(res.data.suggestedPurpose ? { purpose: res.data.suggestedPurpose } : {}),
                }));

                // ── Aplicar sugerencias de visitas anteriores ────────────
                const applied: string[] = [];
                const count: number = res.data.visitCount ?? 0;
                setVisitCount(count);
                setIsFrecuent(res.data.isFrecuent ?? false);
                setLastVisitDate(res.data.recentVisits?.[0]?.date ?? null);

                if (res.data.suggestedHostId) {
                    setSuggestedHostId(res.data.suggestedHostId);
                    setSuggestedHostName(res.data.suggestedHostName ?? null);
                    applied.push('anfitrión');
                }
                if (res.data.suggestedPurpose) {
                    applied.push('propósito');
                }
                if (res.data.suggestedAccessGroups?.length) {
                    setSelectedAccessGroups(res.data.suggestedAccessGroups);
                    applied.push('grupos de acceso');
                }
                setSuggestionsApplied(applied);
            }
        } catch {
            // Si falla el lookup, desbloqueamos igual para nuevo visitante
        } finally {
            setIsLookingUp(false);
            setLookupDone(true);
            setIsUnlocked(true);
        }
    }, [formData.documentNumber, formData.documentType]);

    // Auto-consultar cuando el modal se abre con un documento pre-cargado
    // (acción rápida "Agendar" para un visitante ya conocido, ej. desde estado Checkout)
    useEffect(() => {
        if (isOpen && prefillDocument?.documentNumber) {
            handleConsultar(prefillDocument);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const handleFaceCapture = (imageDataUrl: string) => {
        setPhotoDataUrl(imageDataUrl);
        setPhotoValidation('accepted');
        setPhotoIssues([]);
        setFaceBox(null);
        setShowFaceCapture(false);
        ensureFaceApiLoaded().then(() => detectFaceBox(imageDataUrl)).then((box) => {
            if (box) setFaceBox(box);
        }).catch(() => {});
    };

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

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';
        const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png'];
        if (!ALLOWED_TYPES.includes(file.type)) {
            setSubmitError('Solo se permiten archivos JPG, JPEG o PNG (estándar Suprema BioStar).');
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            setSubmitError('La imagen supera el límite de 10 MB permitido por Suprema BioStar.');
            return;
        }
        const reader = new FileReader();
        reader.onload = async (ev) => {
            const raw = ev.target?.result as string;
            const dataUrl = await compressImage(raw);
            setPhotoDataUrl(dataUrl);
            setPhotoValidation('validating');
            setPhotoIssues([]);
            try {
                await ensureFaceApiLoaded();
                const result = await analyzeFaceQuality(dataUrl);
                if (!result.passed) {
                    setPhotoIssues(result.issues.filter(i => i.severity === 'error'));
                    setPhotoValidation('rejected');
                    setFaceBox(null);
                    return;
                }
                if (result.faceBox) {
                    setFaceBox(result.faceBox);
                }
                try {
                    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
                    await api.post('/visitors/validate-face', { imageBase64: `data:image/jpeg;base64,${base64}` });
                } catch (err: any) {
                    if (err.response?.status === 400) {
                        setPhotoIssues([{
                            code: 'BIOSTAR_REJECTED',
                            message: err.response.data.message || 'La foto no cumple los requisitos biométricos de BioStar.',
                            severity: 'error',
                        }]);
                        setPhotoValidation('rejected');
                        setFaceBox(null);
                        return;
                    }
                }
                setPhotoValidation('accepted');
            } catch {
                setPhotoValidation('accepted');
            }
        };
        reader.readAsDataURL(file);
    };

    const handleCreateNewHost = async () => {
        if (!newHost.fullName.trim()) return;
        try {
            setSavingHost(true);
            const res = await api.post('/hosts', {
                fullName: newHost.fullName.trim(),
                email: newHost.email.trim() || undefined,
                department: newHost.department.trim() || undefined,
                phone: newHost.phone.trim() || undefined,
            });
            const created: HostOption = res.data;
            setHosts(prev => [...prev, created].sort((a, b) => a.fullName.localeCompare(b.fullName)));
            setSelectedHostId(created.id);
            setShowNewHostForm(false);
            setNewHost({ fullName: '', email: '', department: '', phone: '' });
        } catch (err: any) {
            setSubmitError(err.response?.data?.message || 'Error al crear anfitrión.');
        } finally {
            setSavingHost(false);
        }
    };

    const toLocalDatetimeInput = (d: Date): string => {
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    const handleSetToday = () => {
        const now = new Date();
        const endOfDay = new Date(now);
        endOfDay.setHours(23, 59, 0, 0);
        setStartDatetime(toLocalDatetimeInput(now));
        setExpiryDatetime(toLocalDatetimeInput(endOfDay));
        setDatetimeError(null);
    };

    const handleSubmit = async () => {
        try {
            setIsLoading(true);
            setSubmitError(null);
            setDatetimeError(null);

            const startDt = new Date(startDatetime);
            const expiryDt = new Date(expiryDatetime);
            if (!startDatetime || !expiryDatetime || isNaN(startDt.getTime()) || isNaN(expiryDt.getTime())) {
                setDatetimeError('Por favor, selecciona la fecha y hora de inicio y fin de la visita.');
                setIsLoading(false);
                return;
            }
            if (startDt >= expiryDt) {
                setDatetimeError('La fecha de inicio debe ser anterior a la fecha de fin.');
                setIsLoading(false);
                return;
            }

            // Validar activos si el toggle está activado
            if (hasAssets) {
                const errors = assets.map(a => a.description.trim().length < 2 ? 'La descripción del activo es obligatoria (mín. 2 caracteres).' : '');
                setAssetErrors(errors);
                if (errors.some(e => e !== '')) {
                    setIsLoading(false);
                    return;
                }
            }

            // Validar vehículos si el toggle está activado
            if (hasVehicles) {
                const errors = vehicles.map(v => v.licensePlate.trim().length < 2 ? 'La placa del vehículo es obligatoria (mín. 2 caracteres).' : '');
                setVehicleErrors(errors);
                if (errors.some(e => e !== '')) {
                    setIsLoading(false);
                    return;
                }
            }

            const visitorPayload: Record<string, any> = {
                fullName: `${formData.firstName} ${formData.lastName}`.trim(),
                documentType: formData.documentType,
                documentNumber: formData.documentNumber.trim(),
                company: formData.company || undefined,
            };
            if (formData.email?.trim()) visitorPayload.email = formData.email.trim().toLowerCase();
            if (formData.phone?.trim()) visitorPayload.phone = formData.phone.trim();
            if (photoDataUrl) {
                visitorPayload.photoBase64 = photoDataUrl;
                if (faceBox) visitorPayload.faceBox = faceBox;
            }

            const visitorRes = await api.post('/visitors', visitorPayload);
            const visitorId = visitorRes.data.id || visitorRes.data.visitor?.id;
            if (!visitorId) throw new Error('No se obtuvo ID del visitante.');

            const additionalCredentials: CredentialOption[] = [];
            if (faceEnabled)
                additionalCredentials.push({ type: 'VISUAL_FACE' });
            if (rfidEnabled && rfidCardNumber.trim())
                additionalCredentials.push({ type: 'RFID', cardNumber: rfidCardNumber.trim().toUpperCase(), cardSubtype: rfidCardSubtype });
            if (smartCardEnabled && smartCardNumber.trim())
                additionalCredentials.push({ type: 'SMART_CARD', cardNumber: smartCardNumber.trim().toUpperCase() });

            const visitPayload: Record<string, any> = {
                visitorId,
                reason: formData.purpose,
                expectedEntryTime: startDt.toISOString(),
                expectedExitTime: expiryDt.toISOString(),
                accessMethod: qrEnabled ? 'QR_DYNAMIC' : 'MANUAL',
            };
            if (selectedHostId) visitPayload.hostId = selectedHostId;
            if (additionalCredentials.length > 0) visitPayload.additionalCredentials = additionalCredentials;
            if (selectedAccessGroups.length > 0) visitPayload.accessGroups = selectedAccessGroups;
            if (visitorType && visitorType !== 'WALK_IN') visitPayload.visitorType = visitorType;
            if (visitorType === 'CONTRACTOR' && serviceOrder.trim()) visitPayload.serviceOrder = serviceOrder.trim();
            if (visitNotes.trim()) visitPayload.notes = visitNotes.trim();
            visitPayload.autoCheckoutEnabled = autoCheckoutEnabled;
            if (hasAssets && assets.length > 0) {
                visitPayload.hasAssets = true;
                visitPayload.assets = assets.map(a => ({
                    description: a.description.trim(),
                    serialNumber: a.serialNumber.trim() || undefined,
                    category: a.category,
                }));
            }
            if (hasVehicles && vehicles.length > 0) {
                visitPayload.hasVehicles = true;
                visitPayload.vehicles = vehicles.map(v => ({
                    licensePlate: v.licensePlate.trim().toUpperCase().replace(/\s+/g, ''),
                    brand: v.brand.trim() || undefined,
                    model: v.model.trim() || undefined,
                    color: v.color.trim() || undefined,
                    vehicleType: v.vehicleType,
                    parkingZone: v.parkingZone.trim() || undefined,
                }));
            }

            const scheduleRes = await api.post('/visitors/schedule', visitPayload);
            const token: string | null = qrEnabled ? (scheduleRes.data?.portalToken ?? null) : null;
            setPortalToken(token);
            setDone(true);
            if (!token) {
                successTimerRef.current = setTimeout(() => {
                    successTimerRef.current = null;
                    handleClose();
                    onSuccess();
                }, 3000);
            } else {
                onSuccess();
            }
        } catch (error: any) {
            const status = error.response?.status;
            if (status === 413) {
                setSubmitError('La foto es demasiado grande. Usa la cámara directamente o comprime la imagen.');
            } else {
                setSubmitError(error.response?.data?.message || t('register.errorDefault'));
            }
        } finally {
            setIsLoading(false);
        }
    };

    /**
     * Realiza el checkout del visitante activo directamente desde el modal de registro.
     * Tras el checkout, desbloquea el formulario para poder registrar una nueva visita.
     */
    const handleCheckoutFromModal = async () => {
        if (!activeVisit) return;
        setIsCheckingOut(true);
        try {
            await api.put(`/visitors/checkout/${activeVisit.id}`);
            setCheckoutDone(true);
            setActiveVisit(null);
            setActiveVisitsToday(0);
            setTimeout(() => setCheckoutDone(false), 3000);
        } catch (err: any) {
            setSubmitError(err.response?.data?.message || 'Error al realizar el checkout.');
        } finally {
            setIsCheckingOut(false);
        }
    };

    /**
     * Realiza el check-in de una visita SCHEDULED/PRE_REGISTERED directamente
     * desde el modal de registro, sin necesidad de cerrar y crear una nueva visita.
     */
    const handleCheckInFromModal = async () => {
        if (!activeVisit) return;
        setIsCheckingIn(true);
        setSubmitError(null);
        try {
            await api.put(`/visitors/visit/${activeVisit.id}/checkin`);
            setCheckInDone(true);
            setActiveVisit(null);
            setActiveVisitsToday(0);
            // Cerrar modal tras check-in exitoso y notificar al padre
            setTimeout(() => {
                onSuccess();
            }, 1500);
        } catch (err: any) {
            setSubmitError(err.response?.data?.message || 'Error al realizar el check-in.');
        } finally {
            setIsCheckingIn(false);
        }
    };

    const handleClose = () => {
        if (successTimerRef.current) {
            clearTimeout(successTimerRef.current);
            successTimerRef.current = null;
        }
        setDone(false);
        setIsUnlocked(false);
        setLookupDone(false);
        setPhotoDataUrl(null);
        setSubmitError(null);
        setPhotoValidation('idle');
        setPhotoIssues([]);
        setShowFaceCapture(false);
        setRfidEnabled(false);
        setRfidCardNumber('');
        setSmartCardEnabled(false);
        setSmartCardNumber('');
        setQrEnabled(false);
        setFaceEnabled(false);
        setSelectedHostId('');
        setShowNewHostForm(false);
        setNewHost({ fullName: '', email: '', department: '', phone: '' });
        setExistingVisitor(null);
        setActiveVisitsToday(0);
        setActiveVisit(null);
        setCheckoutDone(false);
        setCheckInDone(false);
        setIsLookingUp(false);
        setFormData({ firstName: '', lastName: '', documentType: 'NATIONAL_ID', documentNumber: '', email: '', phone: '', company: '', purpose: 'Meeting' });
        setHasAssets(false);
        setAssets([{ description: '', serialNumber: '', category: 'LAPTOP' }]);
        setAssetErrors([]);
        setVisitorType('WALK_IN');
        setServiceOrder('');
        setVisitNotes('');
        setSelectedAccessGroups([]);
        onClose();
    };

    if (!isOpen) return null;

    const inputBase = 'w-full px-3 py-2.5 border rounded-lg text-suprema-gray-900 outline-none transition-colors';
    const inputActive = 'border-suprema-gray-300 focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy bg-white';
    const inputLocked = 'border-suprema-gray-200 bg-suprema-gray-50 text-suprema-gray-600 cursor-not-allowed';
    const labelBase = 'block text-sm font-semibold text-suprema-gray-900 mb-1';

    const activeVisitStatus = activeVisit?.status;
    const hasAnyActiveVisitBlock = isUnlocked && existingVisitor !== null && !!activeVisit &&
        (activeVisitStatus === 'CHECKED_IN' || activeVisitStatus === 'SCHEDULED' || activeVisitStatus === 'PRE_REGISTERED');
    const isCheckedInBlock = hasAnyActiveVisitBlock && activeVisitStatus === 'CHECKED_IN';
    const isScheduledBlock = hasAnyActiveVisitBlock && (activeVisitStatus === 'SCHEDULED' || activeVisitStatus === 'PRE_REGISTERED');
    const selectedHost = selectedHostId ? hosts.find(h => h.id === selectedHostId) ?? null : null;
    const canSubmit = isUnlocked && !isLoading && !hasAnyActiveVisitBlock && !!formData.firstName && !!formData.lastName &&
        !!formData.documentNumber && photoValidation !== 'validating' && photoValidation !== 'rejected' &&
        (!qrEnabled || !!formData.email.trim());

    return (
        <>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-suprema-gray-900/60 backdrop-blur-sm">
                <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[96vh]">

                    {/* ── Header ── */}
                    <div className="flex justify-between items-center px-6 py-4 border-b border-suprema-gray-100 flex-shrink-0">
                        <div>
                            <h3 className="text-xl font-bold text-suprema-gray-900">{t('register.title')}</h3>
                            <p className="text-sm text-suprema-gray-800/50 mt-0.5">
                                {done ? t('register.completed') : 'Ingrese el número de documento y consulte para comenzar'}
                            </p>
                        </div>
                        <button onClick={handleClose} className="p-2 text-suprema-gray-800/40 hover:text-suprema-gray-900 hover:bg-suprema-gray-100 rounded-full transition-colors">
                            <X size={20} />
                        </button>
                    </div>

                    {/* ── Success screen ── */}
                    {done ? (
                        <div className="flex flex-col items-center justify-center py-10 text-center space-y-4 px-6">
                            <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center">
                                <CheckCircle2 size={40} />
                            </div>
                            <h3 className="text-2xl font-bold text-suprema-gray-900">{t('register.registrationComplete')}</h3>
                            <p className="text-suprema-gray-800/60 max-w-sm">
                                {t('register.registrationCompleteDesc', { name: `${formData.firstName} ${formData.lastName}` })}
                            </p>
                            {portalToken && (() => {
                                const portalUrl = typeof window !== 'undefined'
                                    ? `${window.location.origin}/visitor/qr/${portalToken}`
                                    : `/visitor/qr/${portalToken}`;
                                const waText = encodeURIComponent(`Hola ${formData.firstName}, aquí está tu código QR de acceso: ${portalUrl}`);
                                return (
                                    <div className="w-full max-w-md bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-left space-y-3">
                                        <div className="flex items-center gap-1.5">
                                            <QrCode size={14} className="text-emerald-600 flex-shrink-0" />
                                            <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Enlace de Acceso QR</p>
                                        </div>
                                        <p className="text-xs text-suprema-gray-800/60 leading-relaxed">
                                            Envía este enlace al visitante — puede abrirlo en su móvil para ver su QR de entrada en todo momento.
                                        </p>
                                        <div className="flex items-center gap-2">
                                            <code className="flex-1 text-xs bg-white border border-emerald-200 rounded-lg px-2 py-1.5 text-emerald-800 truncate">
                                                {portalUrl}
                                            </code>
                                            <button
                                                type="button"
                                                onClick={() => navigator.clipboard.writeText(portalUrl)}
                                                className="flex-shrink-0 p-1.5 text-emerald-600 hover:bg-emerald-100 rounded-lg transition-colors"
                                                title="Copiar enlace"
                                            >
                                                <Copy size={15} />
                                            </button>
                                            <a
                                                href={`/visitor/qr/${portalToken}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex-shrink-0 p-1.5 text-emerald-600 hover:bg-emerald-100 rounded-lg transition-colors"
                                                title="Abrir portal"
                                            >
                                                <ExternalLink size={15} />
                                            </a>
                                        </div>
                                        <div className="flex gap-2 pt-1">
                                            <a
                                                href={`https://wa.me/?text=${waText}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#25D366] text-white text-xs font-semibold rounded-lg hover:bg-[#1ebe5a] transition-colors"
                                            >
                                                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                                                WhatsApp
                                            </a>
                                            {formData.email && (
                                                <a
                                                    href={`mailto:${formData.email}?subject=Tu código QR de acceso&body=Hola ${formData.firstName},%0A%0AAquí está tu enlace de acceso QR:%0A${portalUrl}%0A%0AÁbrelo en tu móvil para ver el código QR de entrada.`}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-suprema-gray-800 text-white text-xs font-semibold rounded-lg hover:bg-black transition-colors"
                                                >
                                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                                                    Correo
                                                </a>
                                            )}
                                        </div>
                                    </div>
                                );
                            })()}
                            <button
                                onClick={() => { handleClose(); }}
                                className="px-6 py-3 bg-suprema-gray-900 text-white rounded-xl font-bold hover:bg-black transition-colors mt-2"
                            >
                                {t('register.closeWindow')}
                            </button>
                        </div>
                    ) : (
                        <>
                            {/* ── Body: two columns ── */}
                            <div className="flex flex-1 min-h-0 overflow-hidden">

                                {/* ════ LEFT: Data ════ */}
                                <div className="flex-1 p-6 overflow-y-auto border-r border-suprema-gray-100 space-y-4">

                                    {/* ── Lookup row ── */}
                                    <div>
                                        <p className="text-xs font-bold text-suprema-gray-800/50 uppercase tracking-wider mb-3">1. Identificación del Visitante</p>
                                        <div className="grid grid-cols-5 gap-3 items-end">
                                            <div className="col-span-2">
                                                <label className={labelBase}>Tipo de Documento</label>
                                                <select
                                                    name="documentType"
                                                    value={formData.documentType}
                                                    onChange={handleChange}
                                                    className={`${inputBase} ${inputActive}`}
                                                >
                                                    <option value="NATIONAL_ID">Cédula de Identidad</option>
                                                    <option value="PASSPORT">Pasaporte</option>
                                                    <option value="FOREIGN_ID">Cédula Extranjería</option>
                                                    <option value="DRIVERS_LICENSE">Lic. de Conducción</option>
                                                </select>
                                            </div>
                                            <div className="col-span-2">
                                                <label className={labelBase}>
                                                    Número de Documento
                                                    <span className="ml-1 text-suprema-burgundy font-bold">*</span>
                                                </label>
                                                <input
                                                    name="documentNumber"
                                                    value={formData.documentNumber}
                                                    onChange={handleChange}
                                                    onKeyDown={e => e.key === 'Enter' && handleConsultar()}
                                                    placeholder="Número único"
                                                    className={`${inputBase} ${inputActive}`}
                                                />
                                            </div>
                                            <div>
                                                <button
                                                    type="button"
                                                    onClick={() => handleConsultar()}
                                                    disabled={!formData.documentNumber.trim() || isLookingUp}
                                                    className="w-full py-2.5 bg-suprema-gray-900 text-white font-bold rounded-lg hover:bg-black disabled:opacity-40 transition-colors flex items-center justify-center gap-2 text-sm"
                                                >
                                                    {isLookingUp
                                                        ? <Loader2 size={15} className="animate-spin" />
                                                        : <Search size={15} />
                                                    }
                                                    Consultar
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* ── Status banner ── */}
                                    {lookupDone && (
                                        existingVisitor ? (
                                            <div className="space-y-2">
                                                {/* Banner principal de visitante encontrado */}
                                                <div className="flex items-start gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                                                    <UserCheck size={17} className="text-emerald-600 mt-0.5 flex-shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <p className="text-sm font-semibold text-emerald-800">Visitante encontrado — datos cargados</p>
                                                            {isFrecuent && (
                                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-suprema-burgundy text-white text-[10px] font-bold rounded-full">
                                                                    ⭐ Visitante frecuente
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-xs text-emerald-700 mt-0.5">
                                                            {existingVisitor.firstName} {existingVisitor.lastName}
                                                            {existingVisitor.company ? ` · ${existingVisitor.company}` : ''}
                                                            {existingVisitor.hasPhoto ? ' · 📷 Tiene foto' : ''}
                                                        </p>
                                                        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                                                            {visitCount > 0 && (
                                                                <span className="text-[11px] text-emerald-600">
                                                                    🔁 {visitCount} visita{visitCount !== 1 ? 's' : ''} registrada{visitCount !== 1 ? 's' : ''}
                                                                </span>
                                                            )}
                                                            {lastVisitDate && (
                                                                <span className="text-[11px] text-emerald-600">
                                                                    📅 Última: {new Date(lastVisitDate).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                                </span>
                                                            )}
                                                        </div>
                                                        {suggestionsApplied.length > 0 && (
                                                            <p className="text-[11px] text-emerald-700 mt-1.5 font-medium">
                                                                ✨ Sugerencias aplicadas: {suggestionsApplied.join(', ')}
                                                                {suggestedHostName ? ` (${suggestedHostName})` : ''}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setExistingVisitor(null);
                                                            setActiveVisitsToday(0);
                                                            setLookupDone(false);
                                                            setIsUnlocked(false);
                                                            setPhotoDataUrl(null);
                                                            setPhotoValidation('idle');
                                                            setSuggestedHostId(null);
                                                            setSuggestionsApplied([]);
                                                            setVisitCount(0);
                                                            setIsFrecuent(false);
                                                            setLastVisitDate(null);
                                                            setSelectedHostId('');
                                                            setSelectedAccessGroups([]);
                                                            setFormData(prev => ({ ...prev, firstName: '', lastName: '', email: '', phone: '', company: '', purpose: 'Meeting' }));
                                                        }}
                                                        className="text-xs text-emerald-600 hover:text-emerald-800 flex items-center gap-1 flex-shrink-0"
                                                    >
                                                        <RefreshCw size={12} /> Nueva búsqueda
                                                    </button>
                                                </div>

                                                {/* ── CHECK-IN EXITOSO ── */}
                                                {checkInDone && (
                                                    <div className="flex items-center gap-2 p-3 bg-emerald-50 border-2 border-emerald-400 rounded-xl">
                                                        <CheckCircle2 size={17} className="text-emerald-600 flex-shrink-0" />
                                                        <p className="text-sm font-bold text-emerald-800">
                                                            Check-in realizado correctamente
                                                        </p>
                                                    </div>
                                                )}

                                                {/* ── CHECKOUT EXITOSO ── */}
                                                {checkoutDone && (
                                                    <div className="flex items-center gap-2 p-3 bg-emerald-50 border-2 border-emerald-400 rounded-xl">
                                                        <CheckCircle2 size={17} className="text-emerald-600 flex-shrink-0" />
                                                        <p className="text-sm font-bold text-emerald-800">
                                                            Check-out realizado — ya puede registrar la nueva visita
                                                        </p>
                                                    </div>
                                                )}

                                                {/* ── HARD BLOCK: Visitante ya está dentro (CHECKED_IN) ── */}
                                                {isCheckedInBlock && (
                                                    <div className="p-3 bg-red-50 border-2 border-red-400 rounded-xl space-y-3">
                                                        <div className="flex items-start gap-2">
                                                            <XCircle size={17} className="text-red-600 mt-0.5 flex-shrink-0" />
                                                            <div className="flex-1 min-w-0">
                                                                <p className="text-sm font-bold text-red-800">
                                                                    Visitante actualmente dentro del edificio
                                                                </p>
                                                                <p className="text-xs text-red-700 mt-0.5">
                                                                    <strong>{existingVisitor?.firstName} {existingVisitor?.lastName}</strong> realizó check-in
                                                                    {activeVisit?.checkedInAt ? ` a las ${new Date(activeVisit.checkedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}.
                                                                    No se puede registrar una nueva visita hasta que realice check-out.
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={handleCheckoutFromModal}
                                                            disabled={isCheckingOut}
                                                            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold text-sm rounded-lg transition-colors"
                                                        >
                                                            {isCheckingOut ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
                                                            {isCheckingOut ? 'Procesando checkout…' : `Realizar check-out de ${existingVisitor?.firstName} ahora`}
                                                        </button>
                                                    </div>
                                                )}

                                                {/* ── HARD BLOCK: Visita ya registrada (SCHEDULED / PRE_REGISTERED) ── */}
                                                {isScheduledBlock && (
                                                    <div className="p-3 bg-amber-50 border-2 border-amber-400 rounded-xl space-y-3">
                                                        <div className="flex items-start gap-2">
                                                            <AlertCircle size={17} className="text-amber-600 mt-0.5 flex-shrink-0" />
                                                            <div className="flex-1 min-w-0">
                                                                <p className="text-sm font-bold text-amber-800">
                                                                    Este visitante ya tiene una visita registrada
                                                                </p>
                                                                <p className="text-xs text-amber-700 mt-0.5">
                                                                    <strong>{existingVisitor?.firstName} {existingVisitor?.lastName}</strong> tiene una visita en estado <strong>{activeVisitStatus === 'PRE_REGISTERED' ? 'Pre-registrado' : 'Agendado'}</strong>
                                                                    {activeVisit?.scheduledAt ? ` programada a las ${new Date(activeVisit.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}.
                                                                    No está permitido crear registros duplicados. Use el botón de check-in si el visitante ya llegó.
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={handleCheckInFromModal}
                                                            disabled={isCheckingIn}
                                                            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-sm rounded-lg transition-colors"
                                                        >
                                                            {isCheckingIn ? <Loader2 size={15} className="animate-spin" /> : <UserCheck size={15} />}
                                                            {isCheckingIn ? 'Procesando check-in…' : `Hacer check-in de ${existingVisitor?.firstName} ahora`}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl">
                                                <UserPlus size={16} className="text-blue-600 flex-shrink-0" />
                                                <p className="text-sm text-blue-800 font-medium">Nuevo visitante — complete los datos a continuación</p>
                                            </div>
                                        )
                                    )}

                                    {/* ── Fields (locked until lookup) ── */}
                                    <div className={`space-y-4 transition-opacity ${isUnlocked ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                                        {!isUnlocked && (
                                            <div className="flex items-center gap-2 text-xs text-suprema-gray-800/50 mb-1">
                                                <Lock size={12} />
                                                <span>Ingrese el número de documento y haga clic en Consultar para desbloquear</span>
                                            </div>
                                        )}

                                        <div>
                                            <p className="text-xs font-bold text-suprema-gray-800/50 uppercase tracking-wider mb-3">2. Datos Personales</p>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <label className={labelBase}>Nombre <span className="text-suprema-burgundy">*</span></label>
                                                    <input
                                                        name="firstName"
                                                        value={formData.firstName}
                                                        onChange={handleChange}
                                                        disabled={!isUnlocked}
                                                        className={`${inputBase} ${isUnlocked ? inputActive : inputLocked}`}
                                                    />
                                                </div>
                                                <div>
                                                    <label className={labelBase}>Apellido <span className="text-suprema-burgundy">*</span></label>
                                                    <input
                                                        name="lastName"
                                                        value={formData.lastName}
                                                        onChange={handleChange}
                                                        disabled={!isUnlocked}
                                                        className={`${inputBase} ${isUnlocked ? inputActive : inputLocked}`}
                                                    />
                                                </div>
                                                <div>
                                                    <label className={labelBase}>Empresa</label>
                                                    <input
                                                        name="company"
                                                        value={formData.company}
                                                        onChange={handleChange}
                                                        disabled={!isUnlocked}
                                                        placeholder="Opcional"
                                                        className={`${inputBase} ${isUnlocked ? inputActive : inputLocked}`}
                                                    />
                                                </div>
                                                <div>
                                                    <label className={labelBase}>Teléfono</label>
                                                    <input
                                                        name="phone"
                                                        value={formData.phone}
                                                        onChange={handleChange}
                                                        disabled={!isUnlocked}
                                                        placeholder="Opcional"
                                                        className={`${inputBase} ${isUnlocked ? inputActive : inputLocked}`}
                                                    />
                                                </div>
                                                <div>
                                                    <label className={labelBase}>Tipo de Visitante</label>
                                                    <select
                                                        value={visitorType}
                                                        onChange={e => setVisitorType(e.target.value)}
                                                        disabled={!isUnlocked}
                                                        className={`${inputBase} ${isUnlocked ? inputActive : inputLocked} appearance-none`}
                                                    >
                                                        {Object.entries(visitorTypeLabels).map(([val, meta]) => (
                                                            <option key={val} value={val}>{meta.icon} {meta.label}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                {visitorType === 'CONTRACTOR' && (
                                                    <div>
                                                        <label className={labelBase}>
                                                            Orden de Servicio <span className="text-suprema-burgundy">*</span>
                                                        </label>
                                                        <input
                                                            value={serviceOrder}
                                                            onChange={e => setServiceOrder(e.target.value)}
                                                            disabled={!isUnlocked}
                                                            placeholder="Ej: OS-2026-0042"
                                                            maxLength={100}
                                                            className={`${inputBase} ${isUnlocked ? inputActive : inputLocked}`}
                                                        />
                                                    </div>
                                                )}
                                                <div>
                                                    <label className={labelBase}>Motivo de Visita</label>
                                                    <input
                                                        name="purpose"
                                                        value={formData.purpose}
                                                        onChange={handleChange}
                                                        disabled={!isUnlocked}
                                                        className={`${inputBase} ${isUnlocked ? inputActive : inputLocked}`}
                                                    />
                                                </div>
                                                <div>
                                                    <label className={labelBase}>
                                                        Email{qrEnabled && <span className="text-suprema-burgundy"> *</span>}
                                                    </label>
                                                    <input
                                                        name="email"
                                                        type="email"
                                                        value={formData.email}
                                                        onChange={handleChange}
                                                        disabled={!isUnlocked}
                                                        placeholder={qrEnabled ? 'Requerido para envío de QR' : 'Opcional'}
                                                        className={`${inputBase} ${isUnlocked ? inputActive : inputLocked} ${qrEnabled && isUnlocked && !formData.email.trim() ? 'border-amber-400 focus:border-amber-500' : ''}`}
                                                    />
                                                    {qrEnabled && isUnlocked && !formData.email.trim() && (
                                                        <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                                                            <AlertCircle size={11} />
                                                            Obligatorio para recibir el enlace de acceso QR
                                                        </p>
                                                    )}
                                                </div>
                                                <div className="col-span-2">
                                                    <label className={labelBase}>Observaciones / Notas</label>
                                                    <textarea
                                                        value={visitNotes}
                                                        onChange={e => setVisitNotes(e.target.value)}
                                                        disabled={!isUnlocked}
                                                        placeholder="Instrucciones especiales, equipaje, área a visitar, restricciones..."
                                                        rows={2}
                                                        maxLength={2000}
                                                        className={`${inputBase} ${isUnlocked ? inputActive : inputLocked} resize-none`}
                                                    />
                                                    {visitNotes.length > 1800 && (
                                                        <p className="text-xs text-amber-600 mt-0.5">{visitNotes.length}/2000 caracteres</p>
                                                    )}
                                                </div>
                                                <div className="col-span-2">
                                                    <button
                                                        type="button"
                                                        disabled={!isUnlocked}
                                                        onClick={() => { setAutoCheckoutTouched(true); setAutoCheckoutEnabled(v => !v); }}
                                                        className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border transition-colors disabled:opacity-40 ${
                                                            autoCheckoutEnabled
                                                                ? 'border-suprema-burgundy bg-suprema-burgundy/5'
                                                                : 'border-suprema-gray-200 bg-suprema-gray-50 hover:bg-suprema-gray-100'
                                                        }`}
                                                    >
                                                        <span className="text-left">
                                                            <span className="block text-sm font-semibold text-suprema-gray-800">Auto-checkout</span>
                                                            <span className="block text-xs text-suprema-gray-500">Cambia el estado a check-out automáticamente al detectar un evento de salida en BioStar o en los dispositivos Suprema</span>
                                                        </span>
                                                        <span
                                                            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                                                                autoCheckoutEnabled ? 'bg-suprema-burgundy' : 'bg-suprema-gray-300'
                                                            }`}
                                                        >
                                                            <span
                                                                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                                                                    autoCheckoutEnabled ? 'translate-x-6' : 'translate-x-1'
                                                                }`}
                                                            />
                                                        </span>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>

                                        {/* ── Host ── */}
                                        <div>
                                            <div className="flex items-center justify-between mb-1">
                                                <label className={labelBase}>Anfitrión</label>
                                                {!showNewHostForm && isUnlocked && (
                                                    <button type="button" onClick={() => setShowNewHostForm(true)}
                                                        className="text-xs text-suprema-burgundy font-semibold hover:underline">
                                                        + Nuevo anfitrión
                                                    </button>
                                                )}
                                            </div>
                                            {!showNewHostForm ? (
                                                <div className="relative">
                                                    <select
                                                        value={selectedHostId}
                                                        onChange={e => setSelectedHostId(e.target.value)}
                                                        disabled={!isUnlocked || hostsLoading}
                                                        className={`${inputBase} ${isUnlocked ? inputActive : inputLocked} appearance-none pr-10`}
                                                    >
                                                        <option value="">{hostsLoading ? 'Cargando...' : '— Sin anfitrión asignado —'}</option>
                                                        {hosts.map(h => (
                                                            <option key={h.id} value={h.id}>
                                                                {h.fullName}{h.department ? ` · ${h.department}` : ''}{h.source !== 'LOCAL' ? ` [${h.source}]` : ''}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-suprema-gray-400 pointer-events-none" />
                                                    {selectedHost && !selectedHost.email && isUnlocked && (
                                                        <p className="text-xs text-amber-600 mt-1.5 flex items-center gap-1">
                                                            <AlertCircle size={11} />
                                                            Sin email registrado — no recibirá notificación de llegada
                                                        </p>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="border border-suprema-gray-200 rounded-xl p-4 bg-suprema-gray-50 space-y-3">
                                                    <p className="text-xs font-bold text-suprema-gray-800/60 uppercase">Crear nuevo anfitrión</p>
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <div className="col-span-2">
                                                            <label className="block text-xs font-semibold text-suprema-gray-700 mb-1">Nombre completo *</label>
                                                            <input type="text" value={newHost.fullName} onChange={e => setNewHost(p => ({ ...p, fullName: e.target.value }))}
                                                                className={`${inputBase} ${inputActive} text-sm`} placeholder="Ej: María González" />
                                                        </div>
                                                        <div>
                                                            <label className="block text-xs font-semibold text-suprema-gray-700 mb-1">Email</label>
                                                            <input type="email" value={newHost.email} onChange={e => setNewHost(p => ({ ...p, email: e.target.value }))}
                                                                className={`${inputBase} ${inputActive} text-sm`} placeholder="email@empresa.com" />
                                                        </div>
                                                        <div>
                                                            <label className="block text-xs font-semibold text-suprema-gray-700 mb-1">Departamento</label>
                                                            <input type="text" value={newHost.department} onChange={e => setNewHost(p => ({ ...p, department: e.target.value }))}
                                                                className={`${inputBase} ${inputActive} text-sm`} placeholder="TI, Ventas..." />
                                                        </div>
                                                    </div>
                                                    <div className="flex gap-2 justify-end">
                                                        <button type="button" onClick={() => { setShowNewHostForm(false); setNewHost({ fullName: '', email: '', department: '', phone: '' }); }}
                                                            className="px-3 py-1.5 text-sm text-suprema-gray-700 hover:bg-suprema-gray-200 rounded-lg transition-colors">
                                                            Cancelar
                                                        </button>
                                                        <button type="button" onClick={handleCreateNewHost} disabled={savingHost || !newHost.fullName.trim()}
                                                            className="px-3 py-1.5 text-sm bg-suprema-burgundy text-white font-bold rounded-lg hover:bg-suprema-burgundy-dark disabled:opacity-50 flex items-center gap-1.5">
                                                            {savingHost ? <Loader2 size={12} className="animate-spin" /> : null}
                                                            Guardar anfitrión
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* ── Vigencia de la visita ── */}
                                        <div className={`transition-opacity ${isUnlocked ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                                            <div className="flex items-center justify-between mb-2">
                                                <label className="block text-xs font-bold text-suprema-gray-800/50 uppercase tracking-wider">4. Vigencia de la Visita</label>
                                                <button
                                                    type="button"
                                                    disabled={!isUnlocked}
                                                    onClick={handleSetToday}
                                                    className="px-3 py-1 text-xs font-bold text-suprema-burgundy border border-suprema-burgundy rounded-lg hover:bg-suprema-burgundy hover:text-white transition-colors disabled:opacity-40"
                                                >
                                                    Hoy
                                                </button>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <label className={labelBase}>Inicio <span className="text-suprema-burgundy">*</span></label>
                                                    <input
                                                        type="datetime-local"
                                                        value={startDatetime}
                                                        onChange={e => { setStartDatetime(e.target.value); setDatetimeError(null); }}
                                                        disabled={!isUnlocked}
                                                        className={`${inputBase} ${isUnlocked ? inputActive : inputLocked}`}
                                                    />
                                                </div>
                                                <div>
                                                    <label className={labelBase}>Fin <span className="text-suprema-burgundy">*</span></label>
                                                    <input
                                                        type="datetime-local"
                                                        value={expiryDatetime}
                                                        onChange={e => { setExpiryDatetime(e.target.value); setDatetimeError(null); }}
                                                        disabled={!isUnlocked}
                                                        className={`${inputBase} ${isUnlocked ? inputActive : inputLocked}`}
                                                    />
                                                </div>
                                            </div>
                                            {datetimeError && (
                                                <div className="mt-2 flex items-center gap-2 text-red-600 text-xs font-semibold">
                                                    <AlertCircle size={13} />
                                                    <span>{datetimeError}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* ════ RIGHT: Photo + Credentials ════ */}
                                <div className="w-96 flex-shrink-0 p-6 overflow-y-auto space-y-5">
                                    <p className="text-xs font-bold text-suprema-gray-800/50 uppercase tracking-wider">3. Captura Fotográfica</p>

                                    {/* Photo preview */}
                                    <div className="flex flex-col items-center gap-4">
                                        <div className={`relative w-36 h-36 rounded-full overflow-hidden border-4 flex items-center justify-center flex-shrink-0 transition-colors ${
                                            photoValidation === 'accepted' ? 'border-emerald-400' :
                                            photoValidation === 'rejected' ? 'border-red-400' :
                                            photoValidation === 'validating' ? 'border-amber-400' :
                                            existingVisitor?.hasPhoto ? 'border-blue-300' :
                                            'border-suprema-gray-200'
                                        } bg-suprema-gray-100`}>
                                            {photoDataUrl ? (
                                                <img src={photoDataUrl} alt="Foto" className="w-full h-full object-cover" />
                                            ) : existingVisitor?.hasPhoto && existingVisitor.id ? (
                                                <AuthImage
                                                    src={`/visitors/${existingVisitor.id}/photo?v=${existingVisitor.updatedAt ? new Date(existingVisitor.updatedAt).getTime() : 1}`}
                                                    alt="Foto existente"
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <Camera size={40} className="text-suprema-gray-300" />
                                            )}
                                            {photoValidation === 'validating' && (
                                                <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                                                    <Loader2 size={28} className="animate-spin text-suprema-burgundy" />
                                                </div>
                                            )}
                                        </div>

                                        {/* Photo status */}
                                        {photoValidation === 'accepted' && (
                                            <p className="text-xs text-emerald-700 font-semibold text-center">✓ Foto validada correctamente</p>
                                        )}
                                        {photoValidation === 'validating' && (
                                            <p className="text-xs text-amber-700 font-semibold text-center">Validando calidad biométrica...</p>
                                        )}
                                        {existingVisitor?.hasPhoto && !photoDataUrl && photoValidation === 'idle' && (
                                            <p className="text-xs text-blue-700 text-center">Foto registrada previamente — puede actualizarla</p>
                                        )}
                                        {!existingVisitor?.hasPhoto && !photoDataUrl && photoValidation === 'idle' && (
                                            <div className="text-center">
                                                <p className="text-sm font-semibold text-suprema-gray-900">Foto Facial Requerida</p>
                                                <p className="text-xs text-suprema-gray-800/50 mt-0.5">Capture o suba una foto del visitante.<br/>Se validará para reconocimiento facial.</p>
                                            </div>
                                        )}

                                        {/* Photo issues */}
                                        {photoValidation === 'rejected' && photoIssues.length > 0 && (
                                            <div className="w-full space-y-2">
                                                {photoIssues.slice(0, 2).map((issue, idx) => (
                                                    <div key={idx} className="flex items-start gap-2 p-2.5 bg-red-50 border border-red-200 rounded-xl">
                                                        <XCircle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
                                                        <p className="text-xs text-red-800">{issue.message}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {/* Buttons */}
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/jpeg,image/jpg,image/png"
                                            className="hidden"
                                            onChange={handleFileUpload}
                                        />
                                        <div className="flex gap-2 w-full">
                                            <button
                                                type="button"
                                                disabled={!isUnlocked}
                                                onClick={() => setShowFaceCapture(true)}
                                                className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 bg-suprema-burgundy text-white font-bold rounded-xl hover:bg-suprema-burgundy-dark transition-colors text-sm disabled:opacity-40"
                                            >
                                                <Camera size={15} /> Cámara
                                            </button>
                                            <span className="text-suprema-gray-400 self-center text-xs">o</span>
                                            <button
                                                type="button"
                                                disabled={!isUnlocked}
                                                onClick={() => fileInputRef.current?.click()}
                                                className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 border-2 border-suprema-gray-300 text-suprema-gray-700 font-bold rounded-xl hover:bg-suprema-gray-50 transition-colors text-sm disabled:opacity-40"
                                            >
                                                <Upload size={15} /> Archivo
                                            </button>
                                        </div>
                                    </div>

                                    {/* ── Access Groups ── */}
                                    <div className={`space-y-2 transition-opacity ${isUnlocked ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                                        <p className="text-xs font-bold text-suprema-gray-800/50 uppercase tracking-wider">4. Niveles de Acceso Permitidos</p>
                                        <p className="text-xs text-suprema-gray-800/50 leading-snug mb-1">
                                            Selecciona los grupos de acceso que determinan a qué puertas físicas podrá acceder el visitante.
                                        </p>
                                        <AccessGroupSelect
                                            groups={availableAccessGroups}
                                            selected={selectedAccessGroups}
                                            onChange={setSelectedAccessGroups}
                                            loading={accessGroupsLoading}
                                            error={accessGroupsError}
                                            disabled={!isUnlocked}
                                        />
                                    </div>

                                    {/* ── Activos del Visitante ── */}
                                    <div className={`space-y-2 transition-opacity ${isUnlocked ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                                        <p className="text-xs font-bold text-suprema-gray-800/50 uppercase tracking-wider">5. Activos del Visitante</p>
                                        <div className="border border-suprema-gray-200 rounded-xl overflow-hidden">
                                            <button
                                                type="button"
                                                onClick={() => { setHasAssets(p => !p); setAssetErrors([]); }}
                                                className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-suprema-gray-50 transition-colors"
                                            >
                                                <span className="flex items-center gap-2 text-sm font-semibold text-suprema-gray-800">
                                                    <Briefcase size={15} className="text-suprema-gray-500" /> ¿El visitante ingresa con equipos o activos?
                                                </span>
                                                <div className={`w-9 h-5 rounded-full transition-colors flex items-center px-0.5 ${hasAssets ? 'bg-suprema-burgundy' : 'bg-suprema-gray-200'}`}>
                                                    <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${hasAssets ? 'translate-x-4' : ''}`} />
                                                </div>
                                            </button>
                                            {hasAssets && (
                                                <div className="px-3 pb-3 space-y-3">
                                                    <p className="text-xs text-suprema-gray-800/50">Registra cada equipo o activo que ingresa el visitante. Se verificarán al check-out.</p>
                                                    {assets.map((asset, idx) => (
                                                        <div key={idx} className="border border-suprema-gray-100 rounded-lg p-3 bg-suprema-gray-50/60 space-y-2 relative">
                                                            <div className="flex items-center justify-between mb-1">
                                                                <span className="text-xs font-bold text-suprema-gray-700">Activo #{idx + 1}</span>
                                                                {assets.length > 1 && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => {
                                                                            setAssets(prev => prev.filter((_, i) => i !== idx));
                                                                            setAssetErrors(prev => prev.filter((_, i) => i !== idx));
                                                                        }}
                                                                        className="text-red-400 hover:text-red-600 p-0.5 rounded"
                                                                    >
                                                                        <Trash2 size={13} />
                                                                    </button>
                                                                )}
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-2">
                                                                <div className="col-span-2">
                                                                    <label className="block text-xs font-semibold text-suprema-gray-700 mb-0.5">Descripción *</label>
                                                                    <input
                                                                        type="text"
                                                                        value={asset.description}
                                                                        placeholder="Ej: Laptop Dell XPS 15"
                                                                        onChange={e => {
                                                                            const val = e.target.value;
                                                                            setAssets(prev => prev.map((a, i) => i === idx ? { ...a, description: val } : a));
                                                                            if (val.trim().length >= 2) setAssetErrors(prev => prev.map((err, i) => i === idx ? '' : err));
                                                                        }}
                                                                        className={`${inputBase} ${inputActive} text-sm ${assetErrors[idx] ? 'border-red-400 focus:border-red-400 focus:ring-red-100' : ''}`}
                                                                    />
                                                                    {assetErrors[idx] && <p className="text-xs text-red-500 mt-0.5">{assetErrors[idx]}</p>}
                                                                </div>
                                                                <div>
                                                                    <label className="block text-xs font-semibold text-suprema-gray-700 mb-0.5">N° de Serie</label>
                                                                    <input
                                                                        type="text"
                                                                        value={asset.serialNumber}
                                                                        placeholder="Opcional"
                                                                        onChange={e => { const val = e.target.value; setAssets(prev => prev.map((a, i) => i === idx ? { ...a, serialNumber: val } : a)); }}
                                                                        className={`${inputBase} ${inputActive} text-sm`}
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label className="block text-xs font-semibold text-suprema-gray-700 mb-0.5">Categoría</label>
                                                                    <select
                                                                        value={asset.category}
                                                                        onChange={e => { const val = e.target.value as AssetCategory; setAssets(prev => prev.map((a, i) => i === idx ? { ...a, category: val } : a)); }}
                                                                        className={`${inputBase} ${inputActive} text-sm appearance-none`}
                                                                    >
                                                                        {ASSET_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                                                                    </select>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                    <button
                                                        type="button"
                                                        onClick={() => setAssets(prev => [...prev, { description: '', serialNumber: '', category: 'LAPTOP' }])}
                                                        className="flex items-center gap-1.5 text-xs font-semibold text-suprema-burgundy hover:text-suprema-burgundy-dark transition-colors"
                                                    >
                                                        <Plus size={13} /> Agregar otro activo
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* ── Vehículos del Visitante ── */}
                                    <div className={`space-y-2 transition-opacity ${isUnlocked ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                                        <p className="text-xs font-bold text-suprema-gray-800/50 uppercase tracking-wider">6. Vehículos del Visitante</p>
                                        <div className="border border-suprema-gray-200 rounded-xl overflow-hidden">
                                            <button
                                                type="button"
                                                onClick={() => { setHasVehicles(p => !p); setVehicleErrors([]); }}
                                                className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-suprema-gray-50 transition-colors"
                                            >
                                                <span className="flex items-center gap-2 text-sm font-semibold text-suprema-gray-800">
                                                    <Car size={15} className="text-suprema-gray-500" /> ¿El visitante ingresa con vehículo(s)?
                                                </span>
                                                <div className={`w-9 h-5 rounded-full transition-colors flex items-center px-0.5 ${hasVehicles ? 'bg-suprema-burgundy' : 'bg-suprema-gray-200'}`}>
                                                    <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${hasVehicles ? 'translate-x-4' : ''}`} />
                                                </div>
                                            </button>
                                            {hasVehicles && (
                                                <div className="px-3 pb-3 space-y-3">
                                                    <p className="text-xs text-suprema-gray-800/50">Registra cada vehículo que ingresa al parqueadero. Se verificarán al check-out.</p>
                                                    {vehicles.map((vehicle, idx) => (
                                                        <div key={idx} className="border border-suprema-gray-100 rounded-lg p-3 bg-suprema-gray-50/60 space-y-2 relative">
                                                            <div className="flex items-center justify-between mb-1">
                                                                <span className="text-xs font-bold text-suprema-gray-700">Vehículo #{idx + 1}</span>
                                                                {vehicles.length > 1 && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => {
                                                                            setVehicles(prev => prev.filter((_, i) => i !== idx));
                                                                            setVehicleErrors(prev => prev.filter((_, i) => i !== idx));
                                                                        }}
                                                                        className="text-red-400 hover:text-red-600 p-0.5 rounded"
                                                                    >
                                                                        <Trash2 size={13} />
                                                                    </button>
                                                                )}
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-2">
                                                                <div className="col-span-2">
                                                                    <label className="block text-xs font-semibold text-suprema-gray-700 mb-0.5">Placa *</label>
                                                                    <input
                                                                        type="text"
                                                                        value={vehicle.licensePlate}
                                                                        placeholder="Ej: ABC123"
                                                                        onChange={e => {
                                                                            const val = e.target.value.toUpperCase();
                                                                            setVehicles(prev => prev.map((v, i) => i === idx ? { ...v, licensePlate: val } : v));
                                                                            if (val.trim().length >= 2) setVehicleErrors(prev => prev.map((err, i) => i === idx ? '' : err));
                                                                        }}
                                                                        className={`${inputBase} ${inputActive} text-sm font-mono tracking-wider ${vehicleErrors[idx] ? 'border-red-400 focus:border-red-400 focus:ring-red-100' : ''}`}
                                                                    />
                                                                    {vehicleErrors[idx] && <p className="text-xs text-red-500 mt-0.5">{vehicleErrors[idx]}</p>}
                                                                </div>
                                                                <div>
                                                                    <label className="block text-xs font-semibold text-suprema-gray-700 mb-0.5">Tipo</label>
                                                                    <select
                                                                        value={vehicle.vehicleType}
                                                                        onChange={e => { const val = e.target.value as VehicleType; setVehicles(prev => prev.map((v, i) => i === idx ? { ...v, vehicleType: val } : v)); }}
                                                                        className={`${inputBase} ${inputActive} text-sm appearance-none`}
                                                                    >
                                                                        {VEHICLE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                                                    </select>
                                                                </div>
                                                                <div>
                                                                    <label className="block text-xs font-semibold text-suprema-gray-700 mb-0.5">Color</label>
                                                                    <input
                                                                        type="text"
                                                                        value={vehicle.color}
                                                                        placeholder="Ej: Blanco"
                                                                        onChange={e => { const val = e.target.value; setVehicles(prev => prev.map((v, i) => i === idx ? { ...v, color: val } : v)); }}
                                                                        className={`${inputBase} ${inputActive} text-sm`}
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label className="block text-xs font-semibold text-suprema-gray-700 mb-0.5">Marca</label>
                                                                    <input
                                                                        type="text"
                                                                        value={vehicle.brand}
                                                                        placeholder="Ej: Toyota"
                                                                        onChange={e => { const val = e.target.value; setVehicles(prev => prev.map((v, i) => i === idx ? { ...v, brand: val } : v)); }}
                                                                        className={`${inputBase} ${inputActive} text-sm`}
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label className="block text-xs font-semibold text-suprema-gray-700 mb-0.5">Modelo</label>
                                                                    <input
                                                                        type="text"
                                                                        value={vehicle.model}
                                                                        placeholder="Ej: Corolla"
                                                                        onChange={e => { const val = e.target.value; setVehicles(prev => prev.map((v, i) => i === idx ? { ...v, model: val } : v)); }}
                                                                        className={`${inputBase} ${inputActive} text-sm`}
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label className="block text-xs font-semibold text-suprema-gray-700 mb-0.5">Zona Parqueadero</label>
                                                                    <input
                                                                        type="text"
                                                                        value={vehicle.parkingZone}
                                                                        placeholder="Ej: P1-A3"
                                                                        onChange={e => { const val = e.target.value; setVehicles(prev => prev.map((v, i) => i === idx ? { ...v, parkingZone: val } : v)); }}
                                                                        className={`${inputBase} ${inputActive} text-sm`}
                                                                    />
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                    <button
                                                        type="button"
                                                        onClick={() => setVehicles(prev => [...prev, { licensePlate: '', brand: '', model: '', color: '', vehicleType: 'CAR', parkingZone: '' }])}
                                                        className="flex items-center gap-1.5 text-xs font-semibold text-suprema-burgundy hover:text-suprema-burgundy-dark transition-colors"
                                                    >
                                                        <Plus size={13} /> Agregar otro vehículo
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* ── Credentials ── */}
                                    <div className={`space-y-3 transition-opacity ${isUnlocked ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                                        <p className="text-xs font-bold text-suprema-gray-800/50 uppercase tracking-wider">7. Credenciales Adicionales</p>
                                        {/* Visual Face */}
                                        <div className={`border rounded-xl overflow-hidden transition-colors ${faceEnabled ? 'border-suprema-burgundy/40 bg-suprema-burgundy/5' : 'border-suprema-gray-200'}`}>
                                            <button
                                                type="button"
                                                onClick={() => photoValidation === 'accepted' && setFaceEnabled(p => !p)}
                                                className={`w-full flex items-center justify-between px-3 py-2.5 transition-colors ${photoValidation === 'accepted' ? 'hover:bg-suprema-gray-50' : 'cursor-not-allowed opacity-50'}`}
                                                title={photoValidation !== 'accepted' ? 'Se requiere capturar y validar una foto facial antes de activar esta credencial' : undefined}
                                            >
                                                <span className="flex items-center gap-2 text-sm font-semibold text-suprema-gray-800">
                                                    <Camera size={15} className={faceEnabled ? 'text-suprema-burgundy' : 'text-suprema-gray-500'} /> Rostro Visual (Face)
                                                </span>
                                                <div className={`w-9 h-5 rounded-full transition-colors flex items-center px-0.5 ${faceEnabled ? 'bg-suprema-burgundy' : 'bg-suprema-gray-200'}`}>
                                                    <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${faceEnabled ? 'translate-x-4' : ''}`} />
                                                </div>
                                            </button>
                                            {faceEnabled && (
                                                <div className="px-3 pb-3 pt-0.5">
                                                    <p className="text-xs text-suprema-burgundy/70 leading-snug">
                                                        La foto capturada se enrolará en BioStar como credencial Visual Face (FaceStation F2 / BioStation 3).
                                                    </p>
                                                </div>
                                            )}
                                            {!faceEnabled && photoValidation !== 'accepted' && (
                                                <div className="px-3 pb-2.5">
                                                    <p className="text-xs text-suprema-gray-800/40 leading-snug">
                                                        Captura y valida la foto facial (paso 2) para habilitar esta opción.
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                        {/* RFID */}
                                        <div className="border border-suprema-gray-200 rounded-xl overflow-hidden">
                                            <button
                                                type="button"
                                                onClick={() => setRfidEnabled(p => !p)}
                                                className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-suprema-gray-50 transition-colors"
                                            >
                                                <span className="flex items-center gap-2 text-sm font-semibold text-suprema-gray-800">
                                                    <CreditCard size={15} className="text-suprema-gray-500" /> Tarjeta RFID
                                                </span>
                                                <div className={`w-9 h-5 rounded-full transition-colors flex items-center px-0.5 ${rfidEnabled ? 'bg-suprema-burgundy' : 'bg-suprema-gray-200'}`}>
                                                    <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${rfidEnabled ? 'translate-x-4' : ''}`} />
                                                </div>
                                            </button>
                                            {rfidEnabled && (
                                                <div className="px-3 pb-3 space-y-2">
                                                    <select
                                                        value={rfidCardSubtype}
                                                        onChange={e => setRfidCardSubtype(e.target.value as 'CSN' | 'WIEGAND' | 'MOBILE_CSN')}
                                                        className={`${inputBase} ${inputActive} text-sm`}
                                                    >
                                                        <option value="CSN">CSN card</option>
                                                        <option value="WIEGAND">Wiegand Card</option>
                                                        <option value="MOBILE_CSN">Mobile CSN Card</option>
                                                    </select>
                                                    {/* Leer tarjeta desde dispositivo Suprema */}
                                                    {cardEnrollers.length > 0 && (
                                                        <div className="rounded-lg border border-suprema-burgundy/20 bg-suprema-burgundy/5 p-2.5 space-y-2">
                                                            <p className="text-[11px] font-bold text-suprema-burgundy uppercase tracking-wide flex items-center gap-1">
                                                                <ScanLine size={11} /> Leer desde dispositivo Suprema
                                                            </p>
                                                            <div className="flex gap-2">
                                                                <select
                                                                    value={selectedCardEnrollerId}
                                                                    onChange={e => { setSelectedCardEnrollerId(e.target.value); setCardScanError(null); }}
                                                                    disabled={cardScanning}
                                                                    className="flex-1 px-2 py-1.5 border border-suprema-gray-200 rounded-lg text-xs text-suprema-gray-900 bg-white focus:ring-1 focus:ring-suprema-burgundy/30 focus:border-suprema-burgundy outline-none"
                                                                >
                                                                    <option value="">— Seleccionar dispositivo —</option>
                                                                    {cardEnrollers.map(d => (
                                                                        <option key={d.deviceId} value={d.deviceId}>{d.deviceName}</option>
                                                                    ))}
                                                                </select>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleCardScan(
                                                                        cn => setRfidCardNumber(cn),
                                                                        st => setRfidCardSubtype(st),
                                                                        () => setRfidScanSuccess(true),
                                                                    )}
                                                                    disabled={!selectedCardEnrollerId || cardScanning}
                                                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-suprema-burgundy text-white text-xs font-bold rounded-lg hover:bg-suprema-burgundy/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                                                >
                                                                    {cardScanning ? <Loader2 size={12} className="animate-spin" /> : <ScanLine size={12} />}
                                                                    Escanear
                                                                </button>
                                                            </div>
                                                            {cardScanError && (
                                                                <p className="text-[11px] text-red-600 flex items-center gap-1">
                                                                    <AlertCircle size={11} /> {cardScanError}
                                                                </p>
                                                            )}
                                                            {rfidScanSuccess && !cardScanError && rfidCardNumber && (
                                                                <p className="text-[11px] text-emerald-700 flex items-center gap-1 font-semibold">
                                                                    <CheckCircle2 size={11} /> Tarjeta leída correctamente desde el dispositivo
                                                                </p>
                                                            )}
                                                        </div>
                                                    )}
                                                    <input
                                                        value={rfidCardNumber}
                                                        onChange={e => { setRfidCardNumber(e.target.value); setRfidScanSuccess(false); }}
                                                        placeholder={selectedCardEnrollerId ? 'Auto-rellenado al escanear, o ingrese manualmente' : 'Número de tarjeta RFID'}
                                                        className={`${inputBase} ${inputActive} text-sm font-mono`}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                        {/* Smart Card */}
                                        <div className="border border-suprema-gray-200 rounded-xl overflow-hidden">
                                            <button
                                                type="button"
                                                onClick={() => setSmartCardEnabled(p => !p)}
                                                className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-suprema-gray-50 transition-colors"
                                            >
                                                <span className="flex items-center gap-2 text-sm font-semibold text-suprema-gray-800">
                                                    <Fingerprint size={15} className="text-suprema-gray-500" /> Smart Card
                                                </span>
                                                <div className={`w-9 h-5 rounded-full transition-colors flex items-center px-0.5 ${smartCardEnabled ? 'bg-suprema-burgundy' : 'bg-suprema-gray-200'}`}>
                                                    <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${smartCardEnabled ? 'translate-x-4' : ''}`} />
                                                </div>
                                            </button>
                                            {smartCardEnabled && (
                                                <div className="px-3 pb-3 space-y-2">
                                                    {/* Leer tarjeta desde dispositivo Suprema */}
                                                    {cardEnrollers.length > 0 && (
                                                        <div className="rounded-lg border border-suprema-burgundy/20 bg-suprema-burgundy/5 p-2.5 space-y-2">
                                                            <p className="text-[11px] font-bold text-suprema-burgundy uppercase tracking-wide flex items-center gap-1">
                                                                <ScanLine size={11} /> Leer desde dispositivo Suprema
                                                            </p>
                                                            <div className="flex gap-2">
                                                                <select
                                                                    value={selectedCardEnrollerId}
                                                                    onChange={e => { setSelectedCardEnrollerId(e.target.value); setCardScanError(null); }}
                                                                    disabled={cardScanning}
                                                                    className="flex-1 px-2 py-1.5 border border-suprema-gray-200 rounded-lg text-xs text-suprema-gray-900 bg-white focus:ring-1 focus:ring-suprema-burgundy/30 focus:border-suprema-burgundy outline-none"
                                                                >
                                                                    <option value="">— Seleccionar dispositivo —</option>
                                                                    {cardEnrollers.map(d => (
                                                                        <option key={d.deviceId} value={d.deviceId}>{d.deviceName}</option>
                                                                    ))}
                                                                </select>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleCardScan(
                                                                        cn => setSmartCardNumber(cn),
                                                                        undefined,
                                                                        () => setSmartCardScanSuccess(true),
                                                                    )}
                                                                    disabled={!selectedCardEnrollerId || cardScanning}
                                                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-suprema-burgundy text-white text-xs font-bold rounded-lg hover:bg-suprema-burgundy/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                                                >
                                                                    {cardScanning ? <Loader2 size={12} className="animate-spin" /> : <ScanLine size={12} />}
                                                                    Escanear
                                                                </button>
                                                            </div>
                                                            {cardScanError && (
                                                                <p className="text-[11px] text-red-600 flex items-center gap-1">
                                                                    <AlertCircle size={11} /> {cardScanError}
                                                                </p>
                                                            )}
                                                            {smartCardScanSuccess && !cardScanError && smartCardNumber && (
                                                                <p className="text-[11px] text-emerald-700 flex items-center gap-1 font-semibold">
                                                                    <CheckCircle2 size={11} /> Tarjeta leída correctamente desde el dispositivo
                                                                </p>
                                                            )}
                                                        </div>
                                                    )}
                                                    <input
                                                        value={smartCardNumber}
                                                        onChange={e => { setSmartCardNumber(e.target.value); setSmartCardScanSuccess(false); }}
                                                        placeholder={selectedCardEnrollerId ? 'Auto-rellenado al escanear, o ingrese manualmente' : 'Número de Smart Card'}
                                                        className={`${inputBase} ${inputActive} text-sm font-mono`}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                        {/* QR Code */}
                                        <div className="border border-suprema-gray-200 rounded-xl overflow-hidden">
                                            <button
                                                type="button"
                                                onClick={() => setQrEnabled(p => !p)}
                                                className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-suprema-gray-50 transition-colors"
                                            >
                                                <span className="flex items-center gap-2 text-sm font-semibold text-suprema-gray-800">
                                                    <QrCode size={15} className="text-suprema-gray-500" /> QR de Acceso Dinámico
                                                </span>
                                                <div className={`w-9 h-5 rounded-full transition-colors flex items-center px-0.5 ${qrEnabled ? 'bg-emerald-500' : 'bg-suprema-gray-200'}`}>
                                                    <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${qrEnabled ? 'translate-x-4' : ''}`} />
                                                </div>
                                            </button>
                                            {qrEnabled && (
                                                <div className="px-3 pb-3 pt-1">
                                                    <p className="text-xs text-suprema-gray-800/50 leading-snug">
                                                        Se genera un portal web personal. Al registrar, obtendrás un enlace para compartir con el visitante.
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* ── Footer ── */}
                            <div className="border-t border-suprema-gray-100 bg-suprema-gray-50 flex-shrink-0">
                                {submitError && (
                                    <div className="px-6 pt-3 flex items-start gap-2 text-sm text-red-700">
                                        <AlertCircle size={15} className="mt-0.5 flex-shrink-0 text-red-500" />
                                        <span>{submitError}</span>
                                    </div>
                                )}
                                <div className="p-4 flex justify-between items-center">
                                    <button
                                        onClick={handleClose}
                                        className="px-5 py-2.5 text-suprema-gray-700 font-semibold hover:bg-suprema-gray-200/60 rounded-xl transition-colors text-sm"
                                    >
                                        {t('register.cancel')}
                                    </button>
                                    <button
                                        onClick={handleSubmit}
                                        disabled={!canSubmit}
                                        className="px-6 py-2.5 bg-suprema-burgundy text-white font-bold rounded-xl hover:bg-suprema-burgundy-dark disabled:opacity-40 transition-all shadow-md shadow-suprema-burgundy/20 flex items-center gap-2 text-sm"
                                    >
                                        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus size={16} />}
                                        Registrar y Programar
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            <FaceCaptureModal
                isOpen={showFaceCapture}
                onClose={() => setShowFaceCapture(false)}
                onCapture={handleFaceCapture}
            />
        </>
    );
}

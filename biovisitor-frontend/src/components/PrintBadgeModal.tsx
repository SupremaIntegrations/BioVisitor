'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { X, Printer, Loader2, AlertCircle, CheckCircle2, ChevronDown, Info } from 'lucide-react';
import { useReactToPrint } from 'react-to-print';
import { api } from '@/lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface PrintBadgeModalProps {
    isOpen: boolean;
    onClose: () => void;
    visitId: string | null;
    autoTrigger?: boolean;
}

interface BadgeData {
    visitId: string;
    visitorId: string;
    visitorName: string;
    company: string | null;
    position: string | null;
    documentType: string | null;
    documentNumber: string | null;
    host: string | null;
    purpose: string | null;
    scheduledAt: string | null;
    checkedInAt: string | null;
    status: string;
    photoBase64: string | null;
    qrDataUrl: string;
    issuedAt: string;
}

// ─── Paper formats (Sewoo LK-B30IIE compatible) ────────────────────────────────

type PaperFormat = 'portrait_62x100' | 'sewoo_4x3' | 'cr80';

interface FormatDef {
    label: string;
    desc: string;
    width: string;
    height: string;
    pageSize: string;
}

const PAPER_FORMATS: Record<PaperFormat, FormatDef> = {
    portrait_62x100: {
        label: '62 × 100 mm',
        desc: 'Etiqueta térmica (por defecto)',
        width: '62mm',
        height: '100mm',
        pageSize: '62mm 100mm',
    },
    sewoo_4x3: {
        label: '4" × 3" (101.6 × 76.2 mm)',
        desc: 'Sewoo LK-B30IIE estándar',
        width: '101.6mm',
        height: '76.2mm',
        pageSize: '101.6mm 76.2mm',
    },
    cr80: {
        label: '85.6 × 54 mm (CR80)',
        desc: 'ISO 7810 — Tarjeta estándar',
        width: '85.6mm',
        height: '54mm',
        pageSize: '85.6mm 54mm',
    },
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatDateTime(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-ES', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

// ─── Badge Template ────────────────────────────────────────────────────────────

function BadgeTemplate({ data, format }: { data: BadgeData; format: PaperFormat }) {
    const initial = data.visitorName.charAt(0).toUpperCase();
    const fmt = PAPER_FORMATS[format];
    const isLandscape = format === 'sewoo_4x3';

    if (isLandscape) {
        return (
            <div style={{
                width: fmt.width,
                height: fmt.height,
                backgroundColor: '#ffffff',
                fontFamily: 'Arial, Helvetica, sans-serif',
                display: 'flex',
                flexDirection: 'row',
                boxSizing: 'border-box',
                overflow: 'hidden',
            }}>
                {/* Left: burgundy header + photo */}
                <div style={{
                    width: '32mm',
                    backgroundColor: '#a12944',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '3mm',
                    gap: '2mm',
                    flexShrink: 0,
                }}>
                    <span style={{
                        fontSize: '5.5pt', fontWeight: 900, color: '#ffffff',
                        letterSpacing: '2.5px', textTransform: 'uppercase',
                        writingMode: 'vertical-rl', textOrientation: 'mixed',
                    }}>
                        VISITANTE
                    </span>
                    {data.photoBase64 ? (
                        <img src={data.photoBase64} alt="Foto" style={{
                            width: '20mm', height: '20mm', borderRadius: '50%',
                            objectFit: 'cover', border: '0.4mm solid rgba(255,255,255,0.4)',
                            filter: 'grayscale(100%)',
                        }} />
                    ) : (
                        <div style={{
                            width: '20mm', height: '20mm', borderRadius: '50%',
                            backgroundColor: 'rgba(255,255,255,0.15)',
                            border: '0.4mm solid rgba(255,255,255,0.4)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            <span style={{ fontSize: '14pt', fontWeight: 700, color: '#ffffff' }}>{initial}</span>
                        </div>
                    )}
                </div>

                {/* Right: info */}
                <div style={{ flex: 1, padding: '3.5mm 4mm', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '1.5mm' }}>
                    <div style={{ fontSize: '10pt', fontWeight: 900, color: '#111111', lineHeight: 1.2, wordBreak: 'break-word' }}>
                        {data.visitorName}
                    </div>
                    {data.company && (
                        <div style={{ fontSize: '7pt', fontWeight: 600, color: '#555555' }}>{data.company}</div>
                    )}
                    {data.documentNumber && (
                        <div style={{ fontSize: '6pt', color: '#888888', fontFamily: 'Courier New, monospace' }}>
                            {data.documentType ? `${data.documentType}: ` : ''}{data.documentNumber}
                        </div>
                    )}
                    <div style={{ borderTop: '0.3mm dashed #dddddd', paddingTop: '1.5mm', marginTop: '0.5mm' }} />
                    {data.host && (
                        <div>
                            <span style={{ fontSize: '5pt', color: '#aaaaaa', fontWeight: 700, textTransform: 'uppercase' }}>Visita a · </span>
                            <span style={{ fontSize: '6.5pt', fontWeight: 700, color: '#222222' }}>{data.host}</span>
                        </div>
                    )}
                    {data.purpose && (
                        <div>
                            <span style={{ fontSize: '5pt', color: '#aaaaaa', fontWeight: 700, textTransform: 'uppercase' }}>Motivo · </span>
                            <span style={{ fontSize: '6pt', color: '#444444' }}>{data.purpose}</span>
                        </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '1mm' }}>
                        <div>
                            <div style={{ fontSize: '5pt', color: '#aaaaaa', fontWeight: 700, textTransform: 'uppercase' }}>Ingreso</div>
                            <div style={{ fontSize: '6pt', color: '#333333' }}>{formatDateTime(data.checkedInAt ?? data.scheduledAt)}</div>
                        </div>
                        <img src={data.qrDataUrl} alt="QR" style={{ width: '22mm', height: '22mm', display: 'block', flexShrink: 0 }} />
                    </div>
                </div>
            </div>
        );
    }

    // Portrait layouts (62×100 and CR80)
    const isSmall = format === 'cr80';

    return (
        <div style={{
            width: fmt.width,
            height: fmt.height,
            backgroundColor: '#ffffff',
            fontFamily: 'Arial, Helvetica, sans-serif',
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            boxSizing: 'border-box',
        }}>
            <div style={{
                backgroundColor: '#a12944',
                color: '#ffffff',
                padding: isSmall ? '1.5mm 3mm' : '2.5mm 3mm 2mm',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
            }}>
                <span style={{ fontSize: isSmall ? '6pt' : '7.5pt', fontWeight: 900, letterSpacing: '3px', textTransform: 'uppercase' }}>
                    VISITANTE
                </span>
            </div>

            <div style={{ padding: isSmall ? '2mm 3mm 0' : '3mm 3mm 0', display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                {data.photoBase64 ? (
                    <img src={data.photoBase64} alt="Foto" style={{
                        width: isSmall ? '14mm' : '22mm',
                        height: isSmall ? '14mm' : '22mm',
                        borderRadius: '50%', objectFit: 'cover',
                        border: '0.4mm solid #cccccc', filter: 'grayscale(100%)', display: 'block',
                    }} />
                ) : (
                    <div style={{
                        width: isSmall ? '14mm' : '22mm',
                        height: isSmall ? '14mm' : '22mm',
                        borderRadius: '50%', backgroundColor: '#f0f0f0',
                        border: '0.4mm solid #cccccc',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <span style={{ fontSize: isSmall ? '10pt' : '14pt', fontWeight: 700, color: '#999999' }}>{initial}</span>
                    </div>
                )}
                <div style={{ textAlign: 'center', marginTop: '1.5mm', width: '100%' }}>
                    <div style={{ fontSize: isSmall ? '7pt' : '9pt', fontWeight: 900, color: '#111111', lineHeight: 1.2, wordBreak: 'break-word' }}>
                        {data.visitorName}
                    </div>
                    {data.company && (
                        <div style={{ fontSize: isSmall ? '6pt' : '7pt', color: '#555555', marginTop: '0.5mm', fontWeight: 600 }}>
                            {data.company}
                        </div>
                    )}
                    {data.documentNumber && (
                        <div style={{ fontSize: '6pt', color: '#888888', marginTop: '0.3mm', fontFamily: 'Courier New, monospace' }}>
                            {data.documentType ? `${data.documentType}: ` : ''}{data.documentNumber}
                        </div>
                    )}
                </div>
            </div>

            <div style={{ margin: isSmall ? '1.5mm 3mm' : '2mm 3mm', borderTop: '0.3mm dashed #cccccc', flexShrink: 0 }} />

            <div style={{ padding: '0 3mm', flexShrink: 0 }}>
                {data.host && (
                    <div style={{ marginBottom: '1.5mm' }}>
                        <div style={{ fontSize: '5pt', color: '#999999', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Visita a</div>
                        <div style={{ fontSize: isSmall ? '6pt' : '7pt', fontWeight: 700, color: '#111111' }}>{data.host}</div>
                    </div>
                )}
                {data.purpose && !isSmall && (
                    <div style={{ marginBottom: '1.5mm' }}>
                        <div style={{ fontSize: '5pt', color: '#999999', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Motivo</div>
                        <div style={{ fontSize: '6.5pt', color: '#333333' }}>{data.purpose}</div>
                    </div>
                )}
                <div>
                    <div style={{ fontSize: '5pt', color: '#999999', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Ingreso</div>
                    <div style={{ fontSize: '6pt', color: '#333333' }}>{formatDateTime(data.checkedInAt ?? data.scheduledAt)}</div>
                </div>
            </div>

            <div style={{ margin: isSmall ? '1.5mm 3mm' : '2mm 3mm', borderTop: '0.3mm dashed #cccccc', flexShrink: 0 }} />

            <div style={{ display: 'flex', justifyContent: 'center', flexShrink: 0, padding: '0 3mm' }}>
                <img src={data.qrDataUrl} alt="QR de acceso" style={{ width: isSmall ? '18mm' : '26mm', height: isSmall ? '18mm' : '26mm', display: 'block' }} />
            </div>

            <div style={{ textAlign: 'center', padding: '1mm 3mm 0', flexShrink: 0 }}>
                <div style={{ fontSize: '5pt', color: '#bbbbbb' }}>Emitido: {formatDateTime(data.issuedAt)}</div>
            </div>

            <div style={{ flex: 1 }} />
        </div>
    );
}

// ─── Main Modal ────────────────────────────────────────────────────────────────

export default function PrintBadgeModal({ isOpen, onClose, visitId, autoTrigger }: PrintBadgeModalProps) {
    const badgeRef = useRef<HTMLDivElement>(null);
    const [badgeData, setBadgeData] = useState<BadgeData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [printed, setPrinted] = useState(false);
    const [format, setFormat] = useState<PaperFormat>('portrait_62x100');
    const [showFormatMenu, setShowFormatMenu] = useState(false);
    const [showTips, setShowTips] = useState(false);
    const autoTriggered = useRef(false);

    const fmt = PAPER_FORMATS[format];

    const logPrintAudit = useCallback(async () => {
        if (!visitId) return;
        try {
            await api.post(`/visitors/visit/${visitId}/badge-print`);
            setPrinted(true);
        } catch {
            // Non-critical
        }
    }, [visitId]);

    const reactToPrintFn = useReactToPrint({
        contentRef: badgeRef,
        documentTitle: badgeData ? `Gafete - ${badgeData.visitorName}` : 'Gafete de Visitante',
        pageStyle: `
            @page { size: ${fmt.pageSize}; margin: 0; }
            body { margin: 0; padding: 0; }
            * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        `,
        onAfterPrint: logPrintAudit,
    });

    useEffect(() => {
        if (!isOpen || !visitId) {
            setBadgeData(null);
            setError(null);
            setPrinted(false);
            autoTriggered.current = false;
            setShowFormatMenu(false);
            return;
        }
        setLoading(true);
        setError(null);
        setPrinted(false);
        api.get<BadgeData>(`/visitors/visit/${visitId}/badge-data`)
            .then(res => setBadgeData(res.data))
            .catch(() => setError('No se pudieron cargar los datos del gafete.'))
            .finally(() => setLoading(false));
    }, [isOpen, visitId]);

    useEffect(() => {
        if (autoTrigger && badgeData && !loading && !autoTriggered.current) {
            autoTriggered.current = true;
            const t = setTimeout(() => reactToPrintFn(), 400);
            return () => clearTimeout(t);
        }
    }, [autoTrigger, badgeData, loading, reactToPrintFn]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col">

                {/* ── Header ─────────────────────────────────────────────── */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                    <div className="flex items-center gap-2.5">
                        <Printer size={18} className="text-[#a12944]" />
                        <h3 className="text-base font-bold text-gray-900">Imprimir Gafete</h3>
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* ── Format selector ────────────────────────────────────── */}
                <div className="px-5 pt-4 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Formato de papel</span>
                        <button
                            onClick={() => setShowTips(v => !v)}
                            className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 font-semibold"
                        >
                            <Info size={12} /> Sewoo LK-B30IIE
                        </button>
                    </div>

                    {/* Dropdown */}
                    <div className="relative">
                        <button
                            onClick={() => setShowFormatMenu(v => !v)}
                            className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-800 hover:border-[#a12944] transition-colors"
                        >
                            <span className="flex flex-col items-start gap-0.5">
                                <span>{fmt.label}</span>
                                <span className="text-xs font-normal text-gray-400">{fmt.desc}</span>
                            </span>
                            <ChevronDown size={15} className={`text-gray-400 transition-transform ${showFormatMenu ? 'rotate-180' : ''}`} />
                        </button>
                        {showFormatMenu && (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-10 overflow-hidden">
                                {(Object.entries(PAPER_FORMATS) as [PaperFormat, FormatDef][]).map(([key, def]) => (
                                    <button
                                        key={key}
                                        onClick={() => { setFormat(key); setShowFormatMenu(false); }}
                                        className={`w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-gray-50 transition-colors text-left ${key === format ? 'bg-[#a12944]/5' : ''}`}
                                    >
                                        <span className="flex flex-col gap-0.5">
                                            <span className={`font-semibold ${key === format ? 'text-[#a12944]' : 'text-gray-800'}`}>{def.label}</span>
                                            <span className="text-xs text-gray-400">{def.desc}</span>
                                        </span>
                                        {key === format && <CheckCircle2 size={14} className="text-[#a12944]" />}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Sewoo tips panel */}
                    {showTips && (
                        <div className="p-3.5 rounded-xl bg-blue-50 border border-blue-100 text-xs text-blue-800 leading-relaxed">
                            <p className="font-bold mb-1.5">Configuración Sewoo LK-B30IIE:</p>
                            <ol className="list-decimal list-inside space-y-1 text-blue-700">
                                <li>Selecciona formato <strong>4" × 3"</strong> en este selector.</li>
                                <li>Haz clic en <strong>Imprimir</strong> — se abrirá el diálogo del SO.</li>
                                <li>Elige <strong>Sewoo LK-B30IIE</strong> en el selector de impresoras.</li>
                                <li>Verifica que el tamaño sea <strong>101.6 × 76.2 mm</strong> y orientación <strong>horizontal</strong>.</li>
                                <li>Desactiva encabezados/pies de página en "Más ajustes".</li>
                            </ol>
                            <p className="mt-2 text-blue-600">Para USB: instala el controlador Sewoo y configura como impresora predeterminada. Para red: agrega la impresora con su IP (TCP/IP).</p>
                        </div>
                    )}
                </div>

                {/* ── Badge preview ───────────────────────────────────────── */}
                <div className="p-5 flex flex-col items-center gap-4 bg-gray-50 min-h-[160px] justify-center">
                    {loading && (
                        <div className="flex flex-col items-center gap-3 py-8">
                            <Loader2 size={28} className="animate-spin text-[#a12944]" />
                            <p className="text-sm text-gray-500">Generando gafete…</p>
                        </div>
                    )}

                    {error && !loading && (
                        <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm w-full">
                            <AlertCircle size={16} className="flex-shrink-0" />
                            {error}
                        </div>
                    )}

                    {badgeData && !loading && (
                        <>
                            {/* Screen preview */}
                            <div className="shadow-lg rounded border border-gray-200 overflow-hidden" style={{ width: fmt.width, height: fmt.height }}>
                                <BadgeTemplate data={badgeData} format={format} />
                            </div>

                            {/* Off-screen clone for react-to-print */}
                            <div style={{ position: 'absolute', left: '-9999px', top: 0, zIndex: -1 }}>
                                <div ref={badgeRef}>
                                    <BadgeTemplate data={badgeData} format={format} />
                                </div>
                            </div>

                            {printed && (
                                <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold">
                                    <CheckCircle2 size={13} />
                                    Gafete registrado en historial de impresiones
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* ── Footer ─────────────────────────────────────────────── */}
                <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-3 bg-white">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 rounded-xl transition-colors">
                        Cerrar
                    </button>
                    <button
                        onClick={() => reactToPrintFn()}
                        disabled={!badgeData || loading}
                        className="flex items-center gap-2 px-5 py-2 bg-[#a12944] text-white text-sm font-bold rounded-xl hover:bg-[#8b1f35] transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Printer size={15} />
                        Imprimir
                    </button>
                </div>
            </div>
        </div>
    );
}

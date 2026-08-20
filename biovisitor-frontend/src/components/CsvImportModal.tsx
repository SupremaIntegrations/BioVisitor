'use client';

import { useState, useRef, useCallback } from 'react';
import { Upload, X, Download, AlertCircle, CheckCircle2, Loader2, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { useVisitorTypeCatalog } from '@/lib/visitor-types';

interface ImportRow {
  firstName: string;
  lastName: string;
  documentNumber: string;
  documentType?: string;
  email?: string;
  phone?: string;
  company?: string;
  purpose?: string;
  scheduledAt?: string;
  visitorType?: string;
}

interface ImportResult {
  total: number;
  created: number;
  updated: number;
  failed: number;
  errors: { row: number; message: string }[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const CSV_HEADERS = ['firstName', 'lastName', 'documentNumber', 'documentType', 'email', 'phone', 'company', 'purpose', 'scheduledAt', 'visitorType'];

const TEMPLATE_CSV = [
  '# visitorType acepta cualquier tipo predefinido o personalizado creado en Configuración > Tipos de Visitante (celda vacía usa WALK_IN)',
  CSV_HEADERS.join(','),
  'Juan,Pérez,12345678,NATIONAL_ID,juan@email.com,3001234567,Acme Corp,Visita comercial,2026-05-10T09:00,CONTRACTOR',
  'María,García,87654321,NATIONAL_ID,maria@email.com,,Empresa XYZ,Entrevista,,INTERVIEW',
  'Carlos,López,11223344,NATIONAL_ID,,,,,2026-05-10T14:00,WALK_IN',
].join('\n');

/**
 * Splits one CSV line respecting quoted fields (RFC 4180).
 * Handles commas and semicolons inside quotes.
 */
function splitCsvLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === sep && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCsv(text: string): ImportRow[] {
  // 1. Strip BOM (Excel adds \uFEFF at the start)
  const clean = text.replace(/^\uFEFF/, '');
  // 2. Normalize line endings (\r\n or lone \r → \n)
  const normalized = clean.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
  if (lines.length < 2) return [];

  // 3. Auto-detect separator: use semicolon if first line has more ';' than ','
  const firstLine = lines[0];
  const sep = (firstLine.split(';').length > firstLine.split(',').length) ? ';' : ',';

  const headers = splitCsvLine(firstLine, sep).map(h => h.replace(/^"|"$/g, '').trim());

  return lines.slice(1).map(line => {
    const values = splitCsvLine(line, sep).map(v => v.replace(/^"|"$/g, '').trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ''; });
    return {
      firstName: row.firstName ?? '',
      lastName: row.lastName ?? '',
      documentNumber: row.documentNumber ?? '',
      documentType: row.documentType || 'NATIONAL_ID',
      email: row.email || undefined,
      phone: row.phone || undefined,
      company: row.company || undefined,
      purpose: row.purpose || undefined,
      scheduledAt: row.scheduledAt || undefined,
      visitorType: row.visitorType || 'WALK_IN',
    };
  }).filter(r => r.firstName && r.lastName && r.documentNumber);
}

export default function CsvImportModal({ isOpen, onClose, onSuccess }: Props) {
  const { keys: validVisitorTypes } = useVisitorTypeCatalog();
  const [csvText, setCsvText] = useState('');
  const [parsedRows, setParsedRows] = useState<ImportRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleTextChange = (text: string) => {
    setCsvText(text);
    setParseError(null);
    setResult(null);
    if (!text.trim()) { setParsedRows([]); return; }
    try {
      const rows = parseCsv(text);
      if (rows.length === 0) {
        setParseError('No se encontraron filas válidas. Verifica que el CSV tenga encabezados y al menos una fila con firstName, lastName y documentNumber.');
        setParsedRows([]);
      } else {
        setParsedRows(rows);
      }
    } catch {
      setParseError('Error al parsear el CSV. Verifica el formato.');
      setParsedRows([]);
    }
  };

  const handleFileUpload = useCallback((file: File) => {
    if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
      setParseError('Por favor sube un archivo .csv');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => handleTextChange(e.target?.result as string ?? '');
    reader.readAsText(file, 'UTF-8');
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  };

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla_importacion_visitantes.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSubmit = async () => {
    if (parsedRows.length === 0) return;
    setIsLoading(true);
    try {
      const res = await api.post<ImportResult>('/visitors/import-csv', { rows: parsedRows });
      setResult(res.data);
      if (res.data.created > 0 || res.data.updated > 0) {
        onSuccess();
      }
    } catch (err: any) {
      setParseError(err.response?.data?.message ?? 'Error al importar. Intenta de nuevo.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setCsvText('');
    setParsedRows([]);
    setParseError(null);
    setResult(null);
    setIsLoading(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-suprema-burgundy/10 rounded-xl">
              <Upload size={18} className="text-suprema-burgundy" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Importar Visitantes desde CSV</h2>
              <p className="text-xs text-gray-500">Carga masiva de visitantes y agendamiento</p>
            </div>
          </div>
          <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

          {result ? (
            /* ── Result screen ── */
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                <CheckCircle2 size={20} className="text-emerald-600 flex-shrink-0" />
                <div>
                  <p className="text-sm font-bold text-emerald-800">Importación completada</p>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    {result.created} creado{result.created !== 1 ? 's' : ''} · {result.updated} actualizado{result.updated !== 1 ? 's' : ''} · {result.failed} fallido{result.failed !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
              {result.errors.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-bold text-red-600 uppercase tracking-wider">Errores ({result.errors.length})</p>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {result.errors.map((e, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-red-700 bg-red-50 rounded-lg p-2">
                        <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
                        <span>Fila {e.row}: {e.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* ── Template download ── */}
              <div className="space-y-2">
                <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-xl">
                  <div className="flex items-center gap-2">
                    <FileText size={14} className="text-blue-600" />
                    <span className="text-xs font-semibold text-blue-800">Descarga la plantilla para ver el formato correcto</span>
                  </div>
                  <button
                    onClick={downloadTemplate}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors"
                  >
                    <Download size={12} />
                    Plantilla CSV
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 px-1">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Tipos de visitante válidos:</span>
                  {validVisitorTypes.map(t => (
                    <span key={t} className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200">{t}</span>
                  ))}
                  <span className="text-[10px] text-gray-400 italic">· celda vacía usa WALK_IN automáticamente</span>
                </div>
              </div>

              {/* ── Drop zone ── */}
              <div
                className={`relative border-2 border-dashed rounded-xl transition-colors ${isDragging ? 'border-suprema-burgundy bg-suprema-burgundy/5' : 'border-gray-200 hover:border-gray-300'}`}
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                <div className="flex flex-col items-center justify-center py-6 gap-2">
                  <Upload size={24} className="text-gray-300" />
                  <p className="text-sm font-semibold text-gray-500">Arrastra tu CSV aquí</p>
                  <p className="text-xs text-gray-400">o</p>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-1.5 bg-suprema-burgundy text-white rounded-lg text-xs font-bold hover:bg-suprema-burgundy-dark transition-colors"
                  >
                    Seleccionar archivo
                  </button>
                </div>
                <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e => e.target.files?.[0] && handleFileUpload(e.target.files[0])} />
              </div>

              {/* ── Or paste ── */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                  O pega el contenido del CSV
                </label>
                <textarea
                  value={csvText}
                  onChange={e => handleTextChange(e.target.value)}
                  placeholder={`firstName,lastName,documentNumber,...\nJuan,Pérez,12345678,...`}
                  className="w-full h-28 font-mono text-xs p-3 border border-gray-200 rounded-xl resize-none focus:border-suprema-burgundy/50 focus:ring-2 focus:ring-suprema-burgundy/10 outline-none transition-all bg-gray-50"
                />
              </div>

              {/* ── Parse error ── */}
              {parseError && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                  {parseError}
                </div>
              )}

              {/* ── Preview ── */}
              {parsedRows.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                      Vista previa — {parsedRows.length} fila{parsedRows.length !== 1 ? 's' : ''} válida{parsedRows.length !== 1 ? 's' : ''}
                    </p>
                    {parsedRows.length > 5 && (
                      <span className="text-[10px] text-gray-400">Mostrando primeras 5</span>
                    )}
                  </div>
                  <div className="overflow-x-auto border border-gray-200 rounded-xl">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          {['Nombre', 'Apellido', 'Documento', 'Empresa', 'Tipo', 'Hora'].map(h => (
                            <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {parsedRows.slice(0, 5).map((r, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-semibold text-gray-900">{r.firstName}</td>
                            <td className="px-3 py-2 text-gray-700">{r.lastName}</td>
                            <td className="px-3 py-2 font-mono text-gray-600">{r.documentNumber}</td>
                            <td className="px-3 py-2 text-gray-500">{r.company || '—'}</td>
                            <td className="px-3 py-2 text-gray-500">{r.visitorType || 'WALK_IN'}</td>
                            <td className="px-3 py-2 text-gray-400">{r.scheduledAt ? new Date(r.scheduledAt).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Ahora'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
          <button onClick={handleClose} className="px-4 py-2 text-sm font-semibold text-gray-600 hover:text-gray-800 transition-colors">
            {result ? 'Cerrar' : 'Cancelar'}
          </button>
          {!result && (
            <button
              onClick={handleSubmit}
              disabled={parsedRows.length === 0 || isLoading}
              className="flex items-center gap-2 px-5 py-2 bg-suprema-burgundy text-white rounded-xl font-bold text-sm hover:bg-suprema-burgundy-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              {isLoading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              {isLoading ? 'Importando...' : `Importar ${parsedRows.length} visitante${parsedRows.length !== 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

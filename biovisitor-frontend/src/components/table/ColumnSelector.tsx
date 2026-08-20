'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Columns3, Lock } from 'lucide-react';

export interface ColumnDef {
    id: string;
    label: string;
    alwaysVisible?: boolean;
    defaultVisible?: boolean;
}

interface Props {
    columns: ColumnDef[];
    visibleColumns: Set<string>;
    onToggle: (columnId: string) => void;
}

export default function ColumnSelector({ columns, visibleColumns, onToggle }: Props) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function onClick(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, []);

    const toggleable = columns.filter(c => !c.alwaysVisible);

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={() => setOpen(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors ${
                    open
                        ? 'bg-suprema-gray-900 text-white border-suprema-gray-900'
                        : 'bg-white border-suprema-gray-200 text-suprema-gray-800/70 hover:border-suprema-gray-300 hover:text-suprema-gray-900'
                }`}
                title="Mostrar/ocultar columnas"
            >
                <Columns3 size={14} />
                Columnas
            </button>

            {open && (
                <div className="absolute right-0 top-full mt-2 z-50 w-56 bg-white rounded-xl shadow-xl border border-suprema-gray-100 p-2 animate-in fade-in slide-in-from-top-1 duration-150">
                    <p className="text-[10px] font-bold text-suprema-gray-800/40 uppercase tracking-wider px-2 py-1 mb-1">
                        Columnas visibles
                    </p>
                    {columns.map(col => (
                        <label
                            key={col.id}
                            className={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                                col.alwaysVisible
                                    ? 'opacity-50 cursor-not-allowed'
                                    : 'cursor-pointer hover:bg-suprema-gray-100/60'
                            }`}
                        >
                            <input
                                type="checkbox"
                                checked={visibleColumns.has(col.id)}
                                onChange={() => !col.alwaysVisible && onToggle(col.id)}
                                disabled={col.alwaysVisible}
                                className="w-3.5 h-3.5 rounded accent-suprema-burgundy"
                            />
                            <span className="flex-1 text-suprema-gray-900">{col.label}</span>
                            {col.alwaysVisible && <Lock size={10} className="text-suprema-gray-800/30" />}
                        </label>
                    ))}
                </div>
            )}
        </div>
    );
}

import React, { useState, useRef, useEffect } from 'react';
import { Shield, ChevronDown, X, AlertCircle, Check } from 'lucide-react';

export interface AccessGroup {
    id: number;
    name: string;
}

interface AccessGroupSelectProps {
    groups: AccessGroup[];
    selected: AccessGroup[];
    onChange: (groups: AccessGroup[]) => void;
    loading?: boolean;
    error?: boolean;
    disabled?: boolean;
}

export default function AccessGroupSelect({
    groups,
    selected,
    onChange,
    loading = false,
    error = false,
    disabled = false,
}: AccessGroupSelectProps) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const toggle = (group: AccessGroup) => {
        const exists = selected.some((g) => g.id === group.id);
        if (exists) {
            onChange(selected.filter((g) => g.id !== group.id));
        } else {
            onChange([...selected, group]);
        }
    };

    const remove = (id: number, e: React.MouseEvent) => {
        e.stopPropagation();
        onChange(selected.filter((g) => g.id !== id));
    };

    if (error) {
        return (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                <AlertCircle size={15} className="mt-0.5 flex-shrink-0 text-red-500" />
                <span>Error al obtener los grupos de acceso de BioStar 2. Revisa la conexión con el servidor.</span>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="h-8 bg-gray-100 rounded-lg animate-pulse" />
                ))}
            </div>
        );
    }

    if (groups.length === 0) {
        return (
            <p className="text-xs text-gray-400 italic py-1">
                Sin grupos de acceso configurados en BioStar. El visitante no tendrá acceso físico.
            </p>
        );
    }

    return (
        <div ref={containerRef} className="relative">
            <button
                type="button"
                disabled={disabled}
                onClick={() => setOpen((v) => !v)}
                className={`w-full flex items-center gap-2 px-3 py-2.5 border-2 rounded-xl text-sm text-left transition-colors
                    ${open ? 'border-suprema-burgundy bg-white' : 'border-suprema-gray-200 bg-white'}
                    ${disabled ? 'opacity-40 pointer-events-none' : 'hover:border-suprema-gray-400'}`}
            >
                <Shield size={14} className="text-suprema-gray-500 flex-shrink-0" />
                <div className="flex-1 flex flex-wrap gap-1 min-h-[1.25rem]">
                    {selected.length === 0 ? (
                        <span className="text-suprema-gray-400">Sin grupos asignados (sin acceso físico)</span>
                    ) : (
                        selected.map((g) => (
                            <span
                                key={g.id}
                                className="inline-flex items-center gap-1 px-2 py-0.5 bg-suprema-burgundy/10 text-suprema-burgundy text-xs font-semibold rounded-full"
                            >
                                {g.name}
                                <span
                                    role="button"
                                    tabIndex={0}
                                    onClick={(e) => remove(g.id, e)}
                                    onKeyDown={(e) => e.key === 'Enter' && remove(g.id, e as any)}
                                    className="hover:text-red-600 transition-colors cursor-pointer"
                                >
                                    <X size={10} />
                                </span>
                            </span>
                        ))
                    )}
                </div>
                <ChevronDown
                    size={14}
                    className={`flex-shrink-0 text-suprema-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
                />
            </button>

            {open && (
                <div className="absolute z-50 top-full mt-1 w-full bg-white border border-suprema-gray-200 rounded-xl shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                    {groups.map((group) => {
                        const isSelected = selected.some((g) => g.id === group.id);
                        return (
                            <button
                                key={group.id}
                                type="button"
                                onClick={() => toggle(group)}
                                className={`w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-suprema-gray-50 transition-colors text-left
                                    ${isSelected ? 'bg-suprema-burgundy/5 text-suprema-burgundy font-semibold' : 'text-suprema-gray-800'}`}
                            >
                                <span className="flex items-center gap-2">
                                    <Shield size={13} className={isSelected ? 'text-suprema-burgundy' : 'text-suprema-gray-400'} />
                                    {group.name}
                                </span>
                                {isSelected && <Check size={13} className="text-suprema-burgundy flex-shrink-0" />}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

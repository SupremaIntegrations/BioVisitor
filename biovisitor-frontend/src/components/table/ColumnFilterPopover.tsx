'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Filter, X } from 'lucide-react';

export type FilterType = 'text' | 'select' | 'date';

export type FilterOperator =
    | 'contains' | 'not_contains'
    | 'equals' | 'not_equals'
    | 'starts_with'
    | 'gt' | 'lt'
    | 'before' | 'after'
    | 'empty' | 'not_empty';

export interface ColumnFilter {
    columnId: string;
    operator: FilterOperator;
    value: string;
}

interface OperatorOption {
    value: FilterOperator;
    label: string;
}

const TEXT_OPERATORS: OperatorOption[] = [
    { value: 'contains', label: 'Contiene' },
    { value: 'not_contains', label: 'No contiene' },
    { value: 'equals', label: 'Igual a' },
    { value: 'not_equals', label: 'No igual a' },
    { value: 'starts_with', label: 'Empieza con' },
    { value: 'empty', label: 'Vacío' },
    { value: 'not_empty', label: 'No vacío' },
];

const SELECT_OPERATORS: OperatorOption[] = [
    { value: 'equals', label: 'Igual a' },
    { value: 'not_equals', label: 'No igual a' },
];

const DATE_OPERATORS: OperatorOption[] = [
    { value: 'before', label: 'Antes de' },
    { value: 'after', label: 'Después de' },
    { value: 'equals', label: 'Igual a' },
    { value: 'empty', label: 'Vacío' },
    { value: 'not_empty', label: 'No vacío' },
];

function getOperators(type: FilterType): OperatorOption[] {
    if (type === 'select') return SELECT_OPERATORS;
    if (type === 'date') return DATE_OPERATORS;
    return TEXT_OPERATORS;
}

export function applyFilter(value: string, filter: ColumnFilter): boolean {
    const v = value.toLowerCase().trim();
    const f = filter.value.toLowerCase().trim();
    switch (filter.operator) {
        case 'contains': return v.includes(f);
        case 'not_contains': return !v.includes(f);
        case 'equals': return v === f;
        case 'not_equals': return v !== f;
        case 'starts_with': return v.startsWith(f);
        case 'empty': return v === '';
        case 'not_empty': return v !== '';
        case 'before': return f ? new Date(value) < new Date(filter.value) : true;
        case 'after': return f ? new Date(value) > new Date(filter.value) : true;
        case 'gt': return parseFloat(v) > parseFloat(f);
        case 'lt': return parseFloat(v) < parseFloat(f);
        default: return true;
    }
}

interface Props {
    columnId: string;
    columnLabel: string;
    filterType: FilterType;
    filterOptions?: { label: string; value: string }[];
    activeFilter: ColumnFilter | undefined;
    onFilterChange: (filter: ColumnFilter | null) => void;
}

export default function ColumnFilterPopover({
    columnId,
    columnLabel,
    filterType,
    filterOptions = [],
    activeFilter,
    onFilterChange,
}: Props) {
    const [open, setOpen] = useState(false);
    const [operator, setOperator] = useState<FilterOperator>(
        activeFilter?.operator ?? (filterType === 'select' ? 'equals' : 'contains')
    );
    const [value, setValue] = useState(activeFilter?.value ?? '');
    const popoverRef = useRef<HTMLDivElement>(null);
    const btnRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (activeFilter) {
            setOperator(activeFilter.operator);
            setValue(activeFilter.value);
        } else {
            const defaultOp = filterType === 'select' ? 'equals' : 'contains';
            setOperator(defaultOp);
            setValue('');
        }
    }, [activeFilter, filterType]);

    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
                btnRef.current && !btnRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const operators = getOperators(filterType);
    const noValueNeeded = operator === 'empty' || operator === 'not_empty';
    const isActive = !!activeFilter;

    function apply() {
        if (!noValueNeeded && value.trim() === '') {
            onFilterChange(null);
        } else {
            onFilterChange({ columnId, operator, value: noValueNeeded ? '' : value });
        }
        setOpen(false);
    }

    function clear() {
        setValue('');
        const defaultOp = filterType === 'select' ? 'equals' : 'contains';
        setOperator(defaultOp);
        onFilterChange(null);
        setOpen(false);
    }

    return (
        <div className="relative inline-flex items-center">
            <button
                ref={btnRef}
                onClick={() => setOpen(v => !v)}
                className={`p-0.5 rounded transition-colors focus:outline-none ${
                    isActive
                        ? 'text-suprema-burgundy'
                        : 'text-suprema-gray-800/30 hover:text-suprema-gray-800/60'
                }`}
                title={`Filtrar por ${columnLabel}`}
            >
                <Filter size={11} className={isActive ? 'fill-suprema-burgundy/20' : ''} />
            </button>

            {open && (
                <div
                    ref={popoverRef}
                    className="absolute top-full left-0 mt-2 z-50 w-64 bg-white rounded-xl shadow-xl border border-suprema-gray-100 p-3 animate-in fade-in slide-in-from-top-1 duration-150"
                    style={{ minWidth: 220 }}
                >
                    <p className="text-[11px] font-bold text-suprema-gray-800/50 uppercase tracking-wider mb-2">
                        Filtro — {columnLabel}
                    </p>

                    <select
                        value={operator}
                        onChange={e => setOperator(e.target.value as FilterOperator)}
                        className="w-full px-2.5 py-1.5 border border-suprema-gray-200 rounded-lg text-xs font-semibold text-suprema-gray-900 outline-none focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy mb-2 bg-white"
                    >
                        {operators.map(op => (
                            <option key={op.value} value={op.value}>{op.label}</option>
                        ))}
                    </select>

                    {!noValueNeeded && filterType === 'select' && (
                        <select
                            value={value}
                            onChange={e => setValue(e.target.value)}
                            className="w-full px-2.5 py-1.5 border border-suprema-gray-200 rounded-lg text-xs font-semibold text-suprema-gray-900 outline-none focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy mb-3 bg-white"
                        >
                            <option value="">Selecciona...</option>
                            {filterOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    )}

                    {!noValueNeeded && filterType === 'date' && (
                        <input
                            type="date"
                            value={value}
                            onChange={e => setValue(e.target.value)}
                            className="w-full px-2.5 py-1.5 border border-suprema-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy mb-3"
                        />
                    )}

                    {!noValueNeeded && filterType === 'text' && (
                        <input
                            type="text"
                            autoFocus
                            value={value}
                            onChange={e => setValue(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') apply(); if (e.key === 'Escape') setOpen(false); }}
                            placeholder="Valor..."
                            className="w-full px-2.5 py-1.5 border border-suprema-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy mb-3"
                        />
                    )}

                    {noValueNeeded && <div className="mb-3" />}

                    <div className="flex gap-2">
                        <button
                            onClick={apply}
                            className="flex-1 px-3 py-1.5 bg-suprema-gray-900 text-white rounded-lg text-xs font-bold hover:bg-black transition-colors"
                        >
                            Aplicar
                        </button>
                        {isActive && (
                            <button
                                onClick={clear}
                                className="px-3 py-1.5 border border-suprema-gray-200 rounded-lg text-xs font-semibold text-suprema-gray-800/60 hover:text-red-600 hover:border-red-200 transition-colors flex items-center gap-1"
                            >
                                <X size={10} /> Limpiar
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

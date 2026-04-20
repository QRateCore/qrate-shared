'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export type SelectSize = 'sm' | 'md';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  options: SelectOption[];
  placeholder?: string;
  size?: SelectSize;
  error?: boolean;
  fullWidth?: boolean;
  value?: string;
  onChange?: React.ChangeEventHandler<HTMLSelectElement>;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  id?: string;
  name?: string;
  style?: React.CSSProperties;
  className?: string;
  'data-testid'?: string;
}

const TRIGGER_SIZE: Record<SelectSize, string> = {
  sm: 'text-xs py-[3px] px-2 gap-1',
  md: 'text-sm py-[7px] px-3 gap-2',
};

const OPTION_SIZE: Record<SelectSize, string> = {
  sm: 'text-xs py-[5px] px-2.5',
  md: 'text-sm py-2 px-3',
};

export default function Select({
  options,
  placeholder = '— Select —',
  size = 'md',
  error = false,
  fullWidth = false,
  value,
  onChange,
  onClick,
  disabled = false,
  id,
  style,
  className = '',
  'data-testid': testId,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const hasValue = value !== undefined && value !== '';
  const selectedLabel = options.find((o) => o.value === value)?.label;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  function handleSelect(optValue: string) {
    onChange?.({ target: { value: optValue } } as React.ChangeEvent<HTMLSelectElement>);
    setOpen(false);
  }

  return (
    <div
      ref={containerRef}
      className={`relative ${fullWidth ? 'w-full' : 'inline-block'} ${className}`}
      style={style}
    >
      {/* ── Trigger ── */}
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        data-testid={testId}
        onClick={(e) => { onClick?.(e); !disabled && setOpen((o) => !o); }}
        className={[
          'flex items-center w-full rounded-[var(--r-xs)] border bg-white',
          'transition-colors duration-100 select-none outline-none',
          TRIGGER_SIZE[size],
          error
            ? 'border-red-400 bg-red-50'
            : open
              ? 'border-[var(--brand-s)]'
              : 'border-[var(--border)] hover:border-[var(--text3)]',
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <span
          className={`flex-1 text-left truncate ${
            size === 'md' ? 'font-medium' : ''
          } ${hasValue ? 'text-[var(--text)]' : 'text-[var(--text3)]'}`}
        >
          {selectedLabel ?? placeholder}
        </span>
        <ChevronDown
          size={size === 'sm' ? 11 : 13}
          className={`shrink-0 text-[var(--text3)] transition-transform duration-200 ${
            open ? 'rotate-180' : 'rotate-0'
          }`}
        />
      </button>

      {/* ── Dropdown panel ── */}
      <div
        role="listbox"
        data-testid={testId ? `${testId}-listbox` : undefined}
        className={[
          'absolute left-0 top-full mt-1 z-50 min-w-full',
          'bg-white border border-[var(--border)] rounded-[var(--r)] py-1',
          'shadow-[0_8px_24px_rgba(0,0,0,0.10)] overflow-y-auto max-h-52',
          'transition-all duration-150 origin-top',
          open
            ? 'opacity-100 scale-y-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 scale-y-95 -translate-y-1 pointer-events-none',
        ].join(' ')}
      >
        {options.map((opt) => {
          const isSelected = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={() => handleSelect(opt.value)}
              className={[
                'w-full flex items-center gap-2 text-left cursor-pointer transition-colors',
                OPTION_SIZE[size],
                isSelected
                  ? 'text-[var(--brand-s)] bg-orange-50 font-medium'
                  : 'text-[var(--text)] hover:bg-[var(--bg2)]',
              ].join(' ')}
            >
              <span className="flex-1 truncate">{opt.label}</span>
              {isSelected && (
                <Check
                  size={size === 'sm' ? 10 : 12}
                  className="shrink-0 text-[var(--brand-s)]"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

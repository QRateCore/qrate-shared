'use client';

import { forwardRef } from 'react';

type SelectSize = 'sm' | 'md';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /** Options to render */
  options: SelectOption[];
  /** Placeholder text shown when no value is selected */
  placeholder?: string;
  /** Visual size variant */
  size?: SelectSize;
  /** Show error styling */
  error?: boolean;
  /** Full width of parent container */
  fullWidth?: boolean;
}

const SIZE_STYLES: Record<SelectSize, React.CSSProperties> = {
  sm: { fontSize: 12, padding: '5px 8px' },
  md: { fontSize: 13, padding: '8px 12px' },
};

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      options,
      placeholder = '— Select —',
      size = 'md',
      error = false,
      fullWidth = false,
      value,
      style,
      ...props
    },
    ref
  ) => {
    const hasValue = value !== undefined && value !== '';

    return (
      <select
        ref={ref}
        value={value}
        style={{
          fontWeight: 500,
          borderRadius: 'var(--r-xs)',
          border: error
            ? '1.5px solid #b91c1c'
            : '1.5px solid rgba(0,0,0,0.1)',
          background: error ? '#fff5f5' : '#fff',
          color: hasValue ? 'var(--text)' : 'var(--text3)',
          cursor: 'pointer',
          outline: 'none',
          ...(fullWidth ? { width: '100%' } : {}),
          ...SIZE_STYLES[size],
          ...style,
        }}
        {...props}
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }
);

Select.displayName = 'Select';
export default Select;
export type { SelectProps, SelectOption, SelectSize };

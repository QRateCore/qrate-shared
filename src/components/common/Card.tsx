'use client';

import type { ReactNode, HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  padding?: 'sm' | 'md' | 'lg' | 'none';
}

const paddingClasses = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
};

export default function Card({
  children,
  padding = 'md',
  className = '',
  ...props
}: CardProps) {
  return (
    <div
      className={[
        'bg-white rounded-[var(--r,16px)] shadow-[var(--shadow,0_2px_12px_rgba(0,0,0,.07))]',
        paddingClasses[padding],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {children}
    </div>
  );
}

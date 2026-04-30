'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MenuItemDisplay } from '../../types/restaurant';
import { CarouselPreviewPhone } from './CarouselPreviewPhone';
import { CompositionPreviewPhone } from './CompositionPreviewPhone';

export interface FoodItemPreviewModalProps {
  item: MenuItemDisplay;
  onClose: () => void;
}

export function FoodItemPreviewModal({ item, onClose }: FoodItemPreviewModalProps) {
  const [visible, setVisible] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Fade-in on mount
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === overlayRef.current) onClose();
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={overlayRef}
      onClick={handleBackdropClick}
      data-testid="food-item-preview-modal"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.92)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: visible ? 1 : 0,
        transition: 'opacity 200ms ease-out',
        overflowY: 'auto',
        padding: '40px 24px',
      }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        data-testid="preview-modal-close-btn"
        aria-label="Close preview"
        style={{
          position: 'fixed',
          top: 20,
          right: 20,
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: '1px solid rgba(255,255,255,0.15)',
          background: 'rgba(255,255,255,0.08)',
          color: 'rgba(255,255,255,0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: 1,
          zIndex: 10000,
        }}
      >
        ✕
      </button>

      {/* Title */}
      <p
        style={{
          fontSize: 11,
          color: 'rgba(255,255,255,0.4)',
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          marginBottom: 32,
          marginTop: 0,
          textAlign: 'center',
        }}
      >
        Patron Preview
      </p>

      {/* Phone frames */}
      <div
        style={{
          display: 'flex',
          gap: 48,
          alignItems: 'flex-start',
          justifyContent: 'center',
          flexWrap: 'wrap',
        }}
      >
        <CarouselPreviewPhone item={item} />
        <CompositionPreviewPhone item={item} />
      </div>
    </div>,
    document.body
  );
}

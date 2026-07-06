'use client';

/**
 * Bottom-sheet drawer that wraps the ItemPool on mobile viewports.
 *
 * Slides up from the bottom (~70vh tall), preserves the existing dark
 * backdrop pattern, dismisses via the × button, ESC key, or backdrop tap.
 * Body scroll is locked while open. Focus is captured on open and
 * restored on close so keyboard / screen-reader users can navigate
 * naturally.
 *
 * The component is a thin wrapper — children are rendered as-is, so the
 * existing ItemPool component (with its drag handlers, attention rules,
 * search, filter, etc.) keeps working untouched. STR-251 mobile + camera
 * (2026-04-08).
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ItemPoolDrawerProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
}

export default function ItemPoolDrawer({
  open,
  onClose,
  children,
  title = 'Items',
}: ItemPoolDrawerProps) {
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // ESC key + body scroll lock + focus management.
  useEffect(() => {
    if (!open) return;

    // Capture the previously-focused element so we can restore it on close.
    previouslyFocusedRef.current = (document.activeElement as HTMLElement | null) ?? null;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);

    // Body scroll lock.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the close button after the open animation has had a chance to start.
    // RAF avoids fighting React's commit phase.
    const focusFrame = requestAnimationFrame(() => {
      closeBtnRef.current?.focus();
    });

    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
      cancelAnimationFrame(focusFrame);
      // Restore focus to the previously-focused element if it's still in the DOM.
      const prev = previouslyFocusedRef.current;
      if (prev && document.contains(prev)) {
        prev.focus();
      }
    };
  }, [open, onClose]);

  // Render nothing when closed so the rest of the page is fully interactive.
  if (!open) return null;

  return (
    <>
      {/* Backdrop — taps anywhere outside the drawer dismiss it */}
      <div
        onClick={onClose}
        data-testid="item-pool-drawer-backdrop"
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.4)',
          zIndex: 49,
        }}
      />

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="item-pool-drawer"
        data-state="open"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: '70vh',
          maxHeight: '90vh',
          background: 'var(--white)',
          borderRadius: '16px 16px 0 0',
          boxShadow: '0 -8px 24px rgba(0,0,0,0.18)',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          // Slide-up animation: applied via transform on mount.
          // The opening transition is owed to React's mount; close is
          // instant via unmount.
          animation: 'qrate-drawer-slide-up 0.22s ease-out',
        }}
      >
        {/* Drag handle (visual affordance only) */}
        <div
          aria-hidden="true"
          style={{
            width: 36,
            height: 4,
            margin: '8px auto 4px',
            borderRadius: 2,
            background: '#cfcfcf',
            flexShrink: 0,
          }}
        />

        {/* Header bar */}
        <div
          style={{
            padding: '6px 14px 10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{title}</span>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close items drawer"
            data-testid="item-pool-drawer-close"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text2)',
              minWidth: 44,
              minHeight: 44,
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Body — children are rendered as-is */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>{children}</div>
      </div>

      {/* Slide-up keyframes — scoped via a style tag to avoid touching globals.css */}
      <style>{`
        @keyframes qrate-drawer-slide-up {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
      `}</style>
    </>
  );
}

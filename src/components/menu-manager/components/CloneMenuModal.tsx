'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { MenuSummary } from '../../../types/restaurant';
import Button from '../../common/Button';

export interface CloneMenuModalProps {
  /** All menus available as clone sources for the current restaurant. */
  sourceMenus: MenuSummary[];
  /** Called when the user confirms. The caller is responsible for closing on success. */
  onConfirm: (sourceMenuId: string, name: string) => Promise<void>;
  /** Called when the user dismisses (X button, backdrop click, Escape). */
  onClose: () => void;
}

export function CloneMenuModal({ sourceMenus, onConfirm, onClose }: CloneMenuModalProps) {
  const [name, setName] = useState('');
  const [sourceMenuId, setSourceMenuId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, submitting]);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && sourceMenuId !== null && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || sourceMenuId === null) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(sourceMenuId, trimmedName);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to clone menu');
      setSubmitting(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-[1000]"
        data-testid="clone-menu-modal-backdrop"
        onClick={() => { if (!submitting) onClose(); }}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="clone-menu-modal-title"
        data-testid="clone-menu-modal"
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[1001] w-[min(440px,calc(100vw-32px))] max-h-[calc(100vh-32px)] flex flex-col bg-[var(--white)] rounded-[var(--r)] border border-[var(--border)] shadow-2xl"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
          <h2 id="clone-menu-modal-title" className="text-base font-semibold text-[var(--text)]">
            Clone Existing Menu
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            data-testid="clone-menu-modal-close"
            aria-label="Close"
            className="bg-transparent border-none cursor-pointer text-[var(--text2)] flex items-center p-1 rounded hover:bg-[var(--bg)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-3 overflow-y-auto flex-1">
          <p className="text-xs text-[var(--text2)] mb-3">
            Copies categories, items, and per-category settings (boost level, chef&apos;s special, portion type, price overrides).
            The new menu starts <strong>inactive</strong> until you toggle it live.
          </p>

          <label htmlFor="clone-menu-name" className="block text-xs font-semibold text-[var(--text)] mb-1">
            New menu name
          </label>
          <input
            ref={nameInputRef}
            id="clone-menu-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Brunch Menu (Weekend)"
            data-testid="clone-menu-name-input"
            disabled={submitting}
            className="w-full text-sm border border-[var(--border)] rounded-[var(--r-xs)] py-2 px-3 outline-none focus:border-[var(--blue)] mb-4"
          />

          <div className="text-xs font-semibold text-[var(--text)] mb-2">Source menu</div>
          {sourceMenus.length === 0 ? (
            <p className="text-xs text-[var(--text2)] italic" data-testid="clone-menu-no-sources">
              No existing menus to clone from.
            </p>
          ) : (
            <div role="radiogroup" aria-label="Source menu" className="flex flex-col gap-1">
              {sourceMenus.map((m) => (
                <label
                  key={m.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-[var(--r-xs)] hover:bg-[var(--bg)] cursor-pointer text-sm"
                >
                  <input
                    type="radio"
                    name="clone-source-menu"
                    value={m.id}
                    checked={sourceMenuId === m.id}
                    onChange={() => setSourceMenuId(m.id)}
                    data-testid={`clone-menu-source-${m.id}`}
                    disabled={submitting}
                    style={{ accentColor: 'var(--blue)' }}
                  />
                  <span className="text-[var(--text)]">{m.name}</span>
                  {!m.active && (
                    <span className="text-[10px] text-[var(--text3)] italic">(inactive)</span>
                  )}
                </label>
              ))}
            </div>
          )}

          {error && (
            <p
              data-testid="clone-menu-error"
              role="alert"
              className="text-xs text-[var(--red,#b91c1c)] mt-3"
            >
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--border)] shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={submitting}
            data-testid="clone-menu-cancel-btn"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid="clone-menu-submit-btn"
          >
            {submitting ? 'Cloning…' : 'Clone Menu'}
          </Button>
        </div>
      </div>
    </>
  );
}

export default CloneMenuModal;

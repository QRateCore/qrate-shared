'use client';
import { useMenuManagerService } from '../context';
import { useTrackAction } from '../track-action-context';

import { useState } from 'react';
import { X, Trash2, AlertCircle } from 'lucide-react';
import type { MenuSummary, MenuSchedule } from '../../../types/restaurant';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MenuEditPanelProps {
  menu: MenuSummary;
  restaurantId: string;
  onClose: () => void;
  onUpdate: (updated: MenuSummary) => void;
  onDelete: (menuId: string) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultSchedule(): MenuSchedule {
  // Mon–Fri 11:00–22:00 as sensible default
  return Object.fromEntries(
    [1, 2, 3, 4, 5].map((d) => [String(d), { start: '11:00', end: '22:00' }]),
  );
}

function scheduleToDaySet(schedule: MenuSchedule | null): Set<number> {
  if (!schedule) return new Set([0, 1, 2, 3, 4, 5, 6]);
  return new Set(Object.keys(schedule).map(Number));
}

// ── MenuEditPanel ─────────────────────────────────────────────────────────────

export default function MenuEditPanel({
  menu,
  restaurantId,
  onClose,
  onUpdate,
  onDelete,
}: MenuEditPanelProps) {
  const service = useMenuManagerService();
  const trackAction = useTrackAction();
  const [name, setName]           = useState(menu.name);
  const [isActive, setIsActive]   = useState(menu.active);
  const [isAllDay, setIsAllDay]   = useState(menu.is_all_day);

  // Schedule: per-day {start, end} pairs
  const [schedule, setSchedule]   = useState<MenuSchedule>(
    menu.schedule ?? defaultSchedule(),
  );
  // Which days are enabled
  const [enabledDays, setEnabledDays] = useState<Set<number>>(
    menu.is_all_day ? new Set([0, 1, 2, 3, 4, 5, 6]) : scheduleToDaySet(menu.schedule),
  );

  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [nameError, setNameError] = useState(false);
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [deleting, setDeleting]   = useState(false);

  // ── Helpers ────────────────────────────────────────────────────────────

  function toggleDay(day: number) {
    setEnabledDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) {
        next.delete(day);
      } else {
        next.add(day);
        // Ensure a default time entry exists for this day
        if (!schedule[day]) {
          setSchedule((s) => ({ ...s, [day]: { start: '11:00', end: '22:00' } }));
        }
      }
      return next;
    });
  }

  function setTime(day: number, field: 'start' | 'end', value: string) {
    setSchedule((prev) => ({
      ...prev,
      [day]: { ...(prev[day] ?? { start: '11:00', end: '22:00' }), [field]: value },
    }));
  }

  // Build the final schedule object: only days that are enabled
  function buildSchedule(): MenuSchedule | null {
    if (isAllDay) return null;
    const result: MenuSchedule = {};
    for (const day of enabledDays) {
      const entry = schedule[day] ?? { start: '11:00', end: '22:00' };
      result[String(day)] = entry;
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  // ── Save ──────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!name.trim()) { setNameError(true); return; }
    const start = Date.now();
    setNameError(false);
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await service.updateMenu(restaurantId, menu.id, {
        name: name.trim(),
        active: isActive,
        is_all_day: isAllDay,
        schedule: buildSchedule(),
        days_of_week: isAllDay ? [0, 1, 2, 3, 4, 5, 6] : [...enabledDays].sort(),
      });
      trackAction('menu.menuEdit.save', {
        restaurantId,
        metadata: {
          menuId: menu.id,
          isAllDay,
          scheduleDayCount: isAllDay ? 7 : enabledDays.size,
          activeToggled: isActive !== (menu.active ?? true),
        },
        success: true,
        durationMs: Date.now() - start,
      });
      onUpdate(updated);
    } catch (err) {
      trackAction('menu.menuEdit.save', {
        restaurantId,
        metadata: { menuId: menu.id },
        success: false,
        durationMs: Date.now() - start,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      setSaveError(err instanceof Error ? err.message : 'Failed to save — please try again');
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────

  async function handleDelete() {
    if (deleteStep === 0) { setDeleteStep(1); return; }
    if (deleteStep === 1) { setDeleteStep(2); return; }
    const start = Date.now();
    setDeleting(true);
    try {
      await service.deleteMenu(restaurantId, menu.id);
      trackAction('menu.menuEdit.delete', {
        restaurantId,
        metadata: { menuId: menu.id },
        success: true,
        durationMs: Date.now() - start,
      });
      onDelete(menu.id);
    } catch (err) {
      trackAction('menu.menuEdit.delete', {
        restaurantId,
        metadata: { menuId: menu.id },
        success: false,
        durationMs: Date.now() - start,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      setDeleteStep(0);
      setSaveError('Failed to delete menu — please try again');
    } finally {
      setDeleting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.15)' }}
        data-testid="menu-edit-backdrop"
      />
      <div
        data-testid="menu-edit-panel"
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 360, zIndex: 50,
          background: 'var(--white)',
          borderLeft: '1px solid var(--border)',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Edit menu</div>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 1 }}>{menu.name}</div>
          </div>
          <button
            type="button" onClick={onClose} data-testid="menu-edit-close"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text2)', padding: 4, borderRadius: 4, display: 'flex', alignItems: 'center' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* Name */}
          <div>
            <label style={labelStyle} htmlFor="menu-edit-name">Menu name <span style={{ color: '#b91c1c' }}>*</span></label>
            <input
              id="menu-edit-name"
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setNameError(false); }}
              data-testid="menu-edit-name-input"
              style={{ ...inputStyle, border: nameError ? '1px solid #b91c1c' : '1px solid var(--border)' }}
            />
            {nameError && <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 3 }}>Name is required</div>}
          </div>

          {/* Active */}
          <div>
            <div style={labelStyle}>Status</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[true, false].map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => {
                    trackAction('menu.menuEdit.toggleActive', {
                      restaurantId,
                      metadata: { menuId: menu.id, next: v },
                    });
                    setIsActive(v);
                  }}
                  data-testid={`menu-active-${v}`}
                  style={{
                    flex: 1, padding: '7px 0', fontSize: 12, fontWeight: 600,
                    borderRadius: 4,
                    border: isActive === v
                      ? (v ? '2px solid #16a34a' : '2px solid #b91c1c')
                      : '1px solid var(--border)',
                    background: isActive === v
                      ? (v ? '#dcfce7' : '#fee2e2')
                      : 'white',
                    color: isActive === v
                      ? (v ? '#15803d' : '#b91c1c')
                      : 'var(--text2)',
                    cursor: 'pointer',
                  }}
                >
                  {v ? 'Active' : 'Inactive'}
                </button>
              ))}
            </div>
          </div>

          {/* Serving hours */}
          <div>
            <div style={labelStyle}>Serving hours</div>

            {/* All-day toggle */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={isAllDay}
                onChange={(e) => setIsAllDay(e.target.checked)}
                data-testid="menu-all-day"
                style={{ accentColor: 'var(--blue)', width: 14, height: 14 }}
              />
              <span style={{ fontSize: 12, color: 'var(--text)' }}>Available all day</span>
            </label>

            {/* Per-day schedule grid */}
            {!isAllDay && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {DAY_LABELS.map((dayLabel, idx) => {
                  const enabled = enabledDays.has(idx);
                  const entry = schedule[idx] ?? { start: '11:00', end: '22:00' };
                  return (
                    <div
                      key={idx}
                      style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                      data-testid={`schedule-day-${idx}`}
                    >
                      <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', width: 42 }}>
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={() => toggleDay(idx)}
                          data-testid={`schedule-day-check-${idx}`}
                          style={{ accentColor: 'var(--blue)', width: 13, height: 13 }}
                        />
                        <span style={{ fontSize: 11, fontWeight: 600, color: enabled ? 'var(--text)' : 'var(--text2)' }}>
                          {dayLabel}
                        </span>
                      </label>
                      {enabled ? (
                        <>
                          <input
                            type="time"
                            value={entry.start}
                            onChange={(e) => setTime(idx, 'start', e.target.value)}
                            data-testid={`schedule-start-${idx}`}
                            style={{ ...timeInputStyle }}
                          />
                          <span style={{ fontSize: 11, color: 'var(--text2)' }}>–</span>
                          <input
                            type="time"
                            value={entry.end}
                            onChange={(e) => setTime(idx, 'end', e.target.value)}
                            data-testid={`schedule-end-${idx}`}
                            style={{ ...timeInputStyle }}
                          />
                        </>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--text2)', fontStyle: 'italic' }}>Closed</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Danger zone */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#b91c1c', marginBottom: 8 }}>
              Danger zone
            </div>
            {deleteStep === 2 && (
              <div
                style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 4, padding: '8px 10px', marginBottom: 8, fontSize: 11, color: '#991b1b' }}
                data-testid="delete-menu-warning"
              >
                This permanently removes the menu and all its item assignments. Item data is preserved.
              </div>
            )}
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              data-testid="delete-menu-btn"
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                width: '100%', padding: '8px 12px', fontSize: 12, fontWeight: 600,
                color: deleteStep > 0 ? 'white' : '#b91c1c',
                background: deleteStep > 0 ? '#ef4444' : '#fee2e2',
                border: `1px solid ${deleteStep > 0 ? '#ef4444' : '#fca5a5'}`,
                borderRadius: 4, cursor: deleting ? 'not-allowed' : 'pointer',
                justifyContent: 'center',
              }}
            >
              <Trash2 size={13} />
              {deleting
                ? 'Deleting…'
                : deleteStep === 0 ? 'Delete this menu'
                : deleteStep === 1 ? 'Are you sure? Click to confirm'
                : 'Click once more to delete permanently'}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
          {saveError && (
            <div style={{ fontSize: 11, color: '#b91c1c', background: '#fee2e2', borderRadius: 4, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertCircle size={12} />
              {saveError}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button" onClick={onClose} disabled={saving}
              data-testid="menu-edit-cancel"
              style={{ flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 600, color: 'var(--text2)', background: '#f0f0f0', border: 'none', borderRadius: 'var(--r-xs)', cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              type="button" onClick={handleSave} disabled={saving}
              data-testid="menu-edit-save"
              style={{ flex: 2, padding: '8px 0', fontSize: 12, fontWeight: 700, color: 'white', background: 'var(--blue)', border: 'none', borderRadius: 'var(--r-xs)', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Style helpers ─────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: 16, color: 'var(--text)', background: 'white',
  border: '1px solid var(--border)', borderRadius: 'var(--r-xs)', padding: '7px 10px',
  outline: 'none', boxSizing: 'border-box',
};

const timeInputStyle: React.CSSProperties = {
  fontSize: 16, color: 'var(--text)', background: 'white',
  border: '1px solid var(--border)', borderRadius: 4, padding: '3px 6px',
  outline: 'none',
};

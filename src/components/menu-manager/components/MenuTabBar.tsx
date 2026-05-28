'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Pencil, Plus, X } from 'lucide-react';
import type { MenuSummary } from '../../../types/restaurant';
import Button from '../../common/Button';

/**
 * MenuTabBar — strip of menu tabs spanning the two-panel Menu Manager.
 *
 * Two-line tab layout matched to the design files
 * (canvas/ca-dishes-menus.jsx + prototype/pt-pages-rest.jsx):
 *   - Line 1: menu name + status pill + (edit pencil when active)
 *   - Line 2: schedule sublabel like "11am – 10pm · Wed"
 *
 * Visual treatment mirrors the food-library item-type tabs: clean 2px
 * brand-orange underline on active, brand-coloured label when active,
 * no background tint. No count badge — the active-menu header below
 * already shows item counts.
 */

// ─── Status pill ────────────────────────────────────────────────────────────

export type MenuTabStatus = 'active' | 'scheduled' | 'archived';

const TAB_PILL_STYLES: Record<
  MenuTabStatus,
  { label: string; bg: string; fg: string; dot: string }
> = {
  active: {
    label: 'ACTIVE',
    bg: 'var(--green-bg, #e6f9f0)',
    fg: '#15803d',
    dot: 'var(--green, #10b981)',
  },
  scheduled: {
    label: 'SCHEDULED',
    bg: 'var(--blue-bg, #E6F4FF)',
    fg: 'var(--blue, #1A56DB)',
    dot: 'var(--blue, #1A56DB)',
  },
  archived: {
    label: 'INACTIVE',
    bg: 'var(--color-neutral-gray-100, #f3f4f6)',
    fg: 'var(--text2, #6b7280)',
    dot: 'var(--text3, #9ca3af)',
  },
};

function MenuTabStatusPill({ status }: { status: MenuTabStatus }) {
  const s = TAB_PILL_STYLES[status];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: s.bg,
        color: s.fg,
        padding: '2px 7px',
        borderRadius: 999,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
      data-testid={`menu-tab-status-${status}`}
    >
      <span
        aria-hidden
        style={{
          width: 5,
          height: 5,
          borderRadius: 99,
          background: s.dot,
          flexShrink: 0,
        }}
      />
      {s.label}
    </span>
  );
}

// ─── Schedule formatting helpers ────────────────────────────────────────────

const TAB_DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function formatTabHour(time: string | null | undefined): string {
  if (!time || typeof time !== 'string') return '';
  const parts = time.split(':');
  const hh = Number(parts[0]);
  const mm = Number(parts[1] ?? '0');
  if (Number.isNaN(hh) || Number.isNaN(mm)) return '';
  const period = hh >= 12 && hh < 24 ? 'pm' : 'am';
  let h12 = hh % 12;
  if (h12 === 0) h12 = 12;
  if (mm === 0) return `${h12}${period}`;
  return `${h12}:${String(mm).padStart(2, '0')}${period}`;
}

function formatTabDays(days: number[]): string {
  if (!days || days.length === 0) return 'No days';
  if (days.length === 7) return 'Daily';
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 5 && sorted.every((d, i) => d === i + 1)) return 'Weekdays';
  if (sorted.length === 2 && sorted[0] === 0 && sorted[1] === 6) return 'Weekends';
  return sorted.map((d) => TAB_DAY_LABELS[d] ?? '').join(' · ');
}

/**
 * Render the schedule sublabel. Prefers per-day schedule entries when the
 * row-level start/end are inconsistent or null — fixes the case where a
 * menu configured for "Wed 11am–10pm" had its row-level times stored as
 * null because only one day was wired.
 */
export function formatMenuTabSubLabel(menu: MenuSummary): string {
  // Normalise days_of_week — backend has occasionally serialised as strings.
  const days = (menu.days_of_week ?? []).map((d) => Number(d));
  const dayLabel = formatTabDays(days);
  if (menu.is_all_day) return `All day · ${dayLabel}`;

  // Try row-level first when it's well-formed.
  let start: string | null = null;
  let end: string | null = null;
  if (menu.start_time && menu.end_time) {
    start = menu.start_time;
    end = menu.end_time;
  } else if (menu.schedule && days.length > 0) {
    // Fall back to the first configured day's window. When all days share
    // the same window the displayed range applies to the whole set; when
    // they differ this surfaces at least one concrete value rather than
    // an empty sublabel.
    const first = menu.schedule[String(days[0])];
    if (first) {
      start = first.start;
      end = first.end;
    }
  }

  if (!start || !end) return dayLabel;
  const startLabel = formatTabHour(start);
  const endLabel = formatTabHour(end);
  if (!startLabel || !endLabel) return dayLabel;
  // Drop the redundant period when both endpoints share it ("3pm" → "3").
  const samePeriod =
    (startLabel.endsWith('am') && endLabel.endsWith('am')) ||
    (startLabel.endsWith('pm') && endLabel.endsWith('pm'));
  const compactStart = samePeriod ? startLabel.replace(/(am|pm)$/, '') : startLabel;
  return `${compactStart}–${endLabel} · ${dayLabel}`;
}

function timeToMinutes(value: string | null | undefined): number | null {
  if (!value || typeof value !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  if (h < 0 || h > 24 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Derive the status pill state. Uses the per-day schedule entry when
 * present (source of truth for menus with only some days configured),
 * falling back to row-level start_time/end_time.
 */
export function getMenuTabStatus(menu: MenuSummary, now: Date): MenuTabStatus {
  if (!menu.active) return 'archived';
  const dow = now.getDay();
  const serviceDays = (menu.days_of_week ?? []).map((d) => Number(d));
  if (!serviceDays.includes(dow)) return 'scheduled';
  if (menu.is_all_day) return 'active';

  const perDay = menu.schedule?.[String(dow)];
  let startMin: number | null;
  let endMin: number | null;
  if (perDay) {
    startMin = timeToMinutes(perDay.start);
    endMin = timeToMinutes(perDay.end);
  } else {
    startMin = timeToMinutes(menu.start_time);
    endMin = timeToMinutes(menu.end_time);
  }
  if (startMin === null || endMin === null || endMin <= startMin) {
    return 'scheduled';
  }

  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (nowMin >= startMin && nowMin < endMin) return 'active';
  return 'scheduled';
}

// ─── Component ──────────────────────────────────────────────────────────────

export interface MenuTabBarProps {
  menus: MenuSummary[];
  activeMenuId: string | null;
  onTabChange: (menuId: string) => void;
  onEditMenu: (menuId: string) => void;
  onCreateMenu: (name: string) => Promise<void>;
  onCloneMenu?: () => void;
}

export default function MenuTabBar({
  menus,
  activeMenuId,
  onTabChange,
  onEditMenu,
  onCreateMenu,
  onCloneMenu,
}: MenuTabBarProps) {
  const [addingMenu, setAddingMenu] = useState(false);
  const [newMenuName, setNewMenuName] = useState('');
  const [creating, setCreating] = useState(false);
  const newMenuInputRef = useRef<HTMLInputElement>(null);

  // Clock used by the status pills so ACTIVE↔SCHEDULED flips as time
  // crosses a menu's start/end boundary. Same 60-second cadence as
  // WeeklyScheduleCard — sufficient for human-perceived correctness.
  const [tabNow, setTabNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTabNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="flex items-stretch border-b border-[var(--border)] shrink-0"
      // Match the food-library tab strip: no white background — sit on the
      // grey page surface so the active-tab brand-orange underline reads
      // crisply against the same canvas as the rest of the chrome.
      style={{ background: 'var(--bg, #f9fafb)' }}
    >
      <div
        className="flex items-stretch overflow-x-auto flex-1 min-w-0"
        style={{ gap: 4, paddingLeft: 8 }}
        data-testid="menu-tab-bar"
      >
        {menus.map((menu) => {
          const isActive = menu.id === activeMenuId;
          const status = getMenuTabStatus(menu, tabNow);
          const sub = formatMenuTabSubLabel(menu);
          return (
            <button
              key={menu.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-testid={`menu-tab-${menu.id}`}
              onClick={() => onTabChange(menu.id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 2,
                padding: '8px 12px 10px',
                marginBottom: -1,
                background: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${isActive ? 'var(--brand-s)' : 'transparent'}`,
                cursor: 'pointer',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                transition: 'color .15s, border-color .15s',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: isActive ? 700 : 600,
                    color: isActive ? 'var(--brand-s)' : 'var(--text2)',
                    letterSpacing: '-0.005em',
                  }}
                >
                  {menu.name}
                </span>
                <MenuTabStatusPill status={status} />
                {isActive && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); onEditMenu(menu.id); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onEditMenu(menu.id); } }}
                    data-testid={`edit-menu-tab-${menu.id}`}
                    aria-label={`Edit ${menu.name}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: 2,
                      borderRadius: 'var(--r-xs, 4px)',
                      color: 'var(--brand-s)',
                      cursor: 'pointer',
                      opacity: 0.7,
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLSpanElement).style.opacity = '1'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLSpanElement).style.opacity = '0.7'; }}
                  >
                    <Pencil size={11} />
                  </span>
                )}
              </span>
              <span
                data-testid={`menu-tab-${menu.id}-sub`}
                style={{
                  fontSize: 10,
                  color: 'var(--text3, #9ca3af)',
                  letterSpacing: '0.02em',
                  lineHeight: 1.2,
                }}
              >
                {sub}
              </span>
            </button>
          );
        })}

        {/* Inline new-menu form — shown in place of the "+ New menu" tab
            while the owner is typing a name. */}
        {addingMenu && (
          <div
            className="flex items-center gap-1 px-2 py-1.5 shrink-0"
            style={{ alignSelf: 'center' }}
          >
            <input
              ref={newMenuInputRef}
              type="text"
              value={newMenuName}
              onChange={(e) => setNewMenuName(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter') {
                  if (!newMenuName.trim()) return;
                  setCreating(true);
                  await onCreateMenu(newMenuName.trim());
                  setNewMenuName('');
                  setAddingMenu(false);
                  setCreating(false);
                }
                if (e.key === 'Escape') { setAddingMenu(false); setNewMenuName(''); }
              }}
              placeholder="Menu name…"
              autoFocus
              data-testid="new-menu-name-input"
              className="text-xs border border-[var(--blue)] rounded-[var(--r-xs)] py-0.5 px-2 outline-none w-[130px]"
            />
            <button
              type="button"
              disabled={creating || !newMenuName.trim()}
              onClick={async () => {
                if (!newMenuName.trim()) return;
                setCreating(true);
                await onCreateMenu(newMenuName.trim());
                setNewMenuName('');
                setAddingMenu(false);
                setCreating(false);
              }}
              data-testid="confirm-new-menu-btn"
              className="bg-transparent border-none cursor-pointer text-[var(--blue)] flex items-center p-0.5"
            >
              <Check size={14} />
            </button>
            <button
              type="button"
              onClick={() => { setAddingMenu(false); setNewMenuName(''); }}
              data-testid="cancel-new-menu-btn"
              className="bg-transparent border-none cursor-pointer text-[var(--text2)] flex items-center p-0.5"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Inline "+ New menu" tab affordance — brand-coloured, sits at the
            end of the strip and shares the same vertical rhythm as the
            two-line tabs above. */}
        {!addingMenu && (
          <button
            type="button"
            onClick={() => {
              setAddingMenu(true);
              setTimeout(() => newMenuInputRef.current?.focus(), 0);
            }}
            data-testid="add-menu-btn"
            aria-label="Add menu"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 12px 10px',
              marginBottom: -1,
              background: 'transparent',
              border: 'none',
              borderBottom: '2px solid transparent',
              color: 'var(--brand-s)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            <Plus size={14} aria-hidden />
            New menu
          </button>
        )}
      </div>

      {/* Clone Existing — small secondary affordance, frozen to the right
          edge so it stays visible even when the menu list overflows. */}
      {!addingMenu && onCloneMenu && (
        <div className="shrink-0 px-2 py-1.5 flex items-center">
          <Button
            variant="secondary"
            size="sm"
            icon={<Copy size={13} />}
            onClick={onCloneMenu}
            disabled={menus.length === 0}
            data-testid="clone-menu-btn"
            aria-label="Clone existing menu"
          >
            Clone
          </Button>
        </div>
      )}
    </div>
  );
}

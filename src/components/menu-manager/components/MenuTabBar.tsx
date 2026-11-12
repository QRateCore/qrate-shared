'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Copy, MoreHorizontal, Pencil } from 'lucide-react';
import type { MenuSummary } from '../../../types/restaurant';
import Button from '../../common/Button';
import { isMinuteInWindow } from '../../../utils/menuWindow';

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
 *
 * Window math mirrors core `_is_in_window` via `isMinuteInWindow`
 * (utils/menuWindow.ts): an overnight window (end < start) is live from
 * start to midnight AND from midnight to end on the SAME day's entry, so a
 * Sat 17:00–02:00 menu reads ACTIVE at 01:00 Sunday only when Sunday's own
 * entry covers it. The owner app's `lib/menu/scheduleGap.ts` draws its bands
 * from the same helper — keep the two in step.
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
  if (startMin === null || endMin === null) {
    return 'scheduled';
  }

  const nowMin = now.getHours() * 60 + now.getMinutes();
  return isMinuteInWindow(nowMin, startMin, endMin) ? 'active' : 'scheduled';
}

// ─── Component ──────────────────────────────────────────────────────────────

export interface MenuTabBarProps {
  menus: MenuSummary[];
  activeMenuId: string | null;
  onTabChange: (menuId: string) => void;
  onEditMenu: (menuId: string) => void;
  /** @deprecated Unused since the Add Menu wizard (PDD 2026-08-02) replaced
   * the inline "+ New menu" tab. Kept in the signature so pinned consumers
   * keep compiling; safe to drop on the next breaking release. */
  onCreateMenu?: (name: string) => Promise<void>;
  onCloneMenu?: () => void;
  /**
   * Compact = the owner Menu workspace's menu switch (2026-11-11): underline
   * tabs — a status dot (green = active), the menu's name and its item count;
   * the selected one is ink with an ink underline. No status pill, no schedule
   * sub-line, no pencil, no Clone — the page
   * header beside it shows the menu's Active/Inactive pill and schedule, and
   * "Menu settings" / "Clone menu" live in the page's ⋯ actions menu (the
   * host wires them through MenuManagerClient.onMenuActionsReady).
   *
   * Keeps `menu-tab-bar`, `menu-tab-<id>`, `role="tab"` and `aria-selected`,
   * which the E2E specs and the owner-menu-bulk-actions canary drive.
   *
   * Opt-in and defaulted off: waiter and admin vendor this same package and
   * keep the two-line tab layout (status pill + schedule sub-line + pencil +
   * Clone) byte-for-byte.
   */
  compact?: boolean;
  /**
   * Compact + WRAP (owner Menu workspace v5, Avi 2026-11-12): every menu tab is
   * shown and the strip wraps onto more lines instead of hiding tabs behind a
   * "⋯ N" button — no horizontal scrolling, every menu visible.
   */
  wrapTabs?: boolean;
}

/**
 * Which compact tabs fit (owner Menu workspace, Avi 2026-11-12): tabs keep
 * their order and fill the row; the rest go behind a "⋯" button. The
 * selected menu is always on show — if it would be hidden it takes the last
 * visible slot (dropping trailing tabs until it fits). Pure, for tests.
 */
export function fitMenuTabs(
  widths: readonly number[],
  available: number,
  moreWidth: number,
  activeIdx: number,
): { visible: number[]; hidden: number[] } {
  const n = widths.length;
  const all = Array.from({ length: n }, (_, i) => i);
  const total = widths.reduce((a, b) => a + b, 0);
  if (n === 0 || total <= available) return { visible: all, hidden: [] };
  const room = available - moreWidth;
  let used = 0;
  let k = 0;
  while (k < n && used + widths[k]! <= room) { used += widths[k]!; k++; }
  let visible = all.slice(0, Math.max(k, 1));
  if (activeIdx >= 0 && !visible.includes(activeIdx)) {
    let w = visible.reduce((a, i) => a + widths[i]!, 0) + widths[activeIdx]!;
    while (visible.length > 0 && w > room) { w -= widths[visible[visible.length - 1]!]!; visible = visible.slice(0, -1); }
    visible = [...visible, activeIdx];
  }
  const shown = new Set(visible);
  return { visible, hidden: all.filter((i) => !shown.has(i)) };
}

const COMPACT_TAB_CLS = 'relative inline-flex h-9 shrink-0 items-center gap-1.5 border-0 bg-transparent px-3 text-[13.5px] leading-none whitespace-nowrap';

function CompactTabInner({ menu, dotPx }: { menu: MenuSummary; dotPx?: number }) {
  return (
    <>
      <span
        aria-hidden="true"
        className={`${dotPx ? '' : 'h-1.5 w-1.5 '}shrink-0 rounded-full ${menu.active ? 'bg-ok' : 'bg-line-input'}`}
        style={dotPx ? { width: dotPx, height: dotPx } : undefined}
      />
      {/* Truncated so one very long name can never spill past the tab row. */}
      <span className="min-w-0 max-w-[320px] truncate">{menu.name}</span>
      {/* The dot is the menu's only status cue on the owner Menu page. */}
      <span className="sr-only">{menu.active ? ' (Active)' : ' (Inactive)'}</span>
      {typeof menu.item_count === 'number' && (
        <span className="text-[12px] font-normal text-ink-faint tabular-nums">
          {menu.item_count}
        </span>
      )}
    </>
  );
}

/** v5: every menu tab, wrapping onto extra lines (no overflow button). */
function WrappingMenuTabBar({ menus, activeMenuId, onTabChange }: Pick<MenuTabBarProps, 'menus' | 'activeMenuId' | 'onTabChange'>) {
  return (
    <div
      className="flex min-w-0 flex-1 flex-wrap items-end gap-1"
      role="tablist"
      aria-label="Menus"
      data-testid="menu-tab-bar"
      data-compact="true"
      data-wrap="true"
    >
      {menus.map((menu) => {
        const isActive = menu.id === activeMenuId;
        return (
          <button
            key={menu.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-testid={`menu-tab-${menu.id}`}
            data-menu-status={menu.active ? 'active' : 'inactive'}
            onClick={() => onTabChange(menu.id)}
            title={`${menu.name} · ${menu.active ? 'Active' : 'Inactive'}`}
            // v5 underline tab: 40px, 14px / 500, 7px dot, count; the active tab
            // gets a full-width 2px ink bottom border, idle tabs are muted.
            className={`relative inline-flex h-10 max-w-full shrink-0 cursor-pointer items-center gap-2 border-0 border-b-2 border-solid bg-transparent px-3 text-[14px] font-medium leading-none whitespace-nowrap transition-colors ${
              isActive
                ? 'border-[var(--mw-ink,var(--ink))] text-[var(--mw-ink,var(--ink))]'
                : 'border-transparent text-[var(--mw-muted,var(--ink-soft))] hover:text-[var(--mw-ink,var(--ink))]'
            }`}
          >
            <CompactTabInner menu={menu} dotPx={7} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * The compact strip. Kept as its own component so the non-compact tab layout
 * below stays untouched for the other consumers of this package. Tabs that
 * do not fit go behind a "⋯" button right after the last visible tab, which
 * lists them (`menu-tab-overflow-btn` / `menu-tab-overflow-item-<id>`).
 */
function CompactMenuTabBar({ menus, activeMenuId, onTabChange }: Pick<MenuTabBarProps, 'menus' | 'activeMenuId' | 'onTabChange'>) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const moreMeasureRef = useRef<HTMLSpanElement | null>(null);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState<{ visible: number[]; hidden: number[] } | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreBtnRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // Opening the list moves focus to its first menu (menu-button pattern).
  useEffect(() => {
    if (moreOpen) listRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [moreOpen]);
  const onListKey = (e: React.KeyboardEvent) => {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => { e.preventDefault(); items[(i + items.length) % items.length]?.focus(); };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Tab') setMoreOpen(false);
  };
  const activeIdx = menus.findIndex((m) => m.id === activeMenuId);

  const recompute = useCallback(() => {
    const wrap = wrapRef.current;
    const meas = measureRef.current;
    if (!wrap || !meas) return;
    const widths = Array.from(meas.children).map((c) => (c as HTMLElement).offsetWidth);
    const moreW = moreMeasureRef.current?.offsetWidth ?? 48;
    const next = fitMenuTabs(widths, wrap.clientWidth, moreW, activeIdx);
    setFit((prev) => (prev && prev.visible.join() === next.visible.join() && prev.hidden.join() === next.hidden.join() ? prev : next));
  }, [activeIdx]);

  useLayoutEffect(() => { recompute(); }, [recompute, menus]);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => recompute());
    ro.observe(wrap);
    // Tab widths change when the web font finishes loading.
    if (measureRef.current) ro.observe(measureRef.current);
    return () => ro.disconnect();
  }, [recompute]);

  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent) => { if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMoreOpen(false); moreBtnRef.current?.focus(); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [moreOpen]);

  const visible = fit?.visible ?? menus.map((_, i) => i);
  const hidden = fit?.hidden ?? [];

  return (
    <div ref={wrapRef} className="relative flex min-w-0 flex-1 items-stretch" data-compact="true">
      {/* Measuring copy of every tab (+ the ⋯ button) — widths only. Inside a
          clipped, invisible box so its full width never widens the page.
          `menu-tabs-measure` (not `menu-tab-…`) keeps it out of the tab
          testid family; `menu-tabs-measure-item-<id>` lists EVERY menu. */}
      <div aria-hidden="true" className="pointer-events-none invisible absolute inset-0 overflow-hidden">
        <div ref={measureRef} className="absolute left-0 top-0 flex whitespace-nowrap" data-testid="menu-tabs-measure">
          {menus.map((menu) => (
            <span key={menu.id} className={`${COMPACT_TAB_CLS} font-semibold`} data-testid={`menu-tabs-measure-item-${menu.id}`}><CompactTabInner menu={menu} /></span>
          ))}
        </div>
        <span ref={moreMeasureRef} className="absolute left-0 top-0 inline-flex h-9 items-center gap-1 px-2.5 text-[12.5px] font-semibold">
          <MoreHorizontal size={16} />{hidden.length || 9}
        </span>
      </div>
      <div
        className="flex min-w-0 items-stretch overflow-hidden"
        role="tablist"
        aria-label="Menus"
        data-testid="menu-tab-bar"
      >
        {visible.map((i) => {
          const menu = menus[i]!;
          const isActive = menu.id === activeMenuId;
          return (
            <button
              key={menu.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-testid={`menu-tab-${menu.id}`}
              data-menu-status={menu.active ? 'active' : 'inactive'}
              onClick={() => onTabChange(menu.id)}
              title={`${menu.name} · ${menu.active ? 'Active' : 'Inactive'}`}
              className={`${COMPACT_TAB_CLS} cursor-pointer transition-colors ${
                isActive ? 'font-semibold text-ink' : 'font-medium text-ink-soft hover:text-ink'
              }`}
            >
              <CompactTabInner menu={menu} />
              {isActive && <span aria-hidden="true" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-ink" />}
            </button>
          );
        })}
      </div>
      {hidden.length > 0 && (
        <div ref={moreRef} className="relative flex flex-none items-center">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-label={`More menus (${hidden.length})`}
            title={`${hidden.length} more menu${hidden.length === 1 ? '' : 's'}`}
            ref={moreBtnRef}
            onClick={() => setMoreOpen((o) => !o)}
            onKeyDown={(e) => { if (e.key === 'ArrowDown' && !moreOpen) { e.preventDefault(); setMoreOpen(true); } }}
            data-testid="menu-tab-overflow-btn"
            className={`inline-flex h-8 items-center gap-1 rounded-ctl border border-line px-2.5 text-[12.5px] font-semibold cursor-pointer ${
              moreOpen ? 'bg-surface2 text-ink' : 'bg-surface text-ink-soft hover:text-ink hover:bg-surface2'
            }`}
          >
            <MoreHorizontal size={16} aria-hidden="true" />
            <span className="tabular-nums">{hidden.length}</span>
          </button>
          {moreOpen && (
            <div
              ref={listRef}
              role="menu"
              aria-label="More menus"
              onKeyDown={onListKey}
              data-testid="menu-tab-overflow-menu"
              className="absolute left-0 top-[calc(100%+6px)] z-50 min-w-[220px] max-h-[60vh] overflow-y-auto rounded-card border border-line bg-surface p-1.5 shadow-float"
            >
              {hidden.map((i) => {
                const menu = menus[i]!;
                return (
                  <button
                    key={menu.id}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    data-testid={`menu-tab-overflow-item-${menu.id}`}
                    data-menu-status={menu.active ? 'active' : 'inactive'}
                    onClick={() => { setMoreOpen(false); onTabChange(menu.id); moreBtnRef.current?.focus(); }}
                    title={`${menu.name} · ${menu.active ? 'Active' : 'Inactive'}`}
                    className="flex h-9 w-full items-center gap-1.5 rounded-ctl border-0 bg-transparent px-2.5 text-left text-[13.5px] font-medium text-ink whitespace-nowrap cursor-pointer hover:bg-surface2"
                  >
                    <CompactTabInner menu={menu} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MenuTabBar({
  menus,
  activeMenuId,
  onTabChange,
  onEditMenu,
  onCloneMenu,
  compact = false,
  wrapTabs = false,
}: MenuTabBarProps) {
  // Clock used by the status pills so ACTIVE↔SCHEDULED flips as time
  // crosses a menu's start/end boundary. Same 60-second cadence as
  // WeeklyScheduleCard — sufficient for human-perceived correctness.
  const [tabNow, setTabNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTabNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (compact && wrapTabs) {
    return <WrappingMenuTabBar menus={menus} activeMenuId={activeMenuId} onTabChange={onTabChange} />;
  }
  if (compact) {
    return <CompactMenuTabBar menus={menus} activeMenuId={activeMenuId} onTabChange={onTabChange} />;
  }

  return (
    <div
      className="flex items-stretch border-b border-[var(--border)] shrink-0"
      // Match the food-library tab strip: no white background — sit on the
      // grey page surface so the active-tab brand-orange underline reads
      // crisply against the same canvas as the rest of the chrome.
      style={{ background: 'var(--bg, #f9fafb)' }}
    >
      <div
        className="flex items-stretch overflow-x-auto flex-1 min-w-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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

      </div>

      {/* Clone Existing — small secondary affordance, frozen to the right
          edge so it stays visible even when the menu list overflows. */}
      {onCloneMenu && (
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

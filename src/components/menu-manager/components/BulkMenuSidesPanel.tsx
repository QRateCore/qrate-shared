'use client';
/**
 * BulkMenuSidesPanel — Menu Builder bulk action drawer
 * (PDD 2026-05-22, parallel to BulkActionsPanel).
 *
 * Two-tab drawer for managing per-menu Includes / Choose-One sides
 * across N parent items selected on a single menu in one transaction.
 * Distinct from BulkActionsPanel: that one is Food-Library-scoped and
 * carries the full 11-mode union. This one is menu-scoped and only
 * does Includes + Remove Includes.
 *
 * Drawer chrome (backdrop, header, footer with Error+Progress+Apply)
 * is structurally copied from BulkActionsPanel — refactoring into a
 * shared <BulkDrawerShell> is deferred per amendment 11 until a third
 * bulk panel needs the chrome.
 *
 * Amendments baked in:
 *  - A1: Discovery fires ONCE per tab entry; both zones cached; zone
 *        radio toggling is a pure client-side filter.
 *  - A2: Candidate side rows are expandable to reveal "on N items: X, Y".
 *  - A4: aria-live="polite" wraps discovery-skeleton + candidate-empty
 *        + post-Apply skip-count. Testid bulk-menu-sides-discovery-status.
 *  - A5: Bulk-action button placement handled by the consumer (MenuBuilder).
 *  - A9: Zone-radio change clears removeSelectedIds (candidate pool changes).
 *  - A13: Side item allowlist enforced server-side (dish + included).
 */
import { useEffect, useMemo, useState } from 'react';
import { X, ChevronDown, ChevronRight } from 'lucide-react';
import type { MenuItemDisplay } from '../../../types/restaurant';
import { BulkMemberPicker } from './BulkMemberPicker';

export type SideType = 'and' | 'or';

export interface BulkMenuSidesParent {
  /** The selected menu_item id (NOT menu_item_menu_id — server resolves). */
  id: string;
  name: string;
}

export interface PerMenuSidesResult {
  sides_and: Array<{ id: string; name: string }>;
  sides_or: Array<{ id: string; name: string }>;
}

export interface BulkMenuSidesPanelProps {
  menuId: string;
  menuName?: string;
  selectedItems: BulkMenuSidesParent[];
  /** Full item pool — drives the Includes-tab picker. The component
   *  filters to allowed side item_types (`dish` + `included`) and
   *  excludes the selected parents to prevent self-reference. */
  pool: MenuItemDisplay[];
  /** Discovery fan-out: load each parent's current sides for THIS menu.
   *  Called ONCE on tab entry per amendment 1 — switching zones does NOT
   *  re-fire. Errors → loadErrors row in the UI with retry. */
  loadPerMenuSides: (itemId: string) => Promise<PerMenuSidesResult>;
  /** Throw-only contracts (PDD service layer mirrors this). */
  onBulkAddSides: (
    itemIds: string[],
    body: { side_type: SideType; side_ids: string[] },
  ) => Promise<{
    updated: Array<{
      menu_item_menu_id: string;
      food_item_id: string;
      food_item_name: string;
      sides_added: number;
      sides_skipped: number;
    }>;
  }>;
  onBulkRemoveSides: (
    itemIds: string[],
    body: { side_type: SideType; side_ids: string[] },
  ) => Promise<{
    updated: Array<{
      menu_item_menu_id: string;
      food_item_id: string;
      food_item_name: string;
      sides_removed: number;
      sides_skipped: number;
    }>;
  }>;
  onClose: () => void;
  /** Called after a successful Apply — consumer typically refetches
   *  the menu's items + closes the drawer. */
  onComplete?: () => void;
}

type TabKey = 'includes' | 'removeIncludes';

// Allowed side item_types (mirrors server-side ALLOWED_SIDE_ITEM_TYPES
// and the existing per-item PUT endpoint's _reject_addons).
const ALLOWED_SIDE_ITEM_TYPES = new Set(['dish', 'included']);

interface CandidateSide {
  id: string;
  name: string;
  present_on: BulkMenuSidesParent[];  // parents that currently have this side in the active zone
}

export default function BulkMenuSidesPanel({
  menuId,
  menuName,
  selectedItems,
  pool,
  loadPerMenuSides,
  onBulkAddSides,
  onBulkRemoveSides,
  onClose,
  onComplete,
}: BulkMenuSidesPanelProps) {
  // ── Tab + shared state ──────────────────────────────────────────────
  const [tab, setTab] = useState<TabKey>('includes');
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipNotice, setSkipNotice] = useState<string | null>(null);

  // ── Slide-in / slide-out animation state ─────────────────────────────
  // Component mounts off-screen (translateX(100%)) then transitions to 0
  // on the first frame after mount. On close-request, we set isOpen=false
  // so the transition reverses, then call the parent's onClose after the
  // animation duration so the panel actually unmounts cleanly.
  const SLIDE_MS = 250;
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setIsOpen(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  function requestClose() {
    setIsOpen(false);
    setTimeout(() => onClose(), SLIDE_MS);
  }
  // Same pattern but invokes onComplete (used after a successful Apply
  // so the success notice is visible during the slide-out instead of
  // disappearing instantly with an abrupt unmount).
  function requestComplete() {
    setIsOpen(false);
    setTimeout(() => onComplete?.(), SLIDE_MS);
  }

  // ── Includes tab state ──────────────────────────────────────────────
  const [addZone, setAddZone] = useState<SideType>('and');
  const [addSelectedIds, setAddSelectedIds] = useState<string[]>([]);
  const [addSearch, setAddSearch] = useState('');

  // ── Remove Includes tab state ───────────────────────────────────────
  // Amendment 1 — cache fires once and stores BOTH zones per parent;
  // zone radio toggle is a pure client-side filter over the cache.
  const [removeZone, setRemoveZone] = useState<SideType>('and');
  const [removeCache, setRemoveCache] = useState<Record<string, PerMenuSidesResult>>({});
  const [removeStatus, setRemoveStatus] = useState<'idle' | 'loading' | 'ready'>('idle');
  const [removeLoadErrors, setRemoveLoadErrors] = useState<BulkMenuSidesParent[]>([]);
  const [removeSelectedIds, setRemoveSelectedIds] = useState<Set<string>>(new Set());
  const [expandedSideIds, setExpandedSideIds] = useState<Set<string>>(new Set());

  const parentIdNameMap = useMemo(
    () => new Map(selectedItems.map((p) => [p.id, p])),
    [selectedItems],
  );

  // Hide Crisp chat widget while the drawer is open — the launcher's
  // fixed bottom-right position collides with the panel's Apply
  // button. Crisp uses max-int z-index so we can't out-rank it; the
  // pragmatic fix is to hide its chrome via injected CSS while the
  // drawer mount lasts. Targets every selector Crisp has shipped
  // historically so brittle to-the-vendor-changing-DOM is minimized.
  useEffect(() => {
    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-bulk-menu-sides-crisp-hide', 'true');
    styleEl.textContent = `
      .crisp-client,
      #crisp-chatbox,
      .cc-1brb6,
      .cc-1obhb,
      [data-bind-id="bind-launcher"],
      iframe[name^="crisp-chatbox"]
        { display: none !important; visibility: hidden !important; }
    `;
    document.head.appendChild(styleEl);
    return () => {
      try { document.head.removeChild(styleEl); } catch { /* already gone */ }
    };
  }, []);

  // Allowed side pool for the Includes-tab picker. Apply the item_type
  // allowlist + exclude selected parents (self-side forbidden).
  const sidePool = useMemo(
    () => pool.filter((i) => i.item_type && ALLOWED_SIDE_ITEM_TYPES.has(i.item_type)),
    [pool],
  );
  const selectedParentIds = useMemo(
    () => selectedItems.map((p) => p.id),
    [selectedItems],
  );

  // ── Discovery: fires once on Remove-tab entry; caches BOTH zones ────
  async function fireDiscovery() {
    setRemoveStatus('loading');
    setRemoveCache({});
    setRemoveLoadErrors([]);
    setError(null);
    const results = await Promise.allSettled(
      selectedItems.map((p) => loadPerMenuSides(p.id)),
    );
    const cache: Record<string, PerMenuSidesResult> = {};
    const errs: BulkMenuSidesParent[] = [];
    results.forEach((res, i) => {
      const parent = selectedItems[i];
      if (res.status === 'fulfilled') {
        cache[parent.id] = res.value;
      } else {
        errs.push(parent);
      }
    });
    setRemoveCache(cache);
    setRemoveLoadErrors(errs);
    setRemoveStatus('ready');
  }

  useEffect(() => {
    if (tab === 'removeIncludes' && removeStatus === 'idle') {
      void fireDiscovery();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Candidate sides for the active remove zone — derived purely from
  // the cache (amendment 1: no refetch on zone toggle).
  const candidates: CandidateSide[] = useMemo(() => {
    const candidateMap = new Map<string, CandidateSide>();
    for (const parent of selectedItems) {
      const sides = removeCache[parent.id];
      if (!sides) continue;
      const zoneSides = removeZone === 'and' ? sides.sides_and : sides.sides_or;
      for (const s of zoneSides) {
        const existing = candidateMap.get(s.id);
        if (existing) {
          existing.present_on.push(parent);
        } else {
          candidateMap.set(s.id, {
            id: s.id,
            name: s.name,
            present_on: [parent],
          });
        }
      }
    }
    // Sort by name for stable ordering across re-renders.
    return Array.from(candidateMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [removeCache, removeZone, selectedItems]);

  // ── Handlers ────────────────────────────────────────────────────────
  function toggleAddMember(id: string) {
    setAddSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      // Amendment 5 of bulk-add-members — 50-cap at Select (BulkMember-
      // Picker handles the disabled state via maxSelections prop).
      if (prev.length >= 50) return prev;
      return [...prev, id];
    });
  }

  function toggleRemoveSide(id: string) {
    setRemoveSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleExpandSide(id: string) {
    setExpandedSideIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function switchAddZone(next: SideType) {
    if (next === addZone) return;
    setAddZone(next);
    // Per the design — clearing the picker on zone switch avoids the
    // ambiguity of "did I mean to add these to 'and' or 'or'?". The
    // picker selection is zone-specific in user mental model.
    setAddSelectedIds([]);
  }

  function switchRemoveZone(next: SideType) {
    if (next === removeZone) return;
    setRemoveZone(next);
    // Amendment 9 — candidate pool changes when zone flips, so the
    // selected set must reset (sides in 'and' typically aren't the same
    // ones in 'or').
    setRemoveSelectedIds(new Set());
    setExpandedSideIds(new Set());
  }

  async function runAdd() {
    if (addSelectedIds.length === 0) {
      setError('Pick at least one side to add');
      return;
    }
    setExecuting(true);
    setError(null);
    setSkipNotice(null);
    try {
      const result = await onBulkAddSides(
        selectedParentIds,
        { side_type: addZone, side_ids: addSelectedIds },
      );
      const totalAdded = result.updated.reduce((s, u) => s + (u.sides_added ?? 0), 0);
      const totalSkipped = result.updated.reduce((s, u) => s + (u.sides_skipped ?? 0), 0);
      setSkipNotice(
        totalSkipped > 0
          ? `Added ${totalAdded} side${totalAdded === 1 ? '' : 's'} (${totalSkipped} already present)`
          : `Added ${totalAdded} side${totalAdded === 1 ? '' : 's'} across ${result.updated.length} item${result.updated.length === 1 ? '' : 's'}`,
      );
      requestComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk add sides failed');
    } finally {
      setExecuting(false);
    }
  }

  async function runRemove() {
    if (removeSelectedIds.size === 0) {
      setError('Pick at least one side to remove');
      return;
    }
    setExecuting(true);
    setError(null);
    setSkipNotice(null);
    try {
      const result = await onBulkRemoveSides(
        selectedParentIds,
        { side_type: removeZone, side_ids: Array.from(removeSelectedIds) },
      );
      const totalRemoved = result.updated.reduce((s, u) => s + (u.sides_removed ?? 0), 0);
      const totalSkipped = result.updated.reduce((s, u) => s + (u.sides_skipped ?? 0), 0);
      setSkipNotice(
        totalSkipped > 0
          ? `Removed ${totalRemoved} side${totalRemoved === 1 ? '' : 's'} (${totalSkipped} were not present)`
          : `Removed ${totalRemoved} side${totalRemoved === 1 ? '' : 's'} across ${result.updated.length} item${result.updated.length === 1 ? '' : 's'}`,
      );
      requestComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk remove sides failed');
    } finally {
      setExecuting(false);
    }
  }

  function onApply() {
    setError(null);
    if (tab === 'includes') {
      void runAdd();
    } else {
      void runRemove();
    }
  }

  // ── Render ──────────────────────────────────────────────────────────
  const itemCount = selectedItems.length;
  const applyDisabled =
    executing
    || (tab === 'includes' && addSelectedIds.length === 0)
    || (tab === 'removeIncludes' && removeSelectedIds.size === 0);

  return (
    <>
      <div
        onClick={requestClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 40,
          background: 'rgba(0,0,0,0.15)',
          opacity: isOpen ? 1 : 0,
          transition: `opacity ${SLIDE_MS}ms ease-out`,
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
        data-testid="bulk-menu-sides-backdrop"
      />
      <div
        data-testid="bulk-menu-sides-panel"
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: '50vw', minWidth: 360, zIndex: 50,
          background: 'var(--white)',
          borderLeft: '1px solid var(--border)',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: `transform ${SLIDE_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`,
          willChange: 'transform',
        }}
      >
        {/* Header — mirrors BulkActionsPanel layout (title + subtitle
            count + close icon) for visual parity. */}
        <div
          style={{
            padding: '16px 16px 12px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
              Bulk actions
            </div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
              {itemCount} item{itemCount === 1 ? '' : 's'} selected
              {menuName ? ` · ${menuName}` : ''}
            </div>
          </div>
          <button
            type="button"
            data-testid="bulk-menu-sides-close-btn"
            onClick={requestClose}
            aria-label="Close bulk panel"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text2)', padding: 4, borderRadius: 4,
              display: 'flex', alignItems: 'center',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Item preview chips — mirrors BulkActionsPanel. Shows up to 4
            parent names + "+N more". */}
        <div
          style={{
            padding: '10px 16px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 4,
          }}
        >
          {selectedItems.slice(0, 4).map((p) => (
            <span
              key={p.id}
              style={{
                fontSize: 11,
                fontWeight: 500,
                background: '#f0f0f0',
                color: 'var(--text)',
                borderRadius: 4,
                padding: '2px 7px',
                maxWidth: 120,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={p.name}
            >
              {p.name}
            </span>
          ))}
          {itemCount > 4 && (
            <span style={{ fontSize: 11, color: 'var(--text2)', padding: '2px 4px' }}>
              +{itemCount - 4} more
            </span>
          )}
        </div>

        {/* Tab bar — matches BulkActionsPanel's mode-tab style:
            var(--blue) active, var(--text2) inactive, 2px underline. */}
        <div
          data-testid="bulk-menu-sides-tab-bar"
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          {(['includes', 'removeIncludes'] as TabKey[]).map((k) => (
            <button
              key={k}
              type="button"
              data-testid={`bulk-menu-sides-tab-${k}`}
              onClick={() => setTab(k)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '9px 12px',
                fontSize: 11,
                fontWeight: 600,
                color: tab === k ? 'var(--blue)' : 'var(--text2)',
                background: 'transparent',
                border: 'none',
                borderBottom: tab === k ? '2px solid var(--blue)' : '2px solid transparent',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {k === 'includes' ? 'Includes' : 'Remove Includes'}
            </button>
          ))}
        </div>

        {/* Body — flex column with minHeight:0 so child lists can
            flex-fill (pickers extend down to the footer). */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            padding: 16,
          }}
        >
          {tab === 'includes' && (
            <div
              style={{
                display: 'flex', flexDirection: 'column', gap: 12,
                flex: 1, minHeight: 0,
              }}
            >
              <ZoneRadio
                value={addZone}
                onChange={switchAddZone}
                testidPrefix="bulk-menu-sides-add"
              />
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                Adds the picked sides to the selected zone on each of the {itemCount}{' '}
                selected item{itemCount === 1 ? '' : 's'}. Sides already present on a
                particular item are silently skipped.
              </div>
              <BulkMemberPicker
                pool={sidePool}
                selectedIds={addSelectedIds}
                search={addSearch}
                onToggle={toggleAddMember}
                onClearAll={() => setAddSelectedIds([])}
                onChangeSearch={setAddSearch}
                testidPrefix="bulk-menu-sides"
                excludeIds={selectedParentIds}
                searchPlaceholder="Search sides to add…"
                fillHeight
              />
            </div>
          )}

          {tab === 'removeIncludes' && (
            <div
              style={{
                display: 'flex', flexDirection: 'column', gap: 12,
                flex: 1, minHeight: 0,
              }}
            >
              <ZoneRadio
                value={removeZone}
                onChange={switchRemoveZone}
                testidPrefix="bulk-menu-sides-remove"
              />

              {/* Amendment 4 — aria-live region for discovery state */}
              <div
                data-testid="bulk-menu-sides-discovery-status"
                aria-live="polite"
                style={{ fontSize: 12, color: 'var(--muted)' }}
              >
                {removeStatus === 'loading' && (
                  <div data-testid="bulk-menu-sides-remove-loading">
                    Loading current sides…
                  </div>
                )}
                {removeStatus === 'ready' && candidates.length === 0 && (
                  <div data-testid="bulk-menu-sides-remove-empty">
                    No sides in {removeZone === 'and' ? 'Includes (All)' : 'Choose-One'} on the selected items.
                  </div>
                )}
              </div>

              {/* Per-parent load-error rows */}
              {removeLoadErrors.length > 0 && (
                <div
                  data-testid="bulk-menu-sides-discovery-errors"
                  role="alert"
                  style={{
                    background: '#fef3c7',
                    border: '1px solid #fcd34d',
                    borderRadius: 'var(--r-xs)',
                    padding: '8px 10px',
                    fontSize: 11,
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#92400e', marginBottom: 4 }}>
                    Couldn't load sides for {removeLoadErrors.length} item{removeLoadErrors.length === 1 ? '' : 's'}
                  </div>
                  <ul style={{ margin: 0, padding: '0 0 0 16px', color: '#78350f' }}>
                    {removeLoadErrors.map((p) => (
                      <li
                        key={p.id}
                        data-testid={`bulk-menu-sides-discovery-error-${p.id}`}
                      >
                        {p.name}
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    data-testid="bulk-menu-sides-discovery-retry"
                    onClick={() => { void fireDiscovery(); }}
                    style={{
                      marginTop: 6,
                      fontSize: 11, padding: '3px 8px',
                      background: '#fff', border: '1px solid #fcd34d',
                      borderRadius: 'var(--r-xs)', cursor: 'pointer',
                      color: '#92400e',
                    }}
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Candidate side list with expand-to-reveal parents */}
              {removeStatus === 'ready' && candidates.length > 0 && (
                <div
                  data-testid="bulk-menu-sides-remove-candidates"
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-xs)',
                    background: '#fff',
                    flex: 1,
                    minHeight: 0,
                    overflowY: 'auto',
                  }}
                >
                  {candidates.map((c) => {
                    const expanded = expandedSideIds.has(c.id);
                    const checked = removeSelectedIds.has(c.id);
                    return (
                      <div
                        key={c.id}
                        data-testid={`bulk-menu-sides-remove-side-row-${c.id}`}
                        style={{
                          display: 'flex', flexDirection: 'column',
                          borderBottom: '1px solid var(--border)',
                          // Selected = same brand-light tint the picker
                          // uses for selected rows → visual parity across
                          // both drawers' list surfaces.
                          background: checked ? 'var(--brand-l)' : '#fff',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '6px 10px',
                          }}
                        >
                          <input
                            type="checkbox"
                            data-testid={`bulk-menu-sides-remove-side-checkbox-${c.id}`}
                            checked={checked}
                            onChange={() => toggleRemoveSide(c.id)}
                            aria-label={`Select ${c.name} for removal`}
                          />
                          <span style={{ flex: 1, fontSize: 12 }}>
                            {c.name}
                          </span>
                          <button
                            type="button"
                            data-testid={`bulk-menu-sides-remove-side-expand-${c.id}`}
                            onClick={() => toggleExpandSide(c.id)}
                            aria-label={expanded ? `Collapse details for ${c.name}` : `Expand details for ${c.name}`}
                            aria-expanded={expanded}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 4,
                              fontSize: 11, padding: '3px 6px',
                              background: 'transparent', border: 'none',
                              cursor: 'pointer', color: 'var(--muted)',
                            }}
                          >
                            on {c.present_on.length} item{c.present_on.length === 1 ? '' : 's'}
                            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          </button>
                        </div>
                        {expanded && (
                          <div
                            data-testid={`bulk-menu-sides-remove-side-detail-${c.id}`}
                            style={{
                              fontSize: 11, color: 'var(--muted)',
                              padding: '0 10px 8px 32px',
                            }}
                          >
                            {c.present_on.map((p) => p.name).join(' · ')}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}
        >
          {error && (
            <div
              data-testid="bulk-menu-sides-error-banner"
              role="alert"
              style={{
                fontSize: 11, color: '#b91c1c', background: '#fee2e2',
                borderRadius: 4, padding: '6px 10px',
              }}
            >
              {error}
            </div>
          )}
          {skipNotice && (
            <div
              data-testid="bulk-menu-sides-skipped-count"
              aria-live="polite"
              style={{
                fontSize: 11, color: '#065f46', background: '#d1fae5',
                borderRadius: 4, padding: '6px 10px',
              }}
            >
              {skipNotice}
            </div>
          )}
          {/* Cancel + Apply — same 1:2 flex ratio + colors as BulkActionsPanel */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              data-testid="bulk-menu-sides-cancel-btn"
              onClick={requestClose}
              disabled={executing}
              style={{
                flex: 1,
                padding: '8px 0',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text2)',
                background: '#f0f0f0',
                border: 'none',
                borderRadius: 'var(--r-xs)',
                cursor: executing ? 'not-allowed' : 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="bulk-menu-sides-apply-btn"
              onClick={onApply}
              disabled={applyDisabled}
              style={{
                flex: 2,
                padding: '8px 0',
                fontSize: 12,
                fontWeight: 700,
                color: 'white',
                background: applyDisabled ? 'var(--text2)' : 'var(--blue)',
                border: 'none',
                borderRadius: 'var(--r-xs)',
                cursor: applyDisabled ? 'not-allowed' : 'pointer',
                opacity: applyDisabled ? 0.6 : 1,
              }}
            >
              {executing
                ? 'Applying…'
                : tab === 'includes'
                  ? `Add ${addSelectedIds.length} side${addSelectedIds.length === 1 ? '' : 's'} to ${itemCount} item${itemCount === 1 ? '' : 's'}`
                  : `Remove ${removeSelectedIds.size} side${removeSelectedIds.size === 1 ? '' : 's'} from ${itemCount} item${itemCount === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

interface ZoneRadioProps {
  value: SideType;
  onChange: (v: SideType) => void;
  testidPrefix: string;
}

function ZoneRadio({ value, onChange, testidPrefix }: ZoneRadioProps) {
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', gap: 4,
        padding: '10px 12px',
        background: '#f9fafb',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-xs)',
      }}
    >
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
        <input
          type="radio"
          data-testid={`${testidPrefix}-zone-and`}
          name={`${testidPrefix}-zone`}
          checked={value === 'and'}
          onChange={() => onChange('and')}
        />
        Includes (All) — free, comes with the dish
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
        <input
          type="radio"
          data-testid={`${testidPrefix}-zone-or`}
          name={`${testidPrefix}-zone`}
          checked={value === 'or'}
          onChange={() => onChange('or')}
        />
        Choose-One — diner picks one
      </label>
    </div>
  );
}

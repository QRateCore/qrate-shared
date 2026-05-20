'use client';
/**
 * Per-item per-menu sides editor — rendered in the expanded dish row
 * of the MenuBuilder (desktop only).
 *
 * PDD 2026-05-15 v2 Step 6 — replaces the previous Add-ons +
 * Recommendations + custom Groupings drop zones with the two
 * menu-level zones:
 *   - "Includes All"        (sides_and, neutral tint)
 *   - "Includes one by choice" (sides_or, amber tint)
 *
 * Why the previous zones are gone: food-item-level groupings + their
 * members already render as colored chips on each dish row via the
 * MenuBuilder's unified per-grouping chip cluster. Re-rendering them
 * as drop zones in the expanded panel duplicated the surface.
 * Authoring food-item groupings lives in the Food Item's EditModal
 * Groupings tab (`GroupingsSection.tsx`) — the canonical
 * item-level authoring surface.
 *
 * The legacy ModifierEntry / ModifierUpdatePayload / BYOHandlers
 * types are kept at the top of this file (and re-exported) because
 * MobileItemModifierPicker (the mobile row editor) still consumes
 * them via its SearchPicker pattern. Mobile per-menu sides authoring
 * is deferred to a follow-up per the v2 PDD scope decision.
 *
 * Persistence: GET + PUT
 * /owner/menu-items/{itemId}/menus/{menuId}/sides via the typed
 * `perMenuSides` adapter prop. Backend bulk-replace semantics.
 * Optimistic update with single-flight + AbortController so rapid
 * drops don't race; the last drop wins.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import type { MenuItemDisplay, SelectionRule } from '../../../types/restaurant';

const COLOR_ERROR = '#dc2626';

// ── Legacy types preserved for MobileItemModifierPicker ─────────────────────
//
// These describe the OLD addons/recommendations update payload. They
// are no longer used by THIS component but mobile still imports them.
// Keep the types exported to avoid touching mobile in this PDD.

export interface ModifierEntry {
  menu_item_id: string;
  name: string;
  price_override: number | null;
  thumbnail_url?: string | null;
}

export interface ModifierUpdatePayload {
  recommendations: ModifierEntry[];
  addons?: ModifierEntry[];
  /** Item IDs already added to the menu by an external hook (e.g. the
   *  category-selection modal). The auto-add block in handleUpdateModifiers
   *  skips these to avoid overwriting the user's category selection. */
  _hookHandledItemIds?: string[];
}

export interface BYOHandlers {
  onCreateCustomGrouping: (parentItemId: string, body: { name: string; rule: SelectionRule }) => Promise<void>;
  onRenameGrouping: (groupingId: string, name: string) => Promise<void>;
  onUpdateGroupingRule: (groupingId: string, rule: SelectionRule) => Promise<void>;
  onDeleteGrouping: (groupingId: string) => Promise<void>;
  onAddCustomGroupingItem: (groupingId: string, droppedItemId: string) => Promise<void>;
  onRemoveCustomGroupingItem: (groupingItemId: string) => Promise<void>;
}

// ── Per-menu sides types ────────────────────────────────────────────────────

/** One side entry as returned by the resolver. `name` and thumbnails
 *  are server-resolved from `menu_items`; the PUT body only needs
 *  `menu_item_id` + optional `price_override`. */
export interface MenuSideEntry {
  menu_item_id: string;
  name?: string;
  price_override?: number | null;
  thumbnail_url?: string | null;
  thumbnail_small_url?: string | null;
}

export interface MenuItemMenuSides {
  sides_and: MenuSideEntry[];
  sides_or: MenuSideEntry[];
}

/** Body payload for the PUT — backend bulk-replaces all rows for the
 *  (item, menu) placement with these entries in order. */
export interface SetMenuSidesBody {
  sides_and: Array<{ menu_item_id: string; price_override?: number | null }>;
  sides_or: Array<{ menu_item_id: string; price_override?: number | null }>;
}

/** Plugin adapter — the apps/owner caller wires
 *  `ownerMenuSidesService` into this. The shared package can't import
 *  from apps/owner so the consumer provides the implementation. */
export interface PerMenuSidesAdapter {
  get: (itemId: string, menuId: string) => Promise<MenuItemMenuSides>;
  set: (itemId: string, menuId: string, body: SetMenuSidesBody) => Promise<MenuItemMenuSides>;
}

interface Props {
  parent: MenuItemDisplay;
  /** Pool of all restaurant items keyed by id — used to validate
   *  dropped items (resolve name, reject addons). */
  itemsById: Map<string, MenuItemDisplay>;
  /** The active menu from the MenuBuilder sidebar. Null = no menu
   *  selected (rare; the component renders nothing in that case). */
  currentMenuId: string | null;
  /** Provided by the apps/owner consumer. When omitted (e.g. unit
   *  tests rendering MenuBuilder in isolation), the component renders
   *  nothing — same behaviour as `currentMenuId=null`. */
  perMenuSides?: PerMenuSidesAdapter;
  /**
   * Off-menu drop gate (PDD 2026-05-20 v2). When the owner drops a dish
   * into an Includes or Choose-One zone and that dish is not already on
   * the current menu, the consumer app fires this callback to prompt for
   * a canonical category before the drop is persisted.
   *
   * Contract:
   *   - Return `true`  → proceed with the drop (consumer handled the
   *                      menu-attach internally; this component only
   *                      writes the menu_item_menu_sides row).
   *   - Return `false` → skip this dropped item. Other items in the
   *                      same drop event still process.
   *
   * Unset → drops proceed unconditionally (legacy + tests).
   */
  onConfirmIncludeDrop?: (item: MenuItemDisplay, menuId: string | null) => Promise<boolean>;
}

export default function ItemModifierZones({
  parent,
  itemsById,
  currentMenuId,
  perMenuSides,
  onConfirmIncludeDrop,
}: Props) {
  const [sidesAnd, setSidesAnd] = useState<MenuSideEntry[]>([]);
  const [sidesOr, setSidesOr] = useState<MenuSideEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidesAndDragOver, setSidesAndDragOver] = useState(false);
  const [sidesOrDragOver, setSidesOrDragOver] = useState(false);

  // Single-flight PUT — rapid drops coalesce, the last one wins.
  // Production owner UI tends to fire 2-4 drops in quick succession
  // when an owner is composing a side set; without this the requests
  // race and the server may persist intermediate states out of order.
  const inFlight = useRef<AbortController | null>(null);

  // Optimistic snapshot — revert target on PUT failure.
  const lastConfirmed = useRef<{ sides_and: MenuSideEntry[]; sides_or: MenuSideEntry[] }>({
    sides_and: [],
    sides_or: [],
  });

  const itemId = parent.id;

  // Load on mount + menu change. Cancellation guard against unmount.
  useEffect(() => {
    if (!currentMenuId || !perMenuSides) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    perMenuSides
      .get(itemId, currentMenuId)
      .then((res) => {
        if (cancelled) return;
        setSidesAnd(res.sides_and);
        setSidesOr(res.sides_or);
        lastConfirmed.current = { sides_and: res.sides_and, sides_or: res.sides_or };
      })
      .catch((e) => {
        if (cancelled) return;
        // 404 MENU_NOT_ASSOCIATED is normal for a placement that
        // doesn't exist yet — empty zones, don't toast.
        const msg = e instanceof Error ? e.message : String(e);
        if (/MENU_NOT_ASSOCIATED|404/i.test(msg)) {
          setSidesAnd([]);
          setSidesOr([]);
          lastConfirmed.current = { sides_and: [], sides_or: [] };
        } else {
          setLoadError(msg);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId, currentMenuId, perMenuSides]);

  // Cancel any in-flight save on unmount so a stale response doesn't
  // overwrite the next dish row's state.
  useEffect(
    () => () => {
      inFlight.current?.abort();
      inFlight.current = null;
    },
    [],
  );

  const persist = useCallback(
    (nextAnd: MenuSideEntry[], nextOr: MenuSideEntry[]) => {
      if (!currentMenuId || !perMenuSides) return;
      // Coalesce: abort any in-flight save so the latest drop wins.
      inFlight.current?.abort();
      const ac = new AbortController();
      inFlight.current = ac;

      const body: SetMenuSidesBody = {
        sides_and: nextAnd.map((s) => ({
          menu_item_id: s.menu_item_id,
          price_override: s.price_override ?? null,
        })),
        sides_or: nextOr.map((s) => ({
          menu_item_id: s.menu_item_id,
          price_override: s.price_override ?? null,
        })),
      };

      perMenuSides
        .set(itemId, currentMenuId, body)
        .then((res) => {
          if (ac.signal.aborted) return;
          // Backend resolver returns full names + thumbnails — adopt the
          // server's resolved view so cards render correctly without a
          // separate GET round-trip.
          setSidesAnd(res.sides_and);
          setSidesOr(res.sides_or);
          lastConfirmed.current = { sides_and: res.sides_and, sides_or: res.sides_or };
        })
        .catch((e) => {
          if (ac.signal.aborted) return;
          // Revert optimistic state to the last confirmed snapshot.
          setSidesAnd(lastConfirmed.current.sides_and);
          setSidesOr(lastConfirmed.current.sides_or);
          const msg = e instanceof Error ? e.message : 'Save failed';
          toast.error(msg);
        });
    },
    [itemId, currentMenuId, perMenuSides],
  );

  // Parse the dragged payload. The pool's drag source serializes a
  // JSON array of selected ids (multi-select drag) or a bare id string.
  function parseDroppedIds(raw: string): string[] {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((id): id is string => typeof id === 'string');
      return typeof parsed === 'string' ? [parsed] : [raw];
    } catch {
      return raw ? [raw] : [];
    }
  }

  function makeEntry(droppedItem: MenuItemDisplay, existingOverride: number | null = null): MenuSideEntry {
    return {
      menu_item_id: droppedItem.id,
      name: droppedItem.name,
      price_override: existingOverride,
      thumbnail_url: droppedItem.thumbnail_url ?? null,
      thumbnail_small_url:
        (droppedItem as MenuItemDisplay & { thumbnail_small_url?: string | null })
          .thumbnail_small_url ?? null,
    };
  }

  async function handleDrop(zone: 'and' | 'or', e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setSidesAndDragOver(false);
    setSidesOrDragOver(false);

    const droppedIds = parseDroppedIds(e.dataTransfer.getData('text/plain'));
    if (droppedIds.length === 0) return;

    const targetIds = new Set((zone === 'and' ? sidesAnd : sidesOr).map((s) => s.menu_item_id));
    const otherIds = new Set((zone === 'and' ? sidesOr : sidesAnd).map((s) => s.menu_item_id));

    const accepted: MenuSideEntry[] = [];
    let rejectedAddon = false;
    let rejectedCrossZone = false;
    for (const id of droppedIds) {
      if (id === parent.id) continue; // can't add the dish to itself
      if (targetIds.has(id)) continue; // already in the target zone
      if (otherIds.has(id)) {
        rejectedCrossZone = true;
        continue;
      }
      const dropped = itemsById.get(id);
      if (!dropped) continue;
      if (dropped.item_type === 'addon') {
        rejectedAddon = true;
        continue;
      }
      // Off-menu gate (PDD 2026-05-20). When the dropped item isn't on
      // the current menu, the consumer opens the category-selection
      // modal and ATTACHES the item to the menu under the chosen
      // canonical category. Skip the side-write for any drop the user
      // cancels — other accepted drops in the same event still process.
      if (onConfirmIncludeDrop) {
        const proceed = await onConfirmIncludeDrop(dropped, currentMenuId);
        if (!proceed) continue;
      }
      accepted.push(makeEntry(dropped));
    }

    if (rejectedAddon) {
      toast.warning('Add-ons cannot be used as sides');
    }
    if (rejectedCrossZone) {
      toast.warning('That side is already in the other slot');
    }
    if (accepted.length === 0) return;

    const nextAnd = zone === 'and' ? [...sidesAnd, ...accepted] : sidesAnd;
    const nextOr = zone === 'or' ? [...sidesOr, ...accepted] : sidesOr;
    setSidesAnd(nextAnd); // optimistic
    setSidesOr(nextOr);
    persist(nextAnd, nextOr);
  }

  function removeSide(zone: 'and' | 'or', menu_item_id: string) {
    const nextAnd =
      zone === 'and' ? sidesAnd.filter((s) => s.menu_item_id !== menu_item_id) : sidesAnd;
    const nextOr =
      zone === 'or' ? sidesOr.filter((s) => s.menu_item_id !== menu_item_id) : sidesOr;
    setSidesAnd(nextAnd);
    setSidesOr(nextOr);
    persist(nextAnd, nextOr);
  }

  // No menu context = no UI. Mirrors the v1 behaviour where the
  // expanded panel was hidden when no menu was selected in the sidebar.
  if (!currentMenuId || !perMenuSides) {
    return null;
  }

  if (loading) {
    return (
      <div
        className="modifier-section"
        data-testid={`per-menu-sides-loading-${itemId}`}
        style={{ padding: 8, color: 'var(--text2)', fontSize: 12 }}
      >
        Loading per-menu sides…
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        className="modifier-section"
        data-testid={`per-menu-sides-error-${itemId}`}
        style={{ padding: 8, color: COLOR_ERROR, fontSize: 12 }}
      >
        Couldn’t load per-menu sides: {loadError}
      </div>
    );
  }

  return (
    <div
      style={{ display: 'flex', gap: 10 }}
      data-testid={`per-menu-sides-${itemId}`}
      onDragOver={(e) => e.stopPropagation()}
    >
      {/* ── Includes All (sides_and) zone — neutral tint ─────────────────── */}
      <div className="modifier-section" style={{ flex: 1, minWidth: 0 }}>
        <div className="modifier-section-header modifier-section-header--sides">
          <span className="modifier-section-title">Includes All</span>
          {sidesAnd.length > 0 && (
            <span className="modifier-section-count">{sidesAnd.length}</span>
          )}
        </div>
        <p className="modifier-section-hint">
          All of these come with the dish on this menu (free of charge)
        </p>
        <div
          data-testid={`sides-and-drop-zone-${itemId}`}
          className={`modifier-drop-zone${sidesAndDragOver ? ' drag-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setSidesAndDragOver(true);
          }}
          onDragLeave={() => setSidesAndDragOver(false)}
          onDrop={(e) => handleDrop('and', e)}
        >
          {sidesAnd.length === 0 ? (
            <div className="modifier-drop-zone-empty">Drop included sides here</div>
          ) : (
            sidesAnd.map((side) =>
              renderCard(side, () => removeSide('and', side.menu_item_id), 'remove-sides-and', itemId),
            )
          )}
        </div>
      </div>

      {/* ── Includes one by choice (sides_or) zone — amber tint ──────────── */}
      <div className="modifier-section" style={{ flex: 1, minWidth: 0 }}>
        <div
          className="modifier-section-header modifier-section-header--sides"
          style={{ background: '#fef3c7', color: '#92400e' }}
        >
          <span className="modifier-section-title">Includes one by choice</span>
          {sidesOr.length > 0 && (
            <span className="modifier-section-count">{sidesOr.length}</span>
          )}
        </div>
        <p className="modifier-section-hint">
          Patron picks one of these on this menu (free of charge)
        </p>
        <div
          data-testid={`sides-or-drop-zone-${itemId}`}
          className={`modifier-drop-zone${sidesOrDragOver ? ' drag-over' : ''}`}
          style={sidesOrDragOver ? { borderColor: '#f59e0b', background: '#fffbeb' } : undefined}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setSidesOrDragOver(true);
          }}
          onDragLeave={() => setSidesOrDragOver(false)}
          onDrop={(e) => handleDrop('or', e)}
        >
          {sidesOr.length === 0 ? (
            <div className="modifier-drop-zone-empty">Drop choice sides here</div>
          ) : (
            sidesOr.map((side) =>
              renderCard(side, () => removeSide('or', side.menu_item_id), 'remove-sides-or', itemId),
            )
          )}
        </div>
      </div>
    </div>
  );
}

function renderCard(
  side: MenuSideEntry,
  onRemove: () => void,
  testIdPrefix: string,
  parentItemId: string,
) {
  return (
    <div key={side.menu_item_id} className="modifier-card">
      <div className="modifier-card-thumb">
        {side.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={side.thumbnail_url}
            alt={side.name ?? ''}
            draggable={false}
            loading="lazy"
            width={60}
            height={60}
          />
        ) : (
          <span style={{ fontSize: 18 }}>🍽</span>
        )}
      </div>
      <div className="modifier-card-body">
        <div className="modifier-card-name">{side.name ?? '(unnamed)'}</div>
      </div>
      <button
        type="button"
        className="modifier-card-delete"
        onClick={onRemove}
        data-testid={`${testIdPrefix}-${parentItemId}-${side.menu_item_id}`}
        title="Remove"
      >
        <X size={11} />
      </button>
    </div>
  );
}

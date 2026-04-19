'use client';
/**
 * Per-item Sides + Recommendations editor — rendered in the expanded dish row of the MenuBuilder.
 *
 * Two modes:
 *
 *   Legacy (enableAndOrSplit=false) — single Sides zone with AND/OR dropdown:
 *     - Sides (left)            — free or low-cost included extras; price_override defaults to null = "Free"
 *     - Add-ons (middle)        — ingredient-level extras
 *     - Recommendations (right) — complementary paired dishes; price pre-filled from base price
 *
 *   Split (enableAndOrSplit=true, STR-342) — two stacked Sides zones, no AND/OR dropdown:
 *     - Included (grey)         — always free-with-order (side_type='and')
 *     - Choice   (amber)        — one-of selection (side_type='or')
 *     - Add-ons                 — unchanged
 *     - Recommendations         — unchanged
 *     Cross-group duplicate between Included and Choice is rejected with a toast.
 *
 * Persistence: PUT /owner/menu-items/{itemId}/modifiers via owner-restaurant-service.
 * State is lifted to the parent so optimistic updates flow through items[].
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import { COLOR_WARNING, COLOR_WARNING_BG, COLOR_WARNING_BG_SM, COLOR_WARNING_TEXT, COLOR_ERROR } from '../../../constants/colors';
import Select from '../../common/Select';
import type { MenuItemDisplay } from '../../../types/restaurant';

export interface ModifierEntry {
  menu_item_id: string;
  name: string;
  price_override: number | null;
  thumbnail_url?: string | null;
}

/**
 * Payload emitted by the editor. When `enableAndOrSplit` is ON the parent
 * should persist `sides_and` + `sides_or` and ignore `sides`/`sides_selection_mode`.
 * When OFF the parent should persist `sides` + `sides_selection_mode` and ignore
 * the split fields.
 */
export interface ModifierUpdatePayload {
  sides: ModifierEntry[];
  sides_and?: ModifierEntry[];
  sides_or?: ModifierEntry[];
  recommendations: ModifierEntry[];
  sides_selection_mode: 'and' | 'or';
  addons?: ModifierEntry[];
  /** Item IDs already added to the menu by an external hook (e.g. the
   *  category-selection modal). The auto-add block in handleUpdateModifiers
   *  skips these to avoid overwriting the user's category selection. */
  _hookHandledItemIds?: string[];
}

interface Props {
  parent: MenuItemDisplay;
  itemsById: Map<string, MenuItemDisplay>;
  /**
   * The menu currently being edited — passed to `onConfirmRecommendationDrop`
   * so consumer apps can check "is the dropped item on this menu?" and call
   * backend APIs scoped to the right menu. `null` only if the Menu Builder
   * has no active menu (edge case — consumers should treat as no-prompt path).
   */
  currentMenuId: string | null;
  onUpdate: (parentId: string, next: ModifierUpdatePayload) => Promise<void>;
  /**
   * Optional gate called before a dropped item is added to the Recommendations
   * zone. The parent inspects the item and decides whether the drop should
   * proceed — e.g., the owner dashboard uses this to prompt for canonical
   * categories when the dropped item is not on the current menu yet, and to
   * call the `addItemToMenu` API after the user confirms.
   *
   * Return `true` to proceed with the emit, `false` to cancel the drop. When
   * this prop is not provided, the drop proceeds without prompting (current
   * backward-compatible behavior).
   */
  onConfirmRecommendationDrop?: (item: MenuItemDisplay, menuId: string | null) => Promise<boolean>;
  /**
   * When true, render two stacked Sides zones (Included + Choice) driven by
   * `parent.sides_and` / `parent.sides_or`. When false (default), render the
   * legacy single Sides zone with AND/OR dropdown driven by `parent.sides` /
   * `parent.sides_selection_mode`. Flag source: `features.sides_and_or_split`
   * on the restaurant. STR-342.
   */
  enableAndOrSplit?: boolean;
  /**
   * Called when a drag-drop is rejected because the item is already in the
   * other sides group (Included ↔ Choice). Consumers should surface a toast:
   * "Already in [Included/Choice] — remove first". Only fires when
   * `enableAndOrSplit` is true.
   */
  onCrossGroupDuplicate?: (existingGroup: 'included' | 'choice') => void;
}

export default function ItemModifierZones({
  parent,
  itemsById,
  currentMenuId,
  onUpdate,
  onConfirmRecommendationDrop,
  enableAndOrSplit = false,
  onCrossGroupDuplicate,
}: Props) {
  // ── Legacy (single-zone) state ──────────────────────────────────────────────
  const sides: ModifierEntry[] = (parent.sides ?? []) as ModifierEntry[];
  const sidesSelectionMode: 'and' | 'or' = parent.sides_selection_mode ?? 'and';

  // ── Split (2-box) state ──────────────────────────────────────────────────────
  const sidesAnd: ModifierEntry[] = (parent.sides_and ?? []) as ModifierEntry[];
  const sidesOr: ModifierEntry[] = (parent.sides_or ?? []) as ModifierEntry[];

  const recommendations: ModifierEntry[] = ((parent.recommendations ?? []) as ModifierEntry[]).map((r) => ({
    ...r,
    price_override: r.price_override ?? 0,
  }));
  const addons: ModifierEntry[] = ((parent.addons ?? []) as Array<{ menu_item_id: string; name: string; price_override: number | null; thumbnail_url?: string | null; status?: string }>)
    .filter((a) => (a.status === 'approved' || a.status === undefined) && itemsById.has(a.menu_item_id))
    .map((a) => ({ menu_item_id: a.menu_item_id, name: a.name, price_override: a.price_override ?? null, thumbnail_url: a.thumbnail_url ?? null }));

  const [sidesDragOver, setSidesDragOver] = useState(false);
  const [sidesAndDragOver, setSidesAndDragOver] = useState(false);
  const [sidesOrDragOver, setSidesOrDragOver] = useState(false);
  const [addonsDragOver, setAddonsDragOver] = useState(false);
  const [recommendationsDragOver, setRecommendationsDragOver] = useState(false);

  const sideIds = new Set(sides.map((s) => s.menu_item_id));
  const sidesAndIds = new Set(sidesAnd.map((s) => s.menu_item_id));
  const sidesOrIds = new Set(sidesOr.map((s) => s.menu_item_id));
  const addonIds = new Set(addons.map((a) => a.menu_item_id));
  const recommendationIds = new Set(recommendations.map((r) => r.menu_item_id));

  /**
   * A rec's target is "inactive" — and so shouldn't reach diners — when the
   * target item is hidden by the owner (active=false) OR is not placed on
   * any menu (empty menu_associations). Matches the backend rec-engine filter
   * (Step 1 of the rec-lifecycle PDD): `active AND deleted_at IS NULL AND
   * EXISTS menu_item_menus.active`. Items not present in itemsById are
   * treated as inactive too — the parent state is stale, so render defensively.
   *
   * When a rec target is inactive, the card gets a red border so the owner
   * can see "this pairing isn't reaching diners right now." Per Q-PRE-2 in
   * idea-honing.md, owners keep visibility of their curated pairings even
   * when the target is temporarily hidden/off-menu.
   */
  function isRecTargetInactive(targetId: string): boolean {
    const target = itemsById.get(targetId);
    if (!target) return true;
    if (target.active === false) return true;
    if (!target.menu_associations || target.menu_associations.length === 0) return true;
    return false;
  }

  /**
   * Emit a partial update. The caller provides the fields that changed; the
   * rest default to the current parent state. The payload always includes
   * both legacy and split fields so the parent can decide which shape to
   * persist based on the flag. STR-342.
   */
  function emit(overrides: Partial<ModifierUpdatePayload>) {
    const payload: ModifierUpdatePayload = {
      sides: overrides.sides ?? sides,
      sides_and: overrides.sides_and ?? sidesAnd,
      sides_or: overrides.sides_or ?? sidesOr,
      recommendations: overrides.recommendations ?? recommendations,
      sides_selection_mode: overrides.sides_selection_mode ?? sidesSelectionMode,
      addons: overrides.addons ?? addons,
      _hookHandledItemIds: overrides._hookHandledItemIds,
    };
    void onUpdate(parent.id, payload);
  }

  function parseDroppedId(raw: string): string {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed[0] : raw;
    } catch {
      return raw;
    }
  }

  // ── Legacy Sides handlers ────────────────────────────────────────────────────

  function handleDropSide(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setSidesDragOver(false);
    const droppedId = parseDroppedId(e.dataTransfer.getData('text/plain'));
    if (!droppedId || droppedId === parent.id) return;
    if (sideIds.has(droppedId)) return;
    const dropped = itemsById.get(droppedId);
    if (!dropped || dropped.item_type === 'addon') return;
    const next: ModifierEntry = {
      menu_item_id: dropped.id,
      name: dropped.name,
      price_override: null,
      thumbnail_url: dropped.thumbnail_url ?? null,
    };
    emit({ sides: [...sides, next] });
  }

  function removeSide(id: string) {
    emit({ sides: sides.filter((s) => s.menu_item_id !== id) });
  }

  function changeSelectionMode(mode: 'and' | 'or') {
    emit({ sides_selection_mode: mode });
  }

  // ── Split Sides (Included = AND) handlers ────────────────────────────────────

  function handleDropSidesAnd(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setSidesAndDragOver(false);
    const droppedId = parseDroppedId(e.dataTransfer.getData('text/plain'));
    if (!droppedId || droppedId === parent.id) return;
    // Already in this group → silent no-op
    if (sidesAndIds.has(droppedId)) return;
    // Cross-group duplicate — surface to parent for toast
    if (sidesOrIds.has(droppedId)) {
      onCrossGroupDuplicate?.('choice');
      return;
    }
    const dropped = itemsById.get(droppedId);
    if (!dropped || dropped.item_type === 'addon') return;
    const next: ModifierEntry = {
      menu_item_id: dropped.id,
      name: dropped.name,
      price_override: null,
      thumbnail_url: dropped.thumbnail_url ?? null,
    };
    emit({ sides_and: [...sidesAnd, next] });
  }

  function removeSidesAnd(id: string) {
    emit({ sides_and: sidesAnd.filter((s) => s.menu_item_id !== id) });
  }

  // ── Split Sides (Choice = OR) handlers ───────────────────────────────────────

  function handleDropSidesOr(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setSidesOrDragOver(false);
    const droppedId = parseDroppedId(e.dataTransfer.getData('text/plain'));
    if (!droppedId || droppedId === parent.id) return;
    if (sidesOrIds.has(droppedId)) return;
    if (sidesAndIds.has(droppedId)) {
      onCrossGroupDuplicate?.('included');
      return;
    }
    const dropped = itemsById.get(droppedId);
    if (!dropped || dropped.item_type === 'addon') return;
    const next: ModifierEntry = {
      menu_item_id: dropped.id,
      name: dropped.name,
      price_override: null,
      thumbnail_url: dropped.thumbnail_url ?? null,
    };
    emit({ sides_or: [...sidesOr, next] });
  }

  function removeSidesOr(id: string) {
    emit({ sides_or: sidesOr.filter((s) => s.menu_item_id !== id) });
  }

  // ── Addons handlers ──────────────────────────────────────────────────────────

  function handleDropAddon(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setAddonsDragOver(false);
    const droppedId = parseDroppedId(e.dataTransfer.getData('text/plain'));
    if (!droppedId || droppedId === parent.id) return;
    if (addonIds.has(droppedId)) return;
    const dropped = itemsById.get(droppedId);
    if (!dropped || dropped.item_type !== 'addon') return;
    const next: ModifierEntry = {
      menu_item_id: dropped.id,
      name: dropped.name,
      price_override: dropped.price ?? null,
      thumbnail_url: dropped.thumbnail_url ?? null,
    };
    emit({ addons: [...addons, next] });
  }

  function removeAddon(id: string) {
    emit({ addons: addons.filter((a) => a.menu_item_id !== id) });
  }

  // ── Recommendations handlers ─────────────────────────────────────────────────

  async function handleDropRecommendation(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setRecommendationsDragOver(false);
    const droppedId = parseDroppedId(e.dataTransfer.getData('text/plain'));
    if (!droppedId || droppedId === parent.id) return;
    if (recommendationIds.has(droppedId)) return;
    const dropped = itemsById.get(droppedId);
    if (!dropped || dropped.item_type === 'addon') return;

    // Optional gate — parent may prompt (e.g., "add to which categories?")
    // before accepting the drop. Parent returns false on cancel; if no
    // callback provided, drop proceeds silently (backward compat).
    let hookHandledAdd = false;
    if (onConfirmRecommendationDrop) {
      const proceed = await onConfirmRecommendationDrop(dropped, currentMenuId);
      if (!proceed) return;
      hookHandledAdd = true;
    }

    const next: ModifierEntry = {
      menu_item_id: dropped.id,
      name: dropped.name,
      price_override: dropped.price ?? 0,
      thumbnail_url: dropped.thumbnail_url ?? null,
    };
    emit({
      recommendations: [...recommendations, next],
      // Tell handleUpdateModifiers to skip auto-add for this item —
      // the hook already added it to the menu with the user's selected
      // canonical category. A second addItemToMenu would overwrite that.
      ...(hookHandledAdd ? { _hookHandledItemIds: [dropped.id] } : {}),
    });
  }

  function removeRecommendation(id: string) {
    emit({ recommendations: recommendations.filter((r) => r.menu_item_id !== id) });
  }

  // ── Render helpers ──────────────────────────────────────────────────────────

  /**
   * Render a single card for a sides/addons/recommendations entry. Shared
   * across all zones to keep markup consistent.
   */
  function renderCard(entry: ModifierEntry, onRemove: () => void, testIdPrefix: string) {
    return (
      <div key={entry.menu_item_id} className="modifier-card">
        <div className="modifier-card-thumb">
          {entry.thumbnail_url ? (
            <img src={entry.thumbnail_url} alt={entry.name} draggable={false} loading="lazy" width={60} height={60} />
          ) : (
            <span style={{ fontSize: 18 }}>🍽</span>
          )}
        </div>
        <div className="modifier-card-body">
          <div className="modifier-card-name">{entry.name}</div>
        </div>
        <button
          type="button"
          className="modifier-card-delete"
          onClick={onRemove}
          data-testid={`${testIdPrefix}-${parent.id}-${entry.menu_item_id}`}
          title="Remove"
        >
          <X size={11} />
        </button>
      </div>
    );
  }

  // ── Sides column (either legacy single zone OR split 2-box) ─────────────────

  const sidesColumn = enableAndOrSplit ? (
    <div className="modifier-section" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Included (AND) zone */}
      <div>
        <div className="modifier-section-header modifier-section-header--sides">
          <span className="modifier-section-title">Includes All</span>
          {sidesAnd.length > 0 && <span className="modifier-section-count">{sidesAnd.length}</span>}
        </div>
        <p className="modifier-section-hint">All of these come with the dish (free of charge)</p>
        <div
          data-testid={`sides-and-drop-zone-${parent.id}`}
          className={`modifier-drop-zone${sidesAndDragOver ? ' drag-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setSidesAndDragOver(true); }}
          onDragLeave={() => setSidesAndDragOver(false)}
          onDrop={handleDropSidesAnd}
        >
          {sidesAnd.length === 0 ? (
            <div className="modifier-drop-zone-empty">Drop included sides here</div>
          ) : (
            sidesAnd.map((side) => renderCard(side, () => removeSidesAnd(side.menu_item_id), 'remove-sides-and'))
          )}
        </div>
      </div>

      {/* Choice (OR) zone — amber tint */}
      <div>
        <div
          className="modifier-section-header modifier-section-header--sides"
          style={{ background: COLOR_WARNING_BG, color: COLOR_WARNING_TEXT }}
        >
          <span className="modifier-section-title">Includes one by choice</span>
          {sidesOr.length > 0 && <span className="modifier-section-count">{sidesOr.length}</span>}
        </div>
        <p className="modifier-section-hint">Patron picks one of these (free of charge)</p>
        <div
          data-testid={`sides-or-drop-zone-${parent.id}`}
          className={`modifier-drop-zone${sidesOrDragOver ? ' drag-over' : ''}`}
          style={sidesOrDragOver ? { borderColor: COLOR_WARNING, background: COLOR_WARNING_BG_SM } : undefined}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setSidesOrDragOver(true); }}
          onDragLeave={() => setSidesOrDragOver(false)}
          onDrop={handleDropSidesOr}
        >
          {sidesOr.length === 0 ? (
            <div className="modifier-drop-zone-empty">Drop choice sides here</div>
          ) : (
            sidesOr.map((side) => renderCard(side, () => removeSidesOr(side.menu_item_id), 'remove-sides-or'))
          )}
        </div>
      </div>
    </div>
  ) : (
    <div className="modifier-section" style={{ flex: 1, minWidth: 0 }}>
      <div className="modifier-section-header modifier-section-header--sides">
        <span className="modifier-section-title">Sides</span>
        <Select
          size="sm"
          value={sidesSelectionMode}
          onChange={(e) => changeSelectionMode(e.target.value as 'and' | 'or')}
          data-testid={`sides-selection-mode-${parent.id}`}
          options={[
            { value: 'and', label: 'AND' },
            { value: 'or', label: 'OR' },
          ]}
          style={{ marginLeft: 8 }}
        />
        {sides.length > 0 && <span className="modifier-section-count">{sides.length}</span>}
      </div>
      <p className="modifier-section-hint">
        {sidesSelectionMode === 'or' ? 'Patron can pick One side that\'s included (Free of Cost)' : 'Patron can pick Multiple sides that are included (Free of Cost)'}
      </p>
      <div
        data-testid={`sides-drop-zone-${parent.id}`}
        className={`modifier-drop-zone${sidesDragOver ? ' drag-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setSidesDragOver(true); }}
        onDragLeave={() => setSidesDragOver(false)}
        onDrop={handleDropSide}
      >
        {sides.length === 0 ? (
          <div className="modifier-drop-zone-empty">Drop items here</div>
        ) : (
          sides.map((side) => renderCard(side, () => removeSide(side.menu_item_id), 'remove-side'))
        )}
      </div>
    </div>
  );

  return (
    <div
      style={{ display: 'flex', gap: 10 }}
      data-testid={`modifier-zones-${parent.id}`}
      data-split-enabled={enableAndOrSplit ? 'true' : 'false'}
      onDragOver={(e) => e.stopPropagation()}
    >
      {/* ── Sides column (legacy OR split) ── */}
      {sidesColumn}

      {/* ── Addons column ── */}
      <div className="modifier-section" style={{ flex: 1, minWidth: 0 }}>
        <div className="modifier-section-header modifier-section-header--addons">
          <span className="modifier-section-title">Add-ons</span>
          {addons.length > 0 && <span className="modifier-section-count">{addons.length}</span>}
        </div>
        <p className="modifier-section-hint">Drag add-on items here to link them to this dish</p>
        <div
          data-testid={`addons-drop-zone-${parent.id}`}
          className={`modifier-drop-zone${addonsDragOver ? ' drag-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setAddonsDragOver(true); }}
          onDragLeave={() => setAddonsDragOver(false)}
          onDrop={handleDropAddon}
        >
          {addons.length === 0 ? (
            <div className="modifier-drop-zone-empty">Drop add-ons here</div>
          ) : (
            addons.map((addon) => (
              <div key={addon.menu_item_id} className="modifier-card">
                <div className="modifier-card-thumb">
                  {addon.thumbnail_url ? (
                    <img src={addon.thumbnail_url} alt={addon.name} draggable={false} loading="lazy" width={60} height={60} />
                  ) : (
                    <span style={{ fontSize: 18 }}>➕</span>
                  )}
                </div>
                <div className="modifier-card-body">
                  <div className="modifier-card-name">{addon.name}</div>
                  {(itemsById.get(addon.menu_item_id)?.price ?? null) != null && (
                    <div className="modifier-card-price">+${itemsById.get(addon.menu_item_id)!.price!.toFixed(2)}</div>
                  )}
                </div>
                <button
                  type="button"
                  className="modifier-card-delete"
                  onClick={() => removeAddon(addon.menu_item_id)}
                  data-testid={`remove-addon-${parent.id}-${addon.menu_item_id}`}
                  title="Remove"
                >
                  <X size={11} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Recommendations column ── */}
      <div className="modifier-section" style={{ flex: 1, minWidth: 0 }}>
        <div className="modifier-section-header modifier-section-header--recommendations">
          <span className="modifier-section-title">Recommendations</span>
          {recommendations.length > 0 && <span className="modifier-section-count">{recommendations.length}</span>}
        </div>
        <p className="modifier-section-hint">Recommended dishes - shown on patron food cart</p>
        <div
          data-testid={`recommendations-drop-zone-${parent.id}`}
          className={`modifier-drop-zone${recommendationsDragOver ? ' drag-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setRecommendationsDragOver(true); }}
          onDragLeave={() => setRecommendationsDragOver(false)}
          onDrop={handleDropRecommendation}
        >
          {recommendations.length === 0 ? (
            <div className="modifier-drop-zone-empty">Drop items here</div>
          ) : (
            recommendations.map((rec) => {
              const inactive = isRecTargetInactive(rec.menu_item_id);
              return (
                <div
                  key={rec.menu_item_id}
                  className="modifier-card"
                  data-inactive={inactive ? 'true' : undefined}
                  data-testid={`recommendation-card-${parent.id}-${rec.menu_item_id}`}
                  // Inline border overrides the base .modifier-card stylesheet
                  // rule (1.5px grey) so the inactive state reads as "not
                  // reaching diners" at a glance. Title explains on hover.
                  style={inactive ? { border: `2px solid ${COLOR_ERROR}` } : undefined}
                  title={inactive ? 'This recommendation is not reaching diners — the target item is hidden or off-menu.' : undefined}
                >
                  <div className="modifier-card-thumb">
                    {rec.thumbnail_url ? (
                      <img src={rec.thumbnail_url} alt={rec.name} draggable={false} loading="lazy" width={60} height={60} />
                    ) : (
                      <span style={{ fontSize: 18 }}>🍽</span>
                    )}
                  </div>
                  <div className="modifier-card-body">
                    <div className="modifier-card-name">{rec.name}</div>
                  </div>
                  <button
                    type="button"
                    className="modifier-card-delete"
                    onClick={() => removeRecommendation(rec.menu_item_id)}
                    data-testid={`remove-recommendation-${parent.id}-${rec.menu_item_id}`}
                    title="Remove"
                  >
                    <X size={11} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

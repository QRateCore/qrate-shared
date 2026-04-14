'use client';
/**
 * Per-item Sides + Recommendations editor — rendered in the expanded dish row of the MenuBuilder.
 *
 * Two drop zones:
 *   - Sides (left)            — free or low-cost included extras; price_override defaults to null = "Free"
 *   - Recommendations (right) — complementary paired dishes; price pre-filled from base price
 *
 * Add-ons are managed per item in the Edit modal (Add-ons tab), not per-menu here.
 *
 * Persistence: PUT /owner/menu-items/{itemId}/modifiers via owner-restaurant-service.
 * State is lifted to the parent so optimistic updates flow through items[].
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import type { MenuItemDisplay } from '../../../types/restaurant';

export interface ModifierEntry {
  menu_item_id: string;
  name: string;
  price_override: number | null;
  thumbnail_url?: string | null;
}

interface Props {
  parent: MenuItemDisplay;
  itemsById: Map<string, MenuItemDisplay>;
  onUpdate: (
    parentId: string,
    next: {
      sides: ModifierEntry[];
      recommendations: ModifierEntry[];
      sides_selection_mode: 'and' | 'or';
    },
  ) => Promise<void>;
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
  onConfirmRecommendationDrop?: (item: MenuItemDisplay) => Promise<boolean>;
}

export default function ItemModifierZones({
  parent,
  itemsById,
  onUpdate,
  onConfirmRecommendationDrop,
}: Props) {
  const sides: ModifierEntry[] = (parent.sides ?? []) as ModifierEntry[];
  const recommendations: ModifierEntry[] = ((parent.recommendations ?? []) as ModifierEntry[]).map((r) => ({
    ...r,
    price_override: r.price_override ?? 0,
  }));
  const sidesSelectionMode: 'and' | 'or' = parent.sides_selection_mode ?? 'and';

  const [sidesDragOver, setSidesDragOver] = useState(false);
  const [recommendationsDragOver, setRecommendationsDragOver] = useState(false);

  const sideIds = new Set(sides.map((s) => s.menu_item_id));
  const recommendationIds = new Set(recommendations.map((r) => r.menu_item_id));

  function emit(
    nextSides: ModifierEntry[],
    nextRecommendations: ModifierEntry[],
    nextMode: 'and' | 'or' = sidesSelectionMode,
  ) {
    void onUpdate(parent.id, {
      sides: nextSides,
      recommendations: nextRecommendations,
      sides_selection_mode: nextMode,
    });
  }

  function parseDroppedId(raw: string): string {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed[0] : raw;
    } catch {
      return raw;
    }
  }

  // ── Sides handlers ───────────────────────────────────────────────────────────

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
    emit([...sides, next], recommendations);
  }

  function removeSide(id: string) {
    emit(sides.filter((s) => s.menu_item_id !== id), recommendations);
  }

  function updateSidePrice(id: string, raw: string) {
    const trimmed = raw.trim();
    const val = trimmed === '' ? null : parseFloat(trimmed);
    const safe = trimmed !== '' && Number.isNaN(val as number) ? null : val;
    emit(
      sides.map((s) => (s.menu_item_id === id ? { ...s, price_override: safe } : s)),
      recommendations,
    );
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
    if (onConfirmRecommendationDrop) {
      const proceed = await onConfirmRecommendationDrop(dropped);
      if (!proceed) return;
    }

    const next: ModifierEntry = {
      menu_item_id: dropped.id,
      name: dropped.name,
      price_override: dropped.price ?? 0,
      thumbnail_url: dropped.thumbnail_url ?? null,
    };
    emit(sides, [...recommendations, next]);
  }

  function removeRecommendation(id: string) {
    emit(sides, recommendations.filter((r) => r.menu_item_id !== id));
  }

  function updateRecommendationPrice(id: string, raw: string) {
    const trimmed = raw.trim();
    const val = trimmed === '' ? 0 : parseFloat(trimmed);
    const safe = Number.isNaN(val) ? 0 : val;
    emit(
      sides,
      recommendations.map((r) => (r.menu_item_id === id ? { ...r, price_override: safe } : r)),
    );
  }

  function changeSelectionMode(mode: 'and' | 'or') {
    emit(sides, recommendations, mode);
  }

  return (
    <div
      style={{ display: 'flex', gap: 10 }}
      data-testid={`modifier-zones-${parent.id}`}
      onDragOver={(e) => e.stopPropagation()}
    >
      {/* ── Sides column ── */}
      <div className="modifier-section" style={{ flex: 1, minWidth: 0 }}>
        <div className="modifier-section-header modifier-section-header--sides">
          <span className="modifier-section-title">Sides</span>
          <select
            value={sidesSelectionMode}
            onChange={(e) => changeSelectionMode(e.target.value as 'and' | 'or')}
            data-testid={`sides-selection-mode-${parent.id}`}
            style={{
              marginLeft: 8,
              padding: '2px 6px',
              fontSize: 11,
              fontWeight: 600,
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: sidesSelectionMode === 'or' ? '#fef3c7' : 'var(--bg2)',
              color: sidesSelectionMode === 'or' ? '#92400e' : 'var(--text2)',
              cursor: 'pointer',
            }}
          >
            <option value="and">AND</option>
            <option value="or">OR</option>
          </select>
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
            sides.map((side) => (
              <div key={side.menu_item_id} className="modifier-card">
                <div className="modifier-card-thumb">
                  {side.thumbnail_url ? (
                    <img src={side.thumbnail_url} alt={side.name} draggable={false} loading="lazy" width={60} height={60} />
                  ) : (
                    <span style={{ fontSize: 18 }}>🍽</span>
                  )}
                </div>
                <div className="modifier-card-body">
                  <div className="modifier-card-name">{side.name}</div>
                </div>
                <button
                  type="button"
                  className="modifier-card-delete"
                  onClick={() => removeSide(side.menu_item_id)}
                  data-testid={`remove-side-${parent.id}-${side.menu_item_id}`}
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
            recommendations.map((rec) => (
              <div key={rec.menu_item_id} className="modifier-card">
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
            ))
          )}
        </div>
      </div>
    </div>
  );
}

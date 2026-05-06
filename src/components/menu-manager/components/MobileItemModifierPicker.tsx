'use client';
/**
 * Mobile-only Sides + Recommendations editor for MenuItemRow.
 *
 * Replaces the desktop ItemModifierZones (two-column drag-and-drop) with a
 * stacked vertical layout that uses a small search-driven picker instead of
 * drop zones. Drag-and-drop is disabled on mobile, so this is the only way
 * to attach a side or recommendation on a phone.
 *
 * Layout:
 *   ┌── Sides ─────────────────────────┐
 *   │  AND/OR mode • count             │
 *   │  Existing sides (cards)          │
 *   │  [+ Add side]  → search picker   │
 *   └──────────────────────────────────┘
 *   ┌── Recommendations ──────────────┐
 *   │  count                           │
 *   │  Existing recommendations (cards)│
 *   │  [+ Add recommendation] → picker │
 *   └──────────────────────────────────┘
 *
 * Persistence is identical to ItemModifierZones — same `onUpdate` callback,
 * same payload shape, same backend endpoint. STR-251 mobile + camera (2026-04-08).
 */
import { useMemo, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import Select from '../../common/Select';
import type { MenuItemDisplay } from '../../../types/restaurant';
import type { ModifierEntry, ModifierUpdatePayload } from './ItemModifierZones';

interface Props {
  parent: MenuItemDisplay;
  itemsById: Map<string, MenuItemDisplay>;
  /** The menu currently being edited. Forwarded to `onConfirmRecommendationDrop`. */
  currentMenuId: string | null;
  /**
   * Persistence callback. Payload shape matches ItemModifierZones —
   * always includes BOTH legacy (`sides`, `sides_selection_mode`) AND
   * split (`sides_and`, `sides_or`) fields so the consumer can select
   * which subset to PATCH based on the flag.
   */
  onUpdate: (
    parentId: string,
    next: ModifierUpdatePayload,
  ) => Promise<void>;
  /** See ItemModifierZones for the contract — same gating applied to the
   *  mobile picker so the modal flow works on phones too. */
  onConfirmRecommendationDrop?: (item: MenuItemDisplay, menuId: string | null) => Promise<boolean>;
  /**
   * STR-342 feature flag. When true, the Sides section renders as two stacked
   * sub-sections ("Included" + "Choice") each with its own search picker, and
   * the AND/OR dropdown is hidden. Picker candidates filter out items already
   * in EITHER group, so cross-group duplicates are unreachable — no toast
   * callback is needed. When false/undefined, legacy single-section + dropdown
   * renders.
   */
  enableAndOrSplit?: boolean;
  /** When false, the Recommendations section is omitted. Default true.
   *  (Mobile picker has no Add-ons section, so there is no `showAddons` knob.) */
  showRecommendations?: boolean;
}

export default function MobileItemModifierPicker({
  parent,
  itemsById,
  currentMenuId,
  onUpdate,
  onConfirmRecommendationDrop,
  enableAndOrSplit = false,
  showRecommendations = true,
}: Props) {
  const sides: ModifierEntry[] = (parent.sides ?? []) as ModifierEntry[];
  const sidesAnd: ModifierEntry[] = (parent.sides_and ?? []) as ModifierEntry[];
  const sidesOr: ModifierEntry[] = (parent.sides_or ?? []) as ModifierEntry[];
  const recommendations: ModifierEntry[] = ((parent.recommendations ?? []) as ModifierEntry[]).map((r) => ({
    ...r,
    price_override: r.price_override ?? 0,
  }));
  const sidesSelectionMode: 'and' | 'or' = parent.sides_selection_mode ?? 'and';

  const [sidesPickerOpen, setSidesPickerOpen] = useState(false);
  const [sidesAndPickerOpen, setSidesAndPickerOpen] = useState(false);
  const [sidesOrPickerOpen, setSidesOrPickerOpen] = useState(false);
  const [recommendationsPickerOpen, setRecommendationsPickerOpen] = useState(false);
  const [sidesSearch, setSidesSearch] = useState('');
  const [sidesAndSearch, setSidesAndSearch] = useState('');
  const [sidesOrSearch, setSidesOrSearch] = useState('');
  const [recommendationsSearch, setRecommendationsSearch] = useState('');

  const sideIds = new Set(sides.map((s) => s.menu_item_id));
  const sidesAndIds = new Set(sidesAnd.map((s) => s.menu_item_id));
  const sidesOrIds = new Set(sidesOr.map((s) => s.menu_item_id));
  const recommendationIds = new Set(recommendations.map((r) => r.menu_item_id));

  // Candidates: every other item in the restaurant, minus the parent itself,
  // minus items already in the relevant section. Sorted alphabetically for
  // predictability.
  const allOtherItems = useMemo(
    () =>
      Array.from(itemsById.values())
        .filter((i) => i.id !== parent.id)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [itemsById, parent.id],
  );

  const sideCandidates = useMemo(() => {
    const q = sidesSearch.trim().toLowerCase();
    return allOtherItems.filter((i) => {
      if (sideIds.has(i.id)) return false;
      if (!q) return true;
      return i.name.toLowerCase().includes(q);
    });
  }, [allOtherItems, sideIds, sidesSearch]);

  // STR-342 — Included candidates: exclude items already in EITHER group
  // so the owner cannot accidentally duplicate across Included/Choice.
  const sidesAndCandidates = useMemo(() => {
    const q = sidesAndSearch.trim().toLowerCase();
    return allOtherItems.filter((i) => {
      if (sidesAndIds.has(i.id) || sidesOrIds.has(i.id)) return false;
      if (!q) return true;
      return i.name.toLowerCase().includes(q);
    });
  }, [allOtherItems, sidesAndIds, sidesOrIds, sidesAndSearch]);

  const sidesOrCandidates = useMemo(() => {
    const q = sidesOrSearch.trim().toLowerCase();
    return allOtherItems.filter((i) => {
      if (sidesAndIds.has(i.id) || sidesOrIds.has(i.id)) return false;
      if (!q) return true;
      return i.name.toLowerCase().includes(q);
    });
  }, [allOtherItems, sidesAndIds, sidesOrIds, sidesOrSearch]);

  const recommendationCandidates = useMemo(() => {
    const q = recommendationsSearch.trim().toLowerCase();
    return allOtherItems.filter((i) => {
      if (recommendationIds.has(i.id)) return false;
      if (!q) return true;
      return i.name.toLowerCase().includes(q);
    });
  }, [allOtherItems, recommendationIds, recommendationsSearch]);

  /**
   * Persist update. Payload always includes legacy fields (sides,
   * sides_selection_mode) AND split fields (sides_and, sides_or). Consumer
   * (MenuManagerClient) selects which subset to PATCH based on the flag.
   */
  function emit(overrides: Partial<ModifierUpdatePayload> = {}) {
    const payload: ModifierUpdatePayload = {
      sides,
      sides_and: sidesAnd,
      sides_or: sidesOr,
      recommendations,
      sides_selection_mode: sidesSelectionMode,
      ...overrides,
    };
    void onUpdate(parent.id, payload);
  }

  function addSide(item: MenuItemDisplay) {
    const next: ModifierEntry = {
      menu_item_id: item.id,
      name: item.name,
      price_override: null,
      thumbnail_url: item.thumbnail_url ?? null,
    };
    emit({ sides: [...sides, next] });
    setSidesSearch('');
    setSidesPickerOpen(false);
  }

  function addSideAnd(item: MenuItemDisplay) {
    const next: ModifierEntry = {
      menu_item_id: item.id,
      name: item.name,
      price_override: null,
      thumbnail_url: item.thumbnail_url ?? null,
    };
    emit({ sides_and: [...sidesAnd, next] });
    setSidesAndSearch('');
    setSidesAndPickerOpen(false);
  }

  function addSideOr(item: MenuItemDisplay) {
    const next: ModifierEntry = {
      menu_item_id: item.id,
      name: item.name,
      price_override: null,
      thumbnail_url: item.thumbnail_url ?? null,
    };
    emit({ sides_or: [...sidesOr, next] });
    setSidesOrSearch('');
    setSidesOrPickerOpen(false);
  }

  async function addRecommendation(item: MenuItemDisplay) {
    // Optional gate — parent may prompt before accepting (e.g., "which
    // canonical categories?" for off-menu items). Mirrors ItemModifierZones.
    let hookHandledAdd = false;
    if (onConfirmRecommendationDrop) {
      const proceed = await onConfirmRecommendationDrop(item, currentMenuId);
      if (!proceed) return;
      hookHandledAdd = true;
    }
    const next: ModifierEntry = {
      menu_item_id: item.id,
      name: item.name,
      price_override: item.price ?? 0,
      thumbnail_url: item.thumbnail_url ?? null,
    };
    emit({
      recommendations: [...recommendations, next],
      ...(hookHandledAdd ? { _hookHandledItemIds: [item.id] } : {}),
    });
    setRecommendationsSearch('');
    setRecommendationsPickerOpen(false);
  }

  function removeSide(id: string) {
    emit({ sides: sides.filter((s) => s.menu_item_id !== id) });
  }

  function removeSideAnd(id: string) {
    emit({ sides_and: sidesAnd.filter((s) => s.menu_item_id !== id) });
  }

  function removeSideOr(id: string) {
    emit({ sides_or: sidesOr.filter((s) => s.menu_item_id !== id) });
  }

  function removeRecommendation(id: string) {
    emit({ recommendations: recommendations.filter((r) => r.menu_item_id !== id) });
  }

  function updateSidePrice(id: string, raw: string) {
    const trimmed = raw.trim();
    const val = trimmed === '' ? null : parseFloat(trimmed);
    const safe = trimmed !== '' && Number.isNaN(val as number) ? null : val;
    emit({
      sides: sides.map((s) => (s.menu_item_id === id ? { ...s, price_override: safe } : s)),
    });
  }

  function updateSideAndPrice(id: string, raw: string) {
    const trimmed = raw.trim();
    const val = trimmed === '' ? null : parseFloat(trimmed);
    const safe = trimmed !== '' && Number.isNaN(val as number) ? null : val;
    emit({
      sides_and: sidesAnd.map((s) => (s.menu_item_id === id ? { ...s, price_override: safe } : s)),
    });
  }

  function updateSideOrPrice(id: string, raw: string) {
    const trimmed = raw.trim();
    const val = trimmed === '' ? null : parseFloat(trimmed);
    const safe = trimmed !== '' && Number.isNaN(val as number) ? null : val;
    emit({
      sides_or: sidesOr.map((s) => (s.menu_item_id === id ? { ...s, price_override: safe } : s)),
    });
  }

  function updateRecommendationPrice(id: string, raw: string) {
    const trimmed = raw.trim();
    const val = trimmed === '' ? 0 : parseFloat(trimmed);
    const safe = Number.isNaN(val) ? 0 : val;
    emit({
      recommendations: recommendations.map((r) => (r.menu_item_id === id ? { ...r, price_override: safe } : r)),
    });
  }

  function changeSelectionMode(mode: 'and' | 'or') {
    emit({ sides_selection_mode: mode });
  }

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
      data-testid={`mobile-modifier-picker-${parent.id}`}
      data-split-enabled={enableAndOrSplit ? 'true' : 'false'}
    >
      {/* ── Sides section (flag OFF — legacy) ── */}
      {!enableAndOrSplit && (
        <div className="modifier-section">
          <div className="modifier-section-header modifier-section-header--sides">
            <span className="modifier-section-title">Sides</span>
            <Select
              size="sm"
              value={sidesSelectionMode}
              onChange={(e) => changeSelectionMode(e.target.value as 'and' | 'or')}
              data-testid={`mobile-sides-mode-${parent.id}`}
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

          {/* Existing sides as cards */}
          {sides.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
              {sides.map((side) => (
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
                    <div className="modifier-card-price-row">
                      <span className="modifier-card-price-symbol">$</span>
                      <input
                        className="modifier-card-price-input"
                        type="number"
                        defaultValue={side.price_override ?? ''}
                        placeholder="Free"
                        aria-label="Side price"
                        min="0"
                        step="0.01"
                        onBlur={(e) => updateSidePrice(side.menu_item_id, e.target.value)}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    className="modifier-card-delete"
                    onClick={() => removeSide(side.menu_item_id)}
                    data-testid={`mobile-remove-side-${parent.id}-${side.menu_item_id}`}
                    title="Remove"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add side picker */}
          {sidesPickerOpen ? (
            <SearchPicker
              search={sidesSearch}
              onSearchChange={setSidesSearch}
              candidates={sideCandidates}
              onPick={addSide}
              onCancel={() => {
                setSidesSearch('');
                setSidesPickerOpen(false);
              }}
              testIdPrefix={`mobile-sides-picker-${parent.id}`}
            />
          ) : (
            <button
              type="button"
              onClick={() => setSidesPickerOpen(true)}
              data-testid={`mobile-add-side-${parent.id}`}
              style={addModifierBtnStyle}
            >
              <Plus size={12} />
              Add side
            </button>
          )}
        </div>
      )}

      {/* ── Sides split section (flag ON — STR-342) ── */}
      {enableAndOrSplit && (
        <>
          {/* Included (AND) — always-free with dish */}
          <div className="modifier-section" data-testid={`mobile-sides-included-section-${parent.id}`}>
            <div className="modifier-section-header modifier-section-header--sides">
              <span className="modifier-section-title">Includes All</span>
              {sidesAnd.length > 0 && <span className="modifier-section-count">{sidesAnd.length}</span>}
            </div>
            <p className="modifier-section-hint">Always included with this dish (Free of Cost)</p>

            {sidesAnd.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                {sidesAnd.map((side) => (
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
                      <div className="modifier-card-price-row">
                        <span className="modifier-card-price-symbol">$</span>
                        <input
                          className="modifier-card-price-input"
                          type="number"
                          defaultValue={side.price_override ?? ''}
                          placeholder="Free"
                          aria-label="Included side price"
                          min="0"
                          step="0.01"
                          onBlur={(e) => updateSideAndPrice(side.menu_item_id, e.target.value)}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      className="modifier-card-delete"
                      onClick={() => removeSideAnd(side.menu_item_id)}
                      data-testid={`mobile-remove-sides-and-${parent.id}-${side.menu_item_id}`}
                      title="Remove"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {sidesAndPickerOpen ? (
              <SearchPicker
                search={sidesAndSearch}
                onSearchChange={setSidesAndSearch}
                candidates={sidesAndCandidates}
                onPick={addSideAnd}
                onCancel={() => {
                  setSidesAndSearch('');
                  setSidesAndPickerOpen(false);
                }}
                testIdPrefix={`mobile-sides-and-picker-${parent.id}`}
              />
            ) : (
              <button
                type="button"
                onClick={() => setSidesAndPickerOpen(true)}
                data-testid={`mobile-add-sides-and-${parent.id}`}
                style={addModifierBtnStyle}
              >
                <Plus size={12} />
                Add included side
              </button>
            )}
          </div>

          {/* Choice (OR) — patron picks one */}
          <div className="modifier-section" data-testid={`mobile-sides-choice-section-${parent.id}`}>
            <div className="modifier-section-header modifier-section-header--sides" style={{ background: '#fef3c7', color: '#92400e' }}>
              <span className="modifier-section-title">Includes one by choice</span>
              {sidesOr.length > 0 && <span className="modifier-section-count">{sidesOr.length}</span>}
            </div>
            <p className="modifier-section-hint">Patron picks ONE of these (Free of Cost)</p>

            {sidesOr.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                {sidesOr.map((side) => (
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
                      <div className="modifier-card-price-row">
                        <span className="modifier-card-price-symbol">$</span>
                        <input
                          className="modifier-card-price-input"
                          type="number"
                          defaultValue={side.price_override ?? ''}
                          placeholder="Free"
                          aria-label="Choice side price"
                          min="0"
                          step="0.01"
                          onBlur={(e) => updateSideOrPrice(side.menu_item_id, e.target.value)}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      className="modifier-card-delete"
                      onClick={() => removeSideOr(side.menu_item_id)}
                      data-testid={`mobile-remove-sides-or-${parent.id}-${side.menu_item_id}`}
                      title="Remove"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {sidesOrPickerOpen ? (
              <SearchPicker
                search={sidesOrSearch}
                onSearchChange={setSidesOrSearch}
                candidates={sidesOrCandidates}
                onPick={addSideOr}
                onCancel={() => {
                  setSidesOrSearch('');
                  setSidesOrPickerOpen(false);
                }}
                testIdPrefix={`mobile-sides-or-picker-${parent.id}`}
              />
            ) : (
              <button
                type="button"
                onClick={() => setSidesOrPickerOpen(true)}
                data-testid={`mobile-add-sides-or-${parent.id}`}
                style={addModifierBtnStyle}
              >
                <Plus size={12} />
                Add choice side
              </button>
            )}
          </div>
        </>
      )}

      {/* ── Recommendations section ── */}
      {showRecommendations && (
      <div className="modifier-section">
        <div className="modifier-section-header modifier-section-header--recommendations">
          <span className="modifier-section-title">Recommendations</span>
          {recommendations.length > 0 && <span className="modifier-section-count">{recommendations.length}</span>}
        </div>
        <p className="modifier-section-hint">Recommended dishes - shown on patron food cart</p>

        {recommendations.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
            {recommendations.map((rec) => (
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
                  <div className="modifier-card-price-row">
                    <span className="modifier-card-price-symbol">$</span>
                    <input
                      className="modifier-card-price-input"
                      type="number"
                      defaultValue={rec.price_override ?? 0}
                      aria-label="Recommendation price"
                      min="0"
                      step="0.01"
                      onBlur={(e) => updateRecommendationPrice(rec.menu_item_id, e.target.value)}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="modifier-card-delete"
                  onClick={() => removeRecommendation(rec.menu_item_id)}
                  data-testid={`mobile-remove-recommendation-${parent.id}-${rec.menu_item_id}`}
                  title="Remove"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        {recommendationsPickerOpen ? (
          <SearchPicker
            search={recommendationsSearch}
            onSearchChange={setRecommendationsSearch}
            candidates={recommendationCandidates}
            onPick={addRecommendation}
            onCancel={() => {
              setRecommendationsSearch('');
              setRecommendationsPickerOpen(false);
            }}
            testIdPrefix={`mobile-recommendations-picker-${parent.id}`}
          />
        ) : (
          <button
            type="button"
            onClick={() => setRecommendationsPickerOpen(true)}
            data-testid={`mobile-add-recommendation-${parent.id}`}
            style={addModifierBtnStyle}
          >
            <Plus size={12} />
            Add recommendation
          </button>
        )}
      </div>
      )}
    </div>
  );
}

// ── SearchPicker ─────────────────────────────────────────────────────────────

interface SearchPickerProps {
  search: string;
  onSearchChange: (s: string) => void;
  candidates: MenuItemDisplay[];
  onPick: (item: MenuItemDisplay) => void;
  onCancel: () => void;
  testIdPrefix: string;
}

function SearchPicker({
  search,
  onSearchChange,
  candidates,
  onPick,
  onCancel,
  testIdPrefix,
}: SearchPickerProps) {
  return (
    <div
      data-testid={testIdPrefix}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: '#fafafa',
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {/* Search row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          background: 'white',
          border: '1px solid var(--border)',
          borderRadius: 6,
        }}
      >
        <Search size={12} color="var(--text2)" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search items…"
          autoFocus
          data-testid={`${testIdPrefix}-search`}
          style={{
            border: 'none',
            outline: 'none',
            fontSize: 12,
            flex: 1,
            background: 'transparent',
            color: 'var(--text)',
          }}
        />
        <button
          type="button"
          onClick={onCancel}
          data-testid={`${testIdPrefix}-cancel`}
          aria-label="Cancel"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text2)',
            display: 'flex',
            alignItems: 'center',
            padding: 2,
          }}
        >
          <X size={12} />
        </button>
      </div>

      {/* Candidate list */}
      <div
        style={{
          maxHeight: 220,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {candidates.length === 0 ? (
          <div
            style={{
              padding: '12px 8px',
              fontSize: 11,
              color: 'var(--text2)',
              fontStyle: 'italic',
              textAlign: 'center',
            }}
            data-testid={`${testIdPrefix}-empty`}
          >
            {search.trim() ? 'No items match' : 'No items available'}
          </div>
        ) : (
          candidates.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onPick(item)}
              data-testid={`${testIdPrefix}-option-${item.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                background: 'white',
                border: '1px solid var(--border)',
                borderRadius: 6,
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 4,
                  background: '#f0f0f0',
                  flexShrink: 0,
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 14,
                }}
              >
                {item.thumbnail_url ? (
                  <img
                    src={item.thumbnail_url}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  '🍽'
                )}
              </div>
              <span
                style={{
                  flex: 1,
                  fontSize: 12,
                  color: 'var(--text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={item.name}
              >
                {item.name}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

const addModifierBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '8px 12px',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--blue, #2563eb)',
  background: 'white',
  border: '1px dashed var(--blue, #2563eb)',
  borderRadius: 8,
  cursor: 'pointer',
  width: '100%',
};

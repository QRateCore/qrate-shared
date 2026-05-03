'use client';
/**
 * Per-item modifier editor — rendered in the expanded dish row of the MenuBuilder.
 *
 * Two modes (preserved post-BYO PDD Step 6 refactor — visible behaviour unchanged):
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
 * BYO PDD Step 6: each drop zone is now rendered by the generic `<GroupZone>`
 * component. Card rendering stays in this file for now — addons show price,
 * recs have a red border for inactive targets, sides are simple. Step 7 will
 * collapse remaining specifics into per-grouping render hooks once custom
 * groupings ship.
 *
 * Persistence: PUT /owner/menu-items/{itemId}/modifiers via owner-restaurant-service.
 * State is lifted to the parent so optimistic updates flow through items[].
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import {
  COLOR_WARNING,
  COLOR_WARNING_BG,
  COLOR_WARNING_BG_SM,
  COLOR_WARNING_TEXT,
  COLOR_ERROR,
} from '../../../constants/colors';
import GroupZone from './GroupZone';
import GroupActionsMenu from './GroupActionsMenu';
import SelectionRuleEditor from './SelectionRuleEditor';
import AddGroupingButton from './AddGroupingButton';
import type { Grouping, MenuItemDisplay, SelectionRule } from '../../../types/restaurant';

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

/**
 * BYO PDD Step 7 — bundle of optional callbacks for grouping authoring.
 * When provided, the editor renders the [⋮] action menu, rule pill, and
 * [+ Add grouping] affordances. When omitted, the editor is read-only for
 * those affordances (current behaviour preserved).
 */
export interface BYOHandlers {
  onCreateCustomGrouping: (parentItemId: string, body: { name: string; rule: SelectionRule }) => Promise<void>;
  onRenameGrouping: (groupingId: string, name: string) => Promise<void>;
  onUpdateGroupingRule: (groupingId: string, rule: SelectionRule) => Promise<void>;
  onDeleteGrouping: (groupingId: string) => Promise<void>;
  onAddCustomGroupingItem: (groupingId: string, droppedItemId: string) => Promise<void>;
  onRemoveCustomGroupingItem: (groupingItemId: string) => Promise<void>;
}

interface Props {
  parent: MenuItemDisplay;
  itemsById: Map<string, MenuItemDisplay>;
  currentMenuId: string | null;
  onUpdate: (parentId: string, next: ModifierUpdatePayload) => Promise<void>;
  onConfirmRecommendationDrop?: (item: MenuItemDisplay, menuId: string | null) => Promise<boolean>;
  enableAndOrSplit?: boolean;
  onCrossGroupDuplicate?: (existingGroup: 'included' | 'choice') => void;
  /** BYO authoring callbacks — when present, BYO affordances render. */
  byoHandlers?: BYOHandlers;
}

export default function ItemModifierZones({
  parent,
  itemsById,
  currentMenuId,
  onUpdate,
  onConfirmRecommendationDrop,
  enableAndOrSplit = false,
  onCrossGroupDuplicate,
  byoHandlers,
}: Props) {
  const onCreateCustomGrouping = byoHandlers?.onCreateCustomGrouping;
  const onRenameGrouping = byoHandlers?.onRenameGrouping;
  const onUpdateGroupingRule = byoHandlers?.onUpdateGroupingRule;
  const onDeleteGrouping = byoHandlers?.onDeleteGrouping;
  const onAddCustomGroupingItem = byoHandlers?.onAddCustomGroupingItem;
  const onRemoveCustomGroupingItem = byoHandlers?.onRemoveCustomGroupingItem;

  // BYO PDD Step 7 — inline rename state (one grouping at a time).
  const [renamingGroupingId, setRenamingGroupingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string>('');
  const sides: ModifierEntry[] = (parent.sides ?? []) as ModifierEntry[];
  const sidesSelectionMode: 'and' | 'or' = parent.sides_selection_mode ?? 'and';
  const sidesAnd: ModifierEntry[] = (parent.sides_and ?? []) as ModifierEntry[];
  const sidesOr: ModifierEntry[] = (parent.sides_or ?? []) as ModifierEntry[];

  const recommendations: ModifierEntry[] = ((parent.recommendations ?? []) as ModifierEntry[]).map((r) => ({
    ...r,
    price_override: r.price_override ?? 0,
  }));
  const addons: ModifierEntry[] = ((parent.addons ?? []) as Array<{
    menu_item_id: string;
    name: string;
    price_override: number | null;
    thumbnail_url?: string | null;
    status?: string;
  }>)
    .filter((a) => (a.status === 'approved' || a.status === undefined) && itemsById.has(a.menu_item_id))
    .map((a) => ({
      menu_item_id: a.menu_item_id,
      name: a.name,
      price_override: a.price_override ?? null,
      thumbnail_url: a.thumbnail_url ?? null,
    }));

  // BYO PDD Step 6 — derive grouping IDs from parent.groupings if available
  // (ensures GroupZone test IDs match the new groupings model when the
  // backend has populated them). Falls back to a synthetic kind-based ID
  // for items that haven't been hydrated yet.
  function groupingIdForKind(kind: 'addons' | 'sides_and' | 'sides_or' | 'recommendations' | 'sides'): string {
    const groupings = parent.groupings ?? [];
    // 'sides' is a legacy combined view — no canonical default kind in the
    // unified model; key it on the parent ID for the test ID.
    if (kind === 'sides') return `legacy-sides-${parent.id}`;
    const found = groupings.find((g) => g.kind === kind);
    return found?.id ?? `default-${kind}-${parent.id}`;
  }

  const sideIds = new Set(sides.map((s) => s.menu_item_id));
  const sidesAndIds = new Set(sidesAnd.map((s) => s.menu_item_id));
  const sidesOrIds = new Set(sidesOr.map((s) => s.menu_item_id));
  const addonIds = new Set(addons.map((a) => a.menu_item_id));
  const recommendationIds = new Set(recommendations.map((r) => r.menu_item_id));

  function isRecTargetInactive(targetId: string): boolean {
    const target = itemsById.get(targetId);
    if (!target) return true;
    if (target.active === false) return true;
    if (!target.menu_associations || target.menu_associations.length === 0) return true;
    return false;
  }

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

  function parseDroppedIds(raw: string): string[] {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((id): id is string => typeof id === 'string');
      return typeof parsed === 'string' ? [parsed] : [raw];
    } catch {
      return raw ? [raw] : [];
    }
  }

  // ── Drop handlers (one per kind) ──────────────────────────────────────────

  function handleDropSide(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const droppedIds = parseDroppedIds(e.dataTransfer.getData('text/plain'));
    const newSides: ModifierEntry[] = [];
    for (const id of droppedIds) {
      if (id === parent.id || sideIds.has(id)) continue;
      const dropped = itemsById.get(id);
      if (!dropped || dropped.item_type === 'addon') continue;
      newSides.push({
        menu_item_id: dropped.id,
        name: dropped.name,
        price_override: null,
        thumbnail_url: dropped.thumbnail_url ?? null,
      });
    }
    if (newSides.length > 0) emit({ sides: [...sides, ...newSides] });
  }

  function handleDropSidesAnd(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const droppedIds = parseDroppedIds(e.dataTransfer.getData('text/plain'));
    let hasCrossGroup = false;
    const newEntries: ModifierEntry[] = [];
    for (const id of droppedIds) {
      if (id === parent.id || sidesAndIds.has(id)) continue;
      if (sidesOrIds.has(id)) {
        hasCrossGroup = true;
        continue;
      }
      const dropped = itemsById.get(id);
      if (!dropped || dropped.item_type === 'addon') continue;
      newEntries.push({
        menu_item_id: dropped.id,
        name: dropped.name,
        price_override: null,
        thumbnail_url: dropped.thumbnail_url ?? null,
      });
    }
    if (hasCrossGroup) onCrossGroupDuplicate?.('choice');
    if (newEntries.length > 0) emit({ sides_and: [...sidesAnd, ...newEntries] });
  }

  function handleDropSidesOr(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const droppedIds = parseDroppedIds(e.dataTransfer.getData('text/plain'));
    let hasCrossGroup = false;
    const newEntries: ModifierEntry[] = [];
    for (const id of droppedIds) {
      if (id === parent.id || sidesOrIds.has(id)) continue;
      if (sidesAndIds.has(id)) {
        hasCrossGroup = true;
        continue;
      }
      const dropped = itemsById.get(id);
      if (!dropped || dropped.item_type === 'addon') continue;
      newEntries.push({
        menu_item_id: dropped.id,
        name: dropped.name,
        price_override: null,
        thumbnail_url: dropped.thumbnail_url ?? null,
      });
    }
    if (hasCrossGroup) onCrossGroupDuplicate?.('included');
    if (newEntries.length > 0) emit({ sides_or: [...sidesOr, ...newEntries] });
  }

  function handleDropAddon(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const droppedIds = parseDroppedIds(e.dataTransfer.getData('text/plain'));
    const newAddons: ModifierEntry[] = [];
    for (const id of droppedIds) {
      if (id === parent.id || addonIds.has(id)) continue;
      const dropped = itemsById.get(id);
      if (!dropped || dropped.item_type !== 'addon') continue;
      newAddons.push({
        menu_item_id: dropped.id,
        name: dropped.name,
        price_override: dropped.price ?? null,
        thumbnail_url: dropped.thumbnail_url ?? null,
      });
    }
    if (newAddons.length > 0) emit({ addons: [...addons, ...newAddons] });
  }

  async function handleDropRecommendation(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const droppedIds = parseDroppedIds(e.dataTransfer.getData('text/plain'));
    const newRecs: ModifierEntry[] = [];
    const hookHandledIds: string[] = [];
    for (const id of droppedIds) {
      if (id === parent.id || recommendationIds.has(id)) continue;
      const dropped = itemsById.get(id);
      if (!dropped || dropped.item_type === 'addon') continue;
      if (onConfirmRecommendationDrop) {
        const proceed = await onConfirmRecommendationDrop(dropped, currentMenuId);
        if (!proceed) continue;
        hookHandledIds.push(dropped.id);
      }
      newRecs.push({
        menu_item_id: dropped.id,
        name: dropped.name,
        price_override: dropped.price ?? 0,
        thumbnail_url: dropped.thumbnail_url ?? null,
      });
    }
    if (newRecs.length > 0) {
      emit({
        recommendations: [...recommendations, ...newRecs],
        ...(hookHandledIds.length > 0 ? { _hookHandledItemIds: hookHandledIds } : {}),
      });
    }
  }

  // ── Remove handlers ──────────────────────────────────────────────────────

  const removeSide = (id: string) => emit({ sides: sides.filter((s) => s.menu_item_id !== id) });
  const removeSidesAnd = (id: string) => emit({ sides_and: sidesAnd.filter((s) => s.menu_item_id !== id) });
  const removeSidesOr = (id: string) => emit({ sides_or: sidesOr.filter((s) => s.menu_item_id !== id) });
  const removeAddon = (id: string) => emit({ addons: addons.filter((a) => a.menu_item_id !== id) });
  const removeRecommendation = (id: string) =>
    emit({ recommendations: recommendations.filter((r) => r.menu_item_id !== id) });
  const changeSelectionMode = (mode: 'and' | 'or') => emit({ sides_selection_mode: mode });

  // ── Card renderers (per-group specifics preserved) ───────────────────────

  function renderSimpleCard(entry: ModifierEntry, onRemove: () => void, testIdPrefix: string) {
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

  function renderAddonCard(addon: ModifierEntry) {
    const itemPrice = itemsById.get(addon.menu_item_id)?.price ?? null;
    return (
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
          {itemPrice != null && <div className="modifier-card-price">+${itemPrice.toFixed(2)}</div>}
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
    );
  }

  function renderRecommendationCard(rec: ModifierEntry) {
    const inactive = isRecTargetInactive(rec.menu_item_id);
    return (
      <div
        key={rec.menu_item_id}
        className="modifier-card"
        data-inactive={inactive ? 'true' : undefined}
        data-testid={`recommendation-card-${parent.id}-${rec.menu_item_id}`}
        style={inactive ? { border: `2px solid ${COLOR_ERROR}` } : undefined}
        title={
          inactive
            ? 'This recommendation is not reaching diners — the target item is hidden or off-menu.'
            : undefined
        }
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
  }

  // ── BYO authoring affordances — header extras per grouping (Step 7) ────

  const byoAuthoringEnabled = !!(
    onRenameGrouping && onUpdateGroupingRule && onDeleteGrouping
  );

  function commitRename(groupingId: string) {
    const next = renameDraft.trim();
    setRenamingGroupingId(null);
    if (!onRenameGrouping || !next || next.length === 0) return;
    void onRenameGrouping(groupingId, next);
  }

  /**
   * Build the rule-pill + ⋮-menu pair shown in a default grouping's header.
   * `kind` lookup finds the grouping in parent.groupings; if missing (not yet
   * hydrated), affordances are skipped for that zone.
   */
  function renderHeaderExtras(opts: {
    grouping: Grouping | undefined;
    isDeletable: boolean;
    showRulePill: boolean;
  }) {
    if (!byoAuthoringEnabled || !opts.grouping) return null;
    const g = opts.grouping;
    const rule: SelectionRule = {
      min_select: g.min_select,
      max_select: g.max_select,
      default_select: g.default_select,
    };
    return (
      <>
        {opts.showRulePill ? (
          <SelectionRuleEditor
            rule={rule}
            memberCount={g.items?.length ?? 0}
            testIdPrefix={`rule-pill-${g.id}`}
            onSave={async (next) => {
              if (onUpdateGroupingRule) await onUpdateGroupingRule(g.id, next);
            }}
          />
        ) : null}
        <GroupActionsMenu
          isDeletable={opts.isDeletable}
          testIdPrefix={`group-actions-${g.id}`}
          onRenameClick={() => {
            setRenamingGroupingId(g.id);
            setRenameDraft(g.name);
          }}
          onChangeRuleClick={() => {
            // Rule editor pill IS the change-rule entry point — clicking the
            // ⋮ menu's "Change rule" simulates a click on the rule pill so
            // the popover opens. Implementation: scroll the pill into view
            // and trigger its open; for now, no-op (rule pill is always
            // visible alongside the menu, so the menu item is redundant
            // but kept for discoverability).
          }}
          onDeleteClick={() => {
            if (onDeleteGrouping && opts.isDeletable) {
              if (typeof window !== 'undefined') {
                const ok = window.confirm(`Delete grouping "${g.name}"? This removes all members.`);
                if (!ok) return;
              }
              void onDeleteGrouping(g.id);
            }
          }}
        />
      </>
    );
  }

  /**
   * Inline rename input — replaces the title when the owner clicks Rename.
   */
  function renderTitleOverride(grouping: Grouping | undefined): React.ReactNode | undefined {
    if (!grouping || renamingGroupingId !== grouping.id) return undefined;
    return (
      <input
        autoFocus
        type="text"
        value={renameDraft}
        onChange={(e) => setRenameDraft(e.target.value)}
        onBlur={() => commitRename(grouping.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitRename(grouping.id);
          } else if (e.key === 'Escape') {
            setRenamingGroupingId(null);
          }
        }}
        data-testid={`rename-input-${grouping.id}`}
        style={{
          fontSize: 13,
          padding: '2px 6px',
          border: '1px solid #cbd5e1',
          borderRadius: 4,
          fontFamily: 'inherit',
          fontWeight: 600,
        }}
      />
    );
  }

  function lookupGrouping(kind: 'addons' | 'sides_and' | 'sides_or' | 'recommendations'): Grouping | undefined {
    return (parent.groupings ?? []).find((g) => g.kind === kind);
  }

  const customGroupings = (parent.groupings ?? []).filter(
    (g) => g.kind === null && g.is_default === false,
  );

  // ── Sides column (legacy single zone OR split 2-box) ─────────────────────

  const sidesAndGrouping = lookupGrouping('sides_and');
  const sidesOrGrouping = lookupGrouping('sides_or');
  const addonsGrouping = lookupGrouping('addons');
  const recsGrouping = lookupGrouping('recommendations');

  const sidesColumn = enableAndOrSplit ? (
    <div className="modifier-section" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <GroupZone
        kind="sides_and"
        groupingId={groupingIdForKind('sides_and')}
        parentItemId={parent.id}
        title={sidesAndGrouping?.name ?? 'Includes All'}
        hint="All of these come with the dish (free of charge)"
        count={sidesAnd.length}
        emptyText="Drop included sides here"
        onDrop={handleDropSidesAnd}
        legacyTestIdPrefix="sides-and-drop-zone"
        titleOverride={renderTitleOverride(sidesAndGrouping)}
        headerExtras={renderHeaderExtras({ grouping: sidesAndGrouping, isDeletable: false, showRulePill: true })}
      >
        {sidesAnd.map((side) =>
          renderSimpleCard(side, () => removeSidesAnd(side.menu_item_id), 'remove-sides-and'),
        )}
      </GroupZone>

      <GroupZone
        kind="sides_or"
        groupingId={groupingIdForKind('sides_or')}
        parentItemId={parent.id}
        title={sidesOrGrouping?.name ?? 'Includes one by choice'}
        hint="Patron picks one of these (free of charge)"
        count={sidesOr.length}
        emptyText="Drop choice sides here"
        onDrop={handleDropSidesOr}
        legacyTestIdPrefix="sides-or-drop-zone"
        paletteClassName="modifier-section-header--sides"
        headerStyle={{ background: COLOR_WARNING_BG, color: COLOR_WARNING_TEXT }}
        dragOverStyle={{ borderColor: COLOR_WARNING, background: COLOR_WARNING_BG_SM }}
        titleOverride={renderTitleOverride(sidesOrGrouping)}
        headerExtras={renderHeaderExtras({ grouping: sidesOrGrouping, isDeletable: false, showRulePill: true })}
      >
        {sidesOr.map((side) =>
          renderSimpleCard(side, () => removeSidesOr(side.menu_item_id), 'remove-sides-or'),
        )}
      </GroupZone>
    </div>
  ) : (
    <GroupZone
      kind="sides"
      groupingId={groupingIdForKind('sides')}
      parentItemId={parent.id}
      title="Sides"
      hint={
        sidesSelectionMode === 'or'
          ? "Patron can pick One side that's included (Free of Cost)"
          : 'Patron can pick Multiple sides that are included (Free of Cost)'
      }
      count={sides.length}
      emptyText="Drop items here"
      onDrop={handleDropSide}
      legacyTestIdPrefix="sides-drop-zone"
      selectionMode={{
        value: sidesSelectionMode,
        onChange: changeSelectionMode,
        options: [
          { value: 'and', label: 'AND' },
          { value: 'or', label: 'OR' },
        ],
        testId: `sides-selection-mode-${parent.id}`,
      }}
    >
      {sides.map((side) => renderSimpleCard(side, () => removeSide(side.menu_item_id), 'remove-side'))}
    </GroupZone>
  );

  return (
    <div
      style={{ display: 'flex', gap: 10 }}
      data-testid={`modifier-zones-${parent.id}`}
      data-split-enabled={enableAndOrSplit ? 'true' : 'false'}
      onDragOver={(e) => e.stopPropagation()}
    >
      {sidesColumn}

      <GroupZone
        kind="addons"
        groupingId={groupingIdForKind('addons')}
        parentItemId={parent.id}
        title={addonsGrouping?.name ?? 'Add-ons'}
        hint="Drag add-on items here to link them to this dish"
        count={addons.length}
        emptyText="Drop add-ons here"
        onDrop={handleDropAddon}
        legacyTestIdPrefix="addons-drop-zone"
        titleOverride={renderTitleOverride(addonsGrouping)}
        headerExtras={renderHeaderExtras({ grouping: addonsGrouping, isDeletable: false, showRulePill: true })}
      >
        {addons.map(renderAddonCard)}
      </GroupZone>

      <GroupZone
        kind="recommendations"
        groupingId={groupingIdForKind('recommendations')}
        parentItemId={parent.id}
        title={recsGrouping?.name ?? 'Recommendations'}
        hint="Recommended dishes - shown on patron food cart"
        count={recommendations.length}
        emptyText="Drop items here"
        onDrop={handleDropRecommendation}
        legacyTestIdPrefix="recommendations-drop-zone"
        titleOverride={renderTitleOverride(recsGrouping)}
        headerExtras={renderHeaderExtras({ grouping: recsGrouping, isDeletable: false, showRulePill: true })}
      >
        {recommendations.map(renderRecommendationCard)}
      </GroupZone>

      {/* BYO PDD Step 7 — custom (kind=null) groupings rendered after defaults */}
      {customGroupings.map((g) => {
        async function handleCustomDrop(e: React.DragEvent) {
          e.preventDefault();
          e.stopPropagation();
          if (!onAddCustomGroupingItem) return;
          const droppedIds = parseDroppedIds(e.dataTransfer.getData('text/plain'));
          for (const id of droppedIds) {
            if (id === parent.id) continue;
            await onAddCustomGroupingItem(g.id, id);
          }
        }
        return (
          <GroupZone
            key={g.id}
            kind="custom"
            groupingId={g.id}
            parentItemId={parent.id}
            title={g.name}
            hint=""
            count={g.items?.length ?? 0}
            emptyText="Drop items here"
            onDrop={handleCustomDrop}
            titleOverride={renderTitleOverride(g)}
            headerExtras={renderHeaderExtras({ grouping: g, isDeletable: g.is_deletable, showRulePill: true })}
          >
            {(g.items ?? []).map((item) => (
              <div key={item.id} className="modifier-card">
                <div className="modifier-card-thumb">
                  {item.thumbnail_url ? (
                    <img src={item.thumbnail_url} alt={item.name ?? ''} draggable={false} loading="lazy" width={60} height={60} />
                  ) : (
                    <span style={{ fontSize: 18 }}>🍽</span>
                  )}
                </div>
                <div className="modifier-card-body">
                  <div className="modifier-card-name">{item.name ?? '(unnamed)'}</div>
                </div>
                <button
                  type="button"
                  className="modifier-card-delete"
                  onClick={() => {
                    if (onRemoveCustomGroupingItem) void onRemoveCustomGroupingItem(item.id);
                  }}
                  data-testid={`remove-custom-${g.id}-${item.id}`}
                  title="Remove"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </GroupZone>
        );
      })}

      {/* BYO PDD Step 7 — `[+ Add grouping]` affordance, only when callback provided */}
      {onCreateCustomGrouping ? (
        <div style={{ flex: '0 0 auto', alignSelf: 'flex-start', marginTop: 6 }}>
          <AddGroupingButton
            onCreate={(body) => onCreateCustomGrouping(parent.id, body)}
            testIdPrefix={`add-grouping-${parent.id}`}
          />
        </div>
      ) : null}
    </div>
  );
}

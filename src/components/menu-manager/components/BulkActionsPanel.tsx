'use client';
import { useMenuManagerService } from '../context';
import { useTrackAction } from '../track-action-context';

import { useEffect, useState } from 'react';
import { X, Star, Zap, EyeOff, Eye, Trash2, MinusCircle, FolderMinus, PlusCircle, Flame, Leaf, Sparkles, Wand2, Layers, Layers2, Tag, Wine } from 'lucide-react';
import { BulkMemberPicker } from './BulkMemberPicker';
import type { MenuItemDisplay, MenuSummary, MenuAssociation, ServingOption } from '../../../types/restaurant';
import { CANONICAL_CATEGORIES, BOOST_LABELS, type BoostLabel } from '../lib/menuUtils';
import Select from '../../common/Select';
import RawCategorySelect from './RawCategorySelect';
import type { BulkMode } from '../MenuManagerClient';
import {
  DEFAULT_HEAT_LABELS,
  DEFAULT_HEAT_ICONS,
  DEFAULT_HEAT_BG,
  DEFAULT_HEAT_BORDER,
  DEFAULT_HEAT_COLOR,
  DEFAULT_SWEETNESS_LABELS,
  DEFAULT_SWEETNESS_ICONS,
  DEFAULT_SWEETNESS_BG,
  DEFAULT_SWEETNESS_BORDER,
  DEFAULT_SWEETNESS_COLOR,
} from '../../../constants/food-tags';
import { SWEETNESS_VISIBLE } from '../../../constants/feature-flags';

// ── Dietary & Spice constants ─────────────────────────────────────────────────
//
// Spice labels arrive from the consumer as a prop (`heatLabels`) so each
// restaurant's custom scale can be rendered. Icons/colors are looked up by
// position (index) from the shared default palette — renaming a label does
// NOT change which icon it gets.

// Canonical slugs — must match backend FDA_BIG_9 and CANONICAL_DIETARY sets exactly.
const FDA_BIG_9 = ['dairy', 'eggs', 'fish', 'shellfish', 'tree-nuts', 'peanuts', 'wheat', 'soy', 'sesame'] as const;
const DIETARY_RESTRICTIONS_LIST = ['vegetarian', 'vegan', 'gluten-free', 'kosher', 'halal'] as const;

const ALLERGEN_LABELS: Record<string, string> = {
  'dairy': 'Dairy', 'eggs': 'Eggs', 'fish': 'Fish', 'shellfish': 'Shellfish',
  'tree-nuts': 'Tree Nuts', 'peanuts': 'Peanuts', 'wheat': 'Wheat', 'soy': 'Soy', 'sesame': 'Sesame',
};
const DIETARY_LABELS: Record<string, string> = {
  'vegetarian': 'Vegetarian', 'vegan': 'Vegan', 'gluten-free': 'Gluten-Free', 'kosher': 'Kosher', 'halal': 'Halal',
};

/** Title-case a slug ("jain" → "Jain", "low-carb" → "Low Carb") for custom
 *  entries that aren't in the curated label maps. Mirrors EditModal.slugToLabel. */
function slugToBulkLabel(slug: string): string {
  return slug
    .split('-')
    .map((p) => (p.length > 0 ? p[0]!.toUpperCase() + p.slice(1) : p))
    .join(' ');
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface BulkActionsPanelProps {
  selected: Set<string>;
  items: MenuItemDisplay[];
  menus: MenuSummary[];
  initialMode: BulkMode;
  onClose: () => void;
  /** Called with the full updated items array after successful apply */
  onComplete: (updatedItems: MenuItemDisplay[], clearedIds: Set<string>) => void;
  /** Optional: bulk spice update — owner app wires this to the dietary-tags API */
  onBulkSpice?: (heatLabel: string, itemIds: string[]) => Promise<void>;
  /** Optional: bulk dietary/allergen tag add */
  onBulkDietary?: (tags: Array<{ name: string; type: 'allergen' | 'dietary' }>, itemIds: string[]) => Promise<void>;
  /**
   * Bulk-assign a raw scraped category label (→ menu_items.category_name) to
   * the selected items. Opt-in: when omitted, the Raw Category tab is hidden.
   * Called one item at a time (mirrors the spice/dietary fan-out); the empty
   * string clears the category to Uncategorized.
   */
  onBulkRawCategory?: (category: string, itemIds: string[]) => Promise<void>;
  /** Owner-created (possibly item-less) food categories — unioned into the Raw
   *  Category picker so freshly-created categories are selectable here too,
   *  matching the food-item EditModal (shared <RawCategorySelect>). */
  ownerFoodCategories?: string[];
  /** When set (Menu Builder only — a single-menu context), enables the
   *  "Remove from menu" action: bulk-removes the selected items' placement from
   *  THIS menu (they stay in the catalogue). Distinct from the destructive
   *  catalogue "Delete" (PDD 2026-06-12 #8). */
  currentMenuId?: string;
  currentMenuName?: string;
  /** Optional: bulk sweetness update — owner app wires this to the sweetness API */
  onBulkSweetness?: (label: string, itemIds: string[]) => Promise<void>;
  /**
   * Optional: bulk wine serving sizes (PDD 2026-06-15). Applies one owner-defined
   * set of serving options to every selected item. Opt-in — the "Serving sizes"
   * tab only appears when wired. The owner app implements this as a per-item
   * serving_options PATCH. An empty array clears serving sizes on the selection.
   */
  onBulkServingSizes?: (servingOptions: ServingOption[], itemIds: string[]) => Promise<void>;
  /**
   * Admin-only: bulk AI enrich. When provided, the panel surfaces an
   * Enrich tab (Wand2 icon). Calls the consumer's batch-enrich endpoint
   * with the selected item ids; chunking >100 items is the consumer's
   * responsibility (admin-webapp's MenuItemsTab wires this to
   * restaurantService.enrichMenuItemsBatch which chunks at 100).
   * Owner-webapp + waiter-webapp don't pass this — tab is hidden.
   */
  onBulkEnrich?: (itemIds: string[]) => Promise<{
    enriched: number; skipped: number; failed: number;
  }>;
  /**
   * PDD 2026-05-21 — bulk apply grouping. When provided, the panel surfaces
   * a Grouping tab (Layers icon) that creates one custom grouping per
   * selected parent (same name + rule + initial members). Throws
   * `BulkApplyGroupingConflictError` (owner-webapp side) on 409 NAME_CONFLICT
   * — the panel catches that specifically and renders an inline conflict
   * banner without closing. Other failures surface via the generic error
   * region. Owner-webapp wires this from the Food Item Library page;
   * admin/waiter don't pass it — tab is hidden.
   */
  onBulkApplyGrouping?: (
    itemIds: string[],
    body: {
      name: string;
      rule: { min_select: number; max_select: number | null; default_select: 'all' | 'none' | 'first' };
      members: Array<{ item_id: string; position?: number }>;
    },
  ) => Promise<void>;
  /**
   * PDD 2026-05-21 sibling — bulk REMOVE one grouping spec from N parents.
   * Throw-only contract: 409 PARTIAL_MISMATCH surfaces via an error whose
   * `.name === 'BulkRemoveGroupingMismatchError'` with a `.mismatches`
   * array. Other failures route to the generic error region. Owner-webapp
   * wires this from the Food Item Library page alongside
   * `loadGroupingsForItem` (both required to surface the tab).
   */
  onBulkRemoveGrouping?: (
    itemIds: string[],
    body: {
      name: string;
      rule: { min_select: number; max_select: number | null; default_select: 'all' | 'none' | 'first' };
      member_ids: string[];
    },
  ) => Promise<void>;
  /**
   * PDD 2026-05-21 sibling — used by the Remove grouping tab to discover
   * shared groupings across selected parents. The panel issues one call
   * per selected parent via `Promise.allSettled` on mount, intersects by
   * (name, rule, sorted-member-ids) hash, filters `is_default=true`, and
   * shows the surviving candidates as radio options. Owner-webapp wires
   * this to `ownerGroupingsService.listGroupings`.
   *
   * Also reused by the PDD 2026-05-22 Grouping tab's "Add to existing"
   * mode for the same intersection logic.
   */
  loadGroupingsForItem?: (itemId: string) => Promise<Array<{
    id: string;
    name: string;
    is_default: boolean;
    min_select: number;
    max_select: number | null;
    default_select: 'all' | 'none' | 'first';
    items?: Array<{ menu_item_id: string }>;
  }>>;
  /**
   * PDD 2026-05-22 — bulk ADD MEMBERS to a grouping shared across N parents.
   * Distinct from `onBulkApplyGrouping` (create-new) and
   * `onBulkRemoveGrouping` (remove). Same throw-only mismatch contract as
   * remove: 409 surfaces as an error whose
   * `.name === 'BulkAddMembersToGroupingMismatchError'` with a
   * `.mismatches` array. Other failures route to the generic error region.
   * Owner-webapp wires this from the Food Library page alongside
   * `loadGroupingsForItem`. When wired, the Grouping tab gains a mode
   * radio at the top: "Add to existing grouping" vs "Create new grouping".
   */
  onBulkAddMembersToGrouping?: (
    itemIds: string[],
    body: {
      name: string;
      rule: { min_select: number; max_select: number | null; default_select: 'all' | 'none' | 'first' };
      current_member_ids: string[];
    },
    newMemberIds: string[],
  ) => Promise<void>;
  /** Per-restaurant spice scale labels. Falls back to the default 5-level palette. */
  heatLabels?: string[];
  /** Per-restaurant sweetness scale labels. Falls back to the default 4-level palette. */
  sweetnessLabels?: string[];
  /** Per-restaurant custom allergens / dietary + effective canonical defaults
   *  (canonical minus hidden). When provided, the bulk Dietary tab's pill
   *  picker matches the EditModal / Food Items page: custom entries appear and
   *  hidden defaults (e.g. kosher/halal) drop out. Omitted → hardcoded
   *  FDA-9 / canonical-5 fallback. */
  customAllergens?: string[];
  customDietary?: string[];
  allergenDefaults?: string[];
  dietaryDefaults?: string[];
}

// ── Mode config ───────────────────────────────────────────────────────────────

const MODES: { key: BulkMode; label: string; icon: React.ReactNode }[] = [
  { key: 'assign',       label: 'Assign',       icon: <PlusCircle size={13} /> },
  { key: 'remove',       label: 'Remove',       icon: <MinusCircle size={13} /> },
  { key: 'boost',        label: 'Boost',        icon: <Zap size={13} /> },
  { key: 'special',      label: 'Special',      icon: <Star size={13} /> },
  { key: 'availability', label: 'Availability', icon: <Eye size={13} /> },
  { key: 'spice',        label: 'Spice',        icon: <Flame size={13} /> },
  { key: 'spiceModifier', label: 'Spice modifier', icon: <Flame size={13} /> },
  { key: 'spiceRequired', label: 'Spice requirement', icon: <Flame size={13} /> },
  // Sweetness mode gated behind SWEETNESS_VISIBLE per STR-480.
  ...(SWEETNESS_VISIBLE
    ? [{ key: 'sweetness' as BulkMode, label: 'Sweetness', icon: <Sparkles size={13} /> }]
    : []),
  { key: 'dietary',      label: 'Dietary',      icon: <Leaf size={13} /> },
  // Raw Category mode is opt-in via the onBulkRawCategory prop (Food Library
  // page only) — assigns the scraped category label to all selected items.
  { key: 'rawCategory',  label: 'Raw Category', icon: <Tag size={13} /> },
  // Enrich mode is opt-in via the onBulkEnrich prop (admin-only). Listed
  // here so the render filter has the right ordering when included.
  { key: 'enrich',       label: 'Enrich',       icon: <Wand2 size={13} /> },
  // Grouping mode is opt-in via the onBulkApplyGrouping prop (Food Library
  // bulk apply). Listed here so the render filter has the right ordering
  // when included.
  { key: 'grouping',     label: 'Grouping',     icon: <Layers size={13} /> },
  // Remove grouping is opt-in via onBulkRemoveGrouping + loadGroupingsForItem
  // (Food Library bulk remove). Listed after Grouping so the two related
  // modes sit together in the tab bar.
  { key: 'removeGrouping', label: 'Remove grouping', icon: <Layers2 size={13} /> },
  // Remove-from-menu is opt-in via currentMenuId (Menu Builder only) — removes
  // the placement from THIS menu; items stay in the catalogue (PDD 2026-06-12 #8).
  { key: 'removeFromMenu', label: 'Remove from menu', icon: <FolderMinus size={13} /> },
  // Wine serving sizes (PDD 2026-06-15) — opt-in via onBulkServingSizes. Applies
  // one owner-defined set of serving options (Glass/Bottle …) to every selected
  // wine. Intended for a wine-filtered selection.
  { key: 'serving',      label: 'Serving sizes', icon: <Wine size={13} /> },
  { key: 'delete',       label: 'Delete',       icon: <Trash2 size={13} /> },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

export function mergeAssociations(
  items: MenuItemDisplay[],
  updates: Array<{ itemId: string; associations: MenuAssociation[] }>,
): MenuItemDisplay[] {
  const map = new Map(updates.map((u) => [u.itemId, u.associations]));
  return items.map((item) => {
    const assoc = map.get(item.id);
    return assoc !== undefined ? { ...item, menu_associations: assoc } : item;
  });
}

// ── BulkActionsPanel ──────────────────────────────────────────────────────────

export default function BulkActionsPanel({
  selected,
  items,
  menus,
  initialMode,
  onClose,
  // PDD 2026-05-22 — onComplete is wrapped below so successful Apply
  // also slides out before the parent's state-flip unmount.
  onComplete: onCompleteRaw,
  onBulkSpice,
  onBulkDietary,
  onBulkSweetness,
  onBulkServingSizes,
  onBulkEnrich,
  onBulkApplyGrouping,
  onBulkRemoveGrouping,
  loadGroupingsForItem,
  onBulkAddMembersToGrouping,
  onBulkRawCategory,
  ownerFoodCategories,
  currentMenuId,
  currentMenuName,
  heatLabels,
  sweetnessLabels,
  customAllergens,
  customDietary,
  allergenDefaults,
  dietaryDefaults,
}: BulkActionsPanelProps) {
  // Effective option sets — per-restaurant defaults (canonical minus hidden)
  // merged with custom entries; fall back to the hardcoded canonical lists
  // when the consumer doesn't supply them (waiter/admin). Mirrors EditModal.
  const bulkAllergenOptions = Array.from(new Set([
    ...(allergenDefaults ?? FDA_BIG_9),
    ...(customAllergens ?? []).filter((s) => typeof s === 'string' && s.length > 0),
  ]));
  const bulkDietaryOptions = Array.from(new Set([
    ...(dietaryDefaults ?? DIETARY_RESTRICTIONS_LIST),
    ...(customDietary ?? []).filter((s) => typeof s === 'string' && s.length > 0),
  ]));
  const bulkAllergenSet = new Set(bulkAllergenOptions);
  const bulkAllergenLabels: Record<string, string> = { ...ALLERGEN_LABELS };
  for (const s of bulkAllergenOptions) if (!(s in bulkAllergenLabels)) bulkAllergenLabels[s] = slugToBulkLabel(s);
  const bulkDietaryLabels: Record<string, string> = { ...DIETARY_LABELS };
  for (const s of bulkDietaryOptions) if (!(s in bulkDietaryLabels)) bulkDietaryLabels[s] = slugToBulkLabel(s);
  // Hide opt-in tabs unless the consumer wired the matching callbacks.
  // 'removeGrouping' needs BOTH the action AND the discovery loader.
  const availableModes = MODES
    .filter((m) => m.key !== 'enrich' || !!onBulkEnrich)
    .filter((m) => m.key !== 'grouping' || !!onBulkApplyGrouping)
    .filter((m) =>
      m.key !== 'removeGrouping' || (!!onBulkRemoveGrouping && !!loadGroupingsForItem))
    .filter((m) => m.key !== 'rawCategory' || !!onBulkRawCategory)
    .filter((m) => m.key !== 'serving' || !!onBulkServingSizes)
    .filter((m) => m.key !== 'removeFromMenu' || !!currentMenuId);
  const activeHeatLabels: string[] = (heatLabels && heatLabels.length > 0)
    ? heatLabels
    : [...DEFAULT_HEAT_LABELS];
  const activeSweetnessLabels: string[] = (sweetnessLabels && sweetnessLabels.length > 0)
    ? sweetnessLabels
    : [...DEFAULT_SWEETNESS_LABELS];
  const service = useMenuManagerService();
  const trackAction = useTrackAction();
  const [mode, setMode] = useState<BulkMode>(initialMode);
  const [executing, setExecuting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // PDD 2026-05-22 — slide-in / slide-out animation. Panel mounts off-
  // screen (translateX(100%)) then transitions to 0 on the first frame
  // after mount. On close-request, transition reverses, then we call
  // the parent's onClose after the animation completes so the
  // unmount-via-state-flip looks like a clean slide-out.
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
  // Wrap onComplete so a successful Apply also plays the slide-out
  // animation. All 21+ runner callsites can keep calling `onComplete`
  // unchanged — the alias-rename in the destructure routes them here.
  function onComplete(
    updatedItems: MenuItemDisplay[],
    clearedIds: Set<string>,
  ): void {
    setIsOpen(false);
    setTimeout(() => onCompleteRaw(updatedItems, clearedIds), SLIDE_MS);
  }

  // Mode-specific form state
  const [assignMenuIds, setAssignMenuIds] = useState<Set<string>>(new Set());
  const [assignCategory, setAssignCategory] = useState<string>('');
  const [removeMenuIds, setRemoveMenuIds] = useState<Set<string>>(new Set());
  const [boostLevel, setBoostLevel] = useState<BoostLabel | null>(null);
  const [chefsSpecial, setChefsSpecial] = useState<boolean>(true);
  const [setActive, setSetActive] = useState<boolean>(true);
  // PDD 2026-05-15 — bulk Spice Modifier toggle. Default TRUE so the
  // confirm step matches the schema default and an accidental "Apply"
  // doesn't strip the slider from every selected item.
  const [setSpiceModifier, setSetSpiceModifier] = useState<boolean>(true);
  // PDD 2026-07-17 — bulk "require a spice selection" toggle, independent of
  // the visibility bulk action above. Default TRUE mirrors the schema-preserved
  // pre-split behaviour. The backend force-reverts required→false for any
  // selected item whose spice picker is off, so mixed selections stay safe.
  const [setSpiceRequired, setSetSpiceRequired] = useState<boolean>(true);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [pickedHeat, setPickedHeat] = useState<string | null>(null);
  const [pickedSweetness, setPickedSweetness] = useState<string | null>(null);
  // Wine serving sizes (PDD 2026-06-15) — one set of rows applied to every
  // selected item. Prices held in dollars for the input; → price_cents on Apply.
  const [servingRows, setServingRows] = useState<ServingBulkRow[]>([
    { label: 'Glass', volume_ml: '', price: '', is_default: true },
    { label: 'Bottle', volume_ml: '', price: '', is_default: false },
  ]);
  // Raw Category mode: either pick an existing label (or the Uncategorized
  // sentinel) from the Select, or type a brand-new label. The typed value
  // takes precedence when non-empty.
  const [pickedRawCategory, setPickedRawCategory] = useState('');
  const [newRawCategory, setNewRawCategory] = useState('');
  const [pickedDietaryTags, setPickedDietaryTags] = useState<Set<string>>(new Set());

  // PDD 2026-05-21 — bulk Grouping mode form state.
  // Rule presets translate to {min_select, max_select, default_select} at
  // submit time (mirrors AddGroupingButton's preset map for consistency).
  type GroupingPreset = 'optional' | 'optionalOne' | 'exactly' | 'atLeast' | 'atMost' | 'between' | 'all';
  const [groupingName, setGroupingName] = useState<string>('');
  const [groupingPreset, setGroupingPreset] = useState<GroupingPreset>('optional');
  const [groupingPresetN, setGroupingPresetN] = useState<number>(1);
  const [groupingPresetMax, setGroupingPresetMax] = useState<number>(1);
  // Per amendment 4 — selectedOrder is the pinned-on-top selection sequence.
  // Independent of search filter and pool order so React reconciliation
  // doesn't re-mount picker rows on toggle (preserves search focus).
  const [groupingMemberIds, setGroupingMemberIds] = useState<string[]>([]);
  const [groupingMemberSearch, setGroupingMemberSearch] = useState<string>('');
  const [groupingConflicts, setGroupingConflicts] = useState<
    Array<{ food_item_id: string; food_item_name: string }>
  >([]);

  // PDD 2026-05-22 — Grouping tab mode selector (existing vs create).
  // Default 'create' on mount = preserves the current behaviour for first-
  // time users. Switching modes resets the OTHER mode's in-progress state
  // so a name typed in 'create' doesn't leak into an 'existing' submit.
  const [groupingMode, setGroupingMode] = useState<'existing' | 'create'>('create');
  // Existing-mode picked grouping (by name — single-select radio).
  const [addExistingPickedName, setAddExistingPickedName] = useState<string | null>(null);
  // Existing-mode 409 PARTIAL_MISMATCH banner state (same shape as remove).
  const [addMembersMismatches, setAddMembersMismatches] = useState<
    Array<{ food_item_id: string; food_item_name: string; reason: string }>
  >([]);

  // PDD 2026-05-21 sibling — bulk Remove Grouping mode state.
  // Discovery: parallel `loadGroupingsForItem` calls, intersected client-side
  // by (name, rule, sorted-member-ids) hash; defaults filtered out.
  type RemoveGroupingCandidate = {
    name: string;
    min_select: number;
    max_select: number | null;
    default_select: 'all' | 'none' | 'first';
    member_ids: string[];           // already sorted at hash time
    memberLabel: string;             // pre-computed "N members"
  };
  const [removeLoadStatus, setRemoveLoadStatus] = useState<
    'idle' | 'loading' | 'ready'
  >('idle');
  const [removeCandidates, setRemoveCandidates] = useState<RemoveGroupingCandidate[]>([]);
  const [removeLoadErrors, setRemoveLoadErrors] = useState<
    Array<{ item_id: string; item_name: string }>
  >([]);
  const [removePickedName, setRemovePickedName] = useState<string | null>(null);
  const [removeMismatches, setRemoveMismatches] = useState<
    Array<{ food_item_id: string; food_item_name: string; reason: string }>
  >([]);

  const selectedItems = items.filter((i) => selected.has(i.id));
  const count = selectedItems.length;
  // '__uncat__' is the sentinel for "clear to Uncategorized" (distinct from the
  // empty placeholder value). The Raw Category tab's options now come from the
  // shared <RawCategorySelect> (items[].category ∪ ownerFoodCategories ∪ current),
  // so a freshly-created category is selectable here too — parity with EditModal.
  const RAW_UNCAT_SENTINEL = '__uncat__';

  // Menus that at least one selected item belongs to (for remove/boost/special scope)
  const relevantMenuIds = new Set(
    selectedItems.flatMap((i) => (i.menu_associations ?? []).map((a) => a.menu_id)),
  );
  const relevantMenus = menus.filter((m) => relevantMenuIds.has(m.id));

  // ── Execution ────────────────────────────────────────────────────────────

  async function runAssign() {
    const targetMenuIds = [...assignMenuIds];
    if (targetMenuIds.length === 0) { setError('Select at least one menu'); return; }
    const tasks: Array<() => Promise<{ itemId: string; associations: MenuAssociation[] }>> = [];
    for (const item of selectedItems) {
      for (const menuId of targetMenuIds) {
        const cat = assignCategory || item.category || 'Entrees';
        tasks.push(async () => ({
          itemId: item.id,
          associations: await service.addItemToMenu(item.id, menuId, item.price ?? 0, cat),
        }));
      }
    }
    await executeAll(tasks, (updates) => onComplete(mergeAssociations(items, updates), selected));
  }

  async function runRemove() {
    const targetMenuIds = [...removeMenuIds];
    if (targetMenuIds.length === 0) { setError('Select at least one menu'); return; }
    const tasks: Array<() => Promise<{ itemId: string; associations: MenuAssociation[] }>> = [];
    for (const item of selectedItems) {
      for (const menuId of targetMenuIds) {
        const inMenu = (item.menu_associations ?? []).some((a) => a.menu_id === menuId);
        if (!inMenu) continue;
        tasks.push(async () => ({
          itemId: item.id,
          associations: await service.removeItemFromMenu(item.id, menuId),
        }));
      }
    }
    if (tasks.length === 0) { setError('None of the selected items are in the chosen menus'); return; }
    await executeAll(tasks, (updates) => onComplete(mergeAssociations(items, updates), selected));
  }

  // Remove the selected items' placement from THIS menu (Menu Builder context).
  // Non-destructive — the items stay in the catalogue (PDD 2026-06-12 #8).
  async function runRemoveFromMenu() {
    if (!currentMenuId) return;
    const tasks: Array<() => Promise<{ itemId: string; associations: MenuAssociation[] }>> = [];
    for (const item of selectedItems) {
      const inMenu = (item.menu_associations ?? []).some((a) => a.menu_id === currentMenuId);
      if (!inMenu) continue;
      tasks.push(async () => ({
        itemId: item.id,
        associations: await service.removeItemFromMenu(item.id, currentMenuId),
      }));
    }
    if (tasks.length === 0) { setError('None of the selected items are on this menu'); return; }
    await executeAll(tasks, (updates) => onComplete(mergeAssociations(items, updates), selected));
  }

  async function runBoost() {
    // Apply boost to all menus each item is currently in
    const levelStr = boostLevel == null ? null : String(BOOST_LABELS.indexOf(boostLevel) + 1);
    const tasks: Array<() => Promise<{ itemId: string; associations: MenuAssociation[] }>> = [];
    for (const item of selectedItems) {
      for (const assoc of item.menu_associations ?? []) {
        tasks.push(async () => ({
          itemId: item.id,
          associations: await service.updateMenuItemInMenu(item.id, assoc.menu_id, { boost_level: levelStr }),
        }));
      }
    }
    if (tasks.length === 0) { setError('None of the selected items are assigned to any menu'); return; }
    await executeAll(tasks, (updates) => onComplete(mergeAssociations(items, updates), selected));
  }

  async function runSpecial() {
    const tasks: Array<() => Promise<{ itemId: string; associations: MenuAssociation[] }>> = [];
    for (const item of selectedItems) {
      for (const assoc of item.menu_associations ?? []) {
        tasks.push(async () => ({
          itemId: item.id,
          associations: await service.updateMenuItemInMenu(item.id, assoc.menu_id, { chefs_special: chefsSpecial }),
        }));
      }
    }
    if (tasks.length === 0) { setError('None of the selected items are assigned to any menu'); return; }
    await executeAll(tasks, (updates) => onComplete(mergeAssociations(items, updates), selected));
  }

  async function runAvailability() {
    const tasks: Array<() => Promise<void>> = selectedItems.map((item) =>
      () => service.toggleMenuItemActive(item.id, setActive),
    );
    await executeAllVoid(tasks, () => {
      const updated = items.map((i) =>
        selected.has(i.id) ? { ...i, active: setActive } : i,
      );
      onComplete(updated, selected);
    });
  }

  async function runSpiceModifier() {
    // Per-item updateMenuItem loop — mirrors runAvailability. Backend
    // PATCH endpoint (POST /owner/restaurants/{id}/menu-items/bulk-spice-
    // modifier) also exists for atomic bulk; using the per-item path
    // here keeps the service surface narrow and matches how every other
    // bulk toggle in this panel writes.
    const tasks: Array<() => Promise<void>> = selectedItems.map((item) =>
      async () => {
        await service.updateMenuItem(item.id, {
          spice_modifier_enabled: setSpiceModifier,
        });
      },
    );
    await executeAllVoid(tasks, () => {
      const updated = items.map((i) =>
        selected.has(i.id) ? { ...i, spice_modifier_enabled: setSpiceModifier } : i,
      );
      onComplete(updated, selected);
    });
  }

  async function runSpiceRequired() {
    // PDD 2026-07-17 — per-item updateMenuItem loop, mirrors runSpiceModifier.
    // Sets only spice_selection_required; the backend AND-gates it with the
    // item's current spice_modifier_enabled, so a selected item whose picker
    // is off keeps required=false regardless of the chosen value.
    const tasks: Array<() => Promise<void>> = selectedItems.map((item) =>
      async () => {
        await service.updateMenuItem(item.id, {
          spice_selection_required: setSpiceRequired,
        });
      },
    );
    await executeAllVoid(tasks, () => {
      const updated = items.map((i) =>
        selected.has(i.id)
          ? {
              ...i,
              // Reflect the backend AND-gate in local state so the grid doesn't
              // momentarily show "required" on a hidden-picker item.
              spice_selection_required:
                (i.spice_modifier_enabled ?? true) ? setSpiceRequired : false,
            }
          : i,
      );
      onComplete(updated, selected);
    });
  }

  async function runDelete() {
    const tasks: Array<() => Promise<void>> = selectedItems.map((item) =>
      () => service.deleteMenuItem(item.id),
    );
    await executeAllVoid(tasks, () => {
      const updated = items.filter((i) => !selected.has(i.id));
      onComplete(updated, selected);
    });
  }

  // Bulk-enrich — admin-only. Delegates entirely to onBulkEnrich (admin-
  // webapp wires it to restaurantService.enrichMenuItemsBatch which
  // chunks at 100). Does NOT mutate `items` locally because the AI may
  // change food_tags shape; onComplete refreshes from the consumer's
  // own data after the call resolves.
  async function runEnrich() {
    if (!onBulkEnrich) { onComplete(items, selected); return; }
    setExecuting(true);
    setError(null);
    setProgress({ done: 0, total: selectedItems.length });
    try {
      const result = await onBulkEnrich(selectedItems.map((i) => i.id));
      setProgress({ done: selectedItems.length, total: selectedItems.length });
      if (result.failed > 0) {
        setError(`Enriched ${result.enriched} · skipped ${result.skipped} · failed ${result.failed}`);
      }
      // onComplete signature wants the full items array — pass through
      // unchanged. The consumer is expected to refetch / refresh via its
      // own onRefresh handler after the bulk call.
      onComplete(items, selected);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk enrich failed');
    } finally {
      setExecuting(false);
      setProgress(null);
    }
  }

  // PDD 2026-05-22 — switching between 'existing' and 'create' modes
  // resets the OTHER mode's in-progress state (per amendment 6). Avoids
  // leaking a typed-name from 'create' into an 'existing' Apply, or vice
  // versa. Called from the mode-radio onChange handler.
  function switchGroupingMode(next: 'existing' | 'create') {
    setGroupingMode(next);
    setGroupingMemberIds([]);
    setError(null);
    setGroupingConflicts([]);
    setAddMembersMismatches([]);
    if (next === 'create') {
      // Clear existing-mode pick when flipping to create
      setAddExistingPickedName(null);
    } else {
      // Clear create-mode form when flipping to existing
      setGroupingName('');
      setGroupingPreset('optional');
      setGroupingPresetN(1);
      setGroupingPresetMax(1);
      // Re-arm discovery so entering Add-to-existing re-fetches with
      // includeDefaults=true (state is shared with the Remove path).
      setRemoveLoadStatus('idle');
    }
  }

  // PDD 2026-05-22 — bulk-add-members runner. Used when groupingMode is
  // 'existing'. Strict match (name + rule + sorted current_member_ids) is
  // resolved server-side; this client re-uses the same discovery already
  // wired for removeGrouping (removeCandidates). 409 PARTIAL_MISMATCH
  // surfaces via addMembersMismatches banner; other failures go to the
  // generic error region.
  async function runAddMembersToGrouping() {
    if (!onBulkAddMembersToGrouping) { onComplete(items, selected); return; }
    const picked = removeCandidates.find((c) => c.name === addExistingPickedName);
    if (!picked) { setError('Pick a grouping to add members to'); return; }
    // groupingMemberIds is the picker's selection (Step 8 widget). Empty
    // selection is allowed by the backend (no-op 200) but unhelpful in
    // practice — block at the UI to avoid wasted server calls.
    if (groupingMemberIds.length === 0) {
      setError('Pick at least one member to add');
      return;
    }
    setExecuting(true);
    setError(null);
    setAddMembersMismatches([]);
    try {
      await onBulkAddMembersToGrouping(
        selectedItems.map((i) => i.id),
        {
          name: picked.name,
          rule: {
            min_select: picked.min_select,
            max_select: picked.max_select,
            default_select: picked.default_select,
          },
          current_member_ids: picked.member_ids,
        },
        groupingMemberIds,
      );
      onComplete(items, selected);
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = err as any;
      if (
        e && e.name === 'BulkAddMembersToGroupingMismatchError'
        && Array.isArray(e.mismatches)
      ) {
        setAddMembersMismatches(e.mismatches);
      } else {
        setError(e instanceof Error ? e.message : 'Bulk add members failed');
      }
    } finally {
      setExecuting(false);
    }
  }

  async function runGrouping() {
    if (!onBulkApplyGrouping) { onComplete(items, selected); return; }
    const trimmed = groupingName.trim();
    if (!trimmed) { setError('Grouping name is required'); return; }
    // Translate preset → flat rule shape. Mirrors AddGroupingButton's
    // presetToRule for consistency across the create surfaces.
    const ruleMap: Record<GroupingPreset, {
      min_select: number; max_select: number | null; default_select: 'all' | 'none' | 'first';
    }> = {
      optional: { min_select: 0, max_select: null,                default_select: 'none' },
      optionalOne: { min_select: 0,            max_select: 1,               default_select: 'none' },
      exactly:  { min_select: groupingPresetN, max_select: groupingPresetN, default_select: 'none' },
      atLeast:  { min_select: groupingPresetN, max_select: null,            default_select: 'none' },
      atMost:   { min_select: 0,               max_select: groupingPresetN, default_select: 'none' },
      between:  { min_select: groupingPresetN, max_select: groupingPresetMax, default_select: 'none' },
      all:      { min_select: 0,               max_select: null,            default_select: 'all'  },
    };
    setExecuting(true);
    setError(null);
    setGroupingConflicts([]);
    try {
      await onBulkApplyGrouping(
        selectedItems.map((i) => i.id),
        {
          name: trimmed,
          rule: ruleMap[groupingPreset],
          members: groupingMemberIds.map((id, j) => ({ item_id: id, position: j })),
        },
      );
      // Success — refresh + close via onComplete. The consumer's
      // onRefresh fetches the new groupings on each parent.
      onComplete(items, selected);
    } catch (err) {
      // The owner-webapp service throws BulkApplyGroupingConflictError
      // (with .conflicts) on 409. We discriminate structurally so the
      // shared package doesn't need to import the typed class.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = err as any;
      if (
        e && e.name === 'BulkApplyGroupingConflictError'
        && Array.isArray(e.conflicts)
      ) {
        setGroupingConflicts(e.conflicts);
        // Do NOT setError — banner is the dedicated conflict surface.
      } else {
        setError(e instanceof Error ? e.message : 'Bulk apply grouping failed');
      }
    } finally {
      setExecuting(false);
    }
  }

  // ── PDD 2026-05-21 sibling — Remove Grouping discovery + submit ──────

  /**
   * Hash a grouping by (lower-trim-name, min, max, default, sorted-member-ids).
   * Used to intersect candidates across selected parents.
   */
  function hashGrouping(
    g: {
      name: string;
      min_select: number;
      max_select: number | null;
      default_select: string;
      items?: Array<{ menu_item_id: string }>;
    },
    ignoreMembers = false,
  ): string {
    // Default groupings (Add-ons / Recommendations) exist on every dish with
    // per-dish members, so we intersect them by name+rule only — otherwise a
    // grouping like Recommendations (whose members differ per dish) would
    // never intersect and the owner couldn't pick it. Custom groupings keep
    // members in the hash (they must be genuinely shared to be a candidate).
    const memberIds = ignoreMembers
      ? ''
      : (g.items ?? [])
          .map((it) => it.menu_item_id)
          .sort()
          .join(',');
    return [
      g.name.trim().toLowerCase(),
      g.min_select,
      g.max_select ?? 'null',
      g.default_select,
      memberIds,
    ].join('|');
  }

  /**
   * Discovery: fire one loadGroupingsForItem call per selected parent,
   * intersect by hash, filter is_default=true out, and stash the surviving
   * candidates. Uses Promise.allSettled so a single failed parent doesn't
   * collapse the whole form — failed parents surface as inline error
   * rows with a Retry button.
   *
   * Resets selection + mismatches each time it runs (entry into the tab
   * or explicit "Refresh" click after a mismatch).
   */
  // includeDefaults=false (the Remove-grouping path) hides default groupings
  // (Add-ons / Recommendations) — they can't be removed. The Add-to-existing
  // path passes true so members can be bulk-added to the default groups. The
  // two paths share `removeCandidates` state, so callers re-arm discovery
  // (setRemoveLoadStatus('idle')) on context switches to apply the right flag.
  async function discoverRemoveCandidates(includeDefaults = false) {
    if (!loadGroupingsForItem) return;
    setRemoveLoadStatus('loading');
    setRemoveCandidates([]);
    setRemoveLoadErrors([]);
    setRemovePickedName(null);
    setRemoveMismatches([]);
    setError(null);

    const results = await Promise.allSettled(
      selectedItems.map((it) => loadGroupingsForItem(it.id)),
    );

    const fulfilledHashSets: Array<Map<string, RemoveGroupingCandidate>> = [];
    const newLoadErrors: Array<{ item_id: string; item_name: string }> = [];
    results.forEach((res, i) => {
      const parent = selectedItems[i];
      if (res.status === 'rejected') {
        newLoadErrors.push({ item_id: parent.id, item_name: parent.name });
        return;
      }
      const map = new Map<string, RemoveGroupingCandidate>();
      for (const g of res.value) {
        if (!includeDefaults && g.is_default) continue;
        // Default groupings on the Add path: match by name+rule only and add
        // to each dish's own copy — backend ignores current_member_ids for
        // defaults, so send [] and label them generically (per-dish member
        // counts vary and aren't meaningful for a shared label).
        const isDefaultAdd = includeDefaults && !!g.is_default;
        const sortedMembers = (g.items ?? [])
          .map((it) => it.menu_item_id)
          .sort();
        const candidate: RemoveGroupingCandidate = {
          name: g.name,
          min_select: g.min_select,
          max_select: g.max_select,
          default_select: g.default_select,
          member_ids: isDefaultAdd ? [] : sortedMembers,
          memberLabel: isDefaultAdd
            ? 'default group'
            : `${sortedMembers.length} member${sortedMembers.length === 1 ? '' : 's'}`,
        };
        map.set(hashGrouping(g, isDefaultAdd), candidate);
      }
      fulfilledHashSets.push(map);
    });

    // Intersection = hashes present in EVERY successful parent's map.
    // (Failed parents excluded from the intersection — the load-error rows
    // warn the owner that the result may be over-permissive.)
    let intersection: RemoveGroupingCandidate[] = [];
    if (fulfilledHashSets.length > 0) {
      const [first, ...rest] = fulfilledHashSets;
      for (const [hash, candidate] of first) {
        if (rest.every((m) => m.has(hash))) intersection.push(candidate);
      }
    }
    setRemoveCandidates(intersection);
    setRemoveLoadErrors(newLoadErrors);
    setRemoveLoadStatus('ready');
  }

  async function retryDiscoveryForParent(itemId: string) {
    if (!loadGroupingsForItem) return;
    // Just re-fire the whole discovery — it's idempotent + simpler than
    // patching one parent's slot in the intersection.
    setRemoveLoadErrors((prev) => prev.filter((e) => e.item_id !== itemId));
    await discoverRemoveCandidates();
  }

  async function runRemoveGrouping() {
    if (!onBulkRemoveGrouping) { onComplete(items, selected); return; }
    const picked = removeCandidates.find((c) => c.name === removePickedName);
    if (!picked) { setError('Pick a grouping to remove'); return; }
    setExecuting(true);
    setError(null);
    setRemoveMismatches([]);
    try {
      await onBulkRemoveGrouping(
        selectedItems.map((i) => i.id),
        {
          name: picked.name,
          rule: {
            min_select: picked.min_select,
            max_select: picked.max_select,
            default_select: picked.default_select,
          },
          member_ids: picked.member_ids,
        },
      );
      onComplete(items, selected);
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = err as any;
      if (
        e && e.name === 'BulkRemoveGroupingMismatchError'
        && Array.isArray(e.mismatches)
      ) {
        setRemoveMismatches(e.mismatches);
      } else {
        setError(e instanceof Error ? e.message : 'Bulk remove grouping failed');
      }
    } finally {
      setExecuting(false);
    }
  }

  // Fire discovery on first entry into the 'removeGrouping' mode, and
  // also when entering 'grouping' mode with add-members wired + the user
  // flips to the 'existing' sub-mode (PDD 2026-05-22 — same intersection
  // logic reused). Idempotent: discoverRemoveCandidates resets state each
  // time so re-firing is cheap.
  useEffect(() => {
    if (mode === 'removeGrouping' && removeLoadStatus === 'idle') {
      // Remove path — defaults stay hidden (can't remove a default grouping).
      void discoverRemoveCandidates(false);
    }
    if (
      mode === 'grouping'
      && groupingMode === 'existing'
      && !!onBulkAddMembersToGrouping
      && !!loadGroupingsForItem
      && removeLoadStatus === 'idle'
    ) {
      // Add-to-existing path — include defaults (Add-ons / Recommendations).
      void discoverRemoveCandidates(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, groupingMode]);

  async function runSpice() {
    if (!pickedHeat) { setError('Select a spice level'); return; }
    if (!onBulkSpice) { onComplete(items, selected); return; }
    setExecuting(true);
    setError(null);
    const itemIds = selectedItems.map((i) => i.id);
    setProgress({ done: 0, total: itemIds.length });
    let failed = 0;
    for (const itemId of itemIds) {
      try { await onBulkSpice(pickedHeat, [itemId]); } catch { failed++; }
      setProgress((p) => p ? { ...p, done: p.done + 1 } : null);
    }
    setExecuting(false);
    setProgress(null);
    if (failed > 0) {
      setError(`${failed} item${failed !== 1 ? 's' : ''} failed — others updated`);
    }
    if (failed < itemIds.length) onComplete(items, selected);
  }

  async function runSweetness() {
    if (!pickedSweetness) { setError('Select a sweetness level'); return; }
    if (!onBulkSweetness) { onComplete(items, selected); return; }
    setExecuting(true);
    setError(null);
    const itemIds = selectedItems.map((i) => i.id);
    setProgress({ done: 0, total: itemIds.length });
    let failed = 0;
    for (const itemId of itemIds) {
      try { await onBulkSweetness(pickedSweetness, [itemId]); } catch { failed++; }
      setProgress((p) => p ? { ...p, done: p.done + 1 } : null);
    }
    setExecuting(false);
    setProgress(null);
    if (failed > 0) {
      setError(`${failed} item${failed !== 1 ? 's' : ''} failed — others updated`);
    }
    if (failed < itemIds.length) onComplete(items, selected);
  }

  async function runDietary() {
    if (pickedDietaryTags.size === 0) { setError('Select at least one tag'); return; }
    if (!onBulkDietary) { onComplete(items, selected); return; }
    const tags = [...pickedDietaryTags].map((name) => ({
      name,
      // Classify against the effective allergen set so custom allergens are
      // written as allergens (not misfiled as dietary).
      type: bulkAllergenSet.has(name) ? 'allergen' as const : 'dietary' as const,
    }));
    const itemIds = selectedItems.map((i) => i.id);
    setExecuting(true);
    setError(null);
    setProgress({ done: 0, total: itemIds.length });
    let failed = 0;
    for (const itemId of itemIds) {
      try { await onBulkDietary(tags, [itemId]); } catch { failed++; }
      setProgress((p) => p ? { ...p, done: p.done + 1 } : null);
    }
    setExecuting(false);
    setProgress(null);
    if (failed > 0) {
      setError(`${failed} item${failed !== 1 ? 's' : ''} failed — others updated`);
    }
    if (failed < itemIds.length) onComplete(items, selected);
  }

  async function runRawCategory() {
    // Resolve the target label: a typed new label wins; else the Select value
    // (sentinel → empty string to clear to Uncategorized).
    const typed = newRawCategory.trim();
    if (!typed && !pickedRawCategory) {
      setError('Pick an existing category or type a new one');
      return;
    }
    const target = typed
      ? typed
      : pickedRawCategory === RAW_UNCAT_SENTINEL
        ? ''
        : pickedRawCategory;
    if (!onBulkRawCategory) { onComplete(items, selected); return; }
    setExecuting(true);
    setError(null);
    const itemIds = selectedItems.map((i) => i.id);
    setProgress({ done: 0, total: itemIds.length });
    let failed = 0;
    const okIds = new Set<string>();
    for (const itemId of itemIds) {
      try { await onBulkRawCategory(target, [itemId]); okIds.add(itemId); } catch { failed++; }
      setProgress((p) => p ? { ...p, done: p.done + 1 } : null);
    }
    setExecuting(false);
    setProgress(null);
    if (failed > 0) {
      setError(`${failed} item${failed !== 1 ? 's' : ''} failed — others updated`);
    }
    if (okIds.size > 0) {
      // Patch local items so the table + left-rail category filter reflect the
      // reassignment immediately (onComplete → replaceItem in the parent).
      const updated = items.map((it) => okIds.has(it.id) ? { ...it, category: target } : it);
      onComplete(updated, selected);
    }
  }

  async function executeAll(
    tasks: Array<() => Promise<{ itemId: string; associations: MenuAssociation[] }>>,
    onSuccess: (updates: Array<{ itemId: string; associations: MenuAssociation[] }>) => void,
  ) {
    setExecuting(true);
    setError(null);
    setProgress({ done: 0, total: tasks.length });
    const updates: Array<{ itemId: string; associations: MenuAssociation[] }> = [];
    let failed = 0;
    for (const task of tasks) {
      try {
        updates.push(await task());
      } catch {
        failed++;
      }
      setProgress((p) => p ? { ...p, done: p.done + 1 } : null);
    }
    setExecuting(false);
    setProgress(null);
    if (failed > 0) {
      setError(`${failed} operation${failed !== 1 ? 's' : ''} failed — partial updates applied`);
      if (updates.length > 0) onSuccess(updates);
    } else {
      onSuccess(updates);
    }
  }

  async function executeAllVoid(
    tasks: Array<() => Promise<void>>,
    onSuccess: () => void,
  ) {
    setExecuting(true);
    setError(null);
    setProgress({ done: 0, total: tasks.length });
    let failed = 0;
    for (const task of tasks) {
      try { await task(); } catch { failed++; }
      setProgress((p) => p ? { ...p, done: p.done + 1 } : null);
    }
    setExecuting(false);
    setProgress(null);
    if (failed > 0) {
      setError(`${failed} item${failed !== 1 ? 's' : ''} failed — others updated`);
    }
    if (failed < tasks.length) onSuccess();
  }

  async function runServingSizes() {
    if (!onBulkServingSizes) { onComplete(items, selected); return; }
    let options: ServingOption[];
    try {
      options = buildBulkServingOptions(servingRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid serving sizes');
      return;
    }
    setExecuting(true);
    setError(null);
    const itemIds = selectedItems.map((i) => i.id);
    setProgress({ done: 0, total: itemIds.length });
    let failed = 0;
    for (const itemId of itemIds) {
      try { await onBulkServingSizes(options, [itemId]); } catch { failed++; }
      setProgress((p) => p ? { ...p, done: p.done + 1 } : null);
    }
    setExecuting(false);
    setProgress(null);
    if (failed > 0) {
      setError(`${failed} item${failed !== 1 ? 's' : ''} failed — others updated`);
    }
    if (failed < itemIds.length) onComplete(items, selected);
  }

  async function handleApply() {
    setError(null);
    // Gate the delete click-through so we don't emit on confirmation click.
    if (mode === 'delete' && !deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }
    const start = Date.now();
    const actionName = `menu.bulkPanel.${mode}` as const;
    try {
      switch (mode) {
        case 'assign':       await runAssign(); break;
        case 'remove':       await runRemove(); break;
        case 'removeFromMenu': await runRemoveFromMenu(); break;
        case 'boost':        await runBoost(); break;
        case 'special':      await runSpecial(); break;
        case 'availability': await runAvailability(); break;
        case 'spiceModifier': await runSpiceModifier(); break;
        case 'spiceRequired': await runSpiceRequired(); break;
        case 'spice':        await runSpice(); break;
        case 'sweetness':    await runSweetness(); break;
        case 'serving':      await runServingSizes(); break;
        case 'dietary':      await runDietary(); break;
        case 'rawCategory':  await runRawCategory(); break;
        case 'enrich':       await runEnrich(); break;
        case 'grouping':
          if (groupingMode === 'existing') {
            await runAddMembersToGrouping();
          } else {
            await runGrouping();
          }
          break;
        case 'removeGrouping': await runRemoveGrouping(); break;
        case 'delete':       await runDelete(); break;
      }
      trackAction(actionName, {
        metadata: {
          itemCount: count,
          menuCount:
            mode === 'assign' ? assignMenuIds.size :
            mode === 'remove' ? removeMenuIds.size : undefined,
          level: mode === 'boost' ? boostLevel : undefined,
          chefsSpecial: mode === 'special' ? chefsSpecial : undefined,
          active: mode === 'availability' ? setActive : undefined,
        },
        success: true,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      trackAction(actionName, {
        metadata: { itemCount: count },
        success: false,
        durationMs: Date.now() - start,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const isDelete = mode === 'delete';

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={requestClose}
        style={{
          position: 'fixed', inset: 0,
          // Drawer-overlay tier so the panel sits above the owner-webapp
          // persistent TopBar (z:60) — otherwise the topbar paints over
          // the panel's top edge and the close button at the top-right
          // becomes unclickable. Tokens: `--z-drawer-overlay: 200`,
          // `--z-drawer: 201`. Hardcoded fallbacks for waiter-webapp /
          // admin-webapp where the tokens may not be defined.
          zIndex: 'var(--z-drawer-overlay, 200)' as unknown as number,
          background: 'rgba(0,0,0,0.15)',
          opacity: isOpen ? 1 : 0,
          transition: `opacity ${SLIDE_MS}ms ease-out`,
        }}
        data-testid="bulk-panel-backdrop"
      />

      {/* Panel */}
      <div
        data-testid="bulk-actions-panel"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '50vw',
          minWidth: 360,
          zIndex: 'var(--z-drawer, 201)' as unknown as number,
          background: 'var(--white)',
          borderLeft: '1px solid var(--border)',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: `transform ${SLIDE_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`,
          willChange: 'transform',
        }}
      >
        {/* Header */}
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
              {count} item{count !== 1 ? 's' : ''} selected
            </div>
          </div>
          <button
            type="button"
            onClick={requestClose}
            data-testid="bulk-panel-close"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text2)', padding: 4, borderRadius: 4,
              display: 'flex', alignItems: 'center',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Item preview chips */}
        <div
          style={{
            padding: '10px 16px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 4,
          }}
        >
          {selectedItems.slice(0, 4).map((item) => (
            <span
              key={item.id}
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
              title={item.name}
            >
              {item.name}
            </span>
          ))}
          {count > 4 && (
            <span style={{ fontSize: 11, color: 'var(--text2)', padding: '2px 4px' }}>
              +{count - 4} more
            </span>
          )}
        </div>

        {/* Mode tabs */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border)',
            overflowX: 'auto',
            flexShrink: 0,
          }}
          data-testid="bulk-mode-tabs"
        >
          {availableModes.map(({ key, label, icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                // Re-arm grouping discovery on an actual tab change so the
                // Add-existing vs Remove path each re-fetches with the correct
                // includeDefaults flag (they share removeCandidates state).
                // Guarded on key !== mode so re-clicking the active tab doesn't
                // strand the status at 'idle' (the effect won't re-fire).
                if (key !== mode) setRemoveLoadStatus('idle');
                setMode(key);
                setError(null);
                setDeleteConfirm(false);
              }}
              data-testid={`bulk-tab-${key}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '9px 12px',
                fontSize: 11,
                fontWeight: 600,
                color: mode === key ? 'var(--blue)' : 'var(--text2)',
                background: 'transparent',
                border: 'none',
                borderBottom: mode === key ? '2px solid var(--blue)' : '2px solid transparent',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        {/* Mode-specific form. Grouping mode uses a fillHeight picker that
            scrolls its OWN row list, so its container must NOT also scroll —
            an outer overflowY:auto wrapping the nested flex:1/minHeight:0
            picker is what made the canonical-category chip rail overlap +
            intercept member-row clicks (the 7ff3123 / 172492f reverts). Match
            the proven BulkMenuSidesPanel structure: flex column, minHeight:0,
            no overflow on the container. All other modes keep their scroll. */}
        <div
          style={
            mode === 'grouping'
              // Flex column so the fillHeight member picker can grow to the
              // footer; overflowY:auto so that when the stacked content
              // (mode toggle, candidate list, picker floor) exceeds the
              // panel the whole form scrolls rather than overlapping the
              // footer. The picker's minHeight floor keeps its rows from
              // collapsing under the chip rail (the 7ff3123 interception).
              ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '16px' }
              : { flex: 1, overflowY: 'auto', padding: '16px' }
          }
        >
          {mode === 'assign' && (
            <AssignForm
              menus={menus}
              selectedMenuIds={assignMenuIds}
              category={assignCategory}
              onMenuToggle={(id) =>
                setAssignMenuIds((prev) => {
                  const next = new Set(prev);
                  next.has(id) ? next.delete(id) : next.add(id);
                  return next;
                })
              }
              onCategoryChange={setAssignCategory}
            />
          )}
          {mode === 'remove' && (
            <RemoveForm
              menus={relevantMenus}
              selectedMenuIds={removeMenuIds}
              onMenuToggle={(id) =>
                setRemoveMenuIds((prev) => {
                  const next = new Set(prev);
                  next.has(id) ? next.delete(id) : next.add(id);
                  return next;
                })
              }
            />
          )}
          {mode === 'boost' && (
            <BoostForm boostLevel={boostLevel} onChange={setBoostLevel} />
          )}
          {mode === 'special' && (
            <SpecialForm value={chefsSpecial} onChange={setChefsSpecial} />
          )}
          {mode === 'availability' && (
            <AvailabilityForm value={setActive} onChange={setSetActive} />
          )}
          {mode === 'spiceModifier' && (
            <SpiceModifierForm value={setSpiceModifier} onChange={setSetSpiceModifier} />
          )}
          {mode === 'spiceRequired' && (
            <SpiceRequiredForm value={setSpiceRequired} onChange={setSetSpiceRequired} />
          )}
          {mode === 'spice' && (
            <SpiceForm heatLabels={activeHeatLabels} pickedHeat={pickedHeat} onChange={setPickedHeat} />
          )}
          {mode === 'sweetness' && (
            <SweetnessForm sweetnessLabels={activeSweetnessLabels} pickedSweetness={pickedSweetness} onChange={setPickedSweetness} />
          )}
          {mode === 'serving' && (
            <ServingSizesForm rows={servingRows} onChange={setServingRows} count={selected.size} />
          )}
          {mode === 'dietary' && (
            <DietaryForm
              allergenOptions={bulkAllergenOptions}
              dietaryOptions={bulkDietaryOptions}
              allergenLabels={bulkAllergenLabels}
              dietaryLabels={bulkDietaryLabels}
              pickedTags={pickedDietaryTags}
              onToggle={(tag) =>
                setPickedDietaryTags((prev) => {
                  const next = new Set(prev);
                  next.has(tag) ? next.delete(tag) : next.add(tag);
                  return next;
                })
              }
            />
          )}
          {mode === 'rawCategory' && (
            <div data-testid="bulk-rawcat-form">
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
                Assign raw category
              </div>
              <p style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 12 }}>
                Sets the scraped category label on all {count} selected item{count !== 1 ? 's' : ''}.
              </p>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 4 }}>
                Existing category
              </label>
              <RawCategorySelect
                value={pickedRawCategory}
                onChange={(v) => { setPickedRawCategory(v); setNewRawCategory(''); setError(null); }}
                items={items}
                ownerFoodCategories={ownerFoodCategories}
                uncategorizedValue={RAW_UNCAT_SENTINEL}
                placeholder="— Select category —"
                data-testid="bulk-rawcat-select"
              />
              <div style={{ fontSize: 11, color: 'var(--text2)', margin: '12px 0 4px' }}>
                or create a new one
              </div>
              <input
                type="text"
                value={newRawCategory}
                onChange={(e) => { setNewRawCategory(e.target.value); setError(null); }}
                placeholder="New category name"
                data-testid="bulk-rawcat-new"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: 13,
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}
          {mode === 'removeFromMenu' && (
            <RemoveFromMenuForm
              count={count}
              onMenuCount={selectedItems.filter((i) =>
                (i.menu_associations ?? []).some((a) => a.menu_id === currentMenuId),
              ).length}
              menuName={currentMenuName}
            />
          )}
          {mode === 'delete' && (
            <DeleteForm count={count} confirmed={deleteConfirm} />
          )}
          {mode === 'enrich' && (
            <div
              data-testid="bulk-enrich-form"
              style={{
                display: 'flex', flexDirection: 'column', gap: 8,
                padding: 12, borderRadius: 6,
                background: '#fff7ed', border: '1px solid #fed7aa',
                color: '#7c2d12', fontSize: 13,
              }}
            >
              <div style={{ fontWeight: 600 }}>
                Enrich {count} item{count !== 1 ? 's' : ''} with AI
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                Runs AI tagging (dietary, allergens, proteins, textures, etc.)
                on each selected item. Items already tagged manually are
                preserved. Larger selections are processed in batches of 100;
                progress shows below the action button.
              </div>
            </div>
          )}
          {mode === 'grouping' && (
            <BulkGroupingForm
              count={count}
              items={items}
              selectedParents={selected}
              name={groupingName}
              onChangeName={setGroupingName}
              preset={groupingPreset}
              onChangePreset={setGroupingPreset}
              presetN={groupingPresetN}
              onChangePresetN={setGroupingPresetN}
              presetMax={groupingPresetMax}
              onChangePresetMax={setGroupingPresetMax}
              memberIds={groupingMemberIds}
              onToggleMember={(id) =>
                setGroupingMemberIds((prev) =>
                  prev.includes(id)
                    ? prev.filter((m) => m !== id)
                    : prev.length >= 50
                      ? prev  // amendment 5 — 50-cap hard-stop at Select
                      : [...prev, id],
                )
              }
              onClearMembers={() => setGroupingMemberIds([])}
              onSelectAllMembers={(ids) =>
                // ids are already filtered to unselected + capped to the
                // remaining 50-capacity by BulkMemberPicker; merge + re-cap
                // defensively in case of a double-fire.
                setGroupingMemberIds((prev) =>
                  [...prev, ...ids.filter((id) => !prev.includes(id))].slice(0, 50),
                )
              }
              search={groupingMemberSearch}
              onChangeSearch={setGroupingMemberSearch}
              conflicts={groupingConflicts}
              // PDD 2026-05-22 — Add-to-existing mode props. Only wired when
              // the consumer passes onBulkAddMembersToGrouping; otherwise
              // the form behaves identically to the create-only version.
              addExistingEnabled={!!onBulkAddMembersToGrouping}
              groupingMode={groupingMode}
              onChangeGroupingMode={switchGroupingMode}
              existingStatus={removeLoadStatus}
              existingCandidates={removeCandidates}
              existingPickedName={addExistingPickedName}
              onPickExisting={setAddExistingPickedName}
              onRefreshExisting={() => { void discoverRemoveCandidates(true); }}
              addMembersMismatches={addMembersMismatches}
            />
          )}
          {mode === 'removeGrouping' && (
            <BulkRemoveGroupingForm
              count={count}
              status={removeLoadStatus}
              candidates={removeCandidates}
              loadErrors={removeLoadErrors}
              pickedName={removePickedName}
              onPick={setRemovePickedName}
              onRetryParent={retryDiscoveryForParent}
              mismatches={removeMismatches}
              onRefresh={() => { void discoverRemoveCandidates(); }}
              executing={executing}
            />
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {error && (
            <div
              style={{
                fontSize: 11,
                color: '#b91c1c',
                background: '#fee2e2',
                borderRadius: 4,
                padding: '6px 10px',
              }}
              data-testid="bulk-error"
            >
              {error}
            </div>
          )}

          {progress && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--text2)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
              data-testid="bulk-progress"
            >
              <div
                style={{
                  flex: 1,
                  height: 4,
                  background: '#f0f0f0',
                  borderRadius: 2,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    background: isDelete ? '#ef4444' : 'var(--blue)',
                    borderRadius: 2,
                    width: `${(progress.done / progress.total) * 100}%`,
                    transition: 'width 0.2s',
                  }}
                />
              </div>
              {progress.done}/{progress.total}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={requestClose}
              data-testid="bulk-cancel"
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
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              data-testid="bulk-apply"
              disabled={executing}
              style={{
                flex: 2,
                padding: '8px 0',
                fontSize: 12,
                fontWeight: 700,
                color: 'white',
                background: isDelete && deleteConfirm ? '#ef4444' : isDelete ? '#ef4444' : 'var(--blue)',
                border: 'none',
                borderRadius: 'var(--r-xs)',
                cursor: executing ? 'not-allowed' : 'pointer',
                opacity: executing ? 0.7 : 1,
              }}
            >
              {executing
                ? 'Applying…'
                : isDelete && !deleteConfirm
                  ? `Delete ${count} item${count !== 1 ? 's' : ''}…`
                  : isDelete && deleteConfirm
                    ? `Confirm — delete ${count} items`
                    : `Apply to ${count} item${count !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Sub-forms ─────────────────────────────────────────────────────────────────

function AssignForm({
  menus,
  selectedMenuIds,
  category,
  onMenuToggle,
  onCategoryChange,
}: {
  menus: MenuSummary[];
  selectedMenuIds: Set<string>;
  category: string;
  onMenuToggle: (id: string) => void;
  onCategoryChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
          Assign to menus
        </div>
        {menus.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text2)' }}>No menus yet — create one first</p>
        ) : (
          menus.map((menu) => (
            <label
              key={menu.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 0',
                cursor: 'pointer',
                borderBottom: '1px solid var(--border)',
              }}
              data-testid={`assign-menu-${menu.id}`}
            >
              <input
                type="checkbox"
                checked={selectedMenuIds.has(menu.id)}
                onChange={() => onMenuToggle(menu.id)}
                style={{ accentColor: 'var(--blue)', width: 14, height: 14 }}
              />
              <span style={{ fontSize: 12, color: 'var(--text)', flex: 1 }}>{menu.name}</span>
              {!menu.active && (
                <span style={{ fontSize: 10, color: '#b91c1c' }}>Inactive</span>
              )}
            </label>
          ))
        )}
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
          Category override
          <span style={{ fontWeight: 400, color: 'var(--text2)', marginLeft: 4 }}>(optional)</span>
        </div>
        <Select
          fullWidth
          value={category}
          onChange={(e) => onCategoryChange(e.target.value)}
          data-testid="assign-category-select"
          placeholder="Use item's own category"
          options={[
            { value: '', label: "Use item's own category" },
            ...[...CANONICAL_CATEGORIES].map((c) => ({ value: c, label: c })),
          ]}
        />
      </div>
    </div>
  );
}

function RemoveForm({
  menus,
  selectedMenuIds,
  onMenuToggle,
}: {
  menus: MenuSummary[];
  selectedMenuIds: Set<string>;
  onMenuToggle: (id: string) => void;
}) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
        Remove from menus
      </div>
      {menus.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text2)' }}>
          None of the selected items are assigned to any menu
        </p>
      ) : (
        menus.map((menu) => (
          <label
            key={menu.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 0',
              cursor: 'pointer',
              borderBottom: '1px solid var(--border)',
            }}
            data-testid={`remove-menu-${menu.id}`}
          >
            <input
              type="checkbox"
              checked={selectedMenuIds.has(menu.id)}
              onChange={() => onMenuToggle(menu.id)}
              style={{ accentColor: 'var(--blue)', width: 14, height: 14 }}
            />
            <span style={{ fontSize: 12, color: 'var(--text)', flex: 1 }}>{menu.name}</span>
          </label>
        ))
      )}
    </div>
  );
}

function BoostForm({
  boostLevel,
  onChange,
}: {
  boostLevel: BoostLabel | null;
  onChange: (v: BoostLabel | null) => void;
}) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
        Set boost level
      </div>
      <p style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 12 }}>
        Applied across all menus each item is assigned to.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {([null, ...BOOST_LABELS] as const).map((level) => {
          const isSelected = boostLevel === level;
          return (
            <button
              key={level ?? 'none'}
              type="button"
              onClick={() => onChange(level)}
              data-testid={`boost-option-${level ?? 'none'}`}
              style={{
                padding: '10px 14px',
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 'var(--r-xs)',
                border: isSelected ? '2px solid var(--blue)' : '1px solid var(--border)',
                background: isSelected ? 'var(--blue-bg)' : 'white',
                color: isSelected ? 'var(--blue)' : 'var(--text)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              {level === null ? 'None (clear boost)' : level}
              {level === 'Low' && <span style={{ fontWeight: 400, color: 'var(--text2)', marginLeft: 6 }}>— subtle promotion</span>}
              {level === 'Moderate' && <span style={{ fontWeight: 400, color: 'var(--text2)', marginLeft: 6 }}>— regular promotion</span>}
              {level === 'High' && <span style={{ fontWeight: 400, color: 'var(--text2)', marginLeft: 6 }}>— maximum promotion</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SpecialForm({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
        Chef's special
      </div>
      <p style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 12 }}>
        Applied across all menus each item is assigned to.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[true, false].map((v) => (
          <button
            key={String(v)}
            type="button"
            onClick={() => onChange(v)}
            data-testid={`special-option-${v}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 14px',
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 'var(--r-xs)',
              border: value === v ? '2px solid var(--amber, #f59e0b)' : '1px solid var(--border)',
              background: value === v ? '#fef3c7' : 'white',
              color: value === v ? '#b45309' : 'var(--text)',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <Star
              size={13}
              fill={value === v ? '#f59e0b' : 'none'}
              color={value === v ? '#f59e0b' : 'currentColor'}
            />
            {v ? 'Mark as Chef\'s Special' : 'Remove Chef\'s Special'}
          </button>
        ))}
      </div>
    </div>
  );
}

function AvailabilityForm({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
        Availability
      </div>
      <p style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 12 }}>
        Controls whether diners can see and order these items.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button
          type="button"
          onClick={() => onChange(true)}
          data-testid="availability-option-active"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 'var(--r-xs)',
            border: value ? '2px solid #16a34a' : '1px solid var(--border)',
            background: value ? '#dcfce7' : 'white',
            color: value ? '#15803d' : 'var(--text)',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <Eye size={13} />
          Active — visible to diners
        </button>
        <button
          type="button"
          onClick={() => onChange(false)}
          data-testid="availability-option-inactive"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 'var(--r-xs)',
            border: !value ? '2px solid #b91c1c' : '1px solid var(--border)',
            background: !value ? '#fee2e2' : 'white',
            color: !value ? '#b91c1c' : 'var(--text)',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <EyeOff size={13} />
          86'd — hidden from diners
        </button>
      </div>
    </div>
  );
}

function SpiceModifierForm({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
        Spice modifier
      </div>
      <p style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 12 }}>
        Controls whether the patron composition page shows a spice-level
        picker for these items. Desserts auto-hide the picker regardless.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button
          type="button"
          onClick={() => onChange(true)}
          data-testid="spice-modifier-option-on"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 'var(--r-xs)',
            border: value ? '2px solid #e11d48' : '1px solid var(--border)',
            background: value ? '#fff1f2' : 'white',
            color: value ? '#9f1239' : 'var(--text)',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <Flame size={13} />
          On — show the spice picker
        </button>
        <button
          type="button"
          onClick={() => onChange(false)}
          data-testid="spice-modifier-option-off"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 'var(--r-xs)',
            border: !value ? '2px solid #525b6b' : '1px solid var(--border)',
            background: !value ? '#f1f5f9' : 'white',
            color: !value ? '#1f2937' : 'var(--text)',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          Off — hide the spice picker
        </button>
      </div>
    </div>
  );
}

function SpiceRequiredForm({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
        Spice requirement
      </div>
      <p style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 12 }}>
        Require diners to pick a spice level before adding these items. Only
        applies to items whose spice picker is on; items with the picker off are
        left optional.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button
          type="button"
          onClick={() => onChange(true)}
          data-testid="spice-required-option-on"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 'var(--r-xs)',
            border: value ? '2px solid #e11d48' : '1px solid var(--border)',
            background: value ? '#fff1f2' : 'white',
            color: value ? '#9f1239' : 'var(--text)',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <Flame size={13} />
          Required — diners must pick a spice level
        </button>
        <button
          type="button"
          onClick={() => onChange(false)}
          data-testid="spice-required-option-off"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 'var(--r-xs)',
            border: !value ? '2px solid #525b6b' : '1px solid var(--border)',
            background: !value ? '#f1f5f9' : 'white',
            color: !value ? '#1f2937' : 'var(--text)',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          Optional — diners can add without picking
        </button>
      </div>
    </div>
  );
}

function SpiceForm({
  heatLabels,
  pickedHeat,
  onChange,
}: {
  heatLabels: string[];
  pickedHeat: string | null;
  onChange: (v: string | null) => void;
}) {
  const palette = DEFAULT_HEAT_ICONS.length;
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
        Set spice level
      </div>
      <p style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 12 }}>
        Applied to all selected items. Click again to deselect.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {heatLabels.map((label, i) => {
          const idx = Math.min(i, palette - 1);
          const icon = DEFAULT_HEAT_ICONS[idx];
          const bg = DEFAULT_HEAT_BG[idx];
          const border = DEFAULT_HEAT_BORDER[idx];
          const color = DEFAULT_HEAT_COLOR[idx];
          const selected = pickedHeat === label;
          return (
            <button
              key={label}
              type="button"
              onClick={() => onChange(selected ? null : label)}
              data-testid={`spice-option-${label.toLowerCase()}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 'var(--r-xs)',
                border: selected ? `2px solid ${border}` : '1px solid var(--border)',
                background: selected ? bg : 'white',
                color: selected ? color : 'var(--text)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>{icon}</span>
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SweetnessForm({
  sweetnessLabels,
  pickedSweetness,
  onChange,
}: {
  sweetnessLabels: string[];
  pickedSweetness: string | null;
  onChange: (v: string | null) => void;
}) {
  const palette = DEFAULT_SWEETNESS_ICONS.length;
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
        Set sweetness level
      </div>
      <p style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 12 }}>
        Applied to all selected dessert items. Click again to deselect.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sweetnessLabels.map((label, i) => {
          const idx = Math.min(i, palette - 1);
          const icon = DEFAULT_SWEETNESS_ICONS[idx];
          const bg = DEFAULT_SWEETNESS_BG[idx];
          const border = DEFAULT_SWEETNESS_BORDER[idx];
          const color = DEFAULT_SWEETNESS_COLOR[idx];
          const selected = pickedSweetness === label;
          return (
            <button
              key={label}
              type="button"
              onClick={() => onChange(selected ? null : label)}
              data-testid={`sweetness-option-${label.toLowerCase().replace(/\s+/g, '-')}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 'var(--r-xs)',
                border: selected ? `2px solid ${border}` : '1px solid var(--border)',
                background: selected ? bg : 'white',
                color: selected ? color : 'var(--text)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>{icon}</span>
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Wine serving sizes (PDD 2026-06-15) ─────────────────────────────────────

export interface ServingBulkRow { label: string; volume_ml: string; price: string; is_default: boolean }

/**
 * Build the serving_options payload from the bulk editor rows. Drops rows
 * without a label or a valid (>= 0) price; converts dollars → price_cents;
 * forces exactly one default; slug-dedupes ids. An all-empty editor yields []
 * (clears serving sizes on the selection). Throws when rows are present but
 * none are valid, so Apply surfaces a friendly error instead of a no-op clear.
 */
export function buildBulkServingOptions(rows: ServingBulkRow[]): ServingOption[] {
  const hasAnyInput = rows.some((r) => r.label.trim() || r.price.trim());
  const out: ServingOption[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const label = row.label.trim();
    const priceNum = parseFloat(row.price);
    if (!label || !isFinite(priceNum) || priceNum < 0) continue;
    let slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'option';
    let n = 2;
    while (seen.has(slug)) { slug = `${slug}-${n}`; n += 1; }
    seen.add(slug);
    const opt: ServingOption = { id: slug, label, price_cents: Math.round(priceNum * 100), is_default: !!row.is_default };
    const vol = parseInt(row.volume_ml, 10);
    if (isFinite(vol) && vol > 0) opt.volume_ml = vol;
    out.push(opt);
  }
  if (hasAnyInput && out.length === 0) {
    throw new Error('Each serving size needs a label and a price');
  }
  if (out.length > 0 && !out.some((o) => o.is_default)) out[0].is_default = true;
  let defaulted = false;
  for (const o of out) {
    if (o.is_default && !defaulted) defaulted = true;
    else o.is_default = false;
  }
  return out;
}

function ServingSizesForm({
  rows,
  onChange,
  count,
}: {
  rows: ServingBulkRow[];
  onChange: (rows: ServingBulkRow[]) => void;
  count: number;
}) {
  const update = (i: number, patch: Partial<ServingBulkRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const setDefault = (i: number) => onChange(rows.map((r, idx) => ({ ...r, is_default: idx === i })));
  const remove = (i: number) => {
    const next = rows.filter((_, idx) => idx !== i);
    if (next.length > 0 && !next.some((r) => r.is_default)) next[0].is_default = true;
    onChange(next);
  };
  const add = () => onChange([...rows, { label: '', volume_ml: '', price: '', is_default: rows.length === 0 }]);

  return (
    <div data-testid="bulk-serving-form">
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
        Set wine serving sizes
      </div>
      <p style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 12 }}>
        Applied to all {count} selected item{count !== 1 ? 's' : ''} — intended for wines. Clear all rows to remove serving sizes.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((row, i) => (
          <div
            key={i}
            data-testid={`bulk-serving-row-${i}`}
            style={{ display: 'grid', gridTemplateColumns: '1fr 64px 72px auto auto', gap: 6, alignItems: 'center' }}
          >
            <input
              data-testid={`bulk-serving-label-${i}`}
              value={row.label}
              placeholder="Glass / Bottle"
              onChange={(e) => update(i, { label: e.target.value })}
              style={{ padding: '7px 8px', borderRadius: 'var(--r-xs)', border: '1px solid var(--border)', fontSize: 13 }}
            />
            <input
              data-testid={`bulk-serving-volume-${i}`}
              value={row.volume_ml}
              inputMode="numeric"
              placeholder="ml"
              onChange={(e) => update(i, { volume_ml: e.target.value.replace(/[^0-9]/g, '') })}
              style={{ padding: '7px 8px', borderRadius: 'var(--r-xs)', border: '1px solid var(--border)', fontSize: 13 }}
            />
            <input
              data-testid={`bulk-serving-price-${i}`}
              value={row.price}
              inputMode="decimal"
              placeholder="$"
              onChange={(e) => update(i, { price: e.target.value.replace(/[^0-9.]/g, '') })}
              style={{ padding: '7px 8px', borderRadius: 'var(--r-xs)', border: '1px solid var(--border)', fontSize: 13 }}
            />
            <button
              type="button"
              data-testid={`bulk-serving-default-${i}`}
              aria-pressed={row.is_default}
              onClick={() => setDefault(i)}
              style={{
                padding: '6px 9px', borderRadius: 'var(--r-xs)', border: '1px solid',
                borderColor: row.is_default ? 'var(--accent, #9333ea)' : 'var(--border)',
                background: row.is_default ? 'var(--accent, #9333ea)' : 'white',
                color: row.is_default ? 'white' : 'var(--text2)', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {row.is_default ? '★' : '☆'}
            </button>
            <button
              type="button"
              data-testid={`bulk-serving-remove-${i}`}
              aria-label="Remove serving size"
              onClick={() => remove(i)}
              style={{ padding: '6px 9px', borderRadius: 'var(--r-xs)', border: '1px solid var(--border)', background: 'white', color: 'var(--text2)', fontSize: 13, cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        data-testid="bulk-serving-add"
        onClick={add}
        style={{ marginTop: 8, padding: '7px 12px', borderRadius: 'var(--r-xs)', border: '1px dashed var(--border)', background: 'white', color: 'var(--text2)', fontSize: 12, cursor: 'pointer' }}
      >
        + Add serving size
      </button>
    </div>
  );
}

function DietaryForm({
  allergenOptions,
  dietaryOptions,
  allergenLabels,
  dietaryLabels,
  pickedTags,
  onToggle,
}: {
  allergenOptions: string[];
  dietaryOptions: string[];
  allergenLabels: Record<string, string>;
  dietaryLabels: Record<string, string>;
  pickedTags: Set<string>;
  onToggle: (tag: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
          Allergens
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {allergenOptions.map((name) => {
            const selected = pickedTags.has(name);
            return (
              <button
                key={name}
                type="button"
                onClick={() => onToggle(name)}
                data-testid={`bulk-allergen-${name.replace(/\s+/g, '-')}`}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '5px 10px',
                  borderRadius: 20,
                  border: selected ? '2px solid #6366f1' : '1px solid var(--border)',
                  background: selected ? '#eef2ff' : 'white',
                  color: selected ? '#4338ca' : 'var(--text2)',
                  cursor: 'pointer',
                }}
              >
                {allergenLabels[name] ?? name}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
          Dietary Restrictions
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {dietaryOptions.map((name) => {
            const selected = pickedTags.has(name);
            return (
              <button
                key={name}
                type="button"
                onClick={() => onToggle(name)}
                data-testid={`bulk-dietary-${name.replace(/\s+/g, '-')}`}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '5px 10px',
                  borderRadius: 20,
                  border: selected ? '2px solid #f59e0b' : '1px solid var(--border)',
                  background: selected ? '#fef3c7' : 'white',
                  color: selected ? '#b45309' : 'var(--text2)',
                  cursor: 'pointer',
                }}
              >
                {dietaryLabels[name] ?? name}
              </button>
            );
          })}
        </div>
      </div>

      {pickedTags.size > 0 && (
        <p style={{ fontSize: 11, color: 'var(--text2)', margin: 0 }}>
          {pickedTags.size} tag{pickedTags.size !== 1 ? 's' : ''} selected — will be added to all selected items.
        </p>
      )}
    </div>
  );
}

function RemoveFromMenuForm(
  { count, onMenuCount, menuName }: { count: number; onMenuCount: number; menuName?: string },
) {
  const skipped = Math.max(0, count - onMenuCount);
  return (
    <div data-testid="remove-from-menu-form">
      <p style={{ fontSize: 13, color: 'var(--text)', margin: '0 0 6px' }}>
        Remove {onMenuCount} item{onMenuCount !== 1 ? 's' : ''} from{' '}
        <strong>{menuName ?? 'this menu'}</strong>?
      </p>
      {skipped > 0 && (
        <p
          data-testid="remove-from-menu-skipped"
          style={{ fontSize: 12, color: 'var(--text3)', margin: '0 0 6px' }}
        >
          {skipped} of {count} selected {skipped === 1 ? 'is' : 'are'} not on this menu and will be skipped.
        </p>
      )}
      <p style={{ fontSize: 12, color: 'var(--text2)', margin: 0 }}>
        They stay in your catalogue and on any other menus — only this menu’s
        placement is removed.
      </p>
    </div>
  );
}

function DeleteForm({ count, confirmed }: { count: number; confirmed: boolean }) {
  return (
    <div>
      <div
        style={{
          background: '#fee2e2',
          border: '1px solid #fca5a5',
          borderRadius: 'var(--r-xs)',
          padding: '12px 14px',
          marginBottom: 14,
        }}
        data-testid="delete-warning"
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: '#b91c1c', marginBottom: 4 }}>
          Permanent deletion
        </div>
        <p style={{ fontSize: 12, color: '#991b1b', margin: 0 }}>
          This will permanently delete {count} item{count !== 1 ? 's' : ''} and remove
          them from all menus. This cannot be undone.
        </p>
      </div>

      {confirmed && (
        <div
          style={{
            background: '#fef3c7',
            border: '1px solid #fcd34d',
            borderRadius: 'var(--r-xs)',
            padding: '10px 14px',
            fontSize: 12,
            color: '#92400e',
          }}
          data-testid="delete-confirm-prompt"
        >
          ⚠️ Click "Confirm — delete {count} items" again to proceed.
        </div>
      )}
    </div>
  );
}

// ── BulkGroupingForm — PDD 2026-05-21 ────────────────────────────────────────
// Form for the Grouping bulk action: name + rule preset + member multi-select
// + 409 conflict banner. Member picker filters the existing food-item pool by
// name (case-insensitive); the selected parents are excluded so a parent
// can't be its own member.

type GroupingPresetKind = 'optional' | 'optionalOne' | 'exactly' | 'atLeast' | 'atMost' | 'between' | 'all';

const GROUPING_PRESETS: { key: GroupingPresetKind; label: string; needsN: boolean; needsMax: boolean }[] = [
  { key: 'optional', label: 'Optional',     needsN: false, needsMax: false },
  { key: 'optionalOne', label: 'Optional 1', needsN: false, needsMax: false },
  { key: 'exactly',  label: 'Exactly N',    needsN: true,  needsMax: false },
  { key: 'atLeast',  label: 'At least N',   needsN: true,  needsMax: false },
  { key: 'atMost',   label: 'At most N',    needsN: true,  needsMax: false },
  { key: 'between',  label: 'Between N–M',  needsN: true,  needsMax: true  },
  { key: 'all',      label: 'All included', needsN: false, needsMax: false },
];

type ExistingCandidate = {
  name: string;
  min_select: number;
  max_select: number | null;
  default_select: 'all' | 'none' | 'first';
  member_ids: string[];
  memberLabel: string;
};

interface BulkGroupingFormProps {
  count: number;
  items: MenuItemDisplay[];
  selectedParents: Set<string>;
  name: string;
  onChangeName: (v: string) => void;
  preset: GroupingPresetKind;
  onChangePreset: (p: GroupingPresetKind) => void;
  presetN: number;
  onChangePresetN: (n: number) => void;
  presetMax: number;
  onChangePresetMax: (n: number) => void;
  memberIds: string[];
  onToggleMember: (id: string) => void;
  onClearMembers: () => void;
  onSelectAllMembers: (idsToAdd: string[]) => void;
  search: string;
  onChangeSearch: (v: string) => void;
  conflicts: Array<{ food_item_id: string; food_item_name: string }>;
  // PDD 2026-05-22 — Add-to-existing mode (opt-in).
  addExistingEnabled: boolean;
  groupingMode: 'existing' | 'create';
  onChangeGroupingMode: (m: 'existing' | 'create') => void;
  existingStatus: 'idle' | 'loading' | 'ready';
  existingCandidates: ExistingCandidate[];
  existingPickedName: string | null;
  onPickExisting: (name: string) => void;
  onRefreshExisting: () => void;
  addMembersMismatches: Array<{ food_item_id: string; food_item_name: string; reason: string }>;
}

function BulkGroupingForm({
  count, items, selectedParents,
  name, onChangeName,
  preset, onChangePreset,
  presetN, onChangePresetN,
  presetMax, onChangePresetMax,
  memberIds, onToggleMember, onClearMembers, onSelectAllMembers,
  search, onChangeSearch,
  conflicts,
  addExistingEnabled,
  groupingMode, onChangeGroupingMode,
  existingStatus, existingCandidates,
  existingPickedName, onPickExisting,
  onRefreshExisting,
  addMembersMismatches,
}: BulkGroupingFormProps) {
  const presetConfig = GROUPING_PRESETS.find((p) => p.key === preset)!;
  const intersectionEmpty = existingStatus === 'ready' && existingCandidates.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 }}>
      {/* Mode selector (PDD 2026-05-22) — only shown when add-to-existing
          is wired by the consumer; admin/waiter without that prop see the
          plain create-only form. */}
      {addExistingEnabled && (
        <div
          data-testid="bulk-grouping-mode-selector"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: '8px 10px',
            background: 'var(--surface-2, #f9fafb)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-xs)',
          }}
        >
          <label style={{
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
            cursor: intersectionEmpty ? 'not-allowed' : 'pointer',
            color: intersectionEmpty ? 'var(--muted)' : 'var(--ink)',
          }}>
            <input
              type="radio"
              data-testid="bulk-grouping-mode-existing"
              name="bulk-grouping-mode"
              checked={groupingMode === 'existing'}
              disabled={intersectionEmpty}
              onChange={() => onChangeGroupingMode('existing')}
              aria-describedby={intersectionEmpty ? 'bulk-grouping-existing-empty-hint' : undefined}
            />
            Add to existing grouping
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
            <input
              type="radio"
              data-testid="bulk-grouping-mode-create"
              name="bulk-grouping-mode"
              checked={groupingMode === 'create'}
              onChange={() => onChangeGroupingMode('create')}
            />
            Create new grouping
          </label>
          {intersectionEmpty && (
            <div
              id="bulk-grouping-existing-empty-hint"
              data-testid="bulk-grouping-existing-empty"
              aria-live="polite"
              style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}
            >
              No groupings shared across these items. Create new instead.
            </div>
          )}
        </div>
      )}

      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
        {groupingMode === 'existing' ? (
          <>Adds members to a grouping shared across {count} selected item{count !== 1 ? 's' : ''}. Members already on a particular item are silently skipped.</>
        ) : (
          <>Creates one custom grouping on each of {count} selected item{count !== 1 ? 's' : ''}. Same name, rule, and members are applied to all. You can edit each grouping independently afterward.</>
        )}
      </div>

      {/* Existing-mode: radio list of shared groupings */}
      {groupingMode === 'existing' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>
            Pick a shared grouping
          </label>
          {existingStatus === 'loading' && (
            <div
              data-testid="bulk-grouping-existing-loading"
              style={{ fontSize: 12, color: 'var(--muted)', padding: '6px 0' }}
            >
              Finding shared groupings…
            </div>
          )}
          {existingStatus === 'ready' && existingCandidates.length > 0 && (
            // Cap + scroll the candidate list so it can't consume the
            // vertical space the fillHeight member picker needs below it.
            // Without this, add-to-existing mode (many shared groupings)
            // squeezes the picker rows to ~0 height and the chip rail ends
            // up overlapping them (the 7ff3123 / 172492f interception).
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto', flexShrink: 0 }}>
              {existingCandidates.map((c) => (
                <label
                  key={c.name}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    fontSize: 12, padding: '6px 8px',
                    border: `1px solid ${existingPickedName === c.name ? 'var(--brand)' : 'var(--border)'}`,
                    background: existingPickedName === c.name ? 'var(--brand-l)' : '#fff',
                    borderRadius: 'var(--r-xs)', cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    data-testid={`bulk-grouping-existing-radio-by-name-${c.name}`}
                    name="bulk-grouping-existing-pick"
                    checked={existingPickedName === c.name}
                    onChange={() => onPickExisting(c.name)}
                  />
                  <span style={{ fontWeight: 500 }}>{c.name}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>
                    {c.memberLabel}
                  </span>
                </label>
              ))}
            </div>
          )}
          <button
            type="button"
            data-testid="bulk-grouping-existing-refresh-btn"
            onClick={onRefreshExisting}
            style={{
              alignSelf: 'flex-start',
              fontSize: 11, padding: '4px 8px',
              background: '#fff', border: '1px solid var(--border)',
              borderRadius: 'var(--r-xs)', cursor: 'pointer',
            }}
          >
            Refresh
          </button>
        </div>
      )}

      {/* Create-mode: Name + Rule preset */}
      {groupingMode === 'create' && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>
              Grouping name
            </label>
            <input
              data-testid="bulk-grouping-name-input"
              type="text"
              value={name}
              onChange={(e) => onChangeName(e.target.value)}
              placeholder="e.g. Extras, Add-ons, Spice Level"
              maxLength={64}
              style={{
                padding: '8px 10px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-xs)',
                fontSize: 13,
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>
              Selection rule
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {GROUPING_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  data-testid={`bulk-grouping-rule-preset-${p.key}`}
                  onClick={() => onChangePreset(p.key)}
                  style={{
                    padding: '5px 10px',
                    fontSize: 12,
                    border: `1px solid ${preset === p.key ? 'var(--brand)' : 'var(--border)'}`,
                    background: preset === p.key ? 'var(--brand-l)' : '#fff',
                    color: preset === p.key ? 'var(--brand-s)' : 'var(--ink)',
                    borderRadius: 'var(--r-xs)',
                    cursor: 'pointer',
                    fontWeight: preset === p.key ? 600 : 400,
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {presetConfig.needsN && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>N:</span>
                <input
                  data-testid="bulk-grouping-rule-n-input"
                  type="number"
                  min={1}
                  value={presetN}
                  onChange={(e) => onChangePresetN(Math.max(1, parseInt(e.target.value || '1', 10)))}
                  style={{ width: 60, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12 }}
                />
                {presetConfig.needsMax && (
                  <>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>M:</span>
                    <input
                      data-testid="bulk-grouping-rule-max-input"
                      type="number"
                      min={presetN}
                      value={presetMax}
                      onChange={(e) => onChangePresetMax(Math.max(presetN, parseInt(e.target.value || String(presetN), 10)))}
                      style={{ width: 60, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12 }}
                    />
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* Member picker — extracted into shared `BulkMemberPicker`
          component (PDD 2026-05-22 Step 7). testidPrefix='bulk-grouping'
          preserves every existing E2E selector byte-for-byte.
          enableTypeTabs + enableCategoryFilter scope the pool to the
          active dishes/add-ons tab and the chosen canonical-category
          chip — matches the parity behaviour of the Add-to-Grouping
          modal (ItemSearchPicker) and Bulk Action drawer
          (TagBulkApplyDrawer) for the same picker UX. */}
      <BulkMemberPicker
        pool={items}
        selectedIds={memberIds}
        search={search}
        onToggle={onToggleMember}
        onClearAll={onClearMembers}
        onChangeSearch={onChangeSearch}
        onSelectAll={onSelectAllMembers}
        testidPrefix="bulk-grouping"
        excludeIds={[...selectedParents]}
        searchPlaceholder="Search food items to add as members…"
        selectedCountSuffix={groupingMode === 'create' ? ' — optional' : ''}
        enableTypeTabs
        enableCategoryFilter
        fillHeight
      />

      {/* Create-mode conflict banner */}
      {conflicts.length > 0 && (
        <div
          data-testid="bulk-grouping-error-banner"
          role="alert"
          style={{
            background: '#fee2e2',
            border: '1px solid #fca5a5',
            borderRadius: 'var(--r-xs)',
            padding: '10px 12px',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: '#b91c1c', marginBottom: 4 }}>
            Name conflict on {conflicts.length} item{conflicts.length !== 1 ? 's' : ''}
          </div>
          <div style={{ fontSize: 11, color: '#991b1b', marginBottom: 6 }}>
            These items already have a grouping named "{name.trim()}". Rename your grouping
            or deselect these items, then try again.
          </div>
          <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 11, color: '#991b1b' }}>
            {conflicts.map((c) => (
              <li
                key={c.food_item_id}
                data-testid={`bulk-grouping-conflict-row-${c.food_item_id}`}
              >
                {c.food_item_name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Existing-mode 409 PARTIAL_MISMATCH banner — same shape as remove */}
      {addMembersMismatches.length > 0 && (
        <div
          data-testid="bulk-grouping-existing-error-banner"
          role="alert"
          style={{
            background: '#fee2e2',
            border: '1px solid #fca5a5',
            borderRadius: 'var(--r-xs)',
            padding: '10px 12px',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: '#b91c1c', marginBottom: 4 }}>
            Grouping changed on {addMembersMismatches.length} item{addMembersMismatches.length !== 1 ? 's' : ''}
          </div>
          <div style={{ fontSize: 11, color: '#991b1b', marginBottom: 6 }}>
            The expected grouping no longer matches. Refresh and try again.
          </div>
          <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 11, color: '#991b1b' }}>
            {addMembersMismatches.map((m) => (
              <li
                key={m.food_item_id}
                data-testid={`bulk-grouping-existing-mismatch-row-${m.food_item_id}`}
              >
                {m.food_item_name} — {m.reason}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={onRefreshExisting}
            style={{
              marginTop: 8,
              fontSize: 11, padding: '4px 8px',
              background: '#fff', border: '1px solid #fca5a5',
              borderRadius: 'var(--r-xs)', cursor: 'pointer',
              color: '#991b1b',
            }}
          >
            Refresh
          </button>
        </div>
      )}
    </div>
  );
}

// PickerRow moved into ./BulkMemberPicker.tsx (PDD 2026-05-22 Step 7).


// ── BulkRemoveGroupingForm — PDD 2026-05-21 sibling ──────────────────────────
// Form for the Remove grouping bulk action: parallel discovery + radio
// candidate list + per-parent load-error rows + 409 mismatch banner with
// Refresh button.

interface BulkRemoveGroupingFormProps {
  count: number;
  status: 'idle' | 'loading' | 'ready';
  candidates: Array<{
    name: string;
    min_select: number;
    max_select: number | null;
    default_select: 'all' | 'none' | 'first';
    member_ids: string[];
    memberLabel: string;
  }>;
  loadErrors: Array<{ item_id: string; item_name: string }>;
  pickedName: string | null;
  onPick: (name: string) => void;
  onRetryParent: (itemId: string) => void;
  mismatches: Array<{ food_item_id: string; food_item_name: string; reason: string }>;
  onRefresh: () => void;
  executing: boolean;
}

function BulkRemoveGroupingForm({
  count, status, candidates, loadErrors, pickedName, onPick,
  onRetryParent, mismatches, onRefresh, executing,
}: BulkRemoveGroupingFormProps) {
  const reasonLabel: Record<string, string> = {
    NOT_FOUND: 'no longer has this grouping',
    MEMBERS_DIFFER: 'members differ from expected',
    IS_DEFAULT: 'matched a default grouping (not removable)',
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
        Removes one custom grouping that is shared across all {count} selected
        item{count !== 1 ? 's' : ''}. Strict match: same name + rule + exact
        member set. Defaults (Add-ons / Includes / Choose-One / Recommendations)
        are excluded.
      </div>

      {status === 'loading' && (
        <div
          data-testid="bulk-remove-grouping-loading"
          style={{ fontSize: 12, color: 'var(--muted)', padding: 12, textAlign: 'center' }}
        >
          Loading shared groupings…
        </div>
      )}

      {loadErrors.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {loadErrors.map((err) => (
            <div
              key={err.item_id}
              data-testid={`bulk-remove-grouping-load-error-${err.item_id}`}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '6px 10px', fontSize: 11,
                background: '#fef3c7', border: '1px solid #fcd34d',
                borderRadius: 'var(--r-xs)', color: '#92400e',
              }}
            >
              <span>Couldn't load groupings for "{err.item_name}"</span>
              <button
                type="button"
                data-testid={`bulk-remove-grouping-load-retry-${err.item_id}`}
                onClick={() => onRetryParent(err.item_id)}
                style={{
                  background: 'transparent', border: '1px solid #92400e',
                  borderRadius: 'var(--r-xs)', padding: '2px 8px',
                  fontSize: 11, color: '#92400e', cursor: 'pointer',
                }}
              >
                Retry
              </button>
            </div>
          ))}
        </div>
      )}

      {status === 'ready' && candidates.length === 0 && (
        <div
          data-testid="bulk-remove-grouping-empty"
          style={{
            fontSize: 12, color: 'var(--muted)',
            padding: 12, textAlign: 'center',
            background: '#f9fafb', border: '1px solid var(--border)',
            borderRadius: 'var(--r-xs)',
          }}
        >
          No custom groupings shared across all selected items.
        </div>
      )}

      {status === 'ready' && candidates.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {candidates.map((c) => {
            const testidKey = c.name.trim().toLowerCase();
            return (
              <label
                key={c.name}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 10px',
                  border: `1px solid ${pickedName === c.name ? 'var(--brand)' : 'var(--border)'}`,
                  background: pickedName === c.name ? 'var(--brand-l)' : '#fff',
                  borderRadius: 'var(--r-xs)',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                <input
                  type="radio"
                  name="bulk-remove-grouping-pick"
                  data-testid={`bulk-remove-grouping-radio-by-name-${testidKey}`}
                  checked={pickedName === c.name}
                  onChange={() => onPick(c.name)}
                  disabled={executing}
                />
                <span style={{ flex: 1 }}>{c.name}</span>
                <span
                  data-testid={`bulk-remove-grouping-member-count-${testidKey}`}
                  style={{ fontSize: 11, color: 'var(--muted)' }}
                >
                  {c.memberLabel}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {executing && (
        <div
          data-testid="bulk-remove-grouping-submit-progress"
          style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}
        >
          Removing…
        </div>
      )}

      {mismatches.length > 0 && (
        <div
          data-testid="bulk-remove-grouping-error-banner"
          role="alert"
          style={{
            background: '#fee2e2',
            border: '1px solid #fca5a5',
            borderRadius: 'var(--r-xs)',
            padding: '10px 12px',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: '#b91c1c', marginBottom: 4 }}>
            Strict match failed on {mismatches.length} item{mismatches.length !== 1 ? 's' : ''}
          </div>
          <div style={{ fontSize: 11, color: '#991b1b', marginBottom: 6 }}>
            Another tab or owner may have edited these groupings while you were
            choosing. Click Refresh to re-discover the shared groupings.
          </div>
          <ul style={{ margin: '0 0 8px 0', padding: '0 0 0 16px', fontSize: 11, color: '#991b1b' }}>
            {mismatches.map((m) => (
              <li
                key={m.food_item_id}
                data-testid={`bulk-remove-grouping-mismatch-row-${m.food_item_id}`}
              >
                {m.food_item_name} — {reasonLabel[m.reason] ?? m.reason}
              </li>
            ))}
          </ul>
          <button
            type="button"
            data-testid="bulk-remove-grouping-refresh-btn"
            onClick={onRefresh}
            style={{
              background: '#fff', border: '1px solid #b91c1c',
              borderRadius: 'var(--r-xs)', padding: '4px 10px',
              fontSize: 11, fontWeight: 600, color: '#b91c1c',
              cursor: 'pointer',
            }}
          >
            Refresh
          </button>
        </div>
      )}
    </div>
  );
}

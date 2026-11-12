'use client';
import { useMenuManagerService } from '../context';
import { useTrackAction } from '../track-action-context';

import { Fragment, useRef, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Upload, Camera, Trash2, Eye, AlertCircle, ScanEye, ChevronDown, Check, Images, TriangleAlert, Copy,
  Tag, Leaf, SlidersHorizontal, Database, Wine, ChefHat, Settings, BarChart3, Utensils,
  type LucideIcon,
} from 'lucide-react';
import { itemScopeLine, menuPricingHint, placementPath } from '../lib/editModalScope';
import { FoodItemPreviewModal } from '../../preview/FoodItemPreviewModal';
import type {MenuItemDisplay, MenuSummary, FoodTags, BeverageTags, AddonEntry, RecommendationEntry, MenuItemPerformancePeriod, MenuItemPerformanceResponse, MenuAssociation, MenuItemJunctionSettings, ServingOption} from '../../../types/restaurant';
import { FOOD_TAG_FIELD_MAP, toCanonical, BOOST_LABELS, asArray, type BoostLabel } from '../lib/menuUtils';
import { parsePriceInput } from '../../../utils/price';
import { useCurrencySymbol } from '../../../context/CurrencyContext';
import {
  DEFAULT_HEAT_LABELS,
  DEFAULT_SWEETNESS_LABELS,
  BEVERAGE_TYPES,
  BASE_SPIRITS,
  WINE_VARIETIES,
  BEER_STYLES,
  FLAVOR_NOTES,
  SERVING_STYLES,
  DRINK_STRENGTHS,
} from '../../../constants/food-tags';
import Select from '../../common/Select';
import RawCategorySelect from './RawCategorySelect';
import { processImageForUpload } from '../../../utils/imageProcessing';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { broadcastRecommendationChange, onRecommendationChange } from '../../../utils/recommendation-broadcast';
import { broadcastAddonChange, onAddonChange } from '../../../utils/addon-broadcast';
import { isAllergensReviewed, isDietaryReviewed } from '../../../utils/foodTagsReview';
import { SWEETNESS_VISIBLE } from '../../../constants/feature-flags';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EditModalProps {
  item: MenuItemDisplay;
  restaurantId?: string;
  menus?: MenuSummary[];
  /** All non-addon dish items — used to populate the Dishes tab when editing an addon item */
  allItems?: MenuItemDisplay[];
  /** Owner-created (possibly empty) food categories — union'd into the Raw
   *  Category dropdown so newly-added categories are selectable (PDD 2026-06-12 #3). */
  ownerFoodCategories?: string[];
  onClose: () => void;
  /** Called with the fully merged updated item after save, or with _deleted: true after delete */
  onComplete: (updated: MenuItemDisplay & { _deleted?: boolean }) => void;
  /** G4 — fires with `true` while a save (or clone save) is in flight and
   *  `false` when it settles / on unmount, so an inline host can ignore its
   *  own scrim click and Escape key for the duration. The modal's own ×,
   *  Cancel and backdrop are already gated internally. */
  onSavingChange?: (saving: boolean) => void;
  /** Called when user clicks a menu chip — close modal and navigate to that menu+item */
  onNavigateToMenu?: (menuId: string, itemId: string) => void;
  /** STR-977 — builds the URL for a menu placement so the compact placement
   *  tiles can open the menu in a NEW browser tab (preserving the open editor).
   *  Optional: when absent (waiter/admin) the tiles render as non-link cards. */
  getMenuHref?: (menuId: string, itemId: string) => string;
  /** True when the modal was opened via "Add Item". Historically gated the
   *  Dishes/Add-ons type toggle to new-item flow only; as of 2026-07-02 the
   *  toggle also shows in edit mode so owners can convert an existing item's
   *  type inline (dish ↔ addon). This prop is still forwarded for other
   *  flow-differentiating logic (rename gates, deferred creation). */
  isNewItem?: boolean;
  /** When true, forces addon mode and hides the Dish/Add-on toggle (used when creating addons from the Setup Guide). */
  forceAddon?: boolean;
  /** When adding an option UNDER a modifier type (STR-956), the type's name
   *  (e.g. "Sauce"). Makes the name placeholder type-specific, HIDES the Price
   *  field (a modifier option's price is optional), and rewords the memo hint.
   *  Undefined/null for plain add-ons and dishes — their behaviour is unchanged. */
  modifierTypeName?: string | null;
  /** When true, locks the new item to dish mode and hides the Dish/Add-on toggle.
   *  Used when the owner has already declared dish intent through a chooser
   *  (e.g. food-items page → Add new item → Dish), so a redundant inline
   *  toggle would only invite mistakes. */
  forceDish?: boolean;
  /**
   * Opens the POS link picker for this item (PDD 2026-08-31, many-to-one).
   *
   * A CALLBACK, not the picker itself: the picker talks to `@qrate/owner-api`,
   * and this package has no dependency on it — nor should it, since waiter and
   * admin mount EditModal too and have no business linking POS products. The
   * owner app owns the modal and hands this down; every other surface passes
   * nothing and the row simply does not render.
   */
  onOpenPosLink?: () => void;
  /** This item's POS linkage: 'confirmed' | 'suggested' | null. Only a
   *  CONFIRMED link satisfies the gate — a suggestion is the importer's
   *  unapproved guess and the dish is still unsellable. */
  posLinkStatus?: string | null;
  /** WHICH POS product this dish points at, for the row's detail line.
   *
   *  The status alone answers "is it linked", never "linked to what" — and a
   *  dish linked to the WRONG product reads exactly like a correctly-linked
   *  one, both saying "Linked". An owner reconciling a menu against their till
   *  cannot spot a mis-link without this.
   *
   *  Null when there is no link, and ALSO null when the link points at a
   *  provider id that has since left the staged catalogue. That second case
   *  still shows as linked, because it still gates sellability. */
  posLinkName?: string | null;
  /** The POS product's price. Already a number — the backend converts the
   *  NUMERIC column, which would otherwise arrive as a string and throw on
   *  toFixed. Null is a real state (Clover omits a price for items priced
   *  entirely by their modifiers) and renders as no price rather than $0.00. */
  posLinkPrice?: number | null;
  /** The gate's own answer: whether a diner can actually order this item.
   *  Can disagree with a confirmed link while the recompute catches up. */
  posSellable?: boolean;
  /** Dish IDs to pre-select on the Dishes tab (used when creating an addon from a specific dish card). */
  preselectedDishIds?: string[];
  /**
   * Called after a dish's addons array is mutated from the Dishes tab of an addon editor.
   * Lets the parent update its cached items so the addon↔dish association is visible
   * both on reopen of the addon modal and when later editing the dish directly.
   */
  onDishAddonsChange?: (dishId: string, nextAddons: AddonEntry[]) => void;
  /**
   * For new items only (isNewItem=true): called on Save instead of service.updateMenuItem.
   * Enables deferred creation — the DB row is only written when the user completes the form,
   * eliminating orphaned "New item" rows when the modal is dismissed without saving.
   */
  onSaveNewItem?: (data: {
    name: string;
    description: string;
    category: string;
    food_tags: FoodTags;
    item_type: 'dish' | 'addon';
    price?: number | null;
    memo?: string | null;
  }) => Promise<MenuItemDisplay>;
  /** When provided, allergens and dietary restrictions use the dietary-tags API instead of free-text input. */
  dietaryTagService?: DietaryTagService;
  /** Owner-added (custom) allergens for this restaurant, beyond the FDA-9
   *  canonical set. Appended to the allergen pill picker so newly-defined
   *  allergens are immediately selectable on the item. Consumer is the
   *  source of truth — usually the same array loaded for the customization
   *  tab on the Food Items page. */
  customAllergens?: string[];
  /** Owner-added (custom) dietary restrictions, beyond the canonical 5
   *  (vegetarian / vegan / gluten-free / kosher / halal). Same wiring as
   *  customAllergens. */
  customDietary?: string[];
  /** Per-restaurant *effective* canonical allergen defaults — the FDA-9 set
   *  minus any the owner has hidden. When provided, replaces the hardcoded
   *  FDA_BIG_9_ALLERGENS base for the pill picker so hidden defaults don't
   *  reappear. Omitted (waiter/admin) → falls back to FDA_BIG_9_ALLERGENS. */
  allergenDefaults?: string[];
  /** Per-restaurant *effective* canonical dietary defaults — the canonical 5
   *  minus any the owner has hidden via hidden-dietary-defaults (STR-483).
   *  When provided, replaces the hardcoded DIETARY_RESTRICTIONS_LIST base so
   *  a deleted/hidden default (e.g. kosher, halal) no longer shows as a
   *  pickable pill. Omitted (waiter/admin) → falls back to the hardcoded 5. */
  dietaryDefaults?: string[];
  /** Per-restaurant spice scale labels. Falls back to the default 5-level palette. */
  heatLabels?: string[];
  /** Per-restaurant sweetness scale labels. Falls back to the default 4-level palette. */
  sweetnessLabels?: string[];
  /** Called when the owner changes the sweetness label on a Desserts item — persists via the sweetness API. */
  onSweetnessUpdate?: (itemId: string, label: string | null) => Promise<void>;
  /** Called when the owner changes the heat/spice label on an item — persists via the spice API. */
  onHeatSpiceUpdate?: (itemId: string, label: string | null) => Promise<void>;
  /**
   * Optional render-prop slot for an external image-library button (e.g. the
   * Setup Guide v2 AssociateImageModal flow). Rendered in the image actions
   * row only when the item has no thumbnail. The consumer renders the trigger
   * + its own modal, and calls `onPicked(thumbnailUrl)` once an image is
   * attached so EditModal updates its local thumbnail state without needing
   * a full reopen.
   */
  imageLibrarySlot?: (handlers: {
    itemId: string;
    itemName: string;
    onPicked: (thumbnailUrl: string) => void;
  }) => ReactNode;
  /**
   * Optional render-prop slot for an in-place image gallery panel that
   * takes over the right-side tab content area when the owner clicks
   * the "Choose from Gallery" button below the image. Differs from
   * imageLibrarySlot (which opens an external modal): this slot stays
   * within the EditModal and replaces the tab bar + content with the
   * gallery picker UI. The slot is responsible for rendering its own
   * back/close affordance — calling `onClose` returns to the tab view.
   * `onPicked(url)` updates the local thumbnail and dismisses the panel.
   */
  galleryPanelSlot?: (handlers: {
    itemId: string;
    itemName: string;
    onPicked: (thumbnailUrl: string) => void;
    onClose: () => void;
  }) => ReactNode;
  /**
   * Optional render-slot for the BYO Groupings authoring UI. When provided,
   * a "Groupings" tab is added to the tab bar (next to Recommendations) and
   * the slot's content is rendered inside that tab. The consumer is
   * responsible for whether to provide content (typically: only pass a
   * slot for saved non-addon items so the Groupings tab appears). The
   * grouping authoring API lives in the consumer app's service layer, not
   * in this shared package.
   */
  groupingsSlot?: ReactNode;
  /**
   * Optional render-slot for the Pairings tab. When provided, a "Pairings"
   * tab is added to the tab bar after "Modifiers" and the slot's content is
   * rendered inside it.
   *
   * Pairings is the dish-to-dish `recommendations` default grouping, split
   * out of the Modifiers tab (2026-09-02). The two answer different
   * questions — "what can the diner change about THIS dish" versus "what
   * other dish goes with it" — and only the first is a modifier. Consumers
   * pass a GroupingsSection scoped to `surface="pairings"`.
   *
   * Optional so a consumer that hasn't split its slot yet keeps the previous
   * single-tab behaviour rather than losing the recommendations grouping.
   */
  pairingsSlot?: ReactNode;
  /**
   * Optional render-slot for the Recipe tab (owner Kitchen Ops, 2026-10-18).
   * When provided for a saved dish, a "Recipe" tab is added right after
   * "Dish Properties" (a section on mobile) and the slot's content is
   * rendered inside it. The consumer decides whether the restaurant has
   * recipes at all (feature flag) and owns the recipe API; other consumers
   * don't pass it and see no tab.
   */
  recipeSlot?: ReactNode;
  /**
   * Optional render-slot for the Placements tab's overlap surface. When
   * supplied, the node is rendered above the per-menu placement cards
   * inside the Placements tab content area. Consumers (owner-webapp)
   * use this to surface the cross-menu overlap comparison panel +
   * rationale composer next to the placements that produced them.
   * Other consumers (waiter, admin) leave it unset and get just the
   * placement cards. Kept as an opaque ReactNode so the overlap-specific
   * types (OverlapItem, OverlapPlacement) stay in the owner-webapp app
   * and don't leak into the shared package.
   */
  placementsOverlapSlot?: ReactNode;
  /**
   * PDD 2026-05-26 — count of food_item_groupings for this dish. Used to
   * disable the BYO toggle when zero groupings exist (the API would
   * reject is_byo=true with BYO_REQUIRES_GROUPINGS otherwise). Consumers
   * pass the same count the Groupings tab is rendering. Omitted/undefined
   * is treated as 0 (toggle disabled) for safety.
   */
  groupingsCount?: number;
  /**
   * Description review-queue state — opt-in. When the item's description
   * is an unreviewed AI suggestion (source='ai_generated' AND reviewed=
   * false), the description field renders with an amber tint, an
   * "AI SUGGESTED" eyebrow, and an Accept button alongside Save so the
   * owner can confirm the suggestion verbatim without round-tripping
   * through the Setup Guide condition-items page. Consumers that don't
   * track review state simply omit these props.
   */
  descriptionSource?: string | null;
  descriptionReviewed?: boolean;
  /**
   * Called when the owner clicks Accept on an AI-suggested description.
   * Backend should flip description_source='manual' +
   * description_reviewed=true while keeping the current text. Consumer
   * decides whether to close the modal after the resolved promise.
   */
  onAcceptDescription?: (itemId: string) => Promise<void>;
  /**
   * 'modal' (default) — fixed-position overlay with backdrop. Used by the
   * Menu page when the owner clicks the pencil-edit icon on a row.
   * 'inline' — renders the same body inside its parent (no backdrop, no
   * fixed positioning, fills 100% of parent width/height). Used by the
   * Food Items page where the editor is the always-visible right panel.
   * In inline mode the close button still calls `onClose`, but consumers
   * can choose to map that to "clear selection" rather than "dismiss".
   */
  displayMode?: 'modal' | 'inline';
  /** Optional optimistic-update hook fired when in-modal mutations
   *  (dietary tag chips, N/A toggles) change food_tags on the server.
   *  Lets the parent patch its items mirror so derived UI — e.g. the
   *  Food Items page "Allergens & Dietary" filter counter — reflects
   *  the change without a full refetch. Receives a partial item; the
   *  parent merges it onto the existing record. */
  onItemUpdate?: (patch: { id: string; food_tags: FoodTags }) => void;
  /**
   * Optional admin-only callback to (re-)run AI enrichment for this item.
   * When provided, the action bar renders an "Enrich with AI" button next
   * to Save. Owner-webapp does NOT pass this prop — owners cannot trigger
   * enrichment manually (auto-fires on item create via handleSaveNewItem).
   *
   * The consumer is responsible for calling the recommender's
   * POST /recommendation/menu-items/{id}/enrich endpoint and returning
   * the resulting tag payload. The EditModal patches local food_tags
   * state from the returned food_tags on success.
   *
   * skipped_reason is surfaced as a soft notice (e.g. manual-protected
   * items echo back without re-running Claude).
   */
  onEnrichItem?: (itemId: string) => Promise<{
    food_tags?: FoodTags;
    enrichment_status?: string;
    food_tags_source?: string;
    skipped_reason?: string;
  }>;
  /**
   * Duplicate flow — opt-in. When the consumer provides `onCloneRequest`,
   * the modal renders a Duplicate button in the header (visible only for
   * existing items, not while editing a new draft or already cloning).
   * The consumer is responsible for closing the current modal and
   * reopening it with `cloneMode=true`, `cloneSourceName=item.name`,
   * `sourceItemId=item.id`, and an `item` seeded as
   * `{ ...source, name: source.name + ' (Copy)' }` so the owner lands on
   * a pre-filled rename UI.
   */
  onCloneRequest?: (item: MenuItemDisplay) => void;
  /**
   * 'v5' = the owner Menu workspace design (QRate_Menu_handoff_v5.0): no
   * "Shared item" scope band, primary button "Save", footer "Clone item" +
   * "Delete item" (inline "Delete <name> from your library?" Delete / Keep)
   * instead of the More actions menu, 900px wide. 'classic' (default) is
   * unchanged for the other consumers (admin).
   */
  shell?: 'classic' | 'v5';
  /**
   * Clone-draft state. When true, the Save Changes button is replaced by
   * a "Save Copy" button that calls `onCloneSave` with the source item
   * id + the (validated) new name. The name input renders a red border +
   * helper text and the Save button is disabled until the name:
   *   - is non-empty after trim
   *   - differs from `cloneSourceName`
   *   - does not contain the substring "copy" (case-insensitive)
   * These rules mirror the server-side validation in
   * `clone_owner_menu_item` (defence in depth).
   */
  cloneMode?: boolean;
  /** Source item's name — required when cloneMode=true. */
  cloneSourceName?: string;
  /** Source item id — required when cloneMode=true; passed back to onCloneSave. */
  sourceItemId?: string;
  /**
   * Called when the owner clicks Save Copy in a clone draft. Consumer
   * hits `POST /owner/menu/items/{sourceItemId}/clone` with `{ name }`.
   * Resolved value is the new item shape returned by the backend (id +
   * name + restaurant_id + item_type + source_id). EditModal calls
   * onClose after a successful clone — the consumer can re-fetch and
   * reopen the editor on the new id if desired.
   */
  onCloneSave?: (sourceItemId: string, newName: string) => Promise<{
    id: string;
    name: string;
    restaurant_id: string;
    item_type?: string;
    source_id?: string;
  }>;
}

// ── Food tag fields shown in the editor (heat_spice, allergens, dietary handled separately) ──

// STR-963 P1 — the full-width flag drives the Food Tags card grid. The
// emoji that sat beside each panel name were removed 2026-11-11 (Avi): no
// other panel in the app carries one.
const TAG_FIELDS: { key: keyof FoodTags; label: string; placeholder: string; full?: boolean }[] = [
  { key: 'ingredients',    label: 'Ingredients',    placeholder: 'e.g. chicken, lemon…', full: true },
  { key: 'cooking_method', label: 'Cooking method',  placeholder: 'e.g. grilled, fried…' },
  { key: 'textures',       label: 'Texture',          placeholder: 'e.g. crispy, creamy…' },
  { key: 'taste_profile',  label: 'Taste profile',   placeholder: 'e.g. savoury, smoky…', full: true },
  { key: 'seasons',        label: 'Seasonal',         placeholder: 'e.g. summer, winter…' },
  { key: 'festivity',      label: 'Festivities',      placeholder: 'e.g. Christmas, Diwali…' },
];

// ── Wine identity + facet constants (PLAN 2026-08-04 M5) ──────────────────────

// Old/New-World country maps — MUST mirror the backend's closed maps
// (qrate-core drink_defaults.derive_old_world). The chip derives locally for
// instant feedback; the server re-derives authoritatively on PATCH, and a
// contradicting explicit value is rejected with code=inconsistent_pair — so
// the modal only SENDS wine_old_world when the country is absent/unknown.
const OLD_WORLD_COUNTRIES = new Set([
  'france', 'italy', 'spain', 'portugal', 'germany', 'austria', 'greece',
  'hungary', 'georgia', 'croatia', 'slovenia', 'switzerland', 'romania',
  'bulgaria', 'moldova', 'armenia', 'cyprus', 'lebanon', 'turkey', 'england',
  'united kingdom',
]);
const NEW_WORLD_COUNTRIES = new Set([
  'usa', 'united states', 'united states of america', 'australia',
  'new zealand', 'argentina', 'chile', 'south africa', 'canada', 'uruguay',
  'brazil', 'mexico', 'china', 'japan', 'india', 'peru', 'bolivia',
]);

/** true = Old World, false = New World, null = unknown/absent country. */
export function deriveOldWorld(country: string | null | undefined): boolean | null {
  const c = (country ?? '').trim().toLowerCase();
  if (!c) return null;
  if (OLD_WORLD_COUNTRIES.has(c)) return true;
  if (NEW_WORLD_COUNTRIES.has(c)) return false;
  return null;
}

// Closed dish-pairing vocab (mirrors the server's WINE_DISH_PAIRINGS
// whitelist on the PATCH `beverage` sub-object) + human chip labels.
const WINE_DISH_PAIRING_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'red_meat', label: 'Red meat' },
  { value: 'poultry', label: 'Poultry' },
  { value: 'seafood', label: 'Seafood' },
  { value: 'pasta', label: 'Pasta' },
  { value: 'cheese', label: 'Cheese' },
  { value: 'dessert', label: 'Dessert' },
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'spiced', label: 'Spiced' },
];

// 0-100 taste scalars rendered as sliders in the wine sub-section. Tannin
// is color-conditional (red/dessert only) at render time.
const WINE_TASTE_SCALE_AXES: Array<{
  key: 'body' | 'sweetness' | 'tannin' | 'acidity' | 'alcohol';
  label: string;
}> = [
  { key: 'body', label: 'Body' },
  { key: 'sweetness', label: 'Sweetness' },
  { key: 'tannin', label: 'Tannin' },
  { key: 'acidity', label: 'Acidity' },
  { key: 'alcohol', label: 'Alcohol' },
];

// Server-side merge whitelist for the PATCH `beverage` sub-object — mirrors
// _BEVERAGE_PATCH_KEYS in qrate-core owner_food_items.py. Keys outside this
// list 400 with code=unknown_key, so the merge-channel payload is filtered
// to it (notably `sweetness`, `beer_style` and `base_spirit` still travel
// via the legacy food_tags channel only).
const BEVERAGE_MERGE_KEYS = new Set([
  'beverage_type', 'alcoholic', 'wine_variety', 'wine_color', 'wine_style',
  'wine_sweetness', 'wine_body', 'wine_pairing', 'flavor_notes',
  'key_ingredients', 'served', 'strength', 'tannin', 'acidity', 'oak',
  'taste_scales', 'dish_pairings', 'tasting_note',
  'short_story', 'long_story', 'story_source',
]);

// ── Allergen / dietary constants (mirrors owner-dietary-service) ───────────────

// Canonical slugs — must match backend FDA_BIG_9 and CANONICAL_DIETARY sets exactly.
const FDA_BIG_9_ALLERGENS = [
  'dairy', 'eggs', 'fish', 'shellfish',
  'tree-nuts', 'peanuts', 'wheat', 'soy', 'sesame',
] as const;

const DIETARY_RESTRICTIONS_LIST = [
  'vegetarian', 'vegan', 'gluten-free', 'kosher', 'halal',
] as const;

const ALLERGEN_LABELS: Record<string, string> = {
  dairy: 'Dairy', eggs: 'Eggs', fish: 'Fish',
  shellfish: 'Shellfish', 'tree-nuts': 'Tree Nuts',
  peanuts: 'Peanuts', wheat: 'Wheat', soy: 'Soy', sesame: 'Sesame',
};

const DIETARY_LABELS: Record<string, string> = {
  vegetarian: 'Vegetarian', vegan: 'Vegan', 'gluten-free': 'Gluten-Free',
  kosher: 'Kosher', halal: 'Halal',
};

/** Render a slug-style canonical label as a display string when no
 *  curated label is set in ALLERGEN_LABELS / DIETARY_LABELS. Splits on
 *  hyphens, title-cases each word ("new-allergen" → "New Allergen"). */
function slugToLabel(slug: string): string {
  return slug
    .split('-')
    .map((part) => part.length > 0 ? part[0]!.toUpperCase() + part.slice(1) : part)
    .join(' ');
}

// ── Dietary tag service interface (injected from consumer app) ─────────────────
//
// PR 3 of the allergens/dietary consolidation (2026-05-08): the per-tag
// junction table is gone. Allergens and dietary are stored directly on
// menu_items.food_tags->'allergens' / food_tags->'dietary' as plain
// string arrays. The service collapses to a single setItemTags writer —
// EditModal reads current tags from item.food_tags and computes the new
// array client-side on toggle, then PATCHes through this service.

export interface DietaryTagService {
  /** Replace the allergens or dietary array (or both) for an item.
   *  Backend rewrites food_tags->'allergens' / 'dietary' atomically and
   *  flips the matching *_state to 'manually_accepted'. */
  setItemTags: (
    restaurantId: string,
    itemId: string,
    update: { allergens?: string[]; dietary?: string[] },
  ) => Promise<void>;
  /** Set the per-item review state for one tag category. Drives the N/A
   *  chip in the EditModal — clicking it toggles state between
   *  'ai_suggested' (yellow background) and 'manually_accepted' (no
   *  background). Defaults to 'manually_accepted' for backward compat
   *  with callers that just want the one-shot "I've reviewed" action. */
  markReviewed?: (
    itemId: string,
    type: 'allergens' | 'dietary',
    state?: 'ai_suggested' | 'manually_accepted',
  ) => Promise<void>;
}

// ── TagInput ──────────────────────────────────────────────────────────────────

function TagInput({
  label,
  values,
  placeholder,
  onChange,
  fieldKey,
}: {
  label: string;
  values: string[];
  placeholder: string;
  onChange: (newValues: string[]) => void;
  fieldKey: string;
}) {
  const [input, setInput] = useState('');
  const inputId = `tag-input-${fieldKey}`;

  function addTag() {
    const trimmed = input.trim();
    if (!trimmed || values.includes(trimmed)) { setInput(''); return; }
    onChange([...values, trimmed]);
    setInput('');
  }

  // Kar panel (2026-11-11): the label is the editor's field label, the chips
  // are the neutral grey pills used across the portal, and the input is the
  // cursor after the last chip — a card with a few tags stays one line.
  return (
    <div>
      <label htmlFor={inputId} className="block text-[13px] font-semibold text-ink mb-2" data-testid={`tag-label-${fieldKey}`}>
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface2 px-2.5 py-1 text-xs font-medium leading-tight text-ink"
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((t) => t !== v))}
              data-testid={`remove-tag-${fieldKey}-${v}`}
              aria-label={`Remove ${v}`}
              className="border-0 bg-transparent p-0 leading-none font-bold text-ink-soft cursor-pointer hover:text-ink"
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={inputId}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); }
          }}
          onBlur={addTag}
          placeholder={values.length === 0 ? placeholder : 'Add…'}
          data-testid={`tag-input-${fieldKey}`}
          className="min-w-[90px] flex-1 border-0 bg-transparent px-0.5 py-1 text-sm text-ink outline-none placeholder:text-ink-faint"
        />
      </div>
    </div>
  );
}

// ── DietaryMultiSelect ────────────────────────────────────────────────────────

function DietaryMultiSelect({
  label,
  options,
  labels,
  type,
  selectedSet,
  onToggle,
  reviewed,
  onToggleNa,
  onAcceptAi,
}: {
  label: string;
  options: readonly string[];
  labels: Record<string, string>;
  type: 'allergen' | 'dietary';
  selectedSet: Set<string>;
  onToggle: (tagName: string) => void;
  /** True when the section's review state is 'manually_accepted'. Drives
   *  the yellow AI-suggested background and the N/A chip's active state. */
  reviewed: boolean;
  /** Click handler for the trailing N/A chip. Toggles the section's
   *  review state between 'ai_suggested' and 'manually_accepted' without
   *  touching tag rows. */
  onToggleNa: () => void;
  /** Optional click handler for the inline "Accept" pill rendered next
   *  to the "AI suggested" label when !reviewed. Accepts the AI's
   *  picks as-is — flips the review state to 'manually_accepted'
   *  without touching tag rows. */
  onAcceptAi?: () => void;
}) {
  const [busyTag, setBusyTag] = useState<string | null>(null);
  // Kar chips (Owner Portal redesign): a selected label is ink on both
  // sections — the colour no longer encodes allergen-vs-dietary, the heading
  // does. Unselected chips are outlined.
  const selectedBg = 'var(--ink, #111)';
  const selectedBorder = selectedBg;

  const handleClick = async (tagName: string) => {
    if (busyTag) return;
    setBusyTag(tagName);
    try {
      onToggle(tagName);
    } finally {
      // Keep busy state until the parent refreshes (small UX delay)
      setTimeout(() => setBusyTag(null), 600);
    }
  };

  // N/A is "active" only when the section is reviewed AND no tag is
  // selected — i.e. the owner explicitly confirmed nothing applies.
  // Mixing N/A active with selected tag chips would read as contradictory.
  const naActive = reviewed && selectedSet.size === 0;

  // Amber tint = "AI suggested, not yet reviewed". Disappears the
  // moment the owner takes any action (toggle a chip or click N/A).
  // ONE amber across the editor — this section, the description field and the
  // enrichment banners all mean the same thing and now look it.
  const sectionStyle: React.CSSProperties = !reviewed
    ? {
        background: 'var(--editor-ai-surface, #FFFBF5)',
        border: '1px solid var(--editor-ai-border, #FFE8CC)',
        borderRadius: 8,
        padding: 10,
        transition: 'background 0.18s ease, border-color 0.18s ease',
      }
    : {
        background: 'transparent',
        border: '1px solid transparent',
        borderRadius: 8,
        padding: 10,
        transition: 'background 0.18s ease, border-color 0.18s ease',
      };

  return (
    <div data-testid={`dietary-section-${type}`} data-reviewed={reviewed} style={sectionStyle}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 6,
        }}
      >
        <label style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>
          {label}
          {!reviewed && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--editor-ai-ink, #A05A00)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              AI suggested
            </span>
          )}
        </label>
        {!reviewed && onAcceptAi && (
          <button
            type="button"
            data-testid={`dietary-accept-ai-${type}`}
            onClick={onAcceptAi}
            title="Accept AI-suggested tags as-is"
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--surface)',
              background: 'var(--editor-affirm-solid, #1B7A4A)',
              border: '1px solid var(--editor-affirm-solid, #1B7A4A)',
              borderRadius: 6,
              padding: '3px 10px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              letterSpacing: '0.02em',
              whiteSpace: 'nowrap',
              transition: 'background 0.15s',
            }}
          >
            Accept
          </button>
        )}
      </div>
      {(
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {options.map((name) => {
            const isSelected = selectedSet.has(name);
            const isBusy = busyTag === name;
            return (
              <button
                key={name}
                type="button"
                data-testid={`dietary-pill-${type}-${name.replace(/\s+/g, '-')}`}
                aria-pressed={isSelected}
                onClick={() => void handleClick(name)}
                disabled={isBusy}
                style={{
                  height: 34,
                  padding: '0 14px',
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: isSelected ? 600 : 500,
                  border: `1px solid ${isSelected ? selectedBorder : 'var(--line, #E4E0D9)'}`,
                  background: isSelected ? selectedBg : 'var(--surface, #fff)',
                  color: isSelected ? 'var(--on-ink, #fff)' : 'var(--ink, #111)',
                  cursor: isBusy ? 'wait' : 'pointer',
                  opacity: isBusy ? 0.5 : 1,
                  transition: 'all 0.12s ease',
                  whiteSpace: 'nowrap',
                  fontFamily: 'inherit',
                }}
              >
                {labels[name] ?? name}
              </button>
            );
          })}
          {/* N/A chip — explicit "none apply" affordance. One-way:
              clicking deselects every tag in this section AND flips the
              review state to manually_accepted. There's no path back to
              ai_suggested via this chip; owners re-add tag pills directly
              if they change their mind. Idempotent when already active so
              the click acts as a self-heal in case server state drifted. */}
          <button
            type="button"
            data-testid={`dietary-pill-${type}-na`}
            aria-pressed={naActive}
            onClick={onToggleNa}
            style={{
              height: 34,
              padding: '0 14px',
              borderRadius: 999,
              fontSize: 13,
              fontWeight: naActive ? 600 : 500,
              border: `1px dashed ${naActive ? 'var(--ok, #177245)' : 'var(--line-input, #D6D1C7)'}`,
              background: naActive ? 'var(--ok-bg, #EDF5EF)' : 'var(--surface, #fff)',
              color: naActive ? 'var(--ok, #177245)' : 'var(--ink-soft, #5A554F)',
              cursor: 'pointer',
              transition: 'all 0.12s ease',
              whiteSpace: 'nowrap',
              fontFamily: 'inherit',
            }}
          >
            N/A
          </button>
        </div>
      )}
    </div>
  );
}

// ── Draft helpers (deferred-creation dietary state) ───────────────────────────

// PR 3 of consolidation: draftTagMap / toggleDraftSet helpers removed.
// EditModal now holds plain Set<string>s for selected allergens / dietary,
// initialized directly from item.food_tags. No synthetic record shape
// needed — DietaryMultiSelect reads the set via .has(name).

// ── Editor sections ───────────────────────────────────────────────────────────
// The ids are the historical TAB ids — 'food_tags' is the Basics section,
// 'groupings' is Modifiers and 'placements' is Menu pricing — because E2E
// specs and canaries across four repos select `tab-<id>`. 'addons' and
// 'recommendations' are legacy ids that no section list produces any more
// (both concerns live in the Modifiers / Pairings slots); their panels are
// kept below for the consumers that still thread the handlers.
type EditModalTab =
  | 'food_tags'
  | 'dietary'
  | 'recipe'
  | 'placements'
  | 'addons'
  | 'recommendations'
  | 'groupings'
  | 'pairings'
  | 'dishes'
  | 'performance'
  | 'advanced';

interface EditModalSectionEntry {
  key: EditModalTab;
  label: string;
  icon: LucideIcon;
  /** 'more' entries sit below a divider — the retained tabs the design has no home for. */
  group: 'main' | 'more';
}

// Kar switch (ink when on, --switch-off when off, white knob). Local to the
// shared package: `apps/owner/components/shared/kar/Switch` cannot be imported
// from here (waiter and admin mount this modal too), so this is the same
// control with the same tokens and a fallback for consumers without them.
function InkSwitch({
  checked,
  onChange,
  disabled = false,
  testId,
  label,
  title,
  mirrorPressed = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  testId?: string;
  label: string;
  title?: string;
  /** Also expose `aria-pressed` — the visibility toggle's historical contract. */
  mirrorPressed?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-pressed={mirrorPressed ? checked : undefined}
      aria-label={label}
      aria-disabled={disabled}
      disabled={disabled}
      title={title}
      data-testid={testId}
      onClick={() => { if (!disabled) onChange(!checked); }}
      className={`relative inline-flex shrink-0 w-9 h-5 rounded-full border-0 p-0 transition-colors ${
        checked ? 'bg-ink' : 'bg-[var(--switch-off,#CFCAC1)]'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        aria-hidden="true"
        className="absolute top-0.5 w-4 h-4 rounded-full bg-surface shadow-[0_1px_2px_rgba(0,0,0,.2)] transition-[left] duration-150"
        style={{ left: checked ? 18 : 2 }}
      />
    </button>
  );
}

// A labelled switch row ("Visible to guests", "Show spice picker" …).
function SwitchRow({
  label,
  hint,
  children,
  testId,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className="flex items-center gap-3 py-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-ink">{label}</div>
        {hint && <div className="text-xs text-ink-soft">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

// Section heading inside the editor body (the design's 16px/700 titles).
function SectionHeading({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-2">
      <h2 className="text-base font-bold text-ink m-0">{children}</h2>
      {sub && <div className="text-[13px] text-ink-soft">{sub}</div>}
    </div>
  );
}

// A collapsible card ("Serving sizes & prices", "Why prices differ" …).
function Accordion({
  title,
  summary,
  open,
  onToggle,
  testId,
  children,
}: {
  title: string;
  summary?: ReactNode;
  open: boolean;
  onToggle: () => void;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div className="border border-line rounded-ctl">
      <button
        type="button"
        data-testid={testId}
        aria-expanded={open}
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3.5 py-3 bg-transparent border-0 cursor-pointer text-left text-ink"
      >
        <ChevronDown
          size={15}
          className={`shrink-0 text-ink-soft transition-transform ${open ? '' : '-rotate-90'}`}
        />
        <span className="font-bold">{title}</span>
        {summary && <span className="text-[13px] text-ink-soft truncate">{summary}</span>}
      </button>
      {open && <div className="px-3.5 pb-3.5 text-sm text-ink">{children}</div>}
    </div>
  );
}

const FIELD_LABEL_CLS = 'block text-[13px] font-medium text-ink-soft mb-1.5';
const FIELD_INPUT_CLS = 'w-full h-10 rounded-ctl border border-line-input bg-surface px-3 text-sm text-ink outline-none focus:border-ink disabled:bg-surface2 disabled:text-ink-soft';
const SECONDARY_BTN_CLS = 'h-10 px-4 rounded-ctl border border-line bg-surface text-sm font-semibold text-ink cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed';
const PRIMARY_BTN_CLS = 'h-10 px-[18px] rounded-ctl border-0 bg-ink text-on-ink text-sm font-semibold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed';

// ── EditModal ─────────────────────────────────────────────────────────────────

export default function EditModal({ item, restaurantId, menus, allItems, ownerFoodCategories, onClose, onComplete, onSavingChange, onNavigateToMenu, getMenuHref, onDishAddonsChange, isNewItem = false, forceAddon = false, modifierTypeName = null, forceDish = false, onOpenPosLink, posLinkStatus, posLinkName, posLinkPrice, posSellable, preselectedDishIds, onSaveNewItem, dietaryTagService, customAllergens, customDietary, allergenDefaults, dietaryDefaults, heatLabels, sweetnessLabels, onSweetnessUpdate, onHeatSpiceUpdate, imageLibrarySlot, galleryPanelSlot, groupingsSlot, pairingsSlot, recipeSlot, placementsOverlapSlot, groupingsCount, displayMode = 'modal', onItemUpdate, onEnrichItem, descriptionSource, descriptionReviewed, onAcceptDescription, onCloneRequest, cloneMode = false, cloneSourceName, sourceItemId, onCloneSave, shell = 'classic' }: EditModalProps) {
  const v5 = shell === 'v5';
  const isInline = displayMode === 'inline';
  const activeHeatLabels: string[] = (heatLabels && heatLabels.length > 0)
    ? heatLabels
    : [...DEFAULT_HEAT_LABELS];
  const activeSweetnessLabels: string[] = (sweetnessLabels && sweetnessLabels.length > 0)
    ? sweetnessLabels
    : [...DEFAULT_SWEETNESS_LABELS];
  const trackAction = useTrackAction();
  const service = useMenuManagerService();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();

  // Form state — initialized from item
  const [name, setName]             = useState(isNewItem ? '' : item.name);
  const [description, setDesc]      = useState(item.description ?? '');
  // `category` here is the CANONICAL classifier (one of CANONICAL_CATEGORIES).
  // It is no longer user-editable (the "Mapped Course" dropdown was removed
  // 2026-06-11) but is still needed to gate the Beverages / Desserts-specific
  // sections below. Prefer the AI-pipeline canonical_category, fall back to
  // mapping the raw scraped label, then to empty. For NEW items it tracks the
  // raw-category dropdown (via toCanonical) so beverage/dessert fields surface.
  const [category, setCategory]     = useState(
    item.canonical_category ?? toCanonical(item.category) ?? '',
  );
  // RAW CATEGORY (2026-06-11) — the item's original scraped category label
  // (menu_items.category_name, surfaced as `category`). This is now the
  // owner-editable category field on the item, replacing Mapped Course.
  const [rawCategory, setRawCategory] = useState(item.category ?? '');
  // Raw Category dropdown options are derived by the shared <RawCategorySelect>
  // (single source of truth across the food-item EditModal + bulk-actions
  // drawer): items[].category ∪ ownerFoodCategories ∪ current value, so a
  // freshly-created category is selectable even before any dish carries it.
  // Price is only editable in Add-on mode (dishes price per-menu in MenuBuilder).
  // STR-303: add-ons are ingredient-level surcharges with a single base price.
  const [price, setPrice]           = useState<number | null>(item.price ?? null);
  const [priceError, setPriceError] = useState<string | null>(null);
  // STR-1275: the restaurant's currency symbol. Falls back to '$' with no
  // CurrencyProvider mounted (qrate-admin-webapp) — today's behaviour.
  const currencySymbol = useCurrencySymbol();
  // Addon-only owner/staff memo (≤500 chars). Surfaced as subtext in the
  // Add Member picker (ItemSearchPicker) and on the Setup Guide → Add-ons
  // page; the EditModal is the third write surface. Dishes do not use it.
  const [memo, setMemo]             = useState<string>(item.memo ?? '');
  const [isActive, setIsActive]     = useState(item.active !== false);

  // Heat/spice — read the JSONB label first, then fall back to the int
  // spice_level + per-restaurant scale. The fallback covers rows where
  // food_tags.heat_spice was never written (pre-Phase-A drift) but the int
  // column is set, so the modal still highlights the correct pill.
  const [heatSpice, setHeatSpice] = useState<string | null>(() => {
    const hs = item.food_tags?.heat_spice;
    if (Array.isArray(hs) && hs[0]) return (hs as string[])[0];
    if (typeof hs === 'string' && hs) return hs;
    const lvl = item.spice_level;
    if (typeof lvl === 'number' && lvl >= 1 && lvl <= activeHeatLabels.length) {
      return activeHeatLabels[lvl - 1] ?? null;
    }
    return null;
  });

  // PDD 2026-05-15 — owner per-item opt-out for the patron composition
  // page Spice Level slider. Defaults to TRUE so legacy items keep the
  // slider; owner flips OFF to suppress for non-dessert items (desserts
  // continue to auto-hide on the patron side regardless of this flag).
  //
  // PDD 2026-07-17 — VISIBILITY vs REQUIRED are split back into two controls
  // (reverts STR-680's unification). `spice_modifier_enabled` = does the
  // patron spice picker RENDER. `spice_selection_required` = must the diner
  // pick a level before adding (gates "Add to order"). They are now saved
  // independently; "required" only applies while the picker is visible.
  const [spiceModifierEnabled, setSpiceModifierEnabled] = useState<boolean>(
    item.spice_modifier_enabled ?? true,
  );
  // PDD 2026-07-17 — the second, independent control. Default TRUE preserves
  // pre-split behaviour (modifier-on items were implicitly required). Only
  // meaningful while spice_modifier_enabled is true; the backend force-reverts
  // it to FALSE whenever the modifier is off (owner_food_items.py).
  const [spiceSelectionRequired, setSpiceSelectionRequired] = useState<boolean>(
    item.spice_selection_required ?? true,
  );

  // PDD 2026-05-26 — Build-Your-Own classification. Default FALSE everywhere
  // on the wire so legacy items render correctly. The API hard-blocks
  // setting this to TRUE when the dish has zero groupings; the UI mirrors
  // that by disabling the toggle in the same state.
  const [isByo, setIsByo] = useState<boolean>(item.is_byo ?? false);

  // Sweetness — same fallback shape as heat/spice for drift resilience.
  const [sweetnessLabel, setSweetnessLabel] = useState<string | null>(() => {
    const sl = item.food_tags?.sweetness_label;
    if (typeof sl === 'string' && sl) return sl;
    const lvl = item.sweetness_level;
    if (typeof lvl === 'number' && lvl >= 1 && lvl <= activeSweetnessLabels.length) {
      return activeSweetnessLabels[lvl - 1] ?? null;
    }
    return null;
  });

  // Beverage Profile draft — owner-editable form state for food_tags.beverage.
  // Initialized from the enriched object on the item; resyncs when the item
  // prop changes (modal reused for a different item, or PUT response merged
  // upstream). Persisted as part of the food_tags payload on Save.
  const [bevDraft, setBevDraft] = useState<BeverageTags>(() => (item.food_tags?.beverage ?? {}));
  useEffect(() => {
    setBevDraft(item.food_tags?.beverage ?? {});
  }, [item.id, item.food_tags?.beverage]);

  // Wine identity/provenance drafts (PLAN 2026-08-04 M5) — top-level
  // menu_items columns (NOT food_tags.beverage facets). Edited in the wine
  // sub-section; PATCHed as top-level fields on save. Vintage held as a
  // string for the input; parsed on save. wineOldWorld is the EXPLICIT
  // owner choice — it only matters (and is only sent) when the country
  // doesn't derive to a known world.
  const [wineVarietal, setWineVarietal] = useState<string>(item.wine_varietal ?? '');
  const [wineRegion, setWineRegion] = useState<string>(item.wine_region ?? '');
  const [wineVintage, setWineVintage] = useState<string>(
    item.wine_vintage != null ? String(item.wine_vintage) : '',
  );
  const [wineProducer, setWineProducer] = useState<string>(item.wine_producer ?? '');
  const [wineCountry, setWineCountry] = useState<string>(item.wine_country ?? '');
  const [wineOldWorld, setWineOldWorld] = useState<boolean | null>(item.wine_old_world ?? null);
  useEffect(() => {
    setWineVarietal(item.wine_varietal ?? '');
    setWineRegion(item.wine_region ?? '');
    setWineVintage(item.wine_vintage != null ? String(item.wine_vintage) : '');
    setWineProducer(item.wine_producer ?? '');
    setWineCountry(item.wine_country ?? '');
    setWineOldWorld(item.wine_old_world ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.wine_varietal, item.wine_region, item.wine_vintage,
    item.wine_producer, item.wine_country, item.wine_old_world]);

  // Wine serving sizes (PDD 2026-06-15) — owner-configured glass/bottle options
  // on menu_items.serving_options. Prices held here in DOLLARS for the input;
  // converted to price_cents on Save. Resyncs when the item prop changes.
  type ServingRow = { id: string; label: string; volume_ml: string; price: string; is_default: boolean };
  const itemServingRows = (it: MenuItemDisplay): ServingRow[] =>
    asArray<ServingOption>(it.serving_options).map((o, i) => ({
      id: o.id || `opt-${i}`,
      label: o.label ?? '',
      volume_ml: o.volume_ml != null ? String(o.volume_ml) : '',
      price: o.price_cents != null ? (o.price_cents / 100).toFixed(2) : '',
      is_default: !!o.is_default,
    }));
  const [servingRows, setServingRows] = useState<ServingRow[]>(() => itemServingRows(item));
  useEffect(() => {
    setServingRows(itemServingRows(item));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.serving_options]);

  const addServingRow = () =>
    setServingRows((rows) => [
      ...rows,
      { id: `new-${rows.length}-${rows.reduce((n, r) => n + r.label.length, 0)}`, label: '', volume_ml: '', price: '', is_default: rows.length === 0 },
    ]);
  const removeServingRow = (idx: number) =>
    setServingRows((rows) => {
      const next = rows.filter((_, i) => i !== idx);
      // Keep exactly one default alive when rows remain.
      if (next.length > 0 && !next.some((r) => r.is_default)) next[0].is_default = true;
      return next;
    });
  const updateServingRow = (idx: number, patch: Partial<ServingRow>) =>
    setServingRows((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const setServingDefault = (idx: number) =>
    setServingRows((rows) => rows.map((r, i) => ({ ...r, is_default: i === idx })));

  // Other food tags (heat_spice handled separately)
  const [tags, setTags] = useState<Record<string, string[]>>(() => {
    const ft = item.food_tags ?? {};
    const result: Record<string, string[]> = {};
    for (const { key } of TAG_FIELDS) {
      const val = ft[key as keyof FoodTags];
      result[key] = Array.isArray(val) ? [...val] : [];
    }
    return result;
  });

  // Allergen + dietary pill option lists — canonical FDA-9 / canonical 5
  // merged with the per-restaurant custom entries the consumer loaded
  // for the customization tab. Without this merge, owner-added allergens
  // (e.g. "MSG", "sesame-paste") never appear as pickable pills on a
  // food item even though they exist in the customization list. Custom
  // entries are appended after the canonical set, deduped, and given a
  // title-cased fallback label when they aren't in the static label map.
  const allergenOptions = useMemo<string[]>(() => {
    // Base = per-restaurant effective canonical set when the consumer supplies
    // it (FDA-9 minus hidden); else the hardcoded FDA-9 fallback. Non-canonical
    // applied values (legacy aliases) are intentionally NOT surfaced — the
    // backend is the single source of truth for canonicalization, and hiding a
    // default cascade-purges it from every item's food_tags server-side, so an
    // item never legitimately retains an unlisted tag.
    const base = allergenDefaults ?? [...FDA_BIG_9_ALLERGENS];
    const extras = (customAllergens ?? []).filter((s) => typeof s === 'string' && s.length > 0);
    return Array.from(new Set([...base, ...extras]));
  }, [allergenDefaults, customAllergens]);
  const dietaryOptions = useMemo<string[]>(() => {
    // Base = per-restaurant effective canonical set when the consumer supplies
    // it (canonical 5 minus hidden defaults, STR-483); else the hardcoded
    // fallback. Using the effective set is what makes a hidden default
    // (e.g. kosher/halal removed from the Dietary table) stop rendering here.
    const base = dietaryDefaults ?? [...DIETARY_RESTRICTIONS_LIST];
    const extras = (customDietary ?? []).filter((s) => typeof s === 'string' && s.length > 0);
    return Array.from(new Set([...base, ...extras]));
  }, [dietaryDefaults, customDietary]);
  // Label maps cover the full option set (defaults + customs); fall back to a
  // title-cased slug when an entry isn't in the curated static label map.
  const allergenLabelsMerged = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = { ...ALLERGEN_LABELS };
    for (const s of allergenOptions) if (!(s in m)) m[s] = slugToLabel(s);
    return m;
  }, [allergenOptions]);
  const dietaryLabelsMerged = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = { ...DIETARY_LABELS };
    for (const s of dietaryOptions) if (!(s in m)) m[s] = slugToLabel(s);
    return m;
  }, [dietaryOptions]);

  // Allergen + dietary state — initialized from item.food_tags (canonical
  // source after PR 3 of consolidation). Toggling a pill computes the
  // new full array client-side and PATCHes via dietaryTagService.setItemTags;
  // local set updates optimistically.
  const [allergenSet, setAllergenSet] = useState<Set<string>>(() => {
    const arr = item.food_tags?.allergens;
    return new Set(Array.isArray(arr) ? arr : []);
  });
  const [dietarySet, setDietarySet] = useState<Set<string>>(() => {
    const arr = item.food_tags?.dietary;
    return new Set(Array.isArray(arr) ? arr : []);
  });

  // Resync when the item prop changes (modal reused for a different item).
  useEffect(() => {
    setAllergenSet(new Set(Array.isArray(item.food_tags?.allergens) ? item.food_tags!.allergens : []));
    setDietarySet(new Set(Array.isArray(item.food_tags?.dietary) ? item.food_tags!.dietary : []));
  }, [item.id, item.food_tags?.allergens, item.food_tags?.dietary]);

  // Per-item review state mirror — drives the yellow "AI suggested" tint
  // on the allergens / dietary sections. The threshold lives in
  // utils/foodTagsReview.ts so the modal nudge and the
  // "Allergens & Dietary" filter pill on the Setup Guide / Food Library
  // pages stay in lockstep — both views answer the same question via
  // the same helper.
  const [allergensReviewed, setAllergensReviewed] = useState<boolean>(isAllergensReviewed(item));
  const [dietaryReviewed, setDietaryReviewed] = useState<boolean>(isDietaryReviewed(item));

  const handleDietaryToggle = useCallback(async (
    tagName: string,
    tagType: 'allergen' | 'dietary',
  ) => {
    if (!dietaryTagService || !restaurantId || !item.id || isNewItem) return;
    const currentSet = tagType === 'allergen' ? allergenSet : dietarySet;
    const setSet = tagType === 'allergen' ? setAllergenSet : setDietarySet;
    const next = new Set(currentSet);
    if (next.has(tagName)) next.delete(tagName);
    else next.add(tagName);
    // Optimistic local update — pill flips immediately.
    setSet(next);
    // Mirror backend side-effect: any array write flips *_state to
    // 'manually_accepted'. Local + parent update so Food Items filter
    // count updates without a refetch.
    const stateKey = tagType === 'allergen' ? 'allergens_state' : 'dietary_state';
    const arrKey = tagType === 'allergen' ? 'allergens' : 'dietary';
    const nextArr = Array.from(next).sort();
    if (tagType === 'allergen') setAllergensReviewed(true);
    else setDietaryReviewed(true);
    onItemUpdate?.({
      id: item.id,
      food_tags: { ...(item.food_tags ?? {}), [stateKey]: 'manually_accepted', [arrKey]: nextArr },
    });
    try {
      await dietaryTagService.setItemTags(restaurantId, item.id, { [arrKey]: nextArr });
    } catch (err) {
      // Roll back on failure.
      console.error('dietary toggle failed', err);
      setSet(currentSet);
      const stillReviewed = tagType === 'allergen' ? isAllergensReviewed(item) : isDietaryReviewed(item);
      if (tagType === 'allergen') setAllergensReviewed(stillReviewed);
      else setDietaryReviewed(stillReviewed);
    }
  }, [dietaryTagService, restaurantId, item, isNewItem, allergenSet, dietarySet, onItemUpdate]);

  // N/A chip — explicit "none apply". Sets the section's array to []
  // and flips review state to manually_accepted (backend does both in
  // one UPDATE on an empty-array PATCH). Idempotent when already in N/A
  // state — the call self-heals any drift.
  const handleClickNa = useCallback(async (type: 'allergens' | 'dietary') => {
    if (!item.id || isNewItem || !restaurantId || !dietaryTagService) return;
    const setSet = type === 'allergens' ? setAllergenSet : setDietarySet;
    const prevSet = type === 'allergens' ? allergenSet : dietarySet;

    // Optimistic local + parent update.
    const stateKey = type === 'allergens' ? 'allergens_state' : 'dietary_state';
    const arrKey = type === 'allergens' ? 'allergens' : 'dietary';
    setSet(new Set());
    if (type === 'allergens') setAllergensReviewed(true);
    else setDietaryReviewed(true);
    onItemUpdate?.({
      id: item.id,
      food_tags: { ...(item.food_tags ?? {}), [stateKey]: 'manually_accepted', [arrKey]: [] },
    });

    try {
      await dietaryTagService.setItemTags(restaurantId, item.id, { [arrKey]: [] });
    } catch (err) {
      console.error('N/A click failed', err);
      setSet(prevSet);
      const stillReviewed = type === 'allergens' ? isAllergensReviewed(item) : isDietaryReviewed(item);
      if (type === 'allergens') setAllergensReviewed(stillReviewed);
      else setDietaryReviewed(stillReviewed);
    }
  }, [dietaryTagService, restaurantId, item, isNewItem, allergenSet, dietarySet, onItemUpdate]);

  // Image state
  const [thumbnail, setThumbnail]   = useState(item.thumbnail_url ?? null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [imgBusy, setImgBusy]       = useState<'uploading' | 'removing' | null>(null);
  const [imgError, setImgError]     = useState<string | null>(null);

  // "Choose from Gallery" state — true when the right-side tab content is
  // replaced by the consumer's galleryPanelSlot. Reset on item change so
  // navigating between rows in inline (drawer) mode doesn't leave the
  // gallery open against a stale item.
  const [galleryOpen, setGalleryOpen] = useState(false);
  useEffect(() => { setGalleryOpen(false); }, [item.id]);

  // Accept-AI for an entire allergens/dietary section in one click. Flips
  // food_tags.{allergens|dietary}_state to 'manually_accepted' WITHOUT
  // touching tag rows — the existing AI-suggested chips stand. Distinct
  // from the N/A chip which rejects everything before flipping state.
  const handleAcceptAi = useCallback(async (type: 'allergens' | 'dietary') => {
    if (!item.id || isNewItem || !restaurantId) return;
    if (!dietaryTagService?.markReviewed) return;
    const stateKey = type === 'allergens' ? 'allergens_state' : 'dietary_state';
    const prevReviewed = type === 'allergens' ? allergensReviewed : dietaryReviewed;
    if (type === 'allergens') setAllergensReviewed(true);
    else setDietaryReviewed(true);
    onItemUpdate?.({
      id: item.id,
      food_tags: {
        ...(item.food_tags ?? {}),
        [stateKey]: 'manually_accepted',
      },
    });
    try {
      await dietaryTagService.markReviewed(item.id, type, 'manually_accepted');
    } catch (err) {
      console.error('Accept AI failed', err);
      if (type === 'allergens') setAllergensReviewed(prevReviewed);
      else setDietaryReviewed(prevReviewed);
    }
  }, [
    dietaryTagService,
    restaurantId,
    item.id,
    item.food_tags,
    isNewItem,
    onItemUpdate,
    allergensReviewed,
    dietaryReviewed,
  ]);

  // Add-on type
  // Item type is fixed by the calling context — the Food Items tab that opened
  // the modal (forceAddon / forceDish) or the stored item_type when editing.
  // The in-modal Dishes/Add-ons toggle was removed (2026-07-18), so isAddon is
  // derived once and never changes while the modal is open.
  const isAddon = forceAddon || item.item_type === 'addon';
  const showRecipeTab = !!recipeSlot && !isAddon && !isNewItem;
  // True when the addon has no DB row yet — dish associations must be deferred until save.
  const isDeferredCreation = isNewItem && !!onSaveNewItem;

  // Save state
  const [saving, setSaving]         = useState(false);
  const [saveError, setSaveError]   = useState<string | null>(null);
  const [nameError, setNameError]       = useState(false);

  // Clone-draft state — only meaningful when cloneMode === true. Tracks the
  // in-flight POST /owner/menu/items/{id}/clone request + surfaces server
  // errors back to the owner inline (banner above the action bar).
  const [cloneSaving, setCloneSaving] = useState(false);
  const [cloneError, setCloneError]   = useState<string | null>(null);

  // Name validation derived state — covers BOTH the new-item rename gate
  // and the clone-rename gate, so the name field shows a red border + a
  // helper sentence the moment the input is invalid (no waiting for the
  // first Save click).
  //
  // Rules:
  //   - 'empty'         → trimmed name is blank (applies to new items and
  //                       clone drafts; existing-item edits are fine since
  //                       the prior name is still loaded into local state).
  //   - 'contains-copy' → cloneMode && name contains 'copy' (case-insensitive).
  //                       Defence-in-depth match to the server validator.
  //   - 'unchanged'     → cloneMode && trimmed name matches the source name
  //                       verbatim. Forces an actual rename.
  const _trimmedName = name.trim();
  const _nameContainsCopy = cloneMode && /copy/i.test(_trimmedName);
  const _nameUnchangedFromSource =
    cloneMode && !!cloneSourceName && _trimmedName === cloneSourceName.trim();
  const nameValidation: 'empty' | 'contains-copy' | 'unchanged' | null =
    _trimmedName === ''            ? 'empty' :
    _nameContainsCopy              ? 'contains-copy' :
    _nameUnchangedFromSource       ? 'unchanged' :
    null;
  const showNameInvalid =
    (isNewItem || cloneMode) && nameValidation !== null;
  const nameHelperText =
    nameValidation === 'empty'         ? 'Name is required' :
    nameValidation === 'contains-copy' ? "Name cannot contain 'Copy' — rename before saving" :
    nameValidation === 'unchanged'     ? 'Rename the clone — the name must differ from the source' :
    null;

  // Enrich state — admin-only via onEnrichItem prop. The Food Tags tab
  // shows an in-progress banner driven by item.enrichment_status; this
  // local state drives the action-bar button spinner + a one-shot notice
  // for skip/error feedback.
  const [enriching, setEnriching] = useState(false);
  const [enrichNotice, setEnrichNotice] = useState<string | null>(null);

  const handleEnrichClick = useCallback(async () => {
    if (!onEnrichItem || !item.id || isNewItem) return;
    setEnriching(true);
    setEnrichNotice(null);
    try {
      const res = await onEnrichItem(item.id);
      if (res.skipped_reason) {
        setEnrichNotice(`Enrichment skipped — ${res.skipped_reason.replace(/_/g, ' ')}`);
        return;
      }
      if (res.food_tags) {
        // Bubble the AI tags into the parent's items mirror so derived UI
        // (filters, badges, list rows) refresh without a refetch.
        onItemUpdate?.({ id: item.id, food_tags: res.food_tags });
      }
    } catch (err) {
      setEnrichNotice(err instanceof Error ? err.message : 'Enrichment failed');
    } finally {
      setEnriching(false);
    }
  }, [onEnrichItem, item.id, isNewItem, onItemUpdate]);
  const [descError, setDescError]       = useState(false);

  // Delete state
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deleteLoading, setDeleteLoading]       = useState(false);
  const [deleteError, setDeleteError]           = useState<string | null>(null);
  // G4: a save, a clone or a delete in flight locks every exit (footer Cancel /
  // Save, ×, backdrop) — and the host's scrim / Esc via onSavingChange — so a
  // PUT can never race the DELETE (the v5 footer keeps Save visible while the
  // inline delete bar is open).
  const savingInFlight = saving || cloneSaving || deleteLoading;
  useEffect(() => {
    onSavingChange?.(savingInFlight);
    return () => onSavingChange?.(false);
  }, [savingInFlight, onSavingChange]);

  // Section state (Owner Portal redesign, 2026-11-10). The editor is ONE
  // section at a time on every breakpoint — a 210px rail on desktop, a
  // dropdown on phones — and both drive `activeTab`. Tab ids are unchanged
  // ('food_tags' = Basics, 'groupings' = Modifiers, 'placements' = Menu
  // pricing) so the E2E specs and canaries that key off `tab-<id>` keep
  // working; only the labels and the layout changed.
  //
  // Available sections:
  //   Dish            → Basics · Dietary · Modifiers · Menu pricing · Pairings · Recipe · Advanced | Performance
  //   Existing add-on → Basics · Dietary · Advanced | Performance · Dishes
  //   NEW item        → Basics · Dietary · Advanced (associations happen later)
  // Every mode lands on Basics (the design opens on the item's name and
  // photo); the section resets when the editor is reused for another item.
  const [activeTab, setActiveTab] = useState<EditModalTab>('food_tags');
  useEffect(() => {
    setActiveTab('food_tags');
  }, [item.id, isAddon, isNewItem]);

  // Footer "More actions ▾" menu (Clone · Hide/Show · Delete).
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  // Basics → "Flavor, ingredients & other details" accordion.
  const [flavorOpen, setFlavorOpen] = useState(false);
  // Menu pricing → which menu's price / portion / promotion is being edited.
  // null = first placement. Also drives the header band ("<Menu> menu only")
  // and the per-menu footer.
  const [pricingMenuId, setPricingMenuId] = useState<string | null>(null);
  // Menu pricing → "Save <Menu> settings" flushes the blur-committed text
  // buffers inside the editor; the editor registers its flush here.
  const pricingFlushRef = useRef<(() => void) | null>(null);
  const [pricingSavedAt, setPricingSavedAt] = useState<number | null>(null);
  useEffect(() => {
    if (pricingSavedAt == null) return;
    const t = setTimeout(() => setPricingSavedAt(null), 2500);
    return () => clearTimeout(t);
  }, [pricingSavedAt]);

  // Placements tab state — local mirror of menu_associations so per-row
  // inline edits (price, boost, chef's special, portion) and per-row
  // removals can commit optimistically and roll back on network failure.
  const [placementsDraft, setPlacementsDraft] = useState<MenuAssociation[]>(item.menu_associations ?? []);
  // Re-sync the draft when the parent passes a refreshed item (e.g. after
  // a re-fetch on tab focus or a save round-trip from another tab).
  useEffect(() => {
    setPlacementsDraft(item.menu_associations ?? []);
  }, [item.menu_associations]);
  // menuIds currently saving — drives row-level disabled/loading state.
  const [placementsSaving, setPlacementsSaving] = useState<Set<string>>(new Set());
  const setPlacementSaving = useCallback((menuId: string, on: boolean) => {
    setPlacementsSaving((prev) => {
      const next = new Set(prev);
      if (on) next.add(menuId); else next.delete(menuId);
      return next;
    });
  }, []);

  // Add-ons tab state (used when editing a dish item)
  const [itemAddons, setItemAddons] = useState<AddonEntry[]>(item.addons ?? []);
  // Ref mirrors itemAddons so async handlers always read the latest value,
  // avoiding stale-closure races when multiple mutations overlap (e.g. blur + click).
  const itemAddonsRef = useRef(itemAddons);
  itemAddonsRef.current = itemAddons;
  // Serialise addon mutations: each handler awaits the previous one so
  // the backend never receives two overlapping replace-all calls.
  const addonMutexRef = useRef<Promise<void>>(Promise.resolve());

  // Recommendations tab state (used when editing a dish item)
  // itemRecs  = confirmed/accepted pairings already in menu_item_recommendations
  // aiSugs    = pending AI suggestions from menu_intelligence.pairing_graph (not yet saved)
  const [itemRecs, setItemRecs] = useState<RecommendationEntry[]>(item.recommendations ?? []);
  const [aiSugs, setAiSugs] = useState<RecommendationEntry[]>([]);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsError, setRecsError] = useState<string | null>(null);
  // Search input state for the new-item Recommendations seed picker.
  const [recsPickerSearch, setRecsPickerSearch] = useState('');

  // Dishes tab state (used when editing an addon item) — tracks which dishes have this addon
  const [associatedDishIds, setAssociatedDishIds] = useState<Set<string>>(() => {
    const existing = allItems
      ? allItems
          .filter((d) => d.item_type !== 'addon' && d.addons?.some((a) => a.menu_item_id === item.id))
          .map((d) => d.id)
      : [];
    // Merge in preselected dishes (e.g. source dish from setup guide Add button)
    return new Set([...existing, ...(preselectedDishIds ?? [])]);
  });
  const [addonPool, setAddonPool] = useState<MenuItemDisplay[]>([]);
  const [addonsLoading, setAddonsLoading] = useState(false);
  const [addonsError, setAddonsError] = useState<string | null>(null);
  const [poolSearch, setPoolSearch] = useState('');

  // Dishes tab state — search + multi-select
  const [dishSearch, setDishSearch] = useState('');
  const [selectedDishIds, setSelectedDishIds] = useState<Set<string>>(new Set());

  // Performance tab state
  const [perfPeriod, setPerfPeriod] = useState<MenuItemPerformancePeriod>('last_7_days');
  const [perfData, setPerfData] = useState<MenuItemPerformanceResponse | null>(null);
  const [perfLoading, setPerfLoading] = useState(false);
  const [perfError, setPerfError] = useState<string | null>(null);

  // Modal-open track — fires once per open, keyed by item id.
  useEffect(() => {
    trackAction('menu.editModal.open', {
      restaurantId,
      metadata: { itemId: item.id, itemType: item.item_type ?? 'dish' },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  useEffect(() => {
    if (activeTab !== 'performance' || !restaurantId || !service.getMenuItemPerformance) return;
    setPerfLoading(true);
    setPerfError(null);
    service
      .getMenuItemPerformance(restaurantId, item.id, perfPeriod)
      .then(setPerfData)
      .catch((e: unknown) => setPerfError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setPerfLoading(false));
  }, [activeTab, restaurantId, item.id, perfPeriod]);

  // Refetch addon pool from backend — used on initial load, cross-tab
  // broadcast, and tab-visibility restore.
  const fetchAddons = useRef<() => void>(() => {});
  fetchAddons.current = () => {
    if (!restaurantId) return;
    setAddonsLoading(true);
    setAddonsError(null);
    service
      .getAddonItems(restaurantId)
      .then(setAddonPool)
      .catch((e: unknown) => setAddonsError(e instanceof Error ? e.message : 'Failed to load add-ons'))
      .finally(() => setAddonsLoading(false));
  };

  // Initial fetch when addons tab becomes active
  useEffect(() => {
    if (activeTab !== 'addons' || !restaurantId) return;
    fetchAddons.current();
  }, [activeTab, restaurantId]);

  // Cross-tab reactivity: refetch when another tab modifies addons
  // for this item, and when user switches back to this tab.
  useEffect(() => {
    if (activeTab !== 'addons' || !restaurantId) return;

    // Listen for BroadcastChannel messages from other tabs
    const unsubBroadcast = onAddonChange((msg) => {
      if (msg.restaurantId === restaurantId) {
        fetchAddons.current();
      }
    });

    // Refetch when the browser tab regains focus
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchAddons.current();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      unsubBroadcast();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [activeTab, restaurantId]);

  // Refetch recommendations from backend — used on initial load, cross-tab
  // broadcast, and tab-visibility restore.
  const fetchRecs = useRef<() => void>(() => {});
  fetchRecs.current = () => {
    // Drafts have no DB id and don't exist in the pairing graph yet — skip
    // both backend calls. Owner picks seed pairings via the inline picker
    // and they're flushed via updateItemModifiers after onSaveNewItem.
    if (!restaurantId || isNewItem) return;
    setRecsLoading(true);
    setRecsError(null);
    Promise.all([
      service.getItemModifiers ? service.getItemModifiers(restaurantId, item.id) : Promise.resolve(null),
      service.getMenuIntelligence ? service.getMenuIntelligence(restaurantId) : Promise.resolve(null),
    ]).then(([modifiers, intelligence]) => {
      const confirmed: RecommendationEntry[] = modifiers?.recommendations ?? [];
      setItemRecs(confirmed);
      const confirmedIds = new Set(confirmed.map((r) => r.menu_item_id));
      const pairingGraph = intelligence?.menu_intelligence?.pairing_graph ?? [];
      const entry = pairingGraph.find((e) => e.entree_item_id === item.id);
      const suggestions: RecommendationEntry[] = [];
      for (const pair of entry?.paired_items ?? []) {
        if (confirmedIds.has(pair.item_id)) continue;
        const found = allItems?.find((i) => i.id === pair.item_id);
        if (found) {
          suggestions.push({
            menu_item_id: pair.item_id,
            name: found.name,
            price_override: null,
            thumbnail_url: found.thumbnail_url ?? null,
            recommendation_type: 'ai',
          });
        }
      }
      setAiSugs(suggestions);
    })
    .catch((e: unknown) => setRecsError(e instanceof Error ? e.message : 'Failed to load recommendations'))
    .finally(() => setRecsLoading(false));
  };

  // Initial fetch when recommendations tab becomes active
  useEffect(() => {
    if (activeTab !== 'recommendations' || !restaurantId) return;
    fetchRecs.current();
  }, [activeTab, restaurantId, item.id]);

  // Cross-tab reactivity: refetch when another tab modifies recommendations
  // for this item, and when user switches back to this tab.
  useEffect(() => {
    if (activeTab !== 'recommendations' || !restaurantId) return;

    // Listen for BroadcastChannel messages from other tabs
    const unsubBroadcast = onRecommendationChange((msg) => {
      if (msg.itemId === item.id && msg.restaurantId === restaurantId) {
        fetchRecs.current();
      }
    });

    // Refetch when the browser tab regains focus (covers cases where
    // BroadcastChannel isn't available or the change came from the setup guide
    // in the same tab but a different route)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchRecs.current();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      unsubBroadcast();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [activeTab, restaurantId, item.id]);

  // ── Image handlers ──────────────────────────────────────────────────────

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fromCamera = e.target === cameraRef.current;
    const start = Date.now();
    setImgBusy('uploading');
    setImgError(null);

    // STR-251 mobile + camera: re-encode the file via Canvas before upload.
    // Strips EXIF, normalizes orientation, fixes HEIC, and shrinks 5–20 MB
    // phone photos to ~200–500 KB. On any failure (decode error, unsupported
    // format), fall back to PUTting the raw file so the user is never blocked.
    let body: Blob = file;
    try {
      body = await processImageForUpload(file);
    } catch (err) {
      console.warn('Image preprocessing failed, uploading raw file:', err);
    }

    const imgAction = fromCamera ? 'menu.imageUpload.camera' : 'menu.imageUpload.file';
    try {
      const { upload_url } = await service.getMenuItemImageUploadUrl(item.id);
      // Do NOT send Content-Type header — the presigned URL is signed for
      // 'image/png' on the backend. Sending a different type (e.g. image/jpeg)
      // causes S3 to reject the PUT with 403.
      const res = await fetch(upload_url, {
        method: 'PUT',
        body,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const { thumbnail_url } = await service.confirmMenuItemImageUpload(item.id);
      setThumbnail(thumbnail_url);
      trackAction(imgAction, {
        restaurantId,
        metadata: { itemId: item.id, fileSizeBytes: body.size },
        success: true,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      trackAction(imgAction, {
        restaurantId,
        metadata: { itemId: item.id },
        success: false,
        durationMs: Date.now() - start,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      setImgError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setImgBusy(null);
      if (fileRef.current) fileRef.current.value = '';
      if (cameraRef.current) cameraRef.current.value = '';
    }
  }

  async function handleRemoveImage() {
    const start = Date.now();
    setImgBusy('removing');
    setImgError(null);
    try {
      await service.removeMenuItemImage(item.id);
      setThumbnail(null);
      trackAction('menu.imageUpload.remove', {
        restaurantId,
        metadata: { itemId: item.id },
        success: true,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      trackAction('menu.imageUpload.remove', {
        restaurantId,
        metadata: { itemId: item.id },
        success: false,
        durationMs: Date.now() - start,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      setImgError(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setImgBusy(null);
    }
  }

  // ── Add-ons tab handlers ────────────────────────────────────────────────

  async function handleAddAddon(poolItem: MenuItemDisplay) {
    const already = itemAddonsRef.current.some((a) => a.menu_item_id === poolItem.id);
    if (already) return;
    const newEntry: AddonEntry = {
      menu_item_id: poolItem.id,
      name: poolItem.name,
      price_override: poolItem.price ?? 0,
      thumbnail_url: poolItem.thumbnail_url ?? null,
      status: 'approved',
      suggestion_source: 'manual',
    };
    const prev = itemAddonsRef.current;
    const next = [...prev, newEntry];
    setItemAddons(next);
    setPoolSearch(''); // Clear search so the full pool is visible after adding
    const task = addonMutexRef.current.then(async () => {
      try {
        await service.updateItemModifiers(item.id, { addons: next });
        if (restaurantId) broadcastAddonChange(item.id, restaurantId);
      } catch {
        setItemAddons(prev);
        setAddonsError('Failed to add — please try again.');
      }
    });
    addonMutexRef.current = task;
    await task;
  }

  async function handleRemoveAddon(menuItemId: string) {
    const prev = itemAddonsRef.current;
    const next = prev.filter((a) => a.menu_item_id !== menuItemId);
    setItemAddons(next);
    setAddonsError(null);
    const task = addonMutexRef.current.then(async () => {
      try {
        await service.updateItemModifiers(item.id, { addons: next });
        if (restaurantId) broadcastAddonChange(item.id, restaurantId);
      } catch {
        setItemAddons(prev);
        setAddonsError('Failed to remove add-on — please try again.');
      }
    });
    addonMutexRef.current = task;
    await task;
  }

  async function handleApproveAddon(addon: AddonEntry, priceOverride?: number) {
    const resolvedPrice = priceOverride ?? addon.price_override;
    const prev = itemAddonsRef.current;
    const next = prev.map((a) =>
      a.menu_item_id === addon.menu_item_id ? { ...a, status: 'approved' as const, price_override: resolvedPrice } : a,
    );
    setItemAddons(next);
    const task = addonMutexRef.current.then(async () => {
      try {
        // PDD 2026-05-10 Phase E Step 14 — approveAddonSuggestion is
        // optional on the service interface (deprecated). This branch
        // is dead code after Step 13 (the Add-ons tab that triggered
        // it is gone); the optional-chain keeps the build green until
        // the dead-code cleanup follow-up removes this handler entirely.
        if (addon.id && service.approveAddonSuggestion) {
          await service.approveAddonSuggestion(item.id, addon.id, priceOverride);
        } else {
          await service.updateItemModifiers(item.id, { addons: next });
        }
        if (restaurantId) broadcastAddonChange(item.id, restaurantId);
      } catch {
        setItemAddons(prev);
        setAddonsError('Failed to approve — please try again.');
      }
    });
    addonMutexRef.current = task;
    await task;
  }

  // ── Recommendations tab handlers (used when editing a dish item) ─────────

  // Accept an AI suggestion: move from aiSugs → itemRecs and persist
  async function handleApproveRec(rec: RecommendationEntry) {
    const next = [...itemRecs, { ...rec, recommendation_type: 'manual' as const }];
    setItemRecs(next);
    setAiSugs((prev) => prev.filter((r) => r.menu_item_id !== rec.menu_item_id));
    try {
      await service.updateItemModifiers(item.id, {
        recommendations: next.map((r) => ({
          menu_item_id: r.menu_item_id,
          name: r.name,
          price_override: null,
          thumbnail_url: r.thumbnail_url ?? null,
        })),
      });
      if (restaurantId) broadcastRecommendationChange(item.id, restaurantId);
    } catch {
      setItemRecs(itemRecs);
      setAiSugs(aiSugs);
    }
  }

  // Dismiss an AI suggestion locally (not persisted — will reappear on next tab open)
  function handleDismissAiSug(menuItemId: string) {
    setAiSugs((prev) => prev.filter((r) => r.menu_item_id !== menuItemId));
  }

  // Remove a confirmed pairing and persist
  async function handleRemoveRec(menuItemId: string) {
    const next = itemRecs.filter((r) => r.menu_item_id !== menuItemId);
    setItemRecs(next);
    // Drafts: state-only mutation, flushed via updateItemModifiers after
    // onSaveNewItem returns the real id.
    if (isNewItem) return;
    try {
      await service.updateItemModifiers(item.id, {
        recommendations: next.map((r) => ({
          menu_item_id: r.menu_item_id,
          name: r.name,
          price_override: null,
          thumbnail_url: r.thumbnail_url ?? null,
        })),
      });
      if (restaurantId) broadcastRecommendationChange(item.id, restaurantId);
    } catch {
      setItemRecs(itemRecs);
    }
  }

  // Add a seed pairing on a new (draft) dish from the inline picker.
  // State-only — flushed via updateItemModifiers after onSaveNewItem.
  function handleAddSeedRec(picked: MenuItemDisplay) {
    setItemRecs((prev) => {
      if (prev.some((r) => r.menu_item_id === picked.id)) return prev;
      return [
        ...prev,
        {
          menu_item_id: picked.id,
          name: picked.name,
          price_override: null,
          thumbnail_url: picked.thumbnail_url ?? null,
          recommendation_type: 'manual',
        },
      ];
    });
  }

  // ── Dishes tab handlers (used when editing an addon item) ───────────────

  async function handleAddToDish(dish: MenuItemDisplay) {
    const newEntry: AddonEntry = {
      menu_item_id: item.id,
      name: item.name,
      price_override: price ?? item.price ?? 0,
      thumbnail_url: item.thumbnail_url ?? null,
      status: 'approved',
      suggestion_source: 'manual',
    };
    const nextAddons = [...(dish.addons ?? []), newEntry];
    setAssociatedDishIds((prev) => new Set([...prev, dish.id]));
    try {
      await service.updateItemModifiers(dish.id, { addons: nextAddons });
      onDishAddonsChange?.(dish.id, nextAddons);
      if (restaurantId) broadcastAddonChange(dish.id, restaurantId);
    } catch {
      setAssociatedDishIds((prev) => { const next = new Set(prev); next.delete(dish.id); return next; });
    }
  }

  async function handleRemoveFromDish(dish: MenuItemDisplay) {
    const nextAddons = (dish.addons ?? []).filter((a) => a.menu_item_id !== item.id);
    setAssociatedDishIds((prev) => { const next = new Set(prev); next.delete(dish.id); return next; });
    // In deferred-creation mode the addon has no DB row yet — only update local state.
    if (isDeferredCreation) return;
    try {
      await service.updateItemModifiers(dish.id, { addons: nextAddons });
      onDishAddonsChange?.(dish.id, nextAddons);
      if (restaurantId) broadcastAddonChange(dish.id, restaurantId);
    } catch {
      setAssociatedDishIds((prev) => new Set([...prev, dish.id]));
    }
  }

  async function handleAddToMultipleDishes(dishIds: Set<string>, realAddonId?: string) {
    if (!allItems || dishIds.size === 0) return;
    const dishes = allItems.filter((d) => dishIds.has(d.id));
    // Optimistic: add all to associated set and clear selection
    setAssociatedDishIds((prev) => new Set([...prev, ...dishIds]));
    setSelectedDishIds(new Set());
    // In deferred-creation mode (no realAddonId override), only update local state.
    // The actual API calls happen after save, when the real ID is known.
    if (isDeferredCreation && !realAddonId) return;
    const addonId = realAddonId ?? item.id;
    const failed: string[] = [];
    for (const dish of dishes) {
      const newEntry: AddonEntry = {
        menu_item_id: addonId,
        name: name.trim() || item.name,
        price_override: price ?? item.price ?? 0,
        thumbnail_url: item.thumbnail_url ?? null,
        status: 'approved',
        suggestion_source: 'manual',
      };
      const nextAddons = [...(dish.addons ?? []), newEntry];
      try {
        await service.updateItemModifiers(dish.id, { addons: nextAddons });
        onDishAddonsChange?.(dish.id, nextAddons);
        if (restaurantId) broadcastAddonChange(dish.id, restaurantId);
      } catch {
        failed.push(dish.id);
      }
    }
    // Rollback failures
    if (failed.length > 0) {
      setAssociatedDishIds((prev) => {
        const next = new Set(prev);
        for (const id of failed) next.delete(id);
        return next;
      });
    }
  }

  // ── Clone Save ──────────────────────────────────────────────────────────
  //
  // Only meaningful when cloneMode === true. Validates the rename gate
  // client-side (same rules as the server), then calls the consumer's
  // onCloneSave which hits POST /owner/menu/items/{sourceItemId}/clone.
  // On success: relays the new item via onComplete (so the consumer can
  // refresh its list / open the new id) and closes the modal. On failure:
  // surfaces the error inline above the action bar.
  async function handleCloneSave() {
    if (!cloneMode || !onCloneSave || !sourceItemId) return;
    // Re-check validation at click time in case state diverged from the
    // disabled-button gate (shouldn't happen, but cheap insurance).
    if (nameValidation !== null) return;

    setCloneSaving(true);
    setCloneError(null);
    try {
      const created = await onCloneSave(sourceItemId, name.trim());
      // Hand a minimal MenuItemDisplay back to the parent so its item
      // list can patch in the new row without a full refetch. The full
      // hydrated shape will land on the next GET /owner/menu/items/{id}.
      onComplete({
        ...item,
        id: created.id,
        name: created.name,
        item_type: (created.item_type as 'dish' | 'addon' | 'included' | undefined)
          ?? item.item_type,
      });
      onClose();
    } catch (err) {
      console.error('Clone failed', err);
      const message = err instanceof Error ? err.message : String(err);
      setCloneError(message || 'Clone failed — please try again.');
    } finally {
      setCloneSaving(false);
    }
  }

  // ── Save ────────────────────────────────────────────────────────────────

  async function handleSave() {
    let hasError = false;
    if (!name.trim()) { setNameError(true); hasError = true; }
    if (!isAddon && !description.trim()) { setDescError(true); hasError = true; }
    // Add-on price validation. Required only when creating a plain new add-on;
    // a modifier-type option (STR-956) has an OPTIONAL price, and editing is
    // optional too. Whatever price IS entered still gets the sanity checks
    // (non-negative; ≤ 10,000 — surcharges above that are a data-entry error).
    if (isAddon) {
      const priceRequired = isNewItem && !modifierTypeName;
      if (priceRequired && price === null) {
        setPriceError('Price is required');
        hasError = true;
      } else if (price !== null) {
        if (!Number.isFinite(price) || price < 0) {
          setPriceError('Price must be a non-negative number');
          hasError = true;
        } else if (price > 10_000) {
          setPriceError('Price must be ≤ 10,000');
          hasError = true;
        }
      }
    }
    if (hasError) return;
    setPriceError(null);

    const start = Date.now();
    setNameError(false);
    setDescError(false);
    setSaving(true);
    setSaveError(null);

    // Build food tags — other fields from TAG_FIELDS only.
    //
    // heat_spice and sweetness_label are NOT embedded here; they're written
    // through the canonical /spice/{itemId} and /sweetness/{itemId} endpoints
    // via the onHeatSpiceUpdate / onSweetnessUpdate callbacks below. Those
    // endpoints atomically update both the int columns (spice_level /
    // sweetness_level) and the JSONB labels in one transaction. Embedding
    // them in this food_tags payload would race with the canonical write.
    //
    // Falls back gracefully when the consumer hasn't wired the callbacks: in
    // that case (legacy consumers without scale support), we still embed the
    // labels so existing behaviour is preserved.
    const foodTags: FoodTags = {};
    for (const { key } of TAG_FIELDS) {
      const fieldName = FOOD_TAG_FIELD_MAP[key] ?? key;
      const vals = tags[key];
      if (vals && vals.length > 0) {
        (foodTags as Record<string, string[]>)[fieldName] = vals;
      }
    }
    if (heatSpice && !onHeatSpiceUpdate) {
      (foodTags as Record<string, string>).heat_spice = heatSpice;
    }
    if (sweetnessLabel && !onSweetnessUpdate) {
      foodTags.sweetness_label = sweetnessLabel;
    }

    // Beverage Profile — owner-editable in the modal for Beverages-category
    // items. The normalize is KEY-PRESERVING (PLAN 2026-08-04 M5): it spreads
    // the item's existing beverage blob FIRST so keys this form doesn't own
    // (pipeline-written facets, future keys) survive the food_tags
    // full-replace channel, then applies the form-owned keys with the legacy
    // set-or-drop semantics — a cleared/type-inapplicable form field still
    // deletes its key exactly as the old allowlist build did, keeping
    // non-wine saves byte-identical modulo the preserved unknown keys.
    if (category === 'Beverages') {
      const type = bevDraft.beverage_type?.trim() || undefined;
      const norm: BeverageTags = { ...((item.food_tags?.beverage ?? {}) as BeverageTags) };
      const setOrDrop = <K extends keyof BeverageTags>(
        key: K,
        value: BeverageTags[K] | null | undefined,
        applicable = true,
      ) => {
        if (applicable && value !== undefined && value !== null && value !== '') {
          norm[key] = value as BeverageTags[K];
        } else {
          delete norm[key];
        }
      };
      setOrDrop('beverage_type', type);
      setOrDrop('alcoholic', typeof bevDraft.alcoholic === 'boolean' ? bevDraft.alcoholic : undefined);
      setOrDrop('base_spirit', bevDraft.base_spirit, type === 'cocktail');
      // 'rosé' → 'rose': the accented value was UI-side drift from the
      // backend canonical vocabulary — normalized on every save (M5 fix).
      setOrDrop(
        'wine_color',
        bevDraft.wine_color === 'rosé' ? 'rose' : bevDraft.wine_color,
        type === 'wine',
      );
      setOrDrop('wine_variety', bevDraft.wine_variety, type === 'wine');
      setOrDrop('wine_body', bevDraft.wine_body, type === 'wine');
      setOrDrop('wine_style', bevDraft.wine_style, type === 'wine');
      setOrDrop('sweetness', bevDraft.sweetness, type === 'wine' || type === 'cocktail');
      setOrDrop('beer_style', bevDraft.beer_style, type === 'beer');
      setOrDrop('strength', bevDraft.strength);
      setOrDrop('served', bevDraft.served);
      const notes = Array.isArray(bevDraft.flavor_notes)
        ? bevDraft.flavor_notes.filter((s) => typeof s === 'string' && s.trim())
        : [];
      setOrDrop('flavor_notes', notes.length ? notes : undefined);
      const ings = Array.isArray(bevDraft.key_ingredients)
        ? bevDraft.key_ingredients.filter((s) => typeof s === 'string' && s.trim())
        : [];
      setOrDrop('key_ingredients', ings.length ? ings : undefined);
      // Wine-only structured facets (M5). Form-owned only when the type is
      // wine — other beverage types keep whatever the pipeline wrote (the
      // spread above preserves them untouched).
      if (type === 'wine') {
        const tsIn = bevDraft.taste_scales ?? {};
        const cleanTs: NonNullable<BeverageTags['taste_scales']> = {};
        for (const { key } of WINE_TASTE_SCALE_AXES) {
          const v = tsIn[key];
          if (typeof v === 'number' && isFinite(v) && v >= 0 && v <= 100) {
            cleanTs[key] = Math.round(v);
          }
        }
        setOrDrop('taste_scales', Object.keys(cleanTs).length ? cleanTs : undefined);
        const pairings = Array.isArray(bevDraft.dish_pairings)
          ? bevDraft.dish_pairings.filter((p) =>
            WINE_DISH_PAIRING_OPTIONS.some((o) => o.value === p))
          : [];
        setOrDrop('dish_pairings', pairings.length ? pairings : undefined);
        setOrDrop('tasting_note', bevDraft.tasting_note?.trim().slice(0, 160) || undefined);
        setOrDrop('short_story', bevDraft.short_story?.trim().slice(0, 300) || undefined);
        setOrDrop('long_story', bevDraft.long_story?.trim().slice(0, 3000) || undefined);
        // story_source is NOT form-owned — no setOrDrop call. It's set by
        // the backend (menu import / enrichment Lambda), never by this
        // form, so the key-preserving spread above is what keeps it
        // intact; editing the story text here doesn't touch provenance.
      }
      if (Object.keys(norm).length > 0) {
        foodTags.beverage = norm;
      }
    }

    // Wine identity + merge-channel facets (PLAN 2026-08-04 M5). Identity
    // rides top-level PATCH fields; the beverage facets ALSO go through the
    // server-side KEY-ADDITIVE `beverage` merge so lagging EditModal copies
    // (older shared-submodule consumers) can't be the only writers of the
    // new keys. Sent as a SEPARATE follow-up PUT: the backend builds a
    // `food_tags = …` SQL assignment for BOTH the wholesale food_tags
    // replace and the beverage merge, so one request carrying both would be
    // an invalid double column assignment. wine_old_world is NOT sent when
    // the country derives to a known world (the server derives it; sending
    // both risks code=inconsistent_pair) — only the explicit toggle for
    // unknown/absent countries travels.
    const isWineItem = category === 'Beverages' && (bevDraft.beverage_type?.trim() || '') === 'wine';
    const buildWinePatch = (): Record<string, unknown> | null => {
      if (!isWineItem) return null;
      const country = wineCountry.trim();
      const derived = deriveOldWorld(country);
      const vintageNum = parseInt(wineVintage, 10);
      const normBev = (foodTags.beverage ?? {}) as Record<string, unknown>;
      const bevMerge: Record<string, unknown> = {};
      for (const key of Object.keys(normBev)) {
        if (BEVERAGE_MERGE_KEYS.has(key)) bevMerge[key] = normBev[key];
      }
      return {
        wine_varietal: wineVarietal.trim() || null,
        wine_region: wineRegion.trim() || null,
        wine_vintage: isFinite(vintageNum) ? vintageNum : null,
        wine_producer: wineProducer.trim() || null,
        wine_country: country || null,
        ...(derived === null && wineOldWorld !== null ? { wine_old_world: wineOldWorld } : {}),
        ...(Object.keys(bevMerge).length > 0 ? { beverage: bevMerge } : {}),
      };
    };
    const winePatch = buildWinePatch();
    // Local-state wine fields for the optimistic `updated` merge — the PUT
    // response subset doesn't echo the wine columns.
    const wineLocalOverlay: Partial<MenuItemDisplay> = winePatch
      ? {
        wine_varietal: (winePatch.wine_varietal as string | null),
        wine_region: (winePatch.wine_region as string | null),
        wine_vintage: (winePatch.wine_vintage as number | null),
        wine_producer: (winePatch.wine_producer as string | null),
        wine_country: (winePatch.wine_country as string | null),
        wine_old_world: deriveOldWorld(wineCountry) ?? wineOldWorld,
      }
      : {};

    // Wine serving sizes (PDD 2026-06-15). Build the serving_options payload from
    // the editor rows when the item is a wine. Drops rows without a label or a
    // valid (>= 0) price; converts dollars → price_cents; forces exactly one
    // default. Returns [] (clear) when wine with no valid rows, or undefined
    // (untouched) when the item isn't a wine — so non-wine saves never send it.
    const buildServingOptions = (): Array<{ id: string; label: string; volume_ml?: number; price_cents: number; is_default: boolean }> | undefined => {
      if (!(category === 'Beverages' && bevDraft.beverage_type === 'wine')) return undefined;
      const seen = new Set<string>();
      const out: Array<{ id: string; label: string; volume_ml?: number; price_cents: number; is_default: boolean }> = [];
      for (const row of servingRows) {
        const label = row.label.trim();
        const priceNum = parseFloat(row.price);
        if (!label || !isFinite(priceNum) || priceNum < 0) continue;
        let slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'option';
        let n = 2;
        while (seen.has(slug)) { slug = `${slug}-${n}`; n += 1; }
        seen.add(slug);
        const opt: { id: string; label: string; volume_ml?: number; price_cents: number; is_default: boolean } = {
          id: slug, label, price_cents: Math.round(priceNum * 100), is_default: !!row.is_default,
        };
        const vol = parseInt(row.volume_ml, 10);
        if (isFinite(vol) && vol > 0) opt.volume_ml = vol;
        out.push(opt);
      }
      if (out.length > 0 && !out.some((o) => o.is_default)) out[0].is_default = true;
      // Only one default survives — first flagged wins.
      let defaulted = false;
      for (const o of out) {
        if (o.is_default && !defaulted) { defaulted = true; }
        else { o.is_default = false; }
      }
      return out;
    };
    const servingOptionsPayload = buildServingOptions();

    try {
      // ── Deferred-creation path ─────────────────────────────────────────────
      // When onSaveNewItem is provided the item has no DB row yet (draft only in
      // local state). Create it now with the completed form data instead of calling
      // updateMenuItem on a non-existent ID.
      if (isNewItem && onSaveNewItem) {
        const created = await onSaveNewItem({
          name: name.trim(),
          description: description.trim(),
          // Raw scraped category label (→ menu_items.category_name). Falls back
          // to the derived canonical for brand-new items with no raw label yet.
          category: rawCategory.trim() || category.trim(),
          food_tags: foodTags,
          item_type: isAddon ? 'addon' : 'dish',
          ...(isAddon && price !== null ? { price } : {}),
          ...(isAddon ? { memo: memo.trim() || null } : {}),
          ...(servingOptionsPayload !== undefined ? { serving_options: servingOptionsPayload } : {}),
        });
        const updated: MenuItemDisplay = {
          ...item,
          ...created,
          // Carry forward the canonical_category the owner selected — the pipeline
          // will also assign it, but setting it immediately makes the pool reflect
          // the chosen category without waiting for a pipeline run.
          canonical_category: category.trim() || created.canonical_category,
          active: isActive,
          item_type: isAddon ? 'addon' : 'dish',
          ...wineLocalOverlay,
        };

        // Flush the wine identity columns + merge-channel facets now that
        // the item has a real DB id (create doesn't accept them). Fail-soft
        // like the other post-create flushes — the owner can re-save from
        // the editor if this follow-up fails.
        if (winePatch && created.id) {
          try {
            await service.updateMenuItem(created.id, winePatch as Partial<MenuItemDisplay>);
          } catch (err) {
            console.error('Failed to flush wine fields', err);
          }
        }
        // Flush deferred dish associations now that the addon has a real DB ID.
        // associatedDishIds contains both preselectedDishIds and any dishes the user
        // added via "Add Selected" while the modal was open (local-only until now).
        // selectedDishIds contains checked-but-not-yet-added dishes.
        if (isAddon && created.id) {
          const allPendingDishIds = new Set([...associatedDishIds, ...selectedDishIds]);
          if (allPendingDishIds.size > 0) {
            await handleAddToMultipleDishes(allPendingDishIds, created.id);
          }
        }

        // Flush deferred allergen + dietary selections via setItemTags now
        // that the item has a real DB id. Failures are logged but don't
        // block the create — the owner can re-tag from the saved item.
        if (dietaryTagService && restaurantId && created.id) {
          const update: { allergens?: string[]; dietary?: string[] } = {};
          if (allergenSet.size > 0) update.allergens = Array.from(allergenSet).sort();
          if (dietarySet.size > 0) update.dietary = Array.from(dietarySet).sort();
          if (Object.keys(update).length > 0) {
            try { await dietaryTagService.setItemTags(restaurantId, created.id, update); }
            catch (err) { console.error('Failed to flush draft dietary tags', err); }
          }
        }

        // Flush deferred seed recommendations the owner picked in the
        // Recommendations tab. Same fail-soft policy as dietary.
        if (!isAddon && created.id && itemRecs.length > 0) {
          try {
            await service.updateItemModifiers(created.id, {
              recommendations: itemRecs.map((r) => ({
                menu_item_id: r.menu_item_id,
                name: r.name,
                price_override: null,
                thumbnail_url: r.thumbnail_url ?? null,
              })),
            });
            if (restaurantId) broadcastRecommendationChange(created.id, restaurantId);
          } catch (err) {
            console.error('Failed to flush draft recommendations', err);
          }
        }

        trackAction('menu.editModal.save', {
          restaurantId,
          metadata: { itemId: created.id, isAddon, hasImage: false, activeToggled: false, convertedToAddon: false },
          success: true,
          durationMs: Date.now() - start,
        });
        onComplete(updated);
        return;
      }

      // ── Existing-item update path ──────────────────────────────────────────
      // The dropdown now edits the RAW scraped category (→ menu_items.category_name).
      // canonical_category is intentionally NOT sent — it is preserved server-side
      // and (per the new model) lives as a course mapping on the menu, not here.
      const updates: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim(),
        category: rawCategory.trim(),
        food_tags: foodTags,
        item_type: isAddon ? 'addon' : 'dish',
        // STR-303: add-on mode is the sole per-item price surface in this modal.
        // Dishes continue to price per-menu in MenuBuilder — do not send price for them.
        ...(isAddon ? { price } : {}),
        // Addon memo — owner/staff-facing note (≤500 chars), addon-only.
        // Trim then collapse to null when empty so the backend stores NULL
        // rather than an empty string. Match the Setup Guide → Add-ons
        // editor's normalisation.
        ...(isAddon ? { memo: memo.trim() || null } : {}),
        // PDD 2026-05-15 — per-item opt-out for the patron composition
        // page Spice Level slider. Only meaningful for dishes; add-ons
        // never reach the composition page so the field is harmless there.
        spice_modifier_enabled: spiceModifierEnabled,
        // PDD 2026-07-17 — independent "required" flag (no longer mirrored off
        // visibility). When the picker is hidden, requirement is meaningless, so
        // we send false; the backend also force-reverts to false in that case,
        // so sending the raw value would be safe too — we normalise here for a
        // consistent stored value. Add-ons never reach the composition page.
        ...(isAddon
          ? {}
          : { spice_selection_required: spiceModifierEnabled ? spiceSelectionRequired : false }),
        // PDD 2026-05-26 — BYO classification. Only sent for dishes;
        // add-ons can never be BYO themselves. API enforces hard-block
        // when is_byo=true and groupings empty (returns 400).
        ...(isAddon ? {} : { is_byo: isByo }),
        // Wine serving sizes (PDD 2026-06-15) — sent only for wine items
        // (undefined ⇒ omitted, so non-wine saves leave the column untouched).
        ...(servingOptionsPayload !== undefined ? { serving_options: servingOptionsPayload } : {}),
      };

      // When converting dish → addon, remove all menu associations first.
      // The item stays as an add-on associated with other dishes — only
      // the menu category placements are stripped.
      const wasConvertedToAddon = isAddon && item.item_type !== 'addon';
      const menuAssocsToRemove = wasConvertedToAddon
        ? (item.menu_associations ?? []).filter((a) => 'menu_id' in a && a.menu_id)
        : [];
      if (menuAssocsToRemove.length > 0) {
        for (const assoc of menuAssocsToRemove) {
          await service.removeItemFromMenu(item.id, assoc.menu_id);
        }
      }

      const previousHeatSpice = (() => {
        const hs = item.food_tags?.heat_spice;
        if (Array.isArray(hs)) return (hs as string[])[0] ?? null;
        if (typeof hs === 'string') return hs || null;
        return null;
      })();
      const heatSpiceChanged = heatSpice !== previousHeatSpice;
      const sweetnessChanged = sweetnessLabel !== (item.food_tags?.sweetness_label ?? null);
      const [saved] = await Promise.all([
        service.updateMenuItem(item.id, updates),
        isActive !== (item.active !== false)
          ? service.toggleMenuItemActive(item.id, isActive)
          : Promise.resolve(),
        heatSpiceChanged && onHeatSpiceUpdate && restaurantId
          ? onHeatSpiceUpdate(item.id, heatSpice)
          : Promise.resolve(),
        sweetnessChanged && onSweetnessUpdate && restaurantId
          ? onSweetnessUpdate(item.id, sweetnessLabel)
          : Promise.resolve(),
      ]);

      // Wine dual-channel follow-up (PLAN 2026-08-04 M5) — sequential AFTER
      // the main PUT so the server-side key-additive `beverage` merge and the
      // wine identity columns land deterministically on top of the (already
      // key-preserving) food_tags write. See buildWinePatch for why this
      // can't ride the main request body.
      if (winePatch) {
        await service.updateMenuItem(item.id, winePatch as Partial<MenuItemDisplay>);
      }

      // STR-323: flush pending dish selections from the Dishes tab. Users who tick
      // dish checkboxes and click Save Changes (without first clicking "Add Selected")
      // would otherwise silently lose those selections on modal close.
      // handleAddToMultipleDishes persists each association via updateItemModifiers
      // and fires onDishAddonsChange so MenuManagerClient patches local state.
      if (isAddon && selectedDishIds.size > 0) {
        await handleAddToMultipleDishes(selectedDishIds);
      }

      // Persist preselected dish associations that aren't yet saved on the backend.
      // These show in "Associated Dishes" but haven't been persisted via updateItemModifiers.
      if (isAddon && preselectedDishIds && preselectedDishIds.length > 0) {
        const unsaved = preselectedDishIds.filter((id) =>
          associatedDishIds.has(id) &&
          !allItems?.find((d) => d.id === id)?.addons?.some((a) => a.menu_item_id === item.id),
        );
        if (unsaved.length > 0) {
          await handleAddToMultipleDishes(new Set(unsaved));
        }
      }

      // heat_spice / sweetness_label live in food_tags JSONB but are written via
      // the canonical /spice and /sweetness endpoints, not service.updateMenuItem.
      // The `saved` payload from updateMenuItem reflects only what we sent it
      // (without those keys when callbacks are wired) — re-attach them in local
      // state so the UI shows the canonical write's effect immediately.
      const mergedFoodTags = {
        ...((saved.food_tags ?? foodTags) as FoodTags),
        ...(onHeatSpiceUpdate ? { heat_spice: heatSpice ?? undefined } : {}),
        ...(onSweetnessUpdate ? { sweetness_label: sweetnessLabel ?? undefined } : {}),
      } as FoodTags;
      // RCA 2026-05-15 — propagating fields by explicit whitelist was a
      // maintenance trap: every new field the backend adds (spice_modifier_enabled
      // was the latest example) had to be re-listed here, or the parent
      // FoodItemsManagerClient.replaceItem received a stale `updated` and
      // the close-then-reopen render showed the pre-save value until a hard
      // page refresh forced a fresh GET.
      //
      // New shape — three layers, narrow → broad:
      //   1. `...item` is the baseline. Preserves fields the PUT response
      //      doesn't echo (gallery_urls, addons[], sides_and/sides_or[],
      //      recommendations[], groupings[], allergens_state, dietary_state,
      //      display_allergens, display_dietary, spice_level, sweetness_level,
      //      enrichment metadata, etc.).
      //   2. `...saved` is the server-confirmed PUT response. ANY field the
      //      backend echoes flows through automatically. Adding a new field
      //      to MenuItemUpdateResponse in owner-api.yaml is now a one-line
      //      change that's automatically reactive across the EditModal save
      //      path — no follow-up edit here.
      //   3. The explicit overrides below are ONLY for fields managed via
      //      endpoints OTHER than service.updateMenuItem, OR derived in the
      //      modal from local state the user just changed. Document each
      //      override's source endpoint so future edits don't reintroduce
      //      stale-state drift.
      const updated: MenuItemDisplay = {
        ...item,
        ...saved,
        // category: the raw scraped label the owner just picked. `...saved`
        // already echoes it (PUT returns category_name as `category`), but set
        // it explicitly so local state is correct even if the echo is stale.
        category: rawCategory.trim(),
        // canonical_category: no longer edited here — preserve the stored value.
        canonical_category: item.canonical_category,
        // food_tags: re-merges heat_spice / sweetness_label written via the
        // separate /spice and /sweetness endpoints (not present in `saved`).
        food_tags: mergedFoodTags,
        // active: written via service.toggleMenuItemActive — not echoed by
        // the PUT response.
        active: isActive,
        // thumbnail_url: written via image upload endpoints — not echoed.
        thumbnail_url: thumbnail,
        // item_type / price: spread already carries `saved` values; this
        // re-affirms the local UI state for the convert-dish-to-addon flow
        // where the user toggles in-modal before save settles.
        item_type: isAddon ? 'addon' : 'dish',
        price: isAddon ? price : (saved.price ?? item.price),
        // addons / recommendations: written via service.updateItemModifiers —
        // local `itemAddons` / `itemRecs` reflect the in-modal state which
        // may include unsaved selections flushed by handleAddToMultipleDishes.
        addons: itemAddons,
        recommendations: itemRecs,
        // Wine identity columns (M5): written via the follow-up winePatch PUT
        // whose response subset doesn't echo them — local state is the
        // source of truth (wine_old_world uses the locally-derived value,
        // matching what the server derives from the same closed maps).
        ...wineLocalOverlay,
        // Clear menu associations in local state when converted to addon.
        ...(wasConvertedToAddon ? { menu_associations: [] } : {}),
      };

      trackAction('menu.editModal.save', {
        restaurantId,
        metadata: {
          itemId: item.id,
          isAddon,
          hasImage: !!thumbnail,
          activeToggled: isActive !== (item.active !== false),
          convertedToAddon: wasConvertedToAddon,
        },
        success: true,
        durationMs: Date.now() - start,
      });
      onComplete(updated);
    } catch (err) {
      trackAction('menu.editModal.save', {
        restaurantId,
        metadata: { itemId: item.id },
        success: false,
        durationMs: Date.now() - start,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      setSaveError(err instanceof Error ? err.message : 'Failed to save — please try again');
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────

  async function handleDelete() {
    const start = Date.now();
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await service.deleteMenuItem(item.id);
      trackAction('menu.editModal.delete', {
        restaurantId,
        metadata: { itemId: item.id },
        success: true,
        durationMs: Date.now() - start,
      });
      onComplete({ ...item, _deleted: true });
    } catch (err) {
      trackAction('menu.editModal.delete', {
        restaurantId,
        metadata: { itemId: item.id },
        success: false,
        durationMs: Date.now() - start,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete');
      setDeleteLoading(false);
      setDeleteConfirming(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const imgBusyLabel: Record<NonNullable<typeof imgBusy>, string> = {
    uploading:  'Uploading…',
    removing:   'Removing…',
  };

  // ── Section rail ──────────────────────────────────────────────────────────
  const isWine = category === 'Beverages' && (bevDraft.beverage_type?.trim() || '') === 'wine';
  // Dietary & allergens applies to dishes and add-ons alike; wine carries no
  // dietary/allergen/spice facets so the section is hidden for it.
  const showDietarySection = !isWine;
  const placementsCount = placementsDraft.filter((a) => !!a.menu_id).length;
  const sections: EditModalSectionEntry[] = [
    { key: 'food_tags', label: 'Basics', icon: Tag, group: 'main' },
    ...(showDietarySection ? [{ key: 'dietary', label: 'Dietary & allergens', icon: Leaf, group: 'main' } as const] : []),
    ...(!isAddon && !isNewItem && groupingsSlot ? [{ key: 'groupings', label: 'Modifiers', icon: SlidersHorizontal, group: 'main' } as const] : []),
    ...(!isAddon && !isNewItem ? [{ key: 'placements', label: 'Menu pricing', icon: Database, group: 'main' } as const] : []),
    // Pairings is gated on the SAME condition as Modifiers (saved, non-addon
    // dish with a groupings slot) — pairings-without-modifiers is incoherent.
    ...(!isAddon && !isNewItem && groupingsSlot && pairingsSlot ? [{ key: 'pairings', label: 'Pairings', icon: Wine, group: 'main' } as const] : []),
    ...(showRecipeTab ? [{ key: 'recipe', label: 'Recipe', icon: ChefHat, group: 'main' } as const] : []),
    { key: 'advanced', label: 'Advanced details', icon: Settings, group: 'main' },
    ...(!isNewItem ? [{ key: 'performance', label: 'Performance', icon: BarChart3, group: 'more' } as const] : []),
    ...(isAddon && !isNewItem ? [{ key: 'dishes', label: `Dishes${associatedDishIds.size > 0 ? ` (${associatedDishIds.size})` : ''}`, icon: Utensils, group: 'more' } as const] : []),
  ];
  const isPricingSection = activeTab === 'placements';
  const pricingMenu = isPricingSection
    ? (placementsDraft.find((a) => a.menu_id === pricingMenuId) ?? placementsDraft[0] ?? null)
    : null;
  const money = (n: number) => `${currencySymbol}${n.toFixed(2)}`;

  // Menu pricing — optimistic per-menu write with rollback. `patch` keys mirror
  // MenuItemJunctionSettings; the local draft accepts the same shapes.
  const persistPlacement = useCallback(
    async (menuId: string, patch: Partial<MenuItemJunctionSettings>) => {
      if (placementsSaving.has(menuId)) return;
      const before = placementsDraft;
      setPlacementsDraft((prev) => prev.map((a) =>
        a.menu_id === menuId ? { ...a, ...patch } as MenuAssociation : a,
      ));
      setPlacementSaving(menuId, true);
      try {
        await service.updateMenuItemInMenu(item.id, menuId, patch);
      } catch (err) {
        console.error(`Failed to update menu placement ${menuId} for ${item.id}`, err);
        setPlacementsDraft(before);
      } finally {
        setPlacementSaving(menuId, false);
      }
    },
    [placementsDraft, placementsSaving, setPlacementSaving, service, item.id],
  );
  const removePlacement = useCallback(
    async (menuId: string) => {
      if (placementsSaving.has(menuId)) return;
      const before = placementsDraft;
      setPlacementsDraft((prev) => prev.filter((a) => a.menu_id !== menuId));
      setPlacementSaving(menuId, true);
      try {
        await service.removeItemFromMenu(item.id, menuId);
      } catch (err) {
        console.error(`Failed to unpublish ${item.id} from menu ${menuId}`, err);
        setPlacementsDraft(before);
      } finally {
        setPlacementSaving(menuId, false);
      }
    },
    [placementsDraft, placementsSaving, setPlacementSaving, service, item.id],
  );

  // Header title — live from the Name field so a rename reads back at once.
  const headerTitle = name.trim() || (isAddon ? 'New add-on' : 'New item');
  const scopeLine = isNewItem
    ? 'Saved to the library; add it to menus from Menu pricing once saved.'
    : isAddon
      ? 'Changes here update this add-on on every dish that offers it.'
      : itemScopeLine(placementsCount);

  // ── Item image panel — shared by the dish and add-on Basics layouts ───────
  const imagePanel = (
    <div data-testid="item-image-panel" className="w-full flex flex-col gap-2">
      <div
        data-testid="edit-thumbnail"
        className={`w-full aspect-square rounded-ctl overflow-hidden flex items-center justify-center relative ${
          thumbnail ? '' : 'bg-surface2 border-2 border-dashed border-line'
        }`}
      >
        {imgBusy ? (
          <span className="text-xs text-ink-soft text-center p-3">{imgBusyLabel[imgBusy]}</span>
        ) : thumbnail ? (
          <img src={thumbnail} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="text-center text-ink-faint">
            <Images size={26} className="mx-auto mb-1" aria-hidden="true" />
            <div className="text-xs">item photo</div>
          </div>
        )}
      </div>

      {/* "Change / Upload" — pure file picker (no capture attribute). On
          mobile this opens the device photo library; the separate "Take
          photo" button opens the camera. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={handleUpload}
        style={{ display: 'none' }}
        data-testid="edit-image-file-input"
      />
      {isMobile && (
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleUpload}
          style={{ display: 'none' }}
          data-testid="edit-image-camera-input"
        />
      )}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={!!imgBusy}
          data-testid="edit-upload-btn"
          className="flex-1 h-8 rounded-ctl border border-ink bg-surface text-xs font-semibold text-ink cursor-pointer inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
        >
          <Upload size={12} aria-hidden="true" />
          {imgBusy === 'uploading' ? 'Uploading…' : thumbnail ? 'Change' : 'Upload'}
        </button>
        {galleryPanelSlot && (
          <button
            type="button"
            data-testid="edit-choose-from-gallery-btn"
            onClick={() => setGalleryOpen(true)}
            disabled={!!imgBusy}
            className="flex-1 h-8 rounded-ctl border border-line bg-surface text-xs font-semibold text-ink cursor-pointer inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            <Eye size={12} aria-hidden="true" />
            Gallery
          </button>
        )}
      </div>
      {(isMobile || thumbnail || (!thumbnail && imageLibrarySlot)) && (
        <div className="flex flex-wrap gap-1.5">
          {isMobile && (
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              disabled={!!imgBusy}
              data-testid="edit-take-photo-btn"
              className="h-8 px-2.5 rounded-ctl border border-line bg-surface text-xs font-semibold text-ink cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              <Camera size={12} aria-hidden="true" />
              {imgBusy === 'uploading' ? 'Uploading…' : 'Take photo'}
            </button>
          )}
          {!thumbnail && imageLibrarySlot && imageLibrarySlot({
            itemId: item.id,
            itemName: name,
            onPicked: (url) => setThumbnail(url),
          })}
          {thumbnail && (
            <>
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                disabled={!!imgBusy}
                data-testid="preview-button"
                className="h-8 px-2.5 rounded-ctl border border-line bg-surface text-xs font-semibold text-ink cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                <ScanEye size={12} aria-hidden="true" />
                Preview
              </button>
              <button
                type="button"
                onClick={handleRemoveImage}
                disabled={!!imgBusy}
                data-testid="edit-remove-image-btn"
                className="h-8 px-2.5 rounded-ctl border border-line bg-surface text-xs font-semibold text-bad cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                <Trash2 size={12} aria-hidden="true" />
                {imgBusy === 'removing' ? 'Removing…' : 'Remove'}
              </button>
            </>
          )}
        </div>
      )}
      {imgError && (
        <div className="text-xs text-bad flex items-center gap-1">
          <AlertCircle size={11} aria-hidden="true" />
          {imgError}
        </div>
      )}
      {!thumbnail && !imgBusy && (
        <div
          data-testid="no-image-warning"
          className="text-xs text-warn bg-warn-bg rounded-ctl px-2 py-1.5 flex items-center gap-1.5"
        >
          <AlertCircle size={11} aria-hidden="true" />
          Add an image to complete this item
        </div>
      )}
    </div>
  );

  // ── Name field (Basics) — the canonical Name input ────────────────────────
  const nameField = (
    <div>
      <label className={FIELD_LABEL_CLS} htmlFor="edit-name">Name</label>
      <input
        ref={nameInputRef}
        id="edit-name"
        type="text"
        value={name}
        placeholder={modifierTypeName
          ? (item.name || `${modifierTypeName} name`)
          : isAddon
            ? (isNewItem ? (item.name || 'Add-on name, e.g. Extra Chicken, Sub Beef') : 'Add-on name')
            : (isNewItem ? (item.name || 'Item name') : 'Item name')}
        onChange={(e) => { setName(e.target.value); setNameError(false); }}
        aria-label="Item name"
        aria-required="true"
        aria-invalid={(nameError || showNameInvalid) || undefined}
        data-testid="edit-name-input"
        className={`${FIELD_INPUT_CLS} ${(nameError || showNameInvalid) ? 'border-bad' : ''} ${
          cloneMode && _nameUnchangedFromSource ? 'bg-warn-bg' : ''
        }`}
      />
      {/* Helper-text precedence: (1) nameError after a failed Save click,
          (2) showNameInvalid — live derived state for new-item / clone-draft
          modes ("Name is required" / "cannot contain 'Copy'" / "must differ"). */}
      {showNameInvalid && nameHelperText ? (
        <div className="text-xs text-bad mt-1" data-testid="edit-name-error">{nameHelperText}</div>
      ) : nameError ? (
        <div className="text-xs text-bad mt-1" data-testid="edit-name-error">Name is required</div>
      ) : null}
    </div>
  );

  // ── Visible-to-guests row — the active flag ───────────────────────────────
  const visibilityRow = (
    <div className="flex items-center gap-3 flex-wrap py-3">
      <InkSwitch
        checked={isActive}
        mirrorPressed
        label="Visible to guests"
        testId="edit-active-toggle"
        onChange={(next) => {
          trackAction('menu.editModal.toggleActive', {
            restaurantId,
            metadata: { itemId: item.id, next },
          });
          setIsActive(next);
        }}
      />
      <span className="font-semibold text-ink">Visible to guests</span>
      {!isActive && <span className="text-[13px] text-ink-soft">Hidden from every menu until switched back on.</span>}
      {!isAddon && !isNewItem && (
        <span className="text-ink-soft border-l border-line pl-3">
          On {placementsCount} {placementsCount === 1 ? 'menu' : 'menus'} ·{' '}
          <button
            type="button"
            data-testid="edit-goto-pricing"
            onClick={() => setActiveTab('placements')}
            className="bg-transparent border-0 p-0 font-semibold text-ink cursor-pointer"
          >
            see menu pricing
          </button>
        </span>
      )}
    </div>
  );

  const tasteSummary = (tags.taste_profile ?? []).slice(0, 3).join(' · ');

  // ── Basics section ────────────────────────────────────────────────────────
  const basicsSection = isAddon ? (
    <section data-testid="addon-basic-info" className="flex flex-col gap-4">
      <div className="flex gap-[18px] flex-wrap">
        <div className="shrink-0 w-[150px]">{imagePanel}</div>
        <div className="flex-1 min-w-[240px] flex flex-col gap-3.5">
          {nameField}
          {/* Price — shown for every add-on, including modifier-type options.
              For a modifier option the price is OPTIONAL (no required
              asterisk, no validation, and it can be cleared); a plain new
              add-on keeps price required. */}
          <div className="max-w-[200px]">
            <label className={FIELD_LABEL_CLS} htmlFor="edit-price-input">
              Price{isNewItem && isAddon && !modifierTypeName && <span className="text-bad ml-0.5">*</span>}
            </label>
            <div className={`flex items-center gap-1 h-10 rounded-ctl border bg-surface px-3 ${priceError ? 'border-bad' : 'border-line-input'}`}>
              <span aria-hidden="true" className="text-ink-soft font-semibold">{currencySymbol}</span>
              <input
                id="edit-price-input"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={price === null ? '' : price}
                onChange={(e) => {
                  setPriceError(null);
                  const raw = e.target.value;
                  if (raw === '') { setPrice(null); return; }
                  const n = parseFloat(raw);
                  setPrice(Number.isFinite(n) && n >= 0 ? n : null);
                }}
                data-testid="edit-price-input"
                className="flex-1 min-w-0 border-0 outline-none bg-transparent text-sm text-ink p-0"
              />
              {price !== null && !(isNewItem && isAddon && !modifierTypeName) && (
                <button
                  type="button"
                  aria-label="Clear price"
                  onClick={() => { setPrice(null); setPriceError(null); }}
                  data-testid="edit-price-clear"
                  className="bg-transparent border-0 text-xs text-ink-soft cursor-pointer whitespace-nowrap p-0.5"
                >
                  × clear
                </button>
              )}
            </div>
            {priceError && <div className="text-xs text-bad mt-1">{priceError}</div>}
          </div>
        </div>
      </div>
      {/* Memo — owner/staff-facing free-text note (≤500 chars). Same field that
          surfaces as subtext in the Add Member picker; saves with the form. */}
      <div>
        <label className={FIELD_LABEL_CLS} htmlFor="edit-memo-input">Memo</label>
        <textarea
          id="edit-memo-input"
          data-testid="edit-memo-input"
          value={memo}
          maxLength={500}
          onChange={(e) => setMemo(e.target.value)}
          placeholder={modifierTypeName
            ? `Optional note — shown to staff when picking this ${modifierTypeName.toLowerCase()} option`
            : 'Optional note — shown to staff when picking this add-on'}
          rows={2}
          className="w-full min-h-[60px] rounded-ctl border border-line-input bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-ink resize-y"
        />
      </div>
      <div className="border-t border-line-row">{visibilityRow}</div>
    </section>
  ) : (
    <section data-testid="dish-basic-info" className="flex flex-col gap-4">
      <div className="flex gap-[18px] flex-wrap">
        <div className="shrink-0 w-[150px]">{imagePanel}</div>
        <div className="flex-1 min-w-[240px] flex flex-col gap-3.5">
          {nameField}
            {/* Description — sits right under the image so the owner
                can scan the dish then immediately confirm/edit copy. */}
            <div>
              {/* AI-suggested visual cue is gated on the row being an
                  unreviewed AI suggestion AND the owner not having started
                  typing their own copy. The moment `description` diverges
                  from the persisted `item.description`, the owner is
                  clearly authoring — drop the eyebrow / tint / Accept
                  button so they don't accidentally click Accept and lose
                  their unsaved edits. (Accept fires
                  description_review_action='accept' which keeps the
                  server's text, not the local draft.) */}
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <label style={labelStyle} htmlFor="edit-description">
                  Description <span style={{ color: 'var(--bad)' }}>*</span>
                </label>
                {/* AI-suggested eyebrow — opt-in via descriptionSource +
                    descriptionReviewed props. Mirrors the chip color used
                    by the food-tag pickers ('#B45309' on amber). */}
                {descriptionSource === 'ai_generated'
                  && descriptionReviewed === false
                  && description === (item.description ?? '') && (
                  <span
                    data-testid="edit-description-ai-eyebrow"
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: 'var(--editor-ai-ink, #A05A00)',
                    }}
                  >
                    🤖 AI suggested
                  </span>
                )}
              </div>
              <textarea
                id="edit-description"
                value={description}
                onChange={(e) => { setDesc(e.target.value); setDescError(false); }}
                rows={4}
                data-testid="edit-description-input"
                style={{
                  ...inputStyle,
                  resize: 'vertical',
                  minHeight: 60,
                  border: descError
                    ? '1px solid #b91c1c'
                    : descriptionSource === 'ai_generated'
                      && descriptionReviewed === false
                      && description === (item.description ?? '')
                      ? '1px solid var(--editor-ai-border, #FFE8CC)'
                      : '1px solid var(--border)',
                  // Amber tint when this is an unreviewed AI suggestion AND
                  // the owner hasn't started typing their own. Matches the
                  // row-level visual cue on the Setup Guide condition-items
                  // page. Once the owner edits the textarea the tint clears
                  // so the field reads as a normal owner-authored input.
                  background:
                    descriptionSource === 'ai_generated'
                      && descriptionReviewed === false
                      && description === (item.description ?? '')
                      ? 'var(--editor-ai-surface, #FFFBF5)'
                      : (inputStyle as { background?: string }).background ?? '#fff',
                }}
              />
              {descError && (
                <div className="text-caption" style={{ color: 'var(--bad)', marginTop: 3 }}>Description is required</div>
              )}
              {/* Accept button — verbatim accept of the AI suggestion
                  without typing your own. Routes through the consumer's
                  onAcceptDescription handler (page-level Accept flow on
                  Setup Guide). Hidden when the props aren't passed OR the
                  owner has started typing (avoids the silent edit-discard
                  footgun — Accept ignores the local draft). */}
              {descriptionSource === 'ai_generated'
                && descriptionReviewed === false
                && description === (item.description ?? '')
                && onAcceptDescription
                && !isNewItem && (
                  <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      data-testid="edit-description-accept"
                      onClick={async () => {
                        try {
                          await onAcceptDescription(item.id);
                        } catch {
                          // Consumer surfaces error via toast; swallow here
                          // so the button doesn't get stuck disabled.
                        }
                      }}
                      style={{
                        // Affirmative, exactly like the dietary Accept pill —
                        // same action, same colour.
                        background: 'var(--editor-affirm-solid, #1B7A4A)',
                        color: 'var(--surface)',
                        border: 'none',
                        borderRadius: 6,
                        padding: '6px 14px',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      Accept AI suggestion
                    </button>
                  </div>
                )}
            </div>
        </div>
      </div>
      <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            {/* Raw Category (moved here 2026-07-26, replacing the old
                "On menus" tiles — the Menus tab is now the menu surface). */}
            {/* Raw Category — edits the item's original scraped category label
                (menu_items.category_name). Replaces the former "Mapped Course"
                dropdown; canonical course mapping now lives on the menu, not on
                the item. Options are the distinct raw labels already used across
                this restaurant's menu, plus an Uncategorized escape hatch. */}
            <div>
              <label style={labelStyle} htmlFor="edit-category">
                Category
              </label>
              <RawCategorySelect
                id="edit-category"
                value={rawCategory}
                onChange={(v) => {
                  setRawCategory(v);
                  // For brand-new items, keep the canonical classifier in sync so
                  // the Beverages / Desserts sections still surface during creation.
                  if (isNewItem) setCategory(toCanonical(v) ?? '');
                }}
                data-testid="edit-category-select"
                items={allItems}
                ownerFoodCategories={ownerFoodCategories}
                currentValue={item.category}
                placeholder="— Select category —"
              />
            </div>
        <div>
          <label className={FIELD_LABEL_CLS} htmlFor="edit-item-type">Item type</label>
          {/* Fixed by the calling context (the Food Items tab that opened the
              editor, or the stored item_type) — the in-editor toggle was
              removed 2026-07-18, so this reads back rather than edits. */}
          <input
            id="edit-item-type"
            data-testid="edit-item-type"
            readOnly
            disabled
            value={category === 'Beverages' ? 'Beverage' : 'Food'}
            title="Set when the item is created"
            className={FIELD_INPUT_CLS}
          />
        </div>
      </div>
      <div className="border-y border-line-row">
        {visibilityRow}
        {/* Dish settings — spice picker visibility + required, and Build Your
            Own. Hidden for Desserts (no spice) and wine (neither applies). */}
        {!isWine && (
          <div className="border-t border-line-row divide-y divide-line-row" data-testid="edit-dish-settings">
            {category !== 'Desserts' && (
              <>
                <SwitchRow label="Show spice picker" hint="Guests choose a spice level when they add this dish.">
                  <InkSwitch
                    checked={spiceModifierEnabled}
                    label="Toggle Show spice picker"
                    testId="spice-modifier-toggle"
                    onChange={(next) => setSpiceModifierEnabled(next)}
                  />
                </SwitchRow>
                <SwitchRow label="Require a spice selection" hint="Guests must pick a level before adding to the order.">
                  <InkSwitch
                    checked={spiceModifierEnabled && spiceSelectionRequired}
                    disabled={!spiceModifierEnabled}
                    title={!spiceModifierEnabled ? 'Turn on the spice picker to require a selection.' : undefined}
                    label="Toggle Require a spice selection"
                    testId="spice-required-toggle"
                    onChange={(next) => { if (spiceModifierEnabled) setSpiceSelectionRequired(next); }}
                  />
                </SwitchRow>
              </>
            )}
            {(() => {
              // BYO (Build-Your-Own) classification — PDD 2026-05-26. Disabled
              // when the dish has zero groupings: the API hard-blocks
              // is_byo=true on items without customization options.
              const hasGroupings = (groupingsCount ?? 0) > 0;
              const toggleDisabled = !hasGroupings;
              return (
                <div className="py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-ink">Build Your Own</div>
                      <div className="text-xs text-ink-soft">Guests compose this dish from its modifier groups.</div>
                    </div>
                    <InkSwitch
                      checked={isByo}
                      disabled={toggleDisabled}
                      title={toggleDisabled ? 'Add a customization group so diners can build this dish.' : undefined}
                      label="Toggle Build Your Own"
                      testId="byo-toggle"
                      onChange={(next) => { if (!toggleDisabled) setIsByo(next); }}
                    />
                  </div>
                  {toggleDisabled && (
                    <div data-testid="byo-disabled-hint" className="text-xs text-ink-soft mt-1.5">
                      Add a customization group so diners can build this dish.
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Beverage details — owner-editable form for food_tags.beverage.
          Shows for Beverages-category items only. Persists as part of the
          food_tags payload on Save (normalizeBeverage in handleSave drops
          type-inapplicable fields before the PUT). */}
      {category === 'Beverages' && <SectionHeading>Beverage details</SectionHeading>}
                {/* Beverage Profile — owner-editable form for food_tags.beverage.
                    Shows for Beverages-category items only; takes the same
                    vertical slot Heat/Spice occupies for dishes. Persists as
                    part of the food_tags payload on Save. The bevDraft state
                    holds the in-progress form; normalizeBeverage in handleSave
                    drops type-inapplicable fields before the PUT. */}
                {!isAddon && category === 'Beverages' && (() => {
                  const updateBev = <K extends keyof BeverageTags>(field: K, value: BeverageTags[K]) => {
                    setBevDraft((prev) => ({ ...prev, [field]: value }));
                  };
                  const bevType = bevDraft.beverage_type ?? '';
                  // Defensive filter — strip nulls/empties/non-strings that
                  // may leak in from upstream enrichment writes so we don't
                  // render or persist garbage chips. Filter is applied at
                  // render so the next edit replaces with a clean array.
                  const flavorNotes = (Array.isArray(bevDraft.flavor_notes) ? bevDraft.flavor_notes : [])
                    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
                  const keyIngredients = (Array.isArray(bevDraft.key_ingredients) ? bevDraft.key_ingredients : [])
                    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
                  const isEmpty = Object.values(bevDraft).every((v) =>
                    v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0),
                  );

                  const pillStyle = (active: boolean): React.CSSProperties => ({
                    padding: '4px 12px',
                    borderRadius: 20,
                    border: '1px solid',
                    // Selected = brand orange, like every other selected
                    // chip in the dashboard. The ink is darker than
                    // --orange-text because this is body copy ON the tint.
                    borderColor: active ? 'var(--brand-s)' : 'var(--border)',
                    background: active ? 'var(--orange-bg)' : 'transparent',
                    color: active ? 'var(--editor-accent-ink, #9A3412)' : 'var(--text2)',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: active ? 600 : 400,
                    transition: 'all 0.1s',
                  });

                  const fieldLabel: React.CSSProperties = {
                    fontSize: 11,
                    fontWeight: 500,
                    color: 'var(--text2)',
                    display: 'block',
                    marginBottom: 4,
                  };

                  // Wine subfield options — comments in BeverageTags type
                  // codify the accepted values; defined locally because they
                  // don't have a shared constants entry yet.
                  // ASCII canonical values — the Select SUBMITS 'rose'; the
                  // label renders "Rosé". ('rosé' was UI-side drift from the
                  // backend vocab — fixed PLAN 2026-08-04 M5, which also
                  // added 'dessert'.)
                  const WINE_COLORS = ['red', 'white', 'rose', 'sparkling', 'dessert'];
                  const WINE_COLOR_LABELS: Record<string, string> = { rose: 'Rosé' };
                  // Legacy rows saved before the drift fix may still carry
                  // the accented value — normalize for display so the Select
                  // shows Rosé selected (and the next save persists 'rose').
                  const wineColorValue = bevDraft.wine_color === 'rosé' ? 'rose' : (bevDraft.wine_color ?? '');
                  const derivedOldWorld = deriveOldWorld(wineCountry);
                  const effectiveOldWorld = derivedOldWorld ?? wineOldWorld;
                  const showTanninScale = wineColorValue === 'red' || wineColorValue === 'dessert';
                  const tasteScales = bevDraft.taste_scales ?? {};
                  const dishPairings = Array.isArray(bevDraft.dish_pairings) ? bevDraft.dish_pairings : [];
                  const tastingNote = bevDraft.tasting_note ?? '';
                  const shortStory = bevDraft.short_story ?? '';
                  const longStory = bevDraft.long_story ?? '';
                  const storySource = bevDraft.story_source ?? null;
                  const storySourceLabel = storySource === 'menu_source'
                    ? 'From menu'
                    : storySource === 'llm_knowledge'
                    ? 'Auto-filled'
                    : storySource === 'web_lookup'
                    ? 'From web lookup'
                    : null;
                  const setTasteScale = (axis: 'body' | 'sweetness' | 'tannin' | 'acidity' | 'alcohol', v: number) => {
                    setBevDraft((prev) => ({
                      ...prev,
                      taste_scales: { ...(prev.taste_scales ?? {}), [axis]: v },
                    }));
                  };
                  const toggleDishPairing = (value: string) => {
                    setBevDraft((prev) => {
                      const cur = Array.isArray(prev.dish_pairings) ? prev.dish_pairings : [];
                      return {
                        ...prev,
                        dish_pairings: cur.includes(value)
                          ? cur.filter((p) => p !== value)
                          : [...cur, value],
                      };
                    });
                  };
                  const WINE_BODIES = ['light', 'medium', 'full'];
                  const WINE_STYLES = ['dry', 'off-dry', 'medium-sweet', 'sweet'];
                  const SWEETNESS_LEVELS = ['dry', 'off-dry', 'medium-sweet', 'sweet', 'dessert'];

                  return (
                    <div data-testid="edit-modal-beverage-profile">
                      <div
                        style={{
                          padding: 12,
                          borderRadius: 8,
                          background: 'var(--surface-sunk)',
                          border: '1px solid var(--line)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 12,
                        }}
                      >
                        {isEmpty && (
                          <div
                            data-testid="edit-modal-beverage-profile-empty"
                            style={{
                              padding: '8px 10px',
                              borderRadius: 6,
                              background: 'var(--surface)',
                              border: '1px dashed var(--line-input)',
                              color: 'var(--text2)',
                              fontSize: 11,
                              lineHeight: 1.5,
                            }}
                          >
                            No beverage profile yet. Fill in the fields below, or run <strong>Beverage Enrichment</strong> from the Menu Intelligence page to auto-populate from the LLM.
                          </div>
                        )}

                        {/* Drink Type + Alcoholic */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                          <div>
                            <label style={fieldLabel}>Drink type</label>
                            <Select
                              fullWidth
                              data-testid="beverage-input-type"
                              value={bevType}
                              onChange={(e) => updateBev('beverage_type', (e.target.value || undefined) as BeverageTags['beverage_type'])}
                              placeholder="Select type"
                              options={[
                                { value: '', label: 'Select type' },
                                ...BEVERAGE_TYPES.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) })),
                              ]}
                            />
                          </div>
                          <div>
                            <label style={fieldLabel}>Alcoholic</label>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {[{ label: 'Yes', value: true }, { label: 'No', value: false }].map((opt) => {
                                const active = bevDraft.alcoholic === opt.value;
                                return (
                                  <button
                                    key={opt.label}
                                    type="button"
                                    data-testid={`beverage-input-alcoholic-${opt.label.toLowerCase()}`}
                                    aria-pressed={active}
                                    onClick={() => updateBev('alcoholic', active ? undefined : opt.value)}
                                    style={{
                                      flex: 1,
                                      padding: '7px 0',
                                      borderRadius: 'var(--r-xs)',
                                      border: '1px solid',
                                      borderColor: active ? 'var(--brand-s)' : 'var(--border)',
                                      background: active ? 'var(--brand-s)' : 'var(--surface)',
                                      color: active ? 'var(--on-ink)' : 'var(--text2)',
                                      fontSize: 13,
                                      fontWeight: active ? 600 : 400,
                                      cursor: 'pointer',
                                      transition: 'all 0.1s',
                                    }}
                                  >
                                    {opt.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>

                        {/* Conditional: cocktail */}
                        {bevType === 'cocktail' && (
                          <div>
                            <label style={fieldLabel}>Base spirit</label>
                            <Select
                              fullWidth
                              data-testid="beverage-input-base-spirit"
                              value={bevDraft.base_spirit ?? ''}
                              onChange={(e) => updateBev('base_spirit', e.target.value || null)}
                              placeholder="Select spirit"
                              options={[
                                { value: '', label: 'Select spirit' },
                                ...BASE_SPIRITS.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) })),
                              ]}
                            />
                          </div>
                        )}

                        {/* Conditional: wine */}
                        {bevType === 'wine' && (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <div>
                              <label style={fieldLabel}>Wine variety</label>
                              <Select
                                fullWidth
                                data-testid="beverage-input-wine-variety"
                                value={bevDraft.wine_variety ?? ''}
                                onChange={(e) => updateBev('wine_variety', e.target.value || null)}
                                placeholder="Select variety"
                                options={[
                                  { value: '', label: 'Select variety' },
                                  ...WINE_VARIETIES.map((v) => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) })),
                                ]}
                              />
                            </div>
                            <div>
                              <label style={fieldLabel}>Wine color</label>
                              <Select
                                fullWidth
                                data-testid="beverage-input-wine-color"
                                value={wineColorValue}
                                onChange={(e) => updateBev('wine_color', e.target.value || null)}
                                placeholder="Select color"
                                options={[
                                  { value: '', label: 'Select color' },
                                  ...WINE_COLORS.map((c) => ({
                                    value: c,
                                    label: WINE_COLOR_LABELS[c] ?? c.charAt(0).toUpperCase() + c.slice(1),
                                  })),
                                ]}
                              />
                            </div>
                            <div>
                              <label style={fieldLabel}>Wine body</label>
                              <Select
                                fullWidth
                                data-testid="beverage-input-wine-body"
                                value={bevDraft.wine_body ?? ''}
                                onChange={(e) => updateBev('wine_body', e.target.value || null)}
                                placeholder="Select body"
                                options={[
                                  { value: '', label: 'Select body' },
                                  ...WINE_BODIES.map((b) => ({ value: b, label: b.charAt(0).toUpperCase() + b.slice(1) })),
                                ]}
                              />
                            </div>
                            <div>
                              <label style={fieldLabel}>Wine style</label>
                              <Select
                                fullWidth
                                data-testid="beverage-input-wine-style"
                                value={bevDraft.wine_style ?? ''}
                                onChange={(e) => updateBev('wine_style', e.target.value || null)}
                                placeholder="Select style"
                                options={[
                                  { value: '', label: 'Select style' },
                                  ...WINE_STYLES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) })),
                                ]}
                              />
                            </div>
                          </div>
                        )}

                        {/* Wine identity / provenance (PLAN 2026-08-04 M5) —
                            top-level menu_items columns (varietal, producer,
                            region, vintage, country) + the derived Old/New
                            World chip. PATCHed as top-level fields on save,
                            never inside food_tags.beverage. */}
                        {bevType === 'wine' && (
                          <div data-testid="wine-identity-section">
                            <label style={fieldLabel}>Wine identity</label>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                              <div>
                                <label style={fieldLabel}>Varietal</label>
                                <input
                                  type="text"
                                  data-testid="beverage-input-varietal"
                                  value={wineVarietal}
                                  onChange={(e) => setWineVarietal(e.target.value)}
                                  placeholder="e.g. Nebbiolo"
                                  style={{ ...inputStyle, fontSize: 13 }}
                                />
                              </div>
                              <div>
                                <label style={fieldLabel}>Producer</label>
                                <input
                                  type="text"
                                  data-testid="beverage-input-producer"
                                  value={wineProducer}
                                  onChange={(e) => setWineProducer(e.target.value)}
                                  placeholder="e.g. Gaja"
                                  style={{ ...inputStyle, fontSize: 13 }}
                                />
                              </div>
                              <div>
                                <label style={fieldLabel}>Region</label>
                                <input
                                  type="text"
                                  data-testid="beverage-input-region"
                                  value={wineRegion}
                                  onChange={(e) => setWineRegion(e.target.value)}
                                  placeholder="e.g. Barolo DOCG"
                                  style={{ ...inputStyle, fontSize: 13 }}
                                />
                              </div>
                              <div>
                                <label style={fieldLabel}>Vintage</label>
                                <input
                                  type="number"
                                  data-testid="beverage-input-vintage"
                                  value={wineVintage}
                                  onChange={(e) => setWineVintage(e.target.value)}
                                  placeholder="e.g. 2019"
                                  style={{ ...inputStyle, fontSize: 13 }}
                                />
                              </div>
                              <div>
                                <label style={fieldLabel}>Country</label>
                                <input
                                  type="text"
                                  data-testid="beverage-input-country"
                                  value={wineCountry}
                                  onChange={(e) => setWineCountry(e.target.value)}
                                  placeholder="e.g. Italy"
                                  style={{ ...inputStyle, fontSize: 13 }}
                                />
                              </div>
                              <div>
                                <label style={fieldLabel}>Old / New World</label>
                                {derivedOldWorld !== null ? (
                                  /* Known country → read-only derived chip; the
                                     server re-derives from wine_country and an
                                     explicit contradicting value would 400 with
                                     code=inconsistent_pair, so no toggle here. */
                                  <span
                                    data-testid="beverage-old-world-chip"
                                    data-derived="true"
                                    style={{ ...pillStyle(true), display: 'inline-block', cursor: 'default' }}
                                  >
                                    {derivedOldWorld ? 'Old World' : 'New World'}
                                  </span>
                                ) : (
                                  /* Unknown/absent country → owner may set the
                                     world explicitly (the only case the modal
                                     sends wine_old_world). */
                                  <div
                                    data-testid="beverage-old-world-chip"
                                    data-derived="false"
                                    style={{ display: 'flex', gap: 6 }}
                                  >
                                    {[{ label: 'Old World', value: true }, { label: 'New World', value: false }].map((opt) => {
                                      const active = effectiveOldWorld === opt.value;
                                      return (
                                        <button
                                          key={opt.label}
                                          type="button"
                                          data-testid={`beverage-old-world-${opt.value ? 'old' : 'new'}`}
                                          aria-pressed={active}
                                          onClick={() => setWineOldWorld(active ? null : opt.value)}
                                          style={pillStyle(active)}
                                        >
                                          {opt.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Wine taste scales (M5) — 0-100 sliders on the WSET
                            absolute rubric, persisted to
                            food_tags.beverage.taste_scales via the server-side
                            key-additive merge. Tannin renders only for
                            red/dessert colors. */}
                        {bevType === 'wine' && (
                          <div data-testid="wine-taste-scales-section">
                            <label style={fieldLabel}>Taste profile (0–100)</label>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {WINE_TASTE_SCALE_AXES
                                .filter(({ key }) => key !== 'tannin' || showTanninScale)
                                .map(({ key, label }) => {
                                  const val = tasteScales[key];
                                  return (
                                    <div key={key} style={{ display: 'grid', gridTemplateColumns: '72px 1fr 34px', gap: 8, alignItems: 'center' }}>
                                      <span style={{ fontSize: 11, color: 'var(--text2)' }}>{label}</span>
                                      <input
                                        type="range"
                                        min={0}
                                        max={100}
                                        step={1}
                                        data-testid={`beverage-scale-${key}`}
                                        aria-label={`${label} scale`}
                                        value={typeof val === 'number' ? val : 50}
                                        onChange={(e) => setTasteScale(key, Number(e.target.value))}
                                        style={{ width: '100%', accentColor: 'var(--brand-s)' }}
                                      />
                                      <span
                                        data-testid={`beverage-scale-${key}-value`}
                                        style={{ fontSize: 11, color: 'var(--text2)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                                      >
                                        {typeof val === 'number' ? Math.round(val) : '—'}
                                      </span>
                                    </div>
                                  );
                                })}
                            </div>
                          </div>
                        )}

                        {/* Wine dish pairings (M5) — closed 8-value vocab,
                            chip multi-select. */}
                        {bevType === 'wine' && (
                          <div data-testid="wine-dish-pairings-section">
                            <label style={fieldLabel}>Pairs well with</label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {WINE_DISH_PAIRING_OPTIONS.map(({ value, label }) => {
                                const active = dishPairings.includes(value);
                                return (
                                  <button
                                    key={value}
                                    type="button"
                                    data-testid={`beverage-dish-pairing-${value}`}
                                    aria-pressed={active}
                                    onClick={() => toggleDishPairing(value)}
                                    style={pillStyle(active)}
                                  >
                                    {label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Wine tasting note (M5) — ≤160 chars, server-enforced. */}
                        {bevType === 'wine' && (
                          <div data-testid="wine-tasting-note-section">
                            <label style={fieldLabel}>Tasting note</label>
                            <textarea
                              data-testid="beverage-input-tasting-note"
                              value={tastingNote}
                              maxLength={160}
                              rows={2}
                              placeholder="One-sentence sommelier note diners see on the wine list…"
                              onChange={(e) => updateBev('tasting_note', e.target.value)}
                              style={{ ...inputStyle, fontSize: 13, resize: 'vertical', fontFamily: 'inherit' }}
                            />
                            <div
                              data-testid="beverage-tasting-note-counter"
                              style={{ fontSize: 10, color: 'var(--text3)', textAlign: 'right', marginTop: 2 }}
                            >
                              {tastingNote.length}/160
                            </div>
                          </div>
                        )}

                        {/* Wine producer/winery story — short (≤300 chars) and
                            long (≤3000 chars) forms, server-enforced. Populated
                            from the menu itself when printed, or filled in
                            later by the background wine-enrichment pass;
                            storySourceLabel surfaces which (read-only — the
                            owner's own edit always wins on next save, but we
                            never guess a new provenance value client-side). */}
                        {bevType === 'wine' && (
                          <div data-testid="wine-short-story-section">
                            <label style={fieldLabel}>
                              Short story
                              {storySourceLabel && (
                                <span
                                  data-testid="wine-story-source-badge"
                                  style={{
                                    marginLeft: 6, fontSize: 10, fontWeight: 400,
                                    color: 'var(--text3)', textTransform: 'uppercase',
                                  }}
                                >
                                  {storySourceLabel}
                                </span>
                              )}
                            </label>
                            <textarea
                              data-testid="beverage-input-short-story"
                              value={shortStory}
                              maxLength={300}
                              rows={2}
                              placeholder="A one-to-two-sentence producer or winery backstory…"
                              onChange={(e) => updateBev('short_story', e.target.value)}
                              style={{ ...inputStyle, fontSize: 13, resize: 'vertical', fontFamily: 'inherit' }}
                            />
                            <div
                              data-testid="beverage-short-story-counter"
                              style={{ fontSize: 10, color: 'var(--text3)', textAlign: 'right', marginTop: 2 }}
                            >
                              {shortStory.length}/300
                            </div>
                          </div>
                        )}

                        {bevType === 'wine' && (
                          <div data-testid="wine-long-story-section">
                            <label style={fieldLabel}>Long story</label>
                            <textarea
                              data-testid="beverage-input-long-story"
                              value={longStory}
                              maxLength={3000}
                              rows={6}
                              placeholder="A longer producer or winery backstory — history, terroir, winemaking philosophy…"
                              onChange={(e) => updateBev('long_story', e.target.value)}
                              style={{ ...inputStyle, fontSize: 13, resize: 'vertical', fontFamily: 'inherit' }}
                            />
                            <div
                              data-testid="beverage-long-story-counter"
                              style={{ fontSize: 10, color: 'var(--text3)', textAlign: 'right', marginTop: 2 }}
                            >
                              {longStory.length}/3000
                            </div>
                          </div>
                        )}

                        {/* Wine serving sizes (PDD 2026-06-15) — sell by the
                            glass AND/OR the bottle. Each row: label, optional
                            volume (ml), price. One default (pre-selected on the
                            patron composition page). Empty ⇒ single-priced wine. */}
                        {bevType === 'wine' && (
                          <div data-testid="serving-sizes-section" style={{ marginTop: 4 }}>
                            <label style={fieldLabel}>Serving sizes</label>
                            <p style={{ margin: '0 0 8px', fontSize: 11, color: 'var(--text2)' }}>
                              Offer this wine by the glass and/or bottle. Leave empty for a single price.
                            </p>
                            {servingRows.map((row, idx) => (
                              <div
                                key={row.id}
                                data-testid={`serving-option-row-${idx}`}
                                style={{ display: 'grid', gridTemplateColumns: '1fr 70px 80px auto auto', gap: 6, alignItems: 'center', marginBottom: 6 }}
                              >
                                <input
                                  data-testid={`serving-option-label-${idx}`}
                                  value={row.label}
                                  placeholder="Glass / Bottle"
                                  onChange={(e) => updateServingRow(idx, { label: e.target.value })}
                                  style={{ padding: '7px 8px', borderRadius: 'var(--r-xs)', border: '1px solid var(--border)', fontSize: 13 }}
                                />
                                <input
                                  data-testid={`serving-option-volume-${idx}`}
                                  value={row.volume_ml}
                                  inputMode="numeric"
                                  placeholder="ml"
                                  onChange={(e) => updateServingRow(idx, { volume_ml: e.target.value.replace(/[^0-9]/g, '') })}
                                  style={{ padding: '7px 8px', borderRadius: 'var(--r-xs)', border: '1px solid var(--border)', fontSize: 13 }}
                                />
                                <input
                                  data-testid={`serving-option-price-${idx}`}
                                  value={row.price}
                                  inputMode="decimal"
                                  placeholder={currencySymbol}
                                  onChange={(e) => updateServingRow(idx, { price: e.target.value.replace(/[^0-9.]/g, '') })}
                                  style={{ padding: '7px 8px', borderRadius: 'var(--r-xs)', border: '1px solid var(--border)', fontSize: 13 }}
                                />
                                <button
                                  type="button"
                                  data-testid={`serving-option-default-${idx}`}
                                  aria-pressed={row.is_default}
                                  title="Default serving"
                                  onClick={() => setServingDefault(idx)}
                                  style={{
                                    padding: '6px 9px', borderRadius: 'var(--r-xs)', border: '1px solid',
                                    borderColor: row.is_default ? 'var(--brand-s)' : 'var(--border)',
                                    background: row.is_default ? 'var(--brand-s)' : 'var(--surface)',
                                    color: row.is_default ? 'var(--on-ink)' : 'var(--text2)',
                                    fontSize: 12, fontWeight: row.is_default ? 600 : 400, cursor: 'pointer', whiteSpace: 'nowrap',
                                  }}
                                >
                                  {row.is_default ? '★ Default' : 'Default'}
                                </button>
                                <button
                                  type="button"
                                  data-testid={`serving-option-remove-${idx}`}
                                  aria-label="Remove serving size"
                                  onClick={() => removeServingRow(idx)}
                                  style={{ padding: '6px 9px', borderRadius: 'var(--r-xs)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text2)', fontSize: 13, cursor: 'pointer' }}
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              data-testid="add-serving-option-btn"
                              onClick={addServingRow}
                              style={{ marginTop: 2, padding: '7px 12px', borderRadius: 'var(--r-xs)', border: '1px dashed var(--border)', background: 'var(--surface)', color: 'var(--text2)', fontSize: 12, cursor: 'pointer' }}
                            >
                              + Add serving size
                            </button>
                          </div>
                        )}

                        {/* Conditional: beer */}
                        {bevType === 'beer' && (
                          <div>
                            <label style={fieldLabel}>Beer style</label>
                            <Select
                              fullWidth
                              data-testid="beverage-input-beer-style"
                              value={bevDraft.beer_style ?? ''}
                              onChange={(e) => updateBev('beer_style', e.target.value || null)}
                              placeholder="Select style"
                              options={[
                                { value: '', label: 'Select style' },
                                ...BEER_STYLES.map((s) => ({ value: s, label: s })),
                              ]}
                            />
                          </div>
                        )}

                        {/* Sweetness — wine + cocktail */}
                        {(bevType === 'wine' || bevType === 'cocktail') && (
                          <div>
                            <label style={fieldLabel}>Sweetness</label>
                            <Select
                              fullWidth
                              data-testid="beverage-input-sweetness"
                              value={bevDraft.sweetness ?? ''}
                              onChange={(e) => updateBev('sweetness', e.target.value || null)}
                              placeholder="Select sweetness"
                              options={[
                                { value: '', label: 'Select sweetness' },
                                ...SWEETNESS_LEVELS.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) })),
                              ]}
                            />
                          </div>
                        )}

                        {/* Served + Strength */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                          <div>
                            <label style={fieldLabel}>Served</label>
                            <Select
                              fullWidth
                              data-testid="beverage-input-served"
                              value={bevDraft.served ?? ''}
                              onChange={(e) => updateBev('served', e.target.value || null)}
                              placeholder="Select"
                              options={[
                                { value: '', label: 'Select' },
                                ...SERVING_STYLES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) })),
                              ]}
                            />
                          </div>
                          <div>
                            <label style={fieldLabel}>Strength</label>
                            <Select
                              fullWidth
                              data-testid="beverage-input-strength"
                              value={bevDraft.strength ?? ''}
                              onChange={(e) => updateBev('strength', (e.target.value || undefined) as BeverageTags['strength'])}
                              placeholder="Select"
                              options={[
                                { value: '', label: 'Select' },
                                ...DRINK_STRENGTHS.map((s) => ({ value: s, label: s === 'none' ? 'Non-alcoholic' : s.charAt(0).toUpperCase() + s.slice(1) })),
                              ]}
                            />
                          </div>
                        </div>

                        {/* Flavor notes — multi-select pill grid */}
                        <div>
                          <label style={fieldLabel}>Flavor notes</label>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }} data-testid="beverage-input-flavor-notes">
                            {FLAVOR_NOTES.map((note) => {
                              const active = flavorNotes.includes(note);
                              return (
                                <button
                                  key={note}
                                  type="button"
                                  aria-pressed={active}
                                  onClick={() => {
                                    const next = active
                                      ? flavorNotes.filter((n) => n !== note)
                                      : [...flavorNotes, note];
                                    updateBev('flavor_notes', next);
                                  }}
                                  style={pillStyle(active)}
                                >
                                  {note}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Key ingredients — chip input. Add via Enter or
                            comma; remove via ✕ on chip. */}
                        <div>
                          <label style={fieldLabel}>Key ingredients</label>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }} data-testid="beverage-input-key-ingredients">
                            {keyIngredients.map((ing) => (
                              <span
                                key={ing}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  padding: '3px 4px 3px 10px',
                                  borderRadius: 12,
                                  background: 'var(--warn-bg)',
                                  color: 'var(--warn)',
                                  fontSize: 11,
                                  fontWeight: 500,
                                }}
                              >
                                {ing}
                                <button
                                  type="button"
                                  aria-label={`Remove ${ing}`}
                                  onClick={() => updateBev('key_ingredients', keyIngredients.filter((k) => k !== ing))}
                                  style={{
                                    width: 16,
                                    height: 16,
                                    border: 'none',
                                    borderRadius: '50%',
                                    background: 'transparent',
                                    color: 'var(--warn)',
                                    cursor: 'pointer',
                                    fontSize: 14,
                                    lineHeight: 1,
                                    padding: 0,
                                  }}
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                          <input
                            type="text"
                            placeholder="Add an ingredient and press Enter"
                            data-testid="beverage-input-key-ingredients-add"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ',') {
                                e.preventDefault();
                                const val = (e.currentTarget.value || '').trim();
                                if (val && !keyIngredients.includes(val)) {
                                  updateBev('key_ingredients', [...keyIngredients, val]);
                                }
                                e.currentTarget.value = '';
                              }
                            }}
                            onBlur={(e) => {
                              const val = (e.currentTarget.value || '').trim();
                              if (val && !keyIngredients.includes(val)) {
                                updateBev('key_ingredients', [...keyIngredients, val]);
                                e.currentTarget.value = '';
                              }
                            }}
                            style={inputStyle}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })()}

      <Accordion
        title="Flavor, ingredients & other details"
        summary={tasteSummary || undefined}
        open={flavorOpen}
        onToggle={() => setFlavorOpen((v) => !v)}
        testId="edit-flavor-accordion"
      >
        <span className="text-ink-soft">
          {tasteSummary ? `Taste profile: ${tasteSummary}. ` : 'No flavor details yet. '}
          Ingredients, preparation and the other specialist fields are in{' '}
        </span>
        <button
          type="button"
          data-testid="edit-goto-advanced"
          onClick={() => setActiveTab('advanced')}
          className="bg-transparent border-0 p-0 font-semibold text-ink cursor-pointer"
        >
          Advanced details
        </button>
        .
      </Accordion>
    </section>
  );

  // ── Dietary & allergens section ───────────────────────────────────────────
  const dietarySection = (
    <section data-testid="dietary-info-card" className="flex flex-col gap-5">
      {dietaryTagService && restaurantId && (
        <>
          <DietaryMultiSelect
            label="Dietary labels"
            options={dietaryOptions}
            labels={dietaryLabelsMerged}
            type="dietary"
            selectedSet={dietarySet}
            onToggle={(name) => isNewItem
              ? setDietarySet((prev) => {
                  const next = new Set(prev);
                  if (next.has(name)) next.delete(name); else next.add(name);
                  return next;
                })
              : void handleDietaryToggle(name, 'dietary')}
            reviewed={isNewItem ? true : dietaryReviewed}
            onToggleNa={() => isNewItem
              ? setDietarySet(new Set())
              : void handleClickNa('dietary')}
            onAcceptAi={isNewItem ? undefined : () => void handleAcceptAi('dietary')}
          />
          <DietaryMultiSelect
            label="Contains allergens"
            options={allergenOptions}
            labels={allergenLabelsMerged}
            type="allergen"
            selectedSet={allergenSet}
            onToggle={(name) => isNewItem
              ? setAllergenSet((prev) => {
                  const next = new Set(prev);
                  if (next.has(name)) next.delete(name); else next.add(name);
                  return next;
                })
              : void handleDietaryToggle(name, 'allergen')}
            reviewed={isNewItem ? true : allergensReviewed}
            onToggleNa={() => isNewItem
              ? setAllergenSet(new Set())
              : void handleClickNa('allergens')}
            onAcceptAi={isNewItem ? undefined : () => void handleAcceptAi('allergens')}
          />
        </>
      )}

      {/* Spice level — dish-only; hidden for Beverages / Desserts / add-ons.
          N/A = no spice set. The per-restaurant scale can carry up to five
          labels, so it stays a native select (the specs drive selectOption). */}
      {!isAddon && category !== 'Beverages' && category !== 'Desserts' && (
        <div>
          <SectionHeading>Spice level</SectionHeading>
          <select
            id="heat-spice-select"
            data-testid="heat-spice-select"
            aria-label="Spice level"
            value={heatSpice ?? ''}
            onChange={(e) => setHeatSpice(e.target.value === '' ? null : e.target.value)}
            className="h-10 min-w-[200px] rounded-ctl border border-line-input bg-surface px-2.5 text-sm text-ink cursor-pointer"
          >
            <option value="">Not applicable</option>
            {activeHeatLabels.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
      )}

                {/* Sweetness — predefined pill selector (shown only for Desserts; not for add-ons).
                    Gated behind SWEETNESS_VISIBLE per STR-480 (2026-05-09 leadership decision).
                    Flip to true in `packages/shared/src/constants/feature-flags.ts` to restore. */}
                {!isAddon && category === 'Desserts' && SWEETNESS_VISIBLE && <div>
                  <label style={labelStyle}>Sweetness</label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {activeSweetnessLabels.map((option) => (
                      <button
                        key={option}
                        type="button"
                        data-testid={`sweetness-pill-${option.toLowerCase().replace(/\s+/g, '-')}`}
                        aria-pressed={sweetnessLabel === option}
                        onClick={() => setSweetnessLabel(sweetnessLabel === option ? null : option)}
                        style={{
                          padding: '4px 14px',
                          borderRadius: 20,
                          border: '1px solid',
                          borderColor: sweetnessLabel === option ? 'var(--brand-s)' : 'var(--border)',
                          background: sweetnessLabel === option ? 'var(--orange-bg)' : 'transparent',
                          color: sweetnessLabel === option ? 'var(--editor-accent-ink, #9A3412)' : 'var(--text2)',
                          cursor: 'pointer',
                          fontSize: 12,
                          fontWeight: sweetnessLabel === option ? 600 : 400,
                          transition: 'all 0.1s',
                        }}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>}

      <p className="text-[13px] text-ink-soft m-0">
        Guests filter menus by these labels, so they apply wherever the item appears.
      </p>
    </section>
  );

  // ── Advanced details section ──────────────────────────────────────────────
  const advancedSection = (
    <section data-testid="edit-advanced-section" className="flex flex-col gap-4">
                {/* AI enrichment in-progress banner — Groupings Dietary/
                    Allergen Filter PDD (2026-05-18, Step 11 reframed).
                    When a new item is saved, owner-webapp fires the
                    /recommendation/menu-items/{id}/enrich call in the
                    background and flags enrichment_status='enriching' on
                    the local item. This banner stays visible until the
                    async call completes (status flips to 'enriched' or
                    'failed'). Owners cannot manually trigger enrichment;
                    once tags arrive they can edit them by hand. */}
                {item.enrichment_status === 'enriching' && (
                  <div
                    data-testid="edit-modal-enrichment-in-progress"
                    className="flex items-center gap-2 rounded-ctl bg-warn-bg px-3 py-2.5 text-[13px] text-warn"
                  >
                    <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-warn animate-pulse" />
                    <span>Enrichment in progress — AI is analysing this item to suggest tags. You'll be able to review and edit them in a few seconds.</span>
                  </div>
                )}
                {item.enrichment_status === 'failed' && (
                  <div
                    data-testid="edit-modal-enrichment-failed"
                    className="rounded-ctl bg-bad-bg px-3 py-2.5 text-[13px] text-bad"
                  >
                    Enrichment didn't complete. You can still edit tags manually below.
                  </div>
                )}
                {/* One-shot notice for admin Enrich click outcomes (skipped /
                    error). Cleared on next click. Distinct from the
                    in-progress banner above which is driven by the item's
                    enrichment_status field from the parent state. */}
                {enrichNotice && (
                  <div
                    data-testid="edit-modal-enrich-notice"
                    className="rounded-ctl bg-warn-bg px-3 py-2 text-xs text-warn"
                  >
                    {enrichNotice}
                  </div>
                )}
                {/* POS product link (PDD 2026-08-31). Rendered only when the
                    host supplies onOpenPosLink — the owner dashboard. Waiter
                    and admin mount this same modal and pass nothing.
                    
                    Placed with the notices above rather than in a tab: on a
                    POS restaurant an unlinked dish is NOT ORDERABLE AT ALL, so
                    it belongs where the owner cannot miss it while editing the
                    dish they think they are publishing. */}
                {onOpenPosLink && (() => {
                  const linked = posLinkStatus === 'confirmed';
                  const suggested = posLinkStatus === 'suggested';
                  // Three states, not two — a suggestion is the importer's
                  // unapproved guess and the dish is STILL unsellable.
                  // Collapsing it into "linked" hides the cheapest fix there is.
                  const label = linked ? 'Linked' : suggested ? 'Suggested' : 'Not linked';
                  // Kar status tones: ok when linked, warn while it still blocks ordering.
                  const toneCls = linked ? 'bg-ok-bg text-ok' : 'bg-warn-bg text-warn';
                  return (
                    <div
                      data-testid="edit-modal-pos-link-row"
                      className="flex items-center gap-2.5 rounded-ctl border border-line px-3 py-2"
                    >
                      <span className="text-[13px] font-semibold text-ink">
                        POS product
                      </span>
                      <span
                        data-testid="edit-modal-pos-link-status"
                        data-pos-link={posLinkStatus ?? 'none'}
                        className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${toneCls}`}
                      >
                        {label}
                      </span>
                      {/* WHICH product. Without it "Linked" is unfalsifiable —
                          a dish pointed at the wrong Clover item renders
                          identically to a correct one, and the owner can only
                          find out by opening the picker. Shown for a
                          SUGGESTION too: that is the name they are being asked
                          to accept or reject, so hiding it makes the decision
                          impossible to take from here.

                          The name can be absent while the link exists (the
                          provider id left the staged catalogue since the last
                          import). That is worth saying out loud rather than
                          falling back to the bare badge, because a link to a
                          product Clover no longer has still blocks the gate. */}
                      {(linked || suggested) && (
                        <span
                          data-testid="edit-modal-pos-link-name"
                          title={posLinkName ?? undefined}
                          className="min-w-0 truncate text-xs text-ink-soft"
                        >
                          {posLinkName
                            ? posLinkName
                            : 'product no longer in the POS catalogue'}
                          {posLinkName && typeof posLinkPrice === 'number' && (
                            // Price is what an owner actually reconciles
                            // against — it is the till's number, and the reason
                            // to read this line at all.
                            <span
                              data-testid="edit-modal-pos-link-price"
                              className="ml-1.5 text-ink-faint"
                            >
                              {currencySymbol}{posLinkPrice.toFixed(2)}
                            </span>
                          )}
                        </span>
                      )}
                      {linked && posSellable === false && (
                        // Confirmed but still blocked: saying "Linked" alone
                        // would tell an owner the dish is live when a diner
                        // cannot order it.
                        <span className="text-[11px] text-warn">
                          not yet sellable
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={onOpenPosLink}
                        data-testid="edit-modal-pos-link-button"
                        className="ml-auto h-8 rounded-ctl border border-line bg-surface px-3 text-xs font-semibold text-ink cursor-pointer hover:bg-surface2"
                      >
                        {linked || suggested ? 'Change' : 'Link'}
                      </button>
                    </div>
                  );
                })()}
      <div
        data-testid="food-tags-card-grid"
        className="grid gap-3.5"
        style={{ gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))' }}
      >
        {TAG_FIELDS.map(({ key, label, placeholder, full }) => (
          <div
            key={key}
            className="border border-line rounded-ctl p-3.5"
            style={{ gridColumn: full && !isMobile ? '1 / -1' : 'auto' }}
          >
            <TagInput
              fieldKey={key}
              label={label}
              values={tags[key] ?? []}
              placeholder={placeholder}
              onChange={(vals) => setTags((prev) => ({ ...prev, [key]: vals }))}
            />
          </div>
        ))}
      </div>
    </section>
  );

  // ── Footer ────────────────────────────────────────────────────────────────
  const canShowMoreActions = !isNewItem && !cloneMode && !!item.id;
  // Phone: the primary action spans its own last row so it never wraps
  // behind the floating Sage button at the bottom-left.
  const primaryFooterCls = isMobile ? `${PRIMARY_BTN_CLS} w-full order-last` : PRIMARY_BTN_CLS;
  const dangerFooterCls = `h-10 px-[18px] rounded-ctl border-0 bg-bad text-on-ink text-sm font-semibold cursor-pointer disabled:opacity-60${isMobile ? ' w-full order-last' : ''}`;
  const footer = isPricingSection ? (
    <div className="px-6 pt-3 pb-3.5 border-t border-line shrink-0" data-testid="edit-pricing-footer">
      {pricingMenu ? (
        <>
          <div className="mb-2.5 text-sm">
            <strong>Saving changes {pricingMenu.menu_name} only.</strong>{' '}
            <span className="text-ink-soft">Shared item details and other menus stay unchanged.</span>
            {pricingSavedAt != null && (
              <span className="text-ok font-semibold ml-2" data-testid="menu-pricing-saved-note">Saved to {pricingMenu.menu_name}.</span>
            )}
          </div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              type="button"
              data-testid={`placements-tab-remove-${pricingMenu.menu_id}`}
              aria-label={`Remove from ${pricingMenu.menu_name}`}
              disabled={placementsSaving.has(pricingMenu.menu_id)}
              onClick={() => void removePlacement(pricingMenu.menu_id)}
              className="bg-transparent border-0 p-0 font-semibold text-bad cursor-pointer disabled:opacity-60"
            >
              Remove from {pricingMenu.menu_name}
            </button>
            <span className="flex-1" />
            <button type="button" onClick={onClose} disabled={savingInFlight} data-testid="edit-cancel-btn" className={SECONDARY_BTN_CLS}>Cancel</button>
            <button
              type="button"
              data-testid="menu-pricing-save-btn"
              onClick={() => { pricingFlushRef.current?.(); setPricingSavedAt(Date.now()); }}
              className={primaryFooterCls}
            >
              Save {pricingMenu.menu_name} settings
            </button>
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] text-ink-soft">Add this item to a menu from the Menu builder to set a price.</span>
          <span className="flex-1" />
          <button type="button" onClick={onClose} disabled={savingInFlight} data-testid="edit-cancel-btn" className={SECONDARY_BTN_CLS}>Cancel</button>
        </div>
      )}
    </div>
  ) : (
    <div className="px-6 py-3.5 border-t border-line flex items-center gap-2.5 flex-wrap shrink-0" data-testid="edit-footer">
      {v5 && canShowMoreActions && !deleteConfirming && (
        <>
          {onCloneRequest && (
            <button
              type="button"
              data-testid="edit-clone-btn"
              disabled={saving || cloneSaving}
              onClick={() => onCloneRequest(item)}
              className="inline-flex h-10 items-center gap-[7px] rounded-[8px] border border-line bg-surface px-3.5 text-sm text-ink cursor-pointer hover:border-ink disabled:opacity-60"
            >
              <Copy size={15} aria-hidden="true" />Clone item
            </button>
          )}
          <button
            type="button"
            data-testid="delete-item-btn"
            disabled={saving || cloneSaving}
            onClick={() => setDeleteConfirming(true)}
            className="inline-flex h-10 items-center gap-[7px] rounded-[8px] border border-line bg-surface px-3.5 text-sm text-[var(--mw-accent,var(--bad))] cursor-pointer hover:bg-[var(--mw-accent-tint,var(--bad-bg))] disabled:opacity-60"
          >
            <Trash2 size={15} aria-hidden="true" />Delete item
          </button>
        </>
      )}
      {v5 && deleteConfirming && (
        <div className="inline-flex min-h-10 max-w-full flex-wrap items-center gap-2 rounded-[8px] bg-[var(--mw-accent-tint,var(--bad-bg))] py-1 pl-3 pr-1.5 text-[13.5px] text-[var(--mw-accent-hover,var(--bad))]" role="alert" data-testid="delete-item-confirm-bar">
          <TriangleAlert size={15} aria-hidden="true" />
          <span>Delete {item.name || 'this item'} from your library?</span>
          <button
            type="button"
            onClick={handleDelete}
            data-testid="delete-item-confirm"
            disabled={deleteLoading}
            className="h-[30px] rounded-[7px] border-0 bg-[var(--mw-accent,var(--bad))] px-3 text-[13px] font-semibold text-white cursor-pointer hover:bg-[var(--mw-accent-hover,var(--bad))] disabled:opacity-60"
          >
            {deleteLoading ? 'Deleting…' : 'Delete'}
          </button>
          <button
            type="button"
            onClick={() => { setDeleteConfirming(false); setDeleteError(null); }}
            data-testid="delete-item-cancel"
            disabled={deleteLoading}
            className="h-[30px] rounded-[7px] border-0 bg-transparent px-3 text-[13px] font-semibold text-[var(--mw-accent-hover,var(--bad))] cursor-pointer hover:bg-white/60"
          >
            Keep
          </button>
          {deleteError && <span className="text-xs text-bad" data-testid="delete-item-error">{deleteError}</span>}
        </div>
      )}
      {!v5 && canShowMoreActions && !deleteConfirming && (
        <div className="relative">
          <button
            type="button"
            data-testid="edit-more-actions-btn"
            aria-haspopup="menu"
            aria-expanded={moreActionsOpen}
            title="Clone · Hide · Delete"
            disabled={saving || cloneSaving}
            onClick={() => setMoreActionsOpen((v) => !v)}
            className={`${SECONDARY_BTN_CLS} inline-flex items-center gap-2`}
          >
            More actions
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          {moreActionsOpen && (
            <div
              role="menu"
              data-testid="edit-more-actions-menu"
              className="absolute left-0 bottom-full mb-1 min-w-[200px] bg-surface border border-line rounded-ctl shadow-float py-1 z-10"
            >
              {onCloneRequest && (
                <button
                  type="button"
                  role="menuitem"
                  data-testid="edit-clone-btn"
                  onClick={() => { setMoreActionsOpen(false); onCloneRequest(item); }}
                  className="w-full text-left px-3.5 py-2 bg-transparent border-0 text-sm text-ink cursor-pointer hover:bg-surface2"
                >
                  Clone item
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                data-testid="edit-visibility-action"
                onClick={() => {
                  setMoreActionsOpen(false);
                  trackAction('menu.editModal.toggleActive', {
                    restaurantId,
                    metadata: { itemId: item.id, next: !isActive },
                  });
                  setIsActive((v) => !v);
                }}
                className="w-full text-left px-3.5 py-2 bg-transparent border-0 text-sm text-ink cursor-pointer hover:bg-surface2"
              >
                {isActive ? 'Hide from guests' : 'Show to guests'}
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="delete-item-btn"
                onClick={() => { setMoreActionsOpen(false); setDeleteConfirming(true); }}
                className="w-full text-left px-3.5 py-2 bg-transparent border-0 text-sm text-bad cursor-pointer hover:bg-surface2"
              >
                Delete item
              </button>
            </div>
          )}
        </div>
      )}
      {/* Admin-only Enrich button — appears when onEnrichItem prop is wired by
          the consumer (admin-webapp). Owner-webapp does NOT pass the prop. */}
      {onEnrichItem && !isNewItem && item.id && !deleteConfirming && (
        <button
          type="button"
          onClick={handleEnrichClick}
          disabled={saving || enriching}
          data-testid="edit-enrich-btn"
          className={SECONDARY_BTN_CLS}
        >
          {enriching ? 'Enriching…' : 'Enrich with AI'}
        </button>
      )}
      <span className="flex-1" />
      {deleteConfirming && !v5 ? (
        <>
          <span className="text-sm font-semibold text-ink">Delete this item permanently?</span>
          {deleteError && <span className="text-xs text-bad">{deleteError}</span>}
          <button
            type="button"
            onClick={() => { setDeleteConfirming(false); setDeleteError(null); }}
            data-testid="delete-item-cancel"
            disabled={deleteLoading}
            className={SECONDARY_BTN_CLS}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            data-testid="delete-item-confirm"
            disabled={deleteLoading}
            className={dangerFooterCls}
          >
            {deleteLoading ? 'Deleting…' : 'Delete permanently'}
          </button>
        </>
      ) : (
        <>
          <button type="button" onClick={onClose} disabled={savingInFlight} data-testid="edit-cancel-btn" className={SECONDARY_BTN_CLS}>Cancel</button>
          {cloneMode && onCloneSave ? (
            <button
              type="button"
              onClick={handleCloneSave}
              disabled={cloneSaving || showNameInvalid}
              data-testid="edit-clone-save-btn"
              className={primaryFooterCls}
            >
              {cloneSaving ? 'Saving…' : 'Save copy'}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || deleteLoading}
              data-testid="edit-save-btn"
              className={primaryFooterCls}
            >
              {saving ? 'Saving…' : v5 ? 'Save' : isNewItem ? (isAddon ? 'Save add-on' : 'Save item') : isAddon ? 'Save shared add-on' : 'Save shared item'}
            </button>
          )}
        </>
      )}
    </div>
  );

  // Container: modal mode = the design's centred 960px box over a scrim
  // (full-screen on phones); inline mode fills its parent (the owner Item
  // library mounts it inside its own centred box with the same geometry).
  const containerClass = isInline
    ? 'relative w-full h-full bg-surface flex flex-col overflow-hidden'
    : isMobile
      ? 'fixed inset-0 z-[70] bg-surface flex flex-col overflow-hidden'
      : `fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[70] ${v5 ? 'w-[min(900px,calc(100vw-40px))]' : 'w-[min(960px,calc(100vw-40px))]'} max-h-[calc(100vh-40px)] bg-surface rounded-2xl shadow-float flex flex-col overflow-hidden`;

  const tree = (
    <>
      {/* Backdrop — modal mode only */}
      {!isInline && (
        <div
          onClick={savingInFlight ? undefined : onClose}
          className="fixed inset-0 z-[60] bg-ink/45"
          data-testid="edit-modal-backdrop"
        />
      )}

      {/* Modal / inline editor — same body in both modes */}
      <div
        data-testid="edit-item-modal"
        data-mobile={isMobile ? 'true' : undefined}
        data-display-mode={displayMode}
        data-section={activeTab}
        role={isInline ? undefined : 'dialog'}
        aria-modal={isInline ? undefined : true}
        aria-label={headerTitle}
        className={containerClass}
      >
        {/* ── Header: eyebrow · item name · scope band · close ── */}
        <div className="px-6 pt-5 pb-4 border-b border-line flex items-start gap-3 shrink-0">
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold tracking-[.06em] uppercase text-accent" data-testid="edit-item-eyebrow">
              {cloneMode ? 'Clone item' : isNewItem ? (isAddon ? 'New add-on' : 'New item') : (isAddon ? 'Edit add-on' : 'Edit item')}
            </div>
            <div className="text-[22px] font-bold leading-tight text-ink truncate" data-testid="edit-item-title">
              {headerTitle}
            </div>
            {(!v5 || isPricingSection) && (
            <div className="flex items-center gap-2 mt-1.5 flex-wrap" data-testid="edit-scope-band">
              {isPricingSection ? (
                <>
                  <span className="text-xs font-bold bg-warn-bg text-warn rounded-full px-2.5 py-[3px]" data-testid="edit-scope-pill">
                    {pricingMenu ? `${pricingMenu.menu_name} menu only` : 'Not on any menu'}
                  </span>
                  <span className="text-[13px] text-ink-soft" data-testid="edit-scope-line">
                    {pricingMenu ? 'Price, portion and promotion are set per menu.' : 'Add it to a menu from the Menu builder.'}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-xs font-bold bg-ink text-on-ink rounded-full px-2.5 py-[3px]" data-testid="edit-scope-pill">
                    {isNewItem ? 'New item' : isAddon ? 'Shared add-on' : 'Shared item'}
                  </span>
                  <span className="text-[13px] text-ink-soft" data-testid="edit-scope-line">{scopeLine}</span>
                </>
              )}
            </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            // G4: no exit while a save is in flight — the backdrop and the
            // footer Cancel are gated the same way, and the owner host
            // (FoodItemsManagerClient) ignores its scrim/Escape via
            // `onSavingChange`.
            disabled={savingInFlight}
            data-testid="edit-close-btn"
            aria-label="Close"
            className="w-9 h-9 shrink-0 rounded-ctl border-0 bg-transparent text-ink cursor-pointer inline-flex items-center justify-center hover:bg-surface2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* ── Body: rail (desktop) / dropdown (phone) + scrollable section ── */}
        {galleryOpen && galleryPanelSlot ? (
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
            {galleryPanelSlot({
              itemId: item.id,
              itemName: name,
              onPicked: (url) => { setThumbnail(url); setGalleryOpen(false); },
              onClose: () => setGalleryOpen(false),
            })}
          </div>
        ) : (
          <div className={`flex-1 min-h-0 flex overflow-hidden ${isMobile ? 'flex-col' : ''}`}>
            {isMobile ? (
              <div className="px-4 pt-3 shrink-0">
                <label className="sr-only" htmlFor="edit-section-select">Section</label>
                <select
                  id="edit-section-select"
                  data-testid="edit-section-select"
                  value={activeTab}
                  onChange={(e) => setActiveTab(e.target.value as EditModalTab)}
                  className="w-full h-10 rounded-ctl border border-line-input bg-surface px-2.5 text-sm font-semibold text-ink"
                >
                  {sections.map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
              </div>
            ) : (
              <nav
                data-testid="edit-section-rail"
                aria-label="Item editor sections"
                className="w-[210px] shrink-0 border-r border-line p-3 flex flex-col gap-0.5 overflow-y-auto"
              >
                {sections.map((s, idx) => {
                  const isActiveSection = activeTab === s.key;
                  const Icon = s.icon;
                  const firstMore = s.group === 'more' && (idx === 0 || sections[idx - 1].group !== 'more');
                  return (
                    <Fragment key={s.key}>
                      {firstMore && <div className="border-t border-line-row my-1.5" role="separator" />}
                      <button
                        type="button"
                        onClick={() => setActiveTab(s.key)}
                        aria-current={isActiveSection ? 'page' : undefined}
                        aria-pressed={isActiveSection}
                        data-testid={`tab-${s.key}`}
                        className={`flex items-center gap-[11px] min-h-[38px] px-2.5 rounded-ctl border-0 border-l-[3px] cursor-pointer text-left text-sm text-ink ${
                          isActiveSection ? 'bg-surface2 font-bold border-accent' : 'bg-transparent font-medium border-transparent hover:bg-surface2'
                        }`}
                      >
                        <Icon size={16} aria-hidden="true" className="shrink-0" />
                        <span className="truncate">{s.label}</span>
                      </button>
                    </Fragment>
                  );
                })}
              </nav>
            )}

            <div data-testid="edit-section-content" className="flex-1 min-w-0 overflow-y-auto px-5 py-4 md:px-6 md:py-5">
              {/* Clone-mode banner — the owner immediately understands they're
                  creating a new copy of an existing dish, not editing the
                  original. The Save copy button is the only commit path. */}
              {cloneMode && (
                <div
                  data-testid="edit-clone-banner"
                  className="bg-warn-bg text-warn rounded-ctl px-3 py-2 mb-4 text-xs leading-relaxed"
                >
                  <strong>Cloning {cloneSourceName ? `“${cloneSourceName}”` : 'this item'}.</strong>{' '}
                  All other fields are copied verbatim — only the name needs to
                  change. Rename the item (it must differ from the source and
                  cannot contain “Copy”), then click <em>Save copy</em>.
                </div>
              )}
              {saveError && (
                <div data-testid="edit-save-error" className="text-xs text-bad bg-bad-bg rounded-ctl px-2.5 py-1.5 flex items-center gap-1.5 mb-4">
                  <AlertCircle size={12} aria-hidden="true" />
                  {saveError}
                </div>
              )}
              {cloneError && (
                <div data-testid="edit-clone-error" className="text-xs text-bad bg-bad-bg rounded-ctl px-2.5 py-1.5 flex items-center gap-1.5 mb-4">
                  <AlertCircle size={12} aria-hidden="true" />
                  {cloneError}
                </div>
              )}
              {deleteError && !deleteConfirming && (
                <div className="text-xs text-bad bg-bad-bg rounded-ctl px-2.5 py-1.5 flex items-center gap-1.5 mb-4">
                  <AlertCircle size={12} aria-hidden="true" />
                  {deleteError}
                </div>
              )}

              {activeTab === 'food_tags' && basicsSection}
              {activeTab === 'dietary' && showDietarySection && dietarySection}
              {activeTab === 'advanced' && advancedSection}

              {/* ── Modifiers (content provided by consumer) ── */}
              {activeTab === 'groupings' && groupingsSlot && (
                <section data-testid="edit-modifiers-section" className="flex flex-col gap-3">
                  <SectionHeading>Modifier groups</SectionHeading>
                  {groupingsSlot}
                  <p className="text-[13px] text-ink-soft m-0">
                    Groups are reusable. Editing a group changes it for every item that uses it.
                  </p>
                </section>
              )}

              {/* ── Pairings (dish-to-dish recommendations, consumer slot) ── */}
              {activeTab === 'pairings' && pairingsSlot && (
                <section data-testid="edit-pairings-section" className="flex flex-col gap-3">
                  <SectionHeading>Pairs well with</SectionHeading>
                  {pairingsSlot}
                </section>
              )}

              {/* ── Recipe (consumer slot) ── */}
              {showRecipeTab && activeTab === 'recipe' && (
                <section data-testid="edit-modal-recipe-panel">{recipeSlot}</section>
              )}

              {/* ── Menu pricing — per-menu price / portion / promotion ── */}
              {isPricingSection && (
                <MenuPricingPanel
                  placementsDraft={placementsDraft}
                  placementsSaving={placementsSaving}
                  selectedMenuId={pricingMenu?.menu_id ?? null}
                  onSelectMenu={setPricingMenuId}
                  itemId={item.id}
                  itemBasePrice={item.price ?? null}
                  currencySymbol={currencySymbol}
                  getMenuHref={getMenuHref}
                  overlapSlot={placementsOverlapSlot}
                  servingOptions={servingRows.map((r) => ({ id: r.id, label: r.label, volume_ml: r.volume_ml, price: r.price }))}
                  onGoToServingSizes={() => setActiveTab('food_tags')}
                  onUpdate={persistPlacement}
                  flushRef={pricingFlushRef}
                />
              )}

          {/* ── Add-ons tab ───────────────────────────────────────────── */}
          {activeTab === 'addons' && (
            <section style={{ marginBottom: 4 }}>
              {!restaurantId && (
                <div className="text-caption" style={{ padding: '20px 0', textAlign: 'center' }}>
                  Add-on data unavailable — no restaurant context.
                </div>
              )}

              {restaurantId && (
                <>
                  {/* Mutation error banner */}
                  {addonsError && (
                    <div className="text-caption" style={{ color: 'var(--bad)', background: 'var(--bad-bg)', borderRadius: 4, padding: '6px 10px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <AlertCircle size={14} /> {addonsError}
                    </div>
                  )}
                  {/* AI Suggestions — pending approval */}
                  {itemAddons.filter((a) => a.status === 'suggested').length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                      <div className="section-header" style={{ color: 'var(--warn)', marginBottom: 8 }}>
                        AI Suggestions
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {itemAddons.filter((a) => a.status === 'suggested').map((addon) => (
                          <AddonCard
                            key={addon.menu_item_id}
                            addon={addon}
                            basePrice={addonPool.find((p) => p.id === addon.menu_item_id)?.price ?? null}
                            onApprove={(price) => void handleApproveAddon(addon, price)}
                            onRemove={() => void handleRemoveAddon(addon.menu_item_id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Assigned add-ons */}
                  <div style={{ marginBottom: 20 }}>
                    <div className="section-header" style={{ marginBottom: 8 }}>
                      Assigned Add-ons
                    </div>
                    {itemAddons.filter((a) => a.status === 'approved').length === 0 ? (
                      <div className="text-caption" style={{ fontStyle: 'italic', padding: '8px 0' }}>
                        No add-ons assigned yet — add from the pool below.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {itemAddons.filter((a) => a.status === 'approved').map((addon) => (
                          <AddonCard
                            key={addon.menu_item_id}
                            addon={addon}
                            basePrice={addonPool.find((p) => p.id === addon.menu_item_id)?.price ?? null}
                            onRemove={() => void handleRemoveAddon(addon.menu_item_id)}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Add from pool */}
                  <div>
                    <div className="section-header" style={{ marginBottom: 8 }}>
                      Add from Pool
                    </div>
                    {addonsLoading && (
                      <div className="text-caption" style={{ padding: '8px 0' }}>Loading…</div>
                    )}
                    {addonsError && !addonsLoading && (
                      <div className="text-caption" style={{ color: 'var(--bad)', background: 'var(--bad-bg)', borderRadius: 4, padding: '6px 10px' }}>
                        {addonsError}
                      </div>
                    )}
                    {!addonsLoading && !addonsError && addonPool.length === 0 && (
                      <div className="text-caption" style={{ fontStyle: 'italic', padding: '8px 0' }}>
                        No add-on items found. Mark items as &quot;Add-on&quot; in their editor to make them available here.
                      </div>
                    )}
                    {!addonsLoading && addonPool.length > 0 && (
                      <>
                        {/* Pool search */}
                        <div style={{ position: 'relative', marginBottom: 8 }}>
                          <input
                            type="text"
                            value={poolSearch}
                            onChange={(e) => setPoolSearch(e.target.value)}
                            placeholder="Search add-ons…"
                            data-testid="addon-pool-search"
                            style={{
                              ...inputStyle,
                              fontSize: 12,
                              padding: '6px 10px',
                              paddingRight: 28,
                              width: '100%',
                              boxSizing: 'border-box',
                            }}
                          />
                          {poolSearch && (
                            <button
                              type="button"
                              onClick={() => setPoolSearch('')}
                              aria-label="Clear search"
                              style={{
                                position: 'absolute',
                                right: 6,
                                top: '50%',
                                transform: 'translateY(-50%)',
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
                          )}
                        </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {addonPool
                          // exclude already-assigned
                          .filter((p) => !itemAddons.some((a) => a.menu_item_id === p.id))
                          // search filter
                          .filter((p) => !poolSearch.trim() || p.name.toLowerCase().includes(poolSearch.toLowerCase()))
                          // manually-curated (usage_count > 0) first, then alphabetical
                          .sort((a, b) => {
                            const aUsed = ((a as unknown as { usage_count?: number }).usage_count ?? 0) > 0 ? 0 : 1;
                            const bUsed = ((b as unknown as { usage_count?: number }).usage_count ?? 0) > 0 ? 0 : 1;
                            if (aUsed !== bUsed) return aUsed - bUsed;
                            return a.name.localeCompare(b.name);
                          })
                          .map((poolItem) => (
                            <div
                              key={poolItem.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                padding: '8px 10px',
                                borderRadius: 'var(--r-xs)',
                                border: '1px solid var(--border)',
                                background: 'var(--surface-sunk)',
                              }}
                            >
                              <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div title={poolItem.name} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {poolItem.name}
                                </div>
                                {poolItem.price != null && (
                                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>
                                    {currencySymbol}{poolItem.price.toFixed(2)}
                                  </div>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => void handleAddAddon(poolItem)}
                                data-testid={`add-addon-${poolItem.id}`}
                                disabled={poolItem.price == null || poolItem.price <= 0}
                                title={poolItem.price == null || poolItem.price <= 0 ? 'Set a price on this add-on item before adding' : undefined}
                                style={{
                                  fontSize: 11, fontWeight: 700, padding: '4px 10px',
                                  background: poolItem.price != null && poolItem.price > 0 ? 'var(--surface2)' : 'var(--surface2)',
                                  border: `1px solid ${poolItem.price != null && poolItem.price > 0 ? '#f59e0b' : '#d1d5db'}`,
                                  color: poolItem.price != null && poolItem.price > 0 ? 'var(--warn)' : 'var(--ink-faint)',
                                  borderRadius: 4,
                                  cursor: poolItem.price != null && poolItem.price > 0 ? 'pointer' : 'not-allowed',
                                  flexShrink: 0,
                                }}
                              >
                                + Add
                              </button>
                            </div>
                          ))}
                      </div>
                      </>
                    )}
                  </div>
                </>
              )}
            </section>
          )}

          {/* ── Recommendations tab (shown when editing a dish item) ──── */}
          {activeTab === 'recommendations' && isNewItem && (
            <section style={{ marginBottom: 4 }} data-testid="recommendations-seed-picker">
              <div className="text-caption" style={{ marginBottom: 12, color: 'var(--text2)' }}>
                Seed cross-sell pairings — items the patron will be encouraged to add when they order this dish.
                AI will refine these once your menu has run through Menu Intelligence.
              </div>

              {/* Selected seeds */}
              <div style={{ marginBottom: 16 }}>
                <div className="section-header" style={{ marginBottom: 8 }}>
                  Seeded Pairings ({itemRecs.length})
                </div>
                {itemRecs.length === 0 ? (
                  <div className="text-caption" style={{ fontStyle: 'italic', padding: '8px 0' }}>
                    None yet — pick from the list below.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {itemRecs.map((rec) => (
                      <RecommendationCard
                        key={rec.menu_item_id}
                        rec={rec}
                        onRemove={() => void handleRemoveRec(rec.menu_item_id)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Picker — search across allItems, exclude self/addons/already-seeded */}
              <div>
                <div className="section-header" style={{ marginBottom: 8 }}>
                  Add a Pairing
                </div>
                {(() => {
                  const seededIds = new Set(itemRecs.map((r) => r.menu_item_id));
                  const available = (allItems ?? []).filter((d) =>
                    d.id !== item.id &&
                    (d.item_type ?? 'dish') !== 'addon' &&
                    !seededIds.has(d.id),
                  );
                  if (available.length === 0) {
                    return (
                      <div className="text-caption" style={{ fontStyle: 'italic', padding: '8px 0' }}>
                        No more dishes available to seed.
                      </div>
                    );
                  }
                  const filtered = available.filter(
                    (d) => !recsPickerSearch.trim() || d.name.toLowerCase().includes(recsPickerSearch.toLowerCase()),
                  );
                  return (
                    <>
                      <div style={{ position: 'relative', marginBottom: 8 }}>
                        <input
                          type="text"
                          value={recsPickerSearch}
                          onChange={(e) => setRecsPickerSearch(e.target.value)}
                          placeholder="Search dishes..."
                          data-testid="recs-seed-picker-search"
                          style={{ ...inputStyle, fontSize: 12, padding: '6px 10px', paddingRight: 28, width: '100%', boxSizing: 'border-box' }}
                        />
                        {recsPickerSearch && (
                          <button
                            type="button"
                            onClick={() => setRecsPickerSearch('')}
                            aria-label="Clear search"
                            style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text2)', display: 'flex', alignItems: 'center', padding: 2 }}
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                      {filtered.length === 0 ? (
                        <div className="text-caption" style={{ fontStyle: 'italic', padding: '8px 0' }}>
                          No matches.
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
                          {filtered.map((d) => (
                            <button
                              key={d.id}
                              type="button"
                              onClick={() => handleAddSeedRec(d)}
                              data-testid={`recs-seed-add-${d.id}`}
                              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 'var(--r-xs)', border: '1px solid var(--border)', background: 'var(--surface-sunk)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
                            >
                              <div style={{ width: 32, height: 32, borderRadius: 4, background: 'var(--surface2)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
                                {d.thumbnail_url ? (
                                  <img src={d.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : '🍽'}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div title={d.name} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {d.name}
                                </div>
                                {d.price != null && (
                                  <div className="text-caption">{currencySymbol}{Number(d.price).toFixed(2)}</div>
                                )}
                              </div>
                              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--brand-s)' }}>+ Add</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </section>
          )}

          {/* ── Recommendations tab — saved-item path (AI suggestions + accepted) */}
          {activeTab === 'recommendations' && !isNewItem && (
            <section style={{ marginBottom: 4 }}>
              {recsLoading && (
                <div className="text-caption" style={{ padding: '8px 0' }}>Loading…</div>
              )}
              {recsError && !recsLoading && (
                <div className="text-caption" style={{ color: 'var(--bad)', background: 'var(--bad-bg)', borderRadius: 4, padding: '6px 10px' }}>
                  {recsError}
                </div>
              )}
              {!recsLoading && !recsError && (
                aiSugs.length === 0 && itemRecs.length === 0 ? (
                  <div className="text-caption" style={{ fontStyle: 'italic', padding: '20px 0', textAlign: 'center' }}>
                    No recommendations generated yet. Run Menu Intelligence to generate AI pairings for this dish.
                  </div>
                ) : (
                  <>
                    {/* AI Suggestions — from pairing_graph, pending acceptance */}
                    {aiSugs.length > 0 && (
                      <div style={{ marginBottom: 20 }}>
                        <div className="section-header" style={{ color: 'var(--warn)', marginBottom: 8 }}>
                          AI Suggestions
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {aiSugs.map((rec) => (
                            <RecommendationCard
                              key={rec.menu_item_id}
                              rec={rec}
                              onApprove={() => void handleApproveRec(rec)}
                              onRemove={() => handleDismissAiSug(rec.menu_item_id)}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Accepted pairings — confirmed in menu_item_recommendations */}
                    <div style={{ marginBottom: 20 }}>
                      <div className="section-header" style={{ marginBottom: 8 }}>
                        Accepted Pairings
                      </div>
                      {itemRecs.length === 0 ? (
                        <div className="text-caption" style={{ fontStyle: 'italic', padding: '8px 0' }}>
                          No pairings accepted yet — use the Accept button on AI suggestions above.
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {itemRecs.map((rec) => (
                            <RecommendationCard
                              key={rec.menu_item_id}
                              rec={rec}
                              onRemove={() => void handleRemoveRec(rec.menu_item_id)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )
              )}
            </section>
          )}

              {/* ── Dishes (add-on editor: which dishes offer this add-on) ── */}
              {activeTab === 'dishes' && (
            <section style={{ marginBottom: 4 }}>
              {!allItems || allItems.length === 0 ? (
                <div className="text-caption" style={{ padding: '20px 0', textAlign: 'center' }}>
                  No dish data available.
                </div>
              ) : (
                <>
                  {/* Associated dishes */}
                  <div style={{ marginBottom: 20 }}>
                    <div className="section-header" style={{ marginBottom: 8 }}>
                      Associated Dishes
                    </div>
                    {associatedDishIds.size === 0 ? (
                      <div className="text-caption" style={{ fontStyle: 'italic', padding: '8px 0' }}>
                        Not assigned to any dish yet — add from the pool below.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {allItems
                          .filter((d) => associatedDishIds.has(d.id))
                          .map((dish) => (
                            <div
                              key={dish.id}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                padding: '8px 10px', borderRadius: 'var(--r-xs)',
                                border: '1px solid var(--border)', background: 'var(--surface-sunk)',
                              }}
                            >
                              <div
                                style={{
                                  width: 32, height: 32, borderRadius: 4,
                                  background: 'var(--surface2)', overflow: 'hidden',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  fontSize: 14, flexShrink: 0,
                                }}
                              >
                                {dish.thumbnail_url ? (
                                  <img src={dish.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : '🍽'}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div title={dish.name} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {dish.name}
                                </div>
                                {dish.price != null && (
                                  <div className="text-caption">{currencySymbol}{Number(dish.price).toFixed(2)}</div>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => void handleRemoveFromDish(dish)}
                                data-testid={`remove-dish-${dish.id}`}
                                style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', background: 'var(--bad-bg)', border: '1px solid #E5A9A2', color: 'var(--bad)', borderRadius: 4, cursor: 'pointer', flexShrink: 0 }}
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>

                  {/* Add from dish pool */}
                  <div>
                    <div className="section-header" style={{ marginBottom: 8 }}>
                      Add to Dish
                    </div>
                    {(() => {
                      const availableDishes = allItems.filter((d) => !associatedDishIds.has(d.id) && d.id !== item.id);
                      if (availableDishes.length === 0) {
                        return (
                          <div className="text-caption" style={{ fontStyle: 'italic', padding: '8px 0' }}>
                            All dishes are already associated with this add-on.
                          </div>
                        );
                      }
                      const filtered = availableDishes.filter(
                        (d) => !dishSearch.trim() || d.name.toLowerCase().includes(dishSearch.toLowerCase()),
                      );
                      return (
                        <>
                          <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
                            <div style={{ position: 'relative', flex: 1 }}>
                              <input
                                type="text"
                                value={dishSearch}
                                onChange={(e) => setDishSearch(e.target.value)}
                                placeholder="Search dishes..."
                                data-testid="dish-pool-search"
                                style={{
                                  ...inputStyle,
                                  fontSize: 12,
                                  padding: '6px 10px',
                                  paddingRight: 28,
                                  width: '100%',
                                  boxSizing: 'border-box',
                                }}
                              />
                              {dishSearch && (
                                <button
                                  type="button"
                                  onClick={() => setDishSearch('')}
                                  aria-label="Clear search"
                                  style={{
                                    position: 'absolute',
                                    right: 6,
                                    top: '50%',
                                    transform: 'translateY(-50%)',
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
                              )}
                            </div>
                            <button
                              type="button"
                              data-testid="select-all-dishes"
                              onClick={() => {
                                const allFilteredIds = filtered.map((d) => d.id);
                                const allSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedDishIds.has(id));
                                if (allSelected) {
                                  setSelectedDishIds((prev) => {
                                    const next = new Set(prev);
                                    allFilteredIds.forEach((id) => next.delete(id));
                                    return next;
                                  });
                                } else {
                                  setSelectedDishIds((prev) => {
                                    const next = new Set(prev);
                                    allFilteredIds.forEach((id) => next.add(id));
                                    return next;
                                  });
                                }
                              }}
                              style={{
                                fontSize: 11, fontWeight: 700, padding: '6px 12px',
                                background: filtered.length > 0 && filtered.every((d) => selectedDishIds.has(d.id)) ? 'var(--warn-bg)' : 'var(--surface-sunk)',
                                border: '1px solid var(--border)',
                                color: 'var(--text)', borderRadius: 4, cursor: 'pointer',
                                whiteSpace: 'nowrap', flexShrink: 0, minWidth: 105,
                                textAlign: 'center',
                              }}
                            >
                              {filtered.length > 0 && filtered.every((d) => selectedDishIds.has(d.id)) ? 'Deselect All' : 'Select All'}
                              {dishSearch.trim() ? ` (${filtered.length})` : ''}
                            </button>
                            {selectedDishIds.size > 0 && (
                              <button
                                type="button"
                                onClick={() => void handleAddToMultipleDishes(selectedDishIds)}
                                data-testid="add-selected-dishes"
                                style={{
                                  fontSize: 11, fontWeight: 700, padding: '6px 12px',
                                  background: 'var(--surface2)', border: '1px solid var(--warn)',
                                  color: 'var(--warn)', borderRadius: 4, cursor: 'pointer',
                                  whiteSpace: 'nowrap', flexShrink: 0,
                                }}
                              >
                                Add Selected ({selectedDishIds.size})
                              </button>
                            )}
                          </div>
                          {filtered.length === 0 ? (
                            <div className="text-caption" style={{ fontStyle: 'italic', padding: '8px 0' }}>
                              No dishes match your search.
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {filtered.map((dish) => {
                                const isSelected = selectedDishIds.has(dish.id);
                                return (
                                  <div
                                    key={dish.id}
                                    style={{
                                      display: 'flex', alignItems: 'center', gap: 10,
                                      padding: '8px 10px', borderRadius: 'var(--r-xs)',
                                      border: isSelected ? '1px solid var(--warn)' : '1px solid var(--border)',
                                      background: isSelected ? 'var(--warn-bg)' : 'var(--surface-sunk)',
                                      cursor: 'pointer',
                                    }}
                                    onClick={() => {
                                      setSelectedDishIds((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(dish.id)) next.delete(dish.id);
                                        else next.add(dish.id);
                                        return next;
                                      });
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      readOnly
                                      data-testid={`select-dish-${dish.id}`}
                                      style={{ flexShrink: 0, cursor: 'pointer', accentColor: 'var(--warn)' }}
                                    />
                                    <div
                                      style={{
                                        width: 32, height: 32, borderRadius: 4,
                                        background: 'var(--surface2)', overflow: 'hidden',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 14, flexShrink: 0,
                                      }}
                                    >
                                      {dish.thumbnail_url ? (
                                        <img src={dish.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                      ) : '🍽'}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div title={dish.name} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {dish.name}
                                      </div>
                                      {dish.price != null && (
                                        <div className="text-caption">{currencySymbol}{Number(dish.price).toFixed(2)}</div>
                                      )}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); void handleAddToDish(dish); }}
                                      data-testid={`add-to-dish-${dish.id}`}
                                      style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', background: 'var(--surface2)', border: '1px solid var(--warn)', color: 'var(--warn)', borderRadius: 4, cursor: 'pointer', flexShrink: 0 }}
                                    >
                                      + Add
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </>
              )}
            </section>
              )}

              {/* ── Performance ── */}
              {activeTab === 'performance' && (
            <section style={{ marginBottom: 4 }}>
              {/* Period selector */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>Time period</label>
                <Select
                  size="sm"
                  value={perfPeriod}
                  onChange={(e) => setPerfPeriod(e.target.value as MenuItemPerformancePeriod)}
                  data-testid="perf-period-select"
                  options={[
                    { value: 'last_hour', label: 'Last hour' },
                    { value: 'last_day', label: 'Last day' },
                    { value: 'last_3_days', label: 'Last 3 days' },
                    { value: 'last_7_days', label: 'Last 7 days' },
                    { value: 'last_month', label: 'Last month' },
                  ]}
                />
              </div>

              {/* Loading / error states */}
              {perfLoading && (
                <div style={{ fontSize: 13, color: 'var(--text2)', padding: '20px 0', textAlign: 'center' }}>
                  Loading performance data…
                </div>
              )}
              {perfError && !perfLoading && (
                <div className="text-caption" style={{ color: 'var(--bad)', background: 'var(--bad-bg)', borderRadius: 4, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertCircle size={12} />
                  {perfError}
                </div>
              )}

              {/* Metric cards */}
              {perfData && !perfLoading && (
                <div data-testid="perf-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
                  <PerfCard testId="perf-card-carousel-views" label="Carousel Views" value={perfData.carousel_views.toLocaleString()} />
                  <PerfCard testId="perf-card-conversions" label="Conversions" value={perfData.conversions.toLocaleString()} />
                  <PerfCard testId="perf-card-card-flips" label="Card Flips" value={perfData.card_flips.toLocaleString()} />
                  <PerfCard testId="perf-card-conversion-rate" label="Conversion Rate" value={`${perfData.conversion_rate}%`} highlight={perfData.conversion_rate > 0} />
                </div>
              )}

              {/* No restaurant context */}
              {!restaurantId && !perfLoading && (
                <div className="text-caption" style={{ padding: '20px 0', textAlign: 'center' }}>
                  Performance data unavailable — no restaurant context.
                </div>
              )}
            </section>
              )}
            </div>
          </div>
        )}

        {footer}
      </div>

      {/* Food item patron preview overlay */}
      {previewOpen && (
        <FoodItemPreviewModal
          item={{ ...item, thumbnail_url: thumbnail }}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </>
  );
  // Modal mode renders at the document root: an ancestor with a transform
  // (the workspace's load animation) or containment would otherwise become
  // the containing block of `position: fixed`, and the window would centre on
  // that panel instead of the page (Avi, 2026-11-11). Context still flows
  // through the portal.
  if (isInline || typeof document === 'undefined') return tree;
  return createPortal(tree, document.body);
}

// ── Style helpers ─────────────────────────────────────────────────────────────

function RecommendationCard({
  rec,
  onApprove,
  onRemove,
}: {
  rec: RecommendationEntry;
  onApprove?: () => void;
  onRemove: () => void;
}) {
  const isAI = rec.recommendation_type === 'ai' || rec.recommendation_type === 'ai_generated';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        borderRadius: 'var(--r-xs)',
        border: isAI ? '1px solid var(--warn)' : '1px solid var(--border)',
        background: isAI ? 'var(--warn-bg)' : 'var(--surface-sunk)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div title={rec.name} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {rec.name}
          </div>
          {isAI && (
            <span style={{ fontSize: 9, fontWeight: 700, background: 'var(--warn-bg)', color: 'var(--warn)', border: '1px solid var(--warn)', borderRadius: 4, padding: '1px 4px', flexShrink: 0 }}>
              AI
            </span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {isAI && onApprove && (
          <button
            type="button"
            onClick={onApprove}
            data-testid={`approve-rec-modal-${rec.menu_item_id}`}
            style={{ fontSize: 11, fontWeight: 700, padding: '4px 8px', background: 'var(--ok-bg)', border: '1px solid #A6CDB3', color: 'var(--ok)', borderRadius: 4, cursor: 'pointer' }}
          >
            Accept
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          data-testid={`remove-rec-modal-${rec.menu_item_id}`}
          style={{ fontSize: 11, fontWeight: 600, padding: '4px 8px', background: 'var(--bad-bg)', border: '1px solid #E5A9A2', color: 'var(--bad)', borderRadius: 4, cursor: 'pointer' }}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function AddonCard({
  addon,
  basePrice,
  onApprove,
  onRemove,
}: {
  addon: AddonEntry;
  /** Price read from the addon item itself — always authoritative, never from the association. */
  basePrice: number | null;
  onApprove?: (price: number) => void;
  onRemove: () => void;
}) {
  const currencySymbol = useCurrencySymbol();
  const isSuggested = addon.status === 'suggested' && !!onApprove;
  const [priceInput, setPriceInput] = useState(
    basePrice != null && basePrice > 0 ? basePrice.toFixed(2) : ''
  );
  const parsedPrice = parseFloat(priceInput);
  const priceValid = !isNaN(parsedPrice) && parsedPrice > 0;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: isSuggested ? 'flex-start' : 'center',
        gap: 10,
        padding: '8px 10px',
        borderRadius: 'var(--r-xs)',
        border: addon.status === 'suggested' ? '1px solid var(--warn)' : '1px solid var(--border)',
        background: addon.status === 'suggested' ? 'var(--warn-bg)' : 'var(--surface-sunk)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div title={addon.name} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {addon.name}
          </div>
          {addon.status === 'suggested' && (
            <span style={{ fontSize: 9, fontWeight: 700, background: 'var(--warn-bg)', color: 'var(--warn)', border: '1px solid var(--warn)', borderRadius: 4, padding: '1px 4px', flexShrink: 0 }}>
              AI
            </span>
          )}
          {!isSuggested && (
            <div
              style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}
              data-testid={`addon-price-${addon.menu_item_id}`}
            >
              {basePrice != null ? `${currencySymbol}${basePrice.toFixed(2)}` : ''}
            </div>
          )}
        </div>
        {isSuggested && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>Price:</span>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <span style={{ position: 'absolute', left: 6, fontSize: 11, color: 'var(--text-secondary)', pointerEvents: 'none' }}>{currencySymbol}</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                placeholder="0.00"
                data-testid={`approve-addon-price-${addon.menu_item_id}`}
                style={{
                  fontSize: 12,
                  padding: '3px 6px 3px 16px',
                  border: `1px solid ${priceValid ? '#86efac' : '#d1d5db'}`,
                  borderRadius: 4,
                  width: 80,
                  outline: 'none',
                  background: 'var(--surface)',
                }}
              />
            </div>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0, paddingTop: isSuggested ? 2 : 0 }}>
        {addon.status === 'suggested' && onApprove && (
          <button
            type="button"
            onClick={() => priceValid && onApprove(parsedPrice)}
            disabled={!priceValid}
            data-testid={`approve-addon-modal-${addon.menu_item_id}`}
            title={priceValid ? undefined : 'Enter a price to approve this add-on'}
            style={{
              fontSize: 11, fontWeight: 700, padding: '4px 8px',
              background: priceValid ? 'var(--ok-bg)' : 'var(--surface2)',
              border: `1px solid ${priceValid ? '#86efac' : '#d1d5db'}`,
              color: priceValid ? 'var(--ok)' : 'var(--ink-faint)',
              borderRadius: 4,
              cursor: priceValid ? 'pointer' : 'not-allowed',
            }}
          >
            Approve
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          data-testid={`remove-addon-modal-${addon.menu_item_id}`}
          style={{ fontSize: 11, fontWeight: 600, padding: '4px 8px', background: 'var(--bad-bg)', border: '1px solid #E5A9A2', color: 'var(--bad)', borderRadius: 4, cursor: 'pointer' }}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function PerfCard({ testId, label, value, highlight }: { testId?: string; label: string; value: string; highlight?: boolean }) {
  return (
    <div
      data-testid={testId}
      style={{
        ...EDITOR_CARD_STYLE,
        ...(highlight ? { background: 'var(--surface2)', border: '1px solid var(--line)' } : {}),
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div className="section-header" style={{ marginBottom: 0 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: highlight ? 'var(--brand)' : 'var(--text)' }}>
        {value}
      </div>
    </div>
  );
}

// The editor's three-level surface hierarchy (2026-09-02).
//
// It used to be flat: the modal shell, every card, and every input were all
// pure white, so nothing read as sitting on anything and the whole editor
// looked like one undifferentiated sheet.
//
//   GROUND  (modal shell)   — deepest, warm off-white
//   PANEL   (cards below)   — lighter off-white, hairline border + soft lift
//   INPUT   (inputStyle)    — pure white, so a text box is unmistakably a
//                             text box against the panel behind it
//
// Neutral greys (2026-09-02, owner call — the first cut used warm off-whites
// and read washed out). The separation between the three levels is what does
// the work here, not the hue.
//
// Every value is a token with a literal fallback. packages/shared is consumed
// by owner, waiter and admin — a consumer that has not defined the token still
// gets the intended colour, and one that has can retheme without forking this
// file.
const EDITOR_GROUND = 'var(--surface, #ffffff)';
const EDITOR_PANEL = 'var(--surface, #ffffff)';
const EDITOR_INPUT = 'var(--surface, #ffffff)';
const EDITOR_PANEL_SHADOW = 'none';


const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--ink-soft)',
  display: 'block',
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  fontSize: 16,
  color: 'var(--text)',
  // Deliberately pure white against the off-white panel behind it — that
  // contrast is what makes an editable field look editable. Do not move this
  // to a panel token; it would flatten the editor again.
  background: EDITOR_INPUT,
  border: '1px solid var(--line-input)',
  borderRadius: 'var(--r-ctl, 8px)',
  padding: '8px 12px',
  minHeight: 40,
  outline: 'none',
  boxSizing: 'border-box',
};


// STR-963 — single source of truth for the editor's card container so every
// tab (Food Tags · Placements · Performance) reads as one design system:
// panel surface, 1px hairline border, radius 8, 14px padding.
const EDITOR_CARD_STYLE: React.CSSProperties = {
  background: EDITOR_PANEL,
  border: '1px solid var(--line)',
  borderRadius: 'var(--r-ctl, 8px)',
  padding: 14,
  boxShadow: EDITOR_PANEL_SHADOW,
};


// ── Menu pricing section ──────────────────────────────────────────────────────
// boost_level is persisted on the menu_item_menus junction as the string
// "1" / "2" / "3" (BulkActionsPanel writes the same shape). Convert to the
// human BoostLabel for display, and back to its numeric string on save.
function boostLevelToLabel(raw: string | null | undefined): BoostLabel | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > BOOST_LABELS.length) return null;
  return BOOST_LABELS[n - 1];
}
function labelToBoostLevel(label: BoostLabel | null): string | null {
  if (label == null) return null;
  const idx = BOOST_LABELS.indexOf(label);
  return idx < 0 ? null : String(idx + 1);
}

interface PricingServingOption {
  id: string;
  label: string;
  volume_ml: string;
  /** Item-level price in DOLLARS as typed ('' = none). */
  price: string;
}

interface MenuPricingPanelProps {
  placementsDraft: MenuAssociation[];
  placementsSaving: Set<string>;
  selectedMenuId: string | null;
  onSelectMenu: (menuId: string) => void;
  itemId: string;
  /** The item's own base price — what a menu with no price falls back to. */
  itemBasePrice: number | null;
  currencySymbol: string;
  /** Owner-webapp menu-page href builder — "Open in Menu builder" link. */
  getMenuHref?: (menuId: string, itemId: string) => string;
  /** Optional overlap surface rendered above the pricing columns. */
  overlapSlot?: ReactNode;
  /** Item-level (wine) serving sizes; per-menu PRICE overrides are edited here. */
  servingOptions: PricingServingOption[];
  onGoToServingSizes: () => void;
  onUpdate: (menuId: string, patch: Partial<MenuItemJunctionSettings>) => Promise<void>;
  /** The footer's "Save <Menu> settings" flushes the blur-committed buffers through this. */
  flushRef: React.MutableRefObject<(() => void) | null>;
}

function MenuPricingPanel({
  placementsDraft,
  placementsSaving,
  selectedMenuId,
  onSelectMenu,
  itemId,
  itemBasePrice,
  currencySymbol,
  getMenuHref,
  overlapSlot,
  servingOptions,
  onGoToServingSizes,
  onUpdate,
  flushRef,
}: MenuPricingPanelProps) {
  const money = (n: number) => `${currencySymbol}${n.toFixed(2)}`;
  const placements = placementsDraft.filter((a) => !!a.menu_id);
  const selected = placements.find((a) => a.menu_id === selectedMenuId) ?? placements[0] ?? null;
  const hint = menuPricingHint(placements, money);

  if (placements.length === 0 || !selected) {
    return (
      <section data-testid="placements-tab-empty" className="flex flex-col gap-4">
        {overlapSlot}
        <div className="text-center py-8 text-ink-soft">
          <Database size={30} className="mx-auto text-ink-faint" aria-hidden="true" />
          <div className="font-semibold text-ink mt-2">Not on any menu yet</div>
          <div className="text-sm">Add it to a menu from the Menu builder, then set its price here.</div>
        </div>
      </section>
    );
  }

  return (
    <section data-testid="placements-tab" className="flex flex-col gap-5">
      {overlapSlot}
      <div className="flex gap-5 flex-wrap">
        {/* Left — the selected menu's price & placement */}
        <div className="flex-1 basis-[320px] min-w-0">
          <SectionHeading sub="Prices and promotions can differ by menu.">Price &amp; placement</SectionHeading>
          <div className="inline-flex border border-line rounded-ctl overflow-hidden mb-2.5 max-w-full flex-wrap" role="tablist" aria-label="Menu">
            {placements.map((p) => {
              const on = p.menu_id === selected.menu_id;
              return (
                <button
                  key={p.menu_id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  data-testid={`menu-pricing-menu-${p.menu_id}`}
                  onClick={() => onSelectMenu(p.menu_id)}
                  className={`h-9 px-[18px] border-0 text-[13px] font-semibold cursor-pointer ${on ? 'bg-ink text-on-ink' : 'bg-surface text-ink'}`}
                >
                  {p.menu_name}
                </button>
              );
            })}
          </div>
          <MenuPricingEditor
            key={selected.menu_id}
            assoc={selected}
            saving={placementsSaving.has(selected.menu_id)}
            money={money}
            currencySymbol={currencySymbol}
            menuHref={getMenuHref ? getMenuHref(selected.menu_id, itemId) : null}
            servingOptions={servingOptions}
            onGoToServingSizes={onGoToServingSizes}
            onChange={(patch) => void onUpdate(selected.menu_id, patch)}
            flushRef={flushRef}
          />
        </div>

        {/* Right — where this item appears */}
        <div className="flex-[0_1_250px] min-w-[210px] md:border-l md:border-line md:pl-5" data-testid="menu-pricing-appears">
          <div className="text-[15px] font-bold text-ink mb-2.5">Where this item appears</div>
          <div className="border border-line rounded-ctl overflow-hidden mb-3">
            {placements.map((p) => {
              const on = p.menu_id === selected.menu_id;
              const effective = p.price != null ? money(p.price) : itemBasePrice != null ? `${money(itemBasePrice)} base` : 'No price';
              return (
                <button
                  key={p.menu_id}
                  type="button"
                  data-testid={`menu-pricing-row-${p.menu_id}`}
                  aria-current={on ? 'true' : undefined}
                  onClick={() => onSelectMenu(p.menu_id)}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 border-0 border-b border-line-row last:border-b-0 text-left text-sm cursor-pointer ${
                    on ? 'bg-surface2 font-bold' : 'bg-transparent font-normal'
                  } ${p.price == null && itemBasePrice == null ? 'text-ink-soft' : 'text-ink'}`}
                >
                  <span className="flex-1 truncate">{p.menu_name}</span>
                  <span className="tabular-nums">{effective}</span>
                  <Check size={13} aria-hidden="true" className={on ? 'visible' : 'invisible'} />
                </button>
              );
            })}
          </div>
          {hint && (
            <div
              data-testid="menu-pricing-divergence-banner"
              className="flex gap-2.5 bg-warn-bg rounded-ctl px-3 py-2.5 text-[13px] text-ink"
            >
              <TriangleAlert size={15} className="text-warn shrink-0 mt-0.5" aria-hidden="true" />
              <span>{hint}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

interface MenuPricingEditorProps {
  assoc: MenuAssociation;
  saving: boolean;
  money: (n: number) => string;
  currencySymbol: string;
  menuHref: string | null;
  servingOptions: PricingServingOption[];
  onGoToServingSizes: () => void;
  onChange: (patch: Partial<MenuItemJunctionSettings>) => void;
  flushRef: React.MutableRefObject<(() => void) | null>;
}

// One menu's price / portion / promotion. Price + serves + serving overrides
// are blur-committed text buffers (so the owner can clear a field mid-typing);
// selects and switches commit on every change since their value space is
// small. Keyed by menu id from the parent, so switching menus resets buffers.
function MenuPricingEditor({
  assoc,
  saving,
  money,
  currencySymbol,
  menuHref,
  servingOptions,
  onGoToServingSizes,
  onChange,
  flushRef,
}: MenuPricingEditorProps) {
  const [priceText, setPriceText] = useState<string>(assoc.price == null ? '' : String(assoc.price));
  useEffect(() => {
    setPriceText(assoc.price == null ? '' : String(assoc.price));
  }, [assoc.price]);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [servesText, setServesText] = useState<string>(
    assoc.portion_serves == null ? '' : String(assoc.portion_serves),
  );
  useEffect(() => {
    setServesText(assoc.portion_serves == null ? '' : String(assoc.portion_serves));
  }, [assoc.portion_serves]);
  const [servingOpen, setServingOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);

  const commitPrice = () => {
    // STR-1274: parse properly ("1,200" → 1200) and SHOW the error rather than
    // snapping back silently. An empty field is meaningful: null means
    // "charge the item's own price", so it is deliberately NOT required.
    const parsed = parsePriceInput(priceText);
    if (!parsed.ok) {
      setPriceError(parsed.error);
      return;
    }
    setPriceError(null);
    const nextPrice = parsed.value;
    setPriceText(nextPrice == null ? '' : String(nextPrice));
    if (nextPrice === assoc.price) return;
    onChange({ price: nextPrice });
  };

  const commitServes = () => {
    const trimmed = servesText.trim();
    const nextServes: number | null = trimmed === '' ? null : Number(trimmed);
    if (nextServes !== null && (!Number.isFinite(nextServes) || nextServes <= 0)) {
      setServesText(assoc.portion_serves == null ? '' : String(assoc.portion_serves));
      return;
    }
    if (nextServes === assoc.portion_serves) return;
    onChange({ portion_serves: nextServes });
  };

  // The footer's "Save <Menu> settings" commits whatever is still buffered.
  useEffect(() => {
    flushRef.current = () => { commitPrice(); commitServes(); };
    return () => { flushRef.current = null; };
  });

  const currentBoost = boostLevelToLabel(assoc.boost_level);
  const portionType: 'single' | 'shared' = assoc.portion_type ?? 'single';
  const overrides = assoc.serving_price_overrides ?? {};
  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div data-testid={`placements-tab-row-${assoc.menu_id}`} className={saving ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
      <div className="text-[13px] text-ink-soft mb-3 flex items-center gap-2 flex-wrap">
        <span data-testid={`menu-pricing-path-${assoc.menu_id}`}>{placementPath(assoc)}</span>
        {menuHref && (
          <a
            href={menuHref}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`placements-tab-menu-link-${assoc.menu_id}`}
            title={`Open ${assoc.menu_name} in the Menu builder (new tab) — jumps to this item`}
            className="font-semibold text-ink no-underline"
          >
            Open in Menu builder ↗
          </a>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 pb-4 border-b border-line-row">
        <div>
          <label className={FIELD_LABEL_CLS} htmlFor={`menus-price-${assoc.menu_id}`}>Price on {assoc.menu_name}</label>
          <div className={`flex items-center gap-1 h-10 rounded-ctl border bg-surface px-3 ${priceError ? 'border-bad' : 'border-line-input'}`}>
            <span aria-hidden="true" className="text-ink-soft font-semibold">{currencySymbol}</span>
            <input
              id={`menus-price-${assoc.menu_id}`}
              data-testid={`placements-tab-price-${assoc.menu_id}`}
              // STR-1274: type="text", not "number" — a number input's value
              // sanitisation drops "1,200" before it reaches state.
              type="text"
              inputMode="decimal"
              value={priceText}
              disabled={saving}
              placeholder={assoc.price == null ? 'uses item price' : undefined}
              onChange={(e) => { setPriceError(null); setPriceText(e.target.value); }}
              onBlur={commitPrice}
              onKeyDown={blurOnEnter}
              className="flex-1 min-w-0 border-0 outline-none bg-transparent text-base font-semibold tabular-nums text-ink p-0"
            />
          </div>
          {priceError && (
            <div role="alert" data-testid={`placements-tab-price-error-${assoc.menu_id}`} className="text-xs text-bad mt-1">
              {priceError}
            </div>
          )}
        </div>
        <div>
          <label className={FIELD_LABEL_CLS} htmlFor={`menus-portion-type-${assoc.menu_id}`}>Portion</label>
          <select
            id={`menus-portion-type-${assoc.menu_id}`}
            data-testid={`placements-tab-portion-type-${assoc.menu_id}`}
            value={portionType}
            disabled={saving}
            onChange={(e) => {
              const next = e.target.value as 'single' | 'shared';
              // Switching to single clears serves; switching to shared leaves
              // the current serves value (or null) for the adjacent field.
              if (next === 'single') onChange({ portion_type: 'single', portion_serves: null });
              else onChange({ portion_type: 'shared' });
            }}
            className={FIELD_INPUT_CLS}
          >
            <option value="single">Serves one</option>
            <option value="shared">Shared</option>
          </select>
        </div>
        {portionType === 'shared' && (
          <div>
            <label className={FIELD_LABEL_CLS} htmlFor={`menus-portion-serves-${assoc.menu_id}`}>Serves how many</label>
            <input
              id={`menus-portion-serves-${assoc.menu_id}`}
              data-testid={`placements-tab-portion-serves-${assoc.menu_id}`}
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={servesText}
              disabled={saving}
              placeholder="e.g. 2"
              onChange={(e) => setServesText(e.target.value)}
              onBlur={commitServes}
              onKeyDown={blurOnEnter}
              className={FIELD_INPUT_CLS}
            />
          </div>
        )}
      </div>

      <div className="text-base font-bold text-ink mt-3.5 mb-2.5">Promotion on {assoc.menu_name}</div>
      <div className="grid grid-cols-[1fr_auto] gap-x-3.5 gap-y-3 items-center mb-4">
        <span className="text-sm text-ink">Featured dish <span className="text-ink-soft">(chef&apos;s special)</span></span>
        <InkSwitch
          checked={!!assoc.chefs_special}
          disabled={saving}
          label={`Featured dish on ${assoc.menu_name}`}
          testId={`placements-tab-chefs-special-${assoc.menu_id}`}
          onChange={(next) => onChange({ chefs_special: next })}
        />
        <label className="text-sm text-ink" htmlFor={`menus-boost-${assoc.menu_id}`}>Menu prominence</label>
        <select
          id={`menus-boost-${assoc.menu_id}`}
          data-testid={`placements-tab-boost-${assoc.menu_id}`}
          value={currentBoost ?? ''}
          disabled={saving}
          onChange={(e) => {
            const nextLabel = (e.target.value || null) as BoostLabel | null;
            onChange({ boost_level: labelToBoostLevel(nextLabel) });
          }}
          className="h-10 min-w-[180px] rounded-ctl border border-line-input bg-surface px-2.5 text-sm text-ink"
        >
          <option value="">None</option>
          {BOOST_LABELS.map((b) => (
            <option key={b} value={b}>Boost · {b}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        {servingOptions.length > 0 && (
          <Accordion
            title="Serving sizes & prices"
            open={servingOpen}
            onToggle={() => setServingOpen((v) => !v)}
            testId={`menu-pricing-serving-sizes-${assoc.menu_id}`}
          >
            <div className="flex flex-col">
              {servingOptions.map((opt) => (
                <ServingOverrideRow
                  key={opt.id}
                  menuId={assoc.menu_id}
                  option={opt}
                  overrideCents={overrides[opt.id]}
                  saving={saving}
                  money={money}
                  currencySymbol={currencySymbol}
                  onCommit={(cents) => {
                    const next: Record<string, number> = { ...overrides };
                    if (cents == null) delete next[opt.id];
                    else next[opt.id] = cents;
                    onChange({ serving_price_overrides: next });
                  }}
                />
              ))}
              <button
                type="button"
                data-testid={`menu-pricing-add-serving-${assoc.menu_id}`}
                onClick={onGoToServingSizes}
                className="self-start mt-2 bg-transparent border-0 p-0 text-[13px] font-semibold text-ink cursor-pointer"
              >
                + Add serving size (Basics › Beverage details)
              </button>
            </div>
          </Accordion>
        )}
        <Accordion
          title="Why prices differ"
          open={whyOpen}
          onToggle={() => setWhyOpen((v) => !v)}
          testId={`menu-pricing-why-${assoc.menu_id}`}
        >
          Guests are charged, in order: <strong>1.</strong> the serving-size price, if one is set ·{' '}
          <strong>2.</strong> otherwise this menu&apos;s price · <strong>3.</strong> otherwise the item&apos;s
          base price. A menu with no price shows {money(0)} until you set one.
        </Accordion>
      </div>
    </div>
  );
}

// One serving size's per-menu price override (cents on the wire, dollars in
// the box). Empty = "uses item price".
function ServingOverrideRow({
  menuId,
  option,
  overrideCents,
  saving,
  money,
  currencySymbol,
  onCommit,
}: {
  menuId: string;
  option: PricingServingOption;
  overrideCents: number | undefined;
  saving: boolean;
  money: (n: number) => string;
  currencySymbol: string;
  onCommit: (cents: number | null) => void;
}) {
  const fromCents = (c: number | undefined) => (c == null ? '' : (c / 100).toFixed(2));
  const [text, setText] = useState<string>(fromCents(overrideCents));
  useEffect(() => { setText(fromCents(overrideCents)); }, [overrideCents]);
  const [error, setError] = useState<string | null>(null);
  const itemPrice = option.price.trim() === '' ? null : Number(option.price);
  const commit = () => {
    const parsed = parsePriceInput(text);
    if (!parsed.ok) { setError(parsed.error); return; }
    setError(null);
    const cents = parsed.value == null ? null : Math.round(parsed.value * 100);
    setText(cents == null ? '' : (cents / 100).toFixed(2));
    if (cents === (overrideCents ?? null)) return;
    onCommit(cents);
  };
  return (
    <div className="flex items-center gap-3 py-1.5" data-testid={`menu-pricing-serving-row-${menuId}-${option.id}`}>
      <span className="flex-1 text-sm text-ink">
        {option.label || 'Serving'}{option.volume_ml ? ` · ${option.volume_ml} ml` : ''}
        <span className="text-ink-soft"> — {itemPrice != null && Number.isFinite(itemPrice) ? `item price ${money(itemPrice)}` : 'uses menu price'}</span>
      </span>
      <div className={`flex items-center gap-1 h-9 w-[120px] rounded-ctl border bg-surface px-2.5 ${error ? 'border-bad' : 'border-line-input'}`}>
        <span aria-hidden="true" className="text-ink-soft text-xs font-semibold">{currencySymbol}</span>
        <input
          type="text"
          inputMode="decimal"
          aria-label={`${option.label || 'Serving'} price on this menu`}
          data-testid={`menu-pricing-serving-price-${menuId}-${option.id}`}
          value={text}
          disabled={saving}
          placeholder="override"
          onChange={(e) => { setError(null); setText(e.target.value); }}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
          className="flex-1 min-w-0 border-0 outline-none bg-transparent text-sm tabular-nums text-ink p-0"
        />
      </div>
    </div>
  );
}

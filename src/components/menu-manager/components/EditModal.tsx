'use client';
import { useMenuManagerService } from '../context';
import { useTrackAction } from '../track-action-context';

import { Fragment, useRef, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { X, Upload, Camera, Trash2, Eye, EyeOff, AlertCircle, ScanEye, Pencil, ChevronDown } from 'lucide-react';
import { FoodItemPreviewModal } from '../../preview/FoodItemPreviewModal';
import type {MenuItemDisplay, MenuSummary, FoodTags, BeverageTags, AddonEntry, RecommendationEntry, MenuItemPerformancePeriod, MenuItemPerformanceResponse, MenuAssociation, MenuItemJunctionSettings} from '../../../types/restaurant';
import { FOOD_TAG_FIELD_MAP, toCanonical, BOOST_LABELS, type BoostLabel } from '../lib/menuUtils';
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

// STR-963 P1 — icon + full-width flags drive the Food Tags card grid.
// The emoji is decorative (rendered aria-hidden inside TagInput's label).
const TAG_FIELDS: { key: keyof FoodTags; label: string; placeholder: string; icon: string; full?: boolean }[] = [
  { key: 'ingredients',    label: 'Ingredients',    placeholder: 'e.g. chicken, lemon…', icon: '🥘', full: true },
  { key: 'cooking_method', label: 'Cooking method',  placeholder: 'e.g. grilled, fried…', icon: '🔥' },
  { key: 'textures',       label: 'Texture',          placeholder: 'e.g. crispy, creamy…', icon: '🎯' },
  { key: 'taste_profile',  label: 'Taste profile',   placeholder: 'e.g. savoury, smoky…', icon: '👅', full: true },
  { key: 'seasons',        label: 'Seasonal',         placeholder: 'e.g. summer, winter…', icon: '📅' },
  { key: 'festivity',      label: 'Festivities',      placeholder: 'e.g. Christmas, Diwali…', icon: '🎉' },
];

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
  icon,
}: {
  label: string;
  values: string[];
  placeholder: string;
  onChange: (newValues: string[]) => void;
  fieldKey: string;
  icon?: string;
}) {
  const [input, setInput] = useState('');

  function addTag() {
    const trimmed = input.trim();
    if (!trimmed || values.includes(trimmed)) { setInput(''); return; }
    onChange([...values, trimmed]);
    setInput('');
  }

  return (
    <div>
      <label className="section-header" style={{ display: 'block', marginBottom: 8 }}>
        {icon && <span aria-hidden="true" style={{ marginRight: 6 }}>{icon}</span>}{label}
      </label>
      {/* Chips + inline input flow together directly on the card — no nested
          white box, no dedicated input row (compact per owner feedback: the
          separate input row wasted a whole line per card). Warm "tag-style"
          cream pills per the Seekh mockup; the input is the cursor position
          after the last chip, so a card with a few tags is a single line. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        {values.map((v) => (
          <span
            key={v}
            className="font-medium"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: '#ffecd9',
              color: '#8b4513',
              borderRadius: 14,
              padding: '4px 10px',
              fontSize: 12,
              lineHeight: 1.2,
            }}
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((t) => t !== v))}
              data-testid={`remove-tag-${fieldKey}-${v}`}
              aria-label={`Remove ${v}`}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                lineHeight: 1,
                fontWeight: 700,
                opacity: 0.55,
                color: '#8b4513',
              }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); }
          }}
          onBlur={addTag}
          placeholder={values.length === 0 ? placeholder : 'Add…'}
          data-testid={`tag-input-${fieldKey}`}
          style={{
            flex: 1,
            minWidth: 90,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontSize: 14,
            padding: '4px 2px',
            color: 'var(--text)',
          }}
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
  const selectedBg     = type === 'allergen' ? '#6366f1' : '#d97706';
  const selectedBorder = type === 'allergen' ? '#6366f1' : '#d97706';

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

  // Yellow tint = "AI suggested, not yet reviewed". Disappears the
  // moment the owner takes any action (toggle a chip or click N/A).
  const sectionStyle: React.CSSProperties = !reviewed
    ? {
        background: '#fef9c3',
        border: '1px solid #fde047',
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
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {label}
          {!reviewed && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 10,
                fontWeight: 700,
                color: '#a16207',
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
              color: '#fff',
              background: '#15803d',
              border: '1px solid #15803d',
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
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {options.map((name) => {
            const isSelected = selectedSet.has(name);
            const isBusy = busyTag === name;
            return (
              <button
                key={name}
                type="button"
                data-testid={`dietary-pill-${type}-${name.replace(/\s+/g, '-')}`}
                onClick={() => void handleClick(name)}
                disabled={isBusy}
                style={{
                  padding: '3px 10px',
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: isSelected ? 600 : 400,
                  border: `1.5px solid ${isSelected ? selectedBorder : 'rgba(0,0,0,0.15)'}`,
                  background: isSelected ? selectedBg : 'transparent',
                  color: isSelected ? '#fff' : 'var(--text3)',
                  cursor: isBusy ? 'wait' : 'pointer',
                  opacity: isBusy ? 0.5 : 1,
                  transition: 'all 0.12s ease',
                  whiteSpace: 'nowrap',
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
              padding: '3px 10px',
              borderRadius: 4,
              fontSize: 12,
              fontWeight: naActive ? 600 : 500,
              border: `1.5px dashed ${naActive ? '#15803d' : 'rgba(0,0,0,0.25)'}`,
              background: naActive ? '#ecfdf5' : 'transparent',
              color: naActive ? '#15803d' : 'var(--text3)',
              cursor: 'pointer',
              transition: 'all 0.12s ease',
              whiteSpace: 'nowrap',
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

// ── Mobile accordion header (STR-858) ─────────────────────────────────────────
// Collapsible section header rendered ONLY in the mobile EditModal layout, to
// replace the horizontal-scroll tab strip + long undifferentiated scroll.
// Desktop is untouched (it keeps the tab bar + activeTab switching). The header
// is a ≥52px tap target; the caller gates the body render on `open`, so lazy tab
// content (and its guarded fetches) only mount once the owner expands a section.
function MobileAccordionHeader({
  id,
  title,
  subtitle,
  open,
  onToggle,
}: {
  id: string;
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <button
      type="button"
      data-testid={`edit-mobile-section-header-${id}`}
      aria-expanded={open}
      onClick={() => onToggle(id)}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '14px 2px',
        minHeight: 52,
        background: 'transparent',
        border: 'none',
        borderTop: '1px solid var(--border)',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <ChevronDown
        size={18}
        style={{
          flexShrink: 0,
          color: 'var(--text3)',
          transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
          transition: 'transform 0.15s',
        }}
      />
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{title}</span>
        {subtitle ? (
          <span
            style={{
              fontSize: 12,
              color: 'var(--text3)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {subtitle}
          </span>
        ) : null}
      </span>
    </button>
  );
}

// ── EditModal ─────────────────────────────────────────────────────────────────

export default function EditModal({ item, restaurantId, menus, allItems, ownerFoodCategories, onClose, onComplete, onNavigateToMenu, getMenuHref, onDishAddonsChange, isNewItem = false, forceAddon = false, modifierTypeName = null, forceDish = false, preselectedDishIds, onSaveNewItem, dietaryTagService, customAllergens, customDietary, allergenDefaults, dietaryDefaults, heatLabels, sweetnessLabels, onSweetnessUpdate, onHeatSpiceUpdate, imageLibrarySlot, galleryPanelSlot, groupingsSlot, placementsOverlapSlot, groupingsCount, displayMode = 'modal', onItemUpdate, onEnrichItem, descriptionSource, descriptionReviewed, onAcceptDescription, onCloneRequest, cloneMode = false, cloneSourceName, sourceItemId, onCloneSave }: EditModalProps) {
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

  // Wine serving sizes (PDD 2026-06-15) — owner-configured glass/bottle options
  // on menu_items.serving_options. Prices held here in DOLLARS for the input;
  // converted to price_cents on Save. Resyncs when the item prop changes.
  type ServingRow = { id: string; label: string; volume_ml: string; price: string; is_default: boolean };
  const itemServingRows = (it: MenuItemDisplay): ServingRow[] =>
    (it.serving_options ?? []).map((o, i) => ({
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

  // Tab state — Food Tags | Placements (saved dishes) | Add-ons | Recommendations | Groupings (BYO only) | Performance (dish items) or Performance | Dishes (addon items)
  const [activeTab, setActiveTab] = useState<'food_tags' | 'placements' | 'addons' | 'recommendations' | 'groupings' | 'dishes' | 'performance'>('food_tags');

  // Mobile accordion (STR-858) — which sections are expanded on the mobile
  // layout. Desktop ignores this entirely (it uses the tab bar + activeTab).
  // "basics" + "image" are open by default; the heavier tab-backed sections
  // collapse to tame density and eliminate the horizontal-scroll tab strip.
  // Toggling a tab-backed section
  // ALSO sets activeTab so the lazy per-tab fetches (performance/dishes) still
  // fire on expand — the guarded effects key off activeTab.
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => new Set(['basics', 'image']));
  const toggleSection = useCallback((id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (id === 'food_tags' || id === 'placements' || id === 'groupings' || id === 'dishes' || id === 'performance') {
      setActiveTab(id);
    }
  }, []);

  // Land on a valid tab for the current mode. Available tab sets:
  //   Dish            → [food_tags, placements, groupings, performance]
  //   Existing add-on → [food_tags, performance, dishes]
  //   NEW add-on/mod  → [food_tags] only (Dishes tab removed during creation,
  //                      2026-07-18 — associations happen later via a dish's
  //                      Groupings → Add member picker)
  // Existing add-ons default to 'performance' (analytics-first); everything
  // else (new add-on, dishes) defaults to 'food_tags'. Dep list is
  // [isAddon, isNewItem] only — including activeTab would loop.
  useEffect(() => {
    setActiveTab(isAddon && !isNewItem ? 'performance' : 'food_tags');
  }, [isAddon, isNewItem]);

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
    // items. PUT writes food_tags as a full-replace JSONB blob, so only
    // type-applicable subfields are included (e.g. wine_variety is dropped
    // when type !== 'wine') to keep the persisted object minimal and
    // idempotent across type changes.
    if (category === 'Beverages') {
      const type = bevDraft.beverage_type?.trim() || undefined;
      const norm: BeverageTags = {};
      if (type) norm.beverage_type = type;
      if (typeof bevDraft.alcoholic === 'boolean') norm.alcoholic = bevDraft.alcoholic;
      if (bevDraft.base_spirit && type === 'cocktail') norm.base_spirit = bevDraft.base_spirit;
      if (type === 'wine') {
        if (bevDraft.wine_variety) norm.wine_variety = bevDraft.wine_variety;
        if (bevDraft.wine_color) norm.wine_color = bevDraft.wine_color;
        if (bevDraft.wine_body) norm.wine_body = bevDraft.wine_body;
        if (bevDraft.wine_style) norm.wine_style = bevDraft.wine_style;
      }
      if (bevDraft.sweetness && (type === 'wine' || type === 'cocktail')) norm.sweetness = bevDraft.sweetness;
      if (bevDraft.beer_style && type === 'beer') norm.beer_style = bevDraft.beer_style;
      if (bevDraft.strength) norm.strength = bevDraft.strength;
      if (bevDraft.served) norm.served = bevDraft.served;
      const notes = Array.isArray(bevDraft.flavor_notes)
        ? bevDraft.flavor_notes.filter((s) => typeof s === 'string' && s.trim())
        : [];
      if (notes.length) norm.flavor_notes = notes;
      const ings = Array.isArray(bevDraft.key_ingredients)
        ? bevDraft.key_ingredients.filter((s) => typeof s === 'string' && s.trim())
        : [];
      if (ings.length) norm.key_ingredients = ings;
      if (Object.keys(norm).length > 0) {
        foodTags.beverage = norm;
      }
    }

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
        };
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

  // Container styles vary by displayMode. Inline mode fills its parent —
  // no fixed position, no backdrop, no shadow — so the same body renders
  // as the right panel of the Food Items page without changing any of the
  // form internals.
  const containerStyle: React.CSSProperties = isInline
    ? {
        position: 'relative',
        width: '100%',
        height: '100%',
        background: 'var(--white)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }
    : isMobile
      ? {
          // Mobile: full-screen sheet with the existing dark backdrop preserved.
          // `dvh` accounts for iOS Safari's collapsing URL bar.
          position: 'fixed',
          inset: 0,
          zIndex: 70,
          width: '100dvw',
          maxWidth: '100dvw',
          height: '100dvh',
          maxHeight: '100dvh',
          background: 'var(--white)',
          borderRadius: 0,
          boxShadow: 'none',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }
      : {
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 70,
          width: 960,
          maxWidth: 'calc(100vw - 32px)',
          height: '90vh',
          maxHeight: '90vh',
          background: 'var(--white)',
          borderRadius: 'var(--r)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        };

  return (
    <>
      {/* Backdrop — modal mode only */}
      {!isInline && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0, zIndex: 60,
            background: 'rgba(0,0,0,0.4)',
          }}
          data-testid="edit-modal-backdrop"
        />
      )}

      {/* Modal / inline editor — same body in both modes */}
      <div
        data-testid="edit-item-modal"
        data-mobile={isMobile ? 'true' : undefined}
        data-display-mode={displayMode}
        style={containerStyle}
      >
        {/* Header */}
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexShrink: 0,
            flexWrap: 'wrap',
          }}
        >
          {/* Item name — inline-editable. The title in the EditModal
              header IS the canonical Name field; the duplicate input
              that lived in Basic Info has been removed. The pencil
              affordance to the right is the visible cue that the
              title is editable — clicking it focuses the input and
              selects all text for fast rename. Errors render below
              the header in the body so the layout stays compact. */}
          <div style={{ flex: isMobile ? '1 1 100%' : 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
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
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: 'var(--text)',
                // Amber-yellow tint when the clone draft is in its initial
                // (must-rename) state so the field reads as "this needs
                // your attention" rather than a passive title. New items
                // and clone drafts get an explicit red border whenever
                // the rename rules aren't satisfied yet. Existing-item
                // edits stay transparent unless a save attempt failed.
                background: (cloneMode && _nameUnchangedFromSource) ? '#FEF3C7' : 'transparent',
                border: (nameError || showNameInvalid) ? '2px solid #b91c1c' : '1px solid transparent',
                borderRadius: 6,
                padding: '4px 8px',
                margin: '-4px 0 -4px -8px',
                flex: 1,
                minWidth: 0,
                outline: 'none',
                fontFamily: 'inherit',
                transition: 'border-color 0.12s ease, background 0.12s ease',
              }}
              onFocus={(e) => {
                if (!nameError && !showNameInvalid) e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.background = '#fff';
              }}
              onBlur={(e) => {
                if (!nameError && !showNameInvalid) e.currentTarget.style.borderColor = 'transparent';
                if (!(cloneMode && _nameUnchangedFromSource)) {
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            />
            <button
              type="button"
              data-testid="edit-name-pencil"
              aria-label="Edit name"
              onClick={() => {
                const el = nameInputRef.current;
                if (!el) return;
                el.focus();
                el.select();
              }}
              style={{
                flexShrink: 0,
                width: isMobile ? 44 : 28,
                height: isMobile ? 44 : 28,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 6,
                border: 'none',
                background: 'transparent',
                color: 'var(--text)',
                cursor: 'pointer',
                padding: 0,
                transition: 'background 0.12s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-neutral-gray-100, #f3f4f6)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <Pencil size={14} strokeWidth={2.25} />
            </button>
          </div>

          {/* Active / visibility toggle */}
          <button
            type="button"
            onClick={() => {
              setIsActive((v) => {
                trackAction('menu.editModal.toggleActive', {
                  restaurantId,
                  metadata: { itemId: item.id, next: !v },
                });
                return !v;
              });
            }}
            data-testid="edit-active-toggle"
            aria-pressed={isActive}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              fontSize: 11, fontWeight: 600, padding: isMobile ? '0 12px' : '4px 10px',
              minHeight: isMobile ? 44 : undefined,
              borderRadius: 4,
              border: isActive ? '1px solid #16a34a' : '1px solid #b91c1c',
              background: isActive ? '#dcfce7' : '#fee2e2',
              color: isActive ? '#15803d' : '#b91c1c',
              cursor: 'pointer', flexShrink: 0,
            }}
          >
            {isActive ? <Eye size={12} /> : <EyeOff size={12} />}
            {isActive ? 'Visible' : 'Hidden'}
          </button>

          {/* Divider — hidden on mobile where the header reflows into rows. */}
          <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0, display: isMobile ? 'none' : undefined }} />

          {/* Delete / confirmation — DESKTOP header only. On mobile (STR-858)
              the destructive Delete is relocated out of the header to the bottom
              of the scroll (behind the same 2-step confirm) so it's never a
              stray thumb-tap next to the everyday controls. */}
          {!isMobile && deleteConfirming ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                Delete permanently?
              </span>
              <button
                type="button"
                onClick={() => { setDeleteConfirming(false); setDeleteError(null); }}
                data-testid="delete-item-cancel"
                disabled={deleteLoading}
                style={{ padding: isMobile ? '0 14px' : '5px 10px', minHeight: isMobile ? 44 : undefined, fontSize: 12, fontWeight: 600, color: 'var(--text2)', background: '#f0f0f0', border: 'none', borderRadius: 'var(--r-xs)', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                data-testid="delete-item-confirm"
                disabled={deleteLoading}
                style={{ padding: isMobile ? '0 14px' : '5px 10px', minHeight: isMobile ? 44 : undefined, fontSize: 12, fontWeight: 700, color: 'white', background: '#b91c1c', border: 'none', borderRadius: 'var(--r-xs)', cursor: deleteLoading ? 'not-allowed' : 'pointer', opacity: deleteLoading ? 0.7 : 1 }}
              >
                {deleteLoading ? 'Deleting…' : 'Confirm'}
              </button>
            </div>
          ) : (
            <>
              {!isMobile && (
                <button
                  type="button"
                  onClick={() => setDeleteConfirming(true)}
                  disabled={saving}
                  data-testid="delete-item-btn"
                  style={{ fontSize: 12, fontWeight: 600, color: '#b91c1c', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  Delete
                </button>
              )}
              {/* Admin-only Enrich button — appears when onEnrichItem prop
                  is wired by the consumer (admin-webapp). Owner-webapp does
                  NOT pass the prop, so owners see no button (their enrich
                  flow is auto-on-save, per the PDD). Hidden for new items
                  whose id isn't in the DB yet. */}
              {onEnrichItem && !isNewItem && item.id && (
                <button
                  type="button"
                  onClick={handleEnrichClick}
                  disabled={saving || enriching}
                  data-testid="edit-enrich-btn"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    fontSize: 12, fontWeight: 600, color: '#c2410c',
                    background: '#fff7ed', border: '1px solid #fed7aa',
                    borderRadius: 'var(--r-xs)',
                    padding: '6px 12px', minHeight: isMobile ? 44 : undefined,
                    cursor: (saving || enriching) ? 'not-allowed' : 'pointer',
                    opacity: (saving || enriching) ? 0.7 : 1,
                    whiteSpace: 'nowrap', flexShrink: 0,
                  }}
                >
                  {enriching ? 'Enriching…' : 'Enrich with AI'}
                </button>
              )}
              {/* Clone — opens a clone draft of this item. Opt-in via
                  onCloneRequest from the consumer; hidden during create
                  flows (isNewItem) and during the clone flow itself
                  (cloneMode). The consumer is responsible for closing
                  this modal and reopening it in cloneMode with the
                  source item seeded as `{ ...source, name: source.name +
                  ' (Copy)' }`. */}
              {onCloneRequest && !isNewItem && !cloneMode && item.id && (
                <button
                  type="button"
                  onClick={() => onCloneRequest(item)}
                  disabled={saving || cloneSaving}
                  data-testid="edit-clone-btn"
                  style={{
                    fontSize: 12, fontWeight: 600, color: '#3730A3',
                    background: '#EEF2FF', border: '1px solid #C7D2FE',
                    borderRadius: 'var(--r-xs)',
                    padding: '6px 12px', minHeight: isMobile ? 44 : undefined,
                    cursor: (saving || cloneSaving) ? 'not-allowed' : 'pointer',
                    opacity: (saving || cloneSaving) ? 0.7 : 1,
                    whiteSpace: 'nowrap', flexShrink: 0,
                  }}
                >
                  Clone
                </button>
              )}
              {cloneMode && onCloneSave ? (
                <button
                  type="button"
                  onClick={handleCloneSave}
                  disabled={cloneSaving || showNameInvalid}
                  data-testid="edit-clone-save-btn"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    fontSize: 12, fontWeight: 700, color: 'white',
                    background: 'var(--brand)',
                    border: 'none', borderRadius: 'var(--r-xs)',
                    padding: '6px 14px', minHeight: isMobile ? 44 : undefined,
                    // Mobile: primary action spans the last row for a clear,
                    // thumb-friendly commit target.
                    order: isMobile ? 2 : undefined,
                    // Longhand (grow/shrink/basis) — NOT the `flex` shorthand —
                    // so it never conflicts with flexShrink on rerender (React warns
                    // when shorthand + longhand for the same value are mixed).
                    flexGrow: isMobile ? 1 : 0,
                    flexShrink: isMobile ? 1 : 0,
                    flexBasis: isMobile ? '100%' : 'auto',
                    justifyContent: isMobile ? 'center' : undefined,
                    cursor: (cloneSaving || showNameInvalid) ? 'not-allowed' : 'pointer',
                    opacity: (cloneSaving || showNameInvalid) ? 0.7 : 1,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {cloneSaving ? 'Saving…' : 'Save Copy'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  data-testid="edit-save-btn"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    fontSize: 12, fontWeight: 700, color: 'white',
                    background: 'var(--brand)',
                    border: 'none', borderRadius: 'var(--r-xs)',
                    padding: '6px 14px', minHeight: isMobile ? 44 : undefined,
                    // Mobile: primary action spans the last row for a clear,
                    // thumb-friendly commit target.
                    order: isMobile ? 2 : undefined,
                    // Longhand (grow/shrink/basis) — NOT the `flex` shorthand —
                    // so it never conflicts with flexShrink on rerender (React warns
                    // when shorthand + longhand for the same value are mixed).
                    flexGrow: isMobile ? 1 : 0,
                    flexShrink: isMobile ? 1 : 0,
                    flexBasis: isMobile ? '100%' : 'auto',
                    justifyContent: isMobile ? 'center' : undefined,
                    cursor: saving ? 'not-allowed' : 'pointer',
                    opacity: saving ? 0.7 : 1,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              )}
            </>
          )}

          {/* Close — also serves as cancel */}
          <button
            type="button"
            onClick={onClose}
            data-testid="edit-cancel-btn"
            aria-label="Close"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text2)', padding: 4, borderRadius: 4,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              minWidth: isMobile ? 44 : undefined, minHeight: isMobile ? 44 : undefined,
              // Mobile: sits at the right end of the secondary row (order 1 keeps
              // it ahead of the full-width Save at order 2).
              order: isMobile ? 1 : undefined, marginLeft: isMobile ? 'auto' : undefined,
            }}
          >
            <X size={isMobile ? 20 : 16} />
          </button>
        </div>

        {/* Body — flex column: fixed top (banners + basic info + tabs) + scrollable tab content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: '20px', paddingBottom: 0 }}>

          {/* Clone-mode banner — appears whenever the modal is in a clone
              draft, so the owner immediately understands they're creating
              a new copy of an existing dish, not editing the original.
              The Save Copy button in the header is the only commit path. */}
          {cloneMode && (
            <div
              data-testid="edit-clone-banner"
              style={{
                background: '#EEF2FF',
                border: '1px solid #C7D2FE',
                color: '#3730A3',
                borderRadius: 6,
                padding: '8px 12px',
                marginBottom: 16,
                fontSize: 12,
                lineHeight: 1.45,
              }}
            >
              <strong>Cloning {cloneSourceName ? `“${cloneSourceName}”` : 'this item'}.</strong>{' '}
              All other fields are copied verbatim — only the name needs to
              change. Rename the dish above (it must differ from the source
              and cannot contain “Copy”), then click <em>Save Copy</em>.
            </div>
          )}
          {/* Error banners */}
          {saveError && (
            <div
              data-testid="edit-save-error"
              className="text-caption"
              style={{ color: '#b91c1c', background: '#fee2e2', borderRadius: 4, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}
            >
              <AlertCircle size={12} />
              {saveError}
            </div>
          )}
          {cloneError && (
            <div
              data-testid="edit-clone-error"
              className="text-caption"
              style={{ color: '#b91c1c', background: '#fee2e2', borderRadius: 4, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}
            >
              <AlertCircle size={12} />
              {cloneError}
            </div>
          )}
          {deleteError && (
            <div
              className="text-caption"
              style={{ color: '#b91c1c', background: '#fee2e2', borderRadius: 4, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}
            >
              <AlertCircle size={12} />
              {deleteError}
            </div>
          )}

          {/* Layout container — for dish mode on desktop the basic-info
              column (image + description + category + appears-in) sits
              beside the tabs section in a 280px-1fr grid. Mobile and
              addon mode collapse to flex-column so everything stacks
              naturally. The body wrapper above stays flex-column either
              way; this nested container localises the dish-side grid. */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              // STR-963: the WHOLE dish editor is ONE scroll column on every
              // breakpoint (image → basic info → tabs → tab content), matching
              // the redesign mockup's single-page scroll. Previously only mobile
              // did this; desktop boxed the tab content in its own inner scroller
              // (the cramped Food-Tags scrollbar the owner rejected). Now the
              // container owns the scroll and every pane flows at natural height.
              // paddingBottom keeps the last content clear (of the Crisp bubble
              // on mobile).
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
              paddingBottom: isMobile ? 88 : 20,
              ...(!isAddon && !isMobile
                ? {
                    display: 'grid',
                    gridTemplateColumns: '280px 1fr',
                    columnGap: 20,
                    // start-align so each column keeps its own height and the
                    // container scrolls to the taller (right / tabs) column.
                    alignItems: 'start',
                  }
                : {
                    display: 'flex',
                    flexDirection: 'column',
                  }),
            }}
          >
          {/* ── Body — layout branches on isAddon (STR-303) ───────────────────
              Dishes mode: full two-column (image + basic info + food-tag fields via tabs)
              Add-ons mode: simplified single-column (Name + Price + Description) */}
          {!isAddon && (
          <section
            data-testid="dish-basic-info"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              // STR-963: no inner scroll on the left rail — it flows inside the
              // single dish-editor scroll owned by the parent layout container.
              ...(!isMobile ? { paddingRight: 4, paddingBottom: 4 } : { marginBottom: 20 }),
            }}
          >

            {/* Mobile (STR-858): the 240px image block is the biggest
                real-estate hog and lowest in-shift value — collapse it into an
                accordion section (closed by default). Desktop always shows it. */}
            {isMobile && (
              <MobileAccordionHeader
                id="image"
                title="Image"
                open={expandedSections.has('image')}
                onToggle={toggleSection}
              />
            )}
            {/* Image panel — image + buttons + warnings */}
            <div
              data-testid="item-image-panel"
              style={{
                width: '100%',
                display: isMobile && !expandedSections.has('image') ? 'none' : 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {!isMobile && <SectionLabel>Item Image</SectionLabel>}
              {/* Image display */}
              <div
                data-testid="edit-thumbnail"
                style={{
                  width: '100%',
                  height: 240,
                  borderRadius: 'var(--r)',
                  background: thumbnail ? undefined : '#f6f6f6',
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: thumbnail ? 'none' : '2px dashed var(--border)',
                  position: 'relative',
                }}
              >
                {imgBusy ? (
                  <span className="text-caption" style={{ textAlign: 'center', padding: 12 }}>
                    {imgBusyLabel[imgBusy]}
                  </span>
                ) : thumbnail ? (
                  <img src={thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ textAlign: 'center', color: 'var(--text2)' }}>
                    <div style={{ fontSize: 28, marginBottom: 6 }}>🍽</div>
                    <div className="text-caption">Add an image</div>
                  </div>
                )}
              </div>

              {/* Image action buttons */}
              {/* "Upload photo" — pure file picker (no capture attribute).
                  On mobile this opens the device photo library; the
                  separate "Take Photo" button below opens the camera. */}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={handleUpload}
                style={{ display: 'none' }}
                data-testid="edit-image-file-input"
              />
              {/* Mobile-only: separate file input pinned to the rear camera. */}
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
              <div style={{ display: 'flex', gap: 6 }}>
                {isMobile && (
                  <button
                    type="button"
                    onClick={() => cameraRef.current?.click()}
                    disabled={!!imgBusy}
                    data-testid="edit-take-photo-btn"
                    style={imgActionStyle('blue')}
                  >
                    <Camera size={12} />
                    {imgBusy === 'uploading' ? 'Uploading…' : 'Take Photo'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={!!imgBusy}
                  data-testid="edit-upload-btn"
                  style={imgActionStyle()}
                >
                  <Upload size={12} />
                  {imgBusy === 'uploading' ? 'Uploading…' : 'Upload'}
                </button>
                {!thumbnail && imageLibrarySlot && imageLibrarySlot({
                  itemId: item.id,
                  itemName: name,
                  onPicked: (url) => setThumbnail(url),
                })}
                {thumbnail && (
                  <>
                    <button
                      type="button"
                      onClick={handleRemoveImage}
                      disabled={!!imgBusy}
                      data-testid="edit-remove-image-btn"
                      style={imgActionStyle('red')}
                    >
                      <Trash2 size={12} />
                      {imgBusy === 'removing' ? 'Removing…' : 'Remove'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewOpen(true)}
                      disabled={!!imgBusy}
                      data-testid="preview-button"
                      style={imgActionStyle()}
                    >
                      <ScanEye size={12} />
                      Preview
                    </button>
                  </>
                )}
              </div>

              {/* Choose from Gallery — opens an in-place picker that
                  takes over the right-side tab content. Distinct from
                  imageLibrarySlot (external modal): this is a sibling
                  of Upload that swaps the right pane with a gallery
                  view (Yelp / Google / Drive tabs). */}
              {galleryPanelSlot && (
                <button
                  type="button"
                  data-testid="edit-choose-from-gallery-btn"
                  onClick={() => setGalleryOpen(true)}
                  disabled={!!imgBusy}
                  style={{
                    width: '100%',
                    height: 38,
                    border: '1px solid var(--border)',
                    background: '#fff',
                    color: 'var(--text)',
                    borderRadius: 'var(--r-xs)',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: imgBusy ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    transition: 'background 0.15s, border-color 0.15s',
                  }}
                >
                  <Eye size={13} />
                  Choose from Gallery
                </button>
              )}

              {/* Image error */}
              {imgError && (
                <div className="text-caption" style={{ color: '#b91c1c', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <AlertCircle size={11} />
                  {imgError}
                </div>
              )}

              {/* Soft warning when no image */}
              {!thumbnail && !imgBusy && (
                <div
                  data-testid="no-image-warning"
                  className="text-caption"
                  style={{
                    color: '#92400e',
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                    borderRadius: 6,
                    padding: '6px 8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <AlertCircle size={11} />
                  Add an image to complete this item
                </div>
              )}
            </div>

            {/* Name field moved to the modal header — see the
                inline-editable title at the top of EditModal. The
                error state surfaces here as a single row so layout
                doesn't shift when the user blanks the field.

                Helper-text precedence:
                  1. nameError (set after a failed Save click) → "Name is
                     required" — kept for back-compat with existing-item
                     edits that don't pass cloneMode or isNewItem.
                  2. showNameInvalid (live derived state for new-item or
                     clone-draft modes) → the validation-specific copy
                     ("Name is required" / "cannot contain 'Copy'" /
                     "must differ from the source"). */}
            {showNameInvalid && nameHelperText ? (
              <div className="text-caption" data-testid="edit-name-error" style={{ color: '#b91c1c' }}>
                {nameHelperText}
              </div>
            ) : nameError ? (
              <div className="text-caption" data-testid="edit-name-error" style={{ color: '#b91c1c' }}>
                Name is required
              </div>
            ) : null}

            {/* STR-963 P2 — Dietary Info card (left rail). Dietary + Allergens
                relocated out of the Food Tags tab into the rail for dishes
                (redesign). Same DietaryMultiSelect instances / state / testids;
                add-ons keep these in the Food Tags tab (they have no rail), so
                exactly one copy renders per mode — no duplicate testids. */}
            {dietaryTagService && restaurantId && (
              <div
                data-testid="dietary-info-card"
                style={{
                  background: 'white',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div className="section-header" style={{ display: 'block' }}>
                  <span aria-hidden="true" style={{ marginRight: 6 }}>🍽️</span>Dietary Info
                </div>
                <DietaryMultiSelect
                  label="Dietary Restrictions"
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
                  label="Allergens"
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
              </div>
            )}

            {/* Description / Raw Category / Appears-in moved to the top card zone (STR-963 P3). */}
          </section>
          )}

          {/* Add-on form — simplified single-column layout (STR-303).
              Renders instead of the dish two-column section when the header toggle
              is on Add-ons. No image upload (add-ons never have images), no food tags
              (surfaced via tabs only when editing a dish), just Name + Price + Description. */}
          {isAddon && (
          <section
            data-testid="addon-basic-info"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              marginBottom: 20,
            }}
          >
            <SectionLabel>Basic Info</SectionLabel>

            {/* Name lives in the modal header — see inline-editable
                title at the top. Surface its error state here so the
                user sees it adjacent to the rest of Basic Info. */}
            {nameError && (
              <div className="text-caption" data-testid="edit-name-error" style={{ color: '#b91c1c' }}>
                Name is required
              </div>
            )}

            {/* Price — shown for every add-on, including modifier-type options.
                For a modifier option the price is OPTIONAL (no required
                asterisk, no validation, and it can be cleared); a plain new
                add-on keeps price required. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ flex: '0 0 160px' }}>
                <label style={labelStyle} htmlFor="edit-price-input">
                  Price{isNewItem && isAddon && !modifierTypeName && <span style={{ color: '#b91c1c', marginLeft: 2 }}>*</span>}
                </label>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    border: priceError ? '1px solid #b91c1c' : '1px solid var(--border)',
                    borderRadius: 'var(--r-xs)',
                    padding: '0 8px',
                    background: 'var(--white)',
                    height: 36,
                  }}
                >
                  <span aria-hidden="true" style={{ color: 'var(--text2)', fontWeight: 600 }}>$</span>
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
                    style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 14, padding: 0, minWidth: 0 }}
                  />
                  {price !== null && !(isNewItem && isAddon && !modifierTypeName) && (
                    <button
                      type="button"
                      aria-label="Clear price"
                      onClick={() => { setPrice(null); setPriceError(null); }}
                      data-testid="edit-price-clear"
                      className="text-xs"
                      style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', padding: 2, whiteSpace: 'nowrap' }}
                    >
                      × clear
                    </button>
                  )}
                </div>
                {priceError && (
                  <div className="text-caption" style={{ color: '#b91c1c', marginTop: 3 }}>{priceError}</div>
                )}
              </div>
            </div>

            {/* Memo — owner/staff-facing free-text note (≤500 chars).
                Same field that surfaces as subtext in the Add Member
                picker and gets edited via blur-to-save on the Setup
                Guide → Add-ons page. Here it saves with the rest of
                the form on Save. */}
            <div>
              <label style={labelStyle} htmlFor="edit-memo-input">
                Memo
              </label>
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
                style={{
                  width: '100%',
                  fontSize: 14,
                  padding: '8px 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-xs)',
                  background: 'var(--white)',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  outline: 'none',
                  minHeight: 36,
                }}
              />
            </div>

          </section>
          )}

          {/* Tabs section wrapper — groups bar + content as a single
              flex-column block. In dish + desktop mode the parent
              layout container lays this out as the right column of a
              grid; in addon mode (or mobile) it sits as a flex item
              filling the remaining vertical space below basic-info. */}
          <div
            data-testid="edit-modal-tabs-section"
            style={{
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              // STR-963: natural height so it flows inside the single dish-editor
              // scroll (the parent layout container owns the scroll on every
              // breakpoint now). No more fill-and-inner-scroll on desktop.
              flex: 'none',
            }}
          >
          {/* STR-963 P3 — Top card zone: always-visible essentials above
              the tabs (Description, Raw Category, Appears-in, Heat/Spice,
              Spice Modifier, BYO), relocated from the left rail + Food Tags
              tab per the redesign. Dish-only — add-ons keep their own
              single-column basic-info; each moved block keeps its original
              conditional guard + data-testid (rendered here exactly once). */}
          {!isAddon && (
          <div
            data-testid="edit-modal-top-zone"
            style={{ display: isMobile ? 'flex' : 'grid', flexDirection: 'column', gridTemplateColumns: isMobile ? undefined : 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)', gap: isMobile ? 12 : '12px 20px', alignItems: 'start', marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}
          >
            {/* Column 1 — Description, Raw Category, Appears-in */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
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
                  Description <span style={{ color: '#b91c1c' }}>*</span>
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
                      color: '#B45309',
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
                      ? '1px solid #F59E0B'
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
                      ? '#FEF3C7'
                      : (inputStyle as { background?: string }).background ?? '#fff',
                }}
              />
              {descError && (
                <div className="text-caption" style={{ color: '#b91c1c', marginTop: 3 }}>Description is required</div>
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
                        background: '#3730A3',
                        color: '#fff',
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

            {/* Raw Category — edits the item's original scraped category label
                (menu_items.category_name). Replaces the former "Mapped Course"
                dropdown; canonical course mapping now lives on the menu, not on
                the item. Options are the distinct raw labels already used across
                this restaurant's menu, plus an Uncategorized escape hatch. */}
            <div>
              <label style={labelStyle} htmlFor="edit-category">
                Raw Category
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

            </div>
            {/* Column 2 — Heat/Spice, Spice Modifier, BYO */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
                {/* Heat / Spice relocated to the "Dish Properties" tab as an
                    N/A-default dropdown (STR-977). */}

            {/* ── Placement tiles — menus this item appears on (STR-977) ──
                Compact read-only tiles showing price / boost / chef's-special.
                Each opens the menu in a NEW tab (getMenuHref) so the open
                editor is preserved; falls back to a non-link card when no
                getMenuHref is passed (waiter / admin). Replaces the old faint
                navigate-pills; the Placements TAB remains the editing surface. */}
            {(item.menu_associations ?? []).length > 0 && (
              <div>
                <SectionLabel>On menus</SectionLabel>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {(item.menu_associations ?? []).map((assoc) => {
                    const href = getMenuHref ? getMenuHref(assoc.menu_id, item.id) : null;
                    const priceLabel = assoc.price != null ? `$${assoc.price.toFixed(2)}` : null;
                    const hasBoost = !!assoc.boost_level;
                    const isSpecial = !!assoc.chefs_special;
                    const tileStyle: React.CSSProperties = {
                      display: 'inline-flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      gap: 3,
                      minWidth: 92,
                      maxWidth: 160,
                      minHeight: 44,
                      padding: '6px 10px',
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      background: 'var(--white)',
                      textDecoration: 'none',
                      color: 'var(--text)',
                      cursor: href ? 'pointer' : 'default',
                      transition: 'background 0.1s, border-color 0.1s',
                    };
                    const hover = (e: React.MouseEvent<HTMLElement>, on: boolean) => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.background = on ? 'rgba(255,107,43,0.08)' : 'var(--white)';
                      el.style.borderColor = on ? 'var(--brand-s)' : 'var(--border)';
                    };
                    const inner = (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {assoc.menu_name}
                          </span>
                          {href && <span aria-hidden style={{ fontSize: 11, color: 'var(--text3)', flexShrink: 0 }}>↗</span>}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text2)' }}>
                          {priceLabel && <span>{priceLabel}</span>}
                          {hasBoost && <span title={`Boosted (level ${assoc.boost_level})`} aria-label={`Boosted, level ${assoc.boost_level}`}>⭐</span>}
                          {isSpecial && (
                            <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 8, background: '#fff7ed', color: '#c2410c' }}>
                              Special
                            </span>
                          )}
                        </div>
                      </>
                    );
                    return href ? (
                      <a
                        key={assoc.menu_id}
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid={`placement-tile-${assoc.menu_id}`}
                        style={tileStyle}
                        onMouseEnter={(e) => hover(e, true)}
                        onMouseLeave={(e) => hover(e, false)}
                        onClick={() => {
                          trackAction('menu.editModal.navigateToMenu', {
                            restaurantId,
                            metadata: { itemId: item.id, menuId: assoc.menu_id },
                          });
                        }}
                      >
                        {inner}
                      </a>
                    ) : (
                      <div
                        key={assoc.menu_id}
                        data-testid={`placement-tile-${assoc.menu_id}`}
                        style={tileStyle}
                      >
                        {inner}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            </div>
            {/* Column 3 — Spice Modifier + BYO (compact toggle cards) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
                {/* Spice Modifier — two compact toggles (origin a0ef241 split,
                    kept through the STR-963 relayout): (1) "Show spice picker"
                    (spice_modifier_enabled) renders the patron spice picker;
                    (2) "Require a spice selection" (spice_selection_required)
                    gates "Add to order" and is only meaningful while the picker
                    is shown — disabled + greyed when visibility is off (the
                    backend force-reverts it to false in that case). Hidden for
                    add-ons (never reach composition page) and Desserts. */}
                {!isAddon && category !== 'Desserts' && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid',
                      borderColor: spiceModifierEnabled ? '#fecdd3' : 'var(--border)',
                      background: spiceModifierEnabled ? '#fff1f2' : 'transparent',
                      transition: 'all 0.15s',
                    }}
                  >
                    {/* Row 1 — visibility */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Show spice picker</span>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={spiceModifierEnabled}
                        aria-label="Toggle Show spice picker"
                        data-testid="spice-modifier-toggle"
                        onClick={() => setSpiceModifierEnabled((v: boolean) => !v)}
                        style={{
                          position: 'relative',
                          display: 'inline-flex',
                          alignItems: 'center',
                          height: 24,
                          width: 42,
                          flexShrink: 0,
                          borderRadius: 999,
                          border: 'none',
                          cursor: 'pointer',
                          background: spiceModifierEnabled ? '#e11d48' : '#d1d5db',
                          transition: 'background-color 0.15s',
                          padding: 0,
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-block',
                            height: 18,
                            width: 18,
                            borderRadius: '50%',
                            background: '#fff',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
                            transform: spiceModifierEnabled ? 'translateX(21px)' : 'translateX(3px)',
                            transition: 'transform 0.15s',
                          }}
                        />
                      </button>
                    </div>

                    {/* Divider */}
                    <div style={{ height: 1, background: spiceModifierEnabled ? '#fecdd3' : 'var(--border)' }} />

                    {/* Row 2 — required (disabled + greyed when the picker is hidden) */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: spiceModifierEnabled ? 1 : 0.5, transition: 'opacity 0.15s' }}>
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Require a spice selection</span>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={spiceModifierEnabled && spiceSelectionRequired}
                        aria-label="Toggle Require a spice selection"
                        aria-disabled={!spiceModifierEnabled}
                        disabled={!spiceModifierEnabled}
                        title={!spiceModifierEnabled ? 'Turn on the spice picker to require a selection.' : undefined}
                        data-testid="spice-required-toggle"
                        onClick={() => {
                          if (!spiceModifierEnabled) return;
                          setSpiceSelectionRequired((v: boolean) => !v);
                        }}
                        style={{
                          position: 'relative',
                          display: 'inline-flex',
                          alignItems: 'center',
                          height: 24,
                          width: 42,
                          flexShrink: 0,
                          borderRadius: 999,
                          border: 'none',
                          cursor: spiceModifierEnabled ? 'pointer' : 'not-allowed',
                          background: spiceModifierEnabled && spiceSelectionRequired ? '#e11d48' : '#d1d5db',
                          transition: 'background-color 0.15s',
                          padding: 0,
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-block',
                            height: 18,
                            width: 18,
                            borderRadius: '50%',
                            background: '#fff',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
                            transform: spiceModifierEnabled && spiceSelectionRequired ? 'translateX(21px)' : 'translateX(3px)',
                            transition: 'transform 0.15s',
                          }}
                        />
                      </button>
                    </div>
                  </div>
                )}

                {/* BYO (Build-Your-Own) classification — PDD 2026-05-26.
                    Disabled when the dish has zero groupings: the API
                    hard-blocks is_byo=true on items without customization
                    options, so we mirror that state in the UI. Mobile-
                    friendly: an inline hint below the toggle (NOT just a
                    tooltip) per Plan v2 UX-Reviewer tactical condition.
                    Hidden for add-ons (an add-on cannot be BYO itself). */}
                {!isAddon && (() => {
                  const hasGroupings = (groupingsCount ?? 0) > 0;
                  const toggleDisabled = !hasGroupings;
                  return (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: '1px solid',
                        borderColor: isByo ? 'var(--color-accent-teal, #00a996)' : 'var(--border)',
                        background: isByo ? '#e6f7f5' : 'transparent',
                        opacity: toggleDisabled ? 0.6 : 1,
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Build Your Own</span>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={isByo}
                          aria-label="Toggle Build Your Own"
                          aria-disabled={toggleDisabled}
                          data-testid="byo-toggle"
                          disabled={toggleDisabled}
                          title={toggleDisabled ? 'Add a customization group so diners can build this dish.' : undefined}
                          onClick={() => { if (!toggleDisabled) setIsByo((v: boolean) => !v); }}
                          style={{
                            position: 'relative',
                            display: 'inline-flex',
                            alignItems: 'center',
                            height: 24,
                            width: 42,
                            flexShrink: 0,
                            borderRadius: 999,
                            border: 'none',
                            cursor: toggleDisabled ? 'not-allowed' : 'pointer',
                            background: isByo ? 'var(--color-accent-teal, #00a996)' : '#d1d5db',
                            transition: 'background-color 0.15s',
                            padding: 0,
                          }}
                        >
                          <span
                            style={{
                              display: 'inline-block',
                              height: 18,
                              width: 18,
                              borderRadius: '50%',
                              background: '#fff',
                              boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
                              transform: isByo ? 'translateX(21px)' : 'translateX(3px)',
                              transition: 'transform 0.15s',
                            }}
                          />
                        </button>
                      </div>
                      {toggleDisabled && (
                        <div
                          data-testid="byo-disabled-hint"
                          style={{ fontSize: 11, color: 'var(--text2)', marginLeft: 32 }}
                        >
                          Add a customization group so diners can build this dish.
                        </div>
                      )}
                    </div>
                  );
                })()}


            </div>
          </div>
          )}

          {/* When the owner clicked "Choose from Gallery", the tab bar +
              content are replaced by the consumer-provided picker. The
              slot owns its own header (back chevron, title) — calling
              `onClose` returns to the tab view; `onPicked(url)` updates
              the local thumbnail and dismisses. */}
          {galleryOpen && galleryPanelSlot ? (
            galleryPanelSlot({
              itemId: item.id,
              itemName: name,
              onPicked: (url) => { setThumbnail(url); setGalleryOpen(false); },
              onClose: () => setGalleryOpen(false),
            })
          ) : (<>
          {/* ── Tab bar: context-aware based on toggle state ───────────
              Dishes mode:   Food Tags | Add-ons | Performance
              Add-ons mode:  Performance | Dishes                  */}
          <div
            style={{
              // Desktop: horizontal tab bar. Mobile (STR-858): hidden — the tabs
              // become a vertical accordion (a MobileAccordionHeader is rendered
              // before each tab body below), eliminating the horizontal-scroll
              // strip the manager flagged as un-mobile.
              display: isMobile ? 'none' : 'flex',
              alignItems: 'flex-end',
              gap: 0,
              borderBottom: '1px solid var(--border)',
              flexShrink: 0,
            }}
          >
            {(isAddon
              // Add-ons get a slimmed-down Food Tags tab (allergens +
              // dietary only — heat/spice and free-text fields are
              // suppressed inside the section). Modifiers / sides
              // / sauces still need allergen + dietary capture so the
              // diner-side recommender + filter UI honours per-addon
              // restrictions.
              ? (isNewItem
                // New add-on / modifier option: Food Tags only. The Dishes tab
                // (dish-association picker) is removed during creation — the
                // owner links the add-on to dishes afterwards via a dish's
                // Groupings → Add member picker (owner request 2026-07-18).
                ? (['food_tags'] as const)
                : (['food_tags', 'performance', 'dishes'] as const))
              // PDD 2026-05-10 collapse-addons-recs Phase E Step 13 —
              // Add-ons + Recommendations tabs removed from dish editing.
              // Both concerns now live in the Groupings tab (the
              // `addons` and `recommendations` default groupings created
              // by the backend at item creation). The Groupings tab's
              // pinned-default UX + AI-suggestion banner + per-member
              // approve action (shipped in Step 12) are the load-bearing
              // replacements for the workflows that lived in the
              // legacy tabs. Existing dish items always get groupingsSlot
              // (FoodItemsManagerClient threads it unconditionally), so
              // the second variant is the practical-zero edge case.
              : (isNewItem
                ? (['food_tags'] as const)
                : (groupingsSlot
                  ? (['food_tags', 'placements', 'groupings', 'performance'] as const)
                  : (['food_tags', 'placements', 'performance'] as const)))
            ).map((tab) => {
              const isActive = activeTab === tab;
              const placementsCount = item.menu_associations?.length ?? 0;
              const label =
                tab === 'food_tags'
                  ? (isAddon ? 'Food Tags' : 'Dish Properties')
                  : tab === 'placements'
                    ? `Placements${placementsCount > 0 ? ` (${placementsCount})` : ''}`
                    : tab === 'groupings'
                      ? 'Groupings'
                      : tab === 'dishes'
                        ? `Dishes${associatedDishIds.size > 0 ? ` (${associatedDishIds.size})` : ''}`
                        : 'Performance';
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  aria-pressed={isActive}
                  data-testid={`tab-${tab}`}
                  style={{
                    padding: isMobile ? '13px 16px' : '12px 14px',
                    minHeight: isMobile ? 44 : undefined,
                    flexShrink: 0,
                    fontSize: 14,
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? 'var(--brand-s)' : 'var(--text2)',
                    background: isActive ? 'rgba(255,107,43,0.05)' : 'transparent',
                    border: 'none',
                    borderBottom: isActive ? '2px solid var(--brand-s)' : '2px solid transparent',
                    marginBottom: -1,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* ── Scrollable tab content ── */}
          <div style={{ flex: 'none', overflowY: 'visible', minHeight: 0, paddingTop: 16, paddingBottom: 20 }}>

          {/* ── Food Tags tab ──
              For dishes: full set of fields (heat/spice, sweetness,
              allergens, dietary, free-text). For add-ons: just allergens
              + dietary — modifiers inherit heat/spice from their parent
              dish and don't need their own free-text tags. */}
          {isMobile && (
            <MobileAccordionHeader
              id="food_tags"
              title="Food tags"
              subtitle="Allergens, dietary, heat & sweetness"
              open={expandedSections.has('food_tags')}
              onToggle={toggleSection}
            />
          )}
          {(isMobile ? expandedSections.has('food_tags') : activeTab === 'food_tags') && (
            <section style={{ marginBottom: 4 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

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
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '10px 12px',
                      borderRadius: 8,
                      background: '#fff7ed',
                      border: '1px solid #fed7aa',
                      color: '#9a3412',
                      fontSize: 13,
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: '#f97316',
                        animation: 'pulse 1.4s ease-in-out infinite',
                        flexShrink: 0,
                      }}
                    />
                    <span>Enrichment in progress — AI is analysing this item to suggest tags. You'll be able to review and edit them in a few seconds.</span>
                  </div>
                )}
                {item.enrichment_status === 'failed' && (
                  <div
                    data-testid="edit-modal-enrichment-failed"
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      background: '#fef2f2',
                      border: '1px solid #fecaca',
                      color: '#991b1b',
                      fontSize: 13,
                    }}
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
                    style={{
                      padding: '8px 12px',
                      borderRadius: 6,
                      background: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      color: '#1e40af',
                      fontSize: 12,
                    }}
                  >
                    {enrichNotice}
                  </div>
                )}

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
                    borderColor: active ? '#9333ea' : 'var(--border)',
                    background: active ? '#f3e8ff' : 'transparent',
                    color: active ? '#6b21a8' : 'var(--text2)',
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
                  const WINE_COLORS = ['red', 'white', 'rosé', 'sparkling'];
                  const WINE_BODIES = ['light', 'medium', 'full'];
                  const WINE_STYLES = ['dry', 'off-dry', 'medium-sweet', 'sweet'];
                  const SWEETNESS_LEVELS = ['dry', 'off-dry', 'medium-sweet', 'sweet', 'dessert'];

                  return (
                    <div data-testid="edit-modal-beverage-profile">
                      <label style={labelStyle}>Beverage Profile</label>
                      <div
                        style={{
                          padding: 12,
                          borderRadius: 8,
                          background: '#faf5ff',
                          border: '1px solid #e9d5ff',
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
                              background: 'white',
                              border: '1px dashed #d8b4fe',
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
                                      borderColor: active ? '#9333ea' : 'var(--border)',
                                      background: active ? '#9333ea' : 'white',
                                      color: active ? 'white' : 'var(--text2)',
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
                                value={bevDraft.wine_color ?? ''}
                                onChange={(e) => updateBev('wine_color', e.target.value || null)}
                                placeholder="Select color"
                                options={[
                                  { value: '', label: 'Select color' },
                                  ...WINE_COLORS.map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) })),
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
                                  placeholder="$"
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
                                    borderColor: row.is_default ? '#9333ea' : 'var(--border)',
                                    background: row.is_default ? '#9333ea' : 'white',
                                    color: row.is_default ? 'white' : 'var(--text2)',
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
                                  style={{ padding: '6px 9px', borderRadius: 'var(--r-xs)', border: '1px solid var(--border)', background: 'white', color: 'var(--text2)', fontSize: 13, cursor: 'pointer' }}
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              data-testid="add-serving-option-btn"
                              onClick={addServingRow}
                              style={{ marginTop: 2, padding: '7px 12px', borderRadius: 'var(--r-xs)', border: '1px dashed var(--border)', background: 'white', color: 'var(--text2)', fontSize: 12, cursor: 'pointer' }}
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
                                  background: '#fef3c7',
                                  color: '#92400e',
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
                                    color: '#92400e',
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

                {/* Heat/Spice, Spice Modifier, BYO moved to the top card zone (STR-963 P3). */}

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
                          borderColor: sweetnessLabel === option ? '#db2777' : 'var(--border)',
                          background: sweetnessLabel === option ? '#fdf2f8' : 'transparent',
                          color: sweetnessLabel === option ? '#9d174d' : 'var(--text2)',
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

                {/* Dietary restrictions — multi-select pills, food_tags-backed.
                    Rendered ABOVE Allergens per STR-589 (cross-app parity with
                    the patron DietaryStep): dietary identity first, allergens
                    second. New items: same Set drives the deferred-creation
                    flow, the save handler flushes via setItemTags after the
                    DB row is created. */}
                {/* STR-963 P2: dishes show Dietary/Allergens in the left-rail
                    Dietary Info card; only add-ons (no rail) keep them here. */}
                {isAddon && dietaryTagService && restaurantId && (
                  <DietaryMultiSelect
                    label="Dietary Restrictions"
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
                )}

                {/* Allergens — same pattern (add-on-only per STR-963 P2). */}
                {isAddon && dietaryTagService && restaurantId && (
                  <DietaryMultiSelect
                    label="Allergens"
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
                )}

                {/* Tag fields — same set shown for dishes and add-ons.
                    The historical slim-down (hide these for add-ons because
                    modifiers "inherit from the parent dish") proved wrong
                    in practice: enrichment writes ingredients/textures/
                    taste_profile/etc. directly to addon menu_items, and
                    the dietary/allergen filter relies on those values being
                    visible + editable. Admin staff also need to review the
                    AI-suggested tags on addons. Per Avi 2026-05-19. */}
                {/* STR-963 P1 — Food Tags card grid. Emoji-titled cards,
                    2-col desktop / 1-col mobile; Ingredients + Taste span full
                    width. Scoped strictly to TAG_FIELDS (the beverage profile,
                    enrichment banner, and dessert sweetness siblings above are
                    untouched). tag-input-* / remove-tag-* testids unchanged. */}
                {/* Spice level — relocated from the top band (STR-977). Dish-only;
                    hidden for Beverages / Desserts / add-ons. N/A = no spice set. */}
                {!isAddon && category !== 'Beverages' && category !== 'Desserts' && (
                  <div style={{ ...EDITOR_CARD_STYLE, marginBottom: isMobile ? 10 : 12 }}>
                    <label htmlFor="heat-spice-select" style={labelStyle}>Spice level 🌶️</label>
                    <select
                      id="heat-spice-select"
                      data-testid="heat-spice-select"
                      value={heatSpice ?? ''}
                      onChange={(e) => setHeatSpice(e.target.value === '' ? null : e.target.value)}
                      style={{ ...inputStyle, cursor: 'pointer' }}
                    >
                      <option value="">N/A</option>
                      {activeHeatLabels.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div
                  data-testid="food-tags-card-grid"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                    gap: isMobile ? 10 : '12px 16px',
                  }}
                >
                  {TAG_FIELDS.map(({ key, label, placeholder, icon, full }) => (
                    <div
                      key={key}
                      style={{
                        ...EDITOR_CARD_STYLE,
                        gridColumn: full && !isMobile ? '1 / -1' : 'auto',
                      }}
                    >
                      <TagInput
                        fieldKey={key}
                        label={label}
                        icon={icon}
                        values={tags[key] ?? []}
                        placeholder={placeholder}
                        onChange={(vals) => setTags((prev) => ({ ...prev, [key]: vals }))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* ── Placements tab ────────────────────────────────────────────
              Per-placement editor: every menu this dish is published in
              renders a card with editable price / boost / chef's special
              / portion fields plus an unpublish action. Each field saves
              inline via service.updateMenuItemInMenu; removals call
              service.removeItemFromMenu. Local state mirrors the
              associations and rolls back on failure.

              `placementsOverlapSlot` is rendered above the placement
              cards when wired by the parent — owner-webapp surfaces the
              overlap comparison panel + rationale composer here so the
              cross-menu diff information lives next to the placements
              that produced it. Other consumers (waiter, admin) don't
              pass the slot and get the bare cards. */}
          {isMobile && !isAddon && !isNewItem && (
            <MobileAccordionHeader
              id="placements"
              title="Appears in / Placements"
              subtitle="Per-menu price & availability"
              open={expandedSections.has('placements')}
              onToggle={toggleSection}
            />
          )}
          {(isMobile ? expandedSections.has('placements') : activeTab === 'placements') && (
            <PlacementsTabPanel
              menus={menus}
              placementsDraft={placementsDraft}
              setPlacementsDraft={setPlacementsDraft}
              placementsSaving={placementsSaving}
              setPlacementSaving={setPlacementSaving}
              itemId={item.id}
              overlapSlot={placementsOverlapSlot}
              onUpdate={async (menuId, patch) => {
                await service.updateMenuItemInMenu(item.id, menuId, patch);
              }}
              onRemove={async (menuId) => {
                await service.removeItemFromMenu(item.id, menuId);
              }}
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
                    <div className="text-caption" style={{ color: '#b91c1c', background: '#fee2e2', borderRadius: 4, padding: '6px 10px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <AlertCircle size={14} /> {addonsError}
                    </div>
                  )}
                  {/* AI Suggestions — pending approval */}
                  {itemAddons.filter((a) => a.status === 'suggested').length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                      <div className="section-header" style={{ color: '#92400e', marginBottom: 8 }}>
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
                      <div className="text-caption" style={{ color: '#b91c1c', background: '#fee2e2', borderRadius: 4, padding: '6px 10px' }}>
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
                                background: '#fafafa',
                              }}
                            >
                              <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div title={poolItem.name} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {poolItem.name}
                                </div>
                                {poolItem.price != null && (
                                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>
                                    ${poolItem.price.toFixed(2)}
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
                                  background: poolItem.price != null && poolItem.price > 0 ? '#fff7ed' : '#f3f4f6',
                                  border: `1px solid ${poolItem.price != null && poolItem.price > 0 ? '#f59e0b' : '#d1d5db'}`,
                                  color: poolItem.price != null && poolItem.price > 0 ? '#92400e' : '#9ca3af',
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
                              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 'var(--r-xs)', border: '1px solid var(--border)', background: '#fafafa', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
                            >
                              <div style={{ width: 32, height: 32, borderRadius: 4, background: '#f0f0f0', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
                                {d.thumbnail_url ? (
                                  <img src={d.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : '🍽'}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div title={d.name} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {d.name}
                                </div>
                                {d.price != null && (
                                  <div className="text-caption">${Number(d.price).toFixed(2)}</div>
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
                <div className="text-caption" style={{ color: '#b91c1c', background: '#fee2e2', borderRadius: 4, padding: '6px 10px' }}>
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
                        <div className="section-header" style={{ color: '#92400e', marginBottom: 8 }}>
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

          {/* ── Groupings tab (BYO dishes — content provided by consumer) */}
          {isMobile && !isAddon && !isNewItem && groupingsSlot && (
            <MobileAccordionHeader
              id="groupings"
              title="Groupings"
              subtitle="Add-ons & recommendations"
              open={expandedSections.has('groupings')}
              onToggle={toggleSection}
            />
          )}
          {(isMobile ? expandedSections.has('groupings') : activeTab === 'groupings') && groupingsSlot && (
            <section style={{ marginBottom: 4 }}>
              {groupingsSlot}
            </section>
          )}

          {/* ── Dishes tab (shown when editing an addon item) ─────────── */}
          {isMobile && isAddon && (
            <MobileAccordionHeader
              id="dishes"
              title="Used by dishes"
              open={expandedSections.has('dishes')}
              onToggle={toggleSection}
            />
          )}
          {(isMobile ? expandedSections.has('dishes') : activeTab === 'dishes') && (
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
                                border: '1px solid var(--border)', background: '#fafafa',
                              }}
                            >
                              <div
                                style={{
                                  width: 32, height: 32, borderRadius: 4,
                                  background: '#f0f0f0', overflow: 'hidden',
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
                                  <div className="text-caption">${Number(dish.price).toFixed(2)}</div>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => void handleRemoveFromDish(dish)}
                                data-testid={`remove-dish-${dish.id}`}
                                style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', background: '#fee2e2', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 4, cursor: 'pointer', flexShrink: 0 }}
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
                                background: filtered.length > 0 && filtered.every((d) => selectedDishIds.has(d.id)) ? '#fef3c7' : '#f9fafb',
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
                                  background: '#fff7ed', border: '1px solid #f59e0b',
                                  color: '#92400e', borderRadius: 4, cursor: 'pointer',
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
                                      border: isSelected ? '1px solid #f59e0b' : '1px solid var(--border)',
                                      background: isSelected ? '#fffbeb' : '#fafafa',
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
                                      style={{ flexShrink: 0, cursor: 'pointer', accentColor: '#f59e0b' }}
                                    />
                                    <div
                                      style={{
                                        width: 32, height: 32, borderRadius: 4,
                                        background: '#f0f0f0', overflow: 'hidden',
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
                                        <div className="text-caption">${Number(dish.price).toFixed(2)}</div>
                                      )}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); void handleAddToDish(dish); }}
                                      data-testid={`add-to-dish-${dish.id}`}
                                      style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', background: '#fff7ed', border: '1px solid #f59e0b', color: '#92400e', borderRadius: 4, cursor: 'pointer', flexShrink: 0 }}
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

          {/* ── Performance tab ───────────────────────────────────────── */}
          {isMobile && !isNewItem && (
            <MobileAccordionHeader
              id="performance"
              title="Performance"
              subtitle="How this item is selling"
              open={expandedSections.has('performance')}
              onToggle={toggleSection}
            />
          )}
          {(isMobile ? expandedSections.has('performance') : activeTab === 'performance') && (
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
                <div className="text-caption" style={{ color: '#b91c1c', background: '#fee2e2', borderRadius: 4, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
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
          {/* Mobile (STR-858): destructive Delete relocated here — the very
              bottom of the scroll, behind the same 2-step confirm — so it is
              never a stray thumb-tap next to the everyday header controls. */}
          {isMobile && !isNewItem && !cloneMode && item.id && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 4 }}>
              {deleteConfirming ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>
                    Delete this item permanently?
                  </span>
                  {deleteError && (
                    <span style={{ fontSize: 12, color: '#b91c1c' }}>{deleteError}</span>
                  )}
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => { setDeleteConfirming(false); setDeleteError(null); }}
                      data-testid="delete-item-cancel"
                      disabled={deleteLoading}
                      style={{ flex: 1, minHeight: 44, fontSize: 13, fontWeight: 600, color: 'var(--text2)', background: '#f0f0f0', border: 'none', borderRadius: 'var(--r-xs)', cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      data-testid="delete-item-confirm"
                      disabled={deleteLoading}
                      style={{ flex: 1, minHeight: 44, fontSize: 13, fontWeight: 700, color: 'white', background: '#b91c1c', border: 'none', borderRadius: 'var(--r-xs)', cursor: deleteLoading ? 'not-allowed' : 'pointer', opacity: deleteLoading ? 0.7 : 1 }}
                    >
                      {deleteLoading ? 'Deleting…' : 'Delete permanently'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setDeleteConfirming(true)}
                  disabled={saving}
                  data-testid="delete-item-btn"
                  style={{ width: '100%', minHeight: 44, fontSize: 13, fontWeight: 600, color: '#b91c1c', background: 'none', border: '1px solid #fca5a5', borderRadius: 'var(--r-xs)', cursor: 'pointer' }}
                >
                  Delete item
                </button>
              )}
            </div>
          )}
          </div>{/* end scrollable tab content */}
          </>)}{/* end gallery / tabs branch */}
          </div>{/* end tabs section wrapper */}
          </div>{/* end layout container */}
        </div>

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
        border: isAI ? '1px solid #f59e0b' : '1px solid var(--border)',
        background: isAI ? '#fffbeb' : '#fafafa',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div title={rec.name} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {rec.name}
          </div>
          {isAI && (
            <span style={{ fontSize: 9, fontWeight: 700, background: '#fef3c7', color: '#92400e', border: '1px solid #f59e0b', borderRadius: 4, padding: '1px 4px', flexShrink: 0 }}>
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
            style={{ fontSize: 11, fontWeight: 700, padding: '4px 8px', background: '#dcfce7', border: '1px solid #86efac', color: '#15803d', borderRadius: 4, cursor: 'pointer' }}
          >
            Accept
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          data-testid={`remove-rec-modal-${rec.menu_item_id}`}
          style={{ fontSize: 11, fontWeight: 600, padding: '4px 8px', background: '#fee2e2', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 4, cursor: 'pointer' }}
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
        border: addon.status === 'suggested' ? '1px solid #f59e0b' : '1px solid var(--border)',
        background: addon.status === 'suggested' ? '#fffbeb' : '#fafafa',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div title={addon.name} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {addon.name}
          </div>
          {addon.status === 'suggested' && (
            <span style={{ fontSize: 9, fontWeight: 700, background: '#fef3c7', color: '#92400e', border: '1px solid #f59e0b', borderRadius: 4, padding: '1px 4px', flexShrink: 0 }}>
              AI
            </span>
          )}
          {!isSuggested && (
            <div
              style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}
              data-testid={`addon-price-${addon.menu_item_id}`}
            >
              {basePrice != null ? `$${basePrice.toFixed(2)}` : ''}
            </div>
          )}
        </div>
        {isSuggested && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>Price:</span>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <span style={{ position: 'absolute', left: 6, fontSize: 11, color: 'var(--text-secondary)', pointerEvents: 'none' }}>$</span>
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
                  background: '#fff',
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
              background: priceValid ? '#dcfce7' : '#f3f4f6',
              border: `1px solid ${priceValid ? '#86efac' : '#d1d5db'}`,
              color: priceValid ? '#15803d' : '#9ca3af',
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
          style={{ fontSize: 11, fontWeight: 600, padding: '4px 8px', background: '#fee2e2', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 4, cursor: 'pointer' }}
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
        ...(highlight ? { background: '#fff7ed', border: '1px solid #fed7aa' } : {}),
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="section-header">{children}</div>;
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text2)',
  display: 'block',
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  fontSize: 16,
  color: 'var(--text)',
  background: 'white',
  border: '1px solid var(--border)',
  borderRadius: 'var(--r-xs)',
  padding: '7px 10px',
  outline: 'none',
  boxSizing: 'border-box',
};

// STR-963 — single source of truth for the editor's card container so every
// tab (Food Tags · Placements · Performance) reads as one design system:
// white surface, 1px hairline border, radius 8, 14px padding.
const EDITOR_CARD_STYLE: React.CSSProperties = {
  background: '#fff',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 14,
};

function imgActionStyle(variant?: 'blue' | 'red'): React.CSSProperties {
  const colors =
    variant === 'blue'
      ? { bg: 'var(--blue-bg)', border: 'var(--blue)', color: 'var(--blue)' }
      : variant === 'red'
        ? { bg: '#fee2e2', border: '#fca5a5', color: '#b91c1c' }
        : { bg: '#f6f6f6', border: 'var(--border)', color: 'var(--text2)' };
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 11,
    fontWeight: 600,
    padding: '5px 10px',
    borderRadius: 4,
    border: `1px solid ${colors.border}`,
    background: colors.bg,
    color: colors.color,
    cursor: 'pointer',
  };
}

// ── Placements tab ────────────────────────────────────────────────────────────
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

interface PlacementsTabPanelProps {
  menus?: MenuSummary[];
  placementsDraft: MenuAssociation[];
  setPlacementsDraft: React.Dispatch<React.SetStateAction<MenuAssociation[]>>;
  placementsSaving: Set<string>;
  setPlacementSaving: (menuId: string, on: boolean) => void;
  itemId: string;
  /** Optional overlap surface rendered above the placement cards.
   *  Owner-webapp wires this with the cross-menu comparison panel +
   *  rationale composer; other consumers leave it undefined and get
   *  just the cards. */
  overlapSlot?: ReactNode;
  onUpdate: (menuId: string, patch: Partial<MenuItemJunctionSettings>) => Promise<void>;
  onRemove: (menuId: string) => Promise<void>;
}

function PlacementsTabPanel({
  menus: _menus,
  placementsDraft,
  setPlacementsDraft,
  placementsSaving,
  setPlacementSaving,
  itemId,
  overlapSlot,
  onUpdate,
  onRemove,
}: PlacementsTabPanelProps) {
  // Apply `patch` optimistically to the draft, call onUpdate, roll back on
  // failure. `patch` keys mirror MenuItemJunctionSettings; we cast it onto
  // MenuAssociation for the local mirror — the assoc accepts the same
  // shapes (price/boost_level/chefs_special/portion_*).
  const persist = useCallback(
    async (menuId: string, patch: Partial<MenuItemJunctionSettings>) => {
      if (placementsSaving.has(menuId)) return;
      const before = placementsDraft;
      setPlacementsDraft((prev) => prev.map((a) =>
        a.menu_id === menuId ? { ...a, ...patch } as MenuAssociation : a,
      ));
      setPlacementSaving(menuId, true);
      try {
        await onUpdate(menuId, patch);
      } catch (err) {
        console.error(`Failed to update menu placement ${menuId} for ${itemId}`, err);
        setPlacementsDraft(before);
      } finally {
        setPlacementSaving(menuId, false);
      }
    },
    [placementsDraft, placementsSaving, setPlacementsDraft, setPlacementSaving, onUpdate, itemId],
  );

  const unpublish = useCallback(
    async (menuId: string) => {
      if (placementsSaving.has(menuId)) return;
      const before = placementsDraft;
      setPlacementsDraft((prev) => prev.filter((a) => a.menu_id !== menuId));
      setPlacementSaving(menuId, true);
      try {
        await onRemove(menuId);
      } catch (err) {
        console.error(`Failed to unpublish ${itemId} from menu ${menuId}`, err);
        setPlacementsDraft(before);
      } finally {
        setPlacementSaving(menuId, false);
      }
    },
    [placementsDraft, placementsSaving, setPlacementsDraft, setPlacementSaving, onRemove, itemId],
  );

  if (placementsDraft.length === 0) {
    return (
      <section data-testid="placements-tab-empty" style={{ marginBottom: 4 }}>
        {overlapSlot}
        <div
          style={{
            padding: '24px 16px',
            textAlign: 'center',
            color: 'var(--text2)',
            fontSize: 13,
            border: '1px dashed var(--border)',
            borderRadius: 8,
            background: '#fafafa',
          }}
        >
          This item is not published on any menu yet.
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text3)' }}>
            Add it to a menu from the Menu Builder.
          </div>
        </div>
      </section>
    );
  }

  return (
    <section data-testid="placements-tab" style={{ marginBottom: 4 }}>
      {overlapSlot}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {placementsDraft.map((assoc) => (
          <MenuPlacementCard
            key={assoc.menu_id}
            assoc={assoc}
            saving={placementsSaving.has(assoc.menu_id)}
            onChange={(patch) => void persist(assoc.menu_id, patch)}
            onRemove={() => void unpublish(assoc.menu_id)}
          />
        ))}
      </div>
    </section>
  );
}

interface MenuPlacementCardProps {
  assoc: MenuAssociation;
  saving: boolean;
  onChange: (patch: Partial<MenuItemJunctionSettings>) => void;
  onRemove: () => void;
}

function MenuPlacementCard({ assoc, saving, onChange, onRemove }: MenuPlacementCardProps) {
  // Price + portion_serves use uncontrolled-ish state — local string buffer
  // so the owner can clear the field mid-typing without the parent dropping
  // the value. We commit on blur (or Enter). Selects/toggles commit on
  // every change since their value space is small.
  const [priceText, setPriceText] = useState<string>(
    assoc.price == null ? '' : String(assoc.price),
  );
  useEffect(() => {
    setPriceText(assoc.price == null ? '' : String(assoc.price));
  }, [assoc.price]);

  const [servesText, setServesText] = useState<string>(
    assoc.portion_serves == null ? '' : String(assoc.portion_serves),
  );
  useEffect(() => {
    setServesText(assoc.portion_serves == null ? '' : String(assoc.portion_serves));
  }, [assoc.portion_serves]);

  const commitPrice = () => {
    const trimmed = priceText.trim();
    const nextPrice: number | null = trimmed === '' ? null : Number(trimmed);
    if (nextPrice !== null && !Number.isFinite(nextPrice)) {
      // Invalid input — snap back to the saved value.
      setPriceText(assoc.price == null ? '' : String(assoc.price));
      return;
    }
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

  const currentBoost = boostLevelToLabel(assoc.boost_level);
  const portionType: 'single' | 'shared' = assoc.portion_type ?? 'single';

  return (
    <div
      data-testid={`placements-tab-row-${assoc.menu_id}`}
      style={{
        ...EDITOR_CARD_STYLE,
        opacity: saving ? 0.7 : 1,
        transition: 'opacity 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {assoc.menu_name}
          </div>
          {assoc.category_name && (
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              {assoc.category_name}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={saving}
          data-testid={`placements-tab-remove-${assoc.menu_id}`}
          aria-label={`Remove from ${assoc.menu_name}`}
          title="Remove from this menu"
          style={{
            ...imgActionStyle('red'),
            cursor: saving ? 'wait' : 'pointer',
          }}
        >
          <Trash2 size={12} aria-hidden />
          Remove
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label style={labelStyle} htmlFor={`menus-price-${assoc.menu_id}`}>Price</label>
          <input
            id={`menus-price-${assoc.menu_id}`}
            data-testid={`placements-tab-price-${assoc.menu_id}`}
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={priceText}
            disabled={saving}
            onChange={(e) => setPriceText(e.target.value)}
            onBlur={commitPrice}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle} htmlFor={`menus-boost-${assoc.menu_id}`}>Boost level</label>
          <select
            id={`menus-boost-${assoc.menu_id}`}
            data-testid={`placements-tab-boost-${assoc.menu_id}`}
            value={currentBoost ?? ''}
            disabled={saving}
            onChange={(e) => {
              const nextLabel = (e.target.value || null) as BoostLabel | null;
              onChange({ boost_level: labelToBoostLevel(nextLabel) });
            }}
            style={inputStyle}
          >
            <option value="">None</option>
            {BOOST_LABELS.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={labelStyle} htmlFor={`menus-portion-type-${assoc.menu_id}`}>Portion</label>
          <select
            id={`menus-portion-type-${assoc.menu_id}`}
            data-testid={`placements-tab-portion-type-${assoc.menu_id}`}
            value={portionType}
            disabled={saving}
            onChange={(e) => {
              const next = e.target.value as 'single' | 'shared';
              // Switching to single clears serves; switching to shared
              // leaves the current serves value (or null) — owner sets it
              // explicitly in the adjacent field.
              if (next === 'single') {
                onChange({ portion_type: 'single', portion_serves: null });
              } else {
                onChange({ portion_type: 'shared' });
              }
            }}
            style={inputStyle}
          >
            <option value="single">Serves one</option>
            <option value="shared">Shared</option>
          </select>
        </div>
        {portionType === 'shared' && (
          <div>
            <label style={labelStyle} htmlFor={`menus-portion-serves-${assoc.menu_id}`}>Serves how many</label>
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
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              style={inputStyle}
            />
          </div>
        )}
      </div>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 12,
          fontSize: 13,
          color: 'var(--text)',
          cursor: saving ? 'wait' : 'pointer',
          userSelect: 'none',
        }}
      >
        <input
          type="checkbox"
          data-testid={`placements-tab-chefs-special-${assoc.menu_id}`}
          checked={!!assoc.chefs_special}
          disabled={saving}
          onChange={(e) => onChange({ chefs_special: e.target.checked })}
          style={{ cursor: saving ? 'wait' : 'pointer' }}
        />
        Chef&apos;s special
      </label>
    </div>
  );
}

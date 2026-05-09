'use client';
import { useMenuManagerService } from '../context';
import { useTrackAction } from '../track-action-context';

import { useRef, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { X, Upload, Camera, Trash2, Eye, EyeOff, AlertCircle, ScanEye, Pencil } from 'lucide-react';
import { FoodItemPreviewModal } from '../../preview/FoodItemPreviewModal';
import type {MenuItemDisplay, MenuSummary, FoodTags, AddonEntry, RecommendationEntry, MenuItemPerformancePeriod, MenuItemPerformanceResponse} from '../../../types/restaurant';
import { FOOD_TAG_FIELD_MAP, CANONICAL_CATEGORIES, toCanonical } from '../lib/menuUtils';
import { DEFAULT_HEAT_LABELS, DEFAULT_SWEETNESS_LABELS } from '../../../constants/food-tags';
import Select from '../../common/Select';
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
  onClose: () => void;
  /** Called with the fully merged updated item after save, or with _deleted: true after delete */
  onComplete: (updated: MenuItemDisplay & { _deleted?: boolean }) => void;
  /** Called when user clicks a menu chip — close modal and navigate to that menu+item */
  onNavigateToMenu?: (menuId: string, itemId: string) => void;
  /** True when the modal was opened via "Add Item" — shows the Dishes/Add-ons type toggle. Hidden in edit mode. */
  isNewItem?: boolean;
  /** When true, forces addon mode and hides the Dish/Add-on toggle (used when creating addons from the Setup Guide). */
  forceAddon?: boolean;
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
   * responsible for the BYO predicate (only pass a slot for BYO dishes).
   * Reason: the grouping authoring API lives in the consumer app's service
   * layer, not in this shared package.
   */
  groupingsSlot?: ReactNode;
  /**
   * When true, render in Build-Your-Own mode: the right-side tab bar is
   * restricted to ['food_tags', 'groupings'] (no Add-ons, Recommendations,
   * or Performance), the Dishes/Add-ons type toggle is hidden, and a small
   * "Build-your-own" badge is shown next to the name. Everything else
   * (image box, description, mapped course, save/delete chrome) is identical
   * to a regular dish so the two interfaces share the same skeleton.
   * Consumers are still expected to pass `groupingsSlot` for the Groupings
   * tab content — without it the tab is rendered empty.
   */
  byoMode?: boolean;
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
}

// ── Food tag fields shown in the editor (heat_spice, allergens, dietary handled separately) ──

const TAG_FIELDS: { key: keyof FoodTags; label: string; placeholder: string }[] = [
  { key: 'ingredients',    label: 'Ingredients',    placeholder: 'e.g. chicken, lemon…' },
  { key: 'cooking_method', label: 'Cooking method',  placeholder: 'e.g. grilled, fried…' },
  { key: 'textures',       label: 'Texture',          placeholder: 'e.g. crispy, creamy…' },
  { key: 'taste_profile',  label: 'Taste profile',   placeholder: 'e.g. savoury, smoky…' },
  { key: 'seasons',        label: 'Seasonal',         placeholder: 'e.g. summer, winter…' },
  { key: 'festivity',      label: 'Festivities',      placeholder: 'e.g. Christmas, Diwali…' },
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
}: {
  label: string;
  values: string[];
  placeholder: string;
  onChange: (newValues: string[]) => void;
  fieldKey: string;
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
      <label className="section-header" style={{ display: 'block', marginBottom: 4 }}>
        {label}
      </label>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          minHeight: 36,
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-xs)',
          padding: '4px 8px',
          background: 'white',
          alignItems: 'center',
        }}
      >
        {values.map((v) => (
          <span
            key={v}
            className="text-xs font-medium"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              background: '#f0f0f0',
              color: 'var(--text)',
              borderRadius: 4,
              padding: '2px 6px',
            }}
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((t) => t !== v))}
              data-testid={`remove-tag-${fieldKey}-${v}`}
              className="text-xs"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                lineHeight: 1,
                color: 'var(--text2)',
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
          placeholder={values.length === 0 ? placeholder : ''}
          data-testid={`tag-input-${fieldKey}`}
          style={{
            border: 'none',
            outline: 'none',
            fontSize: 16,
            flex: 1,
            minWidth: 80,
            background: 'transparent',
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

// ── EditModal ─────────────────────────────────────────────────────────────────

export default function EditModal({ item, restaurantId, menus, allItems, onClose, onComplete, onNavigateToMenu, onDishAddonsChange, isNewItem = false, forceAddon = false, forceDish = false, preselectedDishIds, onSaveNewItem, dietaryTagService, customAllergens, customDietary, heatLabels, sweetnessLabels, onSweetnessUpdate, onHeatSpiceUpdate, imageLibrarySlot, galleryPanelSlot, groupingsSlot, byoMode = false, displayMode = 'modal', onItemUpdate }: EditModalProps) {
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
  // Prefer the AI-pipeline canonical_category (already one of CANONICAL_CATEGORIES),
  // fall back to mapping the raw category string, then to empty.
  const [category, setCategory]     = useState(
    item.canonical_category ?? toCanonical(item.category) ?? '',
  );
  // Price is only editable in Add-on mode (dishes price per-menu in MenuBuilder).
  // STR-303: add-ons are ingredient-level surcharges with a single base price.
  const [price, setPrice]           = useState<number | null>(item.price ?? null);
  const [priceError, setPriceError] = useState<string | null>(null);
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
    const extras = (customAllergens ?? []).filter((s) => typeof s === 'string' && s.length > 0);
    if (extras.length === 0) return [...FDA_BIG_9_ALLERGENS];
    return Array.from(new Set([...FDA_BIG_9_ALLERGENS, ...extras]));
  }, [customAllergens]);
  const dietaryOptions = useMemo<string[]>(() => {
    const extras = (customDietary ?? []).filter((s) => typeof s === 'string' && s.length > 0);
    if (extras.length === 0) return [...DIETARY_RESTRICTIONS_LIST];
    return Array.from(new Set([...DIETARY_RESTRICTIONS_LIST, ...extras]));
  }, [customDietary]);
  const allergenLabelsMerged = useMemo<Record<string, string>>(() => ({
    ...ALLERGEN_LABELS,
    ...Object.fromEntries((customAllergens ?? []).map((s) => [s, ALLERGEN_LABELS[s] ?? slugToLabel(s)])),
  }), [customAllergens]);
  const dietaryLabelsMerged = useMemo<Record<string, string>>(() => ({
    ...DIETARY_LABELS,
    ...Object.fromEntries((customDietary ?? []).map((s) => [s, DIETARY_LABELS[s] ?? slugToLabel(s)])),
  }), [customDietary]);

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
  const [isAddon, setIsAddon]       = useState(forceAddon || item.item_type === 'addon');
  // True when the addon has no DB row yet — dish associations must be deferred until save.
  const isDeferredCreation = isNewItem && !!onSaveNewItem;
  // Confirmation state for dish→addon toggle when item has menu associations
  const [addonConfirmPending, setAddonConfirmPending] = useState(false);

  // Add-on toggle is disabled when the item already carries sides or recommendations
  // (those belong to dishes only). Computed once so the header toggle and the
  // body checkbox share identical disabled state and messaging.
  const hasSides      = (item.sides?.length ?? 0) > 0;
  const hasRecs       = (item.recommendations?.length ?? 0) > 0;
  const addonDisabled = hasSides || hasRecs;
  const disabledReason = hasSides && hasRecs
    ? 'Items with sides and recommendations cannot be Add-ons'
    : hasSides
      ? 'Items with sides cannot be Add-ons'
      : hasRecs
        ? 'Items with recommendations cannot be Add-ons'
        : null;

  // Save state
  const [saving, setSaving]         = useState(false);
  const [saveError, setSaveError]   = useState<string | null>(null);
  const [nameError, setNameError]       = useState(false);
  const [descError, setDescError]       = useState(false);
  const [categoryError, setCategoryError] = useState(false);

  // Delete state
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deleteLoading, setDeleteLoading]       = useState(false);
  const [deleteError, setDeleteError]           = useState<string | null>(null);

  // Tab state — Food Tags | Add-ons | Recommendations | Groupings (BYO only) | Performance (dish items) or Performance | Dishes (addon items)
  const [activeTab, setActiveTab] = useState<'food_tags' | 'addons' | 'recommendations' | 'groupings' | 'dishes' | 'performance'>('food_tags');

  // When the Dishes/Add-ons toggle flips, the available tab set changes.
  //   Dishes  → [food_tags, addons, performance, ...]
  //   Add-ons → [food_tags, performance, dishes]   (food_tags shows
  //               only allergens + dietary for add-ons — see the Food
  //               Tags section render path)
  // Land on a valid tab for the new mode. Existing add-ons default to
  // 'performance' (analytics-first); new add-ons default to 'dishes'
  // (link-to-parent picker first). Users can click into Food Tags for
  // allergen / dietary capture. Dep list is [isAddon] only — including
  // activeTab would loop.
  useEffect(() => {
    setActiveTab(isAddon ? (isNewItem ? 'dishes' : 'performance') : 'food_tags');
  }, [isAddon, isNewItem]);

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
        if (addon.id) {
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

  // ── Save ────────────────────────────────────────────────────────────────

  async function handleSave() {
    let hasError = false;
    if (!name.trim()) { setNameError(true); hasError = true; }
    if (!isAddon && !description.trim()) { setDescError(true); hasError = true; }
    if (!isAddon && !category) { setCategoryError(true); hasError = true; }
    // Add-on price validation: required when creating a new add-on; optional when editing.
    // Upper bound 10,000 is a sanity cap — surcharges larger than that are a data-entry error.
    if (isAddon) {
      if (isNewItem && price === null) {
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
    setCategoryError(false);
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

    try {
      // ── Deferred-creation path ─────────────────────────────────────────────
      // When onSaveNewItem is provided the item has no DB row yet (draft only in
      // local state). Create it now with the completed form data instead of calling
      // updateMenuItem on a non-existent ID.
      if (isNewItem && onSaveNewItem) {
        const created = await onSaveNewItem({
          name: name.trim(),
          description: description.trim(),
          category: category.trim(),
          food_tags: foodTags,
          item_type: isAddon ? 'addon' : 'dish',
          ...(isAddon && price !== null ? { price } : {}),
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
      // The dropdown edits canonical_category only — the raw scraped `category`
      // field is preserved untouched so the kitchen's original menu label stays
      // intact.
      const updates: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim(),
        canonical_category: category.trim() || undefined,
        food_tags: foodTags,
        item_type: isAddon ? 'addon' : 'dish',
        // STR-303: add-on mode is the sole per-item price surface in this modal.
        // Dishes continue to price per-menu in MenuBuilder — do not send price for them.
        ...(isAddon ? { price } : {}),
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
      const updated: MenuItemDisplay = {
        ...item,
        name: saved.name ?? name.trim(),
        description: (saved.description ?? description.trim()) || null,
        category: (saved as { category?: string }).category ?? item.category,
        canonical_category: category.trim() || item.canonical_category,
        food_tags: mergedFoodTags,
        active: isActive,
        thumbnail_url: thumbnail,
        item_type: isAddon ? 'addon' : 'dish',
        price: isAddon ? price : (saved.price ?? item.price),
        addons: itemAddons,
        recommendations: itemRecs,
        // Clear menu associations in local state when converted to addon
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
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              ref={nameInputRef}
              id="edit-name"
              type="text"
              value={name}
              placeholder={isAddon
                ? (isNewItem ? (item.name || 'Add-on name, e.g. Extra Chicken, Sub Beef') : 'Add-on name')
                : (isNewItem ? (item.name || 'Item name') : 'Item name')}
              onChange={(e) => { setName(e.target.value); setNameError(false); }}
              aria-label="Item name"
              aria-required="true"
              aria-invalid={nameError || undefined}
              data-testid="edit-name-input"
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: 'var(--text)',
                background: 'transparent',
                border: nameError ? '1px solid #b91c1c' : '1px solid transparent',
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
                if (!nameError) e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.background = '#fff';
              }}
              onBlur={(e) => {
                if (!nameError) e.currentTarget.style.borderColor = 'transparent';
                e.currentTarget.style.background = 'transparent';
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
                width: 28,
                height: 28,
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

          {/* Build-your-own indicator — small chip next to the name so the
              owner knows they're editing a BYO dish even though the rest of
              the chrome is identical to a Dish editor. */}
          {byoMode && (
            <span
              data-testid="byo-mode-badge"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 10px',
                fontSize: 10,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--orange-text, #c2410c)',
                background: 'var(--orange-bg, #fff4ee)',
                border: '1px solid #ffd5b8',
                borderRadius: 999,
                flexShrink: 0,
              }}
            >
              Build-your-own
            </span>
          )}

          {/* Dishes / Add-ons pill toggle — only shown when creating a new item
              (hidden when forceAddon, forceDish, or byoMode) */}
          {isNewItem && !forceAddon && !forceDish && !byoMode && (
            <div
              role="radiogroup"
              aria-label="Item type"
              data-testid="type-toggle"
              style={{
                display: 'inline-flex',
                alignItems: 'stretch',
                border: '1px solid var(--border)',
                borderRadius: 999,
                padding: 2,
                background: '#fafafa',
                flexShrink: 0,
              }}
            >
              <button
                type="button"
                role="radio"
                aria-checked={!isAddon}
                onClick={() => setIsAddon(false)}
                data-testid="type-toggle-dishes"
                style={{
                  padding: '4px 14px',
                  fontSize: 12,
                  fontWeight: !isAddon ? 700 : 500,
                  color: !isAddon ? 'white' : 'var(--text2)',
                  background: !isAddon ? 'var(--brand, #f97316)' : 'transparent',
                  border: 'none',
                  borderRadius: 999,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                Dishes
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={isAddon}
                aria-disabled={addonDisabled}
                onClick={() => {
                  if (addonDisabled) return;
                  const menuAssocs = item.menu_associations?.filter(
                    (a) => 'menu_id' in a && a.menu_id,
                  ) ?? [];
                  if (menuAssocs.length > 0 && item.item_type !== 'addon') {
                    setAddonConfirmPending(true);
                  } else {
                    setIsAddon(true);
                  }
                }}
                disabled={addonDisabled}
                title={addonDisabled ? (disabledReason ?? undefined) : undefined}
                data-testid="type-toggle-addons"
                style={{
                  padding: '4px 14px',
                  fontSize: 12,
                  fontWeight: isAddon ? 700 : 500,
                  color: isAddon ? 'white' : 'var(--text2)',
                  background: isAddon ? 'var(--brand, #f97316)' : 'transparent',
                  border: 'none',
                  borderRadius: 999,
                  cursor: addonDisabled ? 'not-allowed' : 'pointer',
                  opacity: addonDisabled ? 0.5 : 1,
                  transition: 'all 0.15s',
                }}
              >
                Add-ons
              </button>
            </div>
          )}

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
              fontSize: 11, fontWeight: 600, padding: '4px 10px',
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

          {/* Divider */}
          <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />

          {/* Delete / confirmation */}
          {deleteConfirming ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                Delete permanently?
              </span>
              <button
                type="button"
                onClick={() => { setDeleteConfirming(false); setDeleteError(null); }}
                data-testid="delete-item-cancel"
                disabled={deleteLoading}
                style={{ padding: '5px 10px', fontSize: 12, fontWeight: 600, color: 'var(--text2)', background: '#f0f0f0', border: 'none', borderRadius: 'var(--r-xs)', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                data-testid="delete-item-confirm"
                disabled={deleteLoading}
                style={{ padding: '5px 10px', fontSize: 12, fontWeight: 700, color: 'white', background: '#b91c1c', border: 'none', borderRadius: 'var(--r-xs)', cursor: deleteLoading ? 'not-allowed' : 'pointer', opacity: deleteLoading ? 0.7 : 1 }}
              >
                {deleteLoading ? 'Deleting…' : 'Confirm'}
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setDeleteConfirming(true)}
                disabled={saving}
                data-testid="delete-item-btn"
                style={{ fontSize: 12, fontWeight: 600, color: '#b91c1c', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                Delete
              </button>
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
                  padding: '6px 14px',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.7 : 1,
                  whiteSpace: 'nowrap', flexShrink: 0,
                }}
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
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
              display: 'flex', alignItems: 'center', flexShrink: 0,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body — flex column: fixed top (banners + basic info + tabs) + scrollable tab content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: '20px', paddingBottom: 0 }}>

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
          {deleteError && (
            <div
              className="text-caption"
              style={{ color: '#b91c1c', background: '#fee2e2', borderRadius: 4, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}
            >
              <AlertCircle size={12} />
              {deleteError}
            </div>
          )}

          {/* Addon toggle confirmation — shown when a dish with menu placements is being converted to an add-on */}
          {addonConfirmPending && (
            <div
              data-testid="addon-confirm-banner"
              style={{
                fontSize: 12,
                color: '#92400e',
                background: '#fef3c7',
                border: '1px solid #fcd34d',
                borderRadius: 6,
                padding: '10px 14px',
                marginBottom: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  Changing this item to an add-on will <strong>remove it from{' '}
                  {(item.menu_associations?.length ?? 0) === 1
                    ? item.menu_associations![0].menu_name
                    : `${item.menu_associations?.length} menus`}
                  </strong> as a menu item. Its add-on associations with other dishes will be kept.
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setAddonConfirmPending(false)}
                  data-testid="addon-confirm-cancel"
                  style={{ padding: '4px 12px', fontSize: 12, fontWeight: 600, color: 'var(--text2)', background: 'white', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => { setAddonConfirmPending(false); setIsAddon(true); }}
                  data-testid="addon-confirm-proceed"
                  style={{ padding: '4px 12px', fontSize: 12, fontWeight: 700, color: 'white', background: '#d97706', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                >
                  Convert to Add-on
                </button>
              </div>
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
              ...(!isAddon && !isMobile
                ? {
                    display: 'grid',
                    gridTemplateColumns: '280px 1fr',
                    columnGap: 20,
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
              ...(!isMobile ? { overflowY: 'auto', paddingRight: 4, paddingBottom: 4 } : { marginBottom: 20 }),
            }}
          >

            {/* Image panel — image + buttons + warnings */}
            <div
              data-testid="item-image-panel"
              style={{
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <SectionLabel>Item Image</SectionLabel>
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
                doesn't shift when the user blanks the field. */}
            {nameError && (
              <div className="text-caption" data-testid="edit-name-error" style={{ color: '#b91c1c' }}>
                Name is required
              </div>
            )}

            {/* Description — sits right under the image so the owner
                can scan the dish then immediately confirm/edit copy. */}
            <div>
              <label style={labelStyle} htmlFor="edit-description">
                Description <span style={{ color: '#b91c1c' }}>*</span>
              </label>
              <textarea
                id="edit-description"
                value={description}
                onChange={(e) => { setDesc(e.target.value); setDescError(false); }}
                rows={4}
                data-testid="edit-description-input"
                style={{
                  ...inputStyle,
                  resize: 'vertical',
                  minHeight: 88,
                  border: descError ? '1px solid #b91c1c' : '1px solid var(--border)',
                }}
              />
              {descError && (
                <div className="text-caption" style={{ color: '#b91c1c', marginTop: 3 }}>Description is required</div>
              )}
            </div>

            {/* Mapped Course — edits canonical_category; raw scraped `category` is preserved. */}
            <div>
              <label style={labelStyle} htmlFor="edit-category">
                Mapped Course <span style={{ color: '#b91c1c' }}>*</span>
              </label>
              <Select
                id="edit-category"
                value={category}
                onChange={(e) => { setCategory(e.target.value); setCategoryError(false); }}
                data-testid="edit-category-select"
                options={CANONICAL_CATEGORIES.map((c) => ({ value: c, label: c }))}
                placeholder="— Select course —"
                error={categoryError}
              />
              {categoryError && (
                <span style={{ fontSize: 10, color: '#b91c1c' }}>Mapped course is required</span>
              )}
            </div>

            {/* ── Appears in menus ──────────────────────────────── */}
            {(item.menu_associations ?? []).length > 0 && (
              <div>
                <SectionLabel>Appears in</SectionLabel>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(item.menu_associations ?? []).map((assoc) => {
                      const canNavigate = !!onNavigateToMenu;
                      return (
                        <button
                          key={assoc.menu_id}
                          type="button"
                          data-testid={`appears-in-menu-${assoc.menu_id}`}
                          disabled={!canNavigate}
                          onClick={() => {
                            trackAction('menu.editModal.navigateToMenu', {
                              restaurantId,
                              metadata: { itemId: item.id, menuId: assoc.menu_id },
                            });
                            onNavigateToMenu?.(assoc.menu_id, item.id);
                          }}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '4px 12px',
                            borderRadius: 20,
                            fontSize: 12,
                            fontWeight: 500,
                            border: '1px solid var(--border)',
                            background: canNavigate ? 'var(--white)' : '#f9f9f9',
                            color: canNavigate ? 'var(--text2)' : 'var(--text3)',
                            cursor: canNavigate ? 'pointer' : 'default',
                            transition: 'background 0.1s, color 0.1s',
                          }}
                          onMouseEnter={(e) => {
                            if (canNavigate) {
                              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,107,43,0.08)';
                              (e.currentTarget as HTMLButtonElement).style.color = 'var(--brand-s)';
                              (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--brand-s)';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (canNavigate) {
                              (e.currentTarget as HTMLButtonElement).style.background = 'var(--white)';
                              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text2)';
                              (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
                            }
                          }}
                        >
                          {assoc.menu_name}
                        </button>
                      );
                    })}
                </div>
              </div>
            )}
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

            {/* Price */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ flex: '0 0 160px' }}>
                <label style={labelStyle} htmlFor="edit-price-input">
                  Price{isNewItem && isAddon && <span style={{ color: '#b91c1c', marginLeft: 2 }}>*</span>}
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
                  {price !== null && !(isNewItem && isAddon) && (
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
              flex: 1,
            }}
          >
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
              display: 'flex',
              alignItems: 'flex-end',
              gap: 0,
              borderBottom: '1px solid var(--border)',
              flexShrink: 0,
            }}
          >
            {(byoMode
              ? (['food_tags', 'groupings'] as const)
              : (isAddon
                // Add-ons get a slimmed-down Food Tags tab (allergens +
                // dietary only — heat/spice and free-text fields are
                // suppressed inside the section). Modifiers / sides
                // / sauces still need allergen + dietary capture so the
                // diner-side recommender + filter UI honours per-addon
                // restrictions.
                ? (isNewItem
                  ? (['food_tags', 'dishes'] as const)
                  : (['food_tags', 'performance', 'dishes'] as const))
                : (isNewItem
                  ? (['food_tags', 'addons', 'recommendations'] as const)
                  : (groupingsSlot
                    ? (['food_tags', 'addons', 'recommendations', 'groupings', 'performance'] as const)
                    : (['food_tags', 'addons', 'recommendations', 'performance'] as const))))
            ).map((tab) => {
              const isActive = activeTab === tab;
              const label =
                tab === 'food_tags'
                  ? 'Food Tags'
                  : tab === 'addons'
                    ? `Add-ons${itemAddons.length > 0 ? ` (${itemAddons.length})` : ''}`
                    : tab === 'recommendations'
                      ? `Recommendations${(aiSugs.length + itemRecs.length) > 0 ? ` (${aiSugs.length + itemRecs.length})` : ''}`
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
                  data-testid={`tab-${tab}`}
                  style={{
                    padding: '12px 14px',
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
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingTop: 16, paddingBottom: 20 }}>

          {/* ── Food Tags tab ──
              For dishes: full set of fields (heat/spice, sweetness,
              allergens, dietary, free-text). For add-ons: just allergens
              + dietary — modifiers inherit heat/spice from their parent
              dish and don't need their own free-text tags. */}
          {activeTab === 'food_tags' && (
            <section style={{ marginBottom: 4 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

                {/* Heat / Spice — predefined pill selector (hidden for Beverages & Desserts and add-ons) */}
                {!isAddon && category !== 'Beverages' && category !== 'Desserts' && <div>
                  <label style={labelStyle}>Heat / Spice</label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {activeHeatLabels.map((option) => (
                      <button
                        key={option}
                        type="button"
                        data-testid={`heat-pill-${option.toLowerCase()}`}
                        aria-pressed={heatSpice === option}
                        onClick={() => setHeatSpice(heatSpice === option ? null : option)}
                        style={{
                          padding: '4px 14px',
                          borderRadius: 20,
                          border: '1px solid',
                          borderColor: heatSpice === option ? '#f97316' : 'var(--border)',
                          background: heatSpice === option ? '#fff7ed' : 'transparent',
                          color: heatSpice === option ? '#c2410c' : 'var(--text2)',
                          cursor: 'pointer',
                          fontSize: 12,
                          fontWeight: heatSpice === option ? 600 : 400,
                          transition: 'all 0.1s',
                        }}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>}

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

                {/* Allergens — multi-select pills, food_tags-backed. New
                    items: same Set drives the deferred-creation flow, the
                    save handler flushes via setItemTags after the DB row
                    is created. */}
                {dietaryTagService && restaurantId && (
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

                {/* Dietary restrictions — same pattern. */}
                {dietaryTagService && restaurantId && (
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

                {/* Other tag fields — hidden for add-ons (modifiers inherit
                    these from the parent dish). */}
                {!isAddon && TAG_FIELDS.map(({ key, label, placeholder }) => (
                  <TagInput
                    key={key}
                    fieldKey={key}
                    label={label}
                    values={tags[key] ?? []}
                    placeholder={placeholder}
                    onChange={(vals) => setTags((prev) => ({ ...prev, [key]: vals }))}
                  />
                ))}
              </div>
            </section>
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
          {activeTab === 'groupings' && groupingsSlot && (
            <section style={{ marginBottom: 4 }}>
              {groupingsSlot}
            </section>
          )}

          {/* ── Dishes tab (shown when editing an addon item) ─────────── */}
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
        background: highlight ? '#fff7ed' : '#f9f9f9',
        border: `1px solid ${highlight ? '#fed7aa' : 'var(--border)'}`,
        borderRadius: 'var(--r)',
        padding: '14px 16px',
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

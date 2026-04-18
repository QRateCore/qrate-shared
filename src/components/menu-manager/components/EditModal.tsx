'use client';
import { useMenuManagerService } from '../context';
import { useTrackAction } from '../track-action-context';

import { useRef, useState, useEffect } from 'react';
import { X, Upload, Camera, Wand2, Trash2, Eye, EyeOff, AlertCircle } from 'lucide-react';
import type {MenuItemDisplay, MenuSummary, FoodTags, AddonEntry, RecommendationEntry, MenuItemPerformancePeriod, MenuItemPerformanceResponse} from '../../../types/restaurant';
import { FOOD_TAG_FIELD_MAP, CANONICAL_CATEGORIES, toCanonical } from '../lib/menuUtils';
import Select from '../../common/Select';
import { computeAddonCascadeTargets, applyAddonPriceCascade } from '../lib/addonHelpers';
import { processImageForUpload } from '../../../utils/imageProcessing';
import { useIsMobile } from '../../../hooks/useIsMobile';

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
}

// ── Food tag fields shown in the editor (heat_spice handled separately as pills) ──

const TAG_FIELDS: { key: keyof FoodTags; label: string; placeholder: string }[] = [
  { key: 'ingredients',    label: 'Ingredients',    placeholder: 'e.g. chicken, lemon…' },
  { key: 'dietary',        label: 'Dietary',         placeholder: 'e.g. vegetarian, vegan…' },
  { key: 'allergens',      label: 'Allergens',        placeholder: 'e.g. gluten, dairy…' },
  { key: 'cooking_method', label: 'Cooking method',  placeholder: 'e.g. grilled, fried…' },
  { key: 'textures',       label: 'Texture',          placeholder: 'e.g. crispy, creamy…' },
  { key: 'taste_profile',  label: 'Taste profile',   placeholder: 'e.g. savoury, smoky…' },
  { key: 'seasons',        label: 'Seasonal',         placeholder: 'e.g. summer, winter…' },
  { key: 'festivity',      label: 'Festivities',      placeholder: 'e.g. Christmas, Diwali…' },
];

// ── Heat/spice predefined values ──────────────────────────────────────────────

const HEAT_SPICE_OPTIONS = ['Mild', 'Warm', 'Medium', 'Hot', 'Fiery'] as const;

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
      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 4 }}>
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
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              fontSize: 11,
              fontWeight: 500,
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
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                lineHeight: 1,
                color: 'var(--text2)',
                fontSize: 11,
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

// ── EditModal ─────────────────────────────────────────────────────────────────

export default function EditModal({ item, restaurantId, menus, allItems, onClose, onComplete, onNavigateToMenu, onDishAddonsChange, isNewItem = false, forceAddon = false, preselectedDishIds, onSaveNewItem }: EditModalProps) {
  const trackAction = useTrackAction();
  const service = useMenuManagerService();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
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

  // Heat/spice — extracted from food_tags into its own state
  const [heatSpice, setHeatSpice] = useState<string | null>(() => {
    const hs = item.food_tags?.heat_spice;
    if (Array.isArray(hs)) return (hs as string[])[0] ?? null;
    if (typeof hs === 'string') return hs || null;
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

  // Image state
  const [thumbnail, setThumbnail]   = useState(item.thumbnail_url ?? null);
  const [imgBusy, setImgBusy]       = useState<'uploading' | 'enhancing' | 'removing' | null>(null);
  const [imgError, setImgError]     = useState<string | null>(null);

  // Add-on type
  const [isAddon, setIsAddon]       = useState(forceAddon || item.item_type === 'addon');
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

  // Tab state — Food Tags | Add-ons | Recommendations | Performance (dish items) or Performance | Dishes (addon items)
  const [activeTab, setActiveTab] = useState<'food_tags' | 'addons' | 'recommendations' | 'dishes' | 'performance'>('food_tags');

  // When the Dishes/Add-ons toggle flips, the available tab set changes.
  //   Dishes  → [food_tags, addons, performance]
  //   Add-ons → [performance, dishes]                (no food_tags tab)
  // Land on a valid tab for the new mode. Dep list is [isAddon] only
  // — including activeTab would loop.
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

  useEffect(() => {
    if (activeTab !== 'addons' || !restaurantId) return;
    setAddonsLoading(true);
    setAddonsError(null);
    service
      .getAddonItems(restaurantId)
      .then(setAddonPool)
      .catch((e: unknown) => setAddonsError(e instanceof Error ? e.message : 'Failed to load add-ons'))
      .finally(() => setAddonsLoading(false));
  }, [activeTab, restaurantId]);

  useEffect(() => {
    if (activeTab !== 'recommendations' || !restaurantId) return;
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

  async function handleEnhance() {
    const start = Date.now();
    setImgBusy('enhancing');
    setImgError(null);
    try {
      const { thumbnail_url } = await service.enhanceMenuItemImage(item.id);
      setThumbnail(thumbnail_url);
      trackAction('menu.imageUpload.aiEnhance', {
        restaurantId,
        metadata: { itemId: item.id },
        success: true,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      trackAction('menu.imageUpload.aiEnhance', {
        restaurantId,
        metadata: { itemId: item.id },
        success: false,
        durationMs: Date.now() - start,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      setImgError(err instanceof Error ? err.message : 'Enhancement failed');
    } finally {
      setImgBusy(null);
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
      } catch {
        setItemAddons(prev);
        setAddonsError('Failed to remove add-on — please try again.');
      }
    });
    addonMutexRef.current = task;
    await task;
  }

  async function handleApproveAddon(addon: AddonEntry) {
    const prev = itemAddonsRef.current;
    const next = prev.map((a) =>
      a.menu_item_id === addon.menu_item_id ? { ...a, status: 'approved' as const } : a,
    );
    setItemAddons(next);
    const task = addonMutexRef.current.then(async () => {
      try {
        if (addon.id) {
          await service.approveAddonSuggestion(item.id, addon.id);
        } else {
          await service.updateItemModifiers(item.id, { addons: next });
        }
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
    try {
      await service.updateItemModifiers(item.id, {
        recommendations: next.map((r) => ({
          menu_item_id: r.menu_item_id,
          name: r.name,
          price_override: null,
          thumbnail_url: r.thumbnail_url ?? null,
        })),
      });
    } catch {
      setItemRecs(itemRecs);
    }
  }

  // ── Dishes tab handlers (used when editing an addon item) ───────────────

  async function handleAddToDish(dish: MenuItemDisplay) {
    const newEntry: AddonEntry = {
      menu_item_id: item.id,
      name: item.name,
      price_override: item.price ?? 0,
      thumbnail_url: item.thumbnail_url ?? null,
      status: 'approved',
      suggestion_source: 'manual',
    };
    const nextAddons = [...(dish.addons ?? []), newEntry];
    setAssociatedDishIds((prev) => new Set([...prev, dish.id]));
    try {
      await service.updateItemModifiers(dish.id, { addons: nextAddons });
      onDishAddonsChange?.(dish.id, nextAddons);
    } catch {
      setAssociatedDishIds((prev) => { const next = new Set(prev); next.delete(dish.id); return next; });
    }
  }

  async function handleRemoveFromDish(dish: MenuItemDisplay) {
    const nextAddons = (dish.addons ?? []).filter((a) => a.menu_item_id !== item.id);
    setAssociatedDishIds((prev) => { const next = new Set(prev); next.delete(dish.id); return next; });
    try {
      await service.updateItemModifiers(dish.id, { addons: nextAddons });
      onDishAddonsChange?.(dish.id, nextAddons);
    } catch {
      setAssociatedDishIds((prev) => new Set([...prev, dish.id]));
    }
  }

  async function handleAddToMultipleDishes(dishIds: Set<string>) {
    if (!allItems || dishIds.size === 0) return;
    const dishes = allItems.filter((d) => dishIds.has(d.id));
    // Optimistic: add all to associated set and clear selection
    setAssociatedDishIds((prev) => new Set([...prev, ...dishIds]));
    setSelectedDishIds(new Set());
    const failed: string[] = [];
    for (const dish of dishes) {
      const newEntry: AddonEntry = {
        menu_item_id: item.id,
        name: item.name,
        price_override: item.price ?? 0,
        thumbnail_url: item.thumbnail_url ?? null,
        status: 'approved',
        suggestion_source: 'manual',
      };
      const nextAddons = [...(dish.addons ?? []), newEntry];
      try {
        await service.updateItemModifiers(dish.id, { addons: nextAddons });
        onDishAddonsChange?.(dish.id, nextAddons);
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

  async function handleUpdateAddonPrice(menuItemId: string, newPrice: number) {
    // Read latest state from ref — avoids stale closure when blur fires right before a remove click.
    const prev = itemAddonsRef.current;
    // Guard: if the addon was already removed (e.g. blur races with click), skip.
    if (!prev.some((a) => a.menu_item_id === menuItemId)) return;
    const next = prev.map((a) =>
      a.menu_item_id === menuItemId ? { ...a, price_override: newPrice } : a,
    );
    setItemAddons(next);
    const task = addonMutexRef.current.then(async () => {
      try {
        await service.updateItemModifiers(item.id, { addons: next });
      } catch {
        setItemAddons(prev);
      }
    });
    addonMutexRef.current = task;
    await task;
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

    // Build food tags — other fields from TAG_FIELDS + heat_spice from pill state
    const foodTags: FoodTags = {};
    for (const { key } of TAG_FIELDS) {
      const fieldName = FOOD_TAG_FIELD_MAP[key] ?? key;
      const vals = tags[key];
      if (vals && vals.length > 0) {
        (foodTags as Record<string, string[]>)[fieldName] = vals;
      }
    }
    if (heatSpice) {
      (foodTags as Record<string, string>).heat_spice = heatSpice;
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
      const updates: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim(),
        category: category.trim() || undefined,
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

      const [saved] = await Promise.all([
        service.updateMenuItem(item.id, updates),
        isActive !== (item.active !== false)
          ? service.toggleMenuItemActive(item.id, isActive)
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

      // When an add-on's base price changes, cascade the new price to every
      // dish whose existing association is still tracking the old base price.
      // A dish whose owner has explicitly set a per-dish override (different
      // from the old base) is preserved — only default-tracking entries move.
      // Why: the previous behaviour snapshot-captured the addon's price at the
      // time of association and never refreshed it, so owners saw $0 on the
      // dish's Add-ons tab after updating the addon's price.
      if (isAddon && allItems && price !== null && price !== (item.price ?? 0)) {
        const oldBase = item.price ?? 0;
        const newBase = price;
        const cascadeTargets = computeAddonCascadeTargets(allItems, item.id, oldBase);
        for (const dish of cascadeTargets) {
          const nextAddons = applyAddonPriceCascade(dish.addons ?? [], item.id, oldBase, newBase);
          try {
            await service.updateItemModifiers(dish.id, { addons: nextAddons });
            onDishAddonsChange?.(dish.id, nextAddons);
          } catch {
            // Non-fatal: the addon's own price save succeeded; a failed
            // cascade just leaves that dish on the old override until the
            // owner re-opens it. Surfacing a blocking error here would be
            // worse UX than quietly continuing.
          }
        }
      }

      const updated: MenuItemDisplay = {
        ...item,
        name: saved.name ?? name.trim(),
        description: (saved.description ?? description.trim()) || null,
        category: (saved as { category?: string }).category ?? (category.trim() || item.category),
        canonical_category: category.trim() || item.canonical_category,
        food_tags: (saved.food_tags ?? foodTags) as FoodTags,
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
    enhancing:  'Enhancing…',
    removing:   'Removing…',
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 60,
          background: 'rgba(0,0,0,0.4)',
        }}
        data-testid="edit-modal-backdrop"
      />

      {/* Modal */}
      <div
        data-testid="edit-item-modal"
        data-mobile={isMobile ? 'true' : undefined}
        style={
          isMobile
            ? {
                // Mobile: full-screen sheet with the existing dark backdrop preserved.
                // STR-251 mobile + camera (2026-04-08).
                // `dvh` (dynamic viewport height) accounts for iOS Safari's
                // collapsing URL bar — using `vh` would let the bar overlay
                // the sticky footer / save buttons.
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
                width: 720,
                maxWidth: 'calc(100vw - 32px)',
                height: '90vh',
                maxHeight: '90vh',
                background: 'var(--white)',
                borderRadius: 'var(--r)',
                boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }
        }
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
          {/* Item name */}
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.name}
          </div>

          {/* Dishes / Add-ons pill toggle — only shown when creating a new item (hidden when forceAddon) */}
          {isNewItem && !forceAddon && (
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
              style={{ fontSize: 11, color: '#b91c1c', background: '#fee2e2', borderRadius: 4, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}
            >
              <AlertCircle size={12} />
              {saveError}
            </div>
          )}
          {deleteError && (
            <div
              style={{ fontSize: 11, color: '#b91c1c', background: '#fee2e2', borderRadius: 4, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}
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

          {/* ── Body — layout branches on isAddon (STR-303) ───────────────────
              Dishes mode: full two-column (image + basic info + food-tag fields via tabs)
              Add-ons mode: simplified single-column (Name + Price + Description) */}
          {!isAddon && (
          <section
            data-testid="dish-basic-info"
            style={{
              display: 'flex',
              flexDirection: isMobile ? 'column' : 'row',
              gap: 20,
              marginBottom: 20,
              alignItems: 'flex-start',
            }}
          >

            {/* Left column — large image panel */}
            <div
              data-testid="item-image-panel"
              style={{
                width: isMobile ? '100%' : 260,
                flexShrink: 0,
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
                  <span style={{ fontSize: 12, color: 'var(--text2)', textAlign: 'center', padding: 12 }}>
                    {imgBusyLabel[imgBusy]}
                  </span>
                ) : thumbnail ? (
                  <img src={thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ textAlign: 'center', color: 'var(--text2)' }}>
                    <div style={{ fontSize: 28, marginBottom: 6 }}>🍽</div>
                    <div style={{ fontSize: 11 }}>Add an image</div>
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
                {thumbnail && (
                  <>
                    <button
                      type="button"
                      onClick={handleEnhance}
                      disabled={!!imgBusy}
                      data-testid="edit-enhance-btn"
                      style={imgActionStyle('blue')}
                    >
                      <Wand2 size={12} />
                      {imgBusy === 'enhancing' ? 'Enhancing…' : 'Enhance'}
                    </button>
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
                  </>
                )}
              </div>

              {/* Image error */}
              {imgError && (
                <div style={{ fontSize: 11, color: '#b91c1c', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <AlertCircle size={11} />
                  {imgError}
                </div>
              )}

              {/* Soft warning when no image */}
              {!thumbnail && !imgBusy && (
                <div
                  data-testid="no-image-warning"
                  style={{
                    fontSize: 11,
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

            {/* Right column — required fields */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <SectionLabel>Basic Info</SectionLabel>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }} htmlFor="edit-category">
                    Category <span style={{ color: '#b91c1c' }}>*</span>
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Select
                      id="edit-category"
                      value={category}
                      onChange={(e) => { setCategory(e.target.value); setCategoryError(false); }}
                      data-testid="edit-category-select"
                      options={CANONICAL_CATEGORIES.map((c) => ({ value: c, label: c }))}
                      placeholder="— Select category —"
                      error={categoryError}
                    />
                    {categoryError && (
                      <span style={{ fontSize: 10, color: '#b91c1c' }}>Category is required</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Name */}
              <div>
                <label style={labelStyle} htmlFor="edit-name">
                  Name <span style={{ color: '#b91c1c' }}>*</span>
                </label>
                <input
                  id="edit-name"
                  type="text"
                  value={name}
                  placeholder={isNewItem ? item.name : ''}
                  onChange={(e) => { setName(e.target.value); setNameError(false); }}
                  data-testid="edit-name-input"
                  style={{
                    ...inputStyle,
                    border: nameError ? '1px solid #b91c1c' : '1px solid var(--border)',
                  }}
                />
                {nameError && (
                  <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 3 }}>Name is required</div>
                )}
              </div>

              {/* Description */}
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
                  <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 3 }}>Description is required</div>
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

            </div>
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

            {/* Name + Price row — wraps on narrow viewports (<~340px) */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ flex: '1 1 180px' }}>
                <label style={labelStyle} htmlFor="edit-name">
                  Name <span style={{ color: '#b91c1c' }}>*</span>
                </label>
                <input
                  id="edit-name"
                  type="text"
                  value={name}
                  placeholder={isNewItem ? item.name : ''}
                  onChange={(e) => { setName(e.target.value); setNameError(false); }}
                  data-testid="edit-name-input"
                  style={{
                    ...inputStyle,
                    border: nameError ? '1px solid #b91c1c' : '1px solid var(--border)',
                  }}
                />
                {nameError && (
                  <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 3 }}>Name is required</div>
                )}
              </div>

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
                      style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', padding: 2, fontSize: 11, whiteSpace: 'nowrap' }}
                    >
                      × clear
                    </button>
                  )}
                </div>
                {priceError && (
                  <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 3 }}>{priceError}</div>
                )}
              </div>
            </div>

          </section>
          )}

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
            {(isAddon
              ? (isNewItem ? (['dishes'] as const) : (['performance', 'dishes'] as const))
              : (isNewItem
                ? (['food_tags', 'addons', 'recommendations'] as const)
                : (['food_tags', 'addons', 'recommendations', 'performance'] as const))
            ).map((tab) => {
              const isActive = activeTab === tab;
              const label =
                tab === 'food_tags'
                  ? 'Food Tags'
                  : tab === 'addons'
                    ? `Add-ons${itemAddons.length > 0 ? ` (${itemAddons.length})` : ''}`
                    : tab === 'recommendations'
                      ? `Recommendations${(aiSugs.length + itemRecs.length) > 0 ? ` (${aiSugs.length + itemRecs.length})` : ''}`
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

          {/* ── Food Tags tab (dishes only — guarded by !isAddon in case state lags) ── */}
          {!isAddon && activeTab === 'food_tags' && (
            <section style={{ marginBottom: 4 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

                {/* Heat / Spice — predefined pill selector */}
                <div>
                  <label style={labelStyle}>Heat / Spice</label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {HEAT_SPICE_OPTIONS.map((option) => (
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
                </div>

                {/* Other tag fields */}
                {TAG_FIELDS.map(({ key, label, placeholder }) => (
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
                <div style={{ fontSize: 12, color: 'var(--text2)', padding: '20px 0', textAlign: 'center' }}>
                  Add-on data unavailable — no restaurant context.
                </div>
              )}

              {restaurantId && (
                <>
                  {/* Mutation error banner */}
                  {addonsError && (
                    <div style={{ fontSize: 12, color: '#b91c1c', background: '#fee2e2', borderRadius: 4, padding: '6px 10px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <AlertCircle size={14} /> {addonsError}
                    </div>
                  )}
                  {/* AI Suggestions — pending approval */}
                  {itemAddons.filter((a) => a.status === 'suggested').length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                        AI Suggestions
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {itemAddons.filter((a) => a.status === 'suggested').map((addon) => (
                          <AddonCard
                            key={addon.menu_item_id}
                            addon={addon}
                            onApprove={() => void handleApproveAddon(addon)}
                            onRemove={() => void handleRemoveAddon(addon.menu_item_id)}
                            onPriceChange={(p) => void handleUpdateAddonPrice(addon.menu_item_id, p)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Assigned add-ons */}
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                      Assigned Add-ons
                    </div>
                    {itemAddons.filter((a) => a.status === 'approved').length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--text2)', fontStyle: 'italic', padding: '8px 0' }}>
                        No add-ons assigned yet — add from the pool below.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {itemAddons.filter((a) => a.status === 'approved').map((addon) => (
                          <AddonCard
                            key={addon.menu_item_id}
                            addon={addon}
                            onRemove={() => void handleRemoveAddon(addon.menu_item_id)}
                            onPriceChange={(p) => void handleUpdateAddonPrice(addon.menu_item_id, p)}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Add from pool */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                      Add from Pool
                    </div>
                    {addonsLoading && (
                      <div style={{ fontSize: 12, color: 'var(--text2)', padding: '8px 0' }}>Loading…</div>
                    )}
                    {addonsError && !addonsLoading && (
                      <div style={{ fontSize: 12, color: '#b91c1c', background: '#fee2e2', borderRadius: 4, padding: '6px 10px' }}>
                        {addonsError}
                      </div>
                    )}
                    {!addonsLoading && !addonsError && addonPool.length === 0 && (
                      <div style={{ fontSize: 12, color: 'var(--text2)', fontStyle: 'italic', padding: '8px 0' }}>
                        No add-on items found. Mark items as &quot;Add-on&quot; in their editor to make them available here.
                      </div>
                    )}
                    {!addonsLoading && addonPool.length > 0 && (
                      <>
                        {/* Pool search */}
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
                            marginBottom: 8,
                          }}
                        />
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
                              <div
                                style={{
                                  width: 32, height: 32, borderRadius: 4,
                                  background: '#f0f0f0', overflow: 'hidden',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  fontSize: 14, flexShrink: 0,
                                }}
                              >
                                {poolItem.thumbnail_url ? (
                                  <img src={poolItem.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : '🍽'}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {poolItem.name}
                                </div>
                                {poolItem.price != null && (
                                  <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                                    ${poolItem.price.toFixed(2)}
                                  </div>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => void handleAddAddon(poolItem)}
                                data-testid={`add-addon-${poolItem.id}`}
                                style={{
                                  fontSize: 11, fontWeight: 700, padding: '4px 10px',
                                  background: '#fff7ed', border: '1px solid #f59e0b',
                                  color: '#92400e', borderRadius: 4, cursor: 'pointer', flexShrink: 0,
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
          {activeTab === 'recommendations' && (
            <section style={{ marginBottom: 4 }}>
              {recsLoading && (
                <div style={{ fontSize: 12, color: 'var(--text2)', padding: '8px 0' }}>Loading…</div>
              )}
              {recsError && !recsLoading && (
                <div style={{ fontSize: 12, color: '#b91c1c', background: '#fee2e2', borderRadius: 4, padding: '6px 10px' }}>
                  {recsError}
                </div>
              )}
              {!recsLoading && !recsError && (
                aiSugs.length === 0 && itemRecs.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text2)', fontStyle: 'italic', padding: '20px 0', textAlign: 'center' }}>
                    No recommendations generated yet. Run Menu Intelligence to generate AI pairings for this dish.
                  </div>
                ) : (
                  <>
                    {/* AI Suggestions — from pairing_graph, pending acceptance */}
                    {aiSugs.length > 0 && (
                      <div style={{ marginBottom: 20 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
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
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                        Accepted Pairings
                      </div>
                      {itemRecs.length === 0 ? (
                        <div style={{ fontSize: 12, color: 'var(--text2)', fontStyle: 'italic', padding: '8px 0' }}>
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

          {/* ── Dishes tab (shown when editing an addon item) ─────────── */}
          {activeTab === 'dishes' && (
            <section style={{ marginBottom: 4 }}>
              {!allItems || allItems.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text2)', padding: '20px 0', textAlign: 'center' }}>
                  No dish data available.
                </div>
              ) : (
                <>
                  {/* Associated dishes */}
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                      Associated Dishes
                    </div>
                    {associatedDishIds.size === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--text2)', fontStyle: 'italic', padding: '8px 0' }}>
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
                                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {dish.name}
                                </div>
                                {dish.price != null && (
                                  <div style={{ fontSize: 11, color: 'var(--text2)' }}>${Number(dish.price).toFixed(2)}</div>
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
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                      Add to Dish
                    </div>
                    {(() => {
                      const availableDishes = allItems.filter((d) => !associatedDishIds.has(d.id) && d.id !== item.id);
                      if (availableDishes.length === 0) {
                        return (
                          <div style={{ fontSize: 12, color: 'var(--text2)', fontStyle: 'italic', padding: '8px 0' }}>
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
                                flex: 1,
                              }}
                            />
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
                            <div style={{ fontSize: 12, color: 'var(--text2)', fontStyle: 'italic', padding: '8px 0' }}>
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
                                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {dish.name}
                                      </div>
                                      {dish.price != null && (
                                        <div style={{ fontSize: 11, color: 'var(--text2)' }}>${Number(dish.price).toFixed(2)}</div>
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
                <select
                  value={perfPeriod}
                  onChange={(e) => setPerfPeriod(e.target.value as MenuItemPerformancePeriod)}
                  data-testid="perf-period-select"
                  style={{
                    fontSize: 12,
                    color: 'var(--text)',
                    background: 'white',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-xs)',
                    padding: '5px 8px',
                    cursor: 'pointer',
                    outline: 'none',
                  }}
                >
                  <option value="last_hour">Last hour</option>
                  <option value="last_day">Last day</option>
                  <option value="last_3_days">Last 3 days</option>
                  <option value="last_7_days">Last 7 days</option>
                  <option value="last_month">Last month</option>
                </select>
              </div>

              {/* Loading / error states */}
              {perfLoading && (
                <div style={{ fontSize: 13, color: 'var(--text2)', padding: '20px 0', textAlign: 'center' }}>
                  Loading performance data…
                </div>
              )}
              {perfError && !perfLoading && (
                <div style={{ fontSize: 12, color: '#b91c1c', background: '#fee2e2', borderRadius: 4, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertCircle size={12} />
                  {perfError}
                </div>
              )}

              {/* Metric cards */}
              {perfData && !perfLoading && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
                  <PerfCard label="Carousel Views" value={perfData.carousel_views.toLocaleString()} />
                  <PerfCard label="Conversions" value={perfData.conversions.toLocaleString()} />
                  <PerfCard label="Card Flips" value={perfData.card_flips.toLocaleString()} />
                  <PerfCard label="Conversion Rate" value={`${perfData.conversion_rate}%`} highlight={perfData.conversion_rate > 0} />
                </div>
              )}

              {/* No restaurant context */}
              {!restaurantId && !perfLoading && (
                <div style={{ fontSize: 12, color: 'var(--text2)', padding: '20px 0', textAlign: 'center' }}>
                  Performance data unavailable — no restaurant context.
                </div>
              )}
            </section>
          )}
          </div>{/* end scrollable tab content */}
        </div>

      </div>
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
      <div
        style={{
          width: 32, height: 32, borderRadius: 4,
          background: '#f0f0f0', overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, flexShrink: 0,
        }}
      >
        {rec.thumbnail_url ? (
          <img src={rec.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : '🍽'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
  onApprove,
  onRemove,
  onPriceChange,
}: {
  addon: AddonEntry;
  onApprove?: () => void;
  onRemove: () => void;
  onPriceChange?: (newPrice: number) => void;
}) {
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceInput, setPriceInput] = useState((addon.price_override ?? 0).toFixed(2));

  function commitPrice() {
    setEditingPrice(false);
    const parsed = parseFloat(priceInput);
    const val = Number.isNaN(parsed) ? 0 : Math.max(0, parsed);
    setPriceInput(val.toFixed(2));
    if (onPriceChange && val !== (addon.price_override ?? 0)) {
      onPriceChange(val);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        borderRadius: 'var(--r-xs)',
        border: addon.status === 'suggested' ? '1px solid #f59e0b' : '1px solid var(--border)',
        background: addon.status === 'suggested' ? '#fffbeb' : '#fafafa',
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
        {addon.thumbnail_url ? (
          <img src={addon.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : '🍽'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {addon.name}
          </div>
          {addon.status === 'suggested' && (
            <span style={{ fontSize: 9, fontWeight: 700, background: '#fef3c7', color: '#92400e', border: '1px solid #f59e0b', borderRadius: 4, padding: '1px 4px', flexShrink: 0 }}>
              AI
            </span>
          )}
        </div>
        {editingPrice && onPriceChange ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginTop: 2 }}>
            <span style={{ fontSize: 11, color: 'var(--text2)' }}>$</span>
            <input
              type="text"
              inputMode="decimal"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              onBlur={commitPrice}
              onKeyDown={(e) => { if (e.key === 'Enter') commitPrice(); if (e.key === 'Escape') { setPriceInput((addon.price_override ?? 0).toFixed(2)); setEditingPrice(false); } }}
              autoFocus
              data-testid={`addon-price-input-${addon.menu_item_id}`}
              style={{
                width: 60, fontSize: 11, padding: '1px 4px',
                border: '1px solid var(--border)', borderRadius: 3,
                outline: 'none', background: 'white', color: 'var(--text)',
              }}
            />
          </div>
        ) : (
          <div
            style={{ fontSize: 11, color: 'var(--text2)', cursor: onPriceChange ? 'pointer' : 'default' }}
            onClick={() => { if (onPriceChange) { setPriceInput((addon.price_override ?? 0).toFixed(2)); setEditingPrice(true); } }}
            title={onPriceChange ? 'Click to edit price' : undefined}
            data-testid={`addon-price-${addon.menu_item_id}`}
          >
            ${(addon.price_override ?? 0).toFixed(2)}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {addon.status === 'suggested' && onApprove && (
          <button
            type="button"
            onClick={onApprove}
            data-testid={`approve-addon-modal-${addon.menu_item_id}`}
            style={{ fontSize: 11, fontWeight: 700, padding: '4px 8px', background: '#dcfce7', border: '1px solid #86efac', color: '#15803d', borderRadius: 4, cursor: 'pointer' }}
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

function PerfCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
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
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
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

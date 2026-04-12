'use client';
import { useMenuManagerService } from '../context';

import { useRef, useState, useEffect } from 'react';
import { X, Upload, Camera, Wand2, Trash2, Eye, EyeOff, AlertCircle } from 'lucide-react';
import type {MenuItemDisplay, MenuSummary, FoodTags, AddonEntry, MenuItemPerformancePeriod, MenuItemPerformanceResponse} from '../../../types/restaurant';
import { FOOD_TAG_FIELD_MAP } from '../lib/menuUtils';
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

export default function EditModal({ item, restaurantId, menus, allItems, onClose, onComplete, onNavigateToMenu }: EditModalProps) {
  const service = useMenuManagerService();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();

  // Form state — initialized from item
  const [name, setName]             = useState(item.name);
  const [description, setDesc]      = useState(item.description ?? '');
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
  const [isAddon, setIsAddon]       = useState(item.item_type === 'addon');

  // Save state
  const [saving, setSaving]         = useState(false);
  const [saveError, setSaveError]   = useState<string | null>(null);
  const [nameError, setNameError]   = useState(false);
  const [descError, setDescError]   = useState(false);

  // Delete state
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deleteLoading, setDeleteLoading]       = useState(false);
  const [deleteError, setDeleteError]           = useState<string | null>(null);

  // Tab state — Food Tags | Add-ons | Performance (dish items) or Food Tags | Dishes | Performance (addon items)
  const [activeTab, setActiveTab] = useState<'food_tags' | 'addons' | 'dishes' | 'performance'>('food_tags');

  // Add-ons tab state (used when editing a dish item)
  const [itemAddons, setItemAddons] = useState<AddonEntry[]>(item.addons ?? []);

  // Dishes tab state (used when editing an addon item) — tracks which dishes have this addon
  const [associatedDishIds, setAssociatedDishIds] = useState<Set<string>>(() => {
    if (!allItems) return new Set();
    return new Set(
      allItems
        .filter((d) => d.item_type !== 'addon' && d.addons?.some((a) => a.menu_item_id === item.id))
        .map((d) => d.id),
    );
  });
  const [addonPool, setAddonPool] = useState<MenuItemDisplay[]>([]);
  const [addonsLoading, setAddonsLoading] = useState(false);
  const [addonsError, setAddonsError] = useState<string | null>(null);
  const [poolSearch, setPoolSearch] = useState('');

  // Performance tab state
  const [perfPeriod, setPerfPeriod] = useState<MenuItemPerformancePeriod>('last_7_days');
  const [perfData, setPerfData] = useState<MenuItemPerformanceResponse | null>(null);
  const [perfLoading, setPerfLoading] = useState(false);
  const [perfError, setPerfError] = useState<string | null>(null);

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

  // ── Image handlers ──────────────────────────────────────────────────────

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
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
    } catch (err) {
      setImgError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setImgBusy(null);
      if (fileRef.current) fileRef.current.value = '';
      if (cameraRef.current) cameraRef.current.value = '';
    }
  }

  async function handleEnhance() {
    setImgBusy('enhancing');
    setImgError(null);
    try {
      const { thumbnail_url } = await service.enhanceMenuItemImage(item.id);
      setThumbnail(thumbnail_url);
    } catch (err) {
      setImgError(err instanceof Error ? err.message : 'Enhancement failed');
    } finally {
      setImgBusy(null);
    }
  }

  async function handleRemoveImage() {
    setImgBusy('removing');
    setImgError(null);
    try {
      await service.removeMenuItemImage(item.id);
      setThumbnail(null);
    } catch (err) {
      setImgError(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setImgBusy(null);
    }
  }

  // ── Add-ons tab handlers ────────────────────────────────────────────────

  async function handleAddAddon(poolItem: MenuItemDisplay) {
    const already = itemAddons.some((a) => a.menu_item_id === poolItem.id);
    if (already) return;
    const newEntry: AddonEntry = {
      menu_item_id: poolItem.id,
      name: poolItem.name,
      price_override: poolItem.price ?? 0,
      thumbnail_url: poolItem.thumbnail_url ?? null,
      status: 'approved',
      suggestion_source: 'manual',
    };
    const next = [...itemAddons, newEntry];
    setItemAddons(next);
    try {
      await service.updateItemModifiers(item.id, { addons: next });
    } catch {
      setItemAddons(itemAddons);
    }
  }

  async function handleRemoveAddon(menuItemId: string) {
    const next = itemAddons.filter((a) => a.menu_item_id !== menuItemId);
    setItemAddons(next);
    try {
      await service.updateItemModifiers(item.id, { addons: next });
    } catch {
      setItemAddons(itemAddons);
    }
  }

  async function handleApproveAddon(addon: AddonEntry) {
    const next = itemAddons.map((a) =>
      a.menu_item_id === addon.menu_item_id ? { ...a, status: 'approved' as const } : a,
    );
    setItemAddons(next);
    try {
      if (addon.id) {
        await service.approveAddonSuggestion(item.id, addon.id);
      } else {
        await service.updateItemModifiers(item.id, { addons: next });
      }
    } catch {
      setItemAddons(itemAddons);
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
    } catch {
      setAssociatedDishIds((prev) => { const next = new Set(prev); next.delete(dish.id); return next; });
    }
  }

  async function handleRemoveFromDish(dish: MenuItemDisplay) {
    const nextAddons = (dish.addons ?? []).filter((a) => a.menu_item_id !== item.id);
    setAssociatedDishIds((prev) => { const next = new Set(prev); next.delete(dish.id); return next; });
    try {
      await service.updateItemModifiers(dish.id, { addons: nextAddons });
    } catch {
      setAssociatedDishIds((prev) => new Set([...prev, dish.id]));
    }
  }

  // ── Save ────────────────────────────────────────────────────────────────

  async function handleSave() {
    let hasError = false;
    if (!name.trim()) { setNameError(true); hasError = true; }
    if (!description.trim()) { setDescError(true); hasError = true; }
    if (hasError) return;

    setNameError(false);
    setDescError(false);
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
      const updates: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim(),
        food_tags: foodTags,
        item_type: isAddon ? 'addon' : 'dish',
      };

      const [saved] = await Promise.all([
        service.updateMenuItem(item.id, updates),
        isActive !== (item.active !== false)
          ? service.toggleMenuItemActive(item.id, isActive)
          : Promise.resolve(),
      ]);

      const updated: MenuItemDisplay = {
        ...item,
        name: saved.name ?? name.trim(),
        description: (saved.description ?? description.trim()) || null,
        food_tags: (saved.food_tags ?? foodTags) as FoodTags,
        active: isActive,
        thumbnail_url: thumbnail,
        item_type: isAddon ? 'addon' : 'dish',
        addons: itemAddons,
      };

      onComplete(updated);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save — please try again');
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────

  async function handleDelete() {
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await service.deleteMenuItem(item.id);
      onComplete({ ...item, _deleted: true });
    } catch (err) {
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

          {/* Active / visibility toggle */}
          <button
            type="button"
            onClick={() => setIsActive((v) => !v)}
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

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

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

          {/* ── Two-column: image left / fields right (mobile: stacked) ── */}
          <section
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
              <SectionLabel>Basic Info</SectionLabel>

              {/* Add-on checkbox */}
              <label
                data-testid="addon-checkbox-label"
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '10px 12px',
                  borderRadius: 'var(--r-xs)',
                  border: isAddon ? '1px solid #f59e0b' : '1px solid var(--border)',
                  background: isAddon ? '#fffbeb' : '#fafafa',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <input
                  type="checkbox"
                  checked={isAddon}
                  onChange={(e) => setIsAddon(e.target.checked)}
                  data-testid="addon-checkbox"
                  style={{ marginTop: 1, width: 14, height: 14, accentColor: '#f59e0b', cursor: 'pointer', flexShrink: 0 }}
                />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>This is an Add-on</div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
                    Ingredient-level modifier (e.g. Extra Chicken). Hidden from diners — assignable to dishes in the menu builder.
                  </div>
                </div>
              </label>

              {/* Name */}
              <div>
                <label style={labelStyle} htmlFor="edit-name">
                  Name <span style={{ color: '#b91c1c' }}>*</span>
                </label>
                <input
                  id="edit-name"
                  type="text"
                  value={name}
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
                          onClick={() => onNavigateToMenu?.(assoc.menu_id, item.id)}
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

          {/* ── Tab bar: context-aware based on item type ─────────── */}
          {/* Addon items: Food Tags | Dishes | Performance            */}
          {/* Dish items:  Food Tags | Add-ons | Performance           */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 0,
              borderBottom: '1px solid var(--border)',
              marginBottom: 20,
            }}
          >
            {(item.item_type === 'addon'
              ? (['food_tags', 'dishes', 'performance'] as const)
              : (['food_tags', 'addons', 'performance'] as const)
            ).map((tab) => {
              const isActive = activeTab === tab;
              const label =
                tab === 'food_tags'
                  ? 'Food Tags'
                  : tab === 'addons'
                    ? `Add-ons${itemAddons.length > 0 ? ` (${itemAddons.length})` : ''}`
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

          {/* ── Food Tags tab ─────────────────────────────────────────── */}
          {activeTab === 'food_tags' && (
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
                    {allItems.filter((d) => !associatedDishIds.has(d.id)).length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--text2)', fontStyle: 'italic', padding: '8px 0' }}>
                        All dishes are already associated with this add-on.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {allItems
                          .filter((d) => !associatedDishIds.has(d.id))
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
                                onClick={() => void handleAddToDish(dish)}
                                data-testid={`add-to-dish-${dish.id}`}
                                style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', background: '#fff7ed', border: '1px solid #f59e0b', color: '#92400e', borderRadius: 4, cursor: 'pointer', flexShrink: 0 }}
                              >
                                + Add
                              </button>
                            </div>
                          ))}
                      </div>
                    )}
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
        </div>

      </div>
    </>
  );
}

// ── Style helpers ─────────────────────────────────────────────────────────────

function AddonCard({
  addon,
  onApprove,
  onRemove,
}: {
  addon: AddonEntry;
  onApprove?: () => void;
  onRemove: () => void;
}) {
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
        <div style={{ fontSize: 11, color: 'var(--text2)' }}>
          ${(addon.price_override ?? 0).toFixed(2)}
        </div>
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

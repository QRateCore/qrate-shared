'use client';
import { useMenuManagerService } from '../context';
import { useTrackAction } from '../track-action-context';

import { useState, useMemo, useEffect } from 'react';
import {
  X,
  Check,
  Search,
  PlusCircle,
  MinusCircle,
  Trash2,
  ChevronDown,
  ChevronRight,
  Minus,
} from 'lucide-react';
import type { MenuItemDisplay } from '../../../types/restaurant';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BulkModifierPanelProps {
  restaurantId: string;
  /**
   * Items selected from the Item Pool. May contain a mix of addons and entrees.
   * Direction is derived from the partition:
   *   all-addons → forward (existing behaviour)
   *   any-entree → reverse (entrees pre-selected, user picks addons)
   * Prop name kept stable for API compatibility (STR-415).
   */
  selectedAddons: MenuItemDisplay[];
  /** Initial seed of all menu items; refetched on mount via service. */
  dishItems: MenuItemDisplay[];
  onClose: () => void;
  /** Called with updated dish items after successful assignment */
  onComplete: (updatedItems: MenuItemDisplay[]) => void;
}

// ── Pure helpers (exported for unit testing) ──────────────────────────────────

const UNCATEGORISED = 'Uncategorised';

export function groupDishesByCategory(
  dishes: MenuItemDisplay[],
): Array<{ category: string; dishes: MenuItemDisplay[] }> {
  // Prefer canonical_category (AI pipeline-assigned, consistently populated)
  // over the owner-typed `category` field (often empty until the owner sets it).
  // Falls through to "Uncategorised" only when both are missing.
  const map = new Map<string, MenuItemDisplay[]>();
  for (const d of dishes) {
    const canonical = d.canonical_category && d.canonical_category.trim();
    const display = d.category && d.category.trim();
    const key = canonical || display || UNCATEGORISED;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(d);
  }
  return [...map.entries()].map(([category, list]) => ({ category, dishes: list }));
}

export function calcDiff(
  selectedDishes: MenuItemDisplay[],
  addonIds: string[],
): { create: number; existing: number } {
  let create = 0;
  let existing = 0;
  for (const dish of selectedDishes) {
    const existingAddonIds = new Set((dish.addons ?? []).map((a) => a.menu_item_id));
    for (const addonId of addonIds) {
      if (existingAddonIds.has(addonId)) existing++;
      else create++;
    }
  }
  return { create, existing };
}

export function formatSelfAssocMessage(count: number): string {
  return count === 1
    ? '1 addon excluded — addons can only be attached to dishes'
    : `${count} addons excluded — addons can only be attached to dishes`;
}

function isAddonItem(item: MenuItemDisplay): boolean {
  return item.item_type === 'addon' || item.item_type === 'included';
}

// ── BulkModifierPanel ─────────────────────────────────────────────────────────

export default function BulkModifierPanel({
  restaurantId,
  selectedAddons: inputItems,
  dishItems,
  onClose,
  onComplete,
}: BulkModifierPanelProps) {
  const service = useMenuManagerService();
  const trackAction = useTrackAction();

  // Partition input by item_type; direction derived
  const inputAddons = useMemo(() => inputItems.filter(isAddonItem), [inputItems]);
  const inputEntrees = useMemo(() => inputItems.filter((i) => !isAddonItem(i)), [inputItems]);
  const direction: 'forward' | 'reverse' = inputEntrees.length === 0 ? 'forward' : 'reverse';

  const [tab, setTab] = useState<'assign' | 'remove' | 'delete'>('assign');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [dishSearch, setDishSearch] = useState('');
  const [addonSearch, setAddonSearch] = useState('');

  // Pre-populate dish selection with input entrees in reverse mode
  const [selectedDishIds, setSelectedDishIds] = useState<Set<string>>(
    () => new Set(direction === 'reverse' ? inputEntrees.map((e) => e.id) : []),
  );

  // Forward: addons fixed (= inputAddons). Reverse: user picks addons.
  const [reverseAddonIds, setReverseAddonIds] = useState<Set<string>>(new Set());

  // Refetch — keep parent prop as initial seed; race-safe re-fetch on mount
  const [localDishItems, setLocalDishItems] = useState<MenuItemDisplay[]>(dishItems);
  const [isRefetching, setIsRefetching] = useState(false);

  const [executing, setExecuting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsRefetching(true);
    service
      .getAllMenuItems(restaurantId)
      .then((items) => {
        if (!cancelled) {
          setLocalDishItems(items);
          setIsRefetching(false);
        }
      })
      .catch(() => {
        if (!cancelled) setIsRefetching(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const effectiveAddonIds = useMemo<Set<string>>(
    () =>
      direction === 'forward' ? new Set(inputAddons.map((a) => a.id)) : reverseAddonIds,
    [direction, inputAddons, reverseAddonIds],
  );

  const filteredDishes = useMemo(
    () =>
      localDishItems.filter(
        (d) =>
          !isAddonItem(d) &&
          (dishSearch.trim() === '' ||
            d.name.toLowerCase().includes(dishSearch.toLowerCase())),
      ),
    [localDishItems, dishSearch],
  );

  // For Remove tab: dishes that currently have at least one effective addon assigned
  const dishesWithAddon = useMemo(
    () =>
      localDishItems.filter(
        (d) =>
          !isAddonItem(d) &&
          (d.addons ?? []).some((a) => effectiveAddonIds.has(a.menu_item_id)) &&
          (dishSearch.trim() === '' ||
            d.name.toLowerCase().includes(dishSearch.toLowerCase())),
      ),
    [localDishItems, effectiveAddonIds, dishSearch],
  );

  const activeList = tab === 'assign' ? filteredDishes : tab === 'remove' ? dishesWithAddon : [];
  const groupedDishes = useMemo(() => groupDishesByCategory(activeList), [activeList]);

  // Auto-expand categories containing pre-selected entrees (reverse mode visibility)
  const initialExpanded = useMemo<Set<string>>(() => {
    if (direction === 'reverse') {
      const cats = new Set<string>();
      for (const dish of inputEntrees) {
        cats.add((dish.category && dish.category.trim()) || UNCATEGORISED);
      }
      return cats;
    }
    return new Set();
  }, [direction, inputEntrees]);

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(initialExpanded);

  const filteredAddons = useMemo(() => {
    if (direction !== 'reverse') return [];
    return localDishItems.filter(
      (d) =>
        isAddonItem(d) &&
        (addonSearch.trim() === '' ||
          d.name.toLowerCase().includes(addonSearch.toLowerCase())),
    );
  }, [direction, localDishItems, addonSearch]);

  const selectedDishesForDiff = useMemo(
    () => localDishItems.filter((d) => selectedDishIds.has(d.id)),
    [localDishItems, selectedDishIds],
  );

  const diff = useMemo(
    () => calcDiff(selectedDishesForDiff, [...effectiveAddonIds]),
    [selectedDishesForDiff, effectiveAddonIds],
  );

  function diffForCategory(catDishes: MenuItemDisplay[]): { create: number; existing: number } {
    const selected = catDishes.filter((d) => selectedDishIds.has(d.id));
    return calcDiff(selected, [...effectiveAddonIds]);
  }

  function toggleDish(id: string) {
    setSelectedDishIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAddon(id: string) {
    setReverseAddonIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCategory(category: string, catDishes: MenuItemDisplay[]) {
    setSelectedDishIds((prev) => {
      const next = new Set(prev);
      const inCategory = catDishes.map((d) => d.id);
      const anySelected = inCategory.some((id) => next.has(id));
      if (anySelected) {
        for (const id of inCategory) next.delete(id);
      } else {
        for (const id of inCategory) next.add(id);
      }
      return next;
    });
  }

  function toggleExpand(category: string) {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  function toggleAll() {
    if (selectedDishIds.size === activeList.length && activeList.length > 0) {
      setSelectedDishIds(new Set());
    } else {
      setSelectedDishIds(new Set(activeList.map((d) => d.id)));
    }
  }

  // ── handlers ────────────────────────────────────────────────────────────────

  async function handleRemove() {
    if (selectedDishIds.size === 0) {
      setError('Select at least one dish');
      return;
    }
    if (effectiveAddonIds.size === 0) {
      setError('Select at least one addon');
      return;
    }
    const start = Date.now();
    setExecuting(true);
    setError(null);
    setProgress('Removing…');
    try {
      await Promise.all(
        [...selectedDishIds].map(async (dishId) => {
          const dish = localDishItems.find((d) => d.id === dishId);
          if (!dish) return;
          const filtered = (dish.addons ?? []).filter(
            (a) => !effectiveAddonIds.has(a.menu_item_id),
          );
          await service.updateItemModifiers(dishId, { addons: filtered });
        }),
      );

      const updatedItems = localDishItems.map((dish) => {
        if (!selectedDishIds.has(dish.id)) return dish;
        return {
          ...dish,
          addons: (dish.addons ?? []).filter((a) => !effectiveAddonIds.has(a.menu_item_id)),
        };
      });

      setProgress(null);
      setExecuting(false);
      trackAction('menu.bulkModifier.remove', {
        restaurantId,
        metadata: {
          addonCount: effectiveAddonIds.size,
          dishCount: selectedDishIds.size,
          direction,
        },
        success: true,
        durationMs: Date.now() - start,
      });
      onComplete(updatedItems);
    } catch (err) {
      trackAction('menu.bulkModifier.remove', {
        restaurantId,
        metadata: {
          addonCount: effectiveAddonIds.size,
          dishCount: selectedDishIds.size,
          direction,
        },
        success: false,
        durationMs: Date.now() - start,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      setExecuting(false);
      setProgress(null);
      setError('Removal failed — please try again');
    }
  }

  async function handleDelete() {
    const start = Date.now();
    setExecuting(true);
    setError(null);
    setProgress('Deleting…');
    try {
      await Promise.all(inputAddons.map((addon) => service.deleteMenuItem(addon.id)));
      const inputAddonIds = new Set(inputAddons.map((a) => a.id));
      const updatedItems = localDishItems.filter((d) => !inputAddonIds.has(d.id));
      setProgress(null);
      setExecuting(false);
      trackAction('menu.bulkModifier.delete', {
        restaurantId,
        metadata: { addonCount: inputAddons.length },
        success: true,
        durationMs: Date.now() - start,
      });
      onComplete(updatedItems);
    } catch (err) {
      trackAction('menu.bulkModifier.delete', {
        restaurantId,
        metadata: { addonCount: inputAddons.length },
        success: false,
        durationMs: Date.now() - start,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      setExecuting(false);
      setProgress(null);
      setError('Delete failed — please try again');
    }
  }

  async function handleAssign() {
    if (selectedDishIds.size === 0) {
      setError('Select at least one dish');
      return;
    }
    if (effectiveAddonIds.size === 0) {
      setError('Select at least one addon');
      return;
    }
    const start = Date.now();
    setExecuting(true);
    setError(null);
    setProgress('Assigning…');
    try {
      const addonIdList = [...effectiveAddonIds];
      const result = await service.bulkAssignModifiers(restaurantId, {
        modifier_type: 'addon',
        modifier_item_ids: addonIdList,
        dish_ids: [...selectedDishIds],
      });

      const addonsLookup = new Map<string, MenuItemDisplay>();
      for (const a of localDishItems) {
        if (isAddonItem(a) && effectiveAddonIds.has(a.id)) addonsLookup.set(a.id, a);
      }
      // Forward path also has inputAddons as a source for richer fields (price, thumbnail)
      // when those addons aren't in localDishItems yet (e.g. just created)
      for (const a of inputAddons) {
        if (!addonsLookup.has(a.id)) addonsLookup.set(a.id, a);
      }

      const updatedItems = localDishItems.map((dish) => {
        if (!selectedDishIds.has(dish.id)) return dish;
        const existingAddonIds = new Set((dish.addons ?? []).map((a) => a.menu_item_id));
        const newAddons = addonIdList
          .filter((id) => !existingAddonIds.has(id))
          .map((id) => {
            const addon = addonsLookup.get(id);
            return {
              menu_item_id: id,
              name: addon?.name ?? '',
              price_override: addon?.price ?? 0,
              thumbnail_url: addon?.thumbnail_url ?? null,
              status: 'approved' as const,
              suggestion_source: 'manual' as const,
            };
          });
        return { ...dish, addons: [...(dish.addons ?? []), ...newAddons] };
      });

      setProgress(null);
      setExecuting(false);
      const skipped = result.skipped ?? 0;
      const created = result.created ?? 0;
      trackAction('menu.bulkModifier.assign', {
        restaurantId,
        metadata: {
          addonCount: effectiveAddonIds.size,
          dishCount: selectedDishIds.size,
          created,
          skipped,
          direction,
        },
        success: true,
        durationMs: Date.now() - start,
      });
      if (skipped > 0) {
        setError(`${created} assigned, ${skipped} already existed — skipped`);
        // Keep panel open so user reads the partial-success message.
      } else {
        onComplete(updatedItems);
      }
    } catch (err) {
      trackAction('menu.bulkModifier.assign', {
        restaurantId,
        metadata: {
          addonCount: effectiveAddonIds.size,
          dishCount: selectedDishIds.size,
          direction,
        },
        success: false,
        durationMs: Date.now() - start,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      setExecuting(false);
      setProgress(null);
      setError('Assignment failed — please try again');
    }
  }

  const allSelected = activeList.length > 0 && selectedDishIds.size === activeList.length;

  const headerLabel =
    direction === 'forward'
      ? `${inputAddons.length} addon${inputAddons.length !== 1 ? 's' : ''} selected`
      : `${inputEntrees.length} dish${inputEntrees.length !== 1 ? 'es' : ''} selected`;

  // Hide Delete in reverse mode — panel manages addon assignment, not entree deletion
  const visibleTabs =
    direction === 'forward'
      ? ([
          { key: 'assign' as const, label: 'Assign', icon: <PlusCircle size={13} /> },
          { key: 'remove' as const, label: 'Remove', icon: <MinusCircle size={13} /> },
          { key: 'delete' as const, label: 'Delete', icon: <Trash2 size={13} /> },
        ])
      : ([
          { key: 'assign' as const, label: 'Assign', icon: <PlusCircle size={13} /> },
          { key: 'remove' as const, label: 'Remove', icon: <MinusCircle size={13} /> },
        ]);

  const previewItems = direction === 'forward' ? inputAddons : inputEntrees;
  const previewLabel =
    direction === 'forward'
      ? tab === 'assign'
        ? 'Addons to assign:'
        : tab === 'remove'
          ? 'Addons to remove:'
          : 'Addons to delete:'
      : 'Dishes pre-selected:';

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 40,
          background: 'rgba(0,0,0,0.15)',
        }}
        data-testid="bulk-modifier-panel-backdrop"
      />

      {/* Panel */}
      <div
        data-testid="bulk-modifier-panel"
        data-direction={direction}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '50vw',
          minWidth: 380,
          zIndex: 50,
          background: 'var(--white)',
          borderLeft: '1px solid var(--border)',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
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
              Bulk Actions
            </div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
              {headerLabel}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="bulk-modifier-panel-close"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text2)', padding: 4, borderRadius: 4,
              display: 'flex', alignItems: 'center',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* AC4 — Self-association notice */}
        {direction === 'reverse' && inputAddons.length > 0 && (
          <div
            data-testid="bulk-modifier-self-assoc-notice"
            role="status"
            style={{
              padding: '8px 16px',
              fontSize: 11,
              color: '#92400e',
              background: '#fffbeb',
              borderBottom: '1px solid var(--border)',
            }}
          >
            {formatSelfAssocMessage(inputAddons.length)}
          </div>
        )}

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
          data-testid="bulk-modifier-tabs"
        >
          {visibleTabs.map(({ key, label, icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                data-testid={`bulk-modifier-tab-${key}`}
                onClick={() => {
                  setTab(key);
                  setSelectedDishIds(
                    direction === 'reverse'
                      ? new Set(inputEntrees.map((e) => e.id))
                      : new Set(),
                  );
                  setReverseAddonIds(new Set());
                  setDeleteConfirm(false);
                  setError(null);
                }}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  padding: '9px 0',
                  fontSize: 12,
                  fontWeight: active ? 700 : 500,
                  color: active ? 'var(--blue)' : 'var(--text2)',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: active ? '2px solid var(--blue)' : '2px solid transparent',
                  cursor: 'pointer',
                  transition: 'color 0.1s',
                }}
              >
                {icon}
                {label}
              </button>
            );
          })}
        </div>

        {/* Selected items preview */}
        <div
          style={{
            padding: '10px 16px',
            borderBottom: '1px solid var(--border)',
            background: '#fef3c7',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: '#92400e', marginBottom: 6 }}>
            {previewLabel}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {previewItems.slice(0, 5).map((item) => (
              <span
                key={item.id}
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  background: '#fde68a',
                  color: '#92400e',
                  borderRadius: 4,
                  padding: '2px 7px',
                  maxWidth: 140,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={item.name}
              >
                {item.name}
              </span>
            ))}
            {previewItems.length > 5 && (
              <span style={{ fontSize: 11, color: '#92400e', padding: '2px 4px' }}>
                +{previewItems.length - 5} more
              </span>
            )}
          </div>
        </div>

        {tab === 'delete' && direction === 'forward' && (
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '20px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 'var(--r-xs)',
                padding: '14px 16px',
                fontSize: 12,
                color: '#991b1b',
                lineHeight: 1.5,
              }}
              data-testid="bulk-modifier-delete-warning"
            >
              <strong>
                This will permanently delete {inputAddons.length} addon
                {inputAddons.length !== 1 ? 's' : ''}.
              </strong>{' '}
              They will be removed from all dishes they are currently assigned to and cannot be
              recovered.
            </div>
            {deleteConfirm && (
              <div
                style={{ fontSize: 11, color: '#b91c1c', textAlign: 'center', fontWeight: 600 }}
                data-testid="bulk-modifier-delete-confirm-prompt"
              >
                ⚠️ Click &ldquo;Confirm — delete {inputAddons.length} addon
                {inputAddons.length !== 1 ? 's' : ''}&rdquo; again to proceed.
              </div>
            )}
          </div>
        )}

        {tab !== 'delete' && (
          <>
            {/* Reverse-only: addon picker */}
            {direction === 'reverse' && (
              <div
                style={{ borderBottom: '1px solid var(--border)', padding: '8px 16px 10px' }}
                data-testid="bulk-modifier-addon-picker"
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--text2)',
                    marginBottom: 6,
                  }}
                >
                  Pick addons to {tab === 'assign' ? 'assign' : 'remove'}:
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    background: '#f6f6f6',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-xs)',
                    padding: '6px 10px',
                    marginBottom: 6,
                  }}
                >
                  <Search size={13} color="var(--text2)" />
                  <input
                    type="text"
                    placeholder="Search addons…"
                    value={addonSearch}
                    onChange={(e) => setAddonSearch(e.target.value)}
                    data-testid="bulk-modifier-addon-search"
                    style={{
                      border: 'none',
                      background: 'transparent',
                      outline: 'none',
                      fontSize: 12,
                      color: 'var(--text)',
                      flex: 1,
                      minWidth: 0,
                    }}
                  />
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 4,
                    maxHeight: 120,
                    overflowY: 'auto',
                  }}
                >
                  {filteredAddons.length === 0 ? (
                    <span style={{ fontSize: 11, color: 'var(--text2)' }}>
                      {addonSearch ? 'No addons match' : 'No addons available'}
                    </span>
                  ) : (
                    filteredAddons.map((addon) => {
                      const isSelected = reverseAddonIds.has(addon.id);
                      return (
                        <button
                          key={addon.id}
                          type="button"
                          onClick={() => toggleAddon(addon.id)}
                          data-testid={`bulk-modifier-addon-${addon.id}`}
                          aria-pressed={isSelected}
                          style={{
                            fontSize: 11,
                            fontWeight: 500,
                            background: isSelected ? 'var(--blue)' : '#f0f0f0',
                            color: isSelected ? 'white' : 'var(--text)',
                            border:
                              '1px solid ' + (isSelected ? 'var(--blue)' : 'var(--border)'),
                            borderRadius: 12,
                            padding: '3px 9px',
                            minHeight: 24,
                            cursor: 'pointer',
                            maxWidth: 160,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={addon.name}
                        >
                          {addon.name}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* Dish search */}
            <div style={{ padding: '10px 16px 6px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: '#f6f6f6',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-xs)',
                  padding: '6px 10px',
                }}
              >
                <Search size={13} color="var(--text2)" />
                <input
                  type="text"
                  placeholder="Search dishes…"
                  value={dishSearch}
                  onChange={(e) => setDishSearch(e.target.value)}
                  data-testid="bulk-modifier-dish-search"
                  style={{
                    border: 'none',
                    background: 'transparent',
                    outline: 'none',
                    fontSize: 12,
                    color: 'var(--text)',
                    flex: 1,
                    minWidth: 0,
                  }}
                />
                {dishSearch && (
                  <button
                    type="button"
                    onClick={() => setDishSearch('')}
                    aria-label="Clear search"
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
                )}
              </div>
            </div>

            {/* Select all row */}
            <div
              style={{
                padding: '4px 16px 6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <button
                type="button"
                onClick={toggleAll}
                data-testid="bulk-modifier-select-all"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 11,
                  color: 'var(--text2)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    border: allSelected ? '2px solid var(--blue)' : '2px solid #ccc',
                    background: allSelected ? 'var(--blue)' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {allSelected && <Check size={9} color="white" strokeWidth={3} />}
                </span>
                {selectedDishIds.size > 0
                  ? `${selectedDishIds.size} dishes selected`
                  : 'Select all dishes'}
              </button>
            </div>

            {/* Category-grouped dish list */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '0 16px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
              data-testid="bulk-modifier-dish-list"
            >
              {activeList.length === 0 ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '24px 0',
                    fontSize: 12,
                    color: 'var(--text2)',
                  }}
                >
                  {dishSearch
                    ? 'No dishes match'
                    : tab === 'remove'
                      ? 'None of your dishes have these addons assigned'
                      : 'No dishes available'}
                </div>
              ) : (
                groupedDishes.map(({ category, dishes }) => {
                  const isExpanded = expandedCategories.has(category);
                  const inCategoryIds = dishes.map((d) => d.id);
                  const selectedInCategoryCount = inCategoryIds.filter((id) =>
                    selectedDishIds.has(id),
                  ).length;
                  const triState: 'empty' | 'partial' | 'full' =
                    selectedInCategoryCount === 0
                      ? 'empty'
                      : selectedInCategoryCount === dishes.length
                        ? 'full'
                        : 'partial';
                  const ariaChecked: 'true' | 'false' | 'mixed' =
                    triState === 'full' ? 'true' : triState === 'partial' ? 'mixed' : 'false';
                  const catDiff = diffForCategory(dishes);

                  return (
                    <div
                      key={category}
                      data-testid={`bulk-modifier-category-${category}`}
                      style={{ display: 'flex', flexDirection: 'column' }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0,
                          background: '#f9f9fb',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--r-xs)',
                        }}
                      >
                        {/* Whole-category select */}
                        <button
                          type="button"
                          onClick={() => toggleCategory(category, dishes)}
                          data-testid={`bulk-cat-toggle-${category}`}
                          aria-checked={ariaChecked}
                          role="checkbox"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '8px 10px',
                            minHeight: 32,
                            flex: 1,
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            textAlign: 'left',
                            color: 'var(--text)',
                            fontSize: 12,
                            fontWeight: 600,
                          }}
                        >
                          <span
                            aria-hidden="true"
                            style={{
                              width: 16,
                              height: 16,
                              minWidth: 16,
                              borderRadius: 3,
                              border:
                                triState === 'empty'
                                  ? '2px solid #ccc'
                                  : '2px solid var(--blue)',
                              background:
                                triState === 'full'
                                  ? 'var(--blue)'
                                  : triState === 'partial'
                                    ? 'var(--blue-bg)'
                                    : 'transparent',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            {triState === 'full' && (
                              <Check size={10} color="white" strokeWidth={3} />
                            )}
                            {triState === 'partial' && (
                              <Minus size={10} color="var(--blue)" strokeWidth={3} />
                            )}
                          </span>
                          <span style={{ flex: 1 }}>
                            {category}{' '}
                            <span style={{ color: 'var(--text2)', fontWeight: 400 }}>
                              ({dishes.length})
                            </span>
                          </span>
                          <span
                            data-testid={`bulk-modifier-cat-counter-${category}`}
                            style={{ fontSize: 10, color: 'var(--text2)', fontWeight: 500 }}
                          >
                            {selectedInCategoryCount > 0
                              ? `+${catDiff.create} / =${catDiff.existing}`
                              : ''}
                          </span>
                        </button>
                        {/* Expand chevron — separate hit target */}
                        <button
                          type="button"
                          onClick={() => toggleExpand(category)}
                          data-testid={`bulk-cat-expand-${category}`}
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${category}`}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            minWidth: 32,
                            minHeight: 32,
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--text2)',
                          }}
                        >
                          {isExpanded ? (
                            <ChevronDown size={14} />
                          ) : (
                            <ChevronRight size={14} />
                          )}
                        </button>
                      </div>

                      {isExpanded && (
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                            marginTop: 4,
                            marginBottom: 4,
                          }}
                        >
                          {dishes.map((dish) => {
                            const isSelected = selectedDishIds.has(dish.id);
                            return (
                              <button
                                key={dish.id}
                                type="button"
                                onClick={() => toggleDish(dish.id)}
                                data-testid={`bulk-modifier-dish-${dish.id}`}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  padding: '8px 10px',
                                  borderRadius: 'var(--r-xs)',
                                  border: isSelected
                                    ? '1px solid var(--blue)'
                                    : '1px solid var(--border)',
                                  background: isSelected ? 'var(--blue-bg)' : 'var(--white)',
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                  transition: 'all 0.1s',
                                }}
                              >
                                <span
                                  style={{
                                    width: 16,
                                    height: 16,
                                    borderRadius: 3,
                                    border: isSelected
                                      ? '2px solid var(--blue)'
                                      : '2px solid #ccc',
                                    background: isSelected ? 'var(--blue)' : 'transparent',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                  }}
                                >
                                  {isSelected && (
                                    <Check size={10} color="white" strokeWidth={3} />
                                  )}
                                </span>
                                {dish.thumbnail_url ? (
                                  <img
                                    src={dish.thumbnail_url}
                                    alt=""
                                    style={{
                                      width: 32,
                                      height: 32,
                                      borderRadius: 4,
                                      objectFit: 'cover',
                                      flexShrink: 0,
                                    }}
                                  />
                                ) : (
                                  <span
                                    style={{
                                      width: 32,
                                      height: 32,
                                      borderRadius: 4,
                                      background: '#f0f0f0',
                                      flexShrink: 0,
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      fontSize: 14,
                                    }}
                                  >
                                    🍽
                                  </span>
                                )}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 600,
                                      color: 'var(--text)',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    }}
                                    title={dish.name}
                                  >
                                    {dish.name}
                                  </div>
                                  {dish.category && (
                                    <div style={{ fontSize: 10, color: 'var(--text2)' }}>
                                      {dish.category}
                                    </div>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

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
              data-testid="bulk-modifier-error"
            >
              {error}
            </div>
          )}
          {progress && (
            <div style={{ fontSize: 11, color: 'var(--text2)', textAlign: 'center' }}>
              {progress}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              data-testid="bulk-modifier-cancel"
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
              onClick={() => {
                if (tab === 'assign') handleAssign();
                else if (tab === 'remove') handleRemove();
                else if (!deleteConfirm) setDeleteConfirm(true);
                else handleDelete();
              }}
              data-testid="bulk-modifier-apply"
              disabled={
                executing ||
                isRefetching ||
                (tab === 'assign' &&
                  (selectedDishIds.size === 0 || effectiveAddonIds.size === 0)) ||
                (tab === 'remove' &&
                  (selectedDishIds.size === 0 || effectiveAddonIds.size === 0))
              }
              style={{
                flex: 2,
                padding: '8px 0',
                fontSize: 12,
                fontWeight: 700,
                color: 'white',
                background: tab === 'assign' ? '#f59e0b' : '#dc2626',
                border: 'none',
                borderRadius: 'var(--r-xs)',
                cursor: 'pointer',
                opacity: 1,
              }}
            >
              {(() => {
                if (tab === 'assign') {
                  if (executing) return 'Assigning…';
                  if (selectedDishIds.size === 0) return 'Select dishes first';
                  if (effectiveAddonIds.size === 0) return 'Select addons first';
                  return (
                    <span data-testid="bulk-modifier-diff-total">
                      {`Apply (+${diff.create} / =${diff.existing})`}
                    </span>
                  );
                }
                if (tab === 'remove') {
                  if (executing) return 'Removing…';
                  if (selectedDishIds.size === 0) return 'Select dishes first';
                  if (effectiveAddonIds.size === 0) return 'Select addons first';
                  return `Remove from ${selectedDishIds.size} dish${
                    selectedDishIds.size !== 1 ? 'es' : ''
                  }`;
                }
                if (executing) return 'Deleting…';
                return deleteConfirm
                  ? `Confirm — delete ${inputAddons.length} addon${
                      inputAddons.length !== 1 ? 's' : ''
                    }`
                  : `Delete ${inputAddons.length} addon${
                      inputAddons.length !== 1 ? 's' : ''
                    }…`;
              })()}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

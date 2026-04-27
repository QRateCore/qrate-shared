'use client';
import { useMenuManagerService } from '../context';
import { useTrackAction } from '../track-action-context';

import { useState } from 'react';
import { X, Check, Search, PlusCircle, MinusCircle, Trash2 } from 'lucide-react';
import type { MenuItemDisplay } from '../../../types/restaurant';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BulkModifierPanelProps {
  restaurantId: string;
  /** Selected addon items from the item pool */
  selectedAddons: MenuItemDisplay[];
  /** All dish items available to assign to */
  dishItems: MenuItemDisplay[];
  onClose: () => void;
  /** Called with updated dish items after successful assignment */
  onComplete: (updatedItems: MenuItemDisplay[]) => void;
}

// ── BulkModifierPanel ─────────────────────────────────────────────────────────

export default function BulkModifierPanel({
  restaurantId,
  selectedAddons,
  dishItems,
  onClose,
  onComplete,
}: BulkModifierPanelProps) {
  const service = useMenuManagerService();
  const trackAction = useTrackAction();
  const [tab, setTab] = useState<'assign' | 'remove' | 'delete'>('assign');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [dishSearch, setDishSearch] = useState('');
  const [selectedDishIds, setSelectedDishIds] = useState<Set<string>>(new Set());
  const [executing, setExecuting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedAddonIds = new Set(selectedAddons.map((a) => a.id));

  const filteredDishes = dishItems.filter(
    (d) =>
      d.item_type !== 'addon' &&
      (dishSearch.trim() === '' ||
        d.name.toLowerCase().includes(dishSearch.toLowerCase())),
  );

  // For Remove tab: dishes that currently have at least one selected addon assigned
  const dishesWithAddon = dishItems.filter(
    (d) =>
      d.item_type !== 'addon' &&
      (d.addons ?? []).some((a) => selectedAddonIds.has(a.menu_item_id)) &&
      (dishSearch.trim() === '' ||
        d.name.toLowerCase().includes(dishSearch.toLowerCase())),
  );

  function toggleDish(id: string) {
    setSelectedDishIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const activeList = tab === 'assign' ? filteredDishes : tab === 'remove' ? dishesWithAddon : [];

  function toggleAll() {
    if (selectedDishIds.size === activeList.length && activeList.length > 0) {
      setSelectedDishIds(new Set());
    } else {
      setSelectedDishIds(new Set(activeList.map((d) => d.id)));
    }
  }

  async function handleRemove() {
    if (selectedDishIds.size === 0) {
      setError('Select at least one dish');
      return;
    }
    const start = Date.now();
    setExecuting(true);
    setError(null);
    setProgress('Removing…');
    try {
      // For each selected dish, strip the selected addons from its addons array
      await Promise.all(
        [...selectedDishIds].map(async (dishId) => {
          const dish = dishItems.find((d) => d.id === dishId);
          if (!dish) return;
          const filteredAddons = (dish.addons ?? []).filter(
            (a) => !selectedAddonIds.has(a.menu_item_id),
          );
          await service.updateItemModifiers(dishId, { addons: filteredAddons });
        }),
      );

      // Optimistic update: remove addon entries from target dishes
      const updatedItems = dishItems.map((dish) => {
        if (!selectedDishIds.has(dish.id)) return dish;
        return {
          ...dish,
          addons: (dish.addons ?? []).filter((a) => !selectedAddonIds.has(a.menu_item_id)),
        };
      });

      setProgress(null);
      setExecuting(false);
      trackAction('menu.bulkModifier.remove', {
        restaurantId,
        metadata: { addonCount: selectedAddons.length, dishCount: selectedDishIds.size },
        success: true,
        durationMs: Date.now() - start,
      });
      onComplete(updatedItems);
    } catch (err) {
      trackAction('menu.bulkModifier.remove', {
        restaurantId,
        metadata: { addonCount: selectedAddons.length, dishCount: selectedDishIds.size },
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
      await Promise.all(selectedAddons.map((addon) => service.deleteMenuItem(addon.id)));
      const updatedItems = dishItems.filter((d) => !selectedAddonIds.has(d.id));
      setProgress(null);
      setExecuting(false);
      trackAction('menu.bulkModifier.delete', {
        restaurantId,
        metadata: { addonCount: selectedAddons.length },
        success: true,
        durationMs: Date.now() - start,
      });
      onComplete(updatedItems);
    } catch (err) {
      trackAction('menu.bulkModifier.delete', {
        restaurantId,
        metadata: { addonCount: selectedAddons.length },
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
    const start = Date.now();
    setExecuting(true);
    setError(null);
    setProgress('Assigning…');
    try {
      const result = await service.bulkAssignModifiers(restaurantId, {
        modifier_type: 'addon',
        modifier_item_ids: selectedAddons.map((a) => a.id),
        dish_ids: [...selectedDishIds],
      });

      // Optimistic update: add addon entries to the target dishes' addons arrays
      const updatedItems = dishItems.map((dish) => {
        if (!selectedDishIds.has(dish.id)) return dish;
        const existingAddonIds = new Set((dish.addons ?? []).map((a) => a.menu_item_id));
        const newAddons = selectedAddons
          .filter((addon) => !existingAddonIds.has(addon.id))
          .map((addon) => ({
            menu_item_id: addon.id,
            name: addon.name,
            price_override: addon.price ?? 0,
            thumbnail_url: addon.thumbnail_url ?? null,
            status: 'approved' as const,
            suggestion_source: 'manual' as const,
          }));
        return { ...dish, addons: [...(dish.addons ?? []), ...newAddons] };
      });

      setProgress(null);
      setExecuting(false);
      const skipped = result.skipped ?? 0;
      const created = result.created ?? 0;
      trackAction('menu.bulkModifier.assign', {
        restaurantId,
        metadata: {
          addonCount: selectedAddons.length,
          dishCount: selectedDishIds.size,
          created,
          skipped,
        },
        success: true,
        durationMs: Date.now() - start,
      });
      if (skipped > 0) {
        setError(`${created} assigned, ${skipped} already existed — skipped`);
        // Keep the panel open so the user actually reads the partial-success
        // message — calling onComplete here would close the panel via the
        // parent's setBulkModifiersOpen(false) and the user would never know
        // some assignments were skipped. The user explicitly clicks Cancel/×
        // to dismiss; parent state will pick up the change on the next refresh.
      } else {
        onComplete(updatedItems);
      }
    } catch (err) {
      trackAction('menu.bulkModifier.assign', {
        restaurantId,
        metadata: {
          addonCount: selectedAddons.length,
          dishCount: selectedDishIds.size,
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
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 380,
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
              {selectedAddons.length} addon{selectedAddons.length !== 1 ? 's' : ''} selected
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

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
          data-testid="bulk-modifier-tabs"
        >
          {([
            { key: 'assign' as const, label: 'Assign', icon: <PlusCircle size={13} /> },
            { key: 'remove' as const, label: 'Remove', icon: <MinusCircle size={13} /> },
            { key: 'delete' as const, label: 'Delete', icon: <Trash2 size={13} /> },
          ]).map(({ key, label, icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                data-testid={`bulk-modifier-tab-${key}`}
                onClick={() => {
                  setTab(key);
                  setSelectedDishIds(new Set());
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

        {/* Selected addons preview */}
        <div
          style={{
            padding: '10px 16px',
            borderBottom: '1px solid var(--border)',
            background: '#fef3c7',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: '#92400e', marginBottom: 6 }}>
            {tab === 'assign' ? 'Addons to assign:' : 'Addons to remove:'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {selectedAddons.slice(0, 5).map((addon) => (
              <span
                key={addon.id}
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
                title={addon.name}
              >
                {addon.name}
              </span>
            ))}
            {selectedAddons.length > 5 && (
              <span style={{ fontSize: 11, color: '#92400e', padding: '2px 4px' }}>
                +{selectedAddons.length - 5} more
              </span>
            )}
          </div>
        </div>

        {tab === 'delete' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
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
              <strong>This will permanently delete {selectedAddons.length} addon{selectedAddons.length !== 1 ? 's' : ''}.</strong>
              {' '}They will be removed from all dishes they are currently assigned to and cannot be recovered.
            </div>
            {deleteConfirm && (
              <div
                style={{ fontSize: 11, color: '#b91c1c', textAlign: 'center', fontWeight: 600 }}
                data-testid="bulk-modifier-delete-confirm-prompt"
              >
                ⚠️ Click &ldquo;Confirm — delete {selectedAddons.length} addon{selectedAddons.length !== 1 ? 's' : ''}&rdquo; again to proceed.
              </div>
            )}
          </div>
        )}

        {tab !== 'delete' && (<>{/* Dish search */}
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
        <div style={{ padding: '4px 16px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
            {selectedDishIds.size > 0 ? `${selectedDishIds.size} dishes selected` : 'Select all dishes'}
          </button>
        </div>

        {/* Dish list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {activeList.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', fontSize: 12, color: 'var(--text2)' }}>
              {dishSearch
                ? 'No dishes match'
                : tab === 'remove'
                  ? 'None of your dishes have these addons assigned'
                  : 'No dishes available'}
            </div>
          ) : (
            activeList.map((dish) => {
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
                    border: isSelected ? '1px solid var(--blue)' : '1px solid var(--border)',
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
                      border: isSelected ? '2px solid var(--blue)' : '2px solid #ccc',
                      background: isSelected ? 'var(--blue)' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {isSelected && <Check size={10} color="white" strokeWidth={3} />}
                  </span>
                  {dish.thumbnail_url ? (
                    <img
                      src={dish.thumbnail_url}
                      alt=""
                      style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }}
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
            })
          )}
        </div></>)}

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
              disabled={executing || (tab !== 'delete' && selectedDishIds.size === 0)}
              style={{
                flex: 2,
                padding: '8px 0',
                fontSize: 12,
                fontWeight: 700,
                color: 'white',
                background: tab === 'assign' ? '#f59e0b' : '#dc2626',
                border: 'none',
                borderRadius: 'var(--r-xs)',
                cursor: executing || (tab !== 'delete' && selectedDishIds.size === 0) ? 'not-allowed' : 'pointer',
                opacity: executing || (tab !== 'delete' && selectedDishIds.size === 0) ? 0.6 : 1,
              }}
            >
              {tab === 'assign'
                ? executing
                  ? 'Assigning…'
                  : selectedDishIds.size > 0
                    ? `Assign to ${selectedDishIds.size} dish${selectedDishIds.size !== 1 ? 'es' : ''}`
                    : 'Select dishes first'
                : tab === 'remove'
                  ? executing
                    ? 'Removing…'
                    : selectedDishIds.size > 0
                      ? `Remove from ${selectedDishIds.size} dish${selectedDishIds.size !== 1 ? 'es' : ''}`
                      : 'Select dishes first'
                  : executing
                    ? 'Deleting…'
                    : deleteConfirm
                      ? `Confirm — delete ${selectedAddons.length} addon${selectedAddons.length !== 1 ? 's' : ''}`
                      : `Delete ${selectedAddons.length} addon${selectedAddons.length !== 1 ? 's' : ''}…`}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

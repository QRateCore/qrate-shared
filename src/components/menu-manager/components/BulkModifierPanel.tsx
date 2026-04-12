'use client';
import { useMenuManagerService } from '../context';

import { useState } from 'react';
import { X, Check, Search } from 'lucide-react';
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
  const [dishSearch, setDishSearch] = useState('');
  const [selectedDishIds, setSelectedDishIds] = useState<Set<string>>(new Set());
  const [executing, setExecuting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filteredDishes = dishItems.filter(
    (d) =>
      d.item_type !== 'addon' &&
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

  function toggleAll() {
    if (selectedDishIds.size === filteredDishes.length && filteredDishes.length > 0) {
      setSelectedDishIds(new Set());
    } else {
      setSelectedDishIds(new Set(filteredDishes.map((d) => d.id)));
    }
  }

  async function handleAssign() {
    if (selectedDishIds.size === 0) {
      setError('Select at least one dish');
      return;
    }
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
      if (skipped > 0) {
        setError(`${created} assigned, ${skipped} already existed — skipped`);
        // Still call onComplete with updated items
        onComplete(updatedItems);
      } else {
        onComplete(updatedItems);
      }
    } catch {
      setExecuting(false);
      setProgress(null);
      setError('Assignment failed — please try again');
    }
  }

  const allSelected = filteredDishes.length > 0 && selectedDishIds.size === filteredDishes.length;

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
              Assign addons to dishes
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

        {/* Selected addons preview */}
        <div
          style={{
            padding: '10px 16px',
            borderBottom: '1px solid var(--border)',
            background: '#fef3c7',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: '#92400e', marginBottom: 6 }}>
            Addons to assign:
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
          {filteredDishes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', fontSize: 12, color: 'var(--text2)' }}>
              {dishSearch ? 'No dishes match' : 'No dishes available'}
            </div>
          ) : (
            filteredDishes.map((dish) => {
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
              onClick={handleAssign}
              data-testid="bulk-modifier-apply"
              disabled={executing || selectedDishIds.size === 0}
              style={{
                flex: 2,
                padding: '8px 0',
                fontSize: 12,
                fontWeight: 700,
                color: 'white',
                background: '#f59e0b',
                border: 'none',
                borderRadius: 'var(--r-xs)',
                cursor: executing || selectedDishIds.size === 0 ? 'not-allowed' : 'pointer',
                opacity: executing || selectedDishIds.size === 0 ? 0.6 : 1,
              }}
            >
              {executing
                ? 'Assigning…'
                : selectedDishIds.size > 0
                  ? `Assign to ${selectedDishIds.size} dish${selectedDishIds.size !== 1 ? 'es' : ''}`
                  : 'Select dishes first'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

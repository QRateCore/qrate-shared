'use client';
import { useMenuManagerService } from '../context';
import { useTrackAction } from '../track-action-context';

import { useState } from 'react';
import { X, Star, Zap, EyeOff, Eye, Trash2, MinusCircle, PlusCircle, Flame, Leaf } from 'lucide-react';
import type { MenuItemDisplay, MenuSummary, MenuAssociation } from '../../../types/restaurant';
import { CANONICAL_CATEGORIES, BOOST_LABELS, type BoostLabel } from '../lib/menuUtils';
import Select from '../../common/Select';
import type { BulkMode } from '../MenuManagerClient';

// ── Dietary & Spice constants ─────────────────────────────────────────────────

const HEAT_LABELS = ['Mild', 'Warm', 'Medium', 'Hot', 'Fiery'] as const;
type HeatLabel = typeof HEAT_LABELS[number];

const HEAT_META: Record<HeatLabel, { icon: string; bg: string; border: string; text: string }> = {
  Mild:   { icon: '❄️', bg: '#f0f9ff', border: '#7dd3fc', text: '#0369a1' },
  Warm:   { icon: '🌶️', bg: '#fff7ed', border: '#fdba74', text: '#c2410c' },
  Medium: { icon: '🌶️🌶️', bg: '#fff7ed', border: '#fb923c', text: '#c2410c' },
  Hot:    { icon: '🔥', bg: '#fef2f2', border: '#f87171', text: '#b91c1c' },
  Fiery:  { icon: '🔥🔥', bg: '#fef2f2', border: '#ef4444', text: '#991b1b' },
};

const FDA_BIG_9 = ['dairy', 'eggs', 'fish', 'crustacean shellfish', 'tree nuts', 'peanuts', 'wheat', 'soybeans', 'sesame'] as const;
const DIETARY_RESTRICTIONS_LIST = ['vegetarian', 'vegan', 'gluten-free', 'kosher', 'halal'] as const;

const ALLERGEN_LABELS: Record<string, string> = {
  'dairy': 'Dairy', 'eggs': 'Eggs', 'fish': 'Fish', 'crustacean shellfish': 'Shellfish',
  'tree nuts': 'Tree Nuts', 'peanuts': 'Peanuts', 'wheat': 'Wheat', 'soybeans': 'Soybeans', 'sesame': 'Sesame',
};
const DIETARY_LABELS: Record<string, string> = {
  'vegetarian': 'Vegetarian', 'vegan': 'Vegan', 'gluten-free': 'Gluten-Free', 'kosher': 'Kosher', 'halal': 'Halal',
};

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
}

// ── Mode config ───────────────────────────────────────────────────────────────

const MODES: { key: BulkMode; label: string; icon: React.ReactNode }[] = [
  { key: 'assign',       label: 'Assign',       icon: <PlusCircle size={13} /> },
  { key: 'remove',       label: 'Remove',       icon: <MinusCircle size={13} /> },
  { key: 'boost',        label: 'Boost',        icon: <Zap size={13} /> },
  { key: 'special',      label: 'Special',      icon: <Star size={13} /> },
  { key: 'availability', label: 'Availability', icon: <Eye size={13} /> },
  { key: 'spice',        label: 'Spice',        icon: <Flame size={13} /> },
  { key: 'dietary',      label: 'Dietary',      icon: <Leaf size={13} /> },
  { key: 'delete',       label: 'Delete',       icon: <Trash2 size={13} /> },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function mergeAssociations(
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
  onComplete,
  onBulkSpice,
  onBulkDietary,
}: BulkActionsPanelProps) {
  const service = useMenuManagerService();
  const trackAction = useTrackAction();
  const [mode, setMode] = useState<BulkMode>(initialMode);
  const [executing, setExecuting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mode-specific form state
  const [assignMenuIds, setAssignMenuIds] = useState<Set<string>>(new Set());
  const [assignCategory, setAssignCategory] = useState<string>('');
  const [removeMenuIds, setRemoveMenuIds] = useState<Set<string>>(new Set());
  const [boostLevel, setBoostLevel] = useState<BoostLabel | null>(null);
  const [chefsSpecial, setChefsSpecial] = useState<boolean>(true);
  const [setActive, setSetActive] = useState<boolean>(true);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [pickedHeat, setPickedHeat] = useState<HeatLabel | null>(null);
  const [pickedDietaryTags, setPickedDietaryTags] = useState<Set<string>>(new Set());

  const selectedItems = items.filter((i) => selected.has(i.id));
  const count = selectedItems.length;

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

  async function runDelete() {
    const tasks: Array<() => Promise<void>> = selectedItems.map((item) =>
      () => service.deleteMenuItem(item.id),
    );
    await executeAllVoid(tasks, () => {
      const updated = items.filter((i) => !selected.has(i.id));
      onComplete(updated, selected);
    });
  }

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

  async function runDietary() {
    if (pickedDietaryTags.size === 0) { setError('Select at least one tag'); return; }
    if (!onBulkDietary) { onComplete(items, selected); return; }
    const tags = [...pickedDietaryTags].map((name) => ({
      name,
      type: (FDA_BIG_9 as readonly string[]).includes(name) ? 'allergen' as const : 'dietary' as const,
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
        case 'boost':        await runBoost(); break;
        case 'special':      await runSpecial(); break;
        case 'availability': await runAvailability(); break;
        case 'spice':        await runSpice(); break;
        case 'dietary':      await runDietary(); break;
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
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 40,
          background: 'rgba(0,0,0,0.15)',
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
          width: 360,
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
              Bulk actions
            </div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
              {count} item{count !== 1 ? 's' : ''} selected
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
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
          {MODES.map(({ key, label, icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => { setMode(key); setError(null); setDeleteConfirm(false); }}
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

        {/* Mode-specific form */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
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
          {mode === 'spice' && (
            <SpiceForm pickedHeat={pickedHeat} onChange={setPickedHeat} />
          )}
          {mode === 'dietary' && (
            <DietaryForm
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
          {mode === 'delete' && (
            <DeleteForm count={count} confirmed={deleteConfirm} />
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
              onClick={onClose}
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

function SpiceForm({
  pickedHeat,
  onChange,
}: {
  pickedHeat: HeatLabel | null;
  onChange: (v: HeatLabel | null) => void;
}) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
        Set spice level
      </div>
      <p style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 12 }}>
        Applied to all selected items. Click again to deselect.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {HEAT_LABELS.map((label) => {
          const meta = HEAT_META[label];
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
                border: selected ? `2px solid ${meta.border}` : '1px solid var(--border)',
                background: selected ? meta.bg : 'white',
                color: selected ? meta.text : 'var(--text)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>{meta.icon}</span>
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DietaryForm({
  pickedTags,
  onToggle,
}: {
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
          {FDA_BIG_9.map((name) => {
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
                {ALLERGEN_LABELS[name] ?? name}
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
          {DIETARY_RESTRICTIONS_LIST.map((name) => {
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
                {DIETARY_LABELS[name] ?? name}
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

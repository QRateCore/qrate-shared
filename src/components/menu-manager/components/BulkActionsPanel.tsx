'use client';
import { useMenuManagerService } from '../context';

import { useState } from 'react';
import { X, Star, Zap, EyeOff, Eye, Trash2, MinusCircle, PlusCircle } from 'lucide-react';
import type { MenuItemDisplay, MenuSummary, MenuAssociation } from '../../../types/restaurant';
import { CANONICAL_CATEGORIES, BOOST_LABELS, type BoostLabel } from '../lib/menuUtils';
import type { BulkMode } from '../MenuManagerClient';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BulkActionsPanelProps {
  selected: Set<string>;
  items: MenuItemDisplay[];
  menus: MenuSummary[];
  initialMode: BulkMode;
  onClose: () => void;
  /** Called with the full updated items array after successful apply */
  onComplete: (updatedItems: MenuItemDisplay[], clearedIds: Set<string>) => void;
}

// ── Mode config ───────────────────────────────────────────────────────────────

const MODES: { key: BulkMode; label: string; icon: React.ReactNode }[] = [
  { key: 'assign',       label: 'Assign',       icon: <PlusCircle size={13} /> },
  { key: 'remove',       label: 'Remove',       icon: <MinusCircle size={13} /> },
  { key: 'boost',        label: 'Boost',        icon: <Zap size={13} /> },
  { key: 'special',      label: 'Special',      icon: <Star size={13} /> },
  { key: 'availability', label: 'Availability', icon: <Eye size={13} /> },
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
}: BulkActionsPanelProps) {
  const service = useMenuManagerService();
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
        const cat = assignCategory || item.category || 'Uncategorised';
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
    switch (mode) {
      case 'assign':       return runAssign();
      case 'remove':       return runRemove();
      case 'boost':        return runBoost();
      case 'special':      return runSpecial();
      case 'availability': return runAvailability();
      case 'delete':
        if (!deleteConfirm) { setDeleteConfirm(true); return; }
        return runDelete();
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
        <select
          value={category}
          onChange={(e) => onCategoryChange(e.target.value)}
          data-testid="assign-category-select"
          style={{
            width: '100%',
            fontSize: 12,
            color: 'var(--text)',
            background: '#f6f6f6',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-xs)',
            padding: '7px 10px',
          }}
        >
          <option value="">Use item's own category</option>
          {[...CANONICAL_CATEGORIES, 'Uncategorised'].map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
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

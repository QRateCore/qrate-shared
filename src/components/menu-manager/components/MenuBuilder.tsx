'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Star, Plus, Pencil, Check, X, Trash2, RefreshCw } from 'lucide-react';
import type { MenuItemDisplay, MenuSummary, MenuItemJunctionSettings } from '../../../types/restaurant';
import { CANONICAL_CATEGORIES, type MenuColor, intToBoostLabel, BOOST_LABELS } from '../lib/menuUtils';
import type { DragState } from '../MenuManagerClient';
import ItemModifierZones, { type ModifierEntry } from './ItemModifierZones';
import MobileItemModifierPicker from './MobileItemModifierPicker';
import { useIsMobile } from '../../../hooks/useIsMobile';

export interface ModifierUpdatePayload {
  sides: ModifierEntry[];
  recommendations: ModifierEntry[];
  sides_selection_mode: 'and' | 'or';
}

// ── Attention rules ──────────────────────────────────────────────────────────
// An item-in-menu "needs attention" when its displayed price would be empty —
// i.e. neither the per-menu price override nor the base item price is set.
// Used to paint a red border on the MenuItemRow + a count badge on the bucket
// header. STR-251 round 3.
function itemHasAttention(item: MenuItemDisplay, settings: MenuItemJunctionSettings): boolean {
  if (settings.price != null) return false;
  if (item.price != null) return false;
  return true;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface MenuBuilderProps {
  items: MenuItemDisplay[];
  menus: MenuSummary[];
  assignments: Record<string, Record<string, string[]>>;
  junctionSettings: Record<string, MenuItemJunctionSettings>;
  activeMenuId: string | null;
  collapsed: Record<string, boolean>;
  dragging: DragState | null;
  dragOver: { menuId: string; cat: string } | 'pool' | null;
  colorMap: (index: number) => MenuColor;
  getSettings: (menuId: string, itemId: string) => MenuItemJunctionSettings;
  onTabChange: (menuId: string) => void;
  onToggleCollapse: (key: string) => void;
  onUpdateSettings: (menuId: string, itemId: string, patch: MenuItemJunctionSettings) => Promise<void>;
  onDragStart: (e: React.DragEvent, itemId: string, menuId: string, cat: string) => void;
  onDragEnd: () => void;
  onDragEnterBucket: (e: React.DragEvent, menuId: string, cat: string) => void;
  onDragLeaveBucket: (menuId: string, cat: string) => void;
  onDropBucket: (e: React.DragEvent, menuId: string, cat: string) => void;
  onCreateMenu: (name: string) => Promise<void>;
  onEditMenu: (menuId: string) => void;
  onRemoveItemFromMenu: (itemId: string, menuId: string) => void;
  onEditItem: (itemId: string) => void;
  onUpdateModifiers: (parentId: string, payload: ModifierUpdatePayload) => Promise<void>;
  /** When set, scroll to + expand the first occurrence of this item in the active menu */
  scrollToItemId?: string | null;
  onScrollComplete?: () => void;
  /** Callback to re-fetch menus + items from server (for crawl-mid-session refresh). */
  onRefresh?: () => void;
  /** True while a background refresh is in flight. */
  refreshing?: boolean;
}

// ── ModifierBubbles ───────────────────────────────────────────────────────────
// Small circular thumbnails for sides + add-ons, rendered inline on a menu
// item row so owners can see each item's modifiers at a glance.
function ModifierBubbles({
  sides,
  recommendations,
  itemId,
}: {
  sides: ModifierEntry[];
  recommendations: ModifierEntry[];
  itemId: string;
}) {
  if (sides.length === 0 && recommendations.length === 0) return null;

  const MAX = 6;
  const visibleSides = sides.slice(0, MAX);
  const visibleRecs = recommendations.slice(0, MAX - visibleSides.length);
  const overflow = (sides.length - visibleSides.length) + (recommendations.length - visibleRecs.length);
  const hasSeparator = visibleSides.length > 0 && visibleRecs.length > 0;

  const renderBadge = (m: ModifierEntry & { kind: 'side' | 'recommendation' }, i: number) => (
    <div
      key={`${m.kind}-${m.menu_item_id}`}
      title={`${m.name}${m.kind === 'recommendation' ? ' (recommendation)' : ' (side)'}`}
      className="w-5 h-5 rounded-full bg-[var(--bg)] overflow-hidden flex items-center justify-center text-[10px] shrink-0 box-border"
      style={{
        border: `1.5px solid ${m.kind === 'recommendation' ? 'var(--orange-text)' : 'var(--green)'}`,
        marginLeft: i === 0 ? 0 : -4,
      }}
    >
      {m.thumbnail_url ? (
        <img src={m.thumbnail_url} alt="" className="w-full h-full object-cover" draggable={false} />
      ) : (
        '🍽'
      )}
    </div>
  );

  return (
    <div
      data-testid={`modifier-bubbles-${itemId}`}
      className="flex items-center shrink-0 ml-1"
      aria-label={`${sides.length} sides, ${recommendations.length} recommendations`}
    >
      {visibleSides.map((s, i) => renderBadge({ ...s, kind: 'side' }, i))}
      {hasSeparator && <span className="inline-block w-1.5" aria-hidden="true" />}
      {visibleRecs.map((r, i) => renderBadge({ ...r, kind: 'recommendation' }, i))}
      {overflow > 0 && (
        <span className="text-[10px] font-semibold text-[var(--text2)] ml-0.5">
          +{overflow}
        </span>
      )}
    </div>
  );
}

// ── MenuItemRow ───────────────────────────────────────────────────────────────

function MenuItemRow({
  item,
  menuId,
  cat,
  settings,
  itemsById,
  onUpdateSettings,
  onUpdateModifiers,
  onDragStart,
  onDragEnd,
  onRemove,
  onEdit,
}: {
  item: MenuItemDisplay;
  menuId: string;
  cat: string;
  settings: MenuItemJunctionSettings;
  itemsById: Map<string, MenuItemDisplay>;
  onUpdateSettings: (menuId: string, itemId: string, patch: MenuItemJunctionSettings) => Promise<void>;
  onUpdateModifiers: (parentId: string, payload: ModifierUpdatePayload) => Promise<void>;
  onDragStart: (e: React.DragEvent, itemId: string, menuId: string, cat: string) => void;
  onDragEnd: () => void;
  onRemove: () => void;
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const isMobile = useIsMobile();

  // Local controlled state for inline form
  const [priceStr, setPriceStr] = useState(
    settings.price != null ? String(settings.price) : '',
  );
  const [chefsSpecial, setChefsSpecial] = useState(settings.chefs_special ?? false);
  const [portionType, setPortionType] = useState<'single' | 'shared'>(
    settings.portion_type ?? 'single',
  );
  const [portionServes, setPortionServes] = useState(
    settings.portion_serves != null ? String(settings.portion_serves) : '',
  );

  // STR-262: Re-sync local form state when settings prop changes externally
  // (e.g. when the useEffect rebuild in MenuManagerClient overwrites
  // junctionSettings). Without this, local priceStr/chefsSpecial/portionType/
  // portionServes become stale after any items state change.
  const prevSettingsRef = useRef(settings);
  useEffect(() => {
    if (prevSettingsRef.current !== settings) {
      setPriceStr(settings.price != null ? String(settings.price) : '');
      setChefsSpecial(settings.chefs_special ?? false);
      setPortionType(settings.portion_type ?? 'single');
      setPortionServes(settings.portion_serves != null ? String(settings.portion_serves) : '');
      prevSettingsRef.current = settings;
    }
  }, [settings]);

  const boostLabel = intToBoostLabel(
    typeof settings.boost_level === 'number'
      ? settings.boost_level
      : settings.boost_level != null
        ? Number(settings.boost_level)
        : null,
  );

  async function save(patch: MenuItemJunctionSettings) {
    setSaving(true);
    try {
      await onUpdateSettings(menuId, item.id, patch);
    } finally {
      setSaving(false);
    }
  }

  function handlePriceBlur() {
    const val = priceStr.trim() === '' ? null : parseFloat(priceStr);
    if (val === settings.price) return;
    if (priceStr.trim() !== '' && isNaN(val!)) {
      setPriceStr(settings.price != null ? String(settings.price) : '');
      return;
    }
    save({ price: val });
  }

  function handleBoostChange(label: string | null) {
    const newLevel = label == null ? null : String(BOOST_LABELS.indexOf(label as typeof BOOST_LABELS[number]) + 1);
    save({ boost_level: newLevel });
  }

  function handleChefsSpecial() {
    const next = !chefsSpecial;
    setChefsSpecial(next);
    save({ chefs_special: next });
  }

  function handlePortionType(type: 'single' | 'shared') {
    setPortionType(type);
    const patch: MenuItemJunctionSettings = { portion_type: type };
    if (type === 'single') patch.portion_serves = null;
    save(patch);
  }

  function handlePortionServesBlur() {
    const val = portionServes.trim() === '' ? null : parseInt(portionServes, 10);
    if (val === settings.portion_serves) return;
    if (portionServes.trim() !== '' && isNaN(val!)) {
      setPortionServes(settings.portion_serves != null ? String(settings.portion_serves) : '');
      return;
    }
    save({ portion_serves: val });
  }

  const displayPrice =
    settings.price != null
      ? `$${Number(settings.price).toFixed(2)}`
      : item.price != null
        ? `$${Number(item.price).toFixed(2)}`
        : null;

  const attention = itemHasAttention(item, settings);
  const pendingAddons = (item.addons ?? []).filter((a) => a.status === 'suggested').length;

  const borderLeftColor = attention ? 'var(--red)' : pendingAddons > 0 ? '#f59e0b' : 'transparent';

  return (
    <div
      draggable
      onDragStart={(e) => { e.stopPropagation(); onDragStart(e, item.id, menuId, cat); }}
      onDragEnd={onDragEnd}
      data-testid={`menu-item-row-${item.id}`}
      data-item-row-id={item.id}
      data-expanded={expanded ? 'true' : 'false'}
      data-attention={attention ? 'true' : undefined}
      data-pending-addons={pendingAddons > 0 ? pendingAddons : undefined}
      className={`border-b border-[var(--border)] cursor-grab ${expanded ? 'bg-[var(--bg)]' : ''}`}
      style={{ borderLeft: `3px solid ${borderLeftColor}` }}
    >
      <div className="flex items-stretch">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        data-testid={`menu-item-expand-${item.id}`}
        data-expand-btn="true"
        className={`flex-1 min-w-0 bg-transparent border-none cursor-grab text-left ${isMobile ? 'flex flex-col gap-1 px-2 py-2' : 'flex flex-row items-center gap-2 px-3 py-2'}`}
      >
        {isMobile ? (
          <>
            {/* Mobile row 1 — chevron + full-width name + badges */}
            <div className="flex items-center gap-1.5 w-full min-w-0">
              <span className="text-[var(--text2)] shrink-0">
                {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </span>
              <span className="text-[13px] font-medium text-[var(--text)] overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0">
                {item.name}
              </span>
              {/* Badges */}
              <div className="flex items-center gap-1 shrink-0">
                {chefsSpecial && (
                  <Star size={12} fill="#f59e0b" color="#f59e0b" data-testid={`chefs-special-badge-${item.id}`} />
                )}
                {boostLabel && (
                  <span className="badge badge-green text-[10px] !py-0 !px-1.5" data-testid={`boost-badge-${item.id}`}>
                    {boostLabel}
                  </span>
                )}
                {displayPrice && (
                  <span
                    className={`text-[11px] font-semibold ${settings.price != null ? 'text-[var(--blue)]' : 'text-[var(--text2)]'}`}
                    data-testid={`price-display-${item.id}`}
                  >
                    {displayPrice}
                    {settings.price != null && <span className="text-[9px] ml-0.5">↑</span>}
                  </span>
                )}
                {pendingAddons > 0 && (
                  <span
                    className="text-[10px] font-bold px-1.5 py-px rounded"
                    data-testid={`pending-addons-badge-${item.id}`}
                    style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #f59e0b' }}
                  >
                    {pendingAddons} addon{pendingAddons !== 1 ? 's' : ''}
                  </span>
                )}
                {!item.active && (
                  <span className="badge badge-green text-[10px] !py-0 !px-1.5 !bg-[var(--red-bg)] !text-[var(--red)]">86'd</span>
                )}
                {saving && (
                  <span className="text-[10px] text-[var(--text2)]">saving…</span>
                )}
              </div>
            </div>

            {/* Mobile row 2 — thumbnail + modifier bubbles, indented under name */}
            <div className="flex items-center gap-2 pl-5">
              <div className="w-7 h-7 rounded-full bg-[var(--bg)] shrink-0 overflow-hidden flex items-center justify-center text-xs">
                {item.thumbnail_url ? (
                  <img src={item.thumbnail_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  '🍽'
                )}
              </div>
              <ModifierBubbles
                sides={(item.sides ?? []) as ModifierEntry[]}
                recommendations={(item.recommendations ?? []) as ModifierEntry[]}
                itemId={item.id}
              />
            </div>
          </>
        ) : (
          <>
            <span className="text-[var(--text2)] shrink-0">
              {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </span>

            {/* Thumbnail */}
            <div className="w-8 h-8 rounded-[var(--r-xs)] bg-[var(--bg)] shrink-0 overflow-hidden flex items-center justify-center text-sm">
              {item.thumbnail_url ? (
                <img src={item.thumbnail_url} alt="" className="w-full h-full object-cover" />
              ) : (
                '🍽'
              )}
            </div>

            {/* Name */}
            <span className="text-[13px] font-medium text-[var(--text)] overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
              {item.name}
            </span>

            <ModifierBubbles
              sides={(item.sides ?? []) as ModifierEntry[]}
              recommendations={(item.recommendations ?? []) as ModifierEntry[]}
              itemId={item.id}
            />

            <span className="flex-1" />

            {/* Badges */}
            <div className="flex items-center gap-1 shrink-0">
              {chefsSpecial && (
                <Star size={12} fill="#f59e0b" color="#f59e0b" data-testid={`chefs-special-badge-${item.id}`} />
              )}
              {boostLabel && (
                <span className="badge badge-green text-[10px] !py-0 !px-1.5" data-testid={`boost-badge-${item.id}`}>
                  {boostLabel}
                </span>
              )}
              {displayPrice && (
                <span
                  className={`text-[11px] font-semibold ${settings.price != null ? 'text-[var(--blue)]' : 'text-[var(--text2)]'}`}
                  data-testid={`price-display-${item.id}`}
                >
                  {displayPrice}
                  {settings.price != null && <span className="text-[9px] ml-0.5">↑</span>}
                </span>
              )}
              {pendingAddons > 0 && (
                <span
                  className="text-[10px] font-bold px-1.5 py-px rounded"
                  data-testid={`pending-addons-badge-${item.id}`}
                  style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #f59e0b' }}
                >
                  {pendingAddons} addon{pendingAddons !== 1 ? 's' : ''}
                </span>
              )}
              {!item.active && (
                <span className="badge badge-green text-[10px] !py-0 !px-1.5 !bg-[var(--red-bg)] !text-[var(--red)]">86'd</span>
              )}
            </div>

            {saving && (
              <span className="text-[10px] text-[var(--text2)] ml-1">saving…</span>
            )}
          </>
        )}
      </button>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onEdit(); }}
        data-testid={`edit-menu-item-${item.id}`}
        aria-label={`Edit ${item.name}`}
        title="Edit item"
        className="shrink-0 w-8 p-0 bg-transparent border-none border-l border-l-[var(--border)] text-[var(--text2)] cursor-pointer flex items-center justify-center hover:text-[var(--text)]"
      >
        <Pencil size={14} />
      </button>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        data-testid={`remove-from-menu-${item.id}`}
        aria-label={`Remove ${item.name} from menu`}
        title="Remove from menu"
        className="shrink-0 w-8 p-0 bg-transparent border-none border-l border-l-[var(--border)] text-[var(--text2)] cursor-pointer flex items-center justify-center hover:text-[var(--red)]"
      >
        <Trash2 size={14} />
      </button>
      </div>

      {/* Expanded settings — desktop: editable fields on the left, drop zones on
          the right (STR-251 Atanu round 2 #15). Mobile: stacked column with the
          search-driven modifier picker rendered below the Portion area
          (STR-251 mobile + camera 2026-04-08). */}
      {expanded && (
        <div
          className={`flex items-start ${isMobile ? 'flex-col gap-3.5 px-3 py-2.5 pl-4' : 'flex-row gap-4 px-3 py-2.5 pl-[52px]'}`}
          data-testid={`menu-item-settings-${item.id}`}
        >
          {/* Left column: editable fields */}
          <div className={`flex flex-col gap-2.5 shrink-0 min-w-0 ${isMobile ? 'w-full' : ''}`}>
          {/* Price override */}
          <div className="flex items-center gap-2">
            <label className="section-header !mb-0 w-[100px] shrink-0" htmlFor={`price-${menuId}-${item.id}`}>
              Menu price
            </label>
            <div
              className={`flex items-center gap-1 rounded-[var(--r-xs)] bg-white px-2 py-1 ${attention ? 'border-2 border-[var(--red)]' : 'border border-[var(--border)]'}`}
              data-testid={`price-input-wrapper-${item.id}`}
              data-attention={attention ? 'true' : undefined}
            >
              <span className="text-xs text-[var(--text2)]">$</span>
              <input
                id={`price-${menuId}-${item.id}`}
                type="number"
                min="0"
                step="0.01"
                value={priceStr}
                onChange={(e) => setPriceStr(e.target.value)}
                onBlur={handlePriceBlur}
                placeholder={item.price != null ? String(item.price) : ''}
                data-testid={`price-input-${item.id}`}
                className="border-none outline-none text-xs w-[72px] bg-transparent text-[var(--text)]"
              />
            </div>
            {settings.price != null && (
              <button
                type="button"
                onClick={() => { setPriceStr(''); save({ price: null }); }}
                className="text-[10px] text-[var(--text2)] bg-transparent border-none cursor-pointer px-1 py-0.5"
                data-testid={`price-clear-${item.id}`}
              >
                ✕ clear
              </button>
            )}
          </div>

          {/* Boost level */}
          <div className="flex items-center gap-2">
            <span className="section-header !mb-0 w-[100px] shrink-0">Boost level</span>
            <div className="flex gap-1">
              {([null, ...BOOST_LABELS] as const).map((level) => {
                const isActive = level === null ? boostLabel === null : boostLabel === level;
                return (
                  <button
                    key={level ?? 'none'}
                    type="button"
                    onClick={() => handleBoostChange(level)}
                    data-testid={`boost-btn-${level ?? 'none'}-${item.id}`}
                    className={`text-[11px] font-semibold py-0.5 px-2 rounded-[var(--r-xs)] cursor-pointer ${
                      isActive
                        ? 'border-2 border-[var(--blue)] bg-[var(--blue-bg)] text-[var(--blue)]'
                        : 'border border-[var(--border)] bg-white text-[var(--text2)]'
                    }`}
                  >
                    {level ?? 'None'}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Chef's special */}
          <div className="flex items-center gap-2">
            <span className="section-header !mb-0 w-[100px] shrink-0">Chef's special</span>
            <button
              type="button"
              onClick={handleChefsSpecial}
              data-testid={`chefs-special-toggle-${item.id}`}
              aria-pressed={chefsSpecial}
              className={`flex items-center gap-1.5 text-[11px] font-semibold py-0.5 px-2.5 rounded-[var(--r-xs)] cursor-pointer ${
                chefsSpecial
                  ? 'border-2 border-amber-400 bg-amber-50 text-amber-700'
                  : 'border border-[var(--border)] bg-white text-[var(--text2)]'
              }`}
            >
              <Star size={11} fill={chefsSpecial ? '#f59e0b' : 'none'} color={chefsSpecial ? '#f59e0b' : 'currentColor'} />
              {chefsSpecial ? 'Featured' : 'Not featured'}
            </button>
          </div>

          {/* Portion type */}
          <div className="flex items-start gap-2">
            <span className="section-header !mb-0 w-[100px] shrink-0 pt-0.5">Portion</span>
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-1">
                {(['single', 'shared'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => handlePortionType(t)}
                    data-testid={`portion-btn-${t}-${item.id}`}
                    className={`text-[11px] font-semibold py-0.5 px-2 rounded-[var(--r-xs)] cursor-pointer capitalize ${
                      portionType === t
                        ? 'border-2 border-[var(--blue)] bg-[var(--blue-bg)] text-[var(--blue)]'
                        : 'border border-[var(--border)] bg-white text-[var(--text2)]'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {portionType === 'shared' && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-[var(--text2)]">Serves</span>
                  <input
                    type="number"
                    min="2"
                    max="20"
                    value={portionServes}
                    onChange={(e) => setPortionServes(e.target.value)}
                    onBlur={handlePortionServesBlur}
                    placeholder="e.g. 4"
                    data-testid={`portion-serves-input-${item.id}`}
                    className="border border-[var(--border)] rounded-[var(--r-xs)] py-0.5 px-2 text-xs w-14 outline-none"
                  />
                  <span className="text-[11px] text-[var(--text2)]">guests</span>
                </div>
              )}
            </div>
          </div>

          </div>
          {/* Right column / mobile bottom: Sides + Add-ons */}
          <div className={`flex-1 min-w-0 ${isMobile ? 'w-full' : ''}`}>
            {isMobile ? (
              <MobileItemModifierPicker parent={item} itemsById={itemsById} onUpdate={onUpdateModifiers} />
            ) : (
              <ItemModifierZones
                parent={item}
                itemsById={itemsById}
                onUpdate={onUpdateModifiers}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── CategoryBucket ────────────────────────────────────────────────────────────

function CategoryBucket({
  category,
  itemIds,
  itemsById,
  menuId,
  collapsed,
  getSettings,
  color,
  onToggleCollapse,
  onUpdateSettings,
  onUpdateModifiers,
  isDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  onDragStart,
  onDragEnd,
  onRemoveItem,
  onEditItem,
}: {
  category: string;
  itemIds: string[];
  itemsById: Map<string, MenuItemDisplay>;
  menuId: string;
  collapsed: boolean;
  getSettings: (menuId: string, itemId: string) => MenuItemJunctionSettings;
  color: MenuColor;
  onToggleCollapse: () => void;
  onUpdateSettings: (menuId: string, itemId: string, patch: MenuItemJunctionSettings) => Promise<void>;
  onUpdateModifiers: (parentId: string, payload: ModifierUpdatePayload) => Promise<void>;
  isDragOver: boolean;
  onDragEnter: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onDragStart: (e: React.DragEvent, itemId: string, menuId: string, cat: string) => void;
  onDragEnd: () => void;
  onRemoveItem: (itemId: string, menuId: string) => void;
  onEditItem: (itemId: string) => void;
}) {
  const bucketItems = itemIds.map((id) => itemsById.get(id)).filter(Boolean) as MenuItemDisplay[];

  // STR-251 round 3 — rollup attention indicator. Empty buckets are themselves
  // "needs attention". Non-empty buckets show the count of items whose
  // displayed price is missing.
  const attentionCount = bucketItems.reduce(
    (n, it) => n + (itemHasAttention(it, getSettings(menuId, it.id)) ? 1 : 0),
    0,
  );
  const bucketEmpty = bucketItems.length === 0;
  const bucketHasAttention = bucketEmpty || attentionCount > 0;

  return (
    <div
      className="mb-1"
      data-testid={`category-bucket-${category}`}
      data-attention={bucketHasAttention ? 'true' : undefined}
    >
      {/* Bucket header */}
      <button
        type="button"
        onClick={onToggleCollapse}
        data-testid={`collapse-bucket-${category}`}
        className="w-full flex items-center gap-2 py-1.5 px-3 cursor-pointer text-left transition-colors duration-150"
        style={{
          background: isDragOver ? `${color.tab}cc` : 'var(--bg)',
          border: bucketHasAttention ? '2px solid var(--red)' : 'none',
          borderLeft: bucketHasAttention ? '4px solid var(--red)' : `3px solid ${color.bucket}`,
        }}
      >
        <span className="text-[var(--text2)] shrink-0">
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </span>
        <span className="text-xs font-bold text-[var(--text)] flex-1">
          {category}
        </span>
        {bucketEmpty ? (
          <span
            data-testid={`bucket-attention-empty-${category}`}
            className="text-[10px] font-bold text-white bg-[var(--red)] rounded-full px-2 py-px uppercase tracking-wide"
            title="No items in this category yet"
          >
            Empty
          </span>
        ) : attentionCount > 0 ? (
          <span
            data-testid={`bucket-attention-count-${category}`}
            className="text-[10px] font-bold text-white bg-[var(--red)] rounded-full px-1.5 py-px inline-flex items-center gap-0.5"
            title={`${attentionCount} item${attentionCount === 1 ? '' : 's'} need attention`}
          >
            ⚠ {attentionCount}
          </span>
        ) : null}
        <span className="text-[10px] font-semibold text-[var(--text2)] bg-[var(--bg)] rounded-full px-1.5 py-px">
          {bucketItems.length}
        </span>
      </button>

      {/* Bucket items + drop zone */}
      {!collapsed && (
        <div
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          data-testid={`bucket-drop-${category}`}
          className="min-h-10 transition-all duration-150"
          style={{
            background: isDragOver ? color.tab : 'transparent',
            border: isDragOver ? `2px dashed ${color.tabBorder}` : '2px dashed transparent',
            borderRadius: isDragOver ? 'var(--r-xs)' : 0,
            margin: isDragOver ? '2px 4px' : 0,
          }}
        >
          {bucketItems.length === 0 ? (
            <div
              data-testid={`category-empty-${category}`}
              className="px-3 py-2.5 text-[11px] text-[var(--text2)] italic"
            >
              {isDragOver ? 'Drop to assign here' : 'No items in this category yet'}
            </div>
          ) : (
            bucketItems.map((item) => (
              <MenuItemRow
                key={item.id}
                item={item}
                menuId={menuId}
                cat={category}
                settings={getSettings(menuId, item.id)}
                itemsById={itemsById}
                onUpdateSettings={onUpdateSettings}
                onUpdateModifiers={onUpdateModifiers}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onRemove={() => onRemoveItem(item.id, menuId)}
                onEdit={() => onEditItem(item.id)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── MenuBuilder ───────────────────────────────────────────────────────────────

export default function MenuBuilder({
  items,
  menus,
  assignments,
  junctionSettings: _junctionSettings,
  activeMenuId,
  collapsed,
  dragging,
  dragOver,
  colorMap,
  getSettings,
  onTabChange,
  onToggleCollapse,
  onUpdateSettings,
  onDragStart,
  onDragEnd,
  onDragEnterBucket,
  onDragLeaveBucket,
  onDropBucket,
  onCreateMenu,
  onEditMenu,
  onRemoveItemFromMenu,
  onEditItem,
  onUpdateModifiers,
  scrollToItemId,
  onScrollComplete,
  onRefresh,
  refreshing = false,
}: MenuBuilderProps) {
  const itemsById = new Map(items.map((i) => [i.id, i] as const));

  // Scroll to + expand an item row when requested (e.g. from "appears in menu" click)
  useEffect(() => {
    if (!scrollToItemId) return;
    const timer = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-item-row-id="${scrollToItemId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (el.getAttribute('data-expanded') === 'false') {
          const btn = el.querySelector<HTMLElement>('[data-expand-btn="true"]');
          btn?.click();
        }
      }
      onScrollComplete?.();
    }, 150);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToItemId, activeMenuId]);
  const [addingMenu, setAddingMenu] = useState(false);
  const [newMenuName, setNewMenuName] = useState('');
  const [creating, setCreating] = useState(false);
  const newMenuInputRef = useRef<HTMLInputElement>(null);
  const activeMenu = menus.find((m) => m.id === activeMenuId) ?? menus[0] ?? null;
  const activeMenuIndex = activeMenu ? menus.findIndex((m) => m.id === activeMenu.id) : 0;
  const activeColor = colorMap(activeMenuIndex);

  // Buckets to render: all 8 canonical + Uncategorised, but only non-empty unless dragging
  const activeAssignments = activeMenu ? (assignments[activeMenu.id] ?? {}) : {};
  const ALL_BUCKETS = [...CANONICAL_CATEGORIES, 'Uncategorised'] as const;
  // Always show all canonical categories, even empty ones
  const visibleBuckets = ALL_BUCKETS;

  const totalItems = activeMenu
    ? Object.values(activeAssignments).reduce((s, ids) => s + ids.length, 0)
    : 0;

  if (menus.length === 0) {
    return (
      <div
        className="flex flex-col h-full bg-[var(--white)] rounded-[var(--r)] border border-[var(--border)] items-center justify-center gap-2 text-[var(--text2)] text-[13px]"
        data-testid="menu-builder-panel"
      >
        <span className="text-2xl">🍽</span>
        <span className="font-semibold">No menus yet</span>
        <span className="text-xs">Create a menu to start organising items</span>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full bg-[var(--white)] rounded-[var(--r)] border border-[var(--border)] overflow-hidden"
      data-testid="menu-builder-panel"
    >
      {/* Tab bar */}
      <div
        className="flex items-end px-3 border-b border-[var(--border)] overflow-x-auto shrink-0"
        data-testid="menu-tab-bar"
      >
        {menus.map((menu) => {
          const isActive = menu.id === activeMenu?.id;
          return (
            <div key={menu.id} className="flex items-center">
              <button
                type="button"
                onClick={() => onTabChange(menu.id)}
                data-testid={`menu-tab-${menu.id}`}
                className={`flex items-center gap-1.5 px-3.5 py-3 text-sm border-none cursor-pointer whitespace-nowrap transition-all duration-150 ${
                  isActive
                    ? 'font-semibold text-[var(--brand-s)] bg-[rgba(255,107,43,0.05)] border-b-2 border-b-[var(--brand-s)]'
                    : 'font-medium text-[var(--text2)] bg-transparent border-b-2 border-b-transparent'
                }`}
              >
                {menu.name}
                {isActive && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); onEditMenu(menu.id); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onEditMenu(menu.id); } }}
                    data-testid={`edit-menu-tab-${menu.id}`}
                    aria-label={`Edit ${menu.name}`}
                    className="inline-flex items-center p-0.5 rounded-[var(--r-xs)] text-[var(--brand-s)] cursor-pointer opacity-70 hover:opacity-100"
                  >
                    <Pencil size={11} />
                  </span>
                )}
              </button>
            </div>
          );
        })}

        {/* Inline new-menu form / + button */}
        {addingMenu ? (
          <div className="flex items-center gap-1 px-2 py-1.5 shrink-0">
            <input
              ref={newMenuInputRef}
              type="text"
              value={newMenuName}
              onChange={(e) => setNewMenuName(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter') {
                  if (!newMenuName.trim()) return;
                  setCreating(true);
                  await onCreateMenu(newMenuName.trim());
                  setNewMenuName('');
                  setAddingMenu(false);
                  setCreating(false);
                }
                if (e.key === 'Escape') { setAddingMenu(false); setNewMenuName(''); }
              }}
              placeholder="Menu name…"
              autoFocus
              data-testid="new-menu-name-input"
              className="text-xs border border-[var(--blue)] rounded-[var(--r-xs)] py-0.5 px-2 outline-none w-[130px]"
            />
            <button
              type="button"
              disabled={creating || !newMenuName.trim()}
              onClick={async () => {
                if (!newMenuName.trim()) return;
                setCreating(true);
                await onCreateMenu(newMenuName.trim());
                setNewMenuName('');
                setAddingMenu(false);
                setCreating(false);
              }}
              data-testid="confirm-new-menu-btn"
              className="bg-transparent border-none cursor-pointer text-[var(--blue)] flex items-center p-0.5"
            >
              <Check size={14} />
            </button>
            <button
              type="button"
              onClick={() => { setAddingMenu(false); setNewMenuName(''); }}
              data-testid="cancel-new-menu-btn"
              className="bg-transparent border-none cursor-pointer text-[var(--text2)] flex items-center p-0.5"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setAddingMenu(true); setTimeout(() => newMenuInputRef.current?.focus(), 0); }}
            data-testid="add-menu-btn"
            className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-[var(--blue)] bg-transparent border-none cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus size={13} />
            New menu
          </button>
        )}
      </div>

      {/* Active menu header */}
      {activeMenu && (
        <div className="px-3.5 pt-2.5 pb-2 border-b border-[var(--border)] flex items-center gap-2 shrink-0">
          <span className="text-[13px] font-bold text-[var(--text)] flex-1">
            {activeMenu.name}
          </span>
          <span
            className="text-[11px] text-[var(--text2)] bg-[var(--bg)] rounded-full px-2 py-0.5"
            data-testid="active-menu-item-count"
          >
            {totalItems} item{totalItems !== 1 ? 's' : ''}
          </span>
          {!activeMenu.active && (
            <span className="badge badge-green text-[10px] !bg-[var(--red-bg)] !text-[var(--red)]">
              Inactive
            </span>
          )}
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              data-testid="refresh-menus-btn"
              title="Refresh menus — picks up any newly crawled menus"
              className="flex items-center gap-1 p-1 rounded-[var(--r-xs)] text-[var(--text2)] bg-transparent border-none cursor-pointer opacity-60 hover:opacity-100 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            </button>
          )}
        </div>
      )}

      {/* Category buckets */}
      <div className="flex-1 overflow-y-auto py-2">
        {(visibleBuckets as readonly string[]).map((cat) => {
            const collapseKey = `${activeMenu?.id}:${cat}`;
            const isDragOverBucket =
              dragOver !== null &&
              dragOver !== 'pool' &&
              dragOver.menuId === activeMenu?.id &&
              dragOver.cat === cat;

            return (
              <CategoryBucket
                key={cat}
                category={cat}
                itemIds={activeAssignments[cat] ?? []}
                itemsById={itemsById}
                menuId={activeMenu!.id}
                collapsed={collapsed[collapseKey] ?? false}
                getSettings={getSettings}
                color={activeColor}
                onToggleCollapse={() => onToggleCollapse(collapseKey)}
                onUpdateSettings={onUpdateSettings}
                onUpdateModifiers={onUpdateModifiers}
                isDragOver={isDragOverBucket}
                onDragEnter={(e) => onDragEnterBucket(e, activeMenu!.id, cat)}
                onDragLeave={() => onDragLeaveBucket(activeMenu!.id, cat)}
                onDrop={(e) => onDropBucket(e, activeMenu!.id, cat)}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onRemoveItem={onRemoveItemFromMenu}
                onEditItem={onEditItem}
              />
            );
          })}
      </div>
    </div>
  );
}

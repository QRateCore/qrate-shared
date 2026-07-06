'use client';

/**
 * Mobile-only layout for the menu manager. Renders the MenuBuilder full-width
 * as the primary surface and exposes the ItemPool via a slide-up bottom drawer
 * triggered by a floating "Items" button.
 *
 * The component is a thin shell — both ItemPool and MenuBuilder receive their
 * existing prop set untouched (typed via ComponentProps so any signature drift
 * in either child is caught by the TypeScript scrutiniser). Drag-and-drop
 * handlers, attention rules, undo toast, etc. are all driven by the parent
 * (MenuManagerClient) just like on desktop.
 *
 * STR-251 mobile + camera (2026-04-08).
 */
import { type ComponentProps, useState } from 'react';
import { Package, ChevronDown, X } from 'lucide-react';
import ItemPool from './ItemPool';
import MenuBuilder from './MenuBuilder';
import ItemPoolDrawer from './ItemPoolDrawer';
import { getMenuTabStatus, formatMenuTabSubLabel } from './MenuTabBar';
import type { MenuSummary } from '../../../types/restaurant';

// STR-858 mobile menu switcher — inline status pill (the desktop MenuTabBar's
// pill component is local/unexported; reuse the exported getMenuTabStatus and
// render a compact equivalent so mobile stays visually consistent).
const STATUS_PILL: Record<string, { bg: string; fg: string; label: string }> = {
  active: { bg: '#dcfce7', fg: '#15803d', label: 'Live now' },
  scheduled: { bg: '#fef3c7', fg: '#92400e', label: 'Scheduled' },
  archived: { bg: '#f1f5f9', fg: '#64748b', label: 'Paused' },
};

function MobileStatusPill({ status }: { status: 'active' | 'scheduled' | 'archived' }) {
  const s = STATUS_PILL[status];
  return (
    <span
      data-testid={`mobile-menu-status-${status}`}
      style={{
        fontSize: 11, fontWeight: 700, color: s.fg, background: s.bg,
        borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap', flexShrink: 0,
      }}
    >
      {s.label}
    </span>
  );
}

interface MobileMenuManagerLayoutProps {
  itemsCount: number;
  /**
   * Drawer is a CONTROLLED component — the parent (MenuManagerClient) owns
   * the open/close state so the existing handleDropBucket flow can close it
   * automatically after a successful pool→bucket drop. STR-251 mobile + camera.
   */
  drawerOpen: boolean;
  onDrawerOpenChange: (open: boolean) => void;
  itemPoolProps: ComponentProps<typeof ItemPool>;
  menuBuilderProps: ComponentProps<typeof MenuBuilder>;
  /** STR-858 — mobile menu switcher. Desktop uses MenuTabBar (not rendered on
   * mobile); this surfaces menu switching + a live/scheduled indicator on a
   * phone. Handlers are the same ones the desktop tab bar drives. */
  menus: MenuSummary[];
  activeMenuId: string | null;
  onSelectMenu: (id: string) => void;
}

export default function MobileMenuManagerLayout({
  itemsCount,
  drawerOpen,
  onDrawerOpenChange,
  itemPoolProps,
  menuBuilderProps,
  menus,
  activeMenuId,
  onSelectMenu,
}: MobileMenuManagerLayoutProps) {
  const [menuSheetOpen, setMenuSheetOpen] = useState(false);
  const now = new Date();
  const activeMenu = menus.find((m) => m.id === activeMenuId) ?? menus[0] ?? null;
  const activeStatus = activeMenu ? getMenuTabStatus(activeMenu, now) : null;

  return (
    <>
      {/* STR-858 mobile menu switcher — full-width selector: active menu name
          + live/scheduled pill + ▾. Replaces the desktop horizontal tab strip
          (no horizontal scroll). Tapping opens a bottom-sheet menu list. */}
      {activeMenu && (
        <button
          type="button"
          data-testid="mobile-menu-switcher"
          onClick={() => setMenuSheetOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={menuSheetOpen}
          style={{
            flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 10, width: '100%',
            minHeight: 48, padding: '8px 12px', marginBottom: 8,
            background: 'var(--white, #fff)', border: '1px solid var(--border)',
            borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
          }}
        >
          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1, gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {activeMenu.name}
            </span>
            {menus.length > 1 && (
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                {menus.length} menus · tap to switch
              </span>
            )}
          </span>
          {activeStatus && <MobileStatusPill status={activeStatus} />}
          <ChevronDown size={18} style={{ flexShrink: 0, color: 'var(--text3)' }} />
        </button>
      )}

      {/* Menu list bottom-sheet — each row ≥44px with status pill + schedule */}
      {menuSheetOpen && (
        <>
          <div
            data-testid="mobile-menu-sheet-backdrop"
            onClick={() => setMenuSheetOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 55, background: 'rgba(0,0,0,0.4)' }}
          />
          <div
            data-testid="mobile-menu-sheet"
            role="dialog"
            aria-label="Switch menu"
            style={{
              position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 56,
              background: 'var(--white, #fff)', borderTopLeftRadius: 18, borderTopRightRadius: 18,
              maxHeight: '70vh', display: 'flex', flexDirection: 'column',
              boxShadow: '0 -8px 30px rgba(0,0,0,0.25)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Switch menu</span>
              <button
                type="button"
                aria-label="Close"
                data-testid="mobile-menu-sheet-close"
                onClick={() => setMenuSheetOpen(false)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 44, minHeight: 44, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text2)' }}
              >
                <X size={20} />
              </button>
            </div>
            <div style={{ overflowY: 'auto', padding: 8 }}>
              {menus.map((m) => {
                const status = getMenuTabStatus(m, now);
                const isActive = m.id === activeMenuId;
                return (
                  <button
                    key={m.id}
                    type="button"
                    data-testid={`mobile-menu-sheet-item-${m.id}`}
                    onClick={() => { onSelectMenu(m.id); setMenuSheetOpen(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                      minHeight: 52, padding: '10px 12px', marginBottom: 2,
                      background: isActive ? 'rgba(255,107,43,0.06)' : 'transparent',
                      border: isActive ? '1px solid var(--brand-s)' : '1px solid transparent',
                      borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                    }}
                  >
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1, gap: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: isActive ? 700 : 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {m.name}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text3)' }}>{formatMenuTabSubLabel(m)}</span>
                    </span>
                    <MobileStatusPill status={status} />
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Full-width MenuBuilder occupies the primary surface. paddingBottom
          clears the floating "Items" FAB so the last course/row isn't hidden
          under it (STR-858 P3). */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          paddingBottom: 76,
        }}
        data-testid="mobile-menu-manager"
      >
        <MenuBuilder {...menuBuilderProps} />
      </div>

      {/* Floating "Items" FAB — hidden while the drawer is open to avoid
          stacking ambiguity */}
      {!drawerOpen && (
        <button
          type="button"
          onClick={() => onDrawerOpenChange(true)}
          data-testid="mobile-items-fab"
          aria-label={`Open items drawer (${itemsCount} items)`}
          style={{
            position: 'fixed',
            bottom: 20,
            // STR-858 — anchored bottom-LEFT so it clears the Crisp chat bubble
            // (bottom-right); the two round bottom-corner elements were stacking.
            left: 20,
            zIndex: 40,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 18px',
            minHeight: 44,
            borderRadius: 999,
            background: 'var(--blue, #2563eb)',
            color: 'white',
            border: 'none',
            fontSize: 13,
            fontWeight: 700,
            boxShadow: '0 6px 16px rgba(0,0,0,0.25)',
            cursor: 'pointer',
          }}
        >
          <Package size={16} />
          Items
          <span
            data-testid="mobile-items-fab-badge"
            style={{
              fontSize: 11,
              fontWeight: 700,
              background: 'rgba(255,255,255,0.25)',
              borderRadius: 10,
              padding: '1px 8px',
            }}
          >
            {itemsCount}
          </span>
        </button>
      )}

      {/* The drawer body is the existing ItemPool, untouched */}
      <ItemPoolDrawer
        open={drawerOpen}
        onClose={() => onDrawerOpenChange(false)}
        title="Food Items"
      >
        <ItemPool {...itemPoolProps} />
      </ItemPoolDrawer>
    </>
  );
}

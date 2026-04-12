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
import { type ComponentProps } from 'react';
import { Package } from 'lucide-react';
import ItemPool from './ItemPool';
import MenuBuilder from './MenuBuilder';
import ItemPoolDrawer from './ItemPoolDrawer';

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
}

export default function MobileMenuManagerLayout({
  itemsCount,
  drawerOpen,
  onDrawerOpenChange,
  itemPoolProps,
  menuBuilderProps,
}: MobileMenuManagerLayoutProps) {

  return (
    <>
      {/* Full-width MenuBuilder occupies the primary surface */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
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
            right: 20,
            zIndex: 40,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 18px',
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

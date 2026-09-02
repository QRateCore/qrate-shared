// @vitest-environment jsdom
/**
 * Menu Builder per-menu "Includes" drop-zone gate (2026-09-02).
 *
 * `showIncludeZones` gates ONLY the two per-(item, menu) drop zones in the
 * expanded dish row — "Includes All" (sides_and) and "Includes one by choice"
 * (sides_or), i.e. the whole of ItemModifierZones. Three things are pinned:
 *   1. Default TRUE — this package is a submodule shared by owner, waiter and
 *      admin, so an unwired consumer (`undefined`) must keep today's zones.
 *   2. `false` removes the zones entirely (not merely hides them).
 *   3. The gate does not take the rest of the expanded row with it — the
 *      attribute controls still render, and the row still expands/collapses.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { MenuItemDisplay } from '../../../../types/restaurant';
import { _MenuItemRow as MenuItemRow } from '../MenuBuilder';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

const ITEM_ID = 'itm-1';
const MENU_ID = 'menu-1';

function makeItem(): MenuItemDisplay {
  return {
    id: ITEM_ID,
    name: 'Grilled Chicken',
    description: null,
    category: 'Entrees',
    item_type: 'dish',
    thumbnail_url: null,
    price: 12,
    active: true,
    menu_associations: [],
    food_tags: { allergens: [], dietary: [] },
    display_allergens: [],
    display_dietary: [],
    addons: [],
    sides: [],
    sides_and: [],
    sides_or: [],
    recommendations: [],
    gallery_urls: [],
  } as unknown as MenuItemDisplay;
}

const SETTINGS = {
  price: null,
  boost_level: null,
  chefs_special: false,
  portion_type: 'single' as const,
  portion_serves: null,
};

/** ItemModifierZones renders nothing without an adapter, so the gate has to be
 *  tested with a real one — otherwise every assertion passes vacuously. */
function makeAdapter() {
  return {
    get: vi.fn().mockResolvedValue({ sides_and: [], sides_or: [], selection_rule: null }),
    set: vi.fn().mockResolvedValue({ sides_and: [], sides_or: [], selection_rule: null }),
  };
}

function renderExpandedRow(props: Partial<React.ComponentProps<typeof MenuItemRow>> = {}) {
  render(
    <MenuItemRow
      item={makeItem()}
      menuId={MENU_ID}
      cat="Entrees"
      settings={SETTINGS}
      itemsById={new Map()}
      perMenuSides={makeAdapter()}
      onUpdateSettings={vi.fn().mockResolvedValue(undefined)}
      onUpdateModifiers={vi.fn().mockResolvedValue(undefined)}
      onDragStart={vi.fn()}
      onDragEnd={vi.fn()}
      onRemove={vi.fn()}
      onEdit={vi.fn()}
      {...props}
    />,
  );
  fireEvent.click(screen.getByTestId(`menu-item-expand-${ITEM_ID}`));
}

/** The zones mount async (adapter GET) — loading, error and loaded all live
 *  under a `per-menu-sides-*` testid, so match the prefix rather than one state. */
const zoneNodes = () =>
  Array.from(document.querySelectorAll(`[data-testid^="per-menu-sides-"]`));

describe('MenuItemRow — showIncludeZones gate', () => {
  it('renders the Includes zones when the prop is omitted (default true)', async () => {
    renderExpandedRow();
    expect(await screen.findByTestId(`per-menu-sides-${ITEM_ID}`)).toBeTruthy();
  });

  it('renders the Includes zones when explicitly true', async () => {
    renderExpandedRow({ showIncludeZones: true });
    expect(await screen.findByTestId(`per-menu-sides-${ITEM_ID}`)).toBeTruthy();
  });

  it('renders no Includes zone markup at all when false', async () => {
    renderExpandedRow({ showIncludeZones: false });
    // Give the adapter promise a turn — if the zones were merely hidden rather
    // than unmounted, they would have appeared by now.
    await Promise.resolve();
    expect(zoneNodes()).toHaveLength(0);
    expect(screen.queryByTestId(`sides-and-drop-zone-${ITEM_ID}`)).toBeNull();
    expect(screen.queryByTestId(`sides-or-drop-zone-${ITEM_ID}`)).toBeNull();
  });

  it('keeps the rest of the expanded row when the zones are gated off', async () => {
    renderExpandedRow({ showIncludeZones: false });
    // Row attributes still render …
    expect(screen.getByTestId(`portion-btn-single-${ITEM_ID}`)).toBeTruthy();
    // … and the row still collapses, so the gate has not disturbed the
    // expand/collapse machinery the course + sub-section headers share.
    fireEvent.click(screen.getByTestId(`menu-item-expand-${ITEM_ID}`));
    expect(screen.queryByTestId(`portion-btn-single-${ITEM_ID}`)).toBeNull();
  });
});

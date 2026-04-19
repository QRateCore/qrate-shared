// @vitest-environment jsdom
/**
 * Unit tests for ItemModifierZones.
 *
 * Covers the two bug fixes:
 *
 * Bug 1 — Deleted addon ghosts in drop zone:
 *   - An addon present in parent.addons but absent from itemsById must not render
 *   - An addon present in both renders correctly
 *
 * Bug 2 — Drag-drop addon does not call onUpdate with addons:
 *   - Dropping a valid addon item fires onUpdate with addons in the payload
 *   - Dropping a non-addon (dish) onto the addon zone is rejected (no onUpdate)
 *   - Dropping a duplicate addon (already in addonIds) is rejected (no onUpdate)
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import ItemModifierZones from '../ItemModifierZones';
import type { MenuItemDisplay, AddonEntry } from '../../../../types/restaurant';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeDish(id: string, overrides: Partial<MenuItemDisplay> = {}): MenuItemDisplay {
  return {
    id,
    name: `Dish ${id}`,
    description: null,
    category: 'Entrees',
    canonical_category: 'Entrees',
    price: 18,
    active: true,
    item_type: 'dish',
    thumbnail_url: null,
    associations: [],
    food_tags: {},
    addons: [],
    sides: [],
    recommendations: [],
    boost_level: null,
    chefs_special: false,
    menu_associations: [],
    ...overrides,
  } as MenuItemDisplay;
}

function makeAddonItem(id: string, overrides: Partial<MenuItemDisplay> = {}): MenuItemDisplay {
  return {
    id,
    name: `Addon ${id}`,
    description: null,
    category: null,
    canonical_category: null,
    price: 2.5,
    active: true,
    item_type: 'addon',
    thumbnail_url: null,
    associations: [],
    food_tags: {},
    addons: [],
    sides: [],
    recommendations: [],
    boost_level: null,
    chefs_special: false,
    ...overrides,
  } as MenuItemDisplay;
}

function makeAddonEntry(addonId: string, name: string): AddonEntry {
  return {
    menu_item_id: addonId,
    name,
    price_override: 2.5,
    thumbnail_url: null,
    status: 'approved',
    suggestion_source: 'manual',
  };
}

// Simulates an HTML5 drag-drop event with a text/plain dataTransfer payload.
function fireDrop(element: Element, itemId: string) {
  const dataTransfer = {
    getData: (type: string) => (type === 'text/plain' ? JSON.stringify([itemId]) : ''),
    setData: vi.fn(),
    effectAllowed: 'move',
    dropEffect: 'move',
    files: [],
    items: [],
    types: ['text/plain'],
    clearData: vi.fn(),
  };
  fireEvent.drop(element, { dataTransfer });
}

// ── Render helper ─────────────────────────────────────────────────────────────

function renderZones(
  parent: MenuItemDisplay,
  itemsById: Map<string, MenuItemDisplay>,
  onUpdate = vi.fn().mockResolvedValue(undefined),
) {
  render(
    <ItemModifierZones
      parent={parent}
      itemsById={itemsById}
      currentMenuId="menu-1"
      onUpdate={onUpdate}
    />,
  );
  return { onUpdate };
}

// ── Bug 1: Deleted addon filter ───────────────────────────────────────────────

describe('ItemModifierZones — deleted addon filter (Bug 1)', () => {
  it('does not render an addon whose menu_item_id is absent from itemsById', () => {
    const parent = makeDish('dish-1', {
      addons: [makeAddonEntry('deleted-addon', 'Orphaned Sauce')],
    });
    // itemsById does NOT contain 'deleted-addon'
    const itemsById = new Map([['dish-1', parent]]);

    renderZones(parent, itemsById);

    // The remove button would have this testid if the addon were rendered
    expect(
      document.querySelector('[data-testid="remove-addon-dish-1-deleted-addon"]'),
    ).toBeNull();

    // Drop zone should show the empty placeholder instead
    expect(screen.getByText('Drop add-ons here')).toBeInTheDocument();
  });

  it('renders an addon that exists in itemsById', () => {
    const addonItem = makeAddonItem('addon-1');
    const parent = makeDish('dish-1', {
      addons: [makeAddonEntry('addon-1', 'Extra Sauce')],
    });
    const itemsById = new Map([
      ['dish-1', parent],
      ['addon-1', addonItem],
    ]);

    renderZones(parent, itemsById);

    // Remove button should be present
    expect(
      document.querySelector('[data-testid="remove-addon-dish-1-addon-1"]'),
    ).toBeInTheDocument();

    // Addon name should appear in the card
    expect(screen.getByText('Extra Sauce')).toBeInTheDocument();
  });

  it('renders only the surviving addon when one is deleted and one is not', () => {
    const survivingAddon = makeAddonItem('addon-surviving');
    const parent = makeDish('dish-1', {
      addons: [
        makeAddonEntry('addon-deleted', 'Deleted Topping'),
        makeAddonEntry('addon-surviving', 'Alive Topping'),
      ],
    });
    // Only the surviving addon is in itemsById
    const itemsById = new Map([
      ['dish-1', parent],
      ['addon-surviving', survivingAddon],
    ]);

    renderZones(parent, itemsById);

    expect(
      document.querySelector('[data-testid="remove-addon-dish-1-addon-deleted"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-testid="remove-addon-dish-1-addon-surviving"]'),
    ).toBeInTheDocument();
    expect(screen.getByText('Alive Topping')).toBeInTheDocument();
    expect(screen.queryByText('Deleted Topping')).toBeNull();
  });
});

// ── Bug 2: Drag-drop fires onUpdate with addons ───────────────────────────────

describe('ItemModifierZones — addon drag-drop calls onUpdate (Bug 2)', () => {
  it('calls onUpdate with the dropped addon in the addons payload', () => {
    const addonItem = makeAddonItem('addon-new', { name: 'Chilli Oil', price: 1.5 });
    const parent = makeDish('dish-1', { addons: [] });
    const itemsById = new Map([
      ['dish-1', parent],
      ['addon-new', addonItem],
    ]);
    const onUpdate = vi.fn().mockResolvedValue(undefined);

    renderZones(parent, itemsById, onUpdate);

    const dropZone = document.querySelector('[data-testid="addons-drop-zone-dish-1"]')!;
    fireDrop(dropZone, 'addon-new');

    expect(onUpdate).toHaveBeenCalledOnce();
    const [calledParentId, payload] = onUpdate.mock.calls[0] as [string, { addons: Array<{ menu_item_id: string }> }];
    expect(calledParentId).toBe('dish-1');
    expect(payload.addons).toBeDefined();
    expect(payload.addons).toHaveLength(1);
    expect(payload.addons[0].menu_item_id).toBe('addon-new');
  });

  it('preserves existing addons and appends the new one', () => {
    const existingAddon = makeAddonItem('addon-existing');
    const newAddon = makeAddonItem('addon-new');
    const parent = makeDish('dish-1', {
      addons: [makeAddonEntry('addon-existing', 'Existing')],
    });
    const itemsById = new Map([
      ['dish-1', parent],
      ['addon-existing', existingAddon],
      ['addon-new', newAddon],
    ]);
    const onUpdate = vi.fn().mockResolvedValue(undefined);

    renderZones(parent, itemsById, onUpdate);

    const dropZone = document.querySelector('[data-testid="addons-drop-zone-dish-1"]')!;
    fireDrop(dropZone, 'addon-new');

    expect(onUpdate).toHaveBeenCalledOnce();
    const payload = onUpdate.mock.calls[0][1] as { addons: Array<{ menu_item_id: string }> };
    expect(payload.addons).toHaveLength(2);
    expect(payload.addons.map((a) => a.menu_item_id)).toContain('addon-existing');
    expect(payload.addons.map((a) => a.menu_item_id)).toContain('addon-new');
  });

  it('does not call onUpdate when a non-addon (dish) is dropped on the addon zone', () => {
    const dishItem = makeDish('dish-2', { name: 'Pasta' });
    const parent = makeDish('dish-1', { addons: [] });
    const itemsById = new Map([
      ['dish-1', parent],
      ['dish-2', dishItem],
    ]);
    const onUpdate = vi.fn().mockResolvedValue(undefined);

    renderZones(parent, itemsById, onUpdate);

    const dropZone = document.querySelector('[data-testid="addons-drop-zone-dish-1"]')!;
    fireDrop(dropZone, 'dish-2');

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('does not call onUpdate when the same addon is dropped again (duplicate guard)', () => {
    const addonItem = makeAddonItem('addon-1');
    const parent = makeDish('dish-1', {
      addons: [makeAddonEntry('addon-1', 'Already Here')],
    });
    const itemsById = new Map([
      ['dish-1', parent],
      ['addon-1', addonItem],
    ]);
    const onUpdate = vi.fn().mockResolvedValue(undefined);

    renderZones(parent, itemsById, onUpdate);

    const dropZone = document.querySelector('[data-testid="addons-drop-zone-dish-1"]')!;
    fireDrop(dropZone, 'addon-1');

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('does not call onUpdate when the parent itself is dropped on its own addon zone', () => {
    const parent = makeDish('dish-1', { addons: [] });
    const itemsById = new Map([['dish-1', parent]]);
    const onUpdate = vi.fn().mockResolvedValue(undefined);

    renderZones(parent, itemsById, onUpdate);

    const dropZone = document.querySelector('[data-testid="addons-drop-zone-dish-1"]')!;
    fireDrop(dropZone, 'dish-1');

    expect(onUpdate).not.toHaveBeenCalled();
  });
});

// ── Price display: reads from itemsById, not price_override ───────────────────

describe('ItemModifierZones — addon price comes from itemsById, not price_override', () => {
  it('shows the addon item price from itemsById, ignoring stale price_override on the association', () => {
    // Association has price_override: 0 — stale value from before the design fix.
    // The addon item itself has price: 2.50 — this is the authoritative source.
    const addonEntry: ReturnType<typeof makeAddonEntry> = { ...makeAddonEntry('addon-1', 'Extra Chutney'), price_override: 0 };
    const addonItem = makeAddonItem('addon-1', { name: 'Extra Chutney', price: 2.5 });
    const parent = makeDish('dish-1', { addons: [addonEntry] });
    const itemsById = new Map([
      ['dish-1', parent],
      ['addon-1', addonItem],
    ]);

    renderZones(parent, itemsById);

    // Must show the addon item's price ($2.50), not the stale association price ($0.00)
    expect(screen.getByText('+$2.50')).toBeInTheDocument();
  });

  it('hides the price tag when the addon item has a null price', () => {
    const addonEntry = makeAddonEntry('addon-1', 'Complimentary Item');
    const addonItem = makeAddonItem('addon-1', { price: null });
    const parent = makeDish('dish-1', { addons: [addonEntry] });
    const itemsById = new Map([
      ['dish-1', parent],
      ['addon-1', addonItem],
    ]);

    renderZones(parent, itemsById);

    expect(document.querySelector('.modifier-card-price')).toBeNull();
  });

  it('shows +$0.00 when the addon item price is explicitly zero', () => {
    const addonEntry = makeAddonEntry('addon-1', 'Free Add-on');
    const addonItem = makeAddonItem('addon-1', { price: 0 });
    const parent = makeDish('dish-1', { addons: [addonEntry] });
    const itemsById = new Map([
      ['dish-1', parent],
      ['addon-1', addonItem],
    ]);

    renderZones(parent, itemsById);

    expect(screen.getByText('+$0.00')).toBeInTheDocument();
  });

  it('shows a different price for two addons based on their respective itemsById entries', () => {
    const entry1 = makeAddonEntry('addon-a', 'Sauce');
    const entry2 = makeAddonEntry('addon-b', 'Cheese');
    const addonA = makeAddonItem('addon-a', { price: 1.0 });
    const addonB = makeAddonItem('addon-b', { price: 3.5 });
    const parent = makeDish('dish-1', { addons: [entry1, entry2] });
    const itemsById = new Map([
      ['dish-1', parent],
      ['addon-a', addonA],
      ['addon-b', addonB],
    ]);

    renderZones(parent, itemsById);

    expect(screen.getByText('+$1.00')).toBeInTheDocument();
    expect(screen.getByText('+$3.50')).toBeInTheDocument();
  });
});

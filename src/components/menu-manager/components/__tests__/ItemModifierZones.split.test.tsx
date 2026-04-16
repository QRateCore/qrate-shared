// @vitest-environment jsdom
/**
 * Unit tests for ItemModifierZones — 2-box split mode (STR-342).
 *
 * Covers:
 *   - Split mode renders Included + Choice drop zones
 *   - Dropping on Included appends to sides_and
 *   - Dropping on Choice appends to sides_or
 *   - Cross-group drop (in Choice, dragged to Included) fires onCrossGroupDuplicate('choice')
 *   - Cross-group drop (in Included, dragged to Choice) fires onCrossGroupDuplicate('included')
 *   - Same-group duplicate drop is silent (no onCrossGroupDuplicate, no onUpdate)
 *   - Flag OFF → legacy single Sides zone (no split zones rendered)
 *   - Addon dropped on Included/Choice is rejected
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import ItemModifierZones, { type ModifierUpdatePayload } from '../ItemModifierZones';
import type { MenuItemDisplay, SideEntry } from '../../../../types/restaurant';

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
    sides_and: [],
    sides_or: [],
    recommendations: [],
    boost_level: null,
    chefs_special: false,
    menu_associations: [],
    ...overrides,
  } as MenuItemDisplay;
}

function makeAddonItem(id: string): MenuItemDisplay {
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
  } as MenuItemDisplay;
}

function makeSide(id: string, name: string): SideEntry {
  return {
    menu_item_id: id,
    name,
    price_override: null,
    thumbnail_url: null,
  };
}

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

function renderZones(
  parent: MenuItemDisplay,
  itemsById: Map<string, MenuItemDisplay>,
  opts: {
    enableAndOrSplit?: boolean;
    onUpdate?: ReturnType<typeof vi.fn>;
    onCrossGroupDuplicate?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const onUpdate = opts.onUpdate ?? vi.fn().mockResolvedValue(undefined);
  const onCrossGroupDuplicate = opts.onCrossGroupDuplicate ?? vi.fn();
  render(
    <ItemModifierZones
      parent={parent}
      itemsById={itemsById}
      currentMenuId="menu-1"
      onUpdate={onUpdate}
      enableAndOrSplit={opts.enableAndOrSplit ?? true}
      onCrossGroupDuplicate={onCrossGroupDuplicate}
    />,
  );
  return { onUpdate, onCrossGroupDuplicate };
}

// ── Flag OFF: legacy render ──────────────────────────────────────────────────

describe('ItemModifierZones — legacy mode (flag OFF)', () => {
  it('does NOT render split drop zones when enableAndOrSplit is false', () => {
    const parent = makeDish('dish-1');
    const itemsById = new Map([['dish-1', parent]]);
    render(
      <ItemModifierZones
        parent={parent}
        itemsById={itemsById}
        currentMenuId="menu-1"
        onUpdate={vi.fn().mockResolvedValue(undefined)}
        enableAndOrSplit={false}
      />,
    );
    expect(
      document.querySelector('[data-testid="sides-and-drop-zone-dish-1"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-testid="sides-or-drop-zone-dish-1"]'),
    ).toBeNull();
    // Legacy sides drop zone is still present (left column).
    expect(
      document.querySelector('[data-testid="sides-drop-zone-dish-1"]'),
    ).toBeInTheDocument();
  });
});

// ── Flag ON: split rendering ─────────────────────────────────────────────────

describe('ItemModifierZones — split mode (flag ON)', () => {
  it('renders BOTH Included and Choice drop zones', () => {
    const parent = makeDish('dish-1');
    const itemsById = new Map([['dish-1', parent]]);
    renderZones(parent, itemsById);
    expect(
      document.querySelector('[data-testid="sides-and-drop-zone-dish-1"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-testid="sides-or-drop-zone-dish-1"]'),
    ).toBeInTheDocument();
    // Legacy zone should not appear in split mode
    expect(
      document.querySelector('[data-testid="sides-drop-zone-dish-1"]'),
    ).toBeNull();
  });

  it('root container carries data-split-enabled="true"', () => {
    const parent = makeDish('dish-1');
    const itemsById = new Map([['dish-1', parent]]);
    renderZones(parent, itemsById);
    const root = document.querySelector('[data-split-enabled="true"]');
    expect(root).toBeInTheDocument();
  });
});

// ── Drop behavior — Included (sides_and) ─────────────────────────────────────

describe('ItemModifierZones — Included drop (sides_and)', () => {
  it('dropping a dish on Included calls onUpdate with sides_and populated', () => {
    const side = makeDish('side-1', { name: 'Fries', item_type: 'dish' });
    const parent = makeDish('dish-1');
    const itemsById = new Map([
      ['dish-1', parent],
      ['side-1', side],
    ]);
    const { onUpdate } = renderZones(parent, itemsById);

    const zone = document.querySelector('[data-testid="sides-and-drop-zone-dish-1"]')!;
    fireDrop(zone, 'side-1');

    expect(onUpdate).toHaveBeenCalledOnce();
    const [parentId, payload] = onUpdate.mock.calls[0] as [string, ModifierUpdatePayload];
    expect(parentId).toBe('dish-1');
    expect(payload.sides_and).toHaveLength(1);
    expect(payload.sides_and?.[0].menu_item_id).toBe('side-1');
    // sides_or unchanged (empty)
    expect(payload.sides_or ?? []).toHaveLength(0);
  });

  it('dropping an addon on Included is rejected (no onUpdate)', () => {
    const addon = makeAddonItem('addon-1');
    const parent = makeDish('dish-1');
    const itemsById = new Map<string, MenuItemDisplay>([
      ['dish-1', parent],
      ['addon-1', addon],
    ]);
    const { onUpdate } = renderZones(parent, itemsById);

    const zone = document.querySelector('[data-testid="sides-and-drop-zone-dish-1"]')!;
    fireDrop(zone, 'addon-1');

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('duplicate in Included is silent — no onUpdate, no cross-group callback', () => {
    const side = makeDish('side-1', { name: 'Fries' });
    const parent = makeDish('dish-1', {
      sides_and: [makeSide('side-1', 'Fries')],
    });
    const itemsById = new Map([
      ['dish-1', parent],
      ['side-1', side],
    ]);
    const { onUpdate, onCrossGroupDuplicate } = renderZones(parent, itemsById);

    const zone = document.querySelector('[data-testid="sides-and-drop-zone-dish-1"]')!;
    fireDrop(zone, 'side-1');

    expect(onUpdate).not.toHaveBeenCalled();
    expect(onCrossGroupDuplicate).not.toHaveBeenCalled();
  });
});

// ── Drop behavior — Choice (sides_or) ────────────────────────────────────────

describe('ItemModifierZones — Choice drop (sides_or)', () => {
  it('dropping a dish on Choice calls onUpdate with sides_or populated', () => {
    const side = makeDish('side-2', { name: 'Side Salad' });
    const parent = makeDish('dish-1');
    const itemsById = new Map([
      ['dish-1', parent],
      ['side-2', side],
    ]);
    const { onUpdate } = renderZones(parent, itemsById);

    const zone = document.querySelector('[data-testid="sides-or-drop-zone-dish-1"]')!;
    fireDrop(zone, 'side-2');

    expect(onUpdate).toHaveBeenCalledOnce();
    const payload = onUpdate.mock.calls[0][1] as ModifierUpdatePayload;
    expect(payload.sides_or).toHaveLength(1);
    expect(payload.sides_or?.[0].menu_item_id).toBe('side-2');
    expect(payload.sides_and ?? []).toHaveLength(0);
  });
});

// ── Cross-group duplicates ───────────────────────────────────────────────────

describe('ItemModifierZones — cross-group duplicate guard', () => {
  it('dropping a Choice item onto Included fires onCrossGroupDuplicate("choice")', () => {
    const side = makeDish('side-shared', { name: 'Fries' });
    const parent = makeDish('dish-1', {
      sides_or: [makeSide('side-shared', 'Fries')],
    });
    const itemsById = new Map([
      ['dish-1', parent],
      ['side-shared', side],
    ]);
    const { onUpdate, onCrossGroupDuplicate } = renderZones(parent, itemsById);

    const zone = document.querySelector('[data-testid="sides-and-drop-zone-dish-1"]')!;
    fireDrop(zone, 'side-shared');

    expect(onCrossGroupDuplicate).toHaveBeenCalledWith('choice');
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('dropping an Included item onto Choice fires onCrossGroupDuplicate("included")', () => {
    const side = makeDish('side-shared', { name: 'Fries' });
    const parent = makeDish('dish-1', {
      sides_and: [makeSide('side-shared', 'Fries')],
    });
    const itemsById = new Map([
      ['dish-1', parent],
      ['side-shared', side],
    ]);
    const { onUpdate, onCrossGroupDuplicate } = renderZones(parent, itemsById);

    const zone = document.querySelector('[data-testid="sides-or-drop-zone-dish-1"]')!;
    fireDrop(zone, 'side-shared');

    expect(onCrossGroupDuplicate).toHaveBeenCalledWith('included');
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

// ── Render — existing items ──────────────────────────────────────────────────

describe('ItemModifierZones — rendering existing split items', () => {
  it('renders both sides_and and sides_or entries under their respective zones', () => {
    const sideA = makeDish('side-a', { name: 'Fries' });
    const sideB = makeDish('side-b', { name: 'Salad' });
    const parent = makeDish('dish-1', {
      sides_and: [makeSide('side-a', 'Fries')],
      sides_or: [makeSide('side-b', 'Salad')],
    });
    const itemsById = new Map([
      ['dish-1', parent],
      ['side-a', sideA],
      ['side-b', sideB],
    ]);
    renderZones(parent, itemsById);

    // Both names should render
    expect(screen.getByText('Fries')).toBeInTheDocument();
    expect(screen.getByText('Salad')).toBeInTheDocument();
  });
});

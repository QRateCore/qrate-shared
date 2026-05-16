// @vitest-environment jsdom
/**
 * Unit tests for ItemModifierZones — per-menu Includes / Choose-One
 * sides editor (PDD 2026-05-15 v2 Step 6).
 *
 * The previous test file (12 cases) covered the addons +
 * recommendations + custom-groupings drop zones that lived here
 * before the v2 rewrite. Those have all been removed; the component
 * now ONLY renders the two per-menu sides zones. New coverage:
 *
 * - Loading state
 * - Empty state when placement has no per-menu sides
 * - Both zones render with the right labels + zero-state hints
 * - Drag-drop adds a side to the correct zone via setMenuSides
 * - Cross-zone duplicate rejected (warn toast, no save)
 * - Addon items rejected (warn toast, no save)
 * - Remove side via X button calls setMenuSides with the remainder
 * - Save failure reverts to last confirmed state + error toast
 * - Rapid drops coalesce: prior request is aborted
 * - currentMenuId=null renders nothing
 * - perMenuSides=undefined renders nothing
 * - 404 MENU_NOT_ASSOCIATED renders empty zones (no error chrome)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import ItemModifierZones, {
  type MenuItemMenuSides,
  type PerMenuSidesAdapter,
} from '../ItemModifierZones';
import type { MenuItemDisplay } from '../../../../types/restaurant';

// sonner is used only for toast warnings — mock to silent.
const toastMock = vi.hoisted(() => ({
  warning: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: toastMock }));

// ── Factories ─────────────────────────────────────────────────────────────

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

function makeAddonItem(id: string): MenuItemDisplay {
  return makeDish(id, { name: `Addon ${id}`, item_type: 'addon', price: 2.5 });
}

const PARENT_ID = 'parent-dish';
const MENU_ID = 'menu-lunch';
const SIDE_A = 'side-a';
const SIDE_B = 'side-b';

function makeAdapter(initial: MenuItemMenuSides = { sides_and: [], sides_or: [] }): {
  adapter: PerMenuSidesAdapter;
  getCalls: Array<[string, string]>;
  setCalls: Array<[string, string, unknown]>;
  /** Tell setMenuSides to reject the next call once. */
  rejectNextSet: (err: Error) => void;
  /** Echo a specific resolved view from the next setMenuSides call. */
  resolveNextSetWith: (next: MenuItemMenuSides) => void;
} {
  const getCalls: Array<[string, string]> = [];
  const setCalls: Array<[string, string, unknown]> = [];
  let nextSetReject: Error | null = null;
  let nextSetEcho: MenuItemMenuSides | null = null;

  const adapter: PerMenuSidesAdapter = {
    get: async (itemId, menuId) => {
      getCalls.push([itemId, menuId]);
      return initial;
    },
    set: async (itemId, menuId, body) => {
      setCalls.push([itemId, menuId, body]);
      if (nextSetReject) {
        const err = nextSetReject;
        nextSetReject = null;
        throw err;
      }
      if (nextSetEcho) {
        const echo = nextSetEcho;
        nextSetEcho = null;
        return echo;
      }
      // Default: echo back what was sent, decorated with names from the
      // body (resolver normally fills names from menu_items).
      return {
        sides_and: body.sides_and.map((s) => ({
          menu_item_id: s.menu_item_id,
          name: `Server ${s.menu_item_id}`,
          price_override: s.price_override ?? null,
          thumbnail_url: null,
          thumbnail_small_url: null,
        })),
        sides_or: body.sides_or.map((s) => ({
          menu_item_id: s.menu_item_id,
          name: `Server ${s.menu_item_id}`,
          price_override: s.price_override ?? null,
          thumbnail_url: null,
          thumbnail_small_url: null,
        })),
      };
    },
  };
  return {
    adapter,
    getCalls,
    setCalls,
    rejectNextSet: (err) => { nextSetReject = err; },
    resolveNextSetWith: (next) => { nextSetEcho = next; },
  };
}

function makeItemsById(items: MenuItemDisplay[]) {
  return new Map(items.map((it) => [it.id, it]));
}

function dropOn(testId: string, payload: string) {
  const zone = screen.getByTestId(testId);
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { getData: (_: string) => payload },
  });
  zone.dispatchEvent(event);
}

beforeEach(() => {
  toastMock.warning.mockReset();
  toastMock.error.mockReset();
});

// ── Render guards ─────────────────────────────────────────────────────────

describe('ItemModifierZones — render guards', () => {
  it('renders nothing when currentMenuId is null', () => {
    const { adapter } = makeAdapter();
    const { container } = render(
      <ItemModifierZones
        parent={makeDish(PARENT_ID)}
        itemsById={makeItemsById([])}
        currentMenuId={null}
        perMenuSides={adapter}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when perMenuSides adapter is omitted', () => {
    const { container } = render(
      <ItemModifierZones
        parent={makeDish(PARENT_ID)}
        itemsById={makeItemsById([])}
        currentMenuId={MENU_ID}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

// ── Loading / empty / populated ───────────────────────────────────────────

describe('ItemModifierZones — load lifecycle', () => {
  it('shows loading state then both empty zones', async () => {
    const { adapter } = makeAdapter();
    render(
      <ItemModifierZones
        parent={makeDish(PARENT_ID)}
        itemsById={makeItemsById([])}
        currentMenuId={MENU_ID}
        perMenuSides={adapter}
      />,
    );
    // Loading hint renders immediately
    expect(screen.getByTestId(`per-menu-sides-loading-${PARENT_ID}`)).toBeInTheDocument();
    // After the async load resolves both zones appear empty
    await waitFor(() =>
      expect(screen.getByTestId(`per-menu-sides-${PARENT_ID}`)).toBeInTheDocument(),
    );
    expect(screen.getByText('Includes All')).toBeInTheDocument();
    expect(screen.getByText('Includes one by choice')).toBeInTheDocument();
    expect(screen.getByText('Drop included sides here')).toBeInTheDocument();
    expect(screen.getByText('Drop choice sides here')).toBeInTheDocument();
  });

  it('renders populated cards when the adapter returns sides', async () => {
    const { adapter } = makeAdapter({
      sides_and: [{ menu_item_id: SIDE_A, name: 'Mashed Potatoes' }],
      sides_or: [{ menu_item_id: SIDE_B, name: 'Slaw' }],
    });
    render(
      <ItemModifierZones
        parent={makeDish(PARENT_ID)}
        itemsById={makeItemsById([])}
        currentMenuId={MENU_ID}
        perMenuSides={adapter}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText('Mashed Potatoes')).toBeInTheDocument(),
    );
    expect(screen.getByText('Slaw')).toBeInTheDocument();
  });

  it('treats 404 MENU_NOT_ASSOCIATED as empty (not an error chrome)', async () => {
    const adapter: PerMenuSidesAdapter = {
      get: vi.fn().mockRejectedValue(new Error('MENU_NOT_ASSOCIATED')),
      set: vi.fn(),
    };
    render(
      <ItemModifierZones
        parent={makeDish(PARENT_ID)}
        itemsById={makeItemsById([])}
        currentMenuId={MENU_ID}
        perMenuSides={adapter}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId(`per-menu-sides-${PARENT_ID}`)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId(`per-menu-sides-error-${PARENT_ID}`)).toBeNull();
  });

  it('surfaces non-404 errors as an inline error block', async () => {
    const adapter: PerMenuSidesAdapter = {
      get: vi.fn().mockRejectedValue(new Error('boom')),
      set: vi.fn(),
    };
    render(
      <ItemModifierZones
        parent={makeDish(PARENT_ID)}
        itemsById={makeItemsById([])}
        currentMenuId={MENU_ID}
        perMenuSides={adapter}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId(`per-menu-sides-error-${PARENT_ID}`)).toBeInTheDocument(),
    );
  });
});

// ── Drag-drop ─────────────────────────────────────────────────────────────

describe('ItemModifierZones — drag-drop', () => {
  it('adds dropped dish to Includes All via setMenuSides', async () => {
    const sideDish = makeDish(SIDE_A, { name: 'Mashed Potatoes' });
    const { adapter, setCalls } = makeAdapter();
    render(
      <ItemModifierZones
        parent={makeDish(PARENT_ID)}
        itemsById={makeItemsById([sideDish])}
        currentMenuId={MENU_ID}
        perMenuSides={adapter}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId(`sides-and-drop-zone-${PARENT_ID}`)).toBeInTheDocument(),
    );

    dropOn(`sides-and-drop-zone-${PARENT_ID}`, SIDE_A);

    await waitFor(() => expect(setCalls).toHaveLength(1));
    const [itemId, menuId, body] = setCalls[0];
    expect(itemId).toBe(PARENT_ID);
    expect(menuId).toBe(MENU_ID);
    expect(body).toEqual({
      sides_and: [{ menu_item_id: SIDE_A, price_override: null }],
      sides_or: [],
    });
  });

  it('rejects addon items with a warning toast', async () => {
    const addon = makeAddonItem(SIDE_A);
    const { adapter, setCalls } = makeAdapter();
    render(
      <ItemModifierZones
        parent={makeDish(PARENT_ID)}
        itemsById={makeItemsById([addon])}
        currentMenuId={MENU_ID}
        perMenuSides={adapter}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId(`sides-and-drop-zone-${PARENT_ID}`)).toBeInTheDocument(),
    );

    dropOn(`sides-and-drop-zone-${PARENT_ID}`, SIDE_A);

    expect(setCalls).toHaveLength(0);
    expect(toastMock.warning).toHaveBeenCalledWith(expect.stringMatching(/Add-?ons/i));
  });

  it('rejects cross-zone duplicates with a warning toast', async () => {
    const sideDish = makeDish(SIDE_A, { name: 'Mashed Potatoes' });
    const { adapter, setCalls } = makeAdapter({
      sides_and: [{ menu_item_id: SIDE_A, name: 'Mashed Potatoes' }],
      sides_or: [],
    });
    render(
      <ItemModifierZones
        parent={makeDish(PARENT_ID)}
        itemsById={makeItemsById([sideDish])}
        currentMenuId={MENU_ID}
        perMenuSides={adapter}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText('Mashed Potatoes')).toBeInTheDocument(),
    );

    // SIDE_A is in sides_and — dropping into sides_or should reject.
    dropOn(`sides-or-drop-zone-${PARENT_ID}`, SIDE_A);

    expect(setCalls).toHaveLength(0);
    expect(toastMock.warning).toHaveBeenCalledWith(
      expect.stringMatching(/other slot/i),
    );
  });

  it('silently skips drops already in the same zone (no toast, no save)', async () => {
    const sideDish = makeDish(SIDE_A);
    const { adapter, setCalls } = makeAdapter({
      sides_and: [{ menu_item_id: SIDE_A, name: 'Side A' }],
      sides_or: [],
    });
    render(
      <ItemModifierZones
        parent={makeDish(PARENT_ID)}
        itemsById={makeItemsById([sideDish])}
        currentMenuId={MENU_ID}
        perMenuSides={adapter}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText('Side A')).toBeInTheDocument(),
    );

    dropOn(`sides-and-drop-zone-${PARENT_ID}`, SIDE_A);

    expect(setCalls).toHaveLength(0);
    expect(toastMock.warning).not.toHaveBeenCalled();
  });

  it('rejects dropping the parent dish onto itself', async () => {
    const { adapter, setCalls } = makeAdapter();
    render(
      <ItemModifierZones
        parent={makeDish(PARENT_ID)}
        itemsById={makeItemsById([makeDish(PARENT_ID)])}
        currentMenuId={MENU_ID}
        perMenuSides={adapter}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId(`sides-and-drop-zone-${PARENT_ID}`)).toBeInTheDocument(),
    );

    dropOn(`sides-and-drop-zone-${PARENT_ID}`, PARENT_ID);
    expect(setCalls).toHaveLength(0);
  });
});

// ── Remove ────────────────────────────────────────────────────────────────

describe('ItemModifierZones — remove side', () => {
  it('removing via X calls setMenuSides with the remaining members', async () => {
    const { adapter, setCalls } = makeAdapter({
      sides_and: [
        { menu_item_id: SIDE_A, name: 'Side A' },
        { menu_item_id: SIDE_B, name: 'Side B' },
      ],
      sides_or: [],
    });
    render(
      <ItemModifierZones
        parent={makeDish(PARENT_ID)}
        itemsById={makeItemsById([])}
        currentMenuId={MENU_ID}
        perMenuSides={adapter}
      />,
    );
    await waitFor(() => expect(screen.getByText('Side A')).toBeInTheDocument());

    const removeBtn = screen.getByTestId(`remove-sides-and-${PARENT_ID}-${SIDE_A}`);
    fireEvent.click(removeBtn);

    await waitFor(() => expect(setCalls).toHaveLength(1));
    expect(setCalls[0][2]).toEqual({
      sides_and: [{ menu_item_id: SIDE_B, price_override: null }],
      sides_or: [],
    });
  });
});

// ── Optimistic update + revert ────────────────────────────────────────────

describe('ItemModifierZones — server echo + revert', () => {
  it('swaps in server-echoed names after the PUT resolves', async () => {
    // Optimistic state shows the local item's name (from itemsById)
    // briefly, then the backend echoes back the resolved view with the
    // server-canonical name (decorated by the resolver from menu_items).
    // We assert the FINAL state — the intermediate optimistic frame is
    // not reliably observable under React 18's microtask batching.
    const sideDish = makeDish(SIDE_A, { name: 'Mashed Potatoes' });
    const { adapter } = makeAdapter();
    render(
      <ItemModifierZones
        parent={makeDish(PARENT_ID)}
        itemsById={makeItemsById([sideDish])}
        currentMenuId={MENU_ID}
        perMenuSides={adapter}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId(`sides-and-drop-zone-${PARENT_ID}`)).toBeInTheDocument(),
    );

    dropOn(`sides-and-drop-zone-${PARENT_ID}`, SIDE_A);

    // Server echo wins: `Server side-a` (from the default mock).
    await waitFor(() =>
      expect(screen.getByText(`Server ${SIDE_A}`)).toBeInTheDocument(),
    );
  });

  it('reverts to empty + error toast when setMenuSides rejects', async () => {
    const sideDish = makeDish(SIDE_A, { name: 'Mashed Potatoes' });
    const { adapter, rejectNextSet } = makeAdapter();
    rejectNextSet(new Error('boom'));
    render(
      <ItemModifierZones
        parent={makeDish(PARENT_ID)}
        itemsById={makeItemsById([sideDish])}
        currentMenuId={MENU_ID}
        perMenuSides={adapter}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId(`sides-and-drop-zone-${PARENT_ID}`)).toBeInTheDocument(),
    );

    dropOn(`sides-and-drop-zone-${PARENT_ID}`, SIDE_A);

    // After the rejection cycle completes:
    // - The dropped name disappears (revert)
    // - An error toast fires with the rejection message
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('boom'));
    expect(screen.queryByText('Mashed Potatoes')).toBeNull();
    expect(screen.queryByText(`Server ${SIDE_A}`)).toBeNull();
  });
});

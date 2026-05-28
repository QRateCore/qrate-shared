// @vitest-environment jsdom
/**
 * Tests for the Menu Builder Active/Inactive Rec chip split.
 *
 * Covers:
 *   - classifyRecMembers split logic in owner-browser tz
 *   - RecGroupingChips renders two chips with the right counts
 *   - RecActiveChip hover popover (read-only — names only)
 *   - RecInactiveChip hover-with-grace popover via createPortal,
 *     per-row "Bring into Menu" button click + dismissal
 *   - Bring-into-Menu callback receives (memberId, ownerMenuId)
 *   - Empty-side chip rendering (zero active / N inactive and vice versa)
 *
 * The chips themselves are not exported; the test file imports the
 * named exports we added for testing (`RecGroupingChips`,
 * `_classifyRecMembersForTest`). The popover is portal'd to
 * document.body — RTL's `screen` resolves that automatically.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import type {
  Grouping,
  MenuItemDisplay,
  MenuSummary,
} from '../../../../types/restaurant';
import {
  RecGroupingChips,
  _classifyRecMembersForTest,
} from '../MenuBuilder';

function makeMenu(overrides: Partial<MenuSummary> = {}): MenuSummary {
  return {
    id: 'menu-dinner',
    name: 'Dinner',
    slug: 'dinner',
    display_order: 0,
    active: true,
    // Default fixture is is_all_day so tests are wall-clock-independent.
    // Time-window tests below pass their own start_time/end_time + an
    // explicit `now` to keep the schedule-window evaluation
    // deterministic regardless of when the suite runs.
    start_time: null,
    end_time: null,
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    is_all_day: true,
    schedule: null,
    item_count: 0,
    ...overrides,
  };
}

function makeItem(overrides: Partial<MenuItemDisplay> = {}): MenuItemDisplay {
  return {
    id: 'item-x',
    name: 'Some Item',
    description: null,
    category: 'Entrees',
    item_type: 'dish',
    thumbnail_url: null,
    price: 12,
    active: true,
    menu_associations: [],
    food_tags: { allergens: [], dietary: [] } as MenuItemDisplay['food_tags'],
    display_allergens: [],
    display_dietary: [],
    addons: [],
    sides: [],
    sides_and: [],
    sides_or: [],
    recommendations: [],
    gallery_urls: [],
    ...overrides,
  } as MenuItemDisplay;
}

function makeRecMember(
  overrides: Partial<Grouping['items'][number]> = {},
): Grouping['items'][number] {
  return {
    id: 'gi-1',
    menu_item_id: 'rec-target-1',
    name: 'Truffle Sauce',
    item_type: 'dish',
    position: 0,
    price_override: null,
    status: 'approved',
    suggestion_source: 'manual',
    ai_confidence: null,
    thumbnail_url: null,
    ...overrides,
  } as Grouping['items'][number];
}

function makeGrouping(
  members: Grouping['items'],
): Grouping {
  return {
    id: 'g-1',
    kind: 'recommendations',
    name: 'Pairings',
    position: 0,
    is_default: true,
    is_deletable: false,
    is_symmetric: true,
    min_select: 0,
    max_select: null,
    default_select: 'none',
    pricing_contribution: 'none',
    external_source: null,
    external_ref: null,
    overrides_attribute: null,
    items: members,
  };
}

// Wednesday 19:00 — sits inside the default Dinner menu window.
const NOW_WED_DINNER = new Date('2026-05-27T19:00:00');

describe('classifyRecMembers', () => {
  it('marks a member active when target is on a live menu', () => {
    const member = makeRecMember({ menu_item_id: 'rec-1' });
    const recTarget = makeItem({
      id: 'rec-1',
      menu_associations: [
        {
          menu_id: 'menu-dinner',
          menu_name: 'Dinner',
          price: null,
          category_name: null,
          canonical_categories: [],
          boost_level: null,
          chefs_special: false,
          portion_type: 'single',
          portion_serves: null,
        },
      ],
    });
    const itemsById = new Map([[recTarget.id, recTarget]]);
    const menusById = new Map([['menu-dinner', makeMenu()]]);

    const { active, inactive } = _classifyRecMembersForTest(
      [member],
      itemsById,
      menusById,
      NOW_WED_DINNER,
    );
    expect(active).toHaveLength(1);
    expect(inactive).toHaveLength(0);
  });

  it('marks a member inactive when its target is not on any menu (orphan)', () => {
    const member = makeRecMember({ menu_item_id: 'orphan-1' });
    const recTarget = makeItem({ id: 'orphan-1', menu_associations: [] });
    const itemsById = new Map([[recTarget.id, recTarget]]);
    const menusById = new Map([['menu-dinner', makeMenu()]]);
    const { active, inactive } = _classifyRecMembersForTest(
      [member],
      itemsById,
      menusById,
      NOW_WED_DINNER,
    );
    expect(active).toHaveLength(0);
    expect(inactive).toHaveLength(1);
  });

  it('marks a member inactive when its target is only on a paused menu', () => {
    const member = makeRecMember({ menu_item_id: 'rec-2' });
    const recTarget = makeItem({
      id: 'rec-2',
      menu_associations: [
        {
          menu_id: 'menu-winter',
          menu_name: 'Winter',
          price: null,
          category_name: null,
          canonical_categories: [],
          boost_level: null,
          chefs_special: false,
          portion_type: 'single',
          portion_serves: null,
        },
      ],
    });
    const itemsById = new Map([[recTarget.id, recTarget]]);
    const menusById = new Map([
      ['menu-winter', makeMenu({ id: 'menu-winter', active: false, is_all_day: true, start_time: null, end_time: null })],
    ]);
    const { active, inactive } = _classifyRecMembersForTest(
      [member],
      itemsById,
      menusById,
      NOW_WED_DINNER,
    );
    expect(active).toHaveLength(0);
    expect(inactive).toHaveLength(1);
  });

  it('marks a member inactive when target is on a menu outside its schedule window', () => {
    const member = makeRecMember({ menu_item_id: 'rec-3' });
    const recTarget = makeItem({
      id: 'rec-3',
      menu_associations: [
        {
          menu_id: 'menu-brunch',
          menu_name: 'Brunch',
          price: null,
          category_name: null,
          canonical_categories: [],
          boost_level: null,
          chefs_special: false,
          portion_type: 'single',
          portion_serves: null,
        },
      ],
    });
    const itemsById = new Map([[recTarget.id, recTarget]]);
    const menusById = new Map([
      [
        'menu-brunch',
        makeMenu({
          id: 'menu-brunch',
          name: 'Brunch',
          is_all_day: false,
          start_time: '10:00',
          end_time: '14:00',
        }),
      ],
    ]);
    // 19:00 Wed — outside brunch window.
    const { active, inactive } = _classifyRecMembersForTest(
      [member],
      itemsById,
      menusById,
      NOW_WED_DINNER,
    );
    expect(active).toHaveLength(0);
    expect(inactive).toHaveLength(1);
  });

  it('marks active when ANY of multiple menu placements is live now', () => {
    const member = makeRecMember({ menu_item_id: 'rec-4' });
    const recTarget = makeItem({
      id: 'rec-4',
      menu_associations: [
        // Brunch — out of window.
        {
          menu_id: 'menu-brunch',
          menu_name: 'Brunch',
          price: null,
          category_name: null,
          canonical_categories: [],
          boost_level: null,
          chefs_special: false,
          portion_type: 'single',
          portion_serves: null,
        },
        // Dinner — live at 19:00.
        {
          menu_id: 'menu-dinner',
          menu_name: 'Dinner',
          price: null,
          category_name: null,
          canonical_categories: [],
          boost_level: null,
          chefs_special: false,
          portion_type: 'single',
          portion_serves: null,
        },
      ],
    });
    const itemsById = new Map([[recTarget.id, recTarget]]);
    const menusById = new Map([
      [
        'menu-brunch',
        makeMenu({
          id: 'menu-brunch',
          is_all_day: false,
          start_time: '10:00',
          end_time: '14:00',
        }),
      ],
      // Default Dinner — is_all_day → always live regardless of when the
      // suite runs. The "any of multiple menus live" assertion only needs
      // ONE of the placements to be live.
      ['menu-dinner', makeMenu()],
    ]);
    const { active, inactive } = _classifyRecMembersForTest(
      [member],
      itemsById,
      menusById,
      NOW_WED_DINNER,
    );
    expect(active).toHaveLength(1);
    expect(inactive).toHaveLength(0);
  });

  it('marks inactive when the rec target is not in itemsById (deleted)', () => {
    const member = makeRecMember({ menu_item_id: 'ghost-1' });
    const itemsById = new Map<string, MenuItemDisplay>();
    const menusById = new Map([['menu-dinner', makeMenu()]]);
    const { active, inactive } = _classifyRecMembersForTest(
      [member],
      itemsById,
      menusById,
      NOW_WED_DINNER,
    );
    expect(active).toHaveLength(0);
    expect(inactive).toHaveLength(1);
  });
});

describe('RecGroupingChips', () => {
  // Use real timers by default; switch to fake on hover-delay tests.
  const owningItem = makeItem({ id: 'owner-1', name: 'Biryani — Lamb' });
  const menus = [makeMenu()];

  function setup(opts: {
    activeCount?: number;
    inactiveCount?: number;
    onBringIntoMenu?: (memberId: string, menuId: string) => void;
  }) {
    const activeCount = opts.activeCount ?? 0;
    const inactiveCount = opts.inactiveCount ?? 0;
    const members: Grouping['items'][number][] = [];
    const itemsById = new Map<string, MenuItemDisplay>();
    for (let i = 0; i < activeCount; i++) {
      const recId = `active-rec-${i}`;
      members.push(
        makeRecMember({
          id: `gi-a-${i}`,
          menu_item_id: recId,
          name: `Active Rec ${i}`,
        }),
      );
      itemsById.set(
        recId,
        makeItem({
          id: recId,
          name: `Active Rec ${i}`,
          menu_associations: [
            {
              menu_id: 'menu-dinner',
              menu_name: 'Dinner',
              price: null,
              category_name: null,
              canonical_categories: [],
              boost_level: null,
              chefs_special: false,
              portion_type: 'single',
              portion_serves: null,
            },
          ],
        }),
      );
    }
    for (let i = 0; i < inactiveCount; i++) {
      const recId = `inactive-rec-${i}`;
      members.push(
        makeRecMember({
          id: `gi-i-${i}`,
          menu_item_id: recId,
          name: `Inactive Rec ${i}`,
        }),
      );
      itemsById.set(
        recId,
        makeItem({ id: recId, name: `Inactive Rec ${i}`, menu_associations: [] }),
      );
    }
    return render(
      <RecGroupingChips
        grouping={makeGrouping(members)}
        owningItem={owningItem}
        menuId="menu-dinner"
        itemsById={itemsById}
        menus={menus}
        onBringIntoMenu={opts.onBringIntoMenu}
      />,
    );
  }

  it('renders both chips with split counts', () => {
    setup({ activeCount: 2, inactiveCount: 3 });
    expect(
      screen.getByTestId(/^rec-active-chip-/).textContent,
    ).toContain('2 active recs');
    expect(
      screen.getByTestId(/^rec-inactive-chip-/).textContent,
    ).toContain('3 inactive recs');
  });

  it('uses singular labels for count === 1', () => {
    setup({ activeCount: 1, inactiveCount: 1 });
    const active = screen.getByTestId(/^rec-active-chip-/);
    const inactive = screen.getByTestId(/^rec-inactive-chip-/);
    expect(active.textContent).toContain('1 active rec');
    expect(active.textContent).not.toContain('recs');
    expect(inactive.textContent).toContain('1 inactive rec');
    expect(inactive.textContent).not.toContain('recs');
  });

  it('renders nothing when there are zero members on either side', () => {
    const { container } = setup({ activeCount: 0, inactiveCount: 0 });
    expect(container.firstChild).toBeNull();
  });

  it('renders both chips with one side empty (zero active / N inactive)', () => {
    setup({ activeCount: 0, inactiveCount: 2 });
    expect(
      screen.getByTestId('rec-active-chip-empty').textContent,
    ).toContain('0 active recs');
    expect(
      screen.getByTestId(/^rec-inactive-chip-/).textContent,
    ).toContain('2 inactive recs');
  });
});

describe('Reactivity — chip re-classifies when itemsById changes', () => {
  // These tests pin the unit-level reactivity contract: when the parent's
  // `itemsById` (which holds each rec target's menu_associations) updates
  // mid-mount — e.g., MenuManagerClient's setItems after handleRefresh
  // resyncs from the React Query cache — the chip MUST re-render with
  // the freshly-classified split. The full network path is covered by
  // rec-chips-bring-into-menu.spec.ts; this file proves the React layer
  // in isolation so a regression in classifyRecMembers' memoisation
  // (e.g., reading from a stale closure, missing menusById dep) is
  // caught at the unit tier instead of waiting for E2E.

  const owningItem = makeItem({ id: 'owner-1', name: 'Biryani — Lamb' });
  const menus = [makeMenu()];

  // Re-classify the same grouping members against an updated
  // itemsById: the rec target gains a live menu_association, which
  // should flip it from Inactive → Active without remounting the chip.
  it('flips inactive → active when the rec target gains a live menu_association', () => {
    const recId = 'reactivity-rec-1';
    const member = makeRecMember({
      id: 'gi-r-1',
      menu_item_id: recId,
      name: 'Truffle Sauce',
    });
    const grouping = makeGrouping([member]);

    // Initial — rec target is orphan.
    const orphanItemsById = new Map<string, MenuItemDisplay>([
      [recId, makeItem({ id: recId, name: 'Truffle Sauce', menu_associations: [] })],
    ]);
    const { rerender } = render(
      <RecGroupingChips
        grouping={grouping}
        owningItem={owningItem}
        menuId="menu-dinner"
        itemsById={orphanItemsById}
        menus={menus}
      />,
    );
    expect(screen.getByTestId(/^rec-inactive-chip-/).textContent).toContain(
      '1 inactive',
    );
    expect(screen.getByTestId('rec-active-chip-empty').textContent).toContain(
      '0 active',
    );

    // Mutate: same member id, but now the rec target has a live placement.
    // This mirrors what MenuManagerClient's items state looks like after
    // handleRefresh has run and the cache has the new menu_associations.
    const liveItemsById = new Map<string, MenuItemDisplay>([
      [
        recId,
        makeItem({
          id: recId,
          name: 'Truffle Sauce',
          menu_associations: [
            {
              menu_id: 'menu-dinner',
              menu_name: 'Dinner',
              price: null,
              category_name: null,
              canonical_categories: [],
              boost_level: null,
              chefs_special: false,
              portion_type: 'single',
              portion_serves: null,
            },
          ],
        }),
      ],
    ]);
    rerender(
      <RecGroupingChips
        grouping={grouping}
        owningItem={owningItem}
        menuId="menu-dinner"
        itemsById={liveItemsById}
        menus={menus}
      />,
    );

    // Active chip now reflects the live placement; inactive drops to 0.
    // Querying by the gi-{id} testid (not -empty) confirms it switched
    // from the empty-fallback render path into the populated branch.
    expect(screen.getByTestId(`rec-active-chip-${member.id}`).textContent)
      .toContain('1 active');
    expect(screen.getByTestId(/^rec-inactive-chip-/).textContent).toContain(
      '0 inactive',
    );
  });

  // The reverse direction matters too — removing a member from a menu
  // (or pausing the only menu it's on) should flip the chip back to
  // Inactive. The MenuBuilder doesn't drive this today, but the pure
  // chip contract holds regardless of which surface produces the
  // update.
  it('flips active → inactive when the rec target loses all live menu_associations', () => {
    const recId = 'reactivity-rec-2';
    const member = makeRecMember({
      id: 'gi-r-2',
      menu_item_id: recId,
      name: 'House Wine',
    });
    const grouping = makeGrouping([member]);

    const liveItemsById = new Map<string, MenuItemDisplay>([
      [
        recId,
        makeItem({
          id: recId,
          name: 'House Wine',
          menu_associations: [
            {
              menu_id: 'menu-dinner',
              menu_name: 'Dinner',
              price: null,
              category_name: null,
              canonical_categories: [],
              boost_level: null,
              chefs_special: false,
              portion_type: 'single',
              portion_serves: null,
            },
          ],
        }),
      ],
    ]);
    const { rerender } = render(
      <RecGroupingChips
        grouping={grouping}
        owningItem={owningItem}
        menuId="menu-dinner"
        itemsById={liveItemsById}
        menus={menus}
      />,
    );
    expect(screen.getByTestId(`rec-active-chip-${member.id}`).textContent)
      .toContain('1 active');

    // Re-render with the member's menu_associations cleared.
    const orphanItemsById = new Map<string, MenuItemDisplay>([
      [recId, makeItem({ id: recId, name: 'House Wine', menu_associations: [] })],
    ]);
    rerender(
      <RecGroupingChips
        grouping={grouping}
        owningItem={owningItem}
        menuId="menu-dinner"
        itemsById={orphanItemsById}
        menus={menus}
      />,
    );
    expect(screen.getByTestId(/^rec-inactive-chip-/).textContent).toContain(
      '1 inactive',
    );
    expect(screen.getByTestId('rec-active-chip-empty').textContent).toContain(
      '0 active',
    );
  });

  // Menu schedule changes also drive re-classification — pausing the
  // menu the member is on (menus[].active flip) MUST move the chip back
  // to Inactive even though menu_associations didn't change. Same path
  // the chip flips through when the owner toggles a menu off.
  it('flips active → inactive when the only menu the target is on is paused', () => {
    const recId = 'reactivity-rec-3';
    const member = makeRecMember({
      id: 'gi-r-3',
      menu_item_id: recId,
      name: 'Mint Chutney',
    });
    const grouping = makeGrouping([member]);
    const itemsById = new Map<string, MenuItemDisplay>([
      [
        recId,
        makeItem({
          id: recId,
          name: 'Mint Chutney',
          menu_associations: [
            {
              menu_id: 'menu-dinner',
              menu_name: 'Dinner',
              price: null,
              category_name: null,
              canonical_categories: [],
              boost_level: null,
              chefs_special: false,
              portion_type: 'single',
              portion_serves: null,
            },
          ],
        }),
      ],
    ]);

    const { rerender } = render(
      <RecGroupingChips
        grouping={grouping}
        owningItem={owningItem}
        menuId="menu-dinner"
        itemsById={itemsById}
        menus={[makeMenu()]}
      />,
    );
    expect(screen.getByTestId(`rec-active-chip-${member.id}`).textContent)
      .toContain('1 active');

    // Pause the menu — isMenuLiveNow returns false → chip flips.
    rerender(
      <RecGroupingChips
        grouping={grouping}
        owningItem={owningItem}
        menuId="menu-dinner"
        itemsById={itemsById}
        menus={[makeMenu({ active: false })]}
      />,
    );
    expect(screen.getByTestId(/^rec-inactive-chip-/).textContent).toContain(
      '1 inactive',
    );
  });
});

describe('RecActiveChip hover popover', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens after the hover delay and lists the active member names', async () => {
    const recId = 'rec-active-popover';
    const member = makeRecMember({
      menu_item_id: recId,
      name: 'Garlic Naan',
    });
    const itemsById = new Map([
      [
        recId,
        makeItem({
          id: recId,
          name: 'Garlic Naan',
          menu_associations: [
            {
              menu_id: 'menu-dinner',
              menu_name: 'Dinner',
              price: null,
              category_name: null,
              canonical_categories: [],
              boost_level: null,
              chefs_special: false,
              portion_type: 'single',
              portion_serves: null,
            },
          ],
        }),
      ],
    ]);
    render(
      <RecGroupingChips
        grouping={makeGrouping([member])}
        owningItem={makeItem()}
        menuId="menu-dinner"
        itemsById={itemsById}
        menus={[makeMenu()]}
      />,
    );
    const chip = screen.getByTestId(/^rec-active-chip-/);
    fireEvent.mouseEnter(chip.parentElement!);
    // Pre-delay: popover not yet open.
    expect(screen.queryByTestId('rec-active-chip-popover')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    const popover = screen.getByTestId('rec-active-chip-popover');
    // Heading + member list both live inside the same popover. Asserting
    // on textContent avoids the multi-text-node splits React emits for
    // mixed-literal-and-binding JSX.
    expect(popover.textContent).toContain('Active');
    expect(popover.textContent).toContain('Pairings');
    expect(popover.textContent).toContain('Garlic Naan');
  });
});

describe('RecInactiveChip portal popover + Bring into Menu', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function renderWithInactiveMember(opts: {
    onBringIntoMenu?: (memberId: string, menuId: string) => void;
  }) {
    const recId = 'rec-inactive-popover';
    const member = makeRecMember({
      menu_item_id: recId,
      name: 'Lost Soup',
    });
    const itemsById = new Map([
      [recId, makeItem({ id: recId, name: 'Lost Soup', menu_associations: [] })],
    ]);
    render(
      <RecGroupingChips
        grouping={makeGrouping([member])}
        owningItem={makeItem({ id: 'owner-1', name: 'Biryani — Lamb' })}
        menuId="menu-dinner"
        itemsById={itemsById}
        menus={[makeMenu()]}
        onBringIntoMenu={opts.onBringIntoMenu}
      />,
    );
    return { recId };
  }

  it('opens the popover on hover after the delay (portal to document.body)', async () => {
    renderWithInactiveMember({});
    const chip = screen.getByTestId(/^rec-inactive-chip-/);
    fireEvent.mouseEnter(chip.parentElement!);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    const popover = screen.getByTestId('rec-inactive-chip-popover');
    expect(popover).toBeInTheDocument();
    // Verify portal: popover renders into document.body, not the chip's
    // ancestor DOM (which would put a <button> inside the row's <button>).
    expect(popover.parentElement).toBe(document.body);
    expect(popover.textContent).toContain('Lost Soup');
  });

  it('fires onBringIntoMenu with (memberId, ownerMenuId) when the button is clicked', async () => {
    const onBringIntoMenu = vi.fn();
    const { recId } = renderWithInactiveMember({ onBringIntoMenu });
    const chip = screen.getByTestId(/^rec-inactive-chip-/);
    fireEvent.mouseEnter(chip.parentElement!);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    const btn = screen.getByTestId(`menu-builder-bring-into-menu-${recId}`);
    fireEvent.click(btn);
    expect(onBringIntoMenu).toHaveBeenCalledWith(recId, 'menu-dinner');
  });

  it('omits the Bring-into-Menu button when no handler is provided (waiter/admin)', () => {
    renderWithInactiveMember({});
    const chip = screen.getByTestId(/^rec-inactive-chip-/);
    fireEvent.mouseEnter(chip.parentElement!);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(
      screen.queryByTestId(/^menu-builder-bring-into-menu-/),
    ).not.toBeInTheDocument();
  });

  it('keeps the popover open while the cursor sits on it (grace period reset)', () => {
    renderWithInactiveMember({ onBringIntoMenu: vi.fn() });
    const chip = screen.getByTestId(/^rec-inactive-chip-/);
    const triggerWrap = chip.parentElement!;
    fireEvent.mouseEnter(triggerWrap);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    const popover = screen.getByTestId('rec-inactive-chip-popover');
    // Mouse leaves chip but enters popover within the grace period →
    // the pending close timer must be cancelled.
    fireEvent.mouseLeave(triggerWrap);
    fireEvent.mouseEnter(popover);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByTestId('rec-inactive-chip-popover')).toBeInTheDocument();
  });

  it('closes the popover after the leave grace period elapses with no re-entry', () => {
    renderWithInactiveMember({ onBringIntoMenu: vi.fn() });
    const chip = screen.getByTestId(/^rec-inactive-chip-/);
    const triggerWrap = chip.parentElement!;
    fireEvent.mouseEnter(triggerWrap);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.queryByTestId('rec-inactive-chip-popover')).toBeInTheDocument();
    fireEvent.mouseLeave(triggerWrap);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(
      screen.queryByTestId('rec-inactive-chip-popover'),
    ).not.toBeInTheDocument();
  });

  it('closes the popover after a successful Bring into Menu click', () => {
    const onBringIntoMenu = vi.fn();
    const { recId } = renderWithInactiveMember({ onBringIntoMenu });
    const chip = screen.getByTestId(/^rec-inactive-chip-/);
    fireEvent.mouseEnter(chip.parentElement!);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    fireEvent.click(screen.getByTestId(`menu-builder-bring-into-menu-${recId}`));
    expect(
      screen.queryByTestId('rec-inactive-chip-popover'),
    ).not.toBeInTheDocument();
  });
});

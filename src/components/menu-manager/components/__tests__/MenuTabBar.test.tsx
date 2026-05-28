// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import MenuTabBar, {
  formatMenuTabSubLabel,
  getMenuTabStatus,
} from '../MenuTabBar';
import type { MenuSummary } from '../../../../types/restaurant';

function menu(partial: Partial<MenuSummary> & { id: string }): MenuSummary {
  return {
    name: 'Lunch',
    slug: 'lunch',
    display_order: 0,
    active: true,
    start_time: '11:00',
    end_time: '15:00',
    days_of_week: [1, 2, 3, 4, 5],
    is_all_day: false,
    schedule: null,
    item_count: 7,
    ...partial,
  };
}

describe('formatMenuTabSubLabel', () => {
  it('renders "All day · Daily" for a 7-day all-day menu', () => {
    expect(
      formatMenuTabSubLabel(menu({ id: 'm', is_all_day: true, days_of_week: [0, 1, 2, 3, 4, 5, 6] })),
    ).toBe('All day · Daily');
  });

  it('keeps both periods when start is am and end is pm', () => {
    expect(
      formatMenuTabSubLabel(menu({ id: 'm', start_time: '11:00', end_time: '15:00', days_of_week: [1, 2, 3, 4, 5] })),
    ).toBe('11am–3pm · Weekdays');
  });

  it('strips redundant period when both endpoints share am/pm', () => {
    expect(
      formatMenuTabSubLabel(menu({ id: 'm', start_time: '13:00', end_time: '17:00', days_of_week: [1, 2, 3, 4, 5] })),
    ).toBe('1–5pm · Weekdays');
  });

  it('keeps both periods when am/pm differ', () => {
    expect(
      formatMenuTabSubLabel(menu({ id: 'm', start_time: '07:00', end_time: '14:00', days_of_week: [6] })),
    ).toBe('7am–2pm · Sat');
  });

  it('uses per-day schedule entry when row-level times are missing', () => {
    // Wed-only menu — backend stored window in schedule[3] but left row-level null.
    expect(
      formatMenuTabSubLabel(
        menu({
          id: 'm',
          start_time: null,
          end_time: null,
          days_of_week: [3],
          schedule: { '3': { start: '11:00', end: '22:00' } },
        }),
      ),
    ).toBe('11am–10pm · Wed');
  });

  it('falls back to day label when no times resolve', () => {
    expect(
      formatMenuTabSubLabel(menu({ id: 'm', start_time: null, end_time: null, days_of_week: [1, 2] })),
    ).toBe('Mon · Tue');
  });
});

describe('getMenuTabStatus', () => {
  // Wednesday at noon
  const wedNoon = new Date(2026, 4, 27, 12, 0, 0);

  it('returns "archived" for !active menus', () => {
    expect(getMenuTabStatus(menu({ id: 'm', active: false }), wedNoon)).toBe('archived');
  });

  it('returns "active" when current time falls inside row-level window', () => {
    expect(getMenuTabStatus(menu({ id: 'm', start_time: '11:00', end_time: '15:00', days_of_week: [3] }), wedNoon)).toBe('active');
  });

  it('returns "scheduled" when current time is outside window', () => {
    expect(getMenuTabStatus(menu({ id: 'm', start_time: '17:00', end_time: '22:00', days_of_week: [3] }), wedNoon)).toBe('scheduled');
  });

  it('returns "scheduled" when today is not in days_of_week', () => {
    expect(getMenuTabStatus(menu({ id: 'm', start_time: '11:00', end_time: '15:00', days_of_week: [6] }), wedNoon)).toBe('scheduled');
  });

  it('honours per-day schedule entry over row-level null (repro of Wed-only bug)', () => {
    expect(
      getMenuTabStatus(
        menu({
          id: 'm',
          start_time: null,
          end_time: null,
          days_of_week: [3],
          schedule: { '3': { start: '11:00', end: '22:00' } },
        }),
        wedNoon,
      ),
    ).toBe('active');
  });

  it('returns "active" for is_all_day on a serving day', () => {
    expect(
      getMenuTabStatus(menu({ id: 'm', is_all_day: true, days_of_week: [3], start_time: null, end_time: null }), wedNoon),
    ).toBe('active');
  });

  it('coerces stringified days_of_week numbers', () => {
    expect(
      getMenuTabStatus(
        menu({ id: 'm', start_time: '11:00', end_time: '15:00', days_of_week: ['3' as unknown as number] }),
        wedNoon,
      ),
    ).toBe('active');
  });
});

describe('<MenuTabBar />', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 2026-05-27 Wednesday at 12:00:00 local
    vi.setSystemTime(new Date(2026, 4, 27, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(menus: MenuSummary[], overrides: Partial<{
    activeMenuId: string | null;
    onTabChange: (id: string) => void;
    onEditMenu: (id: string) => void;
    onCreateMenu: (name: string) => Promise<void>;
    onCloneMenu: (() => void) | undefined;
  }> = {}) {
    const onTabChange = overrides.onTabChange ?? vi.fn();
    const onEditMenu = overrides.onEditMenu ?? vi.fn();
    const onCreateMenu = overrides.onCreateMenu ?? vi.fn(async () => {});
    const onCloneMenu = overrides.onCloneMenu;
    render(
      <MenuTabBar
        menus={menus}
        activeMenuId={overrides.activeMenuId ?? menus[0]?.id ?? null}
        onTabChange={onTabChange}
        onEditMenu={onEditMenu}
        onCreateMenu={onCreateMenu}
        onCloneMenu={onCloneMenu}
      />,
    );
    return { onTabChange, onEditMenu, onCreateMenu, onCloneMenu };
  }

  it('renders one tab per menu with name + sublabel', () => {
    setup([
      menu({ id: 'lunch', name: 'Lunch', start_time: '11:00', end_time: '15:00', days_of_week: [1, 2, 3, 4, 5] }),
      menu({ id: 'dinner', name: 'Dinner', start_time: '17:00', end_time: '22:00', days_of_week: [1, 2, 3, 4, 5] }),
    ]);
    expect(screen.getByTestId('menu-tab-lunch')).toBeTruthy();
    expect(screen.getByTestId('menu-tab-dinner')).toBeTruthy();
    expect(screen.getByTestId('menu-tab-lunch-sub').textContent).toContain('11am–3pm');
    expect(screen.getByTestId('menu-tab-dinner-sub').textContent).toContain('5–10pm');
  });

  it('renders ACTIVE pill for the menu running right now', () => {
    setup([menu({ id: 'lunch', name: 'Lunch', start_time: '11:00', end_time: '15:00', days_of_week: [3] })]);
    expect(screen.getByTestId('menu-tab-status-active')).toBeTruthy();
    expect(screen.getByTestId('menu-tab-status-active').textContent).toContain('ACTIVE');
  });

  it('renders SCHEDULED pill outside window', () => {
    setup([menu({ id: 'dinner', name: 'Dinner', start_time: '17:00', end_time: '22:00', days_of_week: [3] })]);
    expect(screen.getByTestId('menu-tab-status-scheduled')).toBeTruthy();
    expect(screen.getByTestId('menu-tab-status-scheduled').textContent).toContain('SCHEDULED');
  });

  it('renders INACTIVE pill (label rename) for !active menus', () => {
    setup([menu({ id: 'archived', name: 'Old', active: false })]);
    const pill = screen.getByTestId('menu-tab-status-archived');
    expect(pill).toBeTruthy();
    expect(pill.textContent).toContain('INACTIVE');
    expect(pill.textContent).not.toContain('ARCHIVED');
  });

  it('clicking a tab calls onTabChange with the menu id', () => {
    const { onTabChange } = setup([
      menu({ id: 'lunch' }),
      menu({ id: 'dinner', name: 'Dinner', start_time: '17:00', end_time: '22:00' }),
    ], { activeMenuId: 'lunch' });
    fireEvent.click(screen.getByTestId('menu-tab-dinner'));
    expect(onTabChange).toHaveBeenCalledWith('dinner');
  });

  it('edit pencil only renders on the active tab; click fires onEditMenu', () => {
    const { onEditMenu } = setup([
      menu({ id: 'lunch' }),
      menu({ id: 'dinner', name: 'Dinner' }),
    ], { activeMenuId: 'lunch' });
    expect(screen.getByTestId('edit-menu-tab-lunch')).toBeTruthy();
    expect(screen.queryByTestId('edit-menu-tab-dinner')).toBeNull();
    fireEvent.click(screen.getByTestId('edit-menu-tab-lunch'));
    expect(onEditMenu).toHaveBeenCalledWith('lunch');
  });

  it('+ New menu button opens inline create input', () => {
    setup([menu({ id: 'lunch' })]);
    expect(screen.queryByTestId('new-menu-name-input')).toBeNull();
    fireEvent.click(screen.getByTestId('add-menu-btn'));
    expect(screen.getByTestId('new-menu-name-input')).toBeTruthy();
  });

  it('Enter on the inline input creates a menu and clears the form', async () => {
    const onCreateMenu = vi.fn(async () => {});
    setup([menu({ id: 'lunch' })], { onCreateMenu });
    fireEvent.click(screen.getByTestId('add-menu-btn'));
    const input = screen.getByTestId('new-menu-name-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Brunch' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(onCreateMenu).toHaveBeenCalledWith('Brunch');
    // After resolution, form should close
    expect(screen.queryByTestId('new-menu-name-input')).toBeNull();
  });

  it('Clone button is hidden when onCloneMenu is omitted', () => {
    setup([menu({ id: 'lunch' })]);
    expect(screen.queryByTestId('clone-menu-btn')).toBeNull();
  });

  it('Clone button is visible and clickable when onCloneMenu is supplied', () => {
    const onCloneMenu = vi.fn();
    setup([menu({ id: 'lunch' })], { onCloneMenu });
    const btn = screen.getByTestId('clone-menu-btn');
    fireEvent.click(btn);
    expect(onCloneMenu).toHaveBeenCalled();
  });

  it('the 60s clock tick re-evaluates status', () => {
    // Start 14:59 → still ACTIVE during 11-15
    vi.setSystemTime(new Date(2026, 4, 27, 14, 59, 0));
    setup([menu({ id: 'lunch', start_time: '11:00', end_time: '15:00', days_of_week: [3] })]);
    expect(screen.getByTestId('menu-tab-status-active')).toBeTruthy();
    // Advance the clock past 15:00 and trigger the interval
    vi.setSystemTime(new Date(2026, 4, 27, 15, 1, 0));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.queryByTestId('menu-tab-status-active')).toBeNull();
    expect(screen.getByTestId('menu-tab-status-scheduled')).toBeTruthy();
  });
});

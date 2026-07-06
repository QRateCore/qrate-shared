// @vitest-environment jsdom
/**
 * STR-858 — mobile menu switcher tests for MobileMenuManagerLayout.
 * The desktop MenuTabBar isn't rendered on mobile; this component surfaces menu
 * switching + a live/scheduled indicator on a phone. Heavy children (ItemPool /
 * MenuBuilder / ItemPoolDrawer) are stubbed so we test only the switcher UI.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('../ItemPool', () => ({ default: () => <div data-testid="stub-itempool" /> }));
vi.mock('../MenuBuilder', () => ({ default: () => <div data-testid="stub-menubuilder" /> }));
vi.mock('../ItemPoolDrawer', () => ({ default: () => <div data-testid="stub-drawer" /> }));

import MobileMenuManagerLayout from '../MobileMenuManagerLayout';
import type { MenuSummary } from '../../../../types/restaurant';

function menu(id: string, name: string, active = true, allDay = false): MenuSummary {
  return {
    id, name, active,
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    is_all_day: allDay,
  } as unknown as MenuSummary;
}

function renderLayout(over: Partial<React.ComponentProps<typeof MobileMenuManagerLayout>> = {}) {
  const onSelectMenu = vi.fn();
  const menus = [menu('m1', 'Lunch', true, true), menu('m2', 'Dinner', true, false)];
  render(
    <MobileMenuManagerLayout
      itemsCount={3}
      drawerOpen={false}
      onDrawerOpenChange={vi.fn()}
      itemPoolProps={{} as never}
      menuBuilderProps={{} as never}
      menus={menus}
      activeMenuId="m1"
      onSelectMenu={onSelectMenu}
      {...over}
    />,
  );
  return { onSelectMenu, menus };
}

describe('MobileMenuManagerLayout — mobile menu switcher (STR-858)', () => {
  it('renders the active menu name + a live-now indicator', () => {
    renderLayout();
    const switcher = screen.getByTestId('mobile-menu-switcher');
    expect(switcher.textContent).toContain('Lunch');
    // Lunch is all-day + every service day → live now.
    expect(screen.getByTestId('mobile-menu-status-active')).toBeTruthy();
  });

  it('opens the menu sheet and lists all menus on tap', () => {
    renderLayout();
    fireEvent.click(screen.getByTestId('mobile-menu-switcher'));
    expect(screen.getByTestId('mobile-menu-sheet')).toBeTruthy();
    expect(screen.getByTestId('mobile-menu-sheet-item-m1')).toBeTruthy();
    expect(screen.getByTestId('mobile-menu-sheet-item-m2')).toBeTruthy();
  });

  it('switches menu and closes the sheet when a menu is selected', () => {
    const { onSelectMenu } = renderLayout();
    fireEvent.click(screen.getByTestId('mobile-menu-switcher'));
    fireEvent.click(screen.getByTestId('mobile-menu-sheet-item-m2'));
    expect(onSelectMenu).toHaveBeenCalledWith('m2');
    expect(screen.queryByTestId('mobile-menu-sheet')).toBeNull();
  });

  it('renders no switcher when there are no menus', () => {
    renderLayout({ menus: [], activeMenuId: null });
    expect(screen.queryByTestId('mobile-menu-switcher')).toBeNull();
  });

  it('sorts the sheet list by status — live-now menus first', () => {
    // Fixture deliberately out of order: a Paused menu, then a Scheduled one,
    // then a Live (all-day) one. The sheet must reorder to active → scheduled → paused.
    const menus = [
      menu('paused', 'Late Night', false, false), // active:false → 'archived'/Paused
      menu('sched', 'Dinner', true, false),       // not all-day → 'scheduled'
      menu('live', 'Lunch', true, true),          // all-day, every day → 'active'
    ];
    renderLayout({ menus, activeMenuId: 'live' });
    fireEvent.click(screen.getByTestId('mobile-menu-switcher'));
    const sheet = screen.getByTestId('mobile-menu-sheet');
    const order = Array.from(sheet.querySelectorAll('[data-testid^="mobile-menu-sheet-item-"]'))
      .map((el) => el.getAttribute('data-testid'));
    expect(order).toEqual([
      'mobile-menu-sheet-item-live',
      'mobile-menu-sheet-item-sched',
      'mobile-menu-sheet-item-paused',
    ]);
  });
});

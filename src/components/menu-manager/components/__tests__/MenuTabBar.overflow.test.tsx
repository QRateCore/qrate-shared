// @vitest-environment jsdom
/**
 * Compact menu tabs that don't fit go behind a "⋯" button (owner Menu
 * workspace, Avi 2026-11-12). Pinned:
 *  - fitMenuTabs keeps tab order, reserves room for the button, and always
 *    shows the selected menu (it takes the last visible slot);
 *  - the component shows only the fitting tabs, the button carries the count,
 *    and its menu lists the hidden menus; picking one switches to it;
 *  - nothing overflows → no button.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import MenuTabBar, { fitMenuTabs } from '../MenuTabBar';
import type { MenuSummary } from '../../../../types/restaurant';

const menu = (id: string, name: string, active = true): MenuSummary =>
  ({ id, name, slug: id, display_order: 0, active, start_time: null, end_time: null, days_of_week: [], is_all_day: true, schedule: null, item_count: 5 }) as unknown as MenuSummary;

describe('fitMenuTabs', () => {
  it('everything fits → no overflow', () => {
    expect(fitMenuTabs([100, 100, 100], 300, 48, 0)).toEqual({ visible: [0, 1, 2], hidden: [] });
  });

  it('fills in order and reserves the button width', () => {
    // room = 350 - 48 = 302 → three 100px tabs fit, the fourth hides.
    expect(fitMenuTabs([100, 100, 100, 100], 350, 48, 0)).toEqual({ visible: [0, 1, 2], hidden: [3] });
  });

  it('the selected menu is always shown — it takes the last visible slot', () => {
    expect(fitMenuTabs([100, 100, 100, 100], 350, 48, 3)).toEqual({ visible: [0, 1, 3], hidden: [2] });
  });

  it('drops as many trailing tabs as needed for a wide selected tab', () => {
    expect(fitMenuTabs([100, 100, 100, 250], 350, 48, 3)).toEqual({ visible: [3], hidden: [0, 1, 2] });
  });

  it('shows at least one tab even when none fit', () => {
    expect(fitMenuTabs([400, 400], 300, 48, 0)).toEqual({ visible: [0], hidden: [1] });
  });

  it('no menus → nothing', () => {
    expect(fitMenuTabs([], 300, 48, -1)).toEqual({ visible: [], hidden: [] });
  });
});

describe('compact MenuTabBar overflow', () => {
  let wrapWidth = 350;
  const origOffset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  const origClient = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return (this as HTMLElement).tagName === 'SPAN' ? 100 : 0; } });
    // The bar's wrapper reports the room; the ⋯ measuring span reports 48.
    Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get() { return (this as HTMLElement).dataset?.compact === 'true' ? wrapWidth : 0; } });
  });
  afterEach(() => {
    if (origOffset) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', origOffset);
    if (origClient) Object.defineProperty(Element.prototype, 'clientWidth', origClient);
    wrapWidth = 350;
  });

  const MENUS = [menu('a', 'Lunch'), menu('b', 'Dinner'), menu('c', 'Brunch'), menu('d', 'Wine', false)];
  const renderBar = (activeMenuId: string, onTabChange = vi.fn()) => {
    render(<MenuTabBar menus={MENUS} activeMenuId={activeMenuId} onTabChange={onTabChange} onEditMenu={vi.fn()} onCreateMenu={vi.fn(async () => {})} compact />);
    return onTabChange;
  };

  it('shows the tabs that fit, a "⋯ N" button, and lists the rest in its menu', () => {
    // Every measured span is 100px (the ⋯ measure too) → room 250 → two tabs.
    const onTabChange = renderBar('a');
    expect(screen.getByTestId('menu-tab-a')).toBeTruthy();
    expect(screen.getByTestId('menu-tab-b')).toBeTruthy();
    expect(screen.queryByTestId('menu-tab-c')).toBeNull();
    const btn = screen.getByTestId('menu-tab-overflow-btn');
    expect(btn.getAttribute('aria-label')).toBe('More menus (2)');
    expect(btn.textContent).toContain('2');
    expect(screen.queryByTestId('menu-tab-overflow-menu')).toBeNull();
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('menu-tab-overflow-item-c').textContent).toContain('Brunch');
    expect(screen.getByTestId('menu-tab-overflow-item-d').getAttribute('data-menu-status')).toBe('inactive');
    fireEvent.click(screen.getByTestId('menu-tab-overflow-item-d'));
    expect(onTabChange).toHaveBeenCalledWith('d');
    expect(screen.queryByTestId('menu-tab-overflow-menu')).toBeNull();
  });

  it('a hidden selected menu is shown in the last visible slot', () => {
    renderBar('d');
    expect(screen.getByTestId('menu-tab-d').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('menu-tab-a')).toBeTruthy();
    expect(screen.queryByTestId('menu-tab-b')).toBeNull();
  });

  it('Escape and an outside click close the list', () => {
    renderBar('a');
    fireEvent.click(screen.getByTestId('menu-tab-overflow-btn'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('menu-tab-overflow-menu')).toBeNull();
    fireEvent.click(screen.getByTestId('menu-tab-overflow-btn'));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('menu-tab-overflow-menu')).toBeNull();
  });

  it('when everything fits there is no ⋯ button', () => {
    wrapWidth = 2000;
    renderBar('a');
    for (const id of ['a', 'b', 'c', 'd']) expect(screen.getByTestId(`menu-tab-${id}`)).toBeTruthy();
    expect(screen.queryByTestId('menu-tab-overflow-btn')).toBeNull();
  });

  it('the measuring copy lists every menu, sits in a clipped invisible box, and is not in the menu-tab- testid family', () => {
    renderBar('a');
    const meas = screen.getByTestId('menu-tabs-measure');
    expect(meas.children.length).toBe(4);
    for (const id of ['a', 'b', 'c', 'd']) expect(screen.getByTestId(`menu-tabs-measure-item-${id}`)).toBeTruthy();
    const box = meas.parentElement!;
    expect(box.className).toContain('overflow-hidden');
    expect(box.className).toContain('invisible');
    expect(box.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelectorAll('[data-testid^="menu-tab-"][aria-hidden="true"]').length).toBe(0);
  });

  it('keyboard: ↓ on ⋯ opens the list with focus on the first menu; ↑/↓ move; Escape closes and returns focus', () => {
    renderBar('a');
    const btn = screen.getByTestId('menu-tab-overflow-btn');
    btn.focus();
    fireEvent.keyDown(btn, { key: 'ArrowDown' });
    const first = screen.getByTestId('menu-tab-overflow-item-c');
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('menu-tab-overflow-item-d'));
    fireEvent.keyDown(screen.getByTestId('menu-tab-overflow-item-d'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(first); // wraps
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('menu-tab-overflow-menu')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });
});

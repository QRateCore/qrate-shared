// @vitest-environment jsdom
/**
 * v5 Menu page (2026-11-12): compact MenuTabBar with `wrapTabs` renders EVERY
 * menu as a tab (the row wraps) — no "⋯ N" overflow button, no measuring copy.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import MenuTabBar from '../MenuTabBar';
import type { MenuSummary } from '../../../../types/restaurant';

const menu = (id: string, name: string, active = true): MenuSummary =>
  ({ id, name, slug: id, display_order: 0, active, start_time: null, end_time: null, days_of_week: [], is_all_day: true, schedule: null, item_count: 5 }) as unknown as MenuSummary;

const MENUS = [menu('a', 'Lunch'), menu('b', 'Dinner'), menu('c', 'Brunch'), menu('d', 'Wine', false), menu('e', 'x'.repeat(200))];

describe('compact MenuTabBar — wrapTabs', () => {
  it('renders every menu as a tab and no overflow button', () => {
    const onTabChange = vi.fn();
    render(<MenuTabBar menus={MENUS} activeMenuId="a" onTabChange={onTabChange} onEditMenu={vi.fn()} onCreateMenu={vi.fn(async () => {})} compact wrapTabs />);
    const bar = screen.getByTestId('menu-tab-bar');
    expect(bar.getAttribute('data-wrap')).toBe('true');
    expect(bar.className).toContain('flex-wrap');
    for (const m of MENUS) expect(screen.getByTestId(`menu-tab-${m.id}`)).toBeTruthy();
    expect(screen.queryByTestId('menu-tab-overflow-btn')).toBeNull();
    expect(screen.queryByTestId('menu-tabs-measure')).toBeNull();
    expect(screen.getByTestId('menu-tab-a').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('menu-tab-d').getAttribute('data-menu-status')).toBe('inactive');
    fireEvent.click(screen.getByTestId('menu-tab-c'));
    expect(onTabChange).toHaveBeenCalledWith('c');
  });

  it('a very long name is truncated inside a tab that cannot exceed the row', () => {
    render(<MenuTabBar menus={MENUS} activeMenuId="a" onTabChange={vi.fn()} onEditMenu={vi.fn()} onCreateMenu={vi.fn(async () => {})} compact wrapTabs />);
    const tab = screen.getByTestId('menu-tab-e');
    expect(tab.className).toContain('max-w-full');
    const name = Array.from(tab.querySelectorAll('span')).find((s) => s.textContent === 'x'.repeat(200))!;
    expect(name.className).toContain('truncate');
  });

  it('without wrapTabs the folding strip is unchanged (measuring copy present)', () => {
    render(<MenuTabBar menus={MENUS} activeMenuId="a" onTabChange={vi.fn()} onEditMenu={vi.fn()} onCreateMenu={vi.fn(async () => {})} compact />);
    expect(screen.getByTestId('menu-tabs-measure')).toBeTruthy();
  });
});

import { describe, it, expect } from 'vitest';
import type { MenuSummary } from '../../types/restaurant';
import { isMenuLiveNow, classifyRecMember } from '../menuSchedule';

function makeMenu(overrides: Partial<MenuSummary> = {}): MenuSummary {
  return {
    id: 'menu-1',
    name: 'Dinner',
    slug: 'dinner',
    display_order: 0,
    active: true,
    start_time: '17:00',
    end_time: '22:00',
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    is_all_day: false,
    schedule: null,
    item_count: 0,
    ...overrides,
  };
}

// 2026-05-27 is a Wednesday in browser local time (dow=3).
function at(localISO: string): Date {
  return new Date(localISO);
}

describe('isMenuLiveNow', () => {
  it('returns false when menu is flagged inactive — owner paused', () => {
    const menu = makeMenu({ active: false });
    expect(isMenuLiveNow(menu, at('2026-05-27T18:00:00'))).toBe(false);
  });

  it('returns true within HH:MM window on a published day', () => {
    const menu = makeMenu({ start_time: '17:00', end_time: '22:00' });
    expect(isMenuLiveNow(menu, at('2026-05-27T19:00:00'))).toBe(true);
  });

  it('returns false before HH:MM window opens', () => {
    const menu = makeMenu({ start_time: '17:00', end_time: '22:00' });
    expect(isMenuLiveNow(menu, at('2026-05-27T16:59:00'))).toBe(false);
  });

  it('treats end_time as exclusive — exactly at end is no longer live', () => {
    const menu = makeMenu({ start_time: '17:00', end_time: '22:00' });
    expect(isMenuLiveNow(menu, at('2026-05-27T22:00:00'))).toBe(false);
  });

  it('returns false on a day not in days_of_week', () => {
    // 2026-05-27 is Wednesday (dow=3). Menu published Mon/Tue only.
    const menu = makeMenu({ days_of_week: [1, 2] });
    expect(isMenuLiveNow(menu, at('2026-05-27T19:00:00'))).toBe(false);
  });

  it('handles a wrap-around window (17:00 → 02:00) before midnight', () => {
    const menu = makeMenu({ start_time: '17:00', end_time: '02:00' });
    expect(isMenuLiveNow(menu, at('2026-05-27T23:30:00'))).toBe(true);
  });

  it('handles a wrap-around window (17:00 → 02:00) after midnight', () => {
    const menu = makeMenu({ start_time: '17:00', end_time: '02:00' });
    expect(isMenuLiveNow(menu, at('2026-05-27T01:00:00'))).toBe(true);
  });

  it('treats is_all_day=true as live on every day in days_of_week', () => {
    const menu = makeMenu({
      is_all_day: true,
      start_time: null,
      end_time: null,
    });
    expect(isMenuLiveNow(menu, at('2026-05-27T03:00:00'))).toBe(true);
  });

  it('treats is_all_day=true on a day not in days_of_week as off', () => {
    const menu = makeMenu({
      is_all_day: true,
      start_time: null,
      end_time: null,
      days_of_week: [0, 6], // weekends only
    });
    expect(isMenuLiveNow(menu, at('2026-05-27T03:00:00'))).toBe(false);
  });

  it('per-day schedule overrides legacy start_time/end_time', () => {
    const menu = makeMenu({
      start_time: '17:00',
      end_time: '22:00',
      schedule: {
        // Wednesday: lunch-only override
        '3': { start: '11:30', end: '14:30' },
      },
    });
    expect(isMenuLiveNow(menu, at('2026-05-27T12:00:00'))).toBe(true);
    expect(isMenuLiveNow(menu, at('2026-05-27T19:00:00'))).toBe(false);
  });

  it('per-day schedule missing today means off — does not fall back to legacy', () => {
    const menu = makeMenu({
      start_time: '17:00',
      end_time: '22:00',
      schedule: {
        '0': { start: '10:00', end: '14:00' }, // Sunday only
      },
    });
    expect(isMenuLiveNow(menu, at('2026-05-27T19:00:00'))).toBe(false);
  });

  it('missing both start/end with day match falls back to live (no schedule cap)', () => {
    const menu = makeMenu({ start_time: null, end_time: null });
    expect(isMenuLiveNow(menu, at('2026-05-27T03:00:00'))).toBe(true);
  });
});

describe('classifyRecMember', () => {
  const dinner = makeMenu({ id: 'dinner', start_time: '17:00', end_time: '22:00' });
  const brunch = makeMenu({ id: 'brunch', name: 'Brunch', start_time: '10:00', end_time: '14:00' });
  const winter = makeMenu({
    id: 'winter',
    name: 'Winter',
    active: false,
    is_all_day: true,
    start_time: null,
    end_time: null,
  });

  it('orphan (empty menu_ids) classifies as inactive', () => {
    const result = classifyRecMember(
      { menu_ids: [] },
      [dinner, brunch],
      at('2026-05-27T19:00:00'),
    );
    expect(result).toBe('inactive');
  });

  it('active when ANY referenced menu is live now', () => {
    const result = classifyRecMember(
      { menu_ids: ['brunch', 'dinner'] },
      [dinner, brunch],
      at('2026-05-27T19:00:00'),
    );
    expect(result).toBe('active');
  });

  it('inactive when all referenced menus are outside their window', () => {
    const result = classifyRecMember(
      { menu_ids: ['brunch'] },
      [dinner, brunch],
      at('2026-05-27T19:00:00'),
    );
    expect(result).toBe('inactive');
  });

  it('inactive when referenced menu is unknown to the loaded menus list', () => {
    const result = classifyRecMember(
      { menu_ids: ['ghost-menu'] },
      [dinner, brunch],
      at('2026-05-27T19:00:00'),
    );
    expect(result).toBe('inactive');
  });

  it('inactive when referenced menu is itself paused (active=false)', () => {
    // Defence-in-depth — backend SHOULD filter these out, but the
    // frontend still rejects them via isMenuLiveNow's active check.
    const result = classifyRecMember(
      { menu_ids: ['winter'] },
      [winter],
      at('2026-05-27T19:00:00'),
    );
    expect(result).toBe('inactive');
  });
});

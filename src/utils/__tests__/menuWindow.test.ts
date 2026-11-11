/**
 * menuWindow — the owner-side mirror of core `_is_in_window` /
 * `_menu_active_at` (qrate_shared/menu_resolver.py). Minutes since midnight.
 */
import { describe, expect, it } from 'vitest';
import { isMinuteInWindow, windowCoversEarlyMorning, windowSegmentsForDay } from '../menuWindow';

const h = (hh: number, mm = 0) => hh * 60 + mm;

describe('isMinuteInWindow — core _is_in_window', () => {
  it('a normal window is inclusive of start and exclusive of end', () => {
    expect(isMinuteInWindow(h(11), h(11), h(22))).toBe(true);
    expect(isMinuteInWindow(h(21, 59), h(11), h(22))).toBe(true);
    expect(isMinuteInWindow(h(22), h(11), h(22))).toBe(false);
    expect(isMinuteInWindow(h(10, 59), h(11), h(22))).toBe(false);
  });

  it('an overnight window (end < start) is live before midnight and again from midnight to end', () => {
    expect(isMinuteInWindow(h(23), h(17), h(2))).toBe(true);
    expect(isMinuteInWindow(h(0, 30), h(17), h(2))).toBe(true);
    expect(isMinuteInWindow(h(2), h(17), h(2))).toBe(false);
    expect(isMinuteInWindow(h(12), h(17), h(2))).toBe(false);
  });

  it('a zero-length window is never live', () => {
    expect(isMinuteInWindow(h(12), h(12), h(12))).toBe(false);
    expect(isMinuteInWindow(h(0), h(0), h(0))).toBe(false);
  });
});

describe('windowSegmentsForDay', () => {
  it('one segment for a normal window', () => {
    expect(windowSegmentsForDay(h(11), h(22))).toEqual([[h(11), h(22)]]);
  });
  it('start→24:00 and 00:00→end for an overnight window', () => {
    expect(windowSegmentsForDay(h(17), h(2))).toEqual([[h(17), 1440], [0, h(2)]]);
  });
  it('nothing for a zero-length window', () => {
    expect(windowSegmentsForDay(h(12), h(12))).toEqual([]);
  });
});

describe('windowCoversEarlyMorning — does the NEXT day\'s entry serve the previous night\'s tail', () => {
  it('an overnight next-day window closing no earlier covers it', () => {
    expect(windowCoversEarlyMorning(h(17), h(2), h(2))).toBe(true);
    expect(windowCoversEarlyMorning(h(17), h(3), h(2))).toBe(true);
    expect(windowCoversEarlyMorning(h(17), h(1), h(2))).toBe(false);
  });
  it('a next-day window opening at 00:00 and closing at or after the tail covers it', () => {
    expect(windowCoversEarlyMorning(h(0), h(15), h(2))).toBe(true);
    expect(windowCoversEarlyMorning(h(0), h(2), h(2))).toBe(true);
    expect(windowCoversEarlyMorning(h(0), h(1), h(2))).toBe(false);
  });
  it('a next-day window opening later than 00:00 does not', () => {
    expect(windowCoversEarlyMorning(h(0, 30), h(15), h(2))).toBe(false);
    expect(windowCoversEarlyMorning(h(11), h(22), h(2))).toBe(false);
  });
});

/**
 * Pure-function tests for the course-header raw-category chips
 * (MenuBuilder, 2026-06-11): one chip per distinct raw sub-category in a course,
 * each with its food-item count, sorted by count desc.
 */
import { describe, it, expect } from 'vitest';
import type { MenuItemDisplay } from '../../../../types/restaurant';
import { _deriveBucketRawCategories } from '../MenuBuilder';

const mk = (id: string): MenuItemDisplay => ({ id, name: id } as MenuItemDisplay);

describe('deriveBucketRawCategories', () => {
  it('returns one entry per distinct sub-category with its food-item count', () => {
    const labels: Record<string, string[]> = {
      a: ['Biryani', '__ungrouped__'],
      b: ['Biryani'],
      c: ['Flavors of Tandoor'],
    };
    const out = _deriveBucketRawCategories(
      [mk('a'), mk('b'), mk('c')],
      (id) => labels[id],
    );
    // Biryani has 2 items, Flavors of Tandoor has 1 → sorted by count desc.
    expect(out).toEqual([
      { label: 'Biryani', count: 2 },
      { label: 'Flavors of Tandoor', count: 1 },
    ]);
  });

  it('counts distinct items, not label occurrences (an item is counted once)', () => {
    const labels: Record<string, string[]> = {
      // same item carries the same sub-category twice (variant spellings)
      a: ['Biryani', 'biryani'],
    };
    const out = _deriveBucketRawCategories([mk('a')], (id) => labels[id]);
    expect(out).toEqual([{ label: 'Biryani', count: 1 }]);
  });

  it('merges casing / spacing variants into one (most-human form wins)', () => {
    const labels: Record<string, string[]> = {
      a: ['flavors_of_tandoor'],
      b: ['Flavors of Tandoor'],
    };
    const out = _deriveBucketRawCategories([mk('a'), mk('b')], (id) => labels[id]);
    expect(out).toEqual([{ label: 'Flavors of Tandoor', count: 2 }]);
  });

  it('sorts by count desc, then label ascending', () => {
    const labels: Record<string, string[]> = {
      a: ['Soups'], b: ['Salads'], c: ['Salads'], d: ['Apps'], e: ['Apps'],
    };
    const out = _deriveBucketRawCategories(
      [mk('a'), mk('b'), mk('c'), mk('d'), mk('e')],
      (id) => labels[id],
    );
    // Apps(2) and Salads(2) tie → alphabetical; Soups(1) last.
    expect(out.map((r) => r.label)).toEqual(['Apps', 'Salads', 'Soups']);
  });

  it('returns [] when no item carries a raw label', () => {
    expect(_deriveBucketRawCategories([mk('a')], () => undefined)).toEqual([]);
    expect(_deriveBucketRawCategories([mk('a')], () => [])).toEqual([]);
  });
});

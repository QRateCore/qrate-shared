/**
 * Pure-function tests for the scoped row-trash removal decision
 * (MenuBuilder, 2026-06-13).
 *
 * The trash button on a Menu Builder item row used to delete the item from the
 * whole menu (or, for multi-category items, the current canonical category) —
 * regardless of which sub-category the row was rendered under. It is now scoped
 * to the raw sub-category the row sits under: clicking it drops ONLY that
 * sub-category from the item, preserving any other sub-category membership and
 * keeping the item on the menu. `computeRowRemoval` is that decision; these
 * tests pin every branch.
 */
import { describe, it, expect } from 'vitest';
import { UNGROUPED_KEY } from '../../lib/menuUtils';
import { _computeRowRemoval as computeRowRemoval } from '../MenuBuilder';

describe('computeRowRemoval — scoped to a real raw sub-category', () => {
  it('drops only the targeted sub-category, preserving the others', () => {
    const out = computeRowRemoval(
      { raw_categories: ['Tandoor Specials', 'Chef Picks', 'Spicy'], canonical_categories: ['Entrees'] },
      'Entrees',
      'Chef Picks',
    );
    expect(out).toEqual({ kind: 'sub-category', raw_categories: ['Tandoor Specials', 'Spicy'] });
  });

  it('removing the only sub-category yields an empty array (item falls to Ungrouped, stays on menu)', () => {
    const out = computeRowRemoval(
      { raw_categories: ['Tandoor Specials'], canonical_categories: ['Entrees'] },
      'Entrees',
      'Tandoor Specials',
    );
    expect(out).toEqual({ kind: 'sub-category', raw_categories: [] });
  });

  it('matches on the normalized key — removes casing / punctuation / underscore variants of the group label', () => {
    const out = computeRowRemoval(
      { raw_categories: ['Flavors of Tandoor', 'flavors_of_tandoor', 'FLAVORS OF TANDOOR', 'Keep Me'], canonical_categories: ['Entrees'] },
      'Entrees',
      'Flavors of Tandoor',
    );
    // All three variants normalize to "flavors of tandoor" and are removed; the
    // unrelated label survives.
    expect(out).toEqual({ kind: 'sub-category', raw_categories: ['Keep Me'] });
  });

  it('removes a variant even when the group label passed is a different spelling of the same key', () => {
    const out = computeRowRemoval(
      { raw_categories: ['Chicken (Dinner)'], canonical_categories: ['Entrees'] },
      'Entrees',
      'chicken dinner', // normalizes to the same key as "Chicken (Dinner)"
    );
    expect(out).toEqual({ kind: 'sub-category', raw_categories: [] });
  });

  it('strips the Ungrouped sentinel from the resulting raw_categories', () => {
    const out = computeRowRemoval(
      { raw_categories: ['Tandoor Specials', UNGROUPED_KEY], canonical_categories: ['Entrees'] },
      'Entrees',
      'Tandoor Specials',
    );
    expect(out).toEqual({ kind: 'sub-category', raw_categories: [] });
  });

  it('is a no-op-shaped removal when the target label is not present (returns the other labels unchanged)', () => {
    const out = computeRowRemoval(
      { raw_categories: ['Tandoor Specials', 'Spicy'], canonical_categories: ['Entrees'] },
      'Entrees',
      'Nonexistent',
    );
    expect(out).toEqual({ kind: 'sub-category', raw_categories: ['Tandoor Specials', 'Spicy'] });
  });

  it('takes precedence over the multi-canonical-category fallback — scope wins when a real sub-category is given', () => {
    const out = computeRowRemoval(
      { raw_categories: ['Tandoor Specials', 'Spicy'], canonical_categories: ['Entrees', 'Specials'] },
      'Entrees',
      'Tandoor Specials',
    );
    // Even though the item spans 2 canonical categories, a real subLabel means
    // we scope to the sub-category, NOT the canonical category.
    expect(out).toEqual({ kind: 'sub-category', raw_categories: ['Spicy'] });
  });

  it('treats missing raw_categories as empty (still a scoped removal, never throws)', () => {
    const out = computeRowRemoval(
      { canonical_categories: ['Entrees'] },
      'Entrees',
      'Tandoor Specials',
    );
    expect(out).toEqual({ kind: 'sub-category', raw_categories: [] });
  });
});

describe('computeRowRemoval — no real sub-category (Ungrouped / flat render)', () => {
  it('UNGROUPED_KEY subLabel is NOT treated as a sub-category — falls through to canonical/whole-menu', () => {
    const out = computeRowRemoval(
      { raw_categories: [], canonical_categories: ['Entrees'] },
      'Entrees',
      UNGROUPED_KEY,
    );
    expect(out).toEqual({ kind: 'whole-menu' });
  });

  it('undefined subLabel with a single canonical category → whole-menu removal', () => {
    const out = computeRowRemoval(
      { raw_categories: [], canonical_categories: ['Entrees'] },
      'Entrees',
      undefined,
    );
    expect(out).toEqual({ kind: 'whole-menu' });
  });

  it('undefined subLabel with no canonical categories → whole-menu removal', () => {
    const out = computeRowRemoval(
      { raw_categories: [], canonical_categories: [] },
      'Entrees',
      undefined,
    );
    expect(out).toEqual({ kind: 'whole-menu' });
  });

  it('undefined subLabel with missing canonical_categories → whole-menu removal', () => {
    const out = computeRowRemoval({}, 'Entrees', undefined);
    expect(out).toEqual({ kind: 'whole-menu' });
  });

  it('multi-category item in a flat bucket → removes only the current canonical category', () => {
    const out = computeRowRemoval(
      { raw_categories: [], canonical_categories: ['Entrees', 'Specials', 'Lunch'] },
      'Specials',
      undefined,
    );
    expect(out).toEqual({ kind: 'canonical-category', canonical_categories: ['Entrees', 'Lunch'] });
  });

  it('multi-category item under Ungrouped group → removes only the current canonical category', () => {
    const out = computeRowRemoval(
      { raw_categories: [UNGROUPED_KEY], canonical_categories: ['Entrees', 'Specials'] },
      'Entrees',
      UNGROUPED_KEY,
    );
    expect(out).toEqual({ kind: 'canonical-category', canonical_categories: ['Specials'] });
  });

  it('exactly one canonical category → whole-menu (not canonical-category) removal', () => {
    const out = computeRowRemoval(
      { raw_categories: [], canonical_categories: ['Entrees'] },
      'Entrees',
      undefined,
    );
    expect(out).toEqual({ kind: 'whole-menu' });
  });
});

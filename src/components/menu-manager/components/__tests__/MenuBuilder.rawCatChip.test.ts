/**
 * Pure-function tests for the course-header raw-category chip helpers
 * (MenuBuilder, 2026-06-11): which distinct raw sub-categories a course shows
 * and how over-long labels are truncated.
 */
import { describe, it, expect } from 'vitest';
import type { MenuItemDisplay } from '../../../../types/restaurant';
import {
  _deriveBucketRawCategories,
  _truncRawCatLabel,
} from '../MenuBuilder';

const mk = (id: string): MenuItemDisplay => ({ id, name: id } as MenuItemDisplay);

describe('deriveBucketRawCategories', () => {
  it('returns the distinct raw labels in a course, sorted, excluding Ungrouped', () => {
    const labels: Record<string, string[]> = {
      a: ['Biryani', '__ungrouped__'],
      b: ['Flavors of Tandoor'],
      c: ['Biryani'], // dupe of a
    };
    const out = _deriveBucketRawCategories(
      [mk('a'), mk('b'), mk('c')],
      (id) => labels[id],
    );
    expect(out).toEqual(['Biryani', 'Flavors of Tandoor']);
  });

  it('merges casing / spacing variants into one (most-human form wins)', () => {
    const labels: Record<string, string[]> = {
      a: ['flavors_of_tandoor'],
      b: ['Flavors of Tandoor'],
    };
    const out = _deriveBucketRawCategories([mk('a'), mk('b')], (id) => labels[id]);
    expect(out).toEqual(['Flavors of Tandoor']);
  });

  it('returns [] when no item carries a raw label', () => {
    expect(_deriveBucketRawCategories([mk('a')], () => undefined)).toEqual([]);
    expect(_deriveBucketRawCategories([mk('a')], () => [])).toEqual([]);
  });
});

describe('truncRawCatLabel', () => {
  it('passes short labels through unchanged', () => {
    expect(_truncRawCatLabel('Biryani')).toBe('Biryani');
  });

  it('truncates an over-long label with an ellipsis', () => {
    const long = 'Choose Your Protein With Your Favorite Curry Sauce';
    const out = _truncRawCatLabel(long, 20);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(21);
  });
});

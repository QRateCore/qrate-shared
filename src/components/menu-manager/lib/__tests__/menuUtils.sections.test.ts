/**
 * Unit tests pinning the 4-course display layer that sits over the 8-value
 * canonical_categories data model: MENU_SECTIONS shape (labels + member
 * mappings) and the sectionForCanonical lookup.
 *
 * The course labels (Drinks / Starters / Mains / Desserts) are user-visible
 * across multiple surfaces — menu builder buckets, the ItemPlacementModal
 * chips, the locked-category readout. A typo or quiet rename here regresses
 * every one of them, so the labels are asserted exactly.
 */
import { describe, it, expect } from 'vitest';
import { MENU_SECTIONS, sectionForCanonical, CANONICAL_CATEGORIES } from '../menuUtils';

describe('MENU_SECTIONS', () => {
  it('exposes exactly the four well-known courses', () => {
    expect(MENU_SECTIONS).toHaveLength(4);
  });

  it('uses the plural, owner-facing course labels in the well-known order', () => {
    expect(MENU_SECTIONS.map((s) => s.label)).toEqual([
      'Drinks',
      'Starters',
      'Mains',
      'Desserts',
    ]);
  });

  it('maps each course label to its representative canonical_category', () => {
    expect(Object.fromEntries(MENU_SECTIONS.map((s) => [s.label, s.canonical]))).toEqual({
      Drinks: 'Beverages',
      Starters: 'Appetizers',
      Mains: 'Entrees',
      Desserts: 'Desserts',
    });
  });

  it('covers every canonical category across the four sections', () => {
    // No canonical should be orphaned by the 4-section grouping — otherwise
    // items carrying that canonical would render in zero buckets.
    const covered = new Set(MENU_SECTIONS.flatMap((s) => s.members));
    for (const canon of CANONICAL_CATEGORIES) {
      expect(covered.has(canon)).toBe(true);
    }
  });

  it('keeps Mains as the catch-all for non-drink/non-starter/non-dessert canonicals', () => {
    // The historical "Entrees" section absorbed Soups/Salads/Sides/Breads
    // along with Entrees itself; the rename to "Mains" must NOT lose that
    // absorption (otherwise items with canonical='Soups' would have no home).
    const mains = MENU_SECTIONS.find((s) => s.label === 'Mains');
    expect(mains?.members.sort()).toEqual(
      ['Entrees', 'Soups', 'Salads', 'Sides', 'Breads'].sort(),
    );
  });
});

describe('sectionForCanonical', () => {
  it('resolves the section by its representative canonical', () => {
    expect(sectionForCanonical('Beverages')?.label).toBe('Drinks');
    expect(sectionForCanonical('Appetizers')?.label).toBe('Starters');
    expect(sectionForCanonical('Entrees')?.label).toBe('Mains');
    expect(sectionForCanonical('Desserts')?.label).toBe('Desserts');
  });

  it('resolves the section when given a non-representative member canonical', () => {
    // Sides / Soups / Salads / Breads all live under Mains.
    expect(sectionForCanonical('Sides')?.label).toBe('Mains');
    expect(sectionForCanonical('Soups')?.label).toBe('Mains');
    expect(sectionForCanonical('Salads')?.label).toBe('Mains');
    expect(sectionForCanonical('Breads')?.label).toBe('Mains');
  });

  it('returns undefined for an unknown canonical', () => {
    expect(sectionForCanonical('NotARealCategory')).toBeUndefined();
    expect(sectionForCanonical('')).toBeUndefined();
  });
});

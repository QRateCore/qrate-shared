import { describe, it, expect } from 'vitest';
import { formatTagLabel } from '../labelFormat';

describe('formatTagLabel (STR-822 — shared canonical dietary/allergen label)', () => {
  it('uses curated canonical labels matching GET /diner/dietary-options', () => {
    expect(formatTagLabel('gluten-free')).toBe('Gluten-Free'); // hyphen kept
    expect(formatTagLabel('tree-nuts')).toBe('Tree Nuts'); // hyphen → space
    expect(formatTagLabel('vegetarian')).toBe('Vegetarian');
    expect(formatTagLabel('vegan')).toBe('Vegan');
    expect(formatTagLabel('dairy')).toBe('Dairy');
    expect(formatTagLabel('shellfish')).toBe('Shellfish');
    expect(formatTagLabel('jain')).toBe('Jain');
  });

  it('is case-insensitive and trims (value stays exact upstream — STR-801)', () => {
    expect(formatTagLabel('Gluten-Free')).toBe('Gluten-Free');
    expect(formatTagLabel('  SHELLFISH ')).toBe('Shellfish');
  });

  it('falls back to hyphen/underscore title-case for custom slugs', () => {
    expect(formatTagLabel('sesame-paste')).toBe('Sesame Paste');
    expect(formatTagLabel('mustard')).toBe('Mustard');
    expect(formatTagLabel('low_fodmap')).toBe('Low Fodmap');
  });

  it('handles empty / blank', () => {
    expect(formatTagLabel('')).toBe('');
    expect(formatTagLabel('   ')).toBe('');
  });
});

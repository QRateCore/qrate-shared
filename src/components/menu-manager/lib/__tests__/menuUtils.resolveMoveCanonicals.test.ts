import { describe, it, expect } from 'vitest';
import { resolveMoveCanonicals } from '../menuUtils';

describe('resolveMoveCanonicals', () => {
  it('pool drag (no fromCat) just adds the target course', () => {
    expect(resolveMoveCanonicals([], 'Appetizers', null)).toEqual(['Appetizers']);
    expect(resolveMoveCanonicals(['Entrees'], 'Appetizers')).toEqual(['Entrees', 'Appetizers']);
  });

  it('same-course drop (fromCat === target) is a no-op add', () => {
    expect(resolveMoveCanonicals(['Entrees'], 'Entrees', 'Entrees')).toEqual(['Entrees']);
  });

  it('MOVE between sections drops the source section members and adds the target', () => {
    // item is "Sides" (a member of the Entrees section) → moved to Appetizers
    expect(resolveMoveCanonicals(['Sides'], 'Appetizers', 'Entrees')).toEqual(['Appetizers']);
  });

  it('MOVE preserves canonicals from OTHER sections', () => {
    // item is in Entrees + Beverages; moving its Entrees placement to Appetizers
    expect(resolveMoveCanonicals(['Entrees', 'Beverages'], 'Appetizers', 'Entrees'))
      .toEqual(['Beverages', 'Appetizers']);
  });

  it('MOVE is idempotent when already in the target course', () => {
    expect(resolveMoveCanonicals(['Appetizers'], 'Appetizers', 'Entrees')).toEqual(['Appetizers']);
  });

  it('folds all Entrees-section members (Soups/Salads/Sides/Breads) out on a move', () => {
    expect(resolveMoveCanonicals(['Soups', 'Breads'], 'Desserts', 'Entrees')).toEqual(['Desserts']);
  });
});

// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  isAllergensReviewed,
  isDietaryReviewed,
  needsAllergenOrDietaryReview,
  type ItemWithReviewState,
} from '../foodTagsReview';

const STATES = ['ai_suggested', 'manually_accepted', null, undefined] as const;

function mk(allergens: (typeof STATES)[number], dietary: (typeof STATES)[number]): ItemWithReviewState {
  return { food_tags: { allergens_state: allergens, dietary_state: dietary } };
}

describe('isAllergensReviewed', () => {
  it('returns false only when allergens_state === ai_suggested', () => {
    expect(isAllergensReviewed(mk('ai_suggested', 'manually_accepted'))).toBe(false);
    expect(isAllergensReviewed(mk('manually_accepted', 'ai_suggested'))).toBe(true);
    expect(isAllergensReviewed(mk(null, null))).toBe(true);
    expect(isAllergensReviewed(mk(undefined, undefined))).toBe(true);
    expect(isAllergensReviewed({})).toBe(true);
    expect(isAllergensReviewed({ food_tags: null })).toBe(true);
  });
});

describe('isDietaryReviewed', () => {
  it('returns false only when dietary_state === ai_suggested', () => {
    expect(isDietaryReviewed(mk('manually_accepted', 'ai_suggested'))).toBe(false);
    expect(isDietaryReviewed(mk('ai_suggested', 'manually_accepted'))).toBe(true);
    expect(isDietaryReviewed(mk(null, null))).toBe(true);
    expect(isDietaryReviewed(mk(undefined, undefined))).toBe(true);
    expect(isDietaryReviewed({})).toBe(true);
    expect(isDietaryReviewed({ food_tags: null })).toBe(true);
  });
});

describe('needsAllergenOrDietaryReview — Allergens & Dietary stat-pill predicate', () => {
  it('flags when allergens_state ai_suggested + dietary_state manually_accepted', () => {
    expect(needsAllergenOrDietaryReview(mk('ai_suggested', 'manually_accepted'))).toBe(true);
  });

  it('flags when allergens_state manually_accepted + dietary_state ai_suggested', () => {
    expect(needsAllergenOrDietaryReview(mk('manually_accepted', 'ai_suggested'))).toBe(true);
  });

  it('flags when both ai_suggested', () => {
    expect(needsAllergenOrDietaryReview(mk('ai_suggested', 'ai_suggested'))).toBe(true);
  });

  it('does not flag when both manually_accepted', () => {
    expect(needsAllergenOrDietaryReview(mk('manually_accepted', 'manually_accepted'))).toBe(false);
  });

  it('does not flag when both null/undefined (no enrichment yet)', () => {
    expect(needsAllergenOrDietaryReview(mk(null, null))).toBe(false);
    expect(needsAllergenOrDietaryReview(mk(undefined, undefined))).toBe(false);
    expect(needsAllergenOrDietaryReview({})).toBe(false);
    expect(needsAllergenOrDietaryReview({ food_tags: null })).toBe(false);
  });

  it('Aloo-Tikki regression: allergens + dietary accepted, spice/sweetness ignored', () => {
    const item = {
      food_tags: {
        allergens_state: 'manually_accepted' as const,
        dietary_state: 'manually_accepted' as const,
        ...({ spice_state: 'ai_suggested', sweetness_state: 'ai_suggested' } as Record<string, unknown>),
      },
    };
    expect(needsAllergenOrDietaryReview(item)).toBe(false);
  });
});

describe('invariant: filter membership ↔ modal yellow tint', () => {
  // The whole reason these helpers live together: the row's presence in
  // the Setup Guide / Food Library "Allergens & Dietary" filter and the
  // modal's per-section yellow tint are TWO VIEWS of the same fact. The
  // filter shows the item iff the modal would draw a yellow nudge on at
  // least one of the allergens/dietary sections. If this equivalence
  // ever drifts, the filter and the modal disagree and owners get
  // confused (Aloo Tikki @ Anant 2026-05-08 surfaced this drift).
  //
  // This test enumerates every (allergens × dietary) state combination
  // and asserts the equivalence holds across all 16. If you change one
  // of the three helpers without changing the others, this fails.
  it('needsAllergenOrDietaryReview ⇔ (!isAllergensReviewed || !isDietaryReviewed) for every state pair', () => {
    for (const allergens of STATES) {
      for (const dietary of STATES) {
        const item = mk(allergens, dietary);
        const rhs = !isAllergensReviewed(item) || !isDietaryReviewed(item);
        expect(needsAllergenOrDietaryReview(item)).toBe(rhs);
      }
    }
  });
});

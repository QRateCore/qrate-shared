// Single source of truth for "has the owner reviewed the AI-suggested
// allergen/dietary tags on this item?" Used by:
//   - The "Allergens & Dietary" stat-pill filter on the Setup Guide
//     condition-items page (qrate-owner-webapp).
//   - The "Allergens & Dietary" filter pill in the Food Library
//     (qrate-owner-webapp).
//   - The yellow "AI suggested" tint on the allergens / dietary sections
//     inside EditModal (this package).
//
// Threshold: a section is "reviewed" iff the state is anything other than
// 'ai_suggested'. `null` / `undefined` / `'manually_accepted'` all count
// as reviewed (nothing to nudge the owner about). Living in one place
// keeps the filter and the modal nudge in lockstep — if the threshold
// ever needs to change, it changes here once.

import type { TagReviewState } from '../types/restaurant';

export interface ItemWithReviewState {
  food_tags?: {
    allergens_state?: TagReviewState | null;
    dietary_state?: TagReviewState | null;
  } | null;
}

export function isAllergensReviewed(item: ItemWithReviewState): boolean {
  return item.food_tags?.allergens_state !== 'ai_suggested';
}

export function isDietaryReviewed(item: ItemWithReviewState): boolean {
  return item.food_tags?.dietary_state !== 'ai_suggested';
}

export function needsAllergenOrDietaryReview(item: ItemWithReviewState): boolean {
  return !isAllergensReviewed(item) || !isDietaryReviewed(item);
}

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
//
// The helper accepts BOTH shapes:
//   - Full MenuItemDisplay — review state lives at food_tags.{allergens,dietary}_state
//   - MenuItemSummary       — review state hoisted to top-level
//                             allergens_state / dietary_state for the
//                             /menu-items/summary projection
// Top-level fields take precedence when both are present.

import type { TagReviewState } from '../types/restaurant';

export interface ItemWithReviewState {
  food_tags?: {
    allergens_state?: TagReviewState | null;
    dietary_state?: TagReviewState | null;
  } | null;
  allergens_state?: TagReviewState | null;
  dietary_state?: TagReviewState | null;
}

function _allergensState(item: ItemWithReviewState): TagReviewState | null | undefined {
  return item.allergens_state ?? item.food_tags?.allergens_state;
}

function _dietaryState(item: ItemWithReviewState): TagReviewState | null | undefined {
  return item.dietary_state ?? item.food_tags?.dietary_state;
}

export function isAllergensReviewed(item: ItemWithReviewState): boolean {
  return _allergensState(item) !== 'ai_suggested';
}

export function isDietaryReviewed(item: ItemWithReviewState): boolean {
  return _dietaryState(item) !== 'ai_suggested';
}

export function needsAllergenOrDietaryReview(item: ItemWithReviewState): boolean {
  return !isAllergensReviewed(item) || !isDietaryReviewed(item);
}

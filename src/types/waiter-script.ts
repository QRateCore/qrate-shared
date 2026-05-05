// Waiter Script Companion — shared types
// See design: qrate-repo/.agents/planning/2026-05-04-waiter-script-companion/design/detailed-design.md §4.5

import type { MenuItemDisplay } from './restaurant';

// ===== Session shape =====

export type WaiterStepName =
  | 'party-size'
  | 'occasion'
  | 'allergens'
  | 'drinks'
  | 'appetizers'
  | 'mains'
  | 'upsells';

// Tuple typed for compile-time length checks.
export const WAITER_STEP_NAMES = [
  'party-size',
  'occasion',
  'allergens',
  'drinks',
  'appetizers',
  'mains',
  'upsells',
] as const;

export type WaiterStepStatus = 'pending' | 'in-progress' | 'completed' | 'skipped';

export interface WaiterSessionStep {
  name: WaiterStepName;
  status: WaiterStepStatus;
  updatedAt: string; // ISO-8601
  // Step-specific payload — one of the per-step shapes below.
  payload?: unknown;
}

export interface WaiterSession {
  sessionId: string;
  cognitoSub: string; // waiter identity
  restaurantId: string;
  tableId: string; // restaurant_tables.id (UUID)
  tableLabel: string; // denormalised for client convenience
  status: 'active' | 'closed';
  party: Party;
  steps: Record<WaiterStepName, WaiterSessionStep>;
  selections: SelectionsSnapshot;
  wineQA?: WineQARequest;
  wineResults?: WineRecommendation[];
  upsells?: Upsell[];
  crossSells?: CrossSellSelection[];
  startedAt: string;
  lastTouchedAt: string;
  closedAt?: string;
}

// ===== Party / Seat / Allergen =====

export type AllergenCaptureMode = 'per-table' | 'per-seat';

export interface Party {
  size: number;
  occasion: Occasion | null;
  allergenCaptureMode: AllergenCaptureMode;
  // When per-table: a single synthetic seat (id='whole-table') in `seats`.
  // When per-seat: seats.length === party.size.
  seats: Seat[];
  tableLifestyleTags: LifestyleTag[]; // soft re-rank only, never hard-filtered
}

export interface Seat {
  id: string; // 'whole-table' | 'seat-1' | 'seat-2' | ...
  label: string; // 'Whole Table' | 'Seat 1' | ...
  allergens: SeatAllergen[];
  isBirthdayPerson?: boolean; // when occasion === 'birthday' or 'anniversary'
}

export interface SeatAllergen {
  name: Allergen | string; // FDA 9 enum or free-text "Other"
  severity: AllergenSeverity;
}

// FDA top-9 major food allergens (FALCPA + FASTER Act 2021)
export type Allergen =
  | 'milk'
  | 'eggs'
  | 'fish'
  | 'shellfish'
  | 'tree-nuts'
  | 'peanuts'
  | 'wheat'
  | 'soy'
  | 'sesame';

// Tuple typed (not `readonly Allergen[]`) so consumers can rely on
// `(typeof ALLERGEN_VALUES)['length']` at compile time.
export const ALLERGEN_VALUES = [
  'milk',
  'eggs',
  'fish',
  'shellfish',
  'tree-nuts',
  'peanuts',
  'wheat',
  'soy',
  'sesame',
] as const;

// 'allergy' → hard-filter at recommender
// 'preference' → soft re-rank only
export type AllergenSeverity = 'allergy' | 'preference';

export type LifestyleTag =
  | 'keto'
  | 'low-carb'
  | 'high-protein'
  | 'pescatarian'
  | 'low-sodium';

// ===== Occasion =====

export const OCCASION_VALUES = [
  'casual',
  'date',
  'family',
  'business',
  'birthday',
  'anniversary',
  'celebration',
  'solo',
] as const;
export type Occasion = (typeof OCCASION_VALUES)[number];

// ===== Wine Q&A =====

export type WineQAStyle =
  | 'red'
  | 'white'
  | 'rosé'
  | 'sparkling-red'
  | 'sparkling-white';

export type WineQABody = 'light' | 'medium' | 'full';

export type WineQASweetness = 'bone-dry' | 'dry' | 'off-dry' | 'sweet';

export type WineQABudget = '$' | '$$' | '$$$';

export type WineQAAdventurousness = 'typical' | 'discovery';

export interface WineQARequest {
  foodItemIds: string[];
  style?: WineQAStyle;
  body?: WineQABody;
  // omitted/null when style ∈ {red, sparkling-red}
  sweetness?: WineQASweetness;
  budget?: WineQABudget;
  adventurousness?: WineQAAdventurousness;
}

export interface WineRecommendation {
  menuItemId: string;
  name: string;
  priceCents: number;
  varietal: string | null;
  color: string | null;
  body: WineQABody | null;
  style: WineQASweetness | null;
  score: number; // 0-1
  reason: string; // ≤ 80 chars
  pairingNote: string | null;
}

// ===== Selections / modifications / upsells =====

export interface SelectionsSnapshot {
  drinks: Selection[];
  appetizers: Selection[];
  mains: Selection[];
}

export interface Selection {
  selectionId: string; // UUID v4 generated client-side
  menuItemId: string;
  seatId?: string; // present in per-seat mode
  qty: number;
  modifications: Modification[];
}

export type ModificationType =
  | 'no-allergen'
  | 'side-swap'
  | 'spice-level'
  | 'free-text';

export interface Modification {
  type: ModificationType;
  // e.g. 'no peanuts' | 'sub fries → salad' | 'medium' | free-text
  value: string;
  // only when type === 'no-allergen'
  allergenSwapFor?: Allergen;
}

export interface Upsell {
  selectionId: string; // links back to Selection
  upgradeName: string; // e.g. 'Wagyu cut'
  priceDeltaCents: number;
  accepted: boolean;
}

export interface CrossSellSelection {
  menuItemId: string;
  category:
    | 'sides'
    | 'breads'
    | 'soups'
    | 'beverages'
    | 'appetizers'
    | 'salads';
  reason: string;
  accepted: boolean;
}

// ===== Crib sheet =====

export interface CribSheet {
  // crib sheet is a render of the session — no separate model
  session: WaiterSession;
  // Computed fields the renderer may want pre-built:
  perSeatSummary?: Array<{
    seat: Seat;
    drinks: Selection[];
    appetizers: Selection[];
    mains: Selection[];
  }>;
}

// ===== Rec card decoration (denormalised pairing + upsell hints) =====

// On every ScoredMenuItemDisplay returned by the recommender, an inline pairing array.
// The recommender denormalises this from pairing_graph so the client doesn't need
// to make a separate pairings call per card.
export interface PairingHint {
  menuItemId: string;
  name: string;
  strength: number; // 1-5
}

export interface UpsellHint {
  name: string;
  priceDeltaCents: number;
  reason?: string;
}

export interface ScoredMenuItemDisplay extends MenuItemDisplay {
  score: number;
  reason: string;
  // top 2-3 inline; full pairings come from PairingsSheet
  pairings: PairingHint[];
  // small inline list, e.g. wagyu/truffle add-ons
  upsells?: UpsellHint[];
}

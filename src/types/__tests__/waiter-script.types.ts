// Compile-time invariant tests for waiter-script.ts.
//
// This file has no runtime — every assertion is type-level. If `tsc --noEmit`
// passes, the invariants hold. If it fails, the design contract has drifted.
//
// Lives in __tests__/ so it is colocated with the types it tests but doesn't
// pollute the main barrel. The shared package's tsconfig picks up all .ts
// under src/, so this file is type-checked by `npm run lint` (which runs
// `tsc --noEmit`).

import type {
  Allergen,
  Occasion,
  WineQARequest,
  WaiterSession,
  WaiterStepName,
  WaiterSessionStep,
} from '../waiter-script';
import {
  ALLERGEN_VALUES,
  OCCASION_VALUES,
  WAITER_STEP_NAMES,
} from '../waiter-script';

// ---------------------------------------------------------------------------
// Helper: compile-time equality assertion. Errors if A and B are not equal.
// ---------------------------------------------------------------------------
type Expect<T extends true> = T;
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y
  ? 1
  : 2
  ? true
  : false;

// ---------------------------------------------------------------------------
// (a) Allergen union has exactly the 9 FDA major allergens (FALCPA + FASTER Act).
// ---------------------------------------------------------------------------
type _AllergenCount = Expect<Equal<(typeof ALLERGEN_VALUES)['length'], 9>>;

// And the union derived from the tuple matches the explicit Allergen type.
type _AllergenUnionMatchesTuple = Expect<
  Equal<(typeof ALLERGEN_VALUES)[number], Allergen>
>;

// ---------------------------------------------------------------------------
// (b) OCCASION_VALUES has exactly 8 entries (per design §4.5.1).
// ---------------------------------------------------------------------------
type _OccasionCount = Expect<Equal<(typeof OCCASION_VALUES)['length'], 8>>;

type _OccasionUnionMatchesTuple = Expect<
  Equal<(typeof OCCASION_VALUES)[number], Occasion>
>;

// ---------------------------------------------------------------------------
// (c) WineQARequest.sweetness is OPTIONAL (omitted when style ∈ {red, sparkling-red}).
// ---------------------------------------------------------------------------
const _wineNoSweetness: WineQARequest = {
  foodItemIds: ['m-1'],
  style: 'red',
  body: 'full',
  budget: '$$',
  adventurousness: 'typical',
  // sweetness deliberately omitted
};
void _wineNoSweetness;

const _wineWithSweetness: WineQARequest = {
  foodItemIds: ['m-1'],
  style: 'white',
  body: 'medium',
  sweetness: 'bone-dry',
  budget: '$',
  adventurousness: 'discovery',
};
void _wineWithSweetness;

// ---------------------------------------------------------------------------
// (d) WaiterSession.steps is Record<WaiterStepName, WaiterSessionStep>
//     keyed by every step name. WAITER_STEP_NAMES enumerates them.
// ---------------------------------------------------------------------------
type _StepNameCount = Expect<Equal<(typeof WAITER_STEP_NAMES)['length'], 7>>;

type _StepNameUnionMatchesTuple = Expect<
  Equal<(typeof WAITER_STEP_NAMES)[number], WaiterStepName>
>;

type _SessionStepsShape = Expect<
  Equal<WaiterSession['steps'], Record<WaiterStepName, WaiterSessionStep>>
>;

// ---------------------------------------------------------------------------
// Tag the marker types so unused-locals lints don't flip on them.
// ---------------------------------------------------------------------------
export type WaiterScriptTypeInvariants = [
  _AllergenCount,
  _AllergenUnionMatchesTuple,
  _OccasionCount,
  _OccasionUnionMatchesTuple,
  _StepNameCount,
  _StepNameUnionMatchesTuple,
  _SessionStepsShape,
];

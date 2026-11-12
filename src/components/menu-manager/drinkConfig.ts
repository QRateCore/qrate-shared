/**
 * Edit item → Basics → Beverage details (Menu workspace v3, DRINK_CFG):
 * which drink types an Alcoholic / Non-alcoholic drink can be, and which
 * Served / Strength / third-field choices each type offers.
 *
 * The design's lists are mapped onto the STORED vocabulary the diner app and
 * the recommender already read (constants/food-tags BEVERAGE_TYPES,
 * SERVING_STYLES, DRINK_STRENGTHS, BASE_SPIRITS, BEER_STYLES) — no new values
 * are written. A design choice with no stored equivalent (Cider, Sake grades,
 * "Carafe"…) is left out rather than invented.
 */

export type DrinkThird = 'base_spirit' | 'beer_style' | 'wine' | null;

export interface DrinkTypeConfig {
  /** Stored beverage_type. */
  value: string;
  /** What the owner reads (the design's name). */
  label: string;
  alcoholic: boolean;
  /** Stored SERVING_STYLES values offered for Served ([] = no Served field). */
  served: readonly string[];
  /** Strength choices (stored DRINK_STRENGTHS); [] = no Strength field. */
  strength: readonly string[];
  /** The type's third field: Base spirit / Spirit, Beer style, or the wine block. */
  third: DrinkThird;
}

const STRONG = ['light', 'medium', 'strong'] as const;

export const DRINK_TYPES: readonly DrinkTypeConfig[] = [
  // Alcoholic
  { value: 'cocktail', label: 'Cocktail', alcoholic: true, served: ['glass', 'on-the-rocks', 'frozen', 'hot'], strength: STRONG, third: 'base_spirit' },
  { value: 'spirit', label: 'Spirit', alcoholic: true, served: ['neat', 'on-the-rocks'], strength: STRONG, third: 'base_spirit' },
  { value: 'beer', label: 'Beer', alcoholic: true, served: ['bottled', 'draft'], strength: STRONG, third: 'beer_style' },
  { value: 'wine', label: 'Wine', alcoholic: true, served: ['glass', 'bottled'], strength: STRONG, third: 'wine' },
  // Non-alcoholic
  { value: 'mocktail', label: 'Mocktail', alcoholic: false, served: ['glass', 'iced', 'frozen'], strength: [], third: null },
  { value: 'soda', label: 'Soft drink', alcoholic: false, served: ['bottled', 'iced'], strength: [], third: null },
  { value: 'juice', label: 'Juice', alcoholic: false, served: ['glass', 'iced'], strength: [], third: null },
  { value: 'lemonade', label: 'Lemonade', alcoholic: false, served: ['glass', 'iced'], strength: [], third: null },
  { value: 'lassi', label: 'Lassi', alcoholic: false, served: ['glass', 'iced'], strength: [], third: null },
  { value: 'milkshake', label: 'Milkshake', alcoholic: false, served: ['glass', 'blended'], strength: [], third: null },
  { value: 'smoothie', label: 'Smoothie', alcoholic: false, served: ['glass', 'blended'], strength: [], third: null },
  { value: 'coffee', label: 'Coffee', alcoholic: false, served: ['hot', 'iced'], strength: STRONG, third: null },
  { value: 'tea', label: 'Tea', alcoholic: false, served: ['hot', 'iced'], strength: STRONG, third: null },
  { value: 'chai', label: 'Chai', alcoholic: false, served: ['hot', 'iced'], strength: STRONG, third: null },
  { value: 'water', label: 'Water', alcoholic: false, served: ['bottled', 'glass'], strength: [], third: null },
  { value: 'other', label: 'Other', alcoholic: false, served: [], strength: [], third: null },
];

const BY_VALUE = new Map(DRINK_TYPES.map((t) => [t.value, t]));

export function drinkTypeConfig(value: string | null | undefined): DrinkTypeConfig | null {
  return value ? (BY_VALUE.get(value) ?? null) : null;
}

/** The drink types an Alcoholic (true) / Non-alcoholic (false) drink can be. */
export function drinkTypesFor(alcoholic: boolean | undefined): readonly DrinkTypeConfig[] {
  if (alcoholic === undefined) return DRINK_TYPES;
  return DRINK_TYPES.filter((t) => t.alcoholic === alcoholic || (!alcoholic && t.value === 'other'));
}

/** Labels for SERVING_STYLES values in the design's words. */
export const SERVED_LABEL: Record<string, string> = {
  neat: 'Neat', 'on-the-rocks': 'On the rocks', frozen: 'Frozen', hot: 'Hot', iced: 'Over ice',
  blended: 'Blended', draft: 'Draft', bottled: 'Bottle / can', glass: 'Glass',
};

export interface BeverageFieldState {
  beverage_type?: string;
  alcoholic?: boolean;
  served?: string | null;
  strength?: string;
  base_spirit?: string | null;
  beer_style?: string | null;
}

/**
 * Switching Alcoholic / Non-alcoholic: a drink type that does not fit is
 * cleared, and going non-alcoholic clears the base spirit and sets Strength to
 * the stored "none" (non-alcoholic).
 */
export function applyAlcoholic<T extends BeverageFieldState>(draft: T, alcoholic: boolean | undefined): T {
  const next: T = { ...draft, alcoholic };
  const cfg = drinkTypeConfig(draft.beverage_type);
  if (alcoholic !== undefined && cfg && cfg.alcoholic !== alcoholic && !(alcoholic === false && cfg.value === 'other')) {
    next.beverage_type = undefined;
  }
  if (alcoholic === false) {
    next.base_spirit = null;
    next.strength = 'none';
  }
  return reconcileType(next);
}

/** Switching drink type: Served / Strength / third-field values the type does not offer are cleared. */
export function applyDrinkType<T extends BeverageFieldState>(draft: T, value: string | undefined): T {
  const cfg = drinkTypeConfig(value);
  const next: T = { ...draft, beverage_type: value };
  if (cfg) next.alcoholic = cfg.alcoholic === false && value === 'other' ? draft.alcoholic : cfg.alcoholic;
  return reconcileType(next);
}

function reconcileType<T extends BeverageFieldState>(next: T): T {
  const cfg = drinkTypeConfig(next.beverage_type);
  if (!cfg) return next;
  if (next.served && !cfg.served.includes(next.served)) next.served = null;
  if (cfg.strength.length === 0) next.strength = cfg.alcoholic ? undefined : 'none';
  else if (next.strength && next.strength !== 'none' && !cfg.strength.includes(next.strength)) next.strength = undefined;
  else if (cfg.alcoholic && next.strength === 'none') next.strength = undefined;
  if (cfg.third !== 'base_spirit') next.base_spirit = null;
  if (cfg.third !== 'beer_style') next.beer_style = null;
  return next;
}

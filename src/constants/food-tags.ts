import type { FoodTags } from '../types/restaurant';

// Keys of FoodTags that are string arrays
type ArrayTagKey = 'ingredients' | 'textures' | 'taste_profile' | 'dietary' | 'cooking_method' | 'allergens' | 'seasons' | 'festivity' | 'heat_spice';

export const TAG_CATEGORIES: { key: ArrayTagKey; label: string; color: string; icon: string }[] = [
  { key: 'ingredients', label: 'Ingredients', color: 'bg-sky-100 text-sky-700', icon: '🥬' },
  { key: 'allergens', label: 'Identified Allergens from Listed Ingredients', color: 'bg-red-100 text-red-700', icon: '⚠️' },
  { key: 'heat_spice', label: 'Heat / Spice Level', color: 'bg-orange-100 text-orange-700', icon: '🌶️' },
  { key: 'cooking_method', label: 'Cooking Style', color: 'bg-gray-100 text-gray-700', icon: '🍳' },
  { key: 'textures', label: 'Texture', color: 'bg-purple-100 text-purple-700', icon: '✨' },
  { key: 'dietary', label: 'Dietary Preference', color: 'bg-green-100 text-green-700', icon: '🥗' },
  { key: 'taste_profile', label: 'Taste Profile', color: 'bg-orange-100 text-orange-700', icon: '😋' },
  { key: 'seasons', label: 'Seasonal Recommendation', color: 'bg-teal-100 text-teal-700', icon: '🌸' },
  { key: 'festivity', label: 'Festivity Recommendation', color: 'bg-indigo-100 text-indigo-700', icon: '🎉' },
];

export const HEAT_LABELS = ['Mild', 'Warm', 'Medium', 'Hot', 'Fiery'] as const;

// Default 5-level scale for restaurants that haven't customized. Kept in sync
// with the backend `DEFAULT_HEAT_LABELS` in owner_dietary.py.
export const DEFAULT_HEAT_LABELS: readonly string[] = ['Mild', 'Warm', 'Medium', 'Hot', 'Fiery'];

// Position-indexed visual palette — length 8 matches MAX_SPICE_SCALE_LEVELS.
// When rendering a custom spice scale, consumers look up icon/color by *index*,
// not by label, so renamed labels don't affect the visual progression.
export const DEFAULT_HEAT_ICONS: readonly string[] = [
  '❄️', '🌶️', '🌶️🌶️', '🔥', '🔥🔥', '🔥🔥🔥', '🔥🔥🔥🔥', '🔥🔥🔥🔥🔥',
];

export const DEFAULT_HEAT_BG: readonly string[] = [
  'rgba(59,130,246,0.08)',
  'rgba(251,146,60,0.10)',
  'rgba(239,68,68,0.10)',
  'rgba(220,38,38,0.14)',
  'rgba(153,27,27,0.16)',
  'rgba(124,10,10,0.18)',
  'rgba(91,0,0,0.20)',
  'rgba(60,0,0,0.22)',
];

export const DEFAULT_HEAT_BORDER: readonly string[] = [
  '#3b82f6', '#fb923c', '#ef4444', '#dc2626', '#991b1b', '#7c0a0a', '#5b0000', '#3c0000',
];

export const DEFAULT_HEAT_COLOR: readonly string[] = [
  '#3b82f6', '#c2410c', '#dc2626', '#b91c1c', '#7f1d1d', '#660909', '#460000', '#2a0000',
];

// Scale-length and label-length limits — must match backend owner_dietary.py.
export const MIN_SPICE_SCALE_LEVELS = 3;
export const MAX_SPICE_SCALE_LEVELS = 8;
export const SPICE_LABEL_MIN = 2;
export const SPICE_LABEL_MAX = 24;

// ─── Sweetness Scale ────────────────────────────────────────────────────────

export const DEFAULT_SWEETNESS_LABELS: readonly string[] = ['Lightly Sweet', 'Sweet', 'Very Sweet', 'Indulgent'];

// Position-indexed visual palette for sweetness (up to 8 levels, pink→purple progression)
export const DEFAULT_SWEETNESS_ICONS: readonly string[] = [
  '✦', '✦✦', '✦✦✦', '✦✦✦✦', '✦✦✦✦✦', '✦✦✦✦✦✦', '✦✦✦✦✦✦✦', '✦✦✦✦✦✦✦✦',
];
export const DEFAULT_SWEETNESS_BG: readonly string[] = [
  'rgba(249,168,212,0.10)', 'rgba(236,72,153,0.12)', 'rgba(168,85,247,0.10)',
  'rgba(126,34,206,0.14)', 'rgba(107,33,168,0.16)', 'rgba(88,28,135,0.18)',
  'rgba(59,7,100,0.20)', 'rgba(40,0,80,0.22)',
];
export const DEFAULT_SWEETNESS_BORDER: readonly string[] = [
  '#f9a8d4', '#ec4899', '#a855f7', '#7e22ce', '#6b21a8', '#581c87', '#3b0764', '#28004e',
];
export const DEFAULT_SWEETNESS_COLOR: readonly string[] = [
  '#db2777', '#be185d', '#7c3aed', '#6d28d9', '#5b21b6', '#4c1d95', '#3b0764', '#2e065a',
];
export const MIN_SWEETNESS_SCALE_LEVELS = 3;
export const MAX_SWEETNESS_SCALE_LEVELS = 8;
export const SWEETNESS_LABEL_MIN = 2;
export const SWEETNESS_LABEL_MAX = 24;

// ─── Beverage Tag Options ────────────────────────────────────────────────

export const BEVERAGE_TYPES = [
  'cocktail', 'wine', 'beer', 'spirit', 'juice', 'soda', 'coffee', 'tea',
  'smoothie', 'mocktail', 'lassi', 'chai', 'milkshake', 'lemonade', 'water', 'other',
] as const;

export const BASE_SPIRITS = [
  'vodka', 'gin', 'rum', 'tequila', 'whiskey', 'brandy', 'mezcal', 'sake',
] as const;

export const WINE_VARIETIES = [
  'cabernet', 'merlot', 'chardonnay', 'pinot noir', 'pinot grigio', 'rosé',
  'riesling', 'sauvignon blanc', 'malbec', 'prosecco', 'champagne',
] as const;

export const BEER_STYLES = [
  'IPA', 'lager', 'stout', 'pilsner', 'wheat', 'ale', 'porter', 'sour', 'pale ale', 'amber',
] as const;

export const FLAVOR_NOTES = [
  'sweet', 'dry', 'bitter', 'sour', 'fruity', 'herbal', 'smoky', 'creamy',
  'citrus', 'tropical', 'floral', 'spicy', 'refreshing', 'rich', 'crisp',
  'earthy', 'nutty', 'chocolatey', 'minty', 'vanilla',
] as const;

export const SERVING_STYLES = [
  'neat', 'on-the-rocks', 'frozen', 'hot', 'iced', 'blended', 'draft', 'bottled', 'glass',
] as const;

export const DRINK_STRENGTHS = ['none', 'light', 'medium', 'strong'] as const;

export const CALORIE_OPTIONS = ['Light (<300)', 'Moderate (300-600)', 'Hearty (600-900)', 'Indulgent (900+)'];

// Compact categories shown on item cards
export const COMPACT_TAG_CATEGORIES = TAG_CATEGORIES.filter(c =>
  ['dietary', 'allergens', 'ingredients'].includes(c.key)
);

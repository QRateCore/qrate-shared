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

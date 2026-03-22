const ENTREE_EXACT = ['entree', 'entrees', 'main', 'mains', 'main course'];

const APPETIZER_KEYWORDS = ['appetizer', 'starter', 'hors d', 'soup', 'salad', 'chaat', 'small plate', 'side', 'bread', 'naan'];
const DESSERT_KEYWORDS = ['dessert', 'sweet', 'pastry', 'cake', 'ice cream', 'kulfi', 'gulab'];
const DRINK_KEYWORDS = ['beverage', 'drink', 'cocktail', 'juice', 'tea', 'coffee', 'lassi', 'chai', 'wine', 'beer', 'spirit'];
const KIDS_KEYWORDS = ['kid', 'children'];

// Canonical category map — set by PairingsTab from menu intelligence data
let _canonicalMap: Record<string, string> | null = null;

export function setCanonicalCategoryMap(map: Record<string, string>) {
  _canonicalMap = map;
}

export function isEntreeCategory(category: string): boolean {
  if (!category) return true; // No category → treat as entree

  // 1. Check canonical mapping from menu intelligence
  if (_canonicalMap && _canonicalMap[category]) {
    const canonical = _canonicalMap[category].toLowerCase();
    // Everything that's not appetizer/soup/salad/side/dessert/beverage/kids is an entree
    if (['appetizers', 'soups', 'salads', 'sides', 'breads', 'desserts', 'beverages', 'kids menu'].includes(canonical.toLowerCase())) {
      return false;
    }
    return true; // Entrees, Sandwiches, Pizza, Pasta, Seafood, Breakfast Items, Specials → entree
  }

  // 2. Fallback: keyword-based classification
  const lower = category.toLowerCase();
  if (ENTREE_EXACT.includes(lower)) return true;
  if (APPETIZER_KEYWORDS.some(k => lower.includes(k))) return false;
  if (DESSERT_KEYWORDS.some(k => lower.includes(k))) return false;
  if (DRINK_KEYWORDS.some(k => lower.includes(k))) return false;
  if (KIDS_KEYWORDS.some(k => lower.includes(k))) return false;

  // Default: treat as entree (curries, biryani, tandoori specials, etc.)
  return true;
}

export const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'Appetizers': { bg: '#FFF7ED', text: '#EA580C', border: '#FDBA74' },
  'Appetizer': { bg: '#FFF7ED', text: '#EA580C', border: '#FDBA74' },
  'Starters': { bg: '#FFF7ED', text: '#EA580C', border: '#FDBA74' },
  'Entrees': { bg: '#FEF2F2', text: '#DC2626', border: '#FCA5A5' },
  'Entree': { bg: '#FEF2F2', text: '#DC2626', border: '#FCA5A5' },
  'Main': { bg: '#FEF2F2', text: '#DC2626', border: '#FCA5A5' },
  'Mains': { bg: '#FEF2F2', text: '#DC2626', border: '#FCA5A5' },
  'Main Course': { bg: '#FEF2F2', text: '#DC2626', border: '#FCA5A5' },
  'Desserts': { bg: '#FAF5FF', text: '#7C3AED', border: '#C4B5FD' },
  'Dessert': { bg: '#FAF5FF', text: '#7C3AED', border: '#C4B5FD' },
  'Drinks': { bg: '#EFF6FF', text: '#2563EB', border: '#93C5FD' },
  'Drink': { bg: '#EFF6FF', text: '#2563EB', border: '#93C5FD' },
  'Beverages': { bg: '#EFF6FF', text: '#2563EB', border: '#93C5FD' },
  'Beverage': { bg: '#EFF6FF', text: '#2563EB', border: '#93C5FD' },
  'Wine': { bg: '#EFF6FF', text: '#2563EB', border: '#93C5FD' },
  'Wines': { bg: '#EFF6FF', text: '#2563EB', border: '#93C5FD' },
  'Cocktails': { bg: '#EFF6FF', text: '#2563EB', border: '#93C5FD' },
  'Sides': { bg: '#F0FDF4', text: '#16A34A', border: '#86EFAC' },
  'Side': { bg: '#F0FDF4', text: '#16A34A', border: '#86EFAC' },
  'Salads': { bg: '#F0FDF4', text: '#16A34A', border: '#86EFAC' },
  'Salad': { bg: '#F0FDF4', text: '#16A34A', border: '#86EFAC' },
};

const DEFAULT_COLOR = { bg: '#F9FAFB', text: '#6B7280', border: '#D1D5DB' };

export function getCategoryColor(category: string) {
  return CATEGORY_COLORS[category] || DEFAULT_COLOR;
}

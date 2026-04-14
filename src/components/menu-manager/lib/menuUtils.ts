import type { MenuItemDisplay, MenuSummary, MenuItemJunctionSettings } from '../../../types/restaurant';

export const CANONICAL_CATEGORIES = [
  'Beverages',
  'Appetizers',
  'Soups',
  'Salads',
  'Sides',
  'Breads',
  'Entrees',
  'Desserts',
] as const;

export type CanonicalCategory = (typeof CANONICAL_CATEGORIES)[number];

export type MenuColorName = 'blue' | 'teal' | 'purple' | 'amber' | 'coral' | 'pink';

export interface MenuColor {
  name: MenuColorName;
  tab: string;       // tab background (active)
  tabBorder: string; // tab border (active)
  chip: string;      // item chip background
  chipText: string;  // item chip text
  bucket: string;    // category bucket accent
}

export const MENU_COLORS: MenuColorName[] = ['blue', 'teal', 'purple', 'amber', 'coral', 'pink'];

export const COLOR_MAP: Record<MenuColorName, MenuColor> = {
  blue:   { name: 'blue',   tab: '#dbeafe', tabBorder: '#3b82f6', chip: '#dbeafe', chipText: '#1d4ed8', bucket: '#3b82f6' },
  teal:   { name: 'teal',   tab: '#ccfbf1', tabBorder: '#14b8a6', chip: '#ccfbf1', chipText: '#0f766e', bucket: '#14b8a6' },
  purple: { name: 'purple', tab: '#ede9fe', tabBorder: '#8b5cf6', chip: '#ede9fe', chipText: '#6d28d9', bucket: '#8b5cf6' },
  amber:  { name: 'amber',  tab: '#fef3c7', tabBorder: '#f59e0b', chip: '#fef3c7', chipText: '#b45309', bucket: '#f59e0b' },
  coral:  { name: 'coral',  tab: '#fee2e2', tabBorder: '#ef4444', chip: '#fee2e2', chipText: '#b91c1c', bucket: '#ef4444' },
  pink:   { name: 'pink',   tab: '#fce7f3', tabBorder: '#ec4899', chip: '#fce7f3', chipText: '#be185d', bucket: '#ec4899' },
};

export function getMenuColor(index: number): MenuColor {
  return COLOR_MAP[MENU_COLORS[index % MENU_COLORS.length]];
}

/** Map raw category string to the nearest canonical category (case-insensitive prefix). */
export function toCanonical(raw: string | null | undefined): CanonicalCategory | 'Uncategorised' {
  if (!raw) return 'Uncategorised';
  const lower = raw.toLowerCase().trim();
  for (const canon of CANONICAL_CATEGORIES) {
    if (lower === canon.toLowerCase() || lower.startsWith(canon.toLowerCase())) {
      return canon;
    }
  }
  // Fuzzy fallbacks
  if (lower.includes('drink') || lower.includes('bever') || lower.includes('cocktail') || lower.includes('wine') || lower.includes('beer') || lower.includes('juice')) return 'Beverages';
  if (lower.includes('starter') || lower.includes('appetiz') || lower.includes('starter')) return 'Appetizers';
  if (lower.includes('bread') || lower.includes('naan') || lower.includes('roti') || lower.includes('pita')) return 'Breads';
  if (lower.includes('dessert') || lower.includes('sweet') || lower.includes('cake') || lower.includes('ice cream')) return 'Desserts';
  if (lower.includes('salad')) return 'Salads';
  if (lower.includes('soup')) return 'Soups';
  if (lower.includes('side') || lower.includes('extra') || lower.includes('condiment')) return 'Sides';
  // Common crawled main-dish category strings that don't match any prefix above
  if (
    lower.includes('main') || lower.includes('entree') ||
    lower.includes('curri') || lower.includes('curry') ||
    lower.includes('pasta') || lower.includes('noodle') ||
    lower.includes('biryani') ||
    lower.includes('sandwich') || lower.includes('wrap') || lower.includes('burger') ||
    lower.includes('seafood') || lower.includes('fish') || lower.includes('prawn') ||
    lower.includes('chicken') || lower.includes('meat') ||
    lower.includes('grill') || lower.includes('roast')
  ) return 'Entrees';
  return 'Uncategorised';
}

/** Build the assignments map: {menuId: {category: itemId[]}} from items' menu_associations. */
export function buildAssignments(
  items: MenuItemDisplay[],
  menus: MenuSummary[],
): Record<string, Record<string, string[]>> {
  const result: Record<string, Record<string, string[]>> = {};
  for (const menu of menus) {
    result[menu.id] = Object.fromEntries(
      [...CANONICAL_CATEGORIES, 'Uncategorised'].map((c) => [c, [] as string[]]),
    );
  }
  for (const item of items) {
    for (const assoc of item.menu_associations ?? []) {
      const cats = assoc.canonical_categories?.length
        ? assoc.canonical_categories
        : [toCanonical(assoc.category_name ?? item.category)];
      for (const canon of cats) {
        if (result[assoc.menu_id]?.[canon] !== undefined) {
          if (!result[assoc.menu_id][canon].includes(item.id)) {
            result[assoc.menu_id][canon].push(item.id);
          }
        }
      }
    }
  }
  return result;
}

/** Build the junction settings map: {"menuId:itemId": MenuItemJunctionSettings}. */
export function buildJunctionSettings(
  items: MenuItemDisplay[],
): Record<string, MenuItemJunctionSettings> {
  const result: Record<string, MenuItemJunctionSettings> = {};
  for (const item of items) {
    for (const assoc of item.menu_associations ?? []) {
      result[`${assoc.menu_id}:${item.id}`] = {
        price: assoc.price ?? item.price ?? null,
        boost_level: assoc.boost_level ?? null,
        chefs_special: assoc.chefs_special ?? false,
        portion_type: assoc.portion_type ?? item.portion_type ?? 'single',
        portion_serves: assoc.portion_serves ?? item.portion_serves ?? null,
        category_name: assoc.category_name ?? undefined,
        canonical_categories: assoc.canonical_categories ?? [],
      };
    }
  }
  return result;
}

// Boost label helpers
export const BOOST_LABELS = ['Low', 'Moderate', 'High'] as const;
export type BoostLabel = (typeof BOOST_LABELS)[number];

export function boostToInt(label: BoostLabel): number {
  return BOOST_LABELS.indexOf(label) + 1; // Low→1, Moderate→2, High→3
}

export function intToBoostLabel(n: number | null | undefined): BoostLabel | null {
  if (!n || n < 1 || n > 3) return null;
  return BOOST_LABELS[n - 1];
}

// Food tag field mapping: display key → FoodTags field
export const FOOD_TAG_FIELD_MAP: Record<string, string> = {
  ingredients: 'ingredients',
  allergens: 'allergens',
  heatLevel: 'heat_spice',
  cookingStyle: 'cooking_method',
  texture: 'textures',
  dietaryPreference: 'dietary',
  tasteProfile: 'taste_profile',
  seasonal: 'seasons',
  festivity: 'festivity',
};

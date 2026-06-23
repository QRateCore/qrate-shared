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

// ── 4-section menu organization (2026-06-11 prototype) ──────────────────────
// Collapse the 8 canonical categories into 4 top-level sections — the well-
// known courses owners think in (Drinks / Starters / Mains / Desserts). Each
// section maps to a representative `canonical` (the drop target + collapse /
// price key) and a `label` shown to the owner. The "Mains" section absorbs
// everything that isn't a drink, starter, or dessert (soups, salads, sides,
// breads, mains). The canonical_categories array on items is still the 8-value
// data model; these 4 sections are the display + modal layer over it.
export interface MenuSection {
  label: string;
  canonical: string;
  members: string[];
}
export const MENU_SECTIONS: MenuSection[] = [
  { label: 'Drinks',   canonical: 'Beverages',  members: ['Beverages'] },
  { label: 'Starters', canonical: 'Appetizers', members: ['Appetizers'] },
  { label: 'Mains',    canonical: 'Entrees',    members: ['Entrees', 'Soups', 'Salads', 'Sides', 'Breads'] },
  { label: 'Desserts', canonical: 'Desserts',   members: ['Desserts'] },
];
/** Resolve the section a canonical belongs to (by representative or member). */
export function sectionForCanonical(canonical: string): MenuSection | undefined {
  return MENU_SECTIONS.find((s) => s.canonical === canonical || s.members.includes(canonical));
}

/** Compute an item's canonical_categories after a drag-drop file/move.
 *  When the drag came from a DIFFERENT section (`fromCat` set and ≠ `targetCat`),
 *  drop the source section's member canonicals so the item LEAVES the old course
 *  (a MOVE — PDD 2026-06-12 #6a, decision D). A pool drag (`fromCat` null) or a
 *  same-course sub-category drop just adds `targetCat`. */
export function resolveMoveCanonicals(
  existing: readonly string[],
  targetCat: string,
  fromCat?: string | null,
): string[] {
  const isMove = !!fromCat && fromCat !== targetCat;
  const fromMembers = isMove ? (sectionForCanonical(fromCat as string)?.members ?? [fromCat as string]) : [];
  const base = isMove ? existing.filter((c) => !fromMembers.includes(c)) : [...existing];
  return base.includes(targetCat) ? base : [...base, targetCat];
}

/** True when an item is a drink (its primary canonical is Beverages). Used to
 *  hide the per-menu sides "Includes" editor for drinks and to skip drinks in
 *  the bulk sides action (PDD 2026-06-12 #7/#9). */
export function isDrinkItem(item: {
  canonical_category?: string | null;
  canonical_categories?: readonly string[] | null;
}): boolean {
  const primary = (item.canonical_category || (item.canonical_categories ?? [])[0] || '').trim();
  return primary === 'Beverages';
}

// ── Sub-category label normalization ────────────────────────────────────────
// Raw sub-category labels arrive in inconsistent casing/spacing/punctuation
// ("Flavors of Tandoor" vs "flavors of tandoor" vs "Flavors  of Tandoor"),
// which otherwise renders as duplicate sub-categories. Collapse to a stable
// key for de-duplication + matching; the display form is chosen separately
// (the most-used variant — see dedupeRawCategoryLabels).
export function normalizeSubcatKey(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // split camelCase boundaries (flavorsOfTandoor → "flavors Of Tandoor")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ') // punctuation/underscores/extra spaces → single space
    .trim();
}
/**
 * De-duplicate a list of (label, count) pairs case/punctuation-insensitively.
 * Within a dup group the displayed label is the highest-count variant (ties →
 * the one with the most uppercase letters, then alphabetical), and counts are
 * summed so the badge reflects the merged total.
 */
export function dedupeRawCategoryLabels(
  entries: Array<{ label: string; item_count: number }>,
): Array<{ label: string; item_count: number }> {
  const groups = new Map<string, { label: string; item_count: number; variants: Array<{ label: string; count: number }> }>();
  for (const e of entries) {
    const key = normalizeSubcatKey(e.label);
    if (!key) continue;
    const g = groups.get(key);
    if (g) {
      g.item_count += e.item_count;
      g.variants.push({ label: e.label, count: e.item_count });
    } else {
      groups.set(key, { label: e.label, item_count: e.item_count, variants: [{ label: e.label, count: e.item_count }] });
    }
  }
  const out: Array<{ label: string; item_count: number }> = [];
  for (const g of groups.values()) {
    out.push({ label: preferScrapedLabel(g.variants), item_count: g.item_count });
  }
  return out;
}

/**
 * Choose the most scrape-faithful display form among casing/snake variants of
 * the same label. The original scraped string is the SPACED human form
 * ("Flavors of Tandoor"); the v2 seed also injected a snake_case key
 * ("flavors_of_tandoor"). Always prefer the spaced human form so the owner sees
 * exactly what was scraped — never the snake key — even if the snake variant is
 * more frequent in the (polluted) data.
 */
export function preferScrapedLabel(variants: Array<{ label: string; count: number }>): string {
  const score = (s: string) =>
    (/\s/.test(s) ? 4 : 0) +        // has a space → scraped human form
    (/_/.test(s) ? 0 : 2) +          // no underscore → not a snake key
    (/[A-Z]/.test(s) ? 1 : 0);       // has a capital → human casing
  const best = [...variants].sort((a, b) =>
    score(b.label) - score(a.label) ||
    b.count - a.count ||
    a.label.localeCompare(b.label),
  )[0];
  return best?.label ?? variants[0]?.label ?? '';
}

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
export function toCanonical(raw: string | null | undefined): CanonicalCategory | null {
  if (!raw) return null;
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
  return null;
}

/** Build the assignments map: {menuId: {category: itemId[]}} from items' menu_associations. */
export function buildAssignments(
  items: MenuItemDisplay[],
  menus: MenuSummary[],
): Record<string, Record<string, string[]>> {
  const result: Record<string, Record<string, string[]>> = {};
  for (const menu of menus) {
    result[menu.id] = Object.fromEntries(
      CANONICAL_CATEGORIES.map((c) => [c, [] as string[]]),
    );
  }
  for (const item of items) {
    for (const assoc of item.menu_associations ?? []) {
      const rawCanon = toCanonical(assoc.category_name ?? item.category);
      const cats = assoc.canonical_categories?.length
        ? assoc.canonical_categories
        : rawCanon ? [rawCanon] : [];
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

/**
 * Sentinel sub-category key for items that carry no raw_categories label.
 * Rendered as an "Ungrouped" group, always last (menu raw sub-categories, 2026-06-09).
 */
export const UNGROUPED_KEY = '__ungrouped__';

/**
 * Build the NESTED assignments map: {menuId: {canonical: {rawLabel: itemId[]}}}.
 *
 * Second level of buildAssignments — within each canonical bucket, items are
 * grouped by their raw_categories labels (menu-wide; an item with N labels
 * appears under each). Items with no label fall under UNGROUPED_KEY. Labels are
 * per-(item, menu) so an item shared across two canonical buckets shows the
 * same labels under both. Mirrors buildAssignments' canonical resolution.
 */
export function buildNestedAssignments(
  items: MenuItemDisplay[],
  menus: MenuSummary[],
): Record<string, Record<string, Record<string, string[]>>> {
  const result: Record<string, Record<string, Record<string, string[]>>> = {};
  for (const menu of menus) {
    result[menu.id] = Object.fromEntries(
      CANONICAL_CATEGORIES.map((c) => [c, {} as Record<string, string[]>]),
    );
  }
  for (const item of items) {
    for (const assoc of item.menu_associations ?? []) {
      const menuBuckets = result[assoc.menu_id];
      if (!menuBuckets) continue;
      const rawCanon = toCanonical(assoc.category_name ?? item.category);
      const cats = assoc.canonical_categories?.length
        ? assoc.canonical_categories
        : rawCanon ? [rawCanon] : [];
      const labels = assoc.raw_categories?.length ? assoc.raw_categories : [UNGROUPED_KEY];
      for (const canon of cats) {
        const bucket = menuBuckets[canon];
        if (bucket === undefined) continue;
        for (const label of labels) {
          if (!bucket[label]) bucket[label] = [];
          if (!bucket[label].includes(item.id)) bucket[label].push(item.id);
        }
      }
    }
  }
  return result;
}

/**
 * Ordered sub-category labels for a canonical bucket: alphabetical
 * (case-insensitive), with UNGROUPED_KEY always last.
 */
export function sortedSubCategoryLabels(labels: string[]): string[] {
  return [...labels].sort((a, b) => {
    if (a === UNGROUPED_KEY) return 1;
    if (b === UNGROUPED_KEY) return -1;
    return a.toLowerCase().localeCompare(b.toLowerCase());
  });
}

/**
 * STR-775 — order display labels by the owner's first-class sub-category
 * `sort_order`. `subs` are the structure rows for one (menu × course). A label
 * is matched to a row by `normalizeSubcatKey` (the same casing/punctuation
 * collapse the builder groups by). Labels WITH a row sort by that row's
 * sort_order (ties → alphabetical); labels with NO row yet (just-scraped, never
 * reordered) sort after them alphabetically; UNGROUPED_KEY is always last.
 * Pure — extracted from MenuManagerClient so the ordering is unit-testable.
 */
export function orderSubcategoryLabels(
  labels: string[],
  subs: ReadonlyArray<{ name: string; sort_order: number | null }>,
): string[] {
  const orderByKey = new Map<string, number>();
  subs.forEach((s, i) => orderByKey.set(normalizeSubcatKey(s.name), s.sort_order ?? i));
  const real = labels.filter((l) => l !== UNGROUPED_KEY);
  const known = real.filter((l) => orderByKey.has(normalizeSubcatKey(l)));
  const unknown = real.filter((l) => !orderByKey.has(normalizeSubcatKey(l)));
  known.sort((a, b) => (orderByKey.get(normalizeSubcatKey(a))! - orderByKey.get(normalizeSubcatKey(b))!));
  unknown.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const out = [...known, ...unknown];
  if (labels.includes(UNGROUPED_KEY)) out.push(UNGROUPED_KEY);
  return out;
}

/**
 * STR-775 — assemble the COMPLETE `ordered_ids` permutation the reorder endpoint
 * requires. `orderedRealLabels` is the owner's new order (Ungrouped already
 * stripped); `resolveId` maps a label to an existing first-class row id (or
 * undefined → caller create-on-demands it and feeds the new id back via the
 * `created` map). Every existing row NOT covered by a displayed label (e.g. an
 * empty sub-category) is appended in its existing order so the payload is the
 * full set for (menu × course). Pure — the async create-on-demand stays in the
 * caller; this is the order/completeness logic that must be exactly right.
 */
export function buildReorderedIds(
  orderedRealLabels: string[],
  resolveId: (label: string) => string | undefined,
  existingIdsInOrder: ReadonlyArray<string>,
): string[] {
  const ids: string[] = [];
  const used = new Set<string>();
  for (const label of orderedRealLabels) {
    const id = resolveId(label);
    if (id && !used.has(id)) { ids.push(id); used.add(id); }
  }
  for (const id of existingIdsInOrder) {
    if (!used.has(id)) { ids.push(id); used.add(id); }
  }
  return ids;
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
        raw_categories: assoc.raw_categories ?? [],
        category_prices: assoc.category_prices ?? {},
        category_boost_levels: assoc.category_boost_levels ?? {},
        category_chefs_specials: assoc.category_chefs_specials ?? {},
        category_portions: assoc.category_portions ?? {},
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

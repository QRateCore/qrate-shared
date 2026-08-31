import type { MenuItemDisplay, MenuSummary, MenuItemJunctionSettings, MenuStructure } from '../../../types/restaurant';

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

// ── Drinks-mode sections ────────────────────────────────────────────────────
// A menu with `drinks_only` is organised by DRINK TYPE rather than the 4 food
// courses: the sections below become the builder's top-level zones, and the
// owner's own sub-categories nest underneath each (the same
// menu_item_subcategories mechanism the food courses use — its `canonical`
// column is free text, so a drink-type key fits without a schema change).
//
// Keys mirror DEFAULT_DRINK_SUBCATEGORIES in
// qrate-core/backend/lambdas/api/src/drink_defaults.py, which is what seeds
// each restaurant's editable tree and what /diner/drinks-menu reads back. Keep
// the two in step — a key here that the backend doesn't know would render a
// zone whose items never reach the drinks app.
//
// `members` is a single-element array (the key itself): drink types have no
// many-to-one collapsing the way Mains absorbs Soups/Salads/Sides/Breads.
export const DRINK_TYPE_SECTION_KEYS = [
  'beer',
  'wine',
  'cocktails',
  'spirits',
  'cider',
  'mocktails',
  'sodas',
  'juices',
  'hot',
  'water',
  // Reserved system bucket for drinks with no type assigned. Always last.
  'other',
] as const;

const DRINK_TYPE_LABELS: Record<string, string> = {
  beer: 'Beer',
  wine: 'Wine',
  cocktails: 'Cocktails',
  spirits: 'Spirits',
  cider: 'Cider',
  mocktails: 'Mocktails',
  sodas: 'Soft Drinks',
  juices: 'Juices & Smoothies',
  hot: 'Hot Drinks',
  water: 'Water',
  other: 'Other',
};

/** Reserved bucket for drinks with no type assigned (mirrors the backend's). */
export const DRINK_UNCLASSIFIED_KEY = 'other';

export const DRINK_TYPE_SECTIONS: MenuSection[] = DRINK_TYPE_SECTION_KEYS.map((key) => ({
  label: DRINK_TYPE_LABELS[key] ?? key,
  canonical: key,
  members: [key],
}));

/** True when this menu is built from drink types rather than food courses. */
export function isDrinksMenu(menu: Pick<MenuSummary, 'drinks_only'> | null | undefined): boolean {
  return !!menu?.drinks_only;
}

// ── Wine-menu mode ──────────────────────────────────────────────────────────
// A menu imported via the Add Menu wizard's wine flow (`menu_type === 'wine'`)
// gets ONE fixed top-level bucket instead of the 4 food courses OR the full
// drink-type list — a wine list has no "Starters"/"Mains", and forcing it
// through the drinks_only path would surface Beer/Cocktails/etc. sections
// that will always be empty. The owner's own sub-categories (Reds, Reserve
// Reds, Bubbly, however the source list is organised) nest underneath via the
// SAME raw_categories mechanism every other bucket already uses — no new
// nesting logic needed, just a different top-level key.
//
// Distinct from `drinks_only` (isDrinksMenu) on purpose: drinks_only is an
// owner-toggled, destructive mode switch that can apply to any menu and
// spans every drink type. `menu_type === 'wine'` is set automatically by the
// wizard for a menu that was imported as a wine list specifically.
export const WINE_MENU_SECTION: MenuSection = { label: 'Wine', canonical: 'wine_menu', members: ['wine_menu'] };

/** True when this menu was imported as a dedicated wine list. */
export function isWineMenu(menu: Pick<MenuSummary, 'menu_type'> | null | undefined): boolean {
  return menu?.menu_type === 'wine';
}

/**
 * The builder's top-level sections for a given menu.
 *
 * Wine-type menus get the single Wine bucket; food menus get the unchanged 4
 * courses; drinks_only menus get drink types. `override` accepts the
 * restaurant's own (possibly customised) drink-type tree — pass the
 * labels/order from /diner/drink-bubbles when available so the builder and
 * the drinks app cannot disagree. Falls back to the seeded defaults above.
 */
export function sectionsForMenu(
  menu: Pick<MenuSummary, 'drinks_only' | 'menu_type'> | null | undefined,
  override?: MenuSection[] | null,
): MenuSection[] {
  if (isWineMenu(menu)) return [WINE_MENU_SECTION];
  if (!isDrinksMenu(menu)) return MENU_SECTIONS;
  return override && override.length > 0 ? override : DRINK_TYPE_SECTIONS;
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

// ── Sub-category-v2 structure projection ────────────────────────────────────
// These two are the read path for the flag-ON builder: the structure API is the
// source of truth for which course(s) an item sits in, and they project it into
// the legacy {menuId: {canonical: itemId[]}} shape the builder renders from.
//
// Both are pure so the multi-course invariant is unit-testable without mounting
// MenuManagerClient — it previously lived inline in two useMemos and had no
// tests at all, which is how the "dropped on Drinks, rendered under Mains" bug
// reached dev.

/** One course-scoped placement of an item. An item holds one PER COURSE. */
export interface StructurePlacement {
  course: string;
  subName: string;
  subId: string;
}

/** menuId -> itemId -> every course-scoped placement that item holds.
 *
 *  Multi-course is legitimate and required: `menu_subcategory_items` is
 *  UNIQUE (menu_id, course, menu_item_id), i.e. one sub-category PER COURSE.
 *  Collapsing this to a single placement (a plain `perItem[id] = …` overwrite)
 *  kept only the last course the structure yielded, so an item in Drinks and
 *  Mains rendered in whichever won the race. */
export function buildStructureItemIndex(
  structureByMenu: Record<string, MenuStructure>,
): Record<string, Record<string, StructurePlacement[]>> {
  const idx: Record<string, Record<string, StructurePlacement[]>> = {};
  for (const [menuId, structure] of Object.entries(structureByMenu ?? {})) {
    const perItem: Record<string, StructurePlacement[]> = {};
    for (const [course, subs] of Object.entries(structure?.courses ?? {})) {
      for (const sub of subs ?? []) {
        for (const itemId of sub.item_ids ?? []) {
          const list = (perItem[itemId] ??= []);
          // One sub-category per course is the DB invariant; guard anyway so a
          // malformed structure can't duplicate a row within one course.
          if (!list.some((p) => p.course === course)) {
            list.push({ course, subName: sub.name, subId: sub.subcategory_id });
          }
        }
      }
    }
    idx[menuId] = perItem;
  }
  return idx;
}

/** Project one menu's structure placements into canonical buckets, merging any
 *  legacy placement the structure doesn't cover.
 *
 *  `seedKeys` is CANONICAL_CATEGORIES for a food menu, or the structure's own
 *  drink-type keys for a drinks menu (which buckets by type, not canonical). */
export function projectStructureBuckets(
  legacy: Record<string, string[]>,
  perItem: Record<string, StructurePlacement[]>,
  seedKeys: readonly string[],
): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  for (const cat of seedKeys) next[cat] = [];

  const seen = new Set<string>();
  // An item renders once in EVERY course it is placed in.
  for (const [itemId, placements] of Object.entries(perItem)) {
    for (const p of placements) {
      if (next[p.course] && !seen.has(`${p.course}:${itemId}`)) {
        next[p.course].push(itemId);
        seen.add(`${p.course}:${itemId}`);
      }
    }
  }

  // Merge legacy placements the structure doesn't represent, so an item on the
  // menu but not yet in any sub-category still renders (Ungrouped). The guard is
  // PER COURSE — a blanket "is this item anywhere in the structure?" test is
  // what erased an item's second course.
  for (const [cat, ids] of Object.entries(legacy ?? {})) {
    if (next[cat] === undefined) { next[cat] = [...ids]; continue; }
    for (const id of ids) {
      const placedHere = (perItem[id] ?? []).some((p) => p.course === cat);
      if (!placedHere && !next[cat].includes(id)) next[cat].push(id);
    }
  }
  return next;
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
  // Drinks menus bucket by drink type, not canonical category; wine-type
  // menus bucket everything under the single Wine key — seed their key
  // space accordingly or every placement would be dropped by the
  // `!== undefined` guard below.
  const drinksMenuIds = new Set<string>();
  const wineMenuIds = new Set<string>();
  for (const menu of menus) {
    if (isWineMenu(menu)) {
      wineMenuIds.add(menu.id);
      result[menu.id] = { [WINE_MENU_SECTION.canonical]: [] };
    } else if (isDrinksMenu(menu)) {
      drinksMenuIds.add(menu.id);
      result[menu.id] = Object.fromEntries(
        DRINK_TYPE_SECTION_KEYS.map((k) => [k, [] as string[]]),
      );
    } else {
      result[menu.id] = Object.fromEntries(
        CANONICAL_CATEGORIES.map((c) => [c, [] as string[]]),
      );
    }
  }
  for (const item of items) {
    for (const assoc of item.menu_associations ?? []) {
      // On a wine-type menu, every item lands in the single Wine bucket. On a
      // drinks menu the item's drink type IS its section (an item with no
      // type assigned falls into the reserved 'other' bucket rather than
      // disappearing from the builder entirely).
      const cats = wineMenuIds.has(assoc.menu_id)
        ? [WINE_MENU_SECTION.canonical]
        : drinksMenuIds.has(assoc.menu_id)
        ? [item.drink_subcategory_key || DRINK_UNCLASSIFIED_KEY]
        : (() => {
            const rawCanon = toCanonical(assoc.category_name ?? item.category);
            return assoc.canonical_categories?.length
              ? assoc.canonical_categories
              : rawCanon ? [rawCanon] : [];
          })();
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
  const wineMenuIds = new Set<string>();
  for (const menu of menus) {
    if (isWineMenu(menu)) {
      wineMenuIds.add(menu.id);
      result[menu.id] = { [WINE_MENU_SECTION.canonical]: {} as Record<string, string[]> };
    } else {
      result[menu.id] = Object.fromEntries(
        CANONICAL_CATEGORIES.map((c) => [c, {} as Record<string, string[]>]),
      );
    }
  }
  for (const item of items) {
    for (const assoc of item.menu_associations ?? []) {
      const menuBuckets = result[assoc.menu_id];
      if (!menuBuckets) continue;
      // Wine-type menus: every item nests under the single Wine key by its
      // raw sub-category label (below) — same mechanism, different top-level
      // key. Everything else keeps the existing canonical resolution.
      const cats = wineMenuIds.has(assoc.menu_id)
        ? [WINE_MENU_SECTION.canonical]
        : (() => {
            const rawCanon = toCanonical(assoc.category_name ?? item.category);
            return assoc.canonical_categories?.length
              ? assoc.canonical_categories
              : rawCanon ? [rawCanon] : [];
          })();
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
  // Two structure rows can collapse to the SAME normalized key (e.g. the Anant
  // Lunch menu carries both "Bread (Kulcha)" and "Bread Kulcha"). The builder
  // merges them into ONE displayed pill, so the pill's position must resolve to
  // the EARLIEST (min) sort_order of its colliding rows — NOT last-write-wins.
  // Last-wins was the bug: after a reorder the moved row took the new position
  // but its orphaned sibling was pushed to the bottom, and last-wins resolved the
  // merged pill to the bottom → the pill snapped back every time. Min makes the
  // pill follow the row the owner actually moved.
  const orderByKey = new Map<string, number>();
  subs.forEach((s, i) => {
    const k = normalizeSubcatKey(s.name);
    const v = s.sort_order ?? i;
    const prev = orderByKey.get(k);
    orderByKey.set(k, prev === undefined ? v : Math.min(prev, v));
  });
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

/**
 * Collision-aware successor to {@link buildReorderedIds}. A single displayed
 * sub-category pill can be backed by MORE THAN ONE first-class row when their
 * names collapse to the same {@link normalizeSubcatKey} (e.g. "Bread (Kulcha)"
 * + "Bread Kulcha" on the Anant Lunch menu). `buildReorderedIds` resolved a
 * label to ONE id and appended every other row to the end — so the colliding
 * sibling drifted to the bottom on every save. This version groups ALL rows
 * that share a pill's normalized key and places them CONSECUTIVELY at the pill's
 * new position, so siblings travel together and never strand at the bottom.
 *
 * - `orderedRealLabels` — the owner's new pill order (UNGROUPED already stripped).
 * - `rows` — the course's current first-class rows (id + name), current order.
 * - `createdIdByLabel` — ids of rows just created on-demand for labels that had
 *   no backing row yet (placed at the label's position).
 *
 * Returns the COMPLETE permutation the reorder endpoint requires: every grouped
 * row, then any row whose key matched no displayed label (e.g. an empty
 * sub-category), each exactly once. Pure.
 */
export function buildReorderedSubcategoryIds(
  orderedRealLabels: string[],
  rows: ReadonlyArray<{ subcategory_id: string; name: string }>,
  createdIdByLabel?: ReadonlyMap<string, string>,
): string[] {
  const rowsByKey = new Map<string, string[]>();
  for (const r of rows) {
    const k = normalizeSubcatKey(r.name);
    const group = rowsByKey.get(k);
    if (group) group.push(r.subcategory_id);
    else rowsByKey.set(k, [r.subcategory_id]);
  }
  const ids: string[] = [];
  const used = new Set<string>();
  for (const label of orderedRealLabels) {
    const key = normalizeSubcatKey(label);
    for (const id of rowsByKey.get(key) ?? []) {
      if (!used.has(id)) { ids.push(id); used.add(id); }
    }
    const created = createdIdByLabel?.get(label);
    if (created && !used.has(created)) { ids.push(created); used.add(created); }
  }
  // Rows whose key matched no displayed label (empty sub-categories, Ungrouped)
  // keep their relative order at the end so the permutation stays complete.
  for (const r of rows) {
    if (!used.has(r.subcategory_id)) { ids.push(r.subcategory_id); used.add(r.subcategory_id); }
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
        serving_price_overrides: assoc.serving_price_overrides ?? {},
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

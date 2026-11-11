/**
 * Item editor — scope band + "Where this item appears" helpers (Owner Portal
 * redesign, 2026-11-10).
 *
 * Pure helpers behind the Edit item modal's header band and the Menu pricing
 * section's review banner:
 *
 *   - `itemScopeLine(n)`            → "Changes here update this item on all 3
 *                                      menus it appears on."
 *   - `menuPricingHint(placements)` → "Lunch is $43.00 higher than Dinner, and
 *                                      Bar has no price. Review before saving."
 *
 * The hint reads the item's REAL per-menu placements (`menu_associations` on
 * the hydrated item). It names the single widest gap between two priced menus
 * and lists every menu that has no price at all, because those are the two
 * things an owner saving a shared item most often does not expect: the same
 * dish costing more on one menu, and a menu quietly charging the base price.
 *
 * Mirrors `apps/owner/src/components/food-items/menuPricingHint.ts`, which now
 * re-exports from here so the owner tests keep pinning the same behaviour.
 */

export interface PricedPlacement {
  menu_id: string;
  menu_name: string;
  price: number | null | undefined;
}

export interface MenuPricingHint {
  /** The widest priced gap, if two or more menus carry a price and differ. */
  gap: { higher: string; lower: string; delta: number } | null;
  /** Menus the item appears on with no price set (would charge the base price / $0.00). */
  unpriced: string[];
}

/** Formats a money amount for the hint; the caller may override (currency). */
export type MoneyFormatter = (amount: number) => string;

const defaultMoney: MoneyFormatter = (n) => `$${n.toFixed(2)}`;

/** The structured facts the hint sentence is built from. */
export function analyseMenuPricing(placements: readonly PricedPlacement[]): MenuPricingHint {
  // Dedupe by menu id — the API returns one row per (menu, category) when an
  // item sits in several categories of one menu; the price is per placement
  // so the first row wins.
  const seen = new Set<string>();
  const rows: PricedPlacement[] = [];
  for (const p of placements) {
    if (!p.menu_id || seen.has(p.menu_id)) continue;
    seen.add(p.menu_id);
    rows.push(p);
  }
  const priced = rows.filter((r): r is PricedPlacement & { price: number } =>
    typeof r.price === 'number' && Number.isFinite(r.price));
  const unpriced = rows.filter((r) => !(typeof r.price === 'number' && Number.isFinite(r.price)))
    .map((r) => r.menu_name || 'Unnamed menu');

  let gap: MenuPricingHint['gap'] = null;
  if (priced.length >= 2) {
    let hi = priced[0];
    let lo = priced[0];
    for (const r of priced) {
      if (r.price > hi.price) hi = r;
      if (r.price < lo.price) lo = r;
    }
    const delta = Math.round((hi.price - lo.price) * 100) / 100;
    if (delta > 0) {
      gap = { higher: hi.menu_name || 'Unnamed menu', lower: lo.menu_name || 'Unnamed menu', delta };
    }
  }
  return { gap, unpriced };
}

/**
 * The review sentence, or null when there is nothing to flag (one menu, or
 * every menu priced the same). Always ends with "Review before saving."
 */
export function menuPricingHint(
  placements: readonly PricedPlacement[],
  money: MoneyFormatter = defaultMoney,
): string | null {
  const { gap, unpriced } = analyseMenuPricing(placements);
  const parts: string[] = [];
  if (gap) parts.push(`${gap.higher} is ${money(gap.delta)} higher than ${gap.lower}`);
  if (unpriced.length > 0) {
    const names = joinNames(unpriced);
    parts.push(`${names} ${unpriced.length === 1 ? 'has' : 'have'} no price`);
  }
  if (parts.length === 0) return null;
  const body = parts.length === 2 ? `${parts[0]}, and ${parts[1]}` : parts[0];
  return `${body}. Review before saving.`;
}

/** "Changes here update this item on all N menus it appears on." */
export function itemScopeLine(menuCount: number): string {
  if (menuCount <= 0) return 'Not on any menu yet — add it from Menu pricing once saved.';
  if (menuCount === 1) return 'Changes here update this item on the 1 menu it appears on.';
  return `Changes here update this item on all ${menuCount} menus it appears on.`;
}

/**
 * The "<Menu> / <Course> / <Sub-category>" path shown above the per-menu
 * price fields. Falls back to just the menu name when the placement carries
 * no course; sub-category labels are joined with " · " when there are several.
 */
export function placementPath(p: {
  menu_name: string;
  category_name?: string | null;
  raw_categories?: readonly string[] | null;
}): string {
  const parts = [p.menu_name || 'Unnamed menu'];
  if (p.category_name) parts.push(p.category_name);
  const subs = (p.raw_categories ?? []).filter((s) => typeof s === 'string' && s.trim().length > 0);
  if (subs.length > 0) parts.push(subs.join(' · '));
  return parts.join(' / ');
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

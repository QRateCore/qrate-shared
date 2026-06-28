/**
 * Canonical DISPLAY label for a dietary/allergen slug — the shared
 * @qrate/shared source so owner + waiter + admin render identically (STR-822).
 *
 * The underlying VALUE (React key, `data-testid`, save payload) must always
 * stay the exact raw tag; only the rendered text is formatted (STR-801).
 *
 * Mirrors the curated labels the backend returns from
 * `GET /diner/dietary-options` (`CANONICAL_DIETARY_RESPONSE` /
 * `CANONICAL_ALLERGENS_RESPONSE`), the owner app's `lib/labelFormat.ts`, and
 * the patron app's `lib/dietary/canonicalLabel.ts`:
 * `gluten-free` -> "Gluten-Free" keeps its hyphen; `tree-nuts` -> "Tree Nuts"
 * drops it — neither is algorithmic, hence the curated map. Unknown / custom
 * slugs fall back to a hyphen/underscore title-case.
 *
 * Do NOT use this on already-proper text (category names, acronyms) — the
 * fallback lowercases-then-titlecases and would corrupt "BBQ" -> "Bbq".
 */
const CANONICAL_TAG_LABELS: Record<string, string> = {
  // Dietary (canonical + common lifestyle)
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  'gluten-free': 'Gluten-Free',
  halal: 'Halal',
  kosher: 'Kosher',
  jain: 'Jain',
  // Allergens (FDA Big 9)
  dairy: 'Dairy',
  eggs: 'Eggs',
  fish: 'Fish',
  shellfish: 'Shellfish',
  'tree-nuts': 'Tree Nuts',
  peanuts: 'Peanuts',
  wheat: 'Wheat',
  soy: 'Soy',
  sesame: 'Sesame',
};

export function formatTagLabel(slug: string): string {
  const key = (slug ?? '').trim().toLowerCase();
  if (!key) return '';
  const curated = CANONICAL_TAG_LABELS[key];
  if (curated) return curated;
  return key
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

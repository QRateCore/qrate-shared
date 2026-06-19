/**
 * Sweetness levels feature visibility — STR-480 (2026-05-09).
 *
 * Leadership decision: hide all client-visible Sweetness UI without reverting
 * the merged STR-472 feature. Backend, OpenAPI, recommendation scoring, DB
 * schema, and setup-guide auto-tagging all stay live. Re-enable by flipping
 * this constant to `true` AND the matching constant in qrate-patron-webapp
 * (`src/constants/feature-flags.ts`).
 *
 * Source ticket: https://projectrestaurant.atlassian.net/browse/STR-480
 * Gated feature: STR-472 (delivered 2026-05-09 14:44 UTC)
 */
export const SWEETNESS_VISIBLE = false;

/**
 * Owner menu-builder first-class sub-category cutover — PDD 2026-06-19 Phase 3.
 *
 * When ON, the menu builder reads its grouped view from the new first-class
 * sub-category structure API (GET /owner/menus/{menuId}/structure) and writes
 * via the new sub-category endpoints (create/rename/delete + per-item assign).
 * It performs NO legacy `raw_categories` write and NO `menu_item_subcategories`
 * junction dual-write while ON.
 *
 * When OFF (default — prod-safe), the builder behaves exactly as before:
 * raw_categories grouping (menu_item_menus.raw_categories[]) + best-effort
 * dual-write. dev/staging builds set NEXT_PUBLIC_SUBCATEGORY_V2=true; prod
 * omits it so it stays OFF.
 *
 * Read via a function (not a top-level const) so each call sees the value at
 * use time — Next.js inlines NEXT_PUBLIC_* at build, and a function keeps unit
 * tests free to stub process.env per-case.
 */
export function isSubcategoryV2Enabled(): boolean {
  // Avoid a @types/node dep in this package — read process via globalThis with
  // an inline cast, mirroring spice-derivation.ts. The Next.js bundler replaces
  // process.env.NEXT_PUBLIC_* with a literal at build time in consumers.
  const value = (globalThis as { process?: { env?: { NEXT_PUBLIC_SUBCATEGORY_V2?: string } } })
    .process?.env?.NEXT_PUBLIC_SUBCATEGORY_V2;
  return value === 'true';
}

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
// Module-local, type-only declaration of `process` so this package typechecks
// without an @types/node dep (its tsconfig has no `node` lib). It is ERASED at
// emit, leaving a bare `process.env.NEXT_PUBLIC_SUBCATEGORY_V2` member access —
// which is the EXACT form Next.js inlines to a literal at build time. The prior
// `globalThis.process?.env?.…` form was NOT inlined (it survived as a runtime
// lookup, and `globalThis.process` is undefined in the browser → always false),
// which silently gated this feature OFF in every deployed build (STR-775).
declare const process: { env: { NEXT_PUBLIC_SUBCATEGORY_V2?: string } };

export function isSubcategoryV2Enabled(): boolean {
  return process.env.NEXT_PUBLIC_SUBCATEGORY_V2 === 'true';
}

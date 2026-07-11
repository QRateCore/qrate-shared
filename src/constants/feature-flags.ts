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
 * Owner menu-builder first-class sub-category structure — PDD 2026-06-19.
 *
 * PERMANENTLY ON (2026-07-11). The menu builder ALWAYS reads its grouped view
 * from the first-class sub-category structure API (GET /owner/menus/{menuId}/structure)
 * and writes via the sub-category endpoints (create/rename/delete + per-item
 * assign + reorder). This is the single source of truth shared with the patron
 * webapp — the patron renders subcategory name/course/membership strictly from
 * this same structure.
 *
 * There is NO LONGER a `NEXT_PUBLIC_SUBCATEGORY_V2` flag. The feature cannot be
 * turned off by an env var, a missing turbo env passthrough, or a pipeline
 * rebuild — an accidental "off" was a real risk (the prod cutover was reverted
 * once by exactly this class of bug, STR-775). The env var, if still set by a
 * build, is now ignored.
 *
 * Kept as a function (not a bare `true` const) so the existing call sites keep
 * compiling unchanged; it now unconditionally returns true. The legacy
 * raw_categories read/dual-write branches guarded by this are dead and slated
 * for removal.
 */
export function isSubcategoryV2Enabled(): boolean {
  return true;
}

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

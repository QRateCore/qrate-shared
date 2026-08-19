/**
 * Decide which owner surface an owner belongs in — `owner-app` (full-service
 * restaurants) or `owner-lite` (micro-kitchens) — from their institution list.
 *
 * MK-9. Plan: docs/plans/2026-08-19_microkitchen-owner-lite-routing_plan.md.
 * This is the SINGLE source of truth for the routing decision: owner-app's
 * redirect hook (MK-10) and owner-lite's land-guard (MK-11) both call it, so
 * the two apps can never disagree about where an owner belongs. A split
 * implementation is exactly what traps an owner in a redirect loop (owner-app
 * bounces them to lite, lite bounces them back, forever).
 *
 * DEFENSIVE / FAIL-SAFE bias: owner-app serves EVERY institution type, so it
 * is always a safe home; owner-lite only serves micro-kitchens, so sending the
 * wrong owner there strands them. Therefore every ambiguous, unknown, or
 * missing case resolves to `'owner-app'`. Only an ACTIVE institution whose
 * `service_model` is EXACTLY `micro_kitchen` routes to `'owner-lite'`.
 *
 * A missing/undefined/null `service_model` is treated as full-service: the
 * generated TS type is non-optional, but runtime JSON can omit it, and the
 * only safe reading of "no known service model" is "not a micro-kitchen".
 *
 * Decision:
 *   1. Pick the ACTIVE institution:
 *      - `selectedId` given → the institution with that id (the switcher /
 *        deep-link case). No match → none.
 *      - else exactly one → that institution (the common single-venue owner).
 *      - else (0 institutions, or N>1 with no selection) → none. With multiple
 *        venues and no explicit choice we cannot know which is active, so we
 *        stay in the universally-safe owner-app until the owner selects one.
 *   2. Active institution is a micro-kitchen → `'owner-lite'`; otherwise
 *      `'owner-app'`.
 *
 * The input is a MINIMAL structural shape (`{ id, service_model? }`) on
 * purpose: `@qrate/shared` has no dependency on `@qrate/owner-api`, and both
 * apps' richer assignment/restaurant objects structurally satisfy it — so one
 * tested implementation serves both without coupling the packages.
 */

export type OwnerApp = 'owner-app' | 'owner-lite';

/** The `restaurants.service_model` value that routes an owner to owner-lite. */
export const MICRO_KITCHEN_SERVICE_MODEL = 'micro_kitchen';

/** The minimal shape resolveOwnerApp needs from an institution/assignment. */
export interface RoutableInstitution {
  id: string;
  /** `restaurants.service_model`; may be absent at runtime → full-service. */
  service_model?: string | null;
}

export function resolveOwnerApp(
  institutions: RoutableInstitution[] | null | undefined,
  selectedId?: string | null,
): OwnerApp {
  const list = institutions ?? [];

  // An empty-string selection is "nothing selected", not "select the venue
  // with id ''" — treat it the same as an omitted selectedId.
  const hasSelection = selectedId != null && selectedId !== '';

  let active: RoutableInstitution | undefined;
  if (hasSelection) {
    active = list.find((inst) => inst.id === selectedId);
  } else if (list.length === 1) {
    active = list[0];
  }

  return active?.service_model === MICRO_KITCHEN_SERVICE_MODEL
    ? 'owner-lite'
    : 'owner-app';
}

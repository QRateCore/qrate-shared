// Client-side port of the canonical heat derivation table.
// Source of truth: qrate-core/backend/lambdas/api/src/routes/spice_derivation.py
// (HEAT_FROM_SPICE_LEVEL — 6 valid scale lengths × variable spice_levels = 33 tuples).
// Any change here must be paired with a backend change in spice_derivation.py.
// STR-478 (2026-05-10): introduced for owner-side previews — EditModal "Patron sees"
// row + per-row hint on the Spice Levels tab in Food Library customization.
import { MIN_SPICE_SCALE_LEVELS, MAX_SPICE_SCALE_LEVELS } from '../constants/food-tags';

export const HEAT_FROM_SPICE_LEVEL: Record<number, readonly number[]> = {
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 3, 4],
  6: [0, 1, 2, 2, 3, 4],
  7: [0, 1, 1, 2, 3, 3, 4],
  8: [0, 1, 1, 2, 2, 3, 3, 4],
};

function warnInvalid(reason: string, ctx: Record<string, unknown>): void {
  // Avoid a @types/node dep in this package — read process via globalThis with
  // optional chaining so the helper compiles in pure browser/edge contexts too.
  // The Next.js bundler replaces process.env.NODE_ENV with a literal at build
  // time, so this guard collapses to a constant-false branch in prod bundles.
  const env = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
    .process?.env?.NODE_ENV;
  if (env !== 'production') {
    // Owner-side dev signal only — never fires in prod bundles.
    // eslint-disable-next-line no-console
    console.warn(`[STR-478] deriveHeat: ${reason}`, ctx);
  }
}

/**
 * Map (spiceLevel, scaleLength) → derived heat bucket on the canonical 0..4 scale.
 * Returns null on invalid input rather than throwing — callers (preview rows,
 * suffix hints) treat null as "do not render the preview" so a stale label
 * after a scale-length change degrades to no-hint instead of a crash.
 *
 * Byte-identical with backend `derive_heat` in qrate-core spice_derivation.py.
 */
export function deriveHeat(spiceLevel: number, scaleLength: number): number | null {
  if (!Number.isInteger(spiceLevel) || !Number.isInteger(scaleLength)) {
    warnInvalid('non-integer input', { spiceLevel, scaleLength });
    return null;
  }
  if (scaleLength < MIN_SPICE_SCALE_LEVELS || scaleLength > MAX_SPICE_SCALE_LEVELS) {
    warnInvalid('scaleLength out of range', { spiceLevel, scaleLength });
    return null;
  }
  if (spiceLevel < 1 || spiceLevel > scaleLength) {
    warnInvalid('spiceLevel out of range', { spiceLevel, scaleLength });
    return null;
  }
  const row = HEAT_FROM_SPICE_LEVEL[scaleLength];
  return row[spiceLevel - 1] ?? null;
}

/**
 * Convenience overload: resolve heat from a label by its position in the
 * provided scale. Returns null if the label is not present. Used by the
 * EditModal preview where state is the selected label string, not its index.
 *
 * The "stale label" case (label was on the scale at click-time but has since
 * been removed via cascade-state edits) returns null and the preview hides.
 */
export function deriveHeatFromLabel(label: string, scaleLevels: readonly string[]): number | null {
  const idx = scaleLevels.indexOf(label);
  if (idx < 0) return null;
  return deriveHeat(idx + 1, scaleLevels.length);
}

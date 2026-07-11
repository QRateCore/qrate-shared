/**
 * subcatV2 is PERMANENTLY ON (2026-07-11) — it is no longer a flag. The feature
 * must be impossible to disable accidentally (via env var, missing turbo env
 * passthrough, or a pipeline rebuild). These tests assert `isSubcategoryV2Enabled()`
 * returns true unconditionally, regardless of NEXT_PUBLIC_SUBCATEGORY_V2.
 *
 * (Historical: STR-775 — the prior env-based form was silently gated OFF in every
 * deployed build by an un-inlined process access. Hardcoding true removes that
 * entire class of bug.)
 */
import { afterEach, describe, expect, it } from 'vitest';
import { isSubcategoryV2Enabled } from '../feature-flags';

const original = process.env.NEXT_PUBLIC_SUBCATEGORY_V2;
afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_SUBCATEGORY_V2;
  else process.env.NEXT_PUBLIC_SUBCATEGORY_V2 = original;
});

describe('isSubcategoryV2Enabled', () => {
  it('is permanently true — cannot be turned off by any env value', () => {
    process.env.NEXT_PUBLIC_SUBCATEGORY_V2 = 'true';
    expect(isSubcategoryV2Enabled()).toBe(true);
    process.env.NEXT_PUBLIC_SUBCATEGORY_V2 = 'false';
    expect(isSubcategoryV2Enabled()).toBe(true);
    process.env.NEXT_PUBLIC_SUBCATEGORY_V2 = '0';
    expect(isSubcategoryV2Enabled()).toBe(true);
  });

  it('is true when the env var is unset (no flag dependency)', () => {
    delete process.env.NEXT_PUBLIC_SUBCATEGORY_V2;
    expect(isSubcategoryV2Enabled()).toBe(true);
  });
});

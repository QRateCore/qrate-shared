/**
 * STR-775 — isSubcategoryV2Enabled must read NEXT_PUBLIC_SUBCATEGORY_V2 directly
 * off process.env so Next.js inlines it at build (the prior globalThis form was
 * NOT inlined → undefined → feature silently OFF in every deployed build).
 *
 * NOTE: this unit test CANNOT catch the original bug — vitest runs in Node where
 * `process.env` is a real object, so even the broken globalThis form would read
 * it here. The actual verification is a bundle grep of the built chunk (the flag
 * name must NOT survive un-inlined). This test only guards the read contract.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { isSubcategoryV2Enabled } from '../feature-flags';

const original = process.env.NEXT_PUBLIC_SUBCATEGORY_V2;
afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_SUBCATEGORY_V2;
  else process.env.NEXT_PUBLIC_SUBCATEGORY_V2 = original;
});

describe('isSubcategoryV2Enabled', () => {
  it('is true only when the flag is exactly "true"', () => {
    process.env.NEXT_PUBLIC_SUBCATEGORY_V2 = 'true';
    expect(isSubcategoryV2Enabled()).toBe(true);
  });

  it('is false when unset', () => {
    delete process.env.NEXT_PUBLIC_SUBCATEGORY_V2;
    expect(isSubcategoryV2Enabled()).toBe(false);
  });

  it('is false for any non-"true" value', () => {
    process.env.NEXT_PUBLIC_SUBCATEGORY_V2 = 'false';
    expect(isSubcategoryV2Enabled()).toBe(false);
    process.env.NEXT_PUBLIC_SUBCATEGORY_V2 = '1';
    expect(isSubcategoryV2Enabled()).toBe(false);
  });
});

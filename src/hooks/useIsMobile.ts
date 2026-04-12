'use client';

import { useEffect, useState } from 'react';

/**
 * Mobile breakpoint query — anything ≤1023px is treated as mobile.
 *
 * Reuses the existing 1024px threshold the OwnerSidebar already uses
 * (see globals.css line 90, OwnerSidebar.tsx). Keeping this query
 * exported lets future consumers reference the canonical value rather
 * than hardcoding it.
 */
export const MOBILE_BREAKPOINT_QUERY = '(max-width: 1023px)';

/**
 * Returns `true` when the viewport is at-or-below the mobile breakpoint
 * (1023px). Backed by `window.matchMedia` and a `change` listener so
 * components re-render when the user resizes a desktop browser or
 * rotates a phone.
 *
 * SSR-safe: returns `false` on the first render before the effect
 * mounts. Mobile users see a single frame of desktop layout before
 * hydration completes — acceptable for an authenticated dashboard.
 *
 * Usage:
 * ```
 * const isMobile = useIsMobile();
 * return isMobile ? <MobileLayout /> : <DesktopLayout />;
 * ```
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isMobile;
}

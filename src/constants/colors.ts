/**
 * Color constants for use in SVG props (fill, stroke) and JS data structures
 * where CSS custom properties cannot be applied.
 *
 * For standard HTML/CSS contexts, prefer CSS variables directly:
 *   color: var(--color-status-warning)   instead of COLOR_WARNING
 *   color: var(--brand-s)                instead of COLOR_BRAND_SOLID
 */

// Status colors
export const COLOR_WARNING       = '#f59e0b';  // amber-500
export const COLOR_WARNING_BG    = '#fef3c7';  // amber-100 — tinted backgrounds
export const COLOR_WARNING_BG_SM = '#fffbeb';  // amber-50  — subtle drag-over tint
export const COLOR_WARNING_TEXT  = '#92400e';  // amber-800 — text on amber backgrounds
export const COLOR_SUCCESS       = '#059669';  // green-600
export const COLOR_ERROR         = '#dc2626';  // red-600
export const COLOR_ERROR_MUTED   = '#ef4444';  // red-500   — icon/badge use

// Brand colors
export const COLOR_BRAND_SOLID   = '#FF6B2B';
export const COLOR_BRAND_HOVER   = '#FDBA74';  // orange-300 — hover borders

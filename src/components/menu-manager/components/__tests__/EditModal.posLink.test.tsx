// @vitest-environment jsdom
/**
 * EditModal — the POS product row (PDD 2026-08-31).
 *
 * The row is the drawer's half of the link picker. Its whole job is to say a
 * thing an owner cannot otherwise discover: on a POS restaurant, a dish with
 * no CONFIRMED link is not orderable at all, and nothing else in the editor
 * mentions it. An owner can otherwise fill in a description, set a price, hit
 * Save, and publish a dish no diner can buy.
 *
 * Two properties matter more than the markup:
 *
 *  1. It renders ONLY when the host passes `onOpenPosLink`. EditModal is
 *     mounted by waiter and admin too, and this package cannot import
 *     `@qrate/owner-api` — the picker is the owner app's, reached by callback.
 *     A row that leaked into those surfaces would be a dead control.
 *
 *  2. It keeps `suggested` distinct from `confirmed`. Only confirmed satisfies
 *     the gate; a suggestion is the importer's unapproved guess and the dish is
 *     STILL unsellable. Showing "Linked" there is the failure this whole
 *     feature exists to prevent.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import EditModal from '../EditModal';
import { MenuManagerServiceProvider } from '../../context';
import type { MenuItemDisplay } from '../../../../types/restaurant';

const ITEM = {
  id: 'item-1',
  name: 'Aroma Signature Cocktails',
  description: 'House pours.',
  category: 'Beverages',
  canonical_category: 'Beverages',
  price: 14,
  active: true,
  food_tags: {},
  menu_associations: [],
  addons: [],
  sides: [],
  recommendations: [],
  gallery_urls: [],
} as unknown as MenuItemDisplay;

/** Only the calls the row's render path can reach. */
const service = {
  updateMenuItem: vi.fn(),
  deleteMenuItem: vi.fn(),
  toggleMenuItemActive: vi.fn(),
  updateItemModifiers: vi.fn(),
  enhanceMenuItemImage: vi.fn(),
  removeMenuItemImage: vi.fn(),
} as never;

function renderModal(props: Record<string, unknown> = {}) {
  return render(
    <MenuManagerServiceProvider value={service}>
      <EditModal
        item={ITEM}
        restaurantId="rest-1"
        onClose={vi.fn()}
        onComplete={vi.fn()}
        {...props}
      />
    </MenuManagerServiceProvider>,
  );
}

describe('EditModal — POS row visibility', () => {
  it('is absent when the host supplies no handler', () => {
    // Waiter and admin mount this same modal. A visible row there would be a
    // control with nothing behind it.
    renderModal();
    expect(screen.queryByTestId('edit-modal-pos-link-row')).toBeNull();
  });

  it('appears once the owner app supplies the handler', () => {
    renderModal({ onOpenPosLink: vi.fn(), posLinkStatus: null });
    expect(screen.getByTestId('edit-modal-pos-link-row')).toBeTruthy();
  });

  it('opens the picker when clicked', async () => {
    const onOpenPosLink = vi.fn();
    renderModal({ onOpenPosLink, posLinkStatus: null });
    await userEvent.click(screen.getByTestId('edit-modal-pos-link-button'));
    expect(onOpenPosLink).toHaveBeenCalledTimes(1);
  });
});

describe('EditModal — POS row states', () => {
  it('does not call a SUGGESTED link "Linked"', () => {
    // The load-bearing distinction. A suggestion is the importer's unapproved
    // guess: the dish is still unsellable, and calling it Linked tells the
    // owner their menu is fine while diners cannot order it.
    renderModal({ onOpenPosLink: vi.fn(), posLinkStatus: 'suggested' });
    const badge = screen.getByTestId('edit-modal-pos-link-status');
    expect(badge).toHaveAttribute('data-pos-link', 'suggested');
    expect(badge.textContent).toBe('Suggested');
  });

  it('reads "Linked" only for a confirmed link', () => {
    renderModal({ onOpenPosLink: vi.fn(), posLinkStatus: 'confirmed', posSellable: true });
    expect(screen.getByTestId('edit-modal-pos-link-status').textContent).toBe('Linked');
  });

  it('reads "Not linked" when there is no link at all', () => {
    renderModal({ onOpenPosLink: vi.fn(), posLinkStatus: null });
    expect(screen.getByTestId('edit-modal-pos-link-status').textContent).toBe('Not linked');
  });

  it('flags a confirmed link that is still not sellable', () => {
    // The two CAN disagree while recompute_pos_sellable catches up. Showing
    // "Linked" alone here would tell an owner the dish is live when it is not.
    renderModal({ onOpenPosLink: vi.fn(), posLinkStatus: 'confirmed', posSellable: false });
    expect(screen.getByTestId('edit-modal-pos-link-row').textContent)
      .toContain('not yet sellable');
  });

  it('does not nag about sellability on a healthy link', () => {
    renderModal({ onOpenPosLink: vi.fn(), posLinkStatus: 'confirmed', posSellable: true });
    expect(screen.getByTestId('edit-modal-pos-link-row').textContent)
      .not.toContain('not yet sellable');
  });

  it('offers "Link" for an unlinked dish and "Change" for a linked one', () => {
    // Different jobs: finding a product for a dish that has no candidate is
    // not the same as swapping one that does.
    const { unmount } = renderModal({ onOpenPosLink: vi.fn(), posLinkStatus: null });
    expect(screen.getByTestId('edit-modal-pos-link-button').textContent).toBe('Link');
    unmount();
    renderModal({ onOpenPosLink: vi.fn(), posLinkStatus: 'confirmed', posSellable: true });
    expect(screen.getByTestId('edit-modal-pos-link-button').textContent).toBe('Change');
  });
});

/**
 * WHICH product is linked (2026-08-31).
 *
 * The status alone is unfalsifiable: a dish pointed at the wrong Clover item
 * renders exactly like a correct one — both say "Linked" — so an owner
 * reconciling their menu against the till could not spot a mis-link from the
 * drawer at all. They had to open the picker to find out.
 */
describe('EditModal — which POS product is linked', () => {
  it('names the product a confirmed link points at', () => {
    renderModal({
      onOpenPosLink: vi.fn(), posLinkStatus: 'confirmed',
      posLinkName: 'Cocktails', posLinkPrice: 0,
    });
    expect(screen.getByTestId('edit-modal-pos-link-name').textContent).toContain('Cocktails');
  });

  it('shows the price, because that is what gets reconciled', () => {
    renderModal({
      onOpenPosLink: vi.fn(), posLinkStatus: 'confirmed',
      posLinkName: 'Margarita', posLinkPrice: 10,
    });
    expect(screen.getByTestId('edit-modal-pos-link-price').textContent).toBe('$10.00');
  });

  it('renders a $0.00 POS product as $0.00, not as nothing', () => {
    // Indian Aroma's "Cocktails" IS $0 — the price lives on its modifiers.
    // Falsy-checking the price would hide the very product most likely to
    // confuse someone reading this row.
    renderModal({
      onOpenPosLink: vi.fn(), posLinkStatus: 'confirmed',
      posLinkName: 'Cocktails', posLinkPrice: 0,
    });
    expect(screen.getByTestId('edit-modal-pos-link-price').textContent).toBe('$0.00');
  });

  it('omits the price when the POS product has none', () => {
    // null is not zero: Clover omits a price for products priced entirely by
    // their modifiers, and printing "$0.00" there states a fact we do not have.
    renderModal({
      onOpenPosLink: vi.fn(), posLinkStatus: 'confirmed',
      posLinkName: 'Wine Bottles', posLinkPrice: null,
    });
    expect(screen.queryByTestId('edit-modal-pos-link-price')).toBeNull();
    expect(screen.getByTestId('edit-modal-pos-link-name').textContent).toContain('Wine Bottles');
  });

  it('names the product a SUGGESTION points at too', () => {
    // That name is the thing the owner is being asked to accept or reject.
    // Hiding it makes the decision impossible to take from this row.
    renderModal({
      onOpenPosLink: vi.fn(), posLinkStatus: 'suggested',
      posLinkName: 'Classic Cocktails', posLinkPrice: 9,
    });
    expect(screen.getByTestId('edit-modal-pos-link-name').textContent).toContain('Classic Cocktails');
  });

  it('says so when the link points at a product the POS no longer has', () => {
    // The link still exists and still gates sellability, so falling back to a
    // bare "Linked" badge would hide the reason the dish is stuck.
    renderModal({
      onOpenPosLink: vi.fn(), posLinkStatus: 'confirmed',
      posLinkName: null, posLinkPrice: null,
    });
    expect(screen.getByTestId('edit-modal-pos-link-name').textContent)
      .toContain('no longer in the POS catalogue');
  });

  it('shows no product line at all when the dish is unlinked', () => {
    // "Not linked" plus an empty name slot reads as a broken row.
    renderModal({ onOpenPosLink: vi.fn(), posLinkStatus: null });
    expect(screen.queryByTestId('edit-modal-pos-link-name')).toBeNull();
  });

  it('still reports a confirmed-but-unsellable dish alongside the name', () => {
    // The two facts are independent and the owner needs both: linked to the
    // right product, and still not orderable because a required grouping has
    // no linked options.
    renderModal({
      onOpenPosLink: vi.fn(), posLinkStatus: 'confirmed', posSellable: false,
      posLinkName: 'Cocktails', posLinkPrice: 0,
    });
    expect(screen.getByTestId('edit-modal-pos-link-name').textContent).toContain('Cocktails');
    expect(screen.getByTestId('edit-modal-pos-link-row').textContent).toContain('not yet sellable');
  });
});

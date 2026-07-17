// @vitest-environment jsdom
/**
 * Sub-category header delete/rename affordances (2026-07-17).
 *
 * Two independent asks are pinned here:
 *   1. Visual — the delete (trash) icon is RED and fully opaque so it's easy to
 *      spot; the rename (pencil) stays neutral; both icons are bumped to 15px
 *      (from 11px) for spot-ability. Neither the trash nor the pencil should
 *      shift the row layout — they render unconditionally in the header flex,
 *      not on hover.
 *   2. Copy — deleting a sub-category now REMOVES its members from this menu
 *      (they stay in the Food Library / other menus), so the two-tap confirm
 *      states the removed-item count ("Delete + remove N items from this
 *      menu?") instead of the old "→ Ungrouped" wording.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SubCategoryGroup } from '../SubCategoryGroup';
import { COLOR_MAP } from '../../lib/menuUtils';

const color = COLOR_MAP.blue;
const CAT = 'Beverages';
const LABEL = 'Beer (Bottle)';
const del = `subcategory-delete-${CAT}-${LABEL}`;
const rename = `subcategory-rename-${CAT}-${LABEL}`;

function renderGroup(props: Partial<React.ComponentProps<typeof SubCategoryGroup>> = {}) {
  return render(
    <SubCategoryGroup
      label={LABEL}
      category={CAT}
      menuId="menu-1"
      itemCount={3}
      color={color}
      onRename={vi.fn()}
      onDelete={vi.fn()}
      {...props}
    >
      <div>child row</div>
    </SubCategoryGroup>,
  );
}

const svgSize = (el: HTMLElement | null) => el?.querySelector('svg')?.getAttribute('width') ?? null;

describe('SubCategoryGroup — delete/rename icon affordances', () => {
  it('renders the trash in the destructive red var (always visible, not hover-gated)', () => {
    renderGroup();
    const btn = screen.getByTestId(del);
    expect(btn.className).toContain('text-[var(--red)]');
    // Fully opaque baseline so it's easy to spot — never the old opacity-60.
    expect(btn.className).toContain('opacity-100');
    expect(btn.className).not.toContain('opacity-60');
  });

  it('keeps the rename (pencil) neutral — NOT red — so red reads as "destructive"', () => {
    renderGroup();
    expect(screen.getByTestId(rename).className).not.toContain('text-[var(--red)]');
  });

  it('bumps both icons to 15px for spot-ability (was 11px)', () => {
    renderGroup();
    expect(svgSize(screen.getByTestId(del))).toBe('15');
    expect(svgSize(screen.getByTestId(rename))).toBe('15');
  });

  it('both icons render unconditionally in the header (no hover reveal → no layout shift)', () => {
    // Present in the DOM without any mouseenter — the row can be clicked without
    // the delete/edit controls jumping into place.
    renderGroup();
    expect(screen.getByTestId(del)).toBeTruthy();
    expect(screen.getByTestId(rename)).toBeTruthy();
  });
});

describe('SubCategoryGroup — delete confirm copy (remove-from-menu)', () => {
  it('states the removed-item count (plural) on confirm', () => {
    renderGroup({ itemCount: 3 });
    fireEvent.click(screen.getByTestId(del));
    const confirm = screen.getByTestId(`subcategory-delete-confirm-${CAT}-${LABEL}`);
    expect(confirm.textContent).toContain('Delete + remove 3 items from this menu?');
    // The retired "→ Ungrouped" wording must be gone.
    expect(confirm.textContent).not.toContain('Ungrouped');
  });

  it('uses the singular "item" for a one-item sub-category', () => {
    renderGroup({ itemCount: 1 });
    fireEvent.click(screen.getByTestId(del));
    const confirm = screen.getByTestId(`subcategory-delete-confirm-${CAT}-${LABEL}`);
    expect(confirm.textContent).toContain('Delete + remove 1 item from this menu?');
    expect(confirm.textContent).not.toContain('1 items');
  });

  it('drops the count entirely for an empty sub-category', () => {
    renderGroup({ itemCount: 0 });
    fireEvent.click(screen.getByTestId(del));
    const confirm = screen.getByTestId(`subcategory-delete-confirm-${CAT}-${LABEL}`);
    expect(confirm.textContent).toContain('Delete this sub-category?');
    expect(confirm.textContent).not.toContain('remove 0');
  });

  it('confirming (✓) fires onDelete with the label; cancel (✕) does not', () => {
    const onDelete = vi.fn();
    renderGroup({ onDelete });
    fireEvent.click(screen.getByTestId(del));
    fireEvent.click(screen.getByTestId(`subcategory-delete-yes-${CAT}-${LABEL}`));
    expect(onDelete).toHaveBeenCalledWith(LABEL);
  });

  it('cancelling hides the confirm without calling onDelete', () => {
    const onDelete = vi.fn();
    renderGroup({ onDelete });
    fireEvent.click(screen.getByTestId(del));
    fireEvent.click(screen.getByLabelText('Cancel delete'));
    expect(onDelete).not.toHaveBeenCalled();
    // Back to the trash affordance.
    expect(screen.getByTestId(del)).toBeTruthy();
  });
});

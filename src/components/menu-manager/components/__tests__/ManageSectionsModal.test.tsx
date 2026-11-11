// @vitest-environment jsdom
/**
 * "Manage sections" dialog (Owner Portal redesign, 2026-11-10). It drives the
 * SAME write paths the builder uses — `onReorderSubCategory` with the full
 * reordered label list, `onCreateSubCategory` from the shared create box —
 * and its control ids are prefixed so they never collide with the section
 * header controls still mounted behind it.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ManageSectionsModal, movedOrder, type ManageSection } from '../ManageSectionsModal';

const SECTIONS: ManageSection[] = [
  {
    canonical: 'Entrees',
    label: 'Mains',
    itemCount: 3,
    subcategories: [
      { label: 'Curries', count: 2 },
      { label: 'Grills', count: 1 },
      { label: 'Breads', count: 0 },
    ],
  },
  { canonical: 'Desserts', label: 'Desserts', itemCount: 0, subcategories: [] },
];

function renderModal(overrides: Partial<React.ComponentProps<typeof ManageSectionsModal>> = {}) {
  const onClose = vi.fn();
  const onReorderSubCategory = vi.fn();
  const onCreateSubCategory = vi.fn();
  render(
    <ManageSectionsModal
      open
      onClose={onClose}
      menuId="menu-1"
      menuName="Dinner"
      sections={SECTIONS}
      onReorderSubCategory={onReorderSubCategory}
      onCreateSubCategory={onCreateSubCategory}
      {...overrides}
    />,
  );
  return { onClose, onReorderSubCategory, onCreateSubCategory };
}

describe('movedOrder', () => {
  it('moves a label one step and returns null at the edges', () => {
    expect(movedOrder(['a', 'b', 'c'], 'b', 'up')).toEqual(['b', 'a', 'c']);
    expect(movedOrder(['a', 'b', 'c'], 'b', 'down')).toEqual(['a', 'c', 'b']);
    expect(movedOrder(['a', 'b', 'c'], 'a', 'up')).toBeNull();
    expect(movedOrder(['a', 'b', 'c'], 'c', 'down')).toBeNull();
    expect(movedOrder(['a', 'b', 'c'], 'zzz', 'up')).toBeNull();
  });
});

describe('<ManageSectionsModal />', () => {
  it('renders nothing when closed', () => {
    renderModal({ open: false });
    expect(screen.queryByTestId('menu-manage-sections-modal')).toBeNull();
  });

  it('lists every section with its item count and sub-categories in order', () => {
    renderModal();
    const dialog = screen.getByTestId('menu-manage-sections-modal');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(screen.getByTestId('menu-manage-section-Entrees').textContent).toContain('3 items');
    const rows = ['Curries', 'Grills', 'Breads'].map((l) => screen.getByTestId(`menu-manage-subcategory-Entrees-${l}`));
    expect(rows[0].textContent).toContain('2');
    expect(rows[2].textContent).toContain('0');
    expect(screen.getByTestId('menu-manage-section-empty-Desserts')).toBeTruthy();
  });

  it('▼ on the first sub-category writes the full reordered list through onReorderSubCategory', () => {
    const { onReorderSubCategory } = renderModal();
    fireEvent.click(screen.getByTestId('menu-manage-sections-move-down-Entrees-Curries'));
    expect(onReorderSubCategory).toHaveBeenCalledWith('menu-1', 'Entrees', ['Grills', 'Curries', 'Breads']);
  });

  it('▲ is disabled on the first row and ▼ on the last', () => {
    renderModal();
    expect((screen.getByTestId('menu-manage-sections-move-up-Entrees-Curries') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('menu-manage-sections-move-down-Entrees-Breads') as HTMLButtonElement).disabled).toBe(true);
  });

  it('hides the arrows when reordering is not wired', () => {
    renderModal({ onReorderSubCategory: undefined });
    expect(screen.queryByTestId('menu-manage-sections-move-up-Entrees-Curries')).toBeNull();
  });

  it('the create box uses the prefixed id and the shared onCreateSubCategory write', () => {
    const { onCreateSubCategory } = renderModal();
    fireEvent.click(screen.getByTestId('menu-manage-sections-subcategory-create-add-Entrees'));
    const input = screen.getByTestId('menu-manage-sections-subcategory-create-input-Entrees');
    fireEvent.change(input, { target: { value: 'Tandoor' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCreateSubCategory).toHaveBeenCalledWith('menu-1', 'Entrees', 'Tandoor');
    // The header's un-prefixed id must NOT be claimed by the dialog.
    expect(screen.queryByTestId('subcategory-create-add-Entrees')).toBeNull();
  });

  it('closes on Done, the ✕, the scrim and Escape', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByTestId('menu-manage-sections-done'));
    fireEvent.click(screen.getByTestId('menu-manage-sections-close'));
    fireEvent.click(screen.getByTestId('menu-manage-sections-scrim'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(4);
  });
});

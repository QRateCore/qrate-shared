// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ItemPlacementModal } from '../ItemPlacementModal';
import { UNGROUPED_KEY } from '../../lib/menuUtils';

const labels = [
  { label: 'Tacos', item_count: 3 },
  { label: 'Burritos', item_count: 1 },
];

const CATEGORIES = [
  'Beverages', 'Appetizers', 'Soups', 'Salads',
  'Sides', 'Breads', 'Entrees', 'Desserts',
] as const;

function setupLocked(over: Partial<React.ComponentProps<typeof ItemPlacementModal>> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ItemPlacementModal
      open
      lockedCategory="Entrees"
      itemCount={2}
      selectionLabel="2 items"
      labels={labels}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...over}
    />,
  );
  return { onConfirm, onCancel };
}

function setupCategory(over: Partial<React.ComponentProps<typeof ItemPlacementModal>> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ItemPlacementModal
      open
      categories={CATEGORIES}
      itemCount={1}
      selectionLabel="Garlic Naan"
      testid="category-selection-modal"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...over}
    />,
  );
  return { onConfirm, onCancel };
}

describe('ItemPlacementModal — locked-category (course/sub-category drop)', () => {
  it('does not render when closed', () => {
    const { container } = render(
      <ItemPlacementModal
        open={false}
        lockedCategory="Entrees"
        itemCount={1}
        selectionLabel="x"
        labels={labels}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('selecting an existing sub-category then confirming files under it', () => {
    const { onConfirm } = setupLocked();
    fireEvent.click(screen.getByTestId('subcategory-pick-option-Tacos'));
    fireEvent.click(screen.getByTestId('category-modal-confirm'));
    expect(onConfirm).toHaveBeenCalledWith({ category: 'Entrees', subLabel: 'Tacos' });
  });

  it('creating a novel sub-category confirms the trimmed value', () => {
    const { onConfirm } = setupLocked();
    fireEvent.change(screen.getByTestId('subcategory-pick-input'), { target: { value: '  Quesadillas ' } });
    fireEvent.click(screen.getByTestId('category-modal-confirm'));
    expect(onConfirm).toHaveBeenCalledWith({ category: 'Entrees', subLabel: 'Quesadillas' });
  });

  it('blocks confirm when the typed name exactly matches an existing label (case-insensitive)', () => {
    setupLocked();
    fireEvent.change(screen.getByTestId('subcategory-pick-input'), { target: { value: 'tacos' } });
    expect(screen.getByTestId('category-modal-confirm')).toBeDisabled();
  });

  it('"No sub-category" confirms with the ungrouped sentinel', () => {
    const { onConfirm } = setupLocked();
    fireEvent.click(screen.getByTestId('subcategory-pick-ungrouped'));
    fireEvent.click(screen.getByTestId('category-modal-confirm'));
    expect(onConfirm).toHaveBeenCalledWith({ category: 'Entrees', subLabel: UNGROUPED_KEY });
  });

  it('cancels via the X and the overlay', () => {
    const { onCancel } = setupLocked();
    fireEvent.click(screen.getByTestId('category-modal-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('ItemPlacementModal — category mode (off-menu rec/includes drop)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders all provided categories as pills, none pre-selected', () => {
    setupCategory();
    CATEGORIES.forEach((cat) => {
      const pill = screen.getByTestId(`category-pill-${cat}`);
      expect(pill).toBeInTheDocument();
      expect(pill).toHaveAttribute('aria-checked', 'false');
    });
  });

  it('disables Confirm until a category is chosen, then enables it', () => {
    setupCategory();
    expect(screen.getByTestId('category-modal-confirm')).toBeDisabled();
    fireEvent.click(screen.getByTestId('category-pill-Appetizers'));
    expect(screen.getByTestId('category-modal-confirm')).toBeEnabled();
  });

  it('is single-select — picking a second category replaces the first', () => {
    setupCategory();
    fireEvent.click(screen.getByTestId('category-pill-Appetizers'));
    fireEvent.click(screen.getByTestId('category-pill-Sides'));
    expect(screen.getByTestId('category-pill-Appetizers')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('category-pill-Sides')).toHaveAttribute('aria-checked', 'true');
  });

  it('confirms with the chosen category and the ungrouped sub-label by default', () => {
    const { onConfirm } = setupCategory();
    fireEvent.click(screen.getByTestId('category-pill-Sides'));
    fireEvent.click(screen.getByTestId('category-modal-confirm'));
    expect(onConfirm).toHaveBeenCalledWith({ category: 'Sides', subLabel: UNGROUPED_KEY });
  });

  it('renders inline error text with role=alert when error is set', () => {
    setupCategory({ error: 'Network error — please retry.' });
    const errorEl = screen.getByTestId('category-modal-error');
    expect(errorEl).toHaveTextContent('Network error — please retry.');
    expect(errorEl).toHaveAttribute('role', 'alert');
  });

  it('disables confirm, cancel, and pills while pending', () => {
    setupCategory({ pending: true });
    expect(screen.getByTestId('category-modal-confirm')).toBeDisabled();
    expect(screen.getByTestId('category-modal-cancel')).toBeDisabled();
    expect(screen.getByTestId('category-pill-Appetizers')).toBeDisabled();
  });

  it('does not render when open is false', () => {
    setupCategory({ open: false });
    expect(screen.queryByTestId('category-selection-modal')).not.toBeInTheDocument();
  });
});

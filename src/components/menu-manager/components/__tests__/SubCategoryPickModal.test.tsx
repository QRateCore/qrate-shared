// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SubCategoryPickModal } from '../SubCategoryPickModal';
import { UNGROUPED_KEY } from '../../lib/menuUtils';

const labels = [
  { label: 'Tacos', item_count: 3 },
  { label: 'Burritos', item_count: 1 },
];

function setup(over: Partial<React.ComponentProps<typeof SubCategoryPickModal>> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <SubCategoryPickModal
      open
      category="Entrees"
      itemCount={2}
      labels={labels}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...over}
    />,
  );
  return { onConfirm, onCancel };
}

describe('SubCategoryPickModal', () => {
  it('does not render when closed', () => {
    const { container } = render(
      <SubCategoryPickModal open={false} category="Entrees" itemCount={1} labels={labels} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('lists existing labels with counts and confirms the picked one', () => {
    const { onConfirm } = setup();
    fireEvent.click(screen.getByTestId('subcategory-pick-option-Tacos'));
    expect(onConfirm).toHaveBeenCalledWith('Tacos');
  });

  it('offers create for a novel query and confirms the trimmed value', () => {
    const { onConfirm } = setup();
    fireEvent.change(screen.getByTestId('subcategory-pick-input'), { target: { value: '  Quesadillas ' } });
    fireEvent.click(screen.getByTestId('subcategory-pick-create'));
    expect(onConfirm).toHaveBeenCalledWith('Quesadillas');
  });

  it('does NOT offer create when the query exactly matches an existing label (case-insensitive)', () => {
    setup();
    fireEvent.change(screen.getByTestId('subcategory-pick-input'), { target: { value: 'tacos' } });
    expect(screen.queryByTestId('subcategory-pick-create')).toBeNull();
  });

  it('Ungrouped option confirms with the sentinel', () => {
    const { onConfirm } = setup();
    fireEvent.click(screen.getByTestId('subcategory-pick-ungrouped'));
    expect(onConfirm).toHaveBeenCalledWith(UNGROUPED_KEY);
  });

  it('cancels via the overlay and the X', () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByTestId('subcategory-pick-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });
});

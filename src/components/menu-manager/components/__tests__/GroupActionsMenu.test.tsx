// @vitest-environment jsdom
/**
 * GroupActionsMenu — `[⋮]` dropdown tests (BYO PDD Step 7).
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GroupActionsMenu from '../GroupActionsMenu';

describe('GroupActionsMenu', () => {
  it('opens the menu on trigger click', () => {
    render(
      <GroupActionsMenu
        isDeletable={true}
        onRenameClick={vi.fn()}
        onChangeRuleClick={vi.fn()}
        onDeleteClick={vi.fn()}
      />
    );
    expect(screen.queryByTestId('group-actions-menu')).toBeNull();
    fireEvent.click(screen.getByTestId('group-actions-trigger'));
    expect(screen.getByTestId('group-actions-menu')).toBeInTheDocument();
  });

  it('fires onRenameClick when Rename is clicked', () => {
    const onRenameClick = vi.fn();
    render(
      <GroupActionsMenu
        isDeletable={true}
        onRenameClick={onRenameClick}
        onChangeRuleClick={vi.fn()}
        onDeleteClick={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('group-actions-trigger'));
    fireEvent.click(screen.getByTestId('group-actions-rename'));
    expect(onRenameClick).toHaveBeenCalled();
  });

  it('fires onChangeRuleClick when Change rule is clicked', () => {
    const onChangeRuleClick = vi.fn();
    render(
      <GroupActionsMenu
        isDeletable={true}
        onRenameClick={vi.fn()}
        onChangeRuleClick={onChangeRuleClick}
        onDeleteClick={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('group-actions-trigger'));
    fireEvent.click(screen.getByTestId('group-actions-change-rule'));
    expect(onChangeRuleClick).toHaveBeenCalled();
  });

  it('disables Delete when isDeletable=false', () => {
    const onDeleteClick = vi.fn();
    render(
      <GroupActionsMenu
        isDeletable={false}
        onRenameClick={vi.fn()}
        onChangeRuleClick={vi.fn()}
        onDeleteClick={onDeleteClick}
      />
    );
    fireEvent.click(screen.getByTestId('group-actions-trigger'));
    const deleteBtn = screen.getByTestId('group-actions-delete');
    expect(deleteBtn).toHaveProperty('disabled', true);
    fireEvent.click(deleteBtn);
    expect(onDeleteClick).not.toHaveBeenCalled();
  });

  it('shows tooltip on disabled Delete', () => {
    render(
      <GroupActionsMenu
        isDeletable={false}
        deleteDisabledTooltip="Cannot delete defaults"
        onRenameClick={vi.fn()}
        onChangeRuleClick={vi.fn()}
        onDeleteClick={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('group-actions-trigger'));
    const deleteBtn = screen.getByTestId('group-actions-delete');
    expect(deleteBtn.getAttribute('title')).toBe('Cannot delete defaults');
  });

  it('fires onDeleteClick when isDeletable=true', () => {
    const onDeleteClick = vi.fn();
    render(
      <GroupActionsMenu
        isDeletable={true}
        onRenameClick={vi.fn()}
        onChangeRuleClick={vi.fn()}
        onDeleteClick={onDeleteClick}
      />
    );
    fireEvent.click(screen.getByTestId('group-actions-trigger'));
    fireEvent.click(screen.getByTestId('group-actions-delete'));
    expect(onDeleteClick).toHaveBeenCalled();
  });
});

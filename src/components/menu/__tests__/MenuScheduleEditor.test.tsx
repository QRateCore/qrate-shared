// @vitest-environment jsdom
/**
 * Unit tests for MenuScheduleEditor.
 *
 * MenuScheduleEditor is a pure presentational component — no service context
 * required. All state is managed by the parent via callbacks.
 *
 * Covers:
 *  - All-day mode: single toggle visible; day rows hidden when allDay=true
 *  - Day rows: all 7 days rendered when allDay=false
 *  - Inactive day: row without start/end inputs visible
 *  - Active day: start and end time inputs visible when day is in schedule
 *  - onToggleAllDay callback fires when all-day toggle clicked
 *  - onToggleDay callback fires with correct day index when a day toggle clicked
 *  - onUpdateTime fires with correct day, field, and value on time input change
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MenuScheduleEditor } from '../MenuScheduleEditor';
import type { MenuSchedule } from '../../../types/restaurant';

// ── Factories ─────────────────────────────────────────────────────────────────

const EMPTY_SCHEDULE: MenuSchedule = {};

const WEEKDAY_SCHEDULE: MenuSchedule = {
  '1': { start: '09:00', end: '17:00' }, // Monday
  '2': { start: '09:00', end: '17:00' }, // Tuesday
  '3': { start: '09:00', end: '17:00' }, // Wednesday
  '4': { start: '09:00', end: '17:00' }, // Thursday
  '5': { start: '09:00', end: '17:00' }, // Friday
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MenuScheduleEditor — all-day mode', () => {
  it('renders the all-day toggle', () => {
    render(
      <MenuScheduleEditor
        allDay={true}
        schedule={EMPTY_SCHEDULE}
        onToggleAllDay={vi.fn()}
        onToggleDay={vi.fn()}
        onUpdateTime={vi.fn()}
      />,
    );
    expect(screen.getByText('Available all day, every day')).toBeInTheDocument();
  });

  it('hides day rows when allDay is true', () => {
    render(
      <MenuScheduleEditor
        allDay={true}
        schedule={WEEKDAY_SCHEDULE}
        onToggleAllDay={vi.fn()}
        onToggleDay={vi.fn()}
        onUpdateTime={vi.fn()}
      />,
    );
    // No day labels visible in all-day mode
    expect(screen.queryByText('Monday')).not.toBeInTheDocument();
    expect(screen.queryByText('Sunday')).not.toBeInTheDocument();
  });

  it('shows day rows when allDay is false', () => {
    render(
      <MenuScheduleEditor
        allDay={false}
        schedule={EMPTY_SCHEDULE}
        onToggleAllDay={vi.fn()}
        onToggleDay={vi.fn()}
        onUpdateTime={vi.fn()}
      />,
    );
    expect(screen.getByText('Sunday')).toBeInTheDocument();
    expect(screen.getByText('Monday')).toBeInTheDocument();
    expect(screen.getByText('Saturday')).toBeInTheDocument();
  });

  it('calls onToggleAllDay when the all-day toggle button is clicked', async () => {
    const user = userEvent.setup();
    const onToggleAllDay = vi.fn();
    render(
      <MenuScheduleEditor
        allDay={false}
        schedule={EMPTY_SCHEDULE}
        onToggleAllDay={onToggleAllDay}
        onToggleDay={vi.fn()}
        onUpdateTime={vi.fn()}
      />,
    );

    // The all-day toggle is the first button in the component
    const toggles = screen.getAllByRole('button');
    await user.click(toggles[0]);

    expect(onToggleAllDay).toHaveBeenCalledTimes(1);
  });
});

describe('MenuScheduleEditor — day rows', () => {
  it('renders all 7 day labels', () => {
    render(
      <MenuScheduleEditor
        allDay={false}
        schedule={EMPTY_SCHEDULE}
        onToggleAllDay={vi.fn()}
        onToggleDay={vi.fn()}
        onUpdateTime={vi.fn()}
      />,
    );
    for (const day of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) {
      expect(screen.getByText(day)).toBeInTheDocument();
    }
  });

  it('shows no time inputs for inactive days (not in schedule)', () => {
    render(
      <MenuScheduleEditor
        allDay={false}
        schedule={EMPTY_SCHEDULE}
        onToggleAllDay={vi.fn()}
        onToggleDay={vi.fn()}
        onUpdateTime={vi.fn()}
      />,
    );
    // No time inputs when no days are active
    const timeInputs = screen.queryAllByDisplayValue(/^\d{2}:\d{2}$/);
    expect(timeInputs).toHaveLength(0);
  });

  it('shows start and end time inputs for each active day in the schedule', () => {
    render(
      <MenuScheduleEditor
        allDay={false}
        schedule={{ '1': { start: '08:00', end: '16:00' } }}
        onToggleAllDay={vi.fn()}
        onToggleDay={vi.fn()}
        onUpdateTime={vi.fn()}
      />,
    );
    // Monday is active → 2 time inputs visible
    const timeInputs = screen.getAllByDisplayValue(/^(08:00|16:00)$/);
    expect(timeInputs).toHaveLength(2);
  });

  it('shows 10 time inputs when 5 weekdays are active (2 per day)', () => {
    render(
      <MenuScheduleEditor
        allDay={false}
        schedule={WEEKDAY_SCHEDULE}
        onToggleAllDay={vi.fn()}
        onToggleDay={vi.fn()}
        onUpdateTime={vi.fn()}
      />,
    );
    // 5 active days × 2 inputs each = 10 time inputs
    const timeInputs = screen.getAllByDisplayValue(/^09:00|17:00$/);
    expect(timeInputs.length).toBeGreaterThanOrEqual(10);
  });
});

describe('MenuScheduleEditor — callbacks', () => {
  it('calls onToggleDay with correct index when a day toggle is clicked', async () => {
    const user = userEvent.setup();
    const onToggleDay = vi.fn();
    render(
      <MenuScheduleEditor
        allDay={false}
        schedule={EMPTY_SCHEDULE}
        onToggleAllDay={vi.fn()}
        onToggleDay={onToggleDay}
        onUpdateTime={vi.fn()}
      />,
    );

    // Buttons: [allDay toggle, Sun toggle, Mon toggle, Tue toggle, ...]
    // Index 0 = allDay, Index 1 = Sunday (day 0), Index 2 = Monday (day 1)
    const allButtons = screen.getAllByRole('button');
    // Click Monday toggle — 3rd button (index 2 in the button list)
    await user.click(allButtons[2]); // Monday = day index 1

    expect(onToggleDay).toHaveBeenCalledWith(1);
  });

  it('calls onUpdateTime with correct args when start time changed', () => {
    const onUpdateTime = vi.fn();
    render(
      <MenuScheduleEditor
        allDay={false}
        schedule={{ '1': { start: '09:00', end: '17:00' } }}
        onToggleAllDay={vi.fn()}
        onToggleDay={vi.fn()}
        onUpdateTime={onUpdateTime}
      />,
    );

    const [startInput] = screen.getAllByDisplayValue(/09:00|17:00/);
    fireEvent.change(startInput, { target: { value: '08:30' } });

    // Monday is day index 1; start field changed
    expect(onUpdateTime).toHaveBeenCalledWith(1, 'start', '08:30');
  });

  it('calls onUpdateTime with "end" field when end time input changed', () => {
    const onUpdateTime = vi.fn();
    render(
      <MenuScheduleEditor
        allDay={false}
        schedule={{ '1': { start: '09:00', end: '17:00' } }}
        onToggleAllDay={vi.fn()}
        onToggleDay={vi.fn()}
        onUpdateTime={onUpdateTime}
      />,
    );

    // Second time input for Monday is the end time
    const timeInputs = screen.getAllByDisplayValue(/09:00|17:00/);
    const endInput = timeInputs[1]; // [start, end]
    fireEvent.change(endInput, { target: { value: '18:00' } });

    expect(onUpdateTime).toHaveBeenCalledWith(1, 'end', '18:00');
  });
});

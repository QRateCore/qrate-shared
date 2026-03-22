'use client';

import type { MenuSchedule } from '../../types/restaurant';

const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function Toggle({ checked, onChange, size = 'md' }: { checked: boolean; onChange: () => void; size?: 'sm' | 'md' }) {
  const dims = size === 'sm'
    ? { track: 'w-9 h-5', thumb: 'w-4 h-4', translate: 'translate-x-4' }
    : { track: 'w-11 h-6', thumb: 'w-5 h-5', translate: 'translate-x-5' };
  return (
    <button
      onClick={onChange}
      className={`relative ${dims.track} rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-orange-500' : 'bg-gray-300'}`}
    >
      <span className={`absolute top-0.5 left-0.5 ${dims.thumb} bg-white rounded-full transition-transform shadow ${checked ? dims.translate : ''}`} />
    </button>
  );
}

export interface MenuScheduleEditorProps {
  allDay: boolean;
  schedule: MenuSchedule;
  onToggleAllDay: () => void;
  onToggleDay: (day: number) => void;
  onUpdateTime: (day: number, field: 'start' | 'end', value: string) => void;
}

export function MenuScheduleEditor({ allDay, schedule, onToggleAllDay, onToggleDay, onUpdateTime }: MenuScheduleEditorProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-gray-600">Available all day, every day</span>
        <Toggle checked={allDay} onChange={onToggleAllDay} />
      </div>

      {!allDay && (
        <div className="space-y-1.5">
          {DAYS_FULL.map((label, i) => {
            const key = String(i);
            const active = key in schedule;
            const entry = schedule[key];
            return (
              <div key={i} className={`rounded-lg transition-colors ${active ? 'bg-orange-50 border border-orange-100' : 'bg-gray-50 border border-transparent'}`}>
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className={`text-sm font-medium w-24 ${active ? 'text-gray-900' : 'text-gray-400'}`}>{label}</span>
                  {active && entry && (
                    <div className="flex items-center gap-1.5 flex-1 justify-end mr-3">
                      <input type="time" value={entry.start} onChange={(e) => onUpdateTime(i, 'start', e.target.value)}
                        className="border border-gray-200 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-orange-300 w-[100px]" />
                      <span className="text-gray-400 text-xs">–</span>
                      <input type="time" value={entry.end} onChange={(e) => onUpdateTime(i, 'end', e.target.value)}
                        className="border border-gray-200 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-orange-300 w-[100px]" />
                    </div>
                  )}
                  <Toggle checked={active} onChange={() => onToggleDay(i)} size="sm" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

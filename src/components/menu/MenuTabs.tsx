'use client';

import { useState } from 'react';
import type { MenuSummary, MenuSchedule } from '../../types/restaurant';
import { MenuScheduleEditor } from './MenuScheduleEditor';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MenuEditState {
  name: string;
  active: boolean;
  allDay: boolean;
  schedule: MenuSchedule;
  dirty: boolean;
}

export interface MenuTabsProps {
  menus: MenuSummary[];
  editState: Record<string, MenuEditState>;
  activeTabId: string | null;
  isCreating: boolean;
  saving: boolean;
  error: string | null;

  onSelectTab: (id: string) => void;
  onStartCreate: () => void;
  onCancelCreate: () => void;
  onUpdateField: (menuId: string, updates: Partial<MenuEditState>) => void;
  onToggleDay: (menuId: string, day: number) => void;
  onUpdateDayTime: (menuId: string, day: number, field: 'start' | 'end', value: string) => void;
  onSave: (menuId: string) => void;
  onDelete: (menuId: string) => void;
  onDismissError: () => void;

  // Create form callbacks
  createName: string;
  createAllDay: boolean;
  createSchedule: MenuSchedule;
  onCreateNameChange: (name: string) => void;
  onCreateToggleAllDay: () => void;
  onCreateToggleDay: (day: number) => void;
  onCreateUpdateDayTime: (day: number, field: 'start' | 'end', value: string) => void;
  onCreate: () => void;

  // Optional: navigate to items editor
  onEditItems?: (menuId: string) => void;
}

// ─── Mini Toggle ────────────────────────────────────────────────────────────

function MiniToggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      className={`relative w-9 h-5 rounded-full transition-colors ${checked ? 'bg-green-500' : 'bg-gray-300'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow ${checked ? 'translate-x-4' : ''}`} />
    </button>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export function MenuTabs({
  menus, editState, activeTabId, isCreating, saving, error,
  onSelectTab, onStartCreate, onCancelCreate,
  onUpdateField, onToggleDay, onUpdateDayTime, onSave, onDelete, onDismissError,
  createName, createAllDay, createSchedule,
  onCreateNameChange, onCreateToggleAllDay, onCreateToggleDay, onCreateUpdateDayTime, onCreate,
  onEditItems,
}: MenuTabsProps) {
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const activeMenu = menus.find(m => m.id === activeTabId) || null;
  const activeEdit = activeTabId ? editState[activeTabId] : null;

  return (
    <div>
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-red-700 text-sm">
          {error}
          <button onClick={onDismissError} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center border-b border-gray-200 gap-0 overflow-x-auto">
        {menus.map((menu) => (
          <button
            key={menu.id}
            onClick={() => { onSelectTab(menu.id); setDeleteConfirm(false); }}
            className={`px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTabId === menu.id && !isCreating
                ? 'border-orange-500 text-orange-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {menu.name}
            {!menu.active && (
              <span className="ml-2 text-xs text-gray-400 font-normal">(inactive)</span>
            )}
          </button>
        ))}
        {isCreating && (
          <button className="px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 border-orange-500 text-orange-600">
            New Menu
          </button>
        )}
        <button
          onClick={() => { onStartCreate(); setDeleteConfirm(false); }}
          className="px-4 py-3 text-sm text-gray-400 hover:text-orange-600 whitespace-nowrap border-b-2 border-transparent transition-colors"
        >
          +
        </button>
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-b-xl shadow-sm">
        {/* Create form */}
        {isCreating && (
          <div className="p-6 space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Menu Name</label>
              <input
                type="text"
                value={createName}
                onChange={(e) => onCreateNameChange(e.target.value)}
                placeholder="e.g. Lunch, Dinner, Brunch"
                className="w-full max-w-sm border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-3">Schedule</label>
              <MenuScheduleEditor
                allDay={createAllDay}
                schedule={createSchedule}
                onToggleAllDay={onCreateToggleAllDay}
                onToggleDay={onCreateToggleDay}
                onUpdateTime={onCreateUpdateDayTime}
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={onCreate}
                disabled={saving || !createName.trim()}
                className="px-5 py-2.5 bg-orange-600 text-white rounded-lg text-sm font-semibold hover:bg-orange-700 transition-colors disabled:opacity-50"
              >
                {saving ? 'Creating...' : 'Create Menu'}
              </button>
              <button
                onClick={onCancelCreate}
                className="px-5 py-2.5 text-gray-600 text-sm font-medium hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Existing menu tab content */}
        {!isCreating && activeMenu && activeEdit && (
          <div className="p-6 space-y-6">
            {/* Top row: name, active toggle, items button */}
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-sm font-medium text-gray-700 mb-1">Menu Name</label>
                <input
                  type="text"
                  value={activeEdit.name}
                  onChange={(e) => onUpdateField(activeMenu.id, { name: e.target.value })}
                  className="w-full max-w-sm border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-600">Active</span>
                <MiniToggle
                  checked={activeEdit.active}
                  onChange={() => onUpdateField(activeMenu.id, { active: !activeEdit.active })}
                />
              </div>
              {onEditItems && (
                <button
                  onClick={() => onEditItems(activeMenu.id)}
                  className="px-4 py-2 bg-orange-100 text-orange-700 rounded-lg text-sm font-semibold hover:bg-orange-200 transition-colors"
                >
                  Edit Items ({activeMenu.item_count})
                </button>
              )}
            </div>

            {/* Schedule */}
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-3">Serving Hours</label>
              <MenuScheduleEditor
                allDay={activeEdit.allDay}
                schedule={activeEdit.schedule}
                onToggleAllDay={() => {
                  if (activeEdit.allDay) {
                    const sched: MenuSchedule = {};
                    for (let i = 0; i < 7; i++) sched[String(i)] = { start: '09:00', end: '22:00' };
                    onUpdateField(activeMenu.id, { allDay: false, schedule: sched });
                  } else {
                    onUpdateField(activeMenu.id, { allDay: true, schedule: {} });
                  }
                }}
                onToggleDay={(day) => onToggleDay(activeMenu.id, day)}
                onUpdateTime={(day, field, value) => onUpdateDayTime(activeMenu.id, day, field, value)}
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => onSave(activeMenu.id)}
                  disabled={saving || !activeEdit.dirty || !activeEdit.name.trim()}
                  className="px-5 py-2.5 bg-orange-600 text-white rounded-lg text-sm font-semibold hover:bg-orange-700 transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
                {activeEdit.dirty && (
                  <span className="text-xs text-orange-500">Unsaved changes</span>
                )}
              </div>
              <div>
                {!deleteConfirm ? (
                  <button
                    onClick={() => setDeleteConfirm(true)}
                    className="px-4 py-2 text-red-600 text-sm font-medium hover:bg-red-50 rounded-lg transition-colors"
                  >
                    Delete Menu
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-red-600">Are you sure?</span>
                    <button
                      onClick={() => { onDelete(activeMenu.id); setDeleteConfirm(false); }}
                      disabled={saving}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-50"
                    >
                      {saving ? 'Deleting...' : 'Confirm'}
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(false)}
                      className="px-4 py-2 text-gray-600 text-sm font-medium hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

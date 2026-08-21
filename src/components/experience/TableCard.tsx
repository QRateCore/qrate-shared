'use client';

/**
 * NOTE: NOT rendered by ExperienceManagement. That page builds its table
 * cards inline; this component is exported from the barrel for other
 * consumers. A change made here will NOT appear on the Service page — the
 * markup to edit is in ExperienceManagement's tables grid.
 */
import { Bell, Eye, Star } from 'lucide-react';
import type { RestaurantTable, TableActivityEntry, WaiterCall } from '../../types/experience';
import { allergenColor } from './table-utils';
import { formatTagLabel } from '../../utils/labelFormat';

export interface TableCardProps {
  table: RestaurantTable;
  activity?: TableActivityEntry | null;
  activeCall?: WaiterCall | null;
  newOrderCount?: number;
  hasCarts?: boolean;
  onClick: () => void;
  onAcknowledgeCall?: (callId: string) => void;
}

export default function TableCard({
  table,
  activity,
  activeCall,
  newOrderCount = 0,
  hasCarts = false,
  onClick,
  onAcknowledgeCall,
}: TableCardProps) {
  const borderClass = activeCall
    ? 'bg-red-50 border-red-300 ring-1 ring-red-200'
    : activity?.needs_attention
    ? 'bg-amber-50 border-amber-300 ring-1 ring-amber-200'
    : activity?.has_active_session
    ? 'bg-white border-red-400'
    : 'bg-white border-green-400 hover:border-green-500 active:bg-gray-50';

  return (
    <div
      onClick={onClick}
      className={`border-2 rounded-xl p-3 transition-colors relative cursor-pointer ${borderClass}`}
    >
      {/* Service request badge */}
      {activeCall && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAcknowledgeCall?.(activeCall.id);
          }}
          className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full px-2 py-0.5 text-xs font-bold flex items-center gap-1 animate-pulse shadow-md"
        >
          <Bell className="h-3 w-3" />
          Calling
        </button>
      )}

      {/* New order badge (orange) */}
      {!activeCall && newOrderCount > 0 && (
        <div className="absolute -top-2 -right-2 bg-orange-500 text-white rounded-full px-2 py-0.5 text-xs font-bold shadow-md">
          {newOrderCount} new
        </div>
      )}

      {/* Browsing badge */}
      {!activeCall && newOrderCount === 0 && hasCarts && (
        <div className="absolute -top-2 -left-2 bg-blue-500 text-white rounded-full px-2 py-0.5 text-xs font-bold flex items-center gap-1 shadow-md">
          <Eye className="h-3 w-3" />
          Browsing
        </div>
      )}

      {/* Table number + label */}
      <div className="text-subtitle text-gray-900 flex items-center justify-center gap-1.5">
        Table {table.table_number}
        {table.pos_linked && (
          /* Marks a table whose name and identity belong to the POS. Renaming
             it here does not rename it there, and the next import puts the POS
             name back — so an operator should see that before editing. */
          <span
            data-testid={`table-pos-badge-${table.table_number}`}
            title={`From the POS floor plan${table.pos_table_name ? ` — "${table.pos_table_name}"` : ''}. Its name is managed there, not here.`}
            className="inline-flex items-center rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700 ring-1 ring-inset ring-indigo-200"
          >
            POS
          </span>
        )}
      </div>
      {(table.pos_table_name || table.table_label) && (
        <div className="text-xs text-gray-500 mt-0.5">
          {table.pos_table_name || table.table_label}
        </div>
      )}

      {/* Guest names */}
      {activity && activity.guests.length > 0 ? (
        <div className="space-y-0.5 mt-2">
          {activity.guests.slice(0, 3).map((guest, i) => {
            const isIdle = guest.idle || guest.connected === false;
            const idleLabel =
              isIdle && guest.idle_since
                ? (() => {
                    const mins = Math.floor(
                      (Date.now() - new Date(guest.idle_since).getTime()) / 60000
                    );
                    return mins < 1 ? 'just now' : `${mins}m`;
                  })()
                : null;
            return (
              <div key={i} className="flex items-center gap-1">
                {guest.is_first_timer && (
                  <Star className="h-3 w-3 text-yellow-500 flex-shrink-0" fill="currentColor" />
                )}
                {isIdle && (
                  <span
                    className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0"
                    title={idleLabel ? `Idle ${idleLabel}` : 'Phone away'}
                  />
                )}
                <span title={guest.name || 'Guest'} className={`text-xs truncate ${isIdle ? 'text-gray-400 italic' : 'text-gray-600'}`}>
                  {guest.name || 'Guest'}
                  {idleLabel && <span className="text-gray-300 ml-0.5">({idleLabel})</span>}
                </span>
                {guest.allergens.map((a, j) => (
                  <span
                    key={j}
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: allergenColor(a) }}
                    title={formatTagLabel(a)}
                  />
                ))}
              </div>
            );
          })}
          {activity.guests.length > 3 && (
            <span className="text-xs text-gray-400">+{activity.guests.length - 3} more</span>
          )}
        </div>
      ) : (
        <p className="text-xs text-gray-400 mt-2">No guests</p>
      )}
    </div>
  );
}

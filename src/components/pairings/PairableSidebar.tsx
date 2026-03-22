'use client';

import { useState, useMemo } from 'react';
import { Search, GripVertical, Check, Plus } from 'lucide-react';
import type { MenuItem } from '../../types';
import { getCategoryColor } from './categoryUtils';

interface PairableSidebarProps {
  items: MenuItem[];
  pairedItemIds: Set<string>;
  isTouchDevice: boolean;
  onAddPairing: (itemId: string) => void;
}

export default function PairableSidebar({ items, pairedItemIds, isTouchDevice, onAddPairing }: PairableSidebarProps) {
  const [search, setSearch] = useState('');

  const grouped = useMemo(() => {
    const filtered = items.filter(i =>
      i.name.toLowerCase().includes(search.toLowerCase())
    );
    const groups: Record<string, MenuItem[]> = {};
    filtered.forEach(item => {
      const cat = item.category || 'Uncategorized';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    });
    return groups;
  }, [items, search]);

  const handleDragStart = (e: React.DragEvent, itemId: string) => {
    e.dataTransfer.setData('text/plain', itemId);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="pairable-sidebar">
      <div className="pairable-sidebar-header">
        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
          Available Items
        </h3>
        <div className="pairable-sidebar-search">
          <Search size={14} style={{ color: 'var(--text3)', flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Search items..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="pairable-sidebar-list">
        {Object.keys(grouped).length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>
            No items found
          </div>
        )}
        {Object.entries(grouped).map(([category, catItems]) => {
          const catColor = getCategoryColor(category);
          return (
            <div key={category} className="pairable-sidebar-group">
              <div
                className="pairable-sidebar-group-label"
                style={{ color: catColor.text }}
              >
                {category}
              </div>
              {catItems.map(item => {
                const isPaired = pairedItemIds.has(item.id);
                return (
                  <div
                    key={item.id}
                    className={`pairable-sidebar-item ${isPaired ? 'paired' : ''}`}
                    draggable={!isPaired && !isTouchDevice}
                    onDragStart={e => handleDragStart(e, item.id)}
                  >
                    {!isTouchDevice && !isPaired && (
                      <GripVertical size={14} className="pairable-sidebar-grip" />
                    )}
                    <div className="pairable-sidebar-item-thumb">
                      {item.thumbnail_url ? (
                        <img src={item.thumbnail_url} alt={item.name} draggable={false} />
                      ) : (
                        <span style={{ fontSize: 12 }}>🍽</span>
                      )}
                    </div>
                    <div className="pairable-sidebar-item-info">
                      <div className="pairable-sidebar-item-name">{item.name}</div>
                      {item.price != null && (
                        <div className="pairable-sidebar-item-price">
                          ${Number(item.price).toFixed(2)}
                        </div>
                      )}
                    </div>
                    {isPaired ? (
                      <Check size={14} style={{ color: '#16A34A', flexShrink: 0 }} />
                    ) : isTouchDevice ? (
                      <button
                        className="pairable-sidebar-add-btn"
                        onClick={() => onAddPairing(item.id)}
                        title="Add pairing"
                      >
                        <Plus size={14} />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

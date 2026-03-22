'use client';

import { memo, useState } from 'react';
import type { MenuItem } from '../../types';
import { getCategoryColor } from './categoryUtils';

interface HubCardProps {
  item: MenuItem;
  pairingCount: number;
  onDrop: (itemId: string) => void;
}

function HubCard({ item, pairingCount, onDrop }: HubCardProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const color = getCategoryColor(item.category);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const itemId = e.dataTransfer.getData('text/plain');
    if (itemId) {
      onDrop(itemId);
    }
  };

  return (
    <div
      className={`hub-card ${isDragOver ? 'hub-card-dragover' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="hub-card-drop-ring" />
      <div className="hub-card-inner">
        <div className="hub-card-thumb">
          {item.thumbnail_url ? (
            <img src={item.thumbnail_url} alt={item.name} draggable={false} />
          ) : (
            <div className="hub-card-thumb-placeholder">
              <span style={{ fontSize: 48 }}>🍽</span>
            </div>
          )}
        </div>
        <div className="hub-card-body">
          <div className="hub-card-name">{item.name}</div>
          <div className="hub-card-meta">
            <span
              className="hub-card-category"
              style={{ background: color.bg, color: color.text, borderColor: color.border }}
            >
              {item.category}
            </span>
            {item.price != null && (
              <span className="hub-card-price">${Number(item.price).toFixed(2)}</span>
            )}
          </div>
          <div className="hub-card-pairing-count">
            {pairingCount} pairing{pairingCount !== 1 ? 's' : ''}
          </div>
        </div>
      </div>
      {isDragOver && (
        <div className="hub-card-drop-hint">Drop to pair</div>
      )}
    </div>
  );
}

export default memo(HubCard);

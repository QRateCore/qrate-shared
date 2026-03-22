'use client';

import { memo } from 'react';
import type { MenuItem } from '../../types';
import { getCategoryColor } from './categoryUtils';

interface EntreeCardProps {
  item: MenuItem;
  pairingCount: number;
  onClick: () => void;
}

function EntreeCard({ item, pairingCount, onClick }: EntreeCardProps) {
  const color = getCategoryColor(item.category);

  return (
    <button className="entree-card" onClick={onClick}>
      <div className="entree-card-thumb">
        {item.thumbnail_url ? (
          <img src={item.thumbnail_url} alt={item.name} draggable={false} />
        ) : (
          <div className="entree-card-thumb-placeholder">
            <span style={{ fontSize: 32 }}>🍽</span>
          </div>
        )}
      </div>
      <div className="entree-card-body">
        <div className="entree-card-name">{item.name}</div>
        <div className="entree-card-meta">
          <span
            className="entree-card-category"
            style={{ background: color.bg, color: color.text, borderColor: color.border }}
          >
            {item.category}
          </span>
          {item.price != null && (
            <span className="entree-card-price">${Number(item.price).toFixed(2)}</span>
          )}
        </div>
        {pairingCount > 0 && (
          <div className="entree-card-pairing-count">
            {pairingCount} pairing{pairingCount !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </button>
  );
}

export default memo(EntreeCard);

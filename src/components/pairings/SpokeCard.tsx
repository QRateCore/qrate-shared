'use client';

import { memo } from 'react';
import { X } from 'lucide-react';
import type { MenuItem } from '../../types';
import { getCategoryColor } from './categoryUtils';

interface SpokeCardProps {
  item: MenuItem;
  strength: number;
  onDelete: () => void;
}

function SpokeCard({ item, strength, onDelete }: SpokeCardProps) {
  const color = getCategoryColor(item.category);

  return (
    <div className="spoke-card">
      <div className="spoke-card-thumb">
        {item.thumbnail_url ? (
          <img src={item.thumbnail_url} alt={item.name} draggable={false} />
        ) : (
          <div className="spoke-card-thumb-placeholder">
            <span style={{ fontSize: 18 }}>🍽</span>
          </div>
        )}
      </div>
      <div className="spoke-card-body">
        <div className="spoke-card-name">{item.name}</div>
        <div className="spoke-card-meta">
          <span
            className="spoke-card-category"
            style={{ background: color.bg, color: color.text, borderColor: color.border }}
          >
            {item.category}
          </span>
          <span className="spoke-card-stars">
            {'★'.repeat(strength)}{'☆'.repeat(5 - strength)}
          </span>
        </div>
      </div>
      <button className="spoke-card-delete" onClick={onDelete} title="Remove pairing">
        <X size={14} />
      </button>
    </div>
  );
}

export default memo(SpokeCard);

'use client';

import type { MenuItem } from '../../types';
import type { MenuPairing } from '../../types/pairing';
import EntreeCard from './EntreeCard';

interface EntreeGridProps {
  entrees: MenuItem[];
  pairings: MenuPairing[];
  onSelectEntree: (item: MenuItem) => void;
}

export default function EntreeGrid({ entrees, pairings, onSelectEntree }: EntreeGridProps) {
  const pairingCountByEntree = (entreeId: string) =>
    pairings.filter(p => p.item_a_id === entreeId || p.item_b_id === entreeId).length;

  if (entrees.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🍽️</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
          No entrees found
        </h2>
        <p style={{ fontSize: 14, color: 'var(--text2)' }}>
          Add entree-category items to your menu to start creating pairings.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: 0 }}>
          Menu Pairings
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text2)', marginTop: 4 }}>
          Select an entree to manage its pairings
        </p>
      </div>
      <div className="entree-grid">
        {entrees.map(item => (
          <EntreeCard
            key={item.id}
            item={item}
            pairingCount={pairingCountByEntree(item.id)}
            onClick={() => onSelectEntree(item)}
          />
        ))}
      </div>
    </div>
  );
}

'use client';

import { useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { MenuItem } from '../../types';
import type { MenuPairing } from '../../types/pairing';
import HubCard from './HubCard';
import SpokeCard from './SpokeCard';
import PairableSidebar from './PairableSidebar';

interface EntreeDetailProps {
  entree: MenuItem;
  menuItems: MenuItem[];
  pairings: MenuPairing[];
  nonEntrees: MenuItem[];
  onBack: () => void;
  onCreatePairing: (itemId: string) => void;
  onDeletePairing: (pairingId: string) => void;
}

export default function EntreeDetail({
  entree,
  menuItems,
  pairings,
  nonEntrees,
  onBack,
  onCreatePairing,
  onDeletePairing,
}: EntreeDetailProps) {
  const isTouchDevice = typeof window !== 'undefined' && 'ontouchstart' in window;

  const entreePairings = useMemo(() =>
    pairings.filter(p => p.item_a_id === entree.id || p.item_b_id === entree.id),
    [pairings, entree.id]
  );

  const itemsMap = useMemo(() =>
    Object.fromEntries(menuItems.map(i => [i.id, i])),
    [menuItems]
  );

  const spokeItems = useMemo(() =>
    entreePairings.map(p => {
      const pairedId = p.item_a_id === entree.id ? p.item_b_id : p.item_a_id;
      return { pairing: p, item: itemsMap[pairedId] };
    }).filter(s => s.item),
    [entreePairings, entree.id, itemsMap]
  );

  const pairedItemIds = useMemo(() =>
    new Set(spokeItems.map(s => s.item.id)),
    [spokeItems]
  );

  const useRadial = spokeItems.length <= 8;

  return (
    <div className="entree-detail">
      <div className="entree-detail-main">
        <button className="entree-detail-back" onClick={onBack}>
          <ArrowLeft size={18} />
          All Entrees
        </button>

        <div className="entree-detail-hub-area">
          <div className="entree-detail-hub-container">
            <HubCard
              item={entree}
              pairingCount={entreePairings.length}
              onDrop={onCreatePairing}
            />

            {useRadial && spokeItems.length > 0 && (
              <div className="entree-detail-spokes-radial">
                {spokeItems.map(({ pairing, item }, idx) => {
                  const angle = (2 * Math.PI * idx) / spokeItems.length - Math.PI / 2;
                  const radius = 240;
                  const x = Math.cos(angle) * radius;
                  const y = Math.sin(angle) * radius;
                  return (
                    <div
                      key={pairing.id}
                      className="entree-detail-spoke-wrapper"
                      style={{
                        transform: `translate(${x}px, ${y}px)`,
                      }}
                    >
                      <SpokeCard
                        item={item}
                        strength={pairing.strength}
                        onDelete={() => onDeletePairing(pairing.id)}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {!useRadial && spokeItems.length > 0 && (
            <div className="entree-detail-spokes-grid">
              {spokeItems.map(({ pairing, item }) => (
                <SpokeCard
                  key={pairing.id}
                  item={item}
                  strength={pairing.strength}
                  onDelete={() => onDeletePairing(pairing.id)}
                />
              ))}
            </div>
          )}

          {spokeItems.length === 0 && (
            <div style={{ textAlign: 'center', marginTop: 24, fontSize: 14, color: 'var(--text3)' }}>
              {isTouchDevice
                ? 'Use the sidebar to add pairings for this entree'
                : 'Drag items from the sidebar onto the entree to create pairings'}
            </div>
          )}
        </div>
      </div>

      <PairableSidebar
        items={nonEntrees}
        pairedItemIds={pairedItemIds}
        isTouchDevice={isTouchDevice}
        onAddPairing={onCreatePairing}
      />
    </div>
  );
}

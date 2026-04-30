'use client';

import type { MenuItemDisplay } from '../../types/restaurant';
import { PhoneFrame } from './PhoneFrame';

export interface CompositionPreviewPhoneProps {
  item: MenuItemDisplay;
}

interface MockSide {
  id: string;
  name: string;
  price_override: number | null;
}

interface MockAddon {
  id: string;
  name: string;
  price_override: number | null;
}

const MOCK_OR_SIDES: MockSide[] = [
  { id: 'mock-s1', name: 'Garden Salad', price_override: null },
  { id: 'mock-s2', name: 'Fries', price_override: null },
  { id: 'mock-s3', name: 'Coleslaw', price_override: null },
];

const MOCK_ADDONS: MockAddon[] = [
  { id: 'mock-a1', name: 'Extra Sauce', price_override: 1.5 },
  { id: 'mock-a2', name: 'Cheese', price_override: 2.0 },
];

function formatPrice(price: number | null): string {
  if (price === null) return 'Included';
  return `+$${price.toFixed(2)}`;
}

export function CompositionPreviewPhone({ item }: CompositionPreviewPhoneProps) {
  const realSides = (item.sides_or?.length || 0) + (item.sides_and?.length || 0);
  const realAddons = item.addons?.length || 0;
  const usingMock = realSides === 0 && realAddons === 0;

  const sides: MockSide[] = realSides > 0
    ? (item.sides_or || item.sides || []).map(s => ({
        id: s.menu_item_id,
        name: s.name ?? 'Side',
        price_override: typeof s.price_override === 'number' ? s.price_override : null,
      }))
    : MOCK_OR_SIDES;

  const addons: MockAddon[] = realAddons > 0
    ? (item.addons || []).map(a => ({
        id: a.menu_item_id,
        name: a.name ?? 'Add-on',
        price_override: typeof a.price_override === 'number' ? a.price_override : null,
      }))
    : MOCK_ADDONS;

  return (
    <PhoneFrame label="Dish Details">
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#0E0A08',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Hero image */}
        <div
          style={{
            height: 170,
            margin: '12px 12px 0 12px',
            borderRadius: 14,
            overflow: 'hidden',
            position: 'relative',
            flexShrink: 0,
          }}
        >
          {item.thumbnail_url ? (
            <img
              src={item.thumbnail_url}
              alt={item.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg, #f97316, #f59e0b)' }} />
          )}
          {/* Scrim + title overlay */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 50%)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              padding: '8px 10px',
            }}
          >
            <p
              style={{
                fontFamily: 'monospace',
                fontSize: 8,
                color: '#d4a84b',
                textTransform: 'uppercase',
                letterSpacing: '1.5px',
                margin: '0 0 2px 0',
              }}
            >
              Composing
            </p>
            <p
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: '#fff',
                margin: 0,
                lineHeight: 1.2,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {item.name}
            </p>
          </div>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflow: 'hidden', padding: '10px 12px 0 12px' }}>
          {/* Sides section */}
          <p
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: 'rgba(255,255,255,0.5)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              margin: '0 0 6px 0',
            }}
          >
            Choose a side
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
            {sides.map((side, i) => (
              <div
                key={side.id}
                style={{
                  fontSize: 10,
                  padding: '4px 9px',
                  borderRadius: 20,
                  border: `1.5px solid ${i === 0 ? '#d4a84b' : 'rgba(255,255,255,0.15)'}`,
                  color: i === 0 ? '#d4a84b' : 'rgba(255,255,255,0.55)',
                  background: i === 0 ? 'rgba(212,168,75,0.08)' : 'transparent',
                  fontWeight: i === 0 ? 600 : 400,
                }}
              >
                {side.name}
                {side.price_override !== null && (
                  <span style={{ marginLeft: 4, opacity: 0.7 }}>{formatPrice(side.price_override)}</span>
                )}
              </div>
            ))}
          </div>

          {/* Add-ons section */}
          <p
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: 'rgba(255,255,255,0.5)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              margin: '0 0 6px 0',
            }}
          >
            Add-ons
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {addons.map((addon) => (
              <div
                key={addon.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '5px 8px',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.8)' }}>{addon.name}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>
                    {formatPrice(addon.price_override)}
                  </span>
                  <div
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 3,
                      border: '1.5px solid rgba(255,255,255,0.2)',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Mock watermark */}
          {usingMock && (
            <p
              style={{
                fontSize: 8,
                color: 'rgba(255,255,255,0.25)',
                textAlign: 'center',
                marginTop: 8,
                fontStyle: 'italic',
              }}
            >
              Sample layout — configure sides &amp; add-ons to see real data
            </p>
          )}
        </div>

        {/* Add to Order bar */}
        <div
          style={{
            padding: '10px 12px',
            background: 'rgba(14,10,8,0.95)',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: '100%',
              background: 'linear-gradient(135deg, #d4a84b, #b8922a)',
              color: '#fff',
              fontSize: 11,
              fontWeight: 700,
              textAlign: 'center',
              padding: '8px',
              borderRadius: 10,
            }}
          >
            Add to Order
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}

'use client';

import type { MenuItemDisplay } from '../../types/restaurant';
import { PhoneFrame } from './PhoneFrame';

export interface CarouselPreviewPhoneProps {
  item: MenuItemDisplay;
}

interface PreviewCardProps {
  imageUrl: string | null | undefined;
  name: string;
  category: string;
  scale: number;
  translateX: number;
  opacity: number;
  blur: boolean;
  zIndex: number;
}

function PreviewCard({ imageUrl, name, category, scale, translateX, opacity, blur, zIndex }: PreviewCardProps) {
  const cardWidth = 185;
  const cardHeight = 440;

  return (
    <div
      style={{
        width: cardWidth,
        height: cardHeight,
        flexShrink: 0,
        borderRadius: 16,
        overflow: 'hidden',
        transform: `scale(${scale}) translateX(${translateX}px)`,
        opacity,
        filter: blur ? 'blur(2px)' : 'none',
        zIndex,
        position: 'relative',
        background: '#1a1209',
        transformOrigin: 'center center',
      }}
    >
      {/* Image section — top 62% */}
      <div style={{ position: 'relative', height: '62%', overflow: 'hidden' }}>
        {imageUrl ? (
          <img src={imageUrl} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg, #f97316, #f59e0b)' }} />
        )}
        {/* Scrim */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(to top, rgba(0,0,0,0.2), rgba(0,0,0,0.1))',
          }}
        />
      </div>

      {/* Info section — bottom 38% */}
      <div
        style={{
          height: '38%',
          padding: '10px 12px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          background: '#1a1209',
        }}
      >
        <p
          style={{
            fontSize: 10,
            color: 'rgba(255,255,255,0.45)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            margin: '0 0 4px 0',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {category}
        </p>
        <p
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: '#fff',
            margin: 0,
            lineHeight: 1.3,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {name}
        </p>
      </div>
    </div>
  );
}

export function CarouselPreviewPhone({ item }: CarouselPreviewPhoneProps) {
  const phoneWidth = 280;
  const borderWidth = 8;
  const innerWidth = phoneWidth - borderWidth * 2;

  // Card dims
  const centerCardWidth = 185;
  const ghostCardWidth = 130;
  const rowWidth = ghostCardWidth + centerCardWidth + ghostCardWidth;
  // Clip: (rowWidth - innerWidth) / 2 from each side → ghosts peek by (ghostCardWidth - clip)
  const clip = (rowWidth - innerWidth) / 2;
  const ghostVisible = ghostCardWidth - clip; // ~37px each side

  void ghostVisible; // used implicitly via overflow hidden

  return (
    <PhoneFrame label="Guided Dining" width={phoneWidth}>
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#0E0A08',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Cards row */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: rowWidth,
            display: 'flex',
            alignItems: 'center',
            gap: 0,
          }}
        >
          {/* Left ghost */}
          <PreviewCard
            imageUrl={item.thumbnail_url}
            name={item.name}
            category={item.category}
            scale={0.85}
            translateX={0}
            opacity={0.5}
            blur={true}
            zIndex={1}
          />

          {/* Center card */}
          <PreviewCard
            imageUrl={item.thumbnail_url}
            name={item.name}
            category={item.category}
            scale={1}
            translateX={0}
            opacity={1}
            blur={false}
            zIndex={2}
          />

          {/* Right ghost */}
          <PreviewCard
            imageUrl={item.thumbnail_url}
            name={item.name}
            category={item.category}
            scale={0.85}
            translateX={0}
            opacity={0.5}
            blur={true}
            zIndex={1}
          />
        </div>

        {/* Dot indicators */}
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            gap: 5,
          }}
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              style={{
                width: i === 2 ? 16 : 5,
                height: 5,
                borderRadius: 3,
                background: i === 2 ? '#d4a84b' : 'rgba(255,255,255,0.25)',
                transition: 'width 0.2s ease',
              }}
            />
          ))}
        </div>
      </div>
    </PhoneFrame>
  );
}

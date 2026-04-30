'use client';

import { PhoneFrame } from './PhoneFrame';

export interface GoodbyeScreenPreviewProps {
  headerImageUrl: string | null;
  restaurantName: string;
}

function StarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="#d4a84b" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

export function GoodbyeScreenPreview({ headerImageUrl, restaurantName }: GoodbyeScreenPreviewProps) {
  return (
    <PhoneFrame label="Goodbye Screen">
      <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0E0A08', overflow: 'hidden' }}>
        {/* Layer 1 — background image or gradient fallback */}
        {headerImageUrl ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: `url(${headerImageUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'top center',
              filter: 'brightness(0.55)',
            }}
          />
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(135deg, #f97316, #f59e0b)',
              opacity: 0.4,
            }}
          />
        )}

        {/* Layer 2 — cinematic gradient veil */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(180deg, rgba(14,10,8,0.55) 0%, rgba(14,10,8,0.15) 28%, rgba(14,10,8,0.55) 62%, rgba(14,10,8,0.96) 100%)',
          }}
        />

        {/* Layer 3 — gold vertical stripe */}
        <div
          style={{
            position: 'absolute',
            left: 10,
            top: 0,
            bottom: 0,
            width: 1,
            background: 'linear-gradient(to bottom, transparent 0%, #d4a84b 30%, #d4a84b 70%, transparent 100%)',
          }}
        />

        {/* Layer 4 — content */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            padding: '0 18px 28px 18px',
          }}
        >
          {/* Goodnight label */}
          <p
            style={{
              fontFamily: 'monospace',
              fontSize: 9,
              letterSpacing: '2px',
              textTransform: 'uppercase',
              color: '#d4a84b',
              margin: '0 0 8px 0',
            }}
          >
            Goodnight
          </p>

          {/* Thank you */}
          <p style={{ fontSize: 16, color: '#fff', margin: '0 0 2px 0', fontWeight: 400 }}>
            Thank you,
          </p>

          {/* Restaurant name */}
          <p
            style={{
              fontSize: 16,
              color: '#d4a84b',
              fontStyle: 'italic',
              fontWeight: 600,
              margin: '0 0 14px 0',
              wordBreak: 'break-word',
            }}
          >
            {restaurantName}
          </p>

          {/* Stars */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <StarIcon key={i} />
            ))}
          </div>

          {/* Haiku */}
          <p
            style={{
              fontSize: 9,
              color: 'rgba(255,255,255,0.35)',
              fontStyle: 'italic',
              margin: 0,
            }}
          >
            every dish a memory
          </p>
        </div>

        {/* No-image placeholder message */}
        {!headerImageUrl && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              textAlign: 'center',
              color: 'rgba(255,255,255,0.4)',
              fontSize: 10,
              padding: '0 24px',
              pointerEvents: 'none',
            }}
          >
            Upload a background image to preview
          </div>
        )}
      </div>
    </PhoneFrame>
  );
}

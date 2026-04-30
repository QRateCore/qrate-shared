'use client';

import { PhoneFrame } from './PhoneFrame';

export interface WelcomeScreenPreviewProps {
  headerImageUrl: string | null;
  restaurantName: string;
  tagline?: string | null;
}

export function WelcomeScreenPreview({ headerImageUrl, restaurantName, tagline }: WelcomeScreenPreviewProps) {
  return (
    <PhoneFrame label="Welcome Screen">
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
            padding: '0 18px 22px 18px',
          }}
        >
          {/* QRate mark */}
          <div style={{ marginBottom: 12 }}>
            <span
              style={{
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: '0.08em',
                color: '#d4a84b',
                textTransform: 'uppercase',
              }}
            >
              QRate
            </span>
          </div>

          {/* Restaurant name */}
          <h3
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: '#fff',
              margin: '0 0 4px 0',
              lineHeight: 1.15,
              letterSpacing: '-0.3px',
              wordBreak: 'break-word',
            }}
          >
            {restaurantName}
          </h3>

          {/* Tagline */}
          {tagline && (
            <p
              style={{
                fontSize: 10,
                color: 'rgba(255,255,255,0.7)',
                margin: '0 0 14px 0',
                lineHeight: 1.4,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {tagline}
            </p>
          )}

          {/* Begin button */}
          <div style={{ marginTop: tagline ? 0 : 14 }}>
            <div
              style={{
                display: 'inline-block',
                background: 'linear-gradient(135deg, #d4a84b, #b8922a)',
                color: '#fff',
                fontSize: 10,
                fontWeight: 700,
                padding: '7px 20px',
                borderRadius: 20,
                letterSpacing: '0.04em',
              }}
            >
              Begin
            </div>
          </div>
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

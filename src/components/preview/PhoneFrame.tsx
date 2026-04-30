'use client';

export interface PhoneFrameProps {
  children: React.ReactNode;
  /** Phone display width in px. Height auto-calculated at 9:19.5 ratio. Default: 280 */
  width?: number;
  /** Optional caption rendered below the phone */
  label?: string;
  className?: string;
}

export function PhoneFrame({ children, width = 280, label, className }: PhoneFrameProps) {
  const borderWidth = 8;
  const outerWidth = width;
  const outerHeight = Math.round(width * (19.5 / 9));
  const innerWidth = outerWidth - borderWidth * 2;
  const innerHeight = outerHeight - borderWidth * 2;
  const notchHeight = 28;

  return (
    <div className={className} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Phone shell */}
      <div
        style={{
          width: outerWidth,
          height: outerHeight,
          borderRadius: 44,
          border: `${borderWidth}px solid #1a1a1a`,
          background: '#0E0A08',
          boxShadow: '0 32px 64px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.04)',
          position: 'relative',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {/* Notch */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 90,
            height: notchHeight,
            background: '#0E0A08',
            borderRadius: '0 0 20px 20px',
            zIndex: 10,
          }}
        />
        {/* Content area */}
        <div
          style={{
            width: innerWidth,
            height: innerHeight,
            borderRadius: 36,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {children}
        </div>
      </div>
      {/* Label */}
      {label && (
        <p style={{ fontSize: 11, color: 'rgba(156,163,175,1)', textAlign: 'center', marginTop: 10, marginBottom: 0 }}>
          {label}
        </p>
      )}
    </div>
  );
}

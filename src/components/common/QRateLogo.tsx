'use client';

export interface QRateLogoProps {
  /** Subtitle text shown below "QRate" (e.g. "Owner Portal", "Internal") */
  subtitle?: string;
  /** Size variant */
  size?: 'sm' | 'md';
  /** Color theme for text */
  theme?: 'light' | 'dark';
}

export function QRateLogo({ subtitle, size = 'md', theme = 'dark' }: QRateLogoProps) {
  const iconSize = size === 'sm' ? 28 : 36;
  const nameSize = size === 'sm' ? 18 : 21;
  const subSize = size === 'sm' ? 9 : 10;
  const textColor = theme === 'light' ? '#fff' : '#111827';
  const subColor = theme === 'light' ? 'rgba(255,255,255,0.5)' : '#9ca3af';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size === 'sm' ? 8 : 10 }}>
      <img
        src="/qrate-logo.png"
        alt="QRate"
        width={iconSize}
        height={iconSize}
        style={{ borderRadius: size === 'sm' ? 6 : 8, flexShrink: 0 }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
        <span style={{ fontSize: nameSize, fontWeight: 800, letterSpacing: '-.4px', color: textColor }}>
          QRate
        </span>
        {subtitle && (
          <span style={{ fontSize: subSize, fontWeight: 600, letterSpacing: '.5px', color: subColor, textTransform: 'uppercase' as const }}>
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
}

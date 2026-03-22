'use client';

import { useState, useRef, useCallback } from 'react';

export interface SwipeSliderProps {
  label: string;
  onComplete: () => void;
  color?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export default function SwipeSlider({ label, onComplete, color = 'bg-green-500', icon, disabled }: SwipeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const completedRef = useRef(false);

  const THUMB_SIZE = 48;
  const COMPLETE_THRESHOLD = 0.75;

  const getTrackWidth = () => trackRef.current?.offsetWidth ?? 300;
  const maxDrag = () => getTrackWidth() - THUMB_SIZE - 8; // 8 = padding

  const handleStart = useCallback((clientX: number) => {
    if (disabled || completedRef.current) return;
    startXRef.current = clientX;
    setIsDragging(true);
  }, [disabled]);

  const handleMove = useCallback((clientX: number) => {
    if (!isDragging) return;
    const delta = clientX - startXRef.current;
    setDragX(Math.max(0, Math.min(delta, maxDrag())));
  }, [isDragging]);

  const handleEnd = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    if (dragX >= maxDrag() * COMPLETE_THRESHOLD) {
      completedRef.current = true;
      setDragX(maxDrag());
      onComplete();
      // Reset after animation
      setTimeout(() => {
        completedRef.current = false;
        setDragX(0);
      }, 600);
    } else {
      setDragX(0);
    }
  }, [isDragging, dragX, onComplete]);

  const progress = maxDrag() > 0 ? dragX / maxDrag() : 0;

  return (
    <div
      ref={trackRef}
      className={`relative h-12 rounded-full overflow-hidden select-none ${disabled ? 'opacity-50' : ''}`}
      style={{ background: '#e5e7eb' }}
      onMouseMove={(e) => handleMove(e.clientX)}
      onMouseUp={handleEnd}
      onMouseLeave={handleEnd}
      onTouchMove={(e) => handleMove(e.touches[0].clientX)}
      onTouchEnd={handleEnd}
    >
      {/* Fill */}
      <div
        className={`absolute inset-y-0 left-0 ${color} transition-opacity rounded-full`}
        style={{ width: `${(dragX + THUMB_SIZE + 8)}px`, opacity: 0.2 + progress * 0.6 }}
      />

      {/* Label */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span
          className="text-sm font-semibold text-gray-500 transition-opacity"
          style={{ opacity: 1 - progress }}
        >
          {label}
        </span>
      </div>

      {/* Thumb */}
      <div
        className={`absolute top-1 left-1 w-10 h-10 rounded-full ${color} flex items-center justify-center shadow-md cursor-grab active:cursor-grabbing transition-transform`}
        style={{
          transform: `translateX(${dragX}px)`,
          transition: isDragging ? 'none' : 'transform 0.3s ease-out',
        }}
        onMouseDown={(e) => handleStart(e.clientX)}
        onTouchStart={(e) => handleStart(e.touches[0].clientX)}
      >
        {icon || (
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        )}
      </div>
    </div>
  );
}

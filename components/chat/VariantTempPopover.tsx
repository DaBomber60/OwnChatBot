import React from 'react';

interface VariantTempPopoverProps {
  x: number;
  y: number;
  tempValue: number;
  setTempValue: (v: number) => void;
  onGenerate: () => void;
  onClose: () => void;
}

export function VariantTempPopover({ x, y, tempValue, setTempValue, onGenerate, onClose }: VariantTempPopoverProps) {
  return (
    <div
      className="popover-overlay"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'transparent' }}
    >
      <div
        className="popover-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          left: Math.max(12, Math.min(window.innerWidth - 300, x - 140)),
          top: Math.max(12, y - 140),
          width: 280,
          padding: '14px 16px',
          borderRadius: '12px',
          background: 'rgba(20,20,28,0.9)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          color: 'var(--text-primary, #fff)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontWeight: 650, letterSpacing: 0.2 }}>🧬 Variant temperature</div>
          <span
            style={{
              fontSize: 12,
              padding: '2px 8px',
              borderRadius: 999,
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.12)',
            }}
          >
            {tempValue.toFixed(1)}
          </span>
        </div>
        <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>This applies to this variant only.</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, opacity: 0.8, width: 24, textAlign: 'right' }}>0.0</span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={tempValue}
            onChange={(e) => setTempValue(parseFloat(e.target.value))}
            style={{ flex: 1, height: 28, accentColor: 'var(--primary, #7c5cff)' as any }}
          />
          <span style={{ fontSize: 12, opacity: 0.8, width: 24 }}>2.0</span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary btn-small" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-small" onClick={onGenerate}>Generate</button>
        </div>
      </div>
    </div>
  );
}

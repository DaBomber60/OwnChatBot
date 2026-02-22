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
      className="popover-overlay popover-overlay-backdrop"
      onClick={onClose}
    >
      <div
        className="popover-content variant-temp-popover"
        onClick={(e) => e.stopPropagation()}
        style={{
          left: Math.max(12, Math.min(window.innerWidth - 300, x - 140)),
          top: Math.max(12, y - 140),
        }}
      >
        <div className="variant-temp-header">
          <div className="variant-temp-title">🧬 Variant temperature</div>
          <span className="variant-temp-badge">
            {tempValue.toFixed(1)}
          </span>
        </div>
        <div className="variant-temp-hint">This applies to this variant only.</div>
        <div className="variant-temp-slider-row">
          <span className="variant-temp-range-label variant-temp-range-label--left">0.0</span>
          <input
            type="range"
            className="variant-temp-range"
            min={0}
            max={2}
            step={0.1}
            value={tempValue}
            onChange={(e) => setTempValue(parseFloat(e.target.value))}
          />
          <span className="variant-temp-range-label">2.0</span>
        </div>
        <div className="variant-temp-actions">
          <button className="btn btn-secondary btn-small" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-small" onClick={onGenerate}>Generate</button>
        </div>
      </div>
    </div>
  );
}

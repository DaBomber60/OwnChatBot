import React from 'react';

/** Matches .variant-temp-popover width in globals.css. */
const POPOVER_WIDTH = 280;
const VIEWPORT_MARGIN = 12;
/** The popover is centred on the press point and lifted above it. */
const OFFSET_X = POPOVER_WIDTH / 2;
const OFFSET_Y = 140;

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
          left: Math.max(VIEWPORT_MARGIN, Math.min(window.innerWidth - POPOVER_WIDTH - 20, x - OFFSET_X)),
          top: Math.max(VIEWPORT_MARGIN, y - OFFSET_Y),
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

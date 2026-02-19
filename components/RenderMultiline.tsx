import React from 'react';

/** Render a multi-line string as paragraphs. */
export function renderMultiline(text: string): React.ReactNode {
  if (!text) return null;
  return text.split(/\r?\n/).map((line, idx) => (
    <p key={idx} style={{ margin: '0.05rem 0' }}>{line}</p>
  ));
}

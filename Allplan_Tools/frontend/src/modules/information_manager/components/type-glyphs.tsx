type P = { className?: string };

function Glyph({ text, className }: P & { text: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden overflow="visible">
      <text x="12" y="16.5" textAnchor="middle" fontSize="14.5" fontWeight="700" fill="currentColor"
        fontFamily="ui-sans-serif, system-ui, sans-serif" letterSpacing="-1" textLength="22" lengthAdjust="spacingAndGlyphs">{text}</text>
    </svg>
  );
}

export const StrGlyph = (p: P) => <Glyph text="ABC" {...p} />;
export const IntGlyph = (p: P) => <Glyph text="123" {...p} />;
export const FloatGlyph = (p: P) => <Glyph text="0.0" {...p} />;

/** List box: framed list with one highlighted (selected) row. */
export const ListBoxGlyph = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M7 8h10" />
    <rect x="6" y="10.5" width="12" height="3" rx="0.8" fill="currentColor" stroke="none" />
    <path d="M7 16h10" />
  </svg>
);

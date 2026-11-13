/**
 * AIM application icon, redrawn as an embedded SVG from the reference artwork supplied by
 * the user (icone.png): notepad with binding rings, text lines, signature stroke and pencil,
 * single-colour line style. Uses currentColor so it stays legible on light and dark surfaces
 * without any network resource.
 */
export function AimBrandIcon({ className = "", label }: { className?: string; label?: string }) {
  return <svg viewBox="0 0 24 24" className={`inline-block shrink-0 ${className}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} data-artwork="aim-icon" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 4H17a1 1 0 0 1 1 1v3.5M18 17.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h2.5" />
    <path d="M7 2.5v3M10 2.5v3M13 2.5v3M16 2.5v3" />
    <path d="M7 9h7M7 12h6M7 15h3" />
    <path d="M7 19l1-3 1 2.5" />
    <path d="M20.6 9.4a1.4 1.4 0 0 1 0 2L14 18l-3 1 1-3 6.6-6.6a1.4 1.4 0 0 1 2 0z" fill="currentColor" />
    <path d="M17.7 10.3l2 2" stroke="currentColor" />
  </svg>;
}

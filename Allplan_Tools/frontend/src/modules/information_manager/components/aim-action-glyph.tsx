import { SmartCatalogIcon } from "./smartcatalog-icons";

type Action = "group" | "move" | "edit" | "colors" | "names" | "types" | "tools" | "manual" | "project";

/** AIM-specific artwork uses the one-pixel, filled-sheet language of SmartCatalog Duplicate. */
export function AimActionGlyph({ name }: { name: Action }) {
  if (name === "group") {
    return <span aria-hidden className="relative inline-flex size-5 shrink-0">
      <SmartCatalogIcon name="folder" />
      <svg viewBox="0 0 10 10" className="absolute bottom-0 right-0 max-h-2.5 max-w-2.5 text-primary">
        <circle cx="5" cy="5" r="4.5" fill="currentColor" />
        <path d="M5 2.5v5M2.5 5h5" fill="none" className="stroke-primary-foreground" strokeWidth="1" />
      </svg>
    </span>;
  }
  const paths: Record<Action, React.ReactNode> = {
    group: <><path d="M2.5 6.5h7l2 2h10v12h-19z" /><path d="M3 10h18M15 12v6M12 15h6" fill="none" /></>,
    move: <><path d="M2.5 6.5h7l2 2h10v12h-19z" /><path d="M6 14h10m-3-3 3 3-3 3" fill="none" /></>,
    edit: <><path d="M3.5 2.5h12v19h-12z" /><path d="m9 15 9-9 3 3-9 9-4 1z" /><path d="m17 7 3 3M6 6h6M6 9h5" fill="none" /></>,
    colors: <><path d="M12 2.5a9.5 9.5 0 1 0 0 19h2a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h5a3 3 0 0 0 3-3c0-4-4-8-9-8z" /><circle cx="7" cy="8" r="1" /><circle cx="12" cy="6" r="1" /><circle cx="17" cy="8" r="1" /><circle cx="6" cy="13" r="1" /></>,
    names: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3.5" /></>,
    types: <><path d="m7 2 4 7H3z" /><rect x="14" y="3" width="7" height="7" /><circle cx="7" cy="17" r="4" /><path d="m17 13 5 8H12z" /></>,
    tools: <><path d="m14 3-1 5 3 3 5-1a6 6 0 0 1-8 7l-6 6-4-4 6-6a6 6 0 0 1 5-10z" /><circle cx="6" cy="20" r=".75" /></>,
    project: <><path d="M4.5 2.5h9l4 4v15h-13z" /><path d="M13.5 2.5v4h4" fill="none" /><path d="M11 17.5h10m-3-3 3 3-3 3" fill="none" /></>,
    manual: <><rect x="5" y="3" width="4" height="4" /><rect x="15" y="3" width="4" height="4" /><rect x="5" y="10" width="4" height="4" /><rect x="15" y="10" width="4" height="4" /><rect x="5" y="17" width="4" height="4" /><rect x="15" y="17" width="4" height="4" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden className="aim-action-glyph size-5">{paths[name]}</svg>;
}
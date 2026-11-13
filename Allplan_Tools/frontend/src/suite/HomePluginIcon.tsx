import { useState } from "react";
import type { PluginId } from "./contracts/ALLPLAN_TOOLS_HOME_CONTRACT";

/** Accept only the exact endpoint on this window's origin. */
export function resolveHomeIcon(id: PluginId, iconUrl: unknown, origin: string): string | null {
  if (iconUrl !== `/plugin-icons/${id}.png`) return null;
  return new URL(iconUrl, origin).href;
}

export function HomePluginIcon({ source, fallback }: { source: string | null; fallback: string }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const useHostIcon = source !== null && failedSource !== source;
  return <img src={useHostIcon ? source : fallback} alt="" className="size-8 object-contain" draggable={false}
    onError={useHostIcon ? () => setFailedSource(source) : undefined} />;
}
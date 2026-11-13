import { vobArtwork } from "@/lib/vob-artwork";
import { Power } from "lucide-react";
import { QuickActionTooltip, type QuickTooltipAction } from "./QuickActionTooltip";
import type { ReactElement } from "react";
import duplicateIcon from "@/assets/icons/duplicate.svg";

/** VOB adapter for the shared interactive quick-action tooltip. */
export function VobRowHover({ children, summary, onCopy, onDuplicate, onRemove, onToggle, enabled, copyLabel, duplicateLabel, removeLabel, enableLabel }: {
  children: ReactElement; summary: string; onCopy?: (() => void) | undefined; onDuplicate?: (() => void) | undefined;
  onRemove?: (() => void) | undefined; onToggle?: (() => void) | undefined; enabled: boolean;
  copyLabel?: string | undefined; duplicateLabel?: string | undefined; removeLabel?: string | undefined; enableLabel?: string | undefined;
}) {
  const art = (url: string) => <img src={url} alt="" draggable={false} className="h-3.5 w-3.5 object-contain" />;
  const actions: QuickTooltipAction[] = [];
  if (onCopy) actions.push({ id: "copy", label: copyLabel ?? "Copy", icon: art(vobArtwork.copy), onClick: onCopy });
  if (onDuplicate) actions.push({ id: "duplicate", label: duplicateLabel ?? "Duplicate", icon: art(duplicateIcon), onClick: onDuplicate });
  if (onToggle) actions.push({ id: "toggle", label: enableLabel ?? "Enable / disable", icon: <Power className={`h-3.5 w-3.5 ${enabled ? "text-success" : "text-muted-foreground"}`} />, onClick: onToggle, pressed: enabled });
  if (onRemove) actions.push({ id: "remove", label: removeLabel ?? "Delete", icon: art(vobArtwork.delete), onClick: onRemove, destructive: true });
  return <QuickActionTooltip summary={summary} actions={actions}>{children}</QuickActionTooltip>;
}

import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { Portal } from "@radix-ui/react-hover-card";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

export type QuickTooltipAction = { id: string; label: string; icon: ReactNode; onClick: () => void; destructive?: boolean; pressed?: boolean };

/** Interactive summary tooltip with explicit, context-scoped quick actions. */
export function QuickActionTooltip({ children, summary, actions }: { children: ReactElement; summary: string; actions: QuickTooltipAction[] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const hide = () => setOpen(false);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => { window.removeEventListener("scroll", hide, true); window.removeEventListener("resize", hide); };
  }, [open]);
  if (!actions.length) return children;
  return <HoverCard open={open} onOpenChange={setOpen} openDelay={350} closeDelay={200}>
    <HoverCardTrigger asChild onFocus={() => setOpen(true)} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>{children}</HoverCardTrigger>
    <Portal><HoverCardContent align="start" side="bottom" sideOffset={4} role="dialog" aria-label={summary.split("\n")[0]} className="app-tooltip z-[60] w-80 max-w-[calc(100vw-16px)] p-0" onClick={(event) => event.stopPropagation()}>
      <div className="border-l-4 border-brand-bar">
      <div className="flex justify-start gap-2 border-b border-border px-3 py-2">
        {actions.map((action) => <Button key={action.id} variant="ghost" aria-label={action.label} title={action.label} aria-pressed={action.pressed} className={`h-7 w-7 rounded-sm border border-border bg-background p-0 text-muted-foreground ${action.destructive ? "ml-3 hover:bg-destructive/10 hover:text-destructive" : "hover:bg-accent"}`} onClick={() => { setOpen(false); action.onClick(); }}>{action.icon}</Button>)}
      </div>
      <div className="flex gap-2 px-3 py-2">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ribbon-dark" />
        <div className="min-w-0 break-words text-xs">{summary.split("\n").map((line, index) => <div key={index} className={index === 0 ? "font-semibold" : "mt-0.5 text-muted-foreground"}>{line}</div>)}</div>
      </div>
      </div>
    </HoverCardContent></Portal>
  </HoverCard>;
}
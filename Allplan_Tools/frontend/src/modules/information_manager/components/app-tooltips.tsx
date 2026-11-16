import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Info } from "lucide-react";

/** Upgrades existing native title hints, including dynamically mounted controls. */
export function AppTooltips() {
  const [hint, setHint] = useState<{ text: string; x: number; y: number; anchorLeft: number; anchorTop: number; anchorBottom: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!hint || !box.current) return;
    // Layout dimensions ignore the tooltip's entrance transform and stay stable at viewport edges.
    const width = box.current.offsetWidth, height = box.current.offsetHeight;
    const x = Math.max(8, Math.min(hint.anchorLeft, window.innerWidth - width - 8));
    const below = hint.anchorBottom + 8;
    const y = Math.max(8, below + height <= window.innerHeight - 8 ? below : hint.anchorTop - height - 8);
    if (x !== hint.x || y !== hint.y) setHint({ ...hint, x, y });
    // Position updates must not trigger another measurement/state update cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hint?.text, hint?.anchorLeft, hint?.anchorTop, hint?.anchorBottom]);
  useEffect(() => {
    let hovered: HTMLElement | null = null;
    let focused: HTMLElement | null = null;
    let active: HTMLElement | null = null;
    let originalTitle: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dismissed = false;
    const hide = () => {
      clearTimeout(timer); setHint(null);
      if (active && originalTitle !== null) active.setAttribute("title", originalTitle);
      active = null;
      originalTitle = null;
    };
    // The active plain-title trigger has its title temporarily removed. Resolve it
    // at its original ancestor level, without masking a more specific descendant.
    const trigger = (node: EventTarget | null): HTMLElement | null => {
      let element = node instanceof Element ? node : null;
      if (element?.closest('[role="tooltip"]')) return null;
      while (element) {
        if (element instanceof HTMLElement && (element === active || element.hasAttribute("title") || element.hasAttribute("data-tip"))) return element;
        element = element.parentElement;
      }
      return null;
    };
    const reconcile = () => {
      if (dismissed) return;
      const target = (focused?.isConnected ? focused : null) ?? (hovered?.isConnected ? hovered : null);
      if (target === active) return;
      hide();
      if (!target) return;
      const rich = target.getAttribute("data-tip");
      const shown = rich ?? target.getAttribute("title") ?? "";
      if (!shown) return;
      active = target;
      if (rich == null) { originalTitle = target.getAttribute("title"); target.removeAttribute("title"); }
      timer = setTimeout(() => {
        if (!target.isConnected || active !== target) return;
        const rect = target.getBoundingClientRect();
        setHint({ text: shown, x: rect.left, y: rect.bottom + 8, anchorLeft: rect.left, anchorTop: rect.top, anchorBottom: rect.bottom });
      }, 350);
    };
    const hover = (event: MouseEvent) => { hovered = trigger(event.target); if (hovered) dismissed = false; reconcile(); };
    const focus = (event: FocusEvent) => { focused = trigger(event.target); if (focused) dismissed = false; reconcile(); };
    const leaveHover = (event: MouseEvent) => { hovered = trigger(event.relatedTarget); reconcile(); };
    const leaveFocus = (event: FocusEvent) => { focused = trigger(event.relatedTarget); reconcile(); };
    const dismiss = () => { dismissed = true; hide(); };
    document.addEventListener("mouseover", hover); document.addEventListener("focusin", focus);
    document.addEventListener("mouseout", leaveHover); document.addEventListener("focusout", leaveFocus); document.addEventListener("pointerdown", dismiss); document.addEventListener("dragstart", dismiss); window.addEventListener("scroll", dismiss, true); window.addEventListener("resize", dismiss);
    return () => { dismiss(); document.removeEventListener("mouseover", hover); document.removeEventListener("focusin", focus); document.removeEventListener("mouseout", leaveHover); document.removeEventListener("focusout", leaveFocus); document.removeEventListener("pointerdown", dismiss); document.removeEventListener("dragstart", dismiss); window.removeEventListener("scroll", dismiss, true); window.removeEventListener("resize", dismiss); };
  }, []);
  return hint ? <div ref={box} role="tooltip" className="app-tooltip pointer-events-none fixed z-[60] w-max max-h-[calc(100vh-16px)] max-w-[min(20rem,calc(100vw-16px))] overflow-hidden break-words rounded-md border border-border bg-popover text-popover-foreground shadow-lg" style={{ left: hint.x, top: hint.y }}><div className="flex gap-2 border-l-4 border-brand-bar px-3 py-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ribbon-dark" /><div className="min-w-0 text-xs">{hint.text.split("\n").map((l, i) => l.startsWith("#") ? <div key={i} className="mt-2 border-b border-border pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-ribbon-dark">{l.slice(1)}</div>
        : l.startsWith("~") ? <div key={i} className="flex gap-2 font-mono text-[11px]"><span className="w-6 text-right text-muted-foreground">{l.slice(1).split("|")[0]}</span><span>{l.slice(1).split("|").slice(1).join("|")}</span></div>
        : l.startsWith("=") ? <div key={i} className="flex gap-2 text-[11px]"><span className="w-20 shrink-0 text-muted-foreground">{l.slice(1).split("|")[0]}</span><span className="font-medium">{l.slice(1).split("|").slice(1).join("|")}</span></div>
        : l.startsWith("!")
        ? <div key={i} className="mt-1.5 flex items-center gap-1 font-semibold text-foreground"><span className="rounded-sm bg-warning px-1 text-[10px] font-bold">!</span>{l.slice(1)}</div>
        : <div key={i} className={i === 0 ? "font-semibold" : "mt-0.5 text-muted-foreground"}>{l}</div>)}</div></div></div> : null;
}
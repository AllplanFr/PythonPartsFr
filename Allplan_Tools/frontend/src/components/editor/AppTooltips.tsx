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
    let active: HTMLElement | null = null;
    let text = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hide = () => {
      clearTimeout(timer); setHint(null);
      if (active && text) active.setAttribute("title", text);
      active = null;
    };
    const show = (event: Event) => {
      if (active && event.target instanceof Node && active.contains(event.target)) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[title],[data-tip]") : null;
      if (target === active) return;
      hide();
      if (!target || target.closest('[role="tooltip"]')) return;
      const rich = target.getAttribute("data-tip");
      text = rich ?? target.getAttribute("title") ?? "";
      if (!text) return;
      active = target; if (rich == null) target.removeAttribute("title"); else text = "";
      const shown = rich ?? text;
      timer = setTimeout(() => {
        if (!target.isConnected || active !== target) return;
        const rect = target.getBoundingClientRect();
        setHint({ text: shown, x: rect.left, y: rect.bottom + 8, anchorLeft: rect.left, anchorTop: rect.top, anchorBottom: rect.bottom });
      }, 350);
    };
    const leave = (e: MouseEvent) => { if (active && !(e.relatedTarget instanceof Node && active.contains(e.relatedTarget))) hide(); };
    document.addEventListener("mouseover", show); document.addEventListener("focusin", show);
    document.addEventListener("mouseout", leave); document.addEventListener("focusout", hide); document.addEventListener("pointerdown", hide); document.addEventListener("dragstart", hide); window.addEventListener("scroll", hide, true); window.addEventListener("resize", hide);
    return () => { hide(); document.removeEventListener("mouseover", show); document.removeEventListener("focusin", show); document.removeEventListener("mouseout", leave); document.removeEventListener("focusout", hide); document.removeEventListener("pointerdown", hide); document.removeEventListener("dragstart", hide); window.removeEventListener("scroll", hide, true); window.removeEventListener("resize", hide); };
  }, []);
  return hint ? <div ref={box} role="tooltip" className="app-tooltip pointer-events-none fixed z-[60] w-max max-h-[calc(100vh-16px)] max-w-[min(20rem,calc(100vw-16px))] overflow-hidden break-words rounded-md border border-border bg-popover text-popover-foreground shadow-lg" style={{ left: hint.x, top: hint.y }}><div className="flex gap-2 border-l-4 border-brand-bar px-3 py-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ribbon-dark" /><div className="min-w-0 text-xs">{hint.text.split("\n").map((l, i) => l.startsWith("#") ? <div key={i} className="mt-2 border-b border-border pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-ribbon-dark">{l.slice(1)}</div>
        : l.startsWith("~") ? <div key={i} className="flex gap-2 font-mono text-[11px]"><span className="w-6 text-right text-muted-foreground">{l.slice(1).split("|")[0]}</span><span>{l.slice(1).split("|").slice(1).join("|")}</span></div>
        : l.startsWith("=") ? <div key={i} className="flex gap-2 text-[11px]"><span className="w-20 shrink-0 text-muted-foreground">{l.slice(1).split("|")[0]}</span><span className="font-medium">{l.slice(1).split("|").slice(1).join("|")}</span></div>
        : l.startsWith("!")
        ? <div key={i} className="mt-1.5 flex items-center gap-1 font-semibold text-foreground"><span className="rounded-sm bg-warning px-1 text-[10px] font-bold">!</span>{l.slice(1)}</div>
        : <div key={i} className={i === 0 ? "font-semibold" : "mt-0.5 text-muted-foreground"}>{l}</div>)}</div></div></div> : null;
}
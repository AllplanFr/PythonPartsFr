import ascIcon from "@/assets/icons/asc.svg.asset.json";
import { useEffect, useState } from "react";
import { Info, Hammer } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppDialog } from "@/lib/app-dialog";
import { useT } from "@/lib/i18n";
import { useCatalog } from "@/lib/catalog-store";

export function AppMessageDialog({ compact = false, title = "SmartCatalog", iconSrc = ascIcon.url }: { compact?: boolean; title?: string; iconSrc?: string }) {
  const t = useT(); const current = useAppDialog((s) => s.queue[0]); const close = useAppDialog((s) => s.close);
  const fr = useCatalog((s) => s.lang) === "fr";
  const [value, setValue] = useState("");
  useEffect(() => { if (current?.kind === "prompt") setValue(current.value); }, [current]);
  const ok = () => close(current?.kind === "prompt" ? value : current?.kind === "confirm" ? "confirmed" : undefined);
  const tone = current?.kind === "message" ? current.tone ?? "info" : "info";
  if (tone === "about") return <Dialog open={!!current} onOpenChange={(open) => { if (!open) close(null); }}>
    <DialogContent className="about-dialog max-w-sm gap-0 overflow-hidden p-0">
      <DialogTitle className="sr-only">{t("about")}</DialogTitle>
      <div className="about-hero flex flex-col items-center gap-2 bg-primary px-6 py-7 text-primary-foreground">
        <img src={iconSrc} alt="" className="about-logo h-16 w-16 object-contain" />
        <span className="about-title text-base font-semibold tracking-wide">Allplan SmartCatalog Editor</span>
      </div>
      <DialogDescription className="about-text whitespace-pre-line px-6 py-5 text-center text-xs leading-6 text-foreground">{"Application créée par MAUGER Jean-François\nCopyright (c) ALLPLAN GmbH - All rights reserved"}</DialogDescription>
      <div className="secondary-dialog-footer flex justify-center px-4 py-2"><Button autoFocus onClick={ok}>OK</Button></div>
    </DialogContent>
  </Dialog>;
  return <Dialog open={!!current} onOpenChange={(open) => { if (!open) close(null); }}>
    <DialogContent className="max-w-sm gap-0 overflow-hidden p-0">
      <DialogTitle className="catalog-panel-heading flex items-center gap-2 px-4 py-3 pr-10 text-sm"><img src={iconSrc} alt="" className="h-4 w-4 object-contain" />{title}</DialogTitle>
      {tone === "dev" ? <div className="flex flex-col items-center gap-3 px-6 py-6 text-center">
        <span className="dev-badge flex h-12 w-12 items-center justify-center rounded-full bg-selection text-ribbon-dark"><Hammer className="h-6 w-6" /></span>
        <span className="text-sm font-semibold text-foreground">{t("inDevelopment")}</span>
        <DialogDescription className="text-xs leading-5 text-muted-foreground"><span className="block font-medium text-foreground">{current?.text}</span>{fr ? "Cette fonction sera bientôt disponible, une fois reliée à son module ou au PythonPart Allplan." : "This feature will be available soon, once connected to its module or to the Allplan PythonPart."}</DialogDescription>
      </div> : <div className="flex gap-3 p-4">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-ribbon-dark" />
        <div className="min-w-0 flex-1 space-y-3">
          <DialogDescription className="whitespace-pre-line text-xs text-foreground">{current?.text}</DialogDescription>
          {current?.kind === "prompt" && <Input autoFocus value={value} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); ok(); } }} className="h-8 text-xs" />}
        </div>
      </div>}
      <div className={`secondary-dialog-footer flex items-center justify-end gap-2 px-4 ${compact ? "py-1.5 [&>button]:h-7 [&>button]:min-w-20 [&>button]:px-4 [&>button]:text-xs" : "py-2"}`}>
        {current?.kind === "choice" ? current.options.map((option) => <Button key={option.value} onClick={() => close(option.value)}>{option.label}</Button>) : <Button autoFocus={current?.kind === "message"} onClick={ok}>{current?.kind === "confirm" ? t("confirm") : "OK"}</Button>}
        {current?.kind !== "message" && !(current?.kind === "choice" && current.hideCancel) && <Button autoFocus={current?.kind === "confirm"} variant="ghost" onClick={() => close(null)}>{t("cancel")}</Button>}
      </div>
    </DialogContent>
  </Dialog>;
}

import { vobArtwork } from "@/lib/vob-artwork";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

export function VobAboutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="vob-about-dialog max-w-[min(28rem,calc(100vw-2rem))] gap-0 overflow-hidden rounded-sm p-0">
      <DialogTitle className="catalog-panel-heading px-4 py-3 pr-10 text-sm">{t("about")}</DialogTitle>
      <div className="vob-about-stage relative flex flex-col items-center overflow-hidden bg-titlebar px-6 py-9">
        <div aria-hidden="true" className="vob-about-scan pointer-events-none absolute inset-0" />
        <div className="vob-about-emblem relative flex h-24 w-24 items-center justify-center">
          <span aria-hidden="true" className="vob-about-frame absolute inset-0 border-2 border-ribbon-dark/40" />
          <img src={vobArtwork.app} alt="" className="h-16 w-16 object-contain" />
        </div>
        <span aria-hidden="true" className="vob-about-formula mt-5 font-mono text-xs text-muted-foreground">ƒ(x) · Σ · m² · m³</span>
        <h2 className="vob-about-name mt-2 text-xl font-semibold text-foreground">Allplan VOB Editor</h2>
      </div>
      <DialogDescription className="vob-about-credits whitespace-pre-line px-4 py-6 text-center text-xs leading-6 text-foreground">{"Application créée par MAUGER Jean-François\nCopyright (c) ALLPLAN GmbH - All rights reserved"}</DialogDescription>
      <div className="secondary-dialog-footer flex justify-center px-4 py-2"><Button autoFocus onClick={() => onOpenChange(false)}>OK</Button></div>
    </DialogContent>
  </Dialog>;
}
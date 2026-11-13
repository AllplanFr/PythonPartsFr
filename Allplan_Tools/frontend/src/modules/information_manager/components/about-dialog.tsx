import { AimBrandIcon } from "@/modules/information_manager/components/aim-brand-icon";
import { useT, type Lang } from "@/modules/information_manager/lib/i18n";
import { aimUiText } from "@/modules/information_manager/lib/aim-ui-text";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export function AboutDialog({ onClose, lang }: { onClose: () => void; lang: Lang }) {
  const t = useT();
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="suite-about-dialog max-w-[min(28rem,calc(100vw-2rem))] gap-0 overflow-hidden rounded-sm p-0">
        <DialogTitle className="catalog-panel-heading px-4 py-3 pr-10 text-sm">{t.about}</DialogTitle>
        <div className="relative flex flex-col items-center overflow-hidden bg-titlebar px-6 py-9">
          <span aria-hidden className="suite-about-scan pointer-events-none absolute inset-0" />
          <div className="suite-about-emblem relative flex size-24 items-center justify-center">
            <span aria-hidden className="suite-about-frame absolute inset-0 border-2 border-ribbon-dark/40" />
            <AimBrandIcon className="size-16" label="Allplan Information Manager" />
          </div>
          <span className="suite-about-name mt-5 text-xl font-semibold text-foreground">AIM</span>
          <h2 className="suite-about-name mt-2 text-lg font-semibold text-foreground">Allplan Information Manager</h2>
          <p className="suite-about-name mt-2 text-xs text-muted-foreground">{t.aboutTag}</p>
        </div>
        <DialogDescription className="suite-about-credits px-4 py-6 text-center text-xs leading-6 text-foreground">
          {t.aboutBy}<br /><strong>MAUGER Jean-François</strong><br />{aimUiText(lang).copyright}
        </DialogDescription>
        <div className="secondary-dialog-footer flex justify-center px-4 py-2"><Button autoFocus onClick={onClose} className="btn-primary w-[7.25rem]">{t.aboutClose}</Button></div>
      </DialogContent>
    </Dialog>
  );
}

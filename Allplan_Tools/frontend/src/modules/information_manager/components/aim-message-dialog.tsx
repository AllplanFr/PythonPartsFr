import { useAppDialog } from "@/lib/app-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";

export type AimClosePrompt = { title: string; message: string; answer: (choice: "save" | "discard" | null) => void };

/** AIM consumes the existing queue and owns its single save/discard/cancel close decision. */
export function AimMessageDialog({ closePrompt = null }: { closePrompt?: AimClosePrompt | null }) {
  const current = useAppDialog(s => s.queue[0]);
  const close = useAppDialog(s => s.close);
  const [value, setValue] = useState("");
  useEffect(() => () => {
    // Remove before resolving: late handlers cannot resolve a following request.
    const queue = useAppDialog.getState().queue;
    useAppDialog.setState({ queue: [] });
    for (const request of queue) {
      if (request.kind === "choice" || request.kind === "prompt") request.resolve(null);
      else if (request.kind === "confirm") request.resolve(false);
      else request.resolve();
    }
  }, []);
  useEffect(() => { if (current?.kind === "prompt") setValue(current.value); }, [current]);
  if (closePrompt && !current) return <Dialog open onOpenChange={open => { if (!open) closePrompt.answer(null); }}>
    <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
      <DialogTitle className="catalog-panel-heading px-4 py-3 text-sm">{closePrompt.title}</DialogTitle>
      <DialogDescription className="whitespace-pre-line p-4 text-sm text-foreground">{closePrompt.message}</DialogDescription>
      <div className="secondary-dialog-footer flex flex-wrap justify-end gap-2 p-2">
        <Button onClick={() => closePrompt.answer("save")}>Enregistrer et quitter</Button>
        <Button variant="outline" onClick={() => closePrompt.answer("discard")}>Quitter sans enregistrer</Button>
        <Button autoFocus variant="secondary" className="border border-border text-foreground focus-visible:ring-2" onClick={() => closePrompt.answer(null)}>Annuler</Button>
      </div>
    </DialogContent>
  </Dialog>;
  if (!current) return null;
  const answer = (result?: string | null) => {
    if (useAppDialog.getState().queue[0] === current) close(result);
  };
  return <Dialog open onOpenChange={open => { if (!open) answer(null); }}>
    <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
      <DialogTitle className="catalog-panel-heading px-4 py-3 text-sm">Allplan Information Manager</DialogTitle>
      <DialogDescription className="whitespace-pre-line p-4 text-sm text-foreground">{current.text}</DialogDescription>
      {current.kind === "prompt" && <Input aria-label="Valeur" value={value} onChange={e => setValue(e.target.value)} className="mx-4 mb-4 w-auto" />}
      <div className="secondary-dialog-footer flex justify-end gap-2 p-2">
        {current.kind === "choice" ? current.options.map(option => <Button key={option.value} variant="outline" onClick={() => answer(option.value)}>{option.label}</Button>) : <Button variant="outline" onClick={() => answer(current.kind === "prompt" ? value : current.kind === "confirm" ? "confirmed" : undefined)}>OK</Button>}
        {current.kind !== "message" && <Button autoFocus variant="ghost" onClick={() => answer(null)}>Annuler</Button>}
      </div>
    </DialogContent>
  </Dialog>;
}
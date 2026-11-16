import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  callPresentation,
  failureKind,
  parseApply,
  parseGet,
  parsePrepare,
  type ConversionReport,
} from "@/modules/information_manager/lib/aim-presentation-contract";

import type { AnyPresentation as Presentation } from "../lib/presentation-tree";
import { presentationTreeAvailable } from "../lib/aim-presentation-contract";
import { getVerifiedAppInfo } from "@/shared/transport/native-binding";
import { parseWorkingPresentation, presentationIdentity } from "../lib/aim-working-contract";
import type { WorkingPresentation, Failure as WorkingFailure } from "../contracts/AIM_PROJECT_MANAGER_CONTRACT";
const compatible = (p: Presentation) =>
  p.configuration.version === 1 || presentationTreeAvailable(presentationIdentity(getVerifiedAppInfo()));

export const PRESENTATION_UNAVAILABLE =
  "Migration d'une ancienne présentation disponible uniquement avec l'application Python compatible.";

type Err = { code: string; message: string; report: ConversionReport | null };
type Phase =
  | { k: "preparing" }
  | { k: "confirm"; token: string; candidate: Presentation }
  | { k: "applying"; token: string; candidate: Presentation }
  | { k: "error"; err: Err; token?: string; candidate?: Presentation };

const errText = (e: Err) => `${e.message || e.code} (${e.code})`;
const invalid = (): Err => ({
  code: "invalid_response",
  message: "Réponse Python incompatible avec le contrat de présentation 1.",
  report: null,
});
const transport = (): Err => ({
  code: "transport_error",
  message: "Échec de la communication avec l'application Python.",
  report: null,
});

export const IMPORT_CONFIRM = "Voulez-vous vraiment écraser la présentation actuelle ?";
const SHORT_ERROR: Record<string, string> = {
  integration: "Import impossible : l'application Python n'a pas pu lire ce fichier.",
  incompatible: "Fichier incompatible : la présentation actuelle est conservée.",
  retry: "Import interrompu : la présentation actuelle est conservée.",
  conversion: "Conversion impossible : la présentation actuelle est conservée.",
  stale: "Import expiré : relancez l'import.",
  export: "Import interrompu : la présentation actuelle est conservée.",
  other: "Import impossible : la présentation actuelle est conservée.",
};

/**
 * Native presentation import (contract 1). Mounting runs prepare({}) directly: Python opens its native file picker,
 * no intermediate window is shown. A prepared candidate is never mounted before "Écraser"; "Annuler" cancels the token
 * and keeps the current presentation intact; a failure keeps the current state and shows a short message.
 */
export function PresentationImportDialog({
  onApplied,
  onClose,
  working = false,
  onSynchronize,
  applyWorking,
}: {
  onApplied: (p: Presentation) => void;
  onClose: () => void;
  working?: boolean;
  onSynchronize?: (() => Promise<void>) | undefined;
  applyWorking?: ((token: string) => Promise<{ok:true;status:"applied";presentation:WorkingPresentation} | WorkingFailure | null>) | undefined;
}) {
  const [phase, setPhase] = useState<Phase>({ k: "preparing" });
  const busy = useRef(false);
  const started = useRef(false);
  // Late replies (after unmount/close) never touch the editor: Python's state is reconciled later through presentation.get.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const prepare = async () => {
    if (busy.current) return;
    busy.current = true;
    setPhase({ k: "preparing" });
    try {
      const raw = await callPresentation("presentation.import.prepare", {});
      const o = working ? (() => {
        const r = parseWorkingPresentation("presentation.import.prepare", raw);
        if (r?.ok === true && r.status === "cancelled") return {kind:"cancelled" as const};
        if (r?.ok === true && r.status === "prepared") return {kind:"prepared" as const, token:r.token,candidate:r.candidate as Presentation};
        if (r?.ok === false) return {kind:"failure" as const,code:r.error.code,message:r.error.message,report:r.report ?? null};
        return {kind:"invalid" as const};
      })() : parsePrepare(raw);
      if (working && alive.current) await onSynchronize?.();
      if (!alive.current) {
        if (o.kind === "prepared")
          void callPresentation("presentation.import.cancel", { token: o.token }).catch(() => {});
        return;
      }
      if (o.kind === "cancelled") {
        onClose();
        return;
      }
      if (o.kind === "prepared" && compatible(o.candidate))
        setPhase({ k: "confirm", token: o.token, candidate: o.candidate });
      else setPhase({ k: "error", err: o.kind === "failure" ? o : invalid() });
    } catch {
      if (alive.current) setPhase({ k: "error", err: transport() });
    } finally {
      busy.current = false;
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      void prepare();
    }
  }, []);

  const tokenOf = () => ("token" in phase ? phase.token : undefined);
  const cancel = async () => {
    // Applying: the reply decides; closing now could hide an apply already performed by Python.
    if (busy.current || phase.k === "applying") return;
    const token = tokenOf();
    if (!working) onClose();
    if (token) {
      try {
        await callPresentation("presentation.import.cancel", { token });
        if (working) await onSynchronize?.();
      } catch {
        /* candidate stays unapplied */
      }
    }
    if (working && alive.current) onClose();
  };

  const apply = async (token: string, candidate: Presentation) => {
    if (busy.current) return;
    busy.current = true;
    setPhase({ k: "applying", token, candidate });
    try {
      let raw: unknown;
      try {
        if (working) {
          raw = await applyWorking?.(token);
          if (raw === null || raw === undefined) { if (alive.current) setPhase({ k:"confirm",token,candidate }); return; }
        } else raw = await callPresentation("presentation.import.apply", { token });
      } catch {
        if (!alive.current) return;
        if (working) {
          try { await onSynchronize?.(); } catch { /* last confirmed work stays visible */ }
          if (alive.current) setPhase({ k: "error", err: transport() });
          return;
        }
        // Lost acknowledgement: check the last applied import, never reuse the token blindly.
        try {
          const g = parseGet(await callPresentation("presentation.get", {}));
          if (!alive.current) return;
          if (
            g.kind === "current" &&
            compatible(g.presentation) &&
            g.presentation.configuration.configurationId === candidate.configuration.configurationId
          ) {
            onApplied(g.presentation);
            onClose();
            return;
          }
        } catch {
          /* fall through */
        }
        if (alive.current) setPhase({ k: "error", err: transport() });
        return;
      }
      if (!alive.current) return;
      const wr = working ? parseWorkingPresentation("presentation.import.apply", raw) : null;
      const o = working
        ? wr?.ok === true && wr.status === "applied"
          ? {kind:"applied" as const,presentation:wr.presentation as Presentation}
          : wr?.ok === false && wr.error ? {kind:"failure" as const,code:wr.error.code,message:wr.error.message,report:null} : {kind:"invalid" as const}
        : parseApply(raw);
      if (o.kind === "applied" && compatible(o.presentation)) {
        onApplied(o.presentation);
        onClose();
        return;
      }
      setPhase({ k: "error", err: o.kind === "failure" ? o : invalid() });
    } finally {
      busy.current = false;
    }
  };

  // Python's native picker is open: nothing is drawn over the editor.
  if (phase.k === "preparing") return null;
  const errPhase = phase.k === "error" ? phase : null;
  const view = phase.k === "confirm" || phase.k === "applying" ? phase : null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30"
      role="presentation"
      onKeyDown={(e) => {
        if (e.key === "Escape") void cancel();
      }}
    >
      <div
        role={errPhase ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-label={errPhase ? "Import de présentation" : IMPORT_CONFIRM}
        className="w-[420px] max-w-[95vw] rounded-sm border border-border bg-background text-sm shadow-lg"
      >
        <div className="catalog-panel-heading px-3 py-2 text-xs font-bold">Information Manager</div>
        <p role={errPhase ? "alert" : undefined} className="p-4">
          {errPhase ? SHORT_ERROR[failureKind(errPhase.err.code)] : IMPORT_CONFIRM}
        </p>
        {errPhase && (
          <p className="sr-only" data-error-code={errPhase.err.code}>
            {errText(errPhase.err)}
          </p>
        )}
        <div className="secondary-dialog-footer flex justify-end gap-2 border-t border-border px-3 py-2">
          {view && (
            <Button
              variant="outline"
              autoFocus
              disabled={phase.k === "applying"}
              onClick={() => void apply(view.token, view.candidate)}
              className="aim-dialog-button"
            >
              Écraser
            </Button>
          )}
          <Button
            variant="ghost"
            autoFocus={!!errPhase}
            disabled={phase.k === "applying"}
            onClick={() => void cancel()}
            className="aim-dialog-button"
          >
            {errPhase ? "Fermer" : "Annuler"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export { OrganizedPresentationView } from "./organized-presentation";

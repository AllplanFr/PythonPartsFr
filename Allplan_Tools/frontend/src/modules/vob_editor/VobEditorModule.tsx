import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { VobEditorPage } from "@/components/editor/VobEditorPage";
import { askChoice, showMessage } from "@/lib/app-dialog";
import { useCatalog } from "@/lib/catalog-store";
import { useVobResources, vobDirtyPaths } from "@/lib/vob-resources";
import { vobSaveFiles, vobSwitch, useVobHost } from "@/lib/vob-bridge";
import { useVobEditor } from "@/lib/vob-editor";
import { shouldBlockLeave, useLeaveGuard, type LeavePolicy } from "@/suite/leave-guard";
import { detectNativeBinding } from "@/shared/transport/native-binding";
import { onHostEvent, request, isCommandUnavailable, onUnavailableChange } from "@/lib/host-bridge";
import { VobCloseCoordinator, VOB_CLOSE_COMMANDS, vobCloseAvailable } from "@/lib/vob-close";

/** VOB module entry: unchanged editor plus the suite leave guard covering every dirty VOB file of the session. */
export function VobEditorModule({ native }: { native: boolean }) {
  const navigate = useNavigate();
  const closing = useRef(false);
  const policy: LeavePolicy = {
    isDirty: () => vobDirtyPaths().length > 0,
    ask: async () => {
      const fr = useCatalog.getState().lang === "fr", n = vobDirtyPaths().length;
      const options = [{ value: "leave", label: fr ? "Quitter sans enregistrer" : "Leave without saving" }];
      // Save is offered only with a native host: it must be confirmed by Python for every file.
      if (native) options.unshift({ value: "save", label: fr ? `Enregistrer (${n})` : `Save (${n})` });
      const v = await askChoice(fr ? `${n} fichier(s) VOB modifié(s) non enregistré(s). Fermer la fenêtre perd ces modifications ; quitter vers l’accueil les conserve dans cet onglet.` : `${n} modified VOB file(s) not saved. Closing the window loses these changes; leaving for home keeps them in this tab.`, options);
      return v === "save" || v === "leave" ? v : "stay";
    },
    save: native ? () => vobSaveFiles(vobDirtyPaths()) : undefined,
  };
  const policyRef = useRef(policy); policyRef.current = policy;
  const [coordinator] = useState(() => new VobCloseCoordinator({
    call: (command, payload) => request(command, payload),
    ask: async () => {
      const fr = useCatalog.getState().lang === "fr";
      return await askChoice(fr ? "Voulez-vous quitter l’application ou retourner en édition ?" : "Do you want to quit the application or return to editing?", [
        { value: "quit", label: fr ? "Quitter" : "Quit" },
        { value: "stay", label: fr ? "Retourner en édition" : "Return to editing" },
      ], true) === "quit";
    },
    blockLeave: (isCurrent) => shouldBlockLeave({ ...policyRef.current, save: native ? () => vobSaveFiles(vobDirtyPaths(), isCurrent) : undefined }),
    report: (error) => showMessage(error instanceof Error ? error.message : String(error)),
    // From VOB & resources: open the picked file (the manager has a single selection), else return to the
    // current/last edited file or the main view. vobSwitch keeps its save guard; a failure keeps the manager open.
    stayed: async (preserveDocument) => {
      const resources = useVobResources.getState(); if (!resources.manager) return;
      if (preserveDocument) { useVobResources.setState({ manager: false }); return; }
      // No active file: the last edited file is the first entry of Python's recent-files list.
      const target = resources.picked ?? (useVobEditor.getState().file ? null : useVobHost.getState().recentFiles[0] ?? null);
      if (target && !(await vobSwitch(target))) return;
      useVobResources.setState({ manager: false });
    },
  }));
  const identifiedInfo = useRef<unknown>(null);
  const listenerReady = useRef(false);
  const syncClose = () => {
    const available = listenerReady.current && native && vobCloseAvailable(identifiedInfo.current) && VOB_CLOSE_COMMANDS.every((command) => !isCommandUnavailable(command));
    coordinator.setEnabled(available);
    return available;
  };
  useEffect(() => {
    const off = onHostEvent("vob.close_requested", (payload) => coordinator.receive(payload));
    listenerReady.current = true;
    const offUnavailable = onUnavailableChange(syncClose);
    const ready = () => { if (syncClose()) void coordinator.ready(); };
    window.addEventListener("pywebviewready", ready);
    window.addEventListener("allplan-launcher-ready", ready);
    ready();
    return () => { listenerReady.current = false; off(); offUnavailable(); window.removeEventListener("pywebviewready", ready); window.removeEventListener("allplan-launcher-ready", ready); coordinator.setEnabled(false); };
  }, [coordinator, native]);
  const onIdentified = (info: unknown) => { identifiedInfo.current = info; if (syncClose()) void coordinator.ready(); };
  useLeaveGuard(policy);
  const close = async () => {
    if (closing.current) return;
    closing.current = true;
    try {
      // Browser navigation already invokes the route guard. Native windows never go home.
      const nativeWindow = native || detectNativeBinding().kind !== "browser";
      if (!nativeWindow && !window.opener) { await navigate({ to: "/" }); return; }
      if (syncClose()) { await coordinator.request(); return; }
      if (await shouldBlockLeave(policy)) return;
      // Older hosts retain data and their existing native cross; never force a close.
      const fr = useCatalog.getState().lang === "fr";
      showMessage(fr ? "Quitter depuis ce bouton est temporairement indisponible : l’hôte Python n’annonce pas les quatre commandes de fermeture. L’éditeur et vos données restent accessibles ; la croix native n’est pas encore raccordée à ce dialogue." : "Quitting from this button is temporarily unavailable: the Python host does not announce all four close commands. The editor and your data remain accessible; the native window close button is not yet connected to this dialog.");
    } finally { closing.current = false; }
  };
  return <VobEditorPage onClose={close} onHostIdentified={onIdentified} />;
}

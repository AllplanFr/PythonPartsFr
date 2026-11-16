import { AppMessageDialog } from "@/components/editor/AppMessageDialog";
import { FolderBatchDialog } from "@/components/editor/FolderBatchDialog";
import { InsertionDialog } from "@/components/editor/InsertionDialog";
import { LinkDialog } from "@/components/editor/LinkDialog";
import { AppTooltips } from "@/components/editor/AppTooltips";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { TitleBar, Ribbon, StatusBar, saveJSON } from "@/components/editor/Chrome";
import { TreePanel } from "@/components/editor/TreePanel";
import { PropertyPanel } from "@/components/editor/PropertyPanel";
import { CatalogManager } from "@/components/editor/CatalogManager";
import { useCatalog } from "@/lib/catalog-store";
import { useTemplates } from "@/lib/templates";
import { connectSettings } from "@/lib/app-settings";
import { askChoice } from "@/lib/app-dialog";
import { useLeaveGuard } from "@/suite/leave-guard";

import { useFormulaFavorites } from "@/lib/formula-favorites";
const FormulaFavoriteDialog = lazy(() => import("@/components/editor/FormulaFavoriteDialog").then((module) => ({ default: module.FormulaFavoriteDialog })));
const FormulaApplyDialog = lazy(() => import("@/components/editor/FormulaFavoriteDialog").then((module) => ({ default: module.FormulaApplyDialog })));

import { useExternalLibraries } from "@/lib/external-libraries";

import { useCatalogBackups } from "@/lib/catalog-backups";

const TemplateDialog = lazy(() => import("@/components/editor/TemplateDialog").then((module) => ({ default: module.TemplateDialog })));

const ExternalLibraryDialog = lazy(() => import("@/components/editor/ExternalLibraryDialog").then((module) => ({ default: module.ExternalLibraryDialog })));

const BackupDialog = lazy(() => import("@/components/editor/BackupDialog").then((module) => ({ default: module.BackupDialog })));

/** SmartCatalog workspace, unchanged from the former "/" route; mounted only by /smartcatalog. */
export function SmartCatalogApp() {
  const dark = useCatalog((s) => s.dark);
  const view = useCatalog((s) => s.view);
  const templatesOpen = useTemplates((s) => s.open);
  const formulasOpen = useFormulaFavorites((s) => s.open);
  const formulaPending = useFormulaFavorites((s) => s.pending);
  const externalOpen = useExternalLibraries((s) => s.open);
  const backupsOpen = useCatalogBackups((s) => s.open);
  const [split, setSplit] = useState(50);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);
  useEffect(() => connectSettings("smartcatalog"), []);
  // No native catalog save exists yet: leaving keeps the catalog in this tab's memory only, never "saved".
  useLeaveGuard({
    isDirty: () => useCatalog.getState().dirty,
    ask: async () => {
      const fr = useCatalog.getState().lang === "fr";
      const v = await askChoice(fr ? "Le catalogue contient des modifications non enregistrées dans Allplan. Elles restent en mémoire dans cet onglet jusqu’à sa fermeture." : "The catalog has changes not saved to Allplan. They stay in this tab's memory until it closes.", [{ value: "leave", label: fr ? "Quitter sans enregistrer" : "Leave without saving" }]);
      return v === "leave" ? "leave" : "stay";
    },
  });
  useEffect(() => { useTemplates.getState().hydrate(); useFormulaFavorites.getState().hydrate(); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveJSON(); } };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, []);

  const drag = (e: React.MouseEvent) => {
    e.preventDefault();
    const mv = (ev: MouseEvent) => {
      const r = box.current?.getBoundingClientRect();
      if (!r) return;
      setSplit(Math.min(80, Math.max(20, ((ev.clientX - r.left) / r.width) * 100)));
    };
    const up = () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-[13px]">
      <AppTooltips />
      <InsertionDialog />
      <FolderBatchDialog />
      <AppMessageDialog />
      <LinkDialog />
      <TitleBar />
      <Suspense fallback={null}>{backupsOpen && <BackupDialog />}</Suspense>
      {view === "manager" ? <div className="min-h-0 flex-1"><CatalogManager /></div> : (
        <div className="mgr-in flex min-h-0 flex-1 flex-col">
          <Ribbon />
          <div ref={box} className="flex min-h-0 flex-1 px-2 pt-2 pb-3.5">
            <div style={{ width: `${split}%` }} className="min-w-0"><TreePanel /></div>
            <div onMouseDown={drag} className="w-3 shrink-0 cursor-col-resize" />
            <div className="min-w-0 flex-1"><PropertyPanel /></div>
          </div>
        </div>
      )}
      {view !== "manager" && <StatusBar />}
      <Suspense fallback={null}>{templatesOpen && <TemplateDialog />}
      {externalOpen && <ExternalLibraryDialog />}
      {formulasOpen && <FormulaFavoriteDialog />}
      {formulaPending && <FormulaApplyDialog key={`${formulaPending.favorite.id}:${formulaPending.nodeId}:${formulaPending.attribute ?? "all"}`} />}</Suspense>
    </div>
  );
}

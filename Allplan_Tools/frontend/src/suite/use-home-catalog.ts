import { useCallback, useEffect, useRef, useState } from "react";
import type { CatalogEntry, CatalogReplyV2 } from "./contracts/PLUGIN_CATALOG_CONTRACT";
import { isCatalogReplyV2, isUpdateReplyV2 } from "./contracts/plugin-catalog-validate";

type CatalogData = Extract<CatalogReplyV2, { ok: true }>["data"];
type Api = { get_catalog?: unknown; update?: unknown };
export type CatalogPhase = "off" | "unsupported" | "pending" | "ready" | "error";
type State = { phase: CatalogPhase; data: CatalogData | null; updating: string | null; message: string; error: boolean };
const initial: State = { phase: "off", data: null, updating: null, message: "", error: false };

const api = (): Api | undefined => (window as unknown as { pywebview?: { api?: Api } }).pywebview?.api;

/**
 * Optional catalog /2 consultation, started only after the installed inventory is shown.
 * Never touches launch; absent methods, /1 or invalid replies only mean "Update unavailable".
 */
export function useHomeCatalog(enabled: boolean) {
  const [state, setState] = useState<State>(initial);
  const generation = useRef(0);
  const alive = useRef(true);
  const updating = useRef(false);
  const dataRef = useRef<CatalogData | null>(null);

  const consult = useCallback(async () => {
    const host = api();
    if (typeof host?.get_catalog !== "function" || typeof host.update !== "function") {
      setState({ ...initial, phase: "unsupported" });
      return;
    }
    const mine = ++generation.current; // Local generation also guards top-level errors without requestId.
    dataRef.current = null;
    setState((s) => ({ ...s, phase: "pending", data: s.data })); // Old Update buttons disabled while pending.
    let reply: unknown;
    try { reply = await (host.get_catalog as () => Promise<unknown>)(); }
    catch { reply = undefined; }
    if (!alive.current || mine !== generation.current) return;
    if (!isCatalogReplyV2(reply)) { setState((s) => ({ ...s, phase: "unsupported", data: null })); return; }
    if (!reply.ok) { setState((s) => ({ ...s, phase: "error", data: null })); return; }
    if (reply.data.superseded) return; // Ignored entirely; a newer call owns the display.
    const previous = dataRef.current as CatalogData | null;
    if (previous && reply.data.requestId <= previous.requestId) return;
    dataRef.current = reply.data;
    setState((s) => ({ ...s, phase: "ready", data: reply.data }));
  }, []);

  useEffect(() => {
    alive.current = true;
    if (enabled) void consult();
    return () => { alive.current = false; generation.current++; };
  }, [enabled, consult]);

  const update = async (id: string) => {
    const host = api();
    const entry = dataRef.current?.entries.find((e) => e.id === id);
    if (updating.current || state.phase !== "ready" || !entry?.canUpdate || typeof host?.update !== "function") return;
    updating.current = true;
    setState((s) => ({ ...s, updating: id, message: "", error: false }));
    try {
      const reply: unknown = await (host.update as (id: string) => Promise<unknown>)(id);
      if (!alive.current) return;
      if (!isUpdateReplyV2(reply, id)) setState((s) => ({ ...s, error: true, message: "Réponse Update invalide ; état de la demande inconnu." }));
      else if (reply.ok) setState((s) => ({ ...s, error: false, message: "Demande d’ouverture du lien envoyée." }));
      else setState((s) => ({ ...s, error: true, message: reply.error.message }));
    } catch (error) {
      if (alive.current) setState((s) => ({ ...s, error: true, message: `Erreur de communication pendant Update ; état de la demande inconnu : ${error instanceof Error ? error.message : String(error)}` }));
    } finally {
      updating.current = false;
      if (alive.current) setState((s) => ({ ...s, updating: null }));
    }
  };

  const entryFor = (id: string): CatalogEntry | undefined =>
    state.phase === "ready" ? state.data?.entries.find((e) => e.id === id && e.installed) : undefined;
  const notInstalled = state.phase === "ready" && state.data ? state.data.entries.filter((e) => !e.installed && e.inCatalog) : [];
  return { ...state, consult, update, entryFor, notInstalled };
}

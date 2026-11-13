import { useEffect, useRef, useState } from "react";
import { detectNativeBinding } from "@/shared/transport/native-binding";
import { detectHomeService, isHomeInfo, isLaunchReply, type AllplanToolsHomeApi, type HomeInfo, type HomeWindow, type PluginId } from "./contracts/ALLPLAN_TOOLS_HOME_CONTRACT";

export const HOME_WAIT_MS = 15_000;
type State = { mode: "checking" | "browser" | "waiting" | "native" | "unavailable"; info: HomeInfo | null; message: string; error: boolean; launching: boolean };
const initial: State = { mode: "checking", info: null, message: "", error: false, launching: false };

/** Home-only service; never authorizes a module in this window. */
export function useHomeHost(requireNative = false) {
  const [state, setState] = useState<State>(initial);
  const apiRef = useRef<AllplanToolsHomeApi | null>(null);
  const infoRef = useRef<HomeInfo | null>(null);
  const locked = useRef(false);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    let reading = false;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const beginWait = () => {
      if (timer === undefined) timer = setTimeout(() => fail("Service d’ouverture natif indisponible après 15 secondes."), HOME_WAIT_MS);
    };
    const win = window as unknown as HomeWindow;
    const fail = (message: string) => {
      if (cancelled || done) return;
      done = true;
      clearTimeout(timer);
      setState({ ...initial, mode: "unavailable", message, error: true });
    };
    const attempt = async () => {
      if (cancelled || done || reading) return;
      beginWait();
      if (!detectHomeService(win)) {
        setState({ ...initial, mode: "waiting", message: "Connexion à Allplan…" });
        return;
      }
      const api = win.pywebview?.api;
      if (typeof api?.get_home_info !== "function" || typeof api.launch !== "function") return;
      reading = true;
      setState({ ...initial, mode: "waiting", message: "Connexion à Allplan…" });
      try {
        const info: unknown = await api.get_home_info();
        if (cancelled || done) return;
        if (!isHomeInfo(info)) { fail("Informations de l’accueil natif invalides."); return; }
        done = true;
        clearTimeout(timer);
        apiRef.current = api as AllplanToolsHomeApi;
        infoRef.current = info;
        setState({ ...initial, mode: "native", info });
      } catch (error) {
        fail(`Connexion native impossible : ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    window.addEventListener("pywebviewready", attempt);
    if (!requireNative && detectNativeBinding().kind === "browser" && !detectHomeService(win)) {
      setState({ ...initial, mode: "browser" });
    } else void attempt();
    return () => {
      cancelled = true;
      alive.current = false;
      clearTimeout(timer);
      window.removeEventListener("pywebviewready", attempt);
    };
  }, [requireNative]);

  const launch = async (id: PluginId) => {
    const api = apiRef.current;
    const info = infoRef.current;
    if (locked.current || !api || !info || !info.plugins.some((p) => p.id === id && p.available)) return;
    locked.current = true; // Before the first await: block same-tick repeated clicks.
    setState((s) => ({ ...s, launching: true, message: "Lancement en cours…", error: false }));
    try {
      const context = info.context;
      const reply: unknown = await api.launch(id, context.year, context.verification, context.country);
      if (!alive.current) return;
      if (!isLaunchReply(reply)) setState((s) => ({ ...s, error: true, message: "Réponse de lancement native invalide ; état du processus inconnu." }));
      else setState((s) => ({ ...s, error: !reply.ok, message: reply.ok ? "Processus lancé." : reply.error }));
    } catch (error) {
      if (alive.current) setState((s) => ({ ...s, error: true, message: `Erreur de communication pendant le lancement ; état du processus inconnu : ${error instanceof Error ? error.message : String(error)}` }));
    } finally {
      locked.current = false;
      if (alive.current) setState((s) => ({ ...s, launching: false }));
    }
  };
  return { ...state, launch };
}
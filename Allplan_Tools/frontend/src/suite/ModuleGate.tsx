import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { detectNativeBinding, resolveModuleAccess, type ModuleAccess } from "@/shared/transport/native-binding";
import { SUITE_NAME, suiteModule, type SuiteAppId } from "./catalog";

const REASONS: Record<Extract<ModuleAccess, { allowed: false }>["reason"], string> = {
  other_application: "Cette fenêtre Allplan est liée à une autre application. Ouvrez ce module depuis le lanceur Allplan : la suite ne change jamais l’application d’une fenêtre.",
  incompatible_host: "Cette fenêtre ne fournit pas la passerelle attendue par ce module. Aucune commande n’a été envoyée.",
  missing_identity: "La fenêtre Allplan n’a pas fourni l’identité de son application. Le module reste bloqué ; aucune donnée n’a été demandée.",
  identity_error: "La vérification de l’identité de la fenêtre Allplan a échoué. Le module reste bloqué ; aucune donnée n’a été demandée.",
};

/**
 * Resolves the window binding after hydration, verifies the native identity (get_app_info only),
 * then mounts the module. Nothing is mounted — so no settings or business call — before verification.
 */
export function ModuleGate({ appId, children }: { appId: SuiteAppId; children: (access: Extract<ModuleAccess, { allowed: true }>) => ReactNode }) {
  const [access, setAccess] = useState<ModuleAccess | "waiting_identity" | null>(null);
  const [native, setNative] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const binding = detectNativeBinding();
    setNative(binding.kind !== "browser");
    if (binding.kind === "pywebview") setAccess("waiting_identity");
    resolveModuleAccess(appId, { signal: controller.signal }).then(setAccess, () => { /* unmounted: ignored */ });
    return () => controller.abort();
  }, [appId]);
  if (!access || access === "waiting_identity") return <div className="h-screen bg-background" aria-busy="true" data-state={access ?? "detecting"} />;
  if (access.allowed) return <>{children(access)}</>;
  const name = suiteModule(appId).name;
  return (
    <main className="flex h-screen items-center justify-center bg-background p-6 text-[13px] text-foreground">
      <div className="max-w-md border-l-4 border-ribbon-dark bg-panel p-5 shadow-sm">
        <h1 className="mb-2 text-base font-semibold">{name} — indisponible dans cette fenêtre</h1>
        <p className="text-muted-foreground">{REASONS[access.reason]}</p>
        {/* In a native window, leaving would not change its identity; no app.open service is announced. */}
        {!native && <Link to="/" className="mt-4 inline-block text-ribbon-dark underline-offset-4 hover:underline">{SUITE_NAME}</Link>}
      </div>
    </main>
  );
}

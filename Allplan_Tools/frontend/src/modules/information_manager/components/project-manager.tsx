import { attributeTooltip } from "../lib/presentation-display";
import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, FileText, FolderOpen, MoreHorizontal, Plus, RefreshCw, Search, Star, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResourceManagerHeading } from "@/components/editor/ResourceManagerHeading";
import {
  callManager,
  previewColorAvailable,
  assignmentAvailable,
  type ManagerEntry,
  type ManagerPreview,
  type PreviewRow,
} from "../lib/aim-manager-contract";
import projectIcon from "../assets/folder_prj.png";
import allplanIcon from "../assets/allplan.svg";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getVerifiedAppInfo } from "@/shared/transport/native-binding";
import { callManagerMenu, managerMenuAvailable, managerPathKey, type ManagerMenuCommand } from "../lib/aim-manager-menu-contract";
import type { Lang } from "../lib/i18n";
import { classifyProjects } from "../lib/manager-classification";

export function ProjectManager({
  onOpen,
  blocked = false,
  activePath = null,
  lang = "fr",
}: {
  onOpen: (path: string) => Promise<void>;
  onClose: () => void;
  blocked?: boolean;
  activePath?: string | null;
  lang?: Lang;
}) {
  const [projects, setProjects] = useState<ManagerEntry[]>([]);
  const [menuCap] = useState(() => managerMenuAvailable(getVerifiedAppInfo()));
  const [previewColor] = useState(() => previewColorAvailable(getVerifiedAppInfo()));
  const [assignment] = useState(() => assignmentAvailable(getVerifiedAppInfo()));
  const [favorites, setFavorites] = useState<string[]>([]);
  const menuPending = useRef(false);
  const [picked, setPicked] = useState<string | null>(null);
  const pickedRef = useRef<string | null>(null);
  const [preview, setPreview] = useState<ManagerPreview | null>(null);
  const [query, setQuery] = useState("");
  const [version, setVersion] = useState("all");
  const [closed, setClosed] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const openedLabel = { fr: "Ouvert", en: "Open", de: "Geöffnet", it: "Aperto", es: "Abierto", hr: "Otvoreno", ro: "Deschis", ru: "Открыт", cs: "Otevřeno", sl: "Odprto", sk: "Otvorené" }[lang];
  const alive = useRef(true);
  const request = useRef(0);
  const listing = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current++;
      listing.current++;
    };
  }, []);
  const list = async () => {
    const n = ++listing.current;
    setBusy(true);
    setMessage("");
    try {
      const [o, f] = await Promise.all([
        callManager("project.manager.list", {}, { assignment }),
        menuCap ? callManagerMenu("project.manager.favorites.list") : Promise.resolve(null),
      ]);
      if (!alive.current || n !== listing.current) return;
      if (o.kind === "list" && (!menuCap || f?.kind === "favorites")) {
        setProjects(o.projects);
        if (f?.kind === "favorites") setFavorites(f.paths);
        if (!pickedRef.current && activePath) {
          const active = o.projects.find(p => managerPathKey(p.path) === managerPathKey(activePath));
          if (active) { pickedRef.current = active.path; setPicked(active.path); }
        }
      } else setMessage(o.kind === "failure" ? o.message : f?.kind === "failure" ? f.message : "Liste des projets indisponible.");
    } catch {
      if (alive.current && n === listing.current)
        setMessage("Impossible de charger la liste des projets.");
    } finally {
      if (alive.current && n === listing.current) setBusy(false);
    }
  };
  useEffect(() => {
    void list();
  }, []);
  const load = async (path: string) => {
    const n = ++request.current;
    pickedRef.current = path;
    setPicked(path);
    setPreview(null);
    setReading(true);
    setMessage("");
    try {
      const o = await callManager("project.manager.preview", { path }, { previewColor, assignment });
      if (!alive.current || n !== request.current || pickedRef.current !== path) return;
      if (o.kind === "preview" && o.preview.project.path === path) {
        setPreview(o.preview);
        setProjects((entries) =>
          entries.map((p) => (p.path === path ? { ...p, source: o.preview.source, ...(o.preview.projectInstallation ? { projectInstallation: o.preview.projectInstallation } : {}) } : p)),
        );
      } else setMessage(o.kind === "failure" ? o.message : "Aperçu indisponible.");
    } catch {
      if (alive.current && n === request.current) setMessage("Impossible de recharger cet aperçu.");
    } finally {
      if (alive.current && n === request.current) setReading(false);
    }
  };
  const add = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const o = await callManager("project.manager.add", {}, { assignment });
      if (!alive.current) return;
      if (o.kind === "added") await list();
      else if (o.kind !== "cancelled")
        setMessage(o.kind === "failure" ? o.message : "Ajout du projet impossible.");
    } catch {
      if (alive.current) setMessage("Ajout du projet impossible.");
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const favorite = (path: string) => favorites.some((p) => managerPathKey(p) === managerPathKey(path));
  const isOpenProject = (path: string) => !!activePath && managerPathKey(path) === managerPathKey(activePath);
  const removalReason = (path: string) => isOpenProject(path) ? "Impossible de retirer le projet ouvert dans l’éditeur." : menuCap ? undefined : "Action indisponible : le contrat de l’hôte ne l’expose pas.";
  const menuAction = async (command: ManagerMenuCommand, path: string) => {
    if (command === "project.manager.remove" && isOpenProject(path)) {
      setMessage("Impossible de retirer le projet ouvert dans l’éditeur.");
      return;
    }
    if (!menuCap || blocked || busy || menuPending.current) return;
    menuPending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const o = await callManagerMenu(command, command === "project.manager.favorite.set"
        ? { path, favorite: !favorite(path) } : { path });
      if (!alive.current) return;
      if (o.kind === "updated" || o.kind === "folder-opened" || o.kind === "removed") {
        if (o.kind === "removed" && pickedRef.current !== null
          && managerPathKey(pickedRef.current) === managerPathKey(o.path)) {
          request.current++;
          pickedRef.current = null;
          setPicked(null);
          setPreview(null);
          setReading(false);
        }
        await list();
      } else setMessage(o.kind === "failure" ? o.message : "Action impossible. Réessayez.");
    } catch {
      if (alive.current) setMessage("Action impossible. Réessayez.");
    } finally {
      menuPending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  let previewIndex = 0;
  const rows = (r: PreviewRow, group?: string) => (
    <tr key={r.id} tabIndex={0} data-preview-row={r.id} className={previewIndex++ % 2 ? "row-alt" : ""}>
      <td data-tip={attributeTooltip(r, { group })} className="aim-number-column text-muted-foreground">{r.number}</td>
      <td>{r.title ?? "Titre indisponible"}</td>
      <td className="whitespace-pre-wrap">{r.value}</td>
    </tr>
  );
  const { versions, groups } = classifyProjects(projects, query, version);
  const missing = "Action indisponible : le contrat de l’hôte ne l’expose pas.";
  return (
    <div
      className="mgr-in flex min-h-0 flex-1 gap-3 bg-background px-4 py-3"
      aria-label="Project Information manager"
    >
      <section className="flex min-h-0 w-1/2 min-w-0 flex-col border border-border bg-background">
        <ResourceManagerHeading
          title="Project Information manager"
          icon={<img src={projectIcon} alt="" className="size-4 shrink-0" />}
        >
          <Button variant="outline" size="sm" className="aim-manager-list-action" disabled={busy} onClick={() => void list()}>
            <RefreshCw className="size-3.5" />
            Actualiser la liste
          </Button>
        </ResourceManagerHeading>
        <div
          className="flex flex-wrap items-center gap-2 border-b border-border p-2"
          data-no-toolbar-drag
        >
          <select
            aria-label="Version Allplan"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            className="field h-8 text-xs"
          >
            <option value="all">Toutes les versions</option>
            {versions.map((v) => (
              <option key={v} value={v}>
                Allplan {v}
              </option>
            ))}
          </select>
          <div className="flex min-w-32 flex-1 items-center border border-border">
            <Search className="ml-2 size-4 text-muted-foreground" />
            <Input
              aria-label="Rechercher un projet"
              placeholder="Rechercher un projet ou un chemin…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 border-0 text-xs"
            />
          </div>
          <Button variant="outline" size="sm" className="aim-manager-list-action" disabled={busy || blocked} onClick={() => void add()}>
            <Plus className="size-4" />
            Ajouter des projets
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {groups.map((g) => <Fragment key={g.key}>
            <Button variant="ghost" aria-expanded={!closed.includes(g.key)} onClick={() => setClosed((old) => old.includes(g.key) ? old.filter((key) => key !== g.key) : [...old, g.key])} className="sticky top-0 z-10 flex h-8 w-full justify-start gap-2 rounded-none bg-panel px-2 text-xs">
              {closed.includes(g.key) ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
              {g.key === "user" ? <UserRound className="size-4 text-ribbon-dark" /> : <img src={allplanIcon} alt="" className="size-4" />}<span>{g.label}</span><span className="text-muted-foreground">({g.entries.length})</span>
            </Button>
          {!closed.includes(g.key) && g.entries.map((p, i) => (
            <div key={p.path} data-project-path={p.path} onContextMenu={e => { e.preventDefault(); setMenuPath(`${g.key}:${p.path}`); }} className={`group flex h-9 items-center text-xs ${picked === p.path ? "catalog-selected-row bg-selection" : i % 2 ? "bg-row-alt" : "bg-background"}`}>
            <Button
              variant="native"
              size="native"
              disabled={blocked || busy}
              aria-label={p.name}
              aria-pressed={picked === p.path}
              onClick={() => void load(p.path)}
              onDoubleClick={() => { if (!blocked) void onOpen(p.path); }}
              className="flex h-full min-w-0 flex-1 justify-start gap-2 rounded-none pl-8 pr-2 text-xs font-normal"
            >
              <img src={projectIcon} alt="" className="size-4 shrink-0" />
              <span className="truncate" title={p.path}>
                {p.name}
              </span>
              {p.projectInstallation?.status !== "associated" && p.projectInstallation?.status !== "unassociated" && <span className="text-muted-foreground" title="Appartenance au PRJ inconnue">Appartenance inconnue</span>}
            </Button>
            {activePath && managerPathKey(activePath) === managerPathKey(p.path) && <span className="aim-open-badge shrink-0">{openedLabel}</span>}
            <span className="flex shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
              <span title={menuCap ? (favorite(p.path) ? "Retirer de mes favoris" : "Ajouter à mes favoris") : missing}><Button variant="ghost" size="icon" className="size-7" disabled={!menuCap || blocked || busy} aria-pressed={favorite(p.path)} aria-label={`${favorite(p.path) ? "Retirer de" : "Ajouter à"} mes favoris : ${p.name}`} onClick={() => void menuAction("project.manager.favorite.set", p.path)}><Star className={`size-3.5 text-muted-foreground ${favorite(p.path) ? "fill-current" : ""}`} /></Button></span>
              <DropdownMenu open={menuPath === `${g.key}:${p.path}`} onOpenChange={open => setMenuPath(open ? `${g.key}:${p.path}` : null)}><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-7" aria-label={`Actions pour ${p.name}`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent className="w-60 rounded-sm">
                  <DropdownMenuItem disabled={blocked || busy} onSelect={() => void onOpen(p.path)}><FolderOpen className="size-4 text-ribbon-dark" />Ouvrir dans l’éditeur</DropdownMenuItem>
                  <DropdownMenuItem disabled={blocked || busy || reading} onSelect={() => void load(p.path)}><RefreshCw className="size-4 text-ribbon-dark" />Actualiser l’aperçu</DropdownMenuItem>
                  <DropdownMenuItem disabled={!menuCap || blocked || busy} title={menuCap ? undefined : missing} onSelect={() => void menuAction("project.manager.favorite.set", p.path)}><Star className="size-4 text-ribbon-dark" />{favorite(p.path) ? "Retirer de mes favoris" : "Ajouter à mes favoris"}</DropdownMenuItem>
                  <DropdownMenuItem disabled={!menuCap || blocked || busy} title={menuCap ? undefined : missing} onSelect={() => void menuAction("project.manager.folder.open", p.path)}><FolderOpen className="size-4 text-ribbon-dark" />Ouvrir le dossier du projet</DropdownMenuItem>
                  <DropdownMenuItem disabled={!menuCap || blocked || busy || isOpenProject(p.path)} title={removalReason(p.path)} onSelect={() => void menuAction("project.manager.remove", p.path)}><X className="size-4 text-ribbon-dark" />Retirer de la liste…</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled={busy || blocked} onSelect={() => void add()}><Plus className="size-4 text-ribbon-dark" />Ajouter des projets</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <span title={removalReason(p.path) ?? "Retirer de la liste"}><Button variant="ghost" size="icon" className="mr-1 size-7" disabled={!menuCap || blocked || busy || isOpenProject(p.path)} aria-label={`Retirer de la liste : ${p.name}`} onClick={() => void menuAction("project.manager.remove", p.path)}><X className="size-3.5" /></Button></span>
            </span>
            </div>
          ))}</Fragment>)}
        </div>
        {message && (
          <p role="alert" className="p-3 text-xs text-destructive">
            {message}
          </p>
        )}
      </section>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col border border-border bg-background">
        <ResourceManagerHeading title="Aperçu">
          <Button
            variant="outline"
            size="sm"
            disabled={!picked || reading || blocked || busy}
            onClick={() => {
              if (picked) void load(picked);
            }}
          >
            <RefreshCw className={`size-3.5 ${reading ? "animate-spin" : ""}`} />
            Actualiser l’aperçu
          </Button>
        </ResourceManagerHeading>
        <div
          aria-label="Aperçu du projet"
          className="min-h-0 flex-1 overflow-auto"
          onDoubleClick={() => {
            if (preview && !blocked && !reading && !busy) void onOpen(preview.project.path);
          }}
        >
          {preview ? (
            <>
              <header className="border-b border-border px-3 py-2 text-xs">
                <p className="font-semibold">{preview.project.name}</p>
                <p className="truncate text-muted-foreground" title={preview.project.path}>
                  {preview.project.path}
                </p>
              </header>
              <table className="aim-organized-table aim-manager-preview w-full text-sm">
                <thead className="catalog-panel-heading">
                  <tr>
                    <th>N°</th>
                    <th>Titre</th>
                    <th>Valeur</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.items.map((item) =>
                    item.kind === "row" ? (
                      rows(item)
                    ) : (
                      <Fragment key={item.id}>
                        <tr
                          className="aim-organized-group"
                          data-group-color={previewColor ? item.backgroundColor : undefined}
                          style={previewColor && item.backgroundColor ? { ["--aim-group-accent" as string]: item.backgroundColor } : undefined}
                        >
                          <td colSpan={3} className="text-center font-semibold">
                            {item.title}
                          </td>
                        </tr>
                        {item.rows.map(r => rows(r, item.title))}
                      </Fragment>
                    ),
                  )}
                </tbody>
              </table>
            </>
          ) : (
            <div className="flex h-full items-center justify-center">
              <span role="status">
                {reading ? (
                  "Lecture du projet…"
                ) : (
                  <FileText className="size-24 text-ribbon-dark" strokeWidth={1} />
                )}
              </span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

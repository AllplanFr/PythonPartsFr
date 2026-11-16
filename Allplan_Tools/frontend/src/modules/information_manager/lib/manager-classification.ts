import type { ManagerEntry } from "./aim-manager-contract";
export function classifyProjects(projects: ManagerEntry[], query = "", version = "all") {
  const installationKey = (p: ManagerEntry) => p.projectInstallation?.status === "associated" ? JSON.stringify([p.projectInstallation.version, p.projectInstallation.verificationVersion, p.projectInstallation.prjPath]) : null;
  const versions = [...new Set(projects.flatMap(p => p.projectInstallation?.status === "associated" ? [p.projectInstallation.version] : []))];
  const visible = projects.filter(p => `${p.name} ${p.path}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && (version === "all" || (p.projectInstallation?.status === "associated" && p.projectInstallation.version === version)));
  const user = { key: "user", label: "Ajoutés par l’utilisateur", entries: visible.filter(p => p.projectInstallation?.status !== "associated") };
  const keys = [...new Set(visible.map(installationKey).filter((k): k is string => k !== null))];
  const installations = keys.map(key => {
    const entries = visible.filter(p => installationKey(p) === key);
    const assignment = entries[0]?.projectInstallation;
    const label = assignment?.status === "associated" ? `Allplan ${assignment.version}${assignment.verificationVersion ? " · Vérification" : ""}` : "";
    return { key, label, entries };
  });
  return { versions, groups: [user, ...installations] };
}
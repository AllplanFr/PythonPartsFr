from pathlib import Path
from threading import RLock
import os
import re
import stat
import time
import hashlib


class VobEditorAllplanDatas:
    def __init__(self, paths, *, catalog_user_path=None, max_file_bytes=16777216):
        self._paths = paths
        self._catalog = catalog_user_path
        self._projects = {}
        self._max = max_file_bytes
        self._lock = RLock()

    def get_context(self):
        return self._paths.to_dict()

    def load_references(self):
        from .references import load_references
        return load_references(self._paths.paths.get("STD"))

    @staticmethod
    def _project_key(path):
        return hashlib.sha256(
            os.path.normcase(str(path)).encode("utf-8")
        ).hexdigest()[:16]

    def set_projects(self, project_paths):
        projects = {}
        for raw in project_paths:
            project = self._directory(raw)
            projects[self._project_key(project)] = project
        with self._lock:
            self._projects = projects

    def resolve_project_path(self, requested):
        project = self._directory(requested)
        configured_root = self._paths.paths.get("PRJ")
        if configured_root is None:
            raise ValueError("Le dossier PRJ n’est pas configuré.")
        root = self._directory(configured_root)
        if project.parent != root:
            raise ValueError(
                "Sélectionnez un dossier de projet directement dans la racine PRJ."
            )
        return project

    def get_project_root(self):
        return self._paths.paths.get("PRJ")

    def _roots(self):
        if int(self._paths.version) < 2027: return [('etc', self._paths.paths.get('ETC'))]
        return [
            ('project', self._catalog),
            *((f'project:{key}', path) for key, path in self._projects.items()),
            ('std', self._paths.paths.get('STD')),
            ('etc', self._paths.paths.get('ETC')),
        ]

    @staticmethod
    def _linked(p):
        return p.is_symlink() or bool(getattr(p.lstat(), 'st_file_attributes', 0) & 0x400)

    @classmethod
    def _directory(cls, raw):
        if raw is None or not str(raw).strip(): raise ValueError('Dossier non configure')
        p = Path(raw)
        if not p.is_absolute() or '..' in p.parts: raise ValueError('Chemin absolu sans .. requis')
        for item in (p, *p.parents):
            if cls._linked(item): raise ValueError('Lien ou point de reanalyse refuse')
        if not p.is_dir(): raise ValueError('Dossier absent ou inaccessible')
        return p.resolve(strict=True)

    def _filename(self):
        if not re.fullmatch('[A-Z]{3}', self._paths.country): raise ValueError('Pays Allplan requis pour 2027+')
        return f'vob_{self._paths.country}.dat'

    def get_vob_roots(self):
        roots = {}
        for label, raw in self._roots():
            try:
                roots[label] = self._directory(raw)
            except (OSError, ValueError, RuntimeError):
                # list_vob_files reports configuration diagnostics.
                continue
        return roots

    def get_installation_roots(self):
        return tuple(
            Path(raw).expanduser().resolve(strict=False)
            for raw in self._paths.paths.values()
            if raw is not None
        )

    def get_classification_roots(self):
        roots = []
        for source in ("ETC", "STD"):
            raw = self._paths.paths.get(source)
            if raw is not None:
                roots.append((source, Path(raw).expanduser().resolve(strict=False), None))
        if int(self._paths.version) >= 2027:
            if self._catalog is not None:
                project = Path(self._catalog).expanduser().resolve(strict=False)
                roots.append(("PRJ", project, project))
            with self._lock:
                projects = tuple(self._projects.values())
            roots.extend(("PRJ", project, project) for project in projects)
        return tuple(roots)

    def list_vob_files(self, *, max_files=2000, max_entries=20000, timeout=5.0):
        if not (1 <= max_files <= 10000 and 1 <= max_entries <= 100000 and 0 < timeout <= 60): raise ValueError(
            'Limites invalides')
        files, warnings, seen = [], [], set()
        visited = 0;
        truncated = False;
        deadline = time.monotonic() + timeout
        try:
            filename = self._filename() if int(self._paths.version) >= 2027 else None
        except ValueError as e:
            return dict(files=[], warnings=[str(e)], truncated=False, entries_visited=0)

        def add(p, label):
            if self._linked(p) or not p.is_file(): return
            p = p.resolve(strict=True);
            key = os.path.normcase(str(p))
            if key not in seen:
                seen.add(key);
                item = dict(id=label + '/' + p.name, name=p.name, path=str(p), root=label)
                if label.startswith('project'):
                    item['projectName'] = p.parent.name
                    item['projectPath'] = str(p.parent)
                files.append(item)

        with self._lock:
            for label, raw in self._roots():
                if time.monotonic() >= deadline or visited >= max_entries or len(files) >= max_files:
                    truncated = True;
                    break
                try:
                    d = self._directory(raw)
                    if filename:
                        visited += 1;
                        p = d / filename
                        if p.exists(): add(p, label)
                    else:
                        with os.scandir(d) as entries:
                            for entry in entries:
                                if time.monotonic() >= deadline or visited >= max_entries or len(files) >= max_files:
                                    truncated = True;
                                    break
                                visited += 1
                                if entry.name.lower().startswith('vo'):
                                    try:
                                        add(Path(entry.path), label)
                                    except (OSError, ValueError, RuntimeError) as e:
                                        if len(warnings) < 100: warnings.append(str(e))
                except (OSError, ValueError, RuntimeError) as e:
                    warnings.append(label + ': ' + str(e))
        return dict(files=files, warnings=warnings, truncated=truncated, entries_visited=visited)

    def resolve_file(self, requested, *, selected=False, allow_new=False):
        p = Path(requested)
        if not p.is_absolute() or '..' in p.parts or ':' in p.name:
            raise ValueError('Chemin invalide')
        for part in (p, *p.parents):
            if allow_new and part == p and not p.exists():
                continue
            if self._linked(part):
                raise ValueError('Lien refuse')
        p = p.resolve(strict=not allow_new)
        if not selected:
            valid = (
                p.name.lower().startswith('vo') if int(self._paths.version) < 2027
                else p.name.lower() == self._filename().lower()
            )
            if p.parent not in self.get_vob_roots().values() or not valid:
                raise ValueError('Fichier non autorise')
        elif not p.name.lower().startswith('vo'):
            raise ValueError('Nom vo* requis')
        if not p.is_file() and not (allow_new and not p.exists() and p.parent.is_dir()):
            raise ValueError('Fichier non regulier ou dossier absent')
        return p

    def read_vob_bytes(self, requested, *, selected=False):
        with self._lock:
            p = self.resolve_file(requested, selected=selected)
            with p.open('rb') as h:
                before = os.fstat(h.fileno())
                if not stat.S_ISREG(before.st_mode) or before.st_size > self._max: raise ValueError(
                    'Fichier trop volumineux ou non regulier')
                data = h.read(self._max + 1);
                after = os.fstat(h.fileno())
            if len(data) > self._max or (before.st_size, before.st_mtime_ns) != (after.st_size,
                                                                                 after.st_mtime_ns): raise OSError(
                'Taille depassee ou fichier modifie')
            return data

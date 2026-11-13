"""Detection en lecture seule ; aucun import Qt ni API Allplan native."""
import os
import re
from pathlib import Path
from dataclasses import dataclass, field
from xml.etree.ElementTree import ParseError

from defusedxml import ElementTree
from defusedxml.common import DefusedXmlException
from application.core.context import installation_key, normalize_country, normalize_version

NAMES = ("ETC", "PRG", "STD", "PRJ", "USR", "TMP")
REGISTRY_TEXT_VALUES = {
    "settings": {"country", "language"},
    "installroot": {
        "programdatapath", "programdatadrive", "programpath", "programdrive",
        "netpath", "netdrive",
    },
    "setup": {"netpath", "netdrive"},
    "installtrace": {"netmanager"},
    "customizedpaths": {name.lower() for name in NAMES},
}


def is_supported_version(version):
    try:
        normalize_version(version)
        return True
    except ValueError:
        return False


@dataclass
class AllplanPaths:
    version: str
    country: str = ""
    verification_version: bool = False
    paths: dict = field(default_factory=lambda: dict.fromkeys(NAMES))
    sources: dict = field(default_factory=dict)
    diagnostics: list = field(default_factory=list)
    language: str | None = None

    def to_dict(self):
        return dict(version=self.version, country=self.country, verification_version=self.verification_version,
                    paths={k: str(v) if v else None for k, v in self.paths.items()},
                    sources=self.sources, diagnostics=self.diagnostics,
                    language=self.language,
                    complete=all(self.paths.get(k) is not None for k in NAMES))

    @classmethod
    def from_dict(cls, d):
        if 'installation_id' in d:
            raise ValueError("Ancien contexte installation_id : migrer vers verification_version.")
        return cls(normalize_version(d['version']), d.get('country', ''), d.get('verification_version', False),
                   {k: Path(v) if v else None for k, v in d['paths'].items()},
                   d.get('sources', {}), d.get('diagnostics', []), d.get('language'))


class Registry:
    def __init__(self):
        try:
            import winreg
        except ImportError:
            winreg = None
        self.reg = winreg
        self.errors = []

    def values(self, hive, path, view):
        if view != 64:
            raise ValueError("Seule la vue 64 bits du registre est prise en charge.")
        r = self.reg
        section = path.rsplit("\\", 1)[-1].lower()
        expected = REGISTRY_TEXT_VALUES.get(section, set())
        if r is None:
            self.errors.append('Registre Allplan indisponible hors Windows.')
            return {}
        try:
            flag = r.KEY_WOW64_64KEY
            with r.OpenKey(r.HKEY_LOCAL_MACHINE if hive == 'HKLM' else r.HKEY_CURRENT_USER, path, 0,
                           r.KEY_READ | flag) as key:
                out = {}
                for i in range(min(r.QueryInfoKey(key)[1], 2048)):
                    n, v, t = r.EnumValue(key, i)
                    if t in (r.REG_SZ, r.REG_EXPAND_SZ):
                        out[n.lower()] = v
                    elif n.lower() in expected:
                        self.errors.append(f'{hive} {path}: type inattendu pour {n}.')
                return out
        except FileNotFoundError:
            if not path.lower().endswith(r'\installroot\customizedpaths'):
                self.errors.append(f'{hive} {path}: cle absente.')
            return {}
        except OSError as e:
            self.errors.append(f'{hive} {path}: {e}')
            return {}

    def installations(self):
        r = self.reg
        if r is None:
            self.errors.append('Registre Allplan indisponible hors Windows.')
            return []
        out = []
        for view in (64,):
            flag = r.KEY_WOW64_64KEY
            pending = [(r'SOFTWARE\NEMETSCHEK', 0)]
            seen = set()
            while pending and len(seen) < 512:
                path, depth = pending.pop()
                if path.lower() in seen: continue
                seen.add(path.lower())
                try:
                    with r.OpenKey(r.HKEY_LOCAL_MACHINE, path, 0, r.KEY_READ | flag) as key:
                        children = [r.EnumKey(key, i) for i in range(min(r.QueryInfoKey(key)[0], 512))]
                except FileNotFoundError:
                    continue
                except OSError as e:
                    self.errors.append(f'HKLM {path}: {e}')
                    continue
                for child in children:
                    full = path + '\\' + child
                    m = re.fullmatch(r'(\d{2,4})\.0', child)
                    verification = 'verification' in path.lower()
                    if (m and is_supported_version(m[1])
                            and full.casefold() == installation_key(m[1], verification).casefold()
                            and self.values('HKLM', full + r'\InstallRoot', view)):
                        out.append(dict(version=m[1], registry_path=full, view=64,
                                        verification_version=verification))
                    elif depth < 4 and (
                            child.lower() == 'allplan' or 'verification' in child.lower()):
                        pending.append((full, depth + 1))
        return out


def installations():
    reg = Registry()
    items = reg.installations()
    return dict(installations=items, diagnostics=reg.errors)


def installed_paths():
    registry = Registry()
    resolved = []
    diagnostics = []
    for item in registry.installations():
        if not is_supported_version(item['version']):
            continue
        try:
            state = resolve_paths(
                item['version'],
                verification_version=item['verification_version'],
                registry=registry,
                resolve_language=True,
            )
        except (OSError, ValueError, RuntimeError) as exc:
            diagnostics.append(f"{item['version']} [verification={item['verification_version']}]: {exc}")
            continue
        if not any(
            state.paths.get(name) is not None
            and state.paths[name].is_dir()
            for name in ('STD', 'USR')
        ):
            continue
        resolved.append(state.to_dict())
        diagnostics.extend(state.diagnostics)
    diagnostics.extend(registry.errors)
    return dict(installations=resolved, diagnostics=diagnostics)


def absolute(raw):
    if not isinstance(raw, (str, os.PathLike)): raise ValueError('Chemin textuel attendu')
    value = os.path.expandvars(os.fspath(raw).strip().strip('"'))
    if not value or '\x00' in value or re.search(r'%[^%]+%|\$\{[^}]+\}', value):
        raise ValueError('Chemin vide ou variable non resolue')
    p = Path(value).expanduser()
    if not p.is_absolute() or '..' in p.parts: raise ValueError('Chemin absolu sans .. requis')
    return p


def resolve_paths(version, *, overrides=None, country=None, verification_version=False, registry=None,
                  resolve_language=False):
    version = normalize_version(version)
    overrides = {} if overrides is None else overrides
    if not isinstance(overrides, dict) or set(overrides) - set(NAMES): raise ValueError('Cles de chemins invalides')
    reg = registry or Registry()
    key = installation_key(version, verification_version)
    state = AllplanPaths(version, verification_version=verification_version)
    diagnostic_context = f"Allplan {version} [HKLM\\{key}, vue 64 bits]"
    root = reg.values('HKLM', key + r'\InstallRoot', 64)
    selected = bool(root)
    if not selected:
        state.diagnostics.append(f'{diagnostic_context}: installation demandee absente ou inaccessible.')

    def values(hive, suffix):
        return reg.values(hive, key + '\\' + suffix, 64)

    def pair(v, stem):
        tail = v.get(stem + 'path', '')
        if not tail: return None
        return tail if Path(tail).is_absolute() or tail.startswith('\\\\') else v.get(stem + 'drive', '') + tail

    def choose(name, choices):
        if name in overrides: choices = [(overrides[name], 'explicit')]
        attempted = []
        for raw, source in choices:
            if not raw: continue
            searched = os.fspath(raw) if isinstance(raw, (str, os.PathLike)) else repr(raw)
            attempted.append(searched)
            try:
                p = absolute(raw)
                searched = str(p)
                attempted[-1] = searched
                if not p.is_dir(): raise OSError('Dossier absent ou inaccessible')
                state.paths[name] = p;
                state.sources[name] = source
                return p
            except (OSError, ValueError, RuntimeError) as e:
                state.diagnostics.append(
                    f'{diagnostic_context} {name} [source={source}] '
                    f'chemin recherche={searched!r}: {e}'
                )
        state.diagnostics.append(
            f'{diagnostic_context} {name}: non resolu; '
            f'chemins recherches={attempted!r}'
            + ('; aucun chemin absolu disponible' if not attempted else '')
        )
        return None

    if country is not None:
        state.country = normalize_country(country)
    else:
        raw_country = values('HKLM', 'Settings').get('country')
        try:
            state.country = normalize_country(raw_country)
        except ValueError:
            state.diagnostics.append(
                f'{diagnostic_context} Settings\\Country : valeur absente, vide ou invalide ; pays non resolu.'
            )
    if resolve_language:
        raw_language = values('HKCU', 'Settings').get('language')
        if isinstance(raw_language, str) and re.fullmatch(
            r"[A-Za-z]{2,3}", raw_language.strip()
        ):
            state.language = raw_language.strip().lower()
        else:
            state.diagnostics.append(
                f'{diagnostic_context} HKCU Settings\\Language : langue non resolue.'
            )
    raw = pair(root, 'programdata')
    choices = [(str(Path(raw) / 'Etc'), 'registry:ProgramData')] if raw else []
    if selected and not verification_version and os.environ.get('PROGRAMDATA'):
        choices.append(
            (str(Path(os.environ['PROGRAMDATA']) / 'Nemetschek' / 'Allplan' / version / 'Etc'), 'fallback:ProgramData'))
    etc = choose('ETC', choices)
    choose('PRG', [(pair(root, 'program'), 'registry:Program')])
    workgroup = values('HKLM', 'InstallTrace').get('netmanager', '').lower() == 'on'
    central = []
    if etc and int(version) >= 2022:
        try:
            xml = etc / 'netmanager.xml'
            if xml.is_file():
                with xml.open('rb') as h:
                    content = h.read(1048577)
                if len(content) > 1048576: raise ValueError('XML trop volumineux')
                tree = ElementTree.fromstring(content, forbid_dtd=True)
                active = tree.findtext('Active')
                if active is not None: workgroup = active.strip() == '1'
                text = tree.findtext('Path')
                if text and text.strip(): central.append((absolute(text.strip()), 'netmanager.xml'))
        except (OSError, ValueError, ParseError, DefusedXmlException) as e:
            state.diagnostics.append(f'{diagnostic_context} netmanager.xml [{xml}]: {e}')
    raw = pair(values('HKLM', 'Setup') if int(version) > 2023 else root, 'net')
    if raw:
        try:
            p = absolute(raw)
            central.extend((v, 'registry:Net') for v in (p, p / f'Allplan {version}', p / version))
        except (ValueError, OSError) as e:
            state.diagnostics.append(
                f'{diagnostic_context} [source=registry:Net] chemin recherche={raw!r}: {e}'
            )
    custom = {}
    if workgroup:
        for hive in ('HKLM', 'HKCU'):
            for k, v in values(hive, r'InstallRoot\CustomizedPaths').items(): custom.setdefault(k.upper(),
                                                                                                (v, 'custom:' + hive))
    for name, folder in (('STD', 'Std'), ('PRJ', 'Prj')):
        options = [custom[name]] if name in custom else []
        for parent, source in central:
            options.append((str(parent / folder), source))
            if name == 'STD' and state.country: options.append(
                (str(parent / ('Std.' + state.country)), source + ':country'))
        choose(name, options)
    usr = [custom['USR']] if 'USR' in custom else []
    tmp = [custom['TMP']] if 'TMP' in custom else []
    if selected:
        verification = verification_version
        if os.name == 'nt':
            try:
                import ctypes
                buf = ctypes.create_unicode_buffer(32768)
                result = ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buf)
                if result != 0:
                    raise OSError(f'SHGetFolderPathW(Documents) a echoue (HRESULT={result})')
                documents = absolute(buf.value)
                if verification:
                    usr.append((
                        str(documents / 'Nemetschek' / f'Allplan_{version}_Verification' / version / 'Usr'),
                        'fallback:Documents:Verification',
                    ))
                else:
                    usr.extend([
                        (str(documents / 'Nemetschek' / 'Allplan' / version / 'Usr'), 'fallback:Documents'),
                        (str(documents / 'Allplan' / version / 'Usr'), 'fallback:Documents:legacy'),
                    ])
            except (OSError, ValueError, AttributeError) as e:
                state.diagnostics.append(
                    f'{diagnostic_context} USR [source=Windows:Documents]: {e}'
                )
        if os.environ.get('LOCALAPPDATA'):
            local_folder = f'Allplan_{version}_Verification' if verification else 'Allplan'
            tmp.append((
                str(Path(os.environ['LOCALAPPDATA']) / 'Nemetschek' / local_folder / version / 'Tmp'),
                'fallback:LocalAppData:Verification' if verification else 'fallback:LocalAppData',
            ))
    choose('USR', usr);
    choose('TMP', tmp)
    state.diagnostics.extend(f'{diagnostic_context} {error}' for error in reg.errors)
    return state

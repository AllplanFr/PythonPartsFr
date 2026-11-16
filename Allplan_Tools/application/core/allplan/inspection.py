import argparse
import json
from pathlib import Path
import subprocess
import sys
from application.core.allplan.paths import resolve_paths, installations, installed_paths
from application.core.context import add_context_arguments, context_from_arguments
from application.core.launching import inspection_command


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument('--list', action='store_true')
    p.add_argument('--list-paths', action='store_true')
    add_context_arguments(p)
    p.add_argument('--paths', type=Path)
    p.add_argument('--timeout', type=float, default=15)
    p.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    arguments = list(sys.argv[1:] if argv is None else argv)
    if '--installation-id' in arguments or any(v.startswith('--installation-id=') for v in arguments):
        p.error("--installation-id supprime : utiliser --allplan-version et, si necessaire, --verification-version.")
    a = p.parse_args(arguments)
    if not 0 < a.timeout <= 300: p.error('timeout invalide')
    if not a.worker:
        try:
            r = subprocess.run([*inspection_command(), *arguments, '--worker'],
                               capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=a.timeout)
            print(r.stdout, end='')
            if r.stderr: print(r.stderr, file=sys.stderr, end='')
            return r.returncode
        except subprocess.TimeoutExpired:
            print(json.dumps(dict(ok=False, error='Delai depasse : disque ou reseau indisponible')));
            return 2
    try:
        if hasattr(sys.stdout, 'reconfigure'): sys.stdout.reconfigure(encoding='utf-8')
        if a.list_paths:
            data = installed_paths()
        elif a.list:
            data = installations()
        else:
            if not a.allplan_version: raise ValueError('--allplan-version requis')
            context = context_from_arguments(a)
            overrides = {}
            country = context.country
            if a.paths:
                if a.paths.stat().st_size > 65536: raise ValueError('JSON trop volumineux')
                cfg = json.loads(a.paths.read_text(encoding='utf-8-sig'))
                if 'installation_id' in cfg:
                    raise ValueError('Ancien JSON installation_id : remplacer par verification_version.')
                if str(cfg.get('version')) != context.allplan_version: raise ValueError('Version JSON differente')
                if cfg.get('verification_version', False) != context.verification_version:
                    raise ValueError('Type installation JSON different de --verification-version.')
                overrides = cfg['paths']
                if country is None: country = cfg.get('country')
            overrides = dict(overrides, **context.paths)
            data = resolve_paths(context.allplan_version, overrides=overrides, country=country,
                                 verification_version=context.verification_version,
                                 resolve_language=context.allplan_language is None).to_dict()
            if context.allplan_language is not None:
                data["language"] = context.allplan_language
        print(json.dumps(dict(ok=True, data=data), ensure_ascii=True));
        return 0
    except (OSError, ValueError, TypeError, KeyError, RuntimeError) as e:
        print(json.dumps(dict(ok=False, error=f'{type(e).__name__}: {e}'), ensure_ascii=True));
        return 1


if __name__ == '__main__': raise SystemExit(main())

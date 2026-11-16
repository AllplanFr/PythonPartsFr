"""VOB-specific prerequisites and construction; no UI import during discovery."""
def validate_context(context):
    if context.allplan_version is None:
        return
    if int(context.allplan_version) >= 2027:
        if context.country is None:
            raise ValueError("VOB Editor 2027+ : pays Allplan non resolu ; fournir --country.")
        roots = [context.paths.get("ETC"), context.paths.get("STD"),
                 context.catalog_user_path]
    else:
        roots = [context.paths.get("ETC")]
    if not any(path is not None and path.is_dir() for path in roots):
        raise ValueError("VOB Editor : aucun dossier VOB accessible (ETC, ou STD/catalogue en 2027+).")


def create_app(data_dir, context, options, services):
    from types import SimpleNamespace
    from .application import VobEditorApp
    from .allplan import VobEditorAllplanDatas
    from .discovery import detect_allplan_versions
    if context.allplan_version is None:
        return VobEditorApp(data_dir, roots={}, initial_path=options.get("initial_path"))
    paths = context.to_allplan_paths()
    provider = VobEditorAllplanDatas(paths, catalog_user_path=context.catalog_user_path)
    versions = {paths.version: provider}
    versions.update({
        version: VobEditorAllplanDatas(state)
        for version, state in detect_allplan_versions(
            SimpleNamespace(timeout=services.timeout), paths,
        ).items()
    })
    return VobEditorApp(data_dir, allplan_datas=provider, allplan_versions=versions,
                        initial_path=options.get("initial_path"))

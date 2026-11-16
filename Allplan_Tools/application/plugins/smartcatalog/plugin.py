"""SmartCatalog construction, loaded only when this application is selected."""
def create_app(data_dir, context, _options, _services):
    from .application import SmartCatalogApp
    app = SmartCatalogApp(data_dir, context={
        "allplan_version": context.allplan_version,
        "project": str(context.project_path) if context.project_path else None,
        "paths": {name: str(path) for name, path in context.paths.items()},
        "allplan": context.to_allplan_paths().to_dict() if context.allplan_version else None,
    })
    app._open_app = app._launch_plugin
    return app

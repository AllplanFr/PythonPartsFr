"""Project reader; remote exposure requires a protected host."""


def create_app(data_dir, context, _options, services):
    from .presentation import AimPresentationApp
    from application.core.catalog import resolve_plugin
    from application.core.plugin_icons import bind_window_icon

    class IconPresentationApp(AimPresentationApp):
        def _attach_window(self, window):
            super()._attach_window(window)
            bind_window_icon(window, resolve_plugin(self.app_id))

    return IconPresentationApp(data_dir, context, timeout=services.timeout)

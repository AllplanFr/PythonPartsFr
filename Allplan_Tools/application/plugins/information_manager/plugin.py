"""Project reader; remote exposure requires a protected host."""


def create_app(data_dir, context, _options, services):
    from .presentation import AimPresentationApp
    return AimPresentationApp(data_dir, context, timeout=services.timeout)

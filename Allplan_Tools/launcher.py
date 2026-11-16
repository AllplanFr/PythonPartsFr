"""Convenient source entry point; all implementation lives in application."""
from application.launcher.main import entrypoint


if __name__ == "__main__":
    raise SystemExit(entrypoint())

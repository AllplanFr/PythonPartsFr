"""Convenient source entry point for read-only Allplan diagnostics."""
from application.core.allplan.inspection import main


if __name__ == "__main__":
    raise SystemExit(main())

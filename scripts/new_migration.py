#!/usr/bin/env python
"""Create the next schema migration skeleton.

Usage: python scripts/new_migration.py add_credit_billing_cycles
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "src" / "life_energy" / "db" / "migrations"

TEMPLATE = """-- Migration {version}: {name}
-- Describe the schema change and why it is needed.

-- All DDL must be idempotent (IF NOT EXISTS / IF EXISTS) so a partially
-- applied migration can be safely re-run.
"""


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 1
    name = sys.argv[1]
    if not re.fullmatch(r"[a-z0-9_]+", name):
        print(f"invalid migration name: {name!r} (use lowercase snake_case)")
        return 1

    existing = sorted(MIGRATIONS_DIR.glob("*.sql"))
    versions = [int(p.name[:4]) for p in existing]
    next_version = (versions[-1] + 1) if versions else 1

    target = MIGRATIONS_DIR / f"{next_version:04d}_{name}.sql"
    if target.exists():
        print(f"already exists: {target}")
        return 1
    target.write_text(TEMPLATE.format(version=next_version, name=name), encoding="utf-8")
    print(f"created {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

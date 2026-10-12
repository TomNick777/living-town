"""Check the public source file set for forbidden data and obvious credentials."""
from __future__ import annotations
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRIVATE_SUFFIXES = {".db", ".sqlite", ".sqlite3", ".pdf", ".xls", ".xlsx", ".pem", ".key", ".zip"}
PATTERNS = {
    "local user/workspace path": re.compile(r"[A-Za-z]:\\(?:Users|workspace)\\"),
    "GitHub credential": re.compile(r"(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})"),
    "private key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "private rule backup": re.compile(r"classification-rules-backup\.json"),
}


def public_files() -> list[Path]:
    if (ROOT / ".git").exists():
        names = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard"],
                                        cwd=ROOT, text=True, encoding="utf-8").splitlines()
        return [ROOT / name for name in sorted(set(names))]
    excluded = {"node_modules", "dist", "__pycache__", ".pytest_cache", ".venv", "artifacts"}
    return sorted(path for path in ROOT.rglob("*") if path.is_file() and not excluded.intersection(path.relative_to(ROOT).parts))


def main() -> int:
    issues = []
    files = public_files()
    for path in files:
        relative = path.relative_to(ROOT).as_posix()
        if path.suffix.lower() in PRIVATE_SUFFIXES or (relative.startswith("data/") and relative != "data/README.md"):
            issues.append(f"{relative}: forbidden data file")
        if path.name.startswith(".env") and path.name != ".env.example":
            issues.append(f"{relative}: local environment file")
        if path.suffix.lower() in {".png", ".jpg", ".webp"}:
            continue  # Screenshots require manual synthetic-data review.
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            issues.append(f"{relative}: unreviewed binary file")
            continue
        for label, pattern in PATTERNS.items():
            if pattern.search(content):
                issues.append(f"{relative}: {label}")
    if issues:
        print("\n".join(issues))
        return 1
    print(f"Public file audit passed: {len(files)} files. Review synthetic provenance and screenshots separately.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

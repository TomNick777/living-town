"""Shared PDF plumbing for real bank statement adapters.

Banks ship statements as text PDFs, but two hazards recur:

1. Diagonal watermark stamps (兴业/工商 print the bank name and a timestamp
   rotated by 30°). pdfplumber reports those glyphs with a rotation matrix;
   genuine table content is axis-aligned. Filtering on ``matrix[1]/matrix[2]``
   removes the watermark WITHOUT touching a single content glyph — safer
   than any textual cleanup, which would risk corrupting amounts.
2. Encrypted workbooks distributed as "xlsx" (广发储蓄卡): actually OLE
   containers with an encrypted OOXML payload; the user's export page puts
   the password in the filename. msoffcrypto decrypts to plain xlsx bytes.

Parsers never mutate the source file: everything here only reads.
"""

from __future__ import annotations

import io
import re
from pathlib import Path


def _is_axis_aligned(obj) -> bool:
    matrix = obj.get("matrix") or (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
    return abs(matrix[1]) < 0.01 and abs(matrix[2]) < 0.01


def pdf_pages(path: str | Path, password: str | None = None):
    """Yield watermark-free pdfplumber pages (lazy; caller closes the PDF)."""
    import pdfplumber

    pdf = pdfplumber.open(path, password=password)
    try:
        for page in pdf.pages:
            yield page.filter(_is_axis_aligned)
    finally:
        pdf.close()


def pdf_table_rows(path: str | Path, password: str | None = None) -> list[list[list[str]]]:
    """Extract watermark-free tables from every page: list of tables of rows of cells."""
    tables = []
    for page in pdf_pages(path, password=password):
        for table in page.extract_tables() or []:
            tables.append([[("" if cell is None else str(cell)) for cell in row] for row in table])
    return tables


def pdf_text_lines(path: str | Path, password: str | None = None) -> list[str]:
    lines: list[str] = []
    for page in pdf_pages(path, password=password):
        lines.extend((page.extract_text() or "").splitlines())
    return lines


def decrypt_xlsx(path: str | Path, password: str) -> io.BytesIO:
    """Decrypt an OLE-encrypted xlsx export into openpyxl-readable bytes."""
    import msoffcrypto

    buffer = io.BytesIO()
    with open(path, "rb") as handle:
        office_file = msoffcrypto.OfficeFile(handle)
        office_file.load_key(password=password)
        office_file.decrypt(buffer)
    buffer.seek(0)
    return buffer


PASSWORD_IN_FILENAME = re.compile(r"密码(\w+)")


def password_from_filename(path: str | Path) -> str:
    """广发 exports embed the open password in the file name (...密码5157.xlsx)."""
    match = PASSWORD_IN_FILENAME.search(Path(path).name)
    if not match:
        raise ValueError(f"encrypted workbook without an embedded password hint: {path}")
    return match.group(1)


def flat_text(value: str | None) -> str:
    """Collapse cell-internal newlines (PDF table cells wrap mid-sentence)."""
    return " ".join(str(value or "").split())


def bank_row_reference(prefix: str, *parts, ordinal: int = 1) -> str:
    """Deterministic per-row reference for statements without native ids.

    Statements with date-only precision can carry genuinely distinct rows that
    are content-identical (e.g. two same-day purchases of the same amount at
    the same merchant). The within-key ordinal keeps their references (and
    fingerprints) distinct; it is stable because a statement lists rows in a
    fixed order.
    """
    import hashlib

    key = "|".join(str(part) for part in parts)
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]
    suffix = "" if ordinal == 1 else f":{ordinal}"
    return f"{prefix}:{digest}{suffix}"

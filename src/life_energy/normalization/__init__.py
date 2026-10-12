"""Normalization: channel rows -> canonical transaction candidates."""

from .normalizer import CanonicalCandidate, NormalizeError, normalize_row

__all__ = ["CanonicalCandidate", "NormalizeError", "normalize_row"]

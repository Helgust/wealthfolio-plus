"""The addon export (rules JSON and golden fixtures) matches the current code and rules."""

import json
import math

from planner.export_ts import all_files


def _same(a, b) -> bool:
    """Equal JSON values; floats may differ in the last bits (another OS or Python)."""
    if isinstance(a, float) or isinstance(b, float):
        return (
            isinstance(a, int | float)
            and isinstance(b, int | float)
            and math.isclose(a, b, rel_tol=1e-12, abs_tol=1e-9)
        )
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_same(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_same(x, y) for x, y in zip(a, b, strict=True))
    return a == b


def test_export_for_addon_is_up_to_date():
    stale = [
        str(path)
        for path, text in all_files().items()
        if not path.exists()
        or not _same(json.loads(path.read_text(encoding="utf-8")), json.loads(text))
    ]
    assert not stale, "stale, run python -m planner.export_ts: " + ", ".join(stale)

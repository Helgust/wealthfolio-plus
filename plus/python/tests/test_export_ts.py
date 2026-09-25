"""The addon export (rules JSON and golden fixtures) matches the current code and rules."""

from planner.export_ts import all_files


def test_export_for_addon_is_up_to_date():
    stale = [
        str(path)
        for path, text in all_files().items()
        if not path.exists() or path.read_text(encoding="utf-8") != text
    ]
    assert not stale, "stale, run python -m planner.export_ts: " + ", ".join(stale)

"""Выгрузка для аддона (rules JSON и golden-фикстуры) совпадает с текущим кодом и правилами."""

from planner.export_ts import all_files


def test_export_for_addon_is_up_to_date():
    stale = [
        str(path)
        for path, text in all_files().items()
        if not path.exists() or path.read_text(encoding="utf-8") != text
    ]
    assert not stale, "устарело, запустите python -m planner.export_ts: " + ", ".join(stale)

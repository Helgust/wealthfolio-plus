"""Colors and shared chart settings (dataviz reference palette, light theme)."""

SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"]  # fixed order, never cycle
TEXT_PRIMARY = "#0b0b0b"
TEXT_SECONDARY = "#52514e"
GRID = "#e6e5e1"
SURFACE = "#fcfcfb"

PLOTLY_LAYOUT = {
    "paper_bgcolor": SURFACE,
    "plot_bgcolor": SURFACE,
    "font": {"color": TEXT_SECONDARY, "size": 13},
    "hovermode": "x unified",
    "separators": ". ",  # десятичная точка, тысячи через пробел — как в таблицах
    "margin": {"l": 56, "r": 24, "t": 24, "b": 48},
    "legend": {"orientation": "h", "y": 1.08, "x": 0},
    "xaxis": {"gridcolor": GRID, "zeroline": False},
    "yaxis": {"gridcolor": GRID, "zeroline": False},
}

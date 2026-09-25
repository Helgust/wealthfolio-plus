# %% [markdown]
# # Effective tax rate on the savings base
# Run: in VS Code, "Run Cell" above the cell (Interactive Window).

# %%
import numpy as np
import plotly.graph_objects as go

from planner.tax import load_scale

estatal = load_scale(2026, "ahorro", key="estatal")
autonomica = load_scale(2026, "ahorro", key="autonomica")

gains = np.linspace(1_000, 400_000, 400)
tax = np.array([estatal.apply(g) + autonomica.apply(g) for g in gains])

# %%
fig = go.Figure(go.Scatter(x=gains, y=tax / gains * 100, mode="lines"))
fig.update_layout(
    title="Savings base: effective rate",
    xaxis_title="Capital gain for the year, €",
    yaxis_title="Effective rate, %",
)
fig.show()

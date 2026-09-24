# %% [markdown]
# # Эффективная ставка налога на базу сбережений
# Запуск: в VS Code "Run Cell" над ячейкой (Interactive Window).

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
    title="База сбережений: эффективная ставка",
    xaxis_title="Прирост капитала за год, €",
    yaxis_title="Эффективная ставка, %",
)
fig.show()

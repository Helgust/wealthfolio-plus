// Series colors of the planner charts, in Wealthfolio tones (forest, ochre, terracotta, purple), but
// more saturated: the host colors --chart-1…4 are not distinguishable in a stack. Checked with the
// dataviz validator on the host backgrounds (#fffcf0 and #100f0f): lightness band, chroma, contrast
// ≥ 3:1; in the order forest, ochre, terracotta, purple adjacent pairs pass under color blindness
// (ΔE ≥ 8) and normal vision (ΔE ≥ 15). Forest and terracotta collapse under deuteranopia (ΔE 5.2),
// so lines that can cross use only forest, ochre, purple — they pass for all pairs.
export const FOREST = { light: '#1d7a58', dark: '#2a9168' };
export const OCHRE = { light: '#b08a14', dark: '#b78f1b' };
export const TERRACOTTA = { light: '#a9403a', dark: '#c24c46' };
export const PURPLE = { light: '#7462b8', dark: '#8f7ed2' };

// Prettier settings from the Wealthfolio root, but without wrapping Markdown prose:
// the Claude Code hook from .claude/settings.json formats every changed file.
const base = require("../.prettierrc.cjs");

const isMarkdown = (override) =>
  [].concat(override.files).some((pattern) => pattern.endsWith(".md") || pattern.endsWith(".mdx"));

module.exports = {
  ...base,
  overrides: [
    ...base.overrides.filter((override) => !isMarkdown(override)),
    { files: ["**/*.md", "**/*.mdx"], options: { proseWrap: "preserve" } },
  ],
};

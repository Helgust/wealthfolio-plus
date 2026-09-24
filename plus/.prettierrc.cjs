// Настройки Prettier из корня Wealthfolio, но без переноса строк в Markdown:
// хук Claude Code из .claude/settings.json форматирует каждый изменённый файл.
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

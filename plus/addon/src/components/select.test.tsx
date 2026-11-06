import { SelectContent, SelectItem, SelectTrigger, SelectValue } from "@wealthfolio/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { collectSelectOptions, Select } from "./select";

const NAMES = ["Savings", "Broker"];

const content = (
  <SelectContent>
    <SelectItem value="none">None</SelectItem>
    {NAMES.map((name, i) => (
      <SelectItem key={name} value={`acct-${i}`}>
        {name}
      </SelectItem>
    ))}
    <>
      <SelectItem value="age:0">{NAMES[0]}'s age</SelectItem>
    </>
  </SelectContent>
);

describe("collectSelectOptions", () => {
  it("finds items in lists and fragments, skipping everything else", () => {
    const options = collectSelectOptions(
      <>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        {content}
      </>,
    );
    expect(options.map((o) => o.value)).toEqual(["none", "acct-0", "acct-1", "age:0"]);
    expect(options[1].label).toBe("Savings");
  });
});

describe("Select", () => {
  it("shows the label of the selected item, not its value, while closed", () => {
    const html = renderToStaticMarkup(
      <Select value="acct-1">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        {content}
      </Select>,
    );
    expect(html).toContain("Broker");
    expect(html).not.toContain("acct-1<");
  });
});

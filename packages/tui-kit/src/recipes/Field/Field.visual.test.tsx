import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { RadioGroup, TextArea, TextField } from "./Field.tsx";

/**
 * Visual tier for the Field family (TextField, TextArea, RadioGroup).
 *
 * BASELINES ARE TRACKED IN GIT -- see Icon.visual.test.tsx.
 *
 * No animation freeze: Field.module.css declares no `transition`, so there is
 * nothing to interpolate mid-capture.
 */

const options = [
  { value: "domains", label: "Anyone at these domains" },
  { value: "emails", label: "These people" },
] as const;

/** Mounts into a fresh container that already carries `dark` when asked. */
async function renderFixture(ui: ReactNode, { dark = false } = {}) {
  await page.viewport(700, 600);

  const container = document.createElement("div");
  if (dark) container.classList.add("dark");
  document.body.appendChild(container);

  const screen = await renderWithTheme(ui, { container });
  await document.fonts.ready;
  return screen;
}

const surface = {
  display: "flex",
  flexDirection: "column",
  gap: "1rem",
  padding: "1rem",
  width: "20rem",
  background: "var(--panel)",
  color: "var(--fg)",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-size-sm)",
} as const;

/** Rest-state coverage: a labeled TextField, a password TextField, a TextField
    with an error, a TextArea, and a RadioGroup with its second option
    selected -- the brief's non-focus scenarios in one capture. */
function FieldStates() {
  return (
    <div data-testid="field-states" style={surface}>
      <TextField
        label="Name"
        value="mr-board"
        onChange={() => {}}
        placeholder="myapp"
        required
        pattern="[a-z0-9][a-z0-9.-]*"
      />
      <TextField
        type="password"
        value=""
        onChange={() => {}}
        aria-label="new password"
        placeholder="new password"
      />
      <TextField
        label="Slug"
        value="bad slug"
        onChange={() => {}}
        error="must be lowercase, digits, dots, hyphens only"
      />
      <TextArea
        label="Allowed emails"
        rows={4}
        value={"a@example.com\nb@example.com"}
        onChange={() => {}}
        placeholder="one per line"
      />
      <RadioGroup name="oauth-mode" value="emails" onChange={() => {}} options={options} />
    </div>
  );
}

describe("Field family (visual)", () => {
  it("the rest-state scenarios match their baseline in light mode", async () => {
    await renderFixture(<FieldStates />);

    await expect(page.getByTestId("field-states")).toMatchScreenshot("field-states-light");
  });

  it("the rest-state scenarios match their baseline in dark mode", async () => {
    await renderFixture(<FieldStates />, { dark: true });

    await expect(page.getByTestId("field-states")).toMatchScreenshot("field-states-dark");
  });

  it("a focused labeled TextField matches its baseline in light mode", async () => {
    const screen = await renderFixture(
      <div data-testid="field-focused" style={surface}>
        <TextField label="Name" value="mr-board" onChange={() => {}} />
      </div>,
    );

    screen.getByRole("textbox").element().focus();

    await expect(page.getByTestId("field-focused")).toMatchScreenshot("field-focused-light");
  });

  it("a focused labeled TextField matches its baseline in dark mode", async () => {
    const screen = await renderFixture(
      <div data-testid="field-focused" style={surface}>
        <TextField label="Name" value="mr-board" onChange={() => {}} />
      </div>,
      { dark: true },
    );

    screen.getByRole("textbox").element().focus();

    await expect(page.getByTestId("field-focused")).toMatchScreenshot("field-focused-dark");
  });
});

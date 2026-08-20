import { describe, expect, it } from "vitest";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { Probe } from "./Probe.tsx";

/**
 * TEMPORARY — see Probe.tsx. This file's job is to prove the browser tier
 * actually works: vitest browser mode launches, the playwright provider
 * resolves, vitest-browser-react renders, the CSS module class lands on the
 * element, and — the part no node-tier test can check — the theme's
 * `light-dark()` + `.dark`-flips-`color-scheme` mechanism resolves to real
 * colours in a real engine.
 */
describe("Probe (browser)", () => {
  it("renders its children", async () => {
    const screen = await renderWithTheme(<Probe>hello rig</Probe>);
    await expect.element(screen.getByText("hello rig")).toBeInTheDocument();
  });

  it("resolves theme custom properties to real computed colours", async () => {
    const screen = await renderWithTheme(<Probe classNames={{ root: "probe" }}>x</Probe>);
    const el = screen.container.querySelector(".probe")!;
    const style = getComputedStyle(el);
    // The whole chain under test: `--panel` (soribashi.config.ts alias) →
    // `--surface-panel` (semantic) → `--color-surface-panel` (token) →
    // `light-dark(#e1e2e7-ish, #232a47)`. A missing provider, a missing
    // theme.css import, or a light-dark() the engine cannot resolve all land
    // here as `rgba(0, 0, 0, 0)`.
    expect(style.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(style.backgroundColor).not.toBe("");
    expect(style.fontFamily).toContain("Mono");
  });

  it("flips to the dark scheme under a .dark ancestor", async () => {
    const light = document.createElement("div");
    document.body.appendChild(light);
    const dark = document.createElement("div");
    dark.className = "dark";
    document.body.appendChild(dark);

    const lightScreen = await renderWithTheme(<Probe classNames={{ root: "p-light" }}>x</Probe>, {
      container: light,
    });
    const darkScreen = await renderWithTheme(<Probe classNames={{ root: "p-dark" }}>x</Probe>, {
      container: dark,
    });

    const lightBg = getComputedStyle(lightScreen.container.querySelector(".p-light")!)
      .backgroundColor;
    const darkBg = getComputedStyle(darkScreen.container.querySelector(".p-dark")!).backgroundColor;

    // THE mechanism check for the whole kit: dark mode is not a variable
    // redeclaration, it is `.dark { color-scheme: dark }` making every
    // `light-dark()` in the emitted tokens take its second branch.
    expect(lightBg).not.toBe(darkBg);
  });
});

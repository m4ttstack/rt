import { describe, expect, test } from "vitest";
import { retunedTextColor, tuiIntentResolver } from "../src/intent-resolver.ts";

describe("hue text retune", () => {
  test("filled paints the hue's on-fill label and a scheme-aware label on the neutral fill", () => {
    const r = tuiIntentResolver({ intent: "ok", variant: "filled" });
    expect(r.color).toBe("var(--color-green-onFill)");
    expect(r.hover).toBe("var(--color-green-hover)");
    const m = tuiIntentResolver({ intent: "muted", variant: "filled" });
    expect(m.color).toBe("light-dark(var(--text-1), #ffffff)");
  });

  test("outline and subtle take the hue text token", () => {
    expect(retunedTextColor("var(--color-green-500)", "outline", "ok")).toBe("var(--text-ok)");
    expect(retunedTextColor("var(--color-purple-500)", "subtle", "purple")).toBe("var(--text-purple)");
  });

  test("the tinted light variant takes the small hue text token", () => {
    expect(retunedTextColor("var(--color-blue-500)", "light", "accent")).toBe("var(--text-accent-small)");
  });

  test("muted maps onto the neutral text ramp", () => {
    expect(retunedTextColor("var(--color-gray-muted)", "outline", "muted")).toBe("var(--text-2)");
    expect(retunedTextColor("var(--color-gray-muted)", "light", "muted")).toBe("var(--text-4)");
  });

  test("default is untouched", () => {
    expect(retunedTextColor("var(--color-blue-500)", "default", "accent")).toBe("var(--color-blue-500)");
  });
});

import { useTheme } from "@soribashi/core";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { TuiKitProvider } from "../src/provider.tsx";
import { Button } from "../src/recipes/Button/Button.tsx";

function ThemeName() {
  return <span data-testid="theme-name">{useTheme().name}</span>;
}

test("TuiKitProvider binds tuiTheme for useTheme() without a registerTheme call at the call site", async () => {
  const screen = await render(
    <TuiKitProvider>
      <ThemeName />
      <Button intent="accent" variant="filled">
        Go
      </Button>
    </TuiKitProvider>,
  );
  await expect.element(screen.getByTestId("theme-name")).toHaveTextContent("tui-kit");
  await expect.element(screen.getByRole("button", { name: "Go" })).toBeVisible();
});

import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { Badge } from "../Badge/Badge.tsx";
import { Button } from "../Button/Button.tsx";
import { Chip } from "../Chip/Chip.tsx";
import { Table } from "./Table.tsx";

/**
 * Visual tier for the Table recipe.
 *
 * BASELINES ARE TRACKED IN GIT — see Icon.visual.test.tsx.
 *
 * THE ANIMATION FREEZE IS INSTALLED HERE, following Chip's precedent: the
 * warn row's Chip carries a PERPETUAL `animation` (`pulse`), which would
 * otherwise capture a different opacity on every run.
 */

const NO_MOTION_CLASS = "table-visual-no-motion";

function installNoMotionStyle() {
  if (document.getElementById(NO_MOTION_CLASS)) return;
  const style = document.createElement("style");
  style.id = NO_MOTION_CLASS;
  style.textContent = `.${NO_MOTION_CLASS}, .${NO_MOTION_CLASS} * {
    animation: none !important;
    transition: none !important;
  }`;
  document.head.appendChild(style);
}

/** Mounts into a fresh container that already carries `dark` when asked. */
async function renderFixture(ui: ReactNode, { dark = false } = {}) {
  await page.viewport(700, 400);
  installNoMotionStyle();

  const container = document.createElement("div");
  container.classList.add(NO_MOTION_CLASS);
  if (dark) container.classList.add("dark");
  document.body.appendChild(container);

  const screen = await renderWithTheme(ui, { container });
  await document.fonts.ready;
  return screen;
}

const surface = {
  display: "inline-block",
  padding: "1rem",
  background: "var(--panel)",
} as const;

/** A mini deck-like board section: three sites, mixing Chip/Badge/Button
    across a status column and an align="end" latency/action column — the same
    shapes Act 2 composes into a Table row. */
function SitesTable() {
  return (
    <div data-testid="sites" style={surface}>
      <Table>
        <Table.Head>
          <Table.HeadCell>site</Table.HeadCell>
          <Table.HeadCell>status</Table.HeadCell>
          <Table.HeadCell>latency</Table.HeadCell>
        </Table.Head>
        <Table.Body>
          <Table.Row>
            <Table.Cell>edge-01</Table.Cell>
            <Table.Cell>
              <Chip intent="ok">healthy</Chip>
            </Table.Cell>
            <Table.Cell align="end">
              <Badge intent="ok">34ms</Badge>
            </Table.Cell>
          </Table.Row>
          <Table.Row>
            <Table.Cell>edge-02</Table.Cell>
            <Table.Cell>
              <Chip intent="warn" pulse>
                degraded
              </Chip>
            </Table.Cell>
            <Table.Cell align="end">
              <Badge intent="warn">212ms</Badge>
            </Table.Cell>
          </Table.Row>
          <Table.Row>
            <Table.Cell>edge-03</Table.Cell>
            <Table.Cell>
              <Chip intent="bad">down</Chip>
            </Table.Cell>
            <Table.Cell align="end">
              <Button intent="bad" size="sm">
                restart
              </Button>
            </Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table>
    </div>
  );
}

describe("Table (visual)", () => {
  it("the sites table matches its baseline in light mode", async () => {
    await renderFixture(<SitesTable />);

    await expect(page.getByTestId("sites")).toMatchScreenshot("table-sites-light");
  });

  it("the sites table matches its baseline in dark mode", async () => {
    await renderFixture(<SitesTable />, { dark: true });

    await expect(page.getByTestId("sites")).toMatchScreenshot("table-sites-dark");
  });

  it("the hovered middle row matches its baseline", async () => {
    await renderFixture(<SitesTable />);

    await page.getByText("edge-02").hover();

    await expect(page.getByTestId("sites")).toMatchScreenshot("table-sites-row-hover");
  });
});

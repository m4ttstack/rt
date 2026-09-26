import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { LISTGROUP_PARTS, ListGroup } from "./ListGroup.tsx";

/**
 * Browser tier for the ListGroup recipe.
 *
 * Same conventions as Field/Table/Switch: every render goes through
 * `renderWithTheme`, assertions observe rendered behaviour, and the one
 * sanctioned structural assertion is `data-part`.
 */

function partOf(container: HTMLElement, part: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-part="${part}"]`);
  if (!el) throw new Error(`no [data-part="${part}"] rendered`);
  return el;
}

function allOf(container: HTMLElement, part: string): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(`[data-part="${part}"]`));
}

describe("ListGroup (browser)", () => {
  it("renders a ul wrapping li rows", async () => {
    const screen = await renderWithTheme(
      <ListGroup>
        <ListGroup.Fact label="Region" value="us-east-1" />
        <ListGroup.Fact label="Plan" value="Pro" />
      </ListGroup>,
    );

    const list = partOf(screen.container, LISTGROUP_PARTS.list);
    expect(list.tagName).toBe("UL");
    const rows = list.querySelectorAll("li");
    expect(rows).toHaveLength(2);
  });

  it("a consumer-supplied data-part does not win on the root", async () => {
    const screen = await renderWithTheme(
      <ListGroup data-part="hijacked">
        <ListGroup.Fact label="a" value="b" />
      </ListGroup>,
    );

    expect(partOf(screen.container, LISTGROUP_PARTS.root)).toBeDefined();
    expect(screen.container.querySelectorAll('[data-part="hijacked"]')).toHaveLength(0);
  });

  it("a consumer className merges onto the root", async () => {
    const screen = await renderWithTheme(
      <ListGroup className="app-listgroup">
        <ListGroup.Fact label="a" value="b" />
      </ListGroup>,
    );

    const root = partOf(screen.container, LISTGROUP_PARTS.root);
    expect(root.classList.contains("app-listgroup")).toBe(true);
  });

  describe("Nav", () => {
    it("is a button whose accessible name is the label alone when there is no value", async () => {
      const screen = await renderWithTheme(
        <ListGroup>
          <ListGroup.Nav label="Notifications" onClick={() => {}} />
        </ListGroup>,
      );

      const button = screen.getByRole("button", { name: "Notifications" }).element() as HTMLButtonElement;
      expect(button.tagName).toBe("BUTTON");
    });

    it("the value hint participates in the accessible name, not just visible text", async () => {
      const screen = await renderWithTheme(
        <ListGroup>
          <ListGroup.Nav label="dev port" value="3007 · override" onClick={() => {}} />
        </ListGroup>,
      );

      const button = screen
        .getByRole("button", { name: "dev port, 3007 · override" })
        .element() as HTMLButtonElement;
      expect(button.textContent).toContain("3007 · override");
    });

    it("the chevron stays hidden from assistive tech", async () => {
      const screen = await renderWithTheme(
        <ListGroup>
          <ListGroup.Nav label="Region" value="us-east-1" onClick={() => {}} />
        </ListGroup>,
      );

      const chevron = partOf(screen.container, LISTGROUP_PARTS.chevron);
      expect(chevron.getAttribute("aria-hidden")).toBe("true");
      // Exact-name match: if the chevron glyph leaked into the accessible
      // name, this query would not find a "Region, us-east-1" role.
      expect(screen.getByRole("button", { name: "Region, us-east-1" }).element()).toBeDefined();
    });

    it("does not force-stringify a non-string label: falls back to the button's own visible text", async () => {
      const screen = await renderWithTheme(
        <ListGroup>
          <ListGroup.Nav label={<span>Region</span>} value="us-east-1" onClick={() => {}} />
        </ListGroup>,
      );

      const button = screen.container.querySelector("button") as HTMLButtonElement;
      expect(button.hasAttribute("aria-label")).toBe(false);
      expect(button.textContent).toContain("Region");
      expect(button.textContent).toContain("us-east-1");
    });

    it("fires onClick", async () => {
      const onClick = vi.fn();
      const screen = await renderWithTheme(
        <ListGroup>
          <ListGroup.Nav label="Notifications" onClick={onClick} />
        </ListGroup>,
      );

      screen.getByRole("button", { name: "Notifications" }).element().dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("disabled disables the button", async () => {
      const screen = await renderWithTheme(
        <ListGroup>
          <ListGroup.Nav label="Notifications" onClick={() => {}} disabled />
        </ListGroup>,
      );

      const button = screen.getByRole("button", { name: "Notifications" }).element() as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });
  });

  describe("Toggle", () => {
    it("proxies checked to the underlying Switch", async () => {
      const screen = await renderWithTheme(
        <ListGroup>
          <ListGroup.Toggle label="Dark mode" checked={true} onChange={() => {}} />
        </ListGroup>,
      );

      const control = screen.container.querySelector<HTMLInputElement>('input[role="switch"]');
      expect(control?.checked).toBe(true);
    });

    it("proxies onChange when the Switch fires", async () => {
      const onChange = vi.fn();
      const screen = await renderWithTheme(
        <ListGroup>
          <ListGroup.Toggle label="Dark mode" checked={false} onChange={onChange} />
        </ListGroup>,
      );

      const control = screen.container.querySelector<HTMLInputElement>('input[role="switch"]');
      control?.click();

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith();
    });
  });

  describe("Toggle dev warning", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("warns when label is not a string and no aria-label is given", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await renderWithTheme(
        <ListGroup>
          <ListGroup.Toggle label={<span>Dark mode</span>} checked={false} onChange={() => {}} />
        </ListGroup>,
      );

      expect(warn).toHaveBeenCalledWith(
        "tui-kit ListGroup.Toggle: a non-string `label` with no `aria-label` leaves the Switch unlabeled",
      );
    });

    it("stays silent when a non-string label carries an aria-label", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await renderWithTheme(
        <ListGroup>
          <ListGroup.Toggle
            label={<span>Dark mode</span>}
            checked={false}
            onChange={() => {}}
            aria-label="Dark mode"
          />
        </ListGroup>,
      );

      expect(warn).not.toHaveBeenCalled();
    });

    it("stays silent for a plain string label with no aria-label", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await renderWithTheme(
        <ListGroup>
          <ListGroup.Toggle label="Dark mode" checked={false} onChange={() => {}} />
        </ListGroup>,
      );

      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("Action", () => {
    it("fires onClick", async () => {
      const onClick = vi.fn();
      const screen = await renderWithTheme(
        <ListGroup>
          <ListGroup.Action label="Restart service" onClick={onClick} />
        </ListGroup>,
      );

      screen.getByRole("button", { name: "Restart service" }).element().dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("busy disables the row and renders a Spinner", async () => {
      const screen = await renderWithTheme(
        <ListGroup>
          <ListGroup.Action label="Restart service" onClick={() => {}} busy />
        </ListGroup>,
      );

      const button = screen.container.querySelector<HTMLButtonElement>(
        `[data-part="${LISTGROUP_PARTS.action}"] button`,
      );
      expect(button?.disabled).toBe(true);
      expect(button?.getAttribute("aria-busy")).toBe("true");
      expect(button?.querySelector('[data-part="spinner"]')).not.toBeNull();
    });

    it("disabled disables the row without busy", async () => {
      const screen = await renderWithTheme(
        <ListGroup>
          <ListGroup.Action label="Restart service" onClick={() => {}} disabled />
        </ListGroup>,
      );

      const button = screen.container.querySelector<HTMLButtonElement>(
        `[data-part="${LISTGROUP_PARTS.action}"] button`,
      );
      expect(button?.disabled).toBe(true);
    });
  });

  describe("Danger", () => {
    it("renders as an Action row with intent bad", async () => {
      const screen = await renderWithTheme(
        <ListGroup>
          <ListGroup.Danger label="Delete workspace" onClick={() => {}} />
        </ListGroup>,
      );

      const button = screen.container.querySelector<HTMLButtonElement>(
        `[data-part="${LISTGROUP_PARTS.action}"] button`,
      );
      expect(button?.getAttribute("data-intent")).toBe("bad");
    });
  });

  describe("Fact", () => {
    it("renders label and value and is not focusable", async () => {
      const screen = await renderWithTheme(
        <ListGroup>
          <ListGroup.Fact label="Region" value="us-east-1" />
        </ListGroup>,
      );

      const fact = partOf(screen.container, LISTGROUP_PARTS.fact);
      expect(fact.textContent).toContain("Region");
      expect(fact.textContent).toContain("us-east-1");
      expect(fact.querySelector("button, input, a, [tabindex]")).toBeNull();
      expect(fact.hasAttribute("tabindex")).toBe(false);
    });
  });

  describe("Input", () => {
    it("renders a TextField inside the row", async () => {
      const screen = await renderWithTheme(
        <ListGroup>
          <ListGroup.Input label="Slug" value="mr-board" onChange={() => {}} />
        </ListGroup>,
      );

      const row = partOf(screen.container, LISTGROUP_PARTS.input);
      const input = row.querySelector("input");
      expect(input?.value).toBe("mr-board");
    });
  });

  describe("footer", () => {
    it("renders once under the group", async () => {
      const screen = await renderWithTheme(
        <ListGroup footer="Changes apply immediately.">
          <ListGroup.Fact label="a" value="b" />
        </ListGroup>,
      );

      const footers = allOf(screen.container, LISTGROUP_PARTS.footer);
      expect(footers).toHaveLength(1);
      expect(footers[0]?.textContent).toBe("Changes apply immediately.");
    });

    it("renders no footer node when omitted", async () => {
      const screen = await renderWithTheme(
        <ListGroup>
          <ListGroup.Fact label="a" value="b" />
        </ListGroup>,
      );

      expect(allOf(screen.container, LISTGROUP_PARTS.footer)).toHaveLength(0);
    });
  });
});

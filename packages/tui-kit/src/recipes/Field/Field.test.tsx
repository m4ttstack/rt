import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { FIELD_PARTS, RadioGroup, TextArea, TextField } from "./Field.tsx";

/**
 * Browser tier for the Field family (TextField, TextArea, RadioGroup).
 *
 * Same conventions as Switch/StatusDot/Badge: every render goes through
 * `renderWithTheme`, assertions observe rendered behaviour, and the one
 * sanctioned structural assertion is `data-part`.
 */

function rootOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-part="${FIELD_PARTS.root}"]`);
  if (!el) throw new Error("no Field root rendered");
  return el;
}

function labelOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-part="${FIELD_PARTS.label}"]`);
}

function inputOf(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(`[data-part="${FIELD_PARTS.input}"]`);
  if (!el) throw new Error("no Field input rendered");
  return el;
}

function errorOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-part="${FIELD_PARTS.error}"]`);
}

function optionsOf(container: HTMLElement): HTMLLabelElement[] {
  return Array.from(container.querySelectorAll<HTMLLabelElement>(`[data-part="${FIELD_PARTS.option}"]`));
}

describe("TextField (browser)", () => {
  it("renders a label wrapping a visible label span and an input", async () => {
    const screen = await renderWithTheme(<TextField label="Name" value="" onChange={() => {}} />);

    const root = rootOf(screen.container);
    expect(root.tagName).toBe("LABEL");
    expect(labelOf(screen.container)?.textContent).toBe("Name");
    const input = inputOf(screen.container);
    expect(input.tagName).toBe("INPUT");
    expect(root.contains(input)).toBe(true);
  });

  it("aria-label passes to the input when there is no visible label", async () => {
    const screen = await renderWithTheme(
      <TextField value="" onChange={() => {}} aria-label="new password" />,
    );

    expect(labelOf(screen.container)).toBeNull();
    expect(inputOf(screen.container).getAttribute("aria-label")).toBe("new password");
  });

  it("value/onChange are controlled", async () => {
    const onChange = vi.fn();
    const screen = await renderWithTheme(
      <TextField label="Name" value="mr-board" onChange={onChange} />,
    );

    const input = inputOf(screen.container);
    expect(input.value).toBe("mr-board");

    await userEvent.type(input, "x");

    expect(onChange).toHaveBeenCalled();
    // Uncontrolled input's own DOM value moved; `value` prop, unchanged by
    // this caller, keeps the rendered input at the prop's value.
    expect(input.value).toBe("mr-board");
  });

  it("pattern/required/placeholder/inputMode pass through to the input", async () => {
    const screen = await renderWithTheme(
      <TextField
        label="Name"
        value=""
        onChange={() => {}}
        placeholder="myapp"
        required
        pattern="[a-z0-9][a-z0-9.-]*"
        inputMode="numeric"
      />,
    );

    const input = inputOf(screen.container);
    expect(input.placeholder).toBe("myapp");
    expect(input.required).toBe(true);
    expect(input.pattern).toBe("[a-z0-9][a-z0-9.-]*");
    expect(input.inputMode).toBe("numeric");
  });

  it("error renders [data-part=field-error] with role=alert", async () => {
    const screen = await renderWithTheme(
      <TextField label="Name" value="" onChange={() => {}} error="required" />,
    );

    const error = errorOf(screen.container);
    expect(error?.textContent).toBe("required");
    expect(error?.getAttribute("role")).toBe("alert");
  });

  it("no error means no error node", async () => {
    const screenNull = await renderWithTheme(
      <TextField label="Name" value="" onChange={() => {}} error={null} />,
    );
    expect(errorOf(screenNull.container)).toBeNull();

    const screenUndefined = await renderWithTheme(
      <TextField label="Name" value="" onChange={() => {}} />,
    );
    expect(errorOf(screenUndefined.container)).toBeNull();
  });

  it("inputRef reaches the input element", async () => {
    let captured: HTMLInputElement | null = null;
    await renderWithTheme(
      <TextField
        label="Name"
        value=""
        onChange={() => {}}
        inputRef={(el) => {
          captured = el;
        }}
      />,
    );

    expect(captured).not.toBeNull();
    expect((captured as unknown as HTMLInputElement).tagName).toBe("INPUT");
  });

  it("type=password renders a password input", async () => {
    const screen = await renderWithTheme(
      <TextField type="password" value="" onChange={() => {}} aria-label="new password" />,
    );

    expect(inputOf(screen.container).type).toBe("password");
  });

  it("a consumer-supplied data-part does not win", async () => {
    // data-part is a CONTRACT between the kit and mr-board's stylesheet, not a
    // consumer-facing prop -- same pin as StatusDot/Switch/Badge.
    const screen = await renderWithTheme(
      <TextField label="Name" value="" onChange={() => {}} data-part="hijacked" />,
    );

    expect(rootOf(screen.container).getAttribute("data-part")).toBe(FIELD_PARTS.root);
    expect(screen.container.querySelectorAll('[data-part="hijacked"]')).toHaveLength(0);
  });
});

describe("TextArea (browser)", () => {
  it("renders the same chrome with a textarea", async () => {
    const screen = await renderWithTheme(
      <TextArea label="Allowed emails" rows={4} value="" onChange={() => {}} />,
    );

    const root = rootOf(screen.container);
    expect(root.tagName).toBe("LABEL");
    expect(labelOf(screen.container)?.textContent).toBe("Allowed emails");
    const textarea = screen.container.querySelector<HTMLTextAreaElement>(
      `[data-part="${FIELD_PARTS.input}"]`,
    );
    expect(textarea?.tagName).toBe("TEXTAREA");
    expect(textarea?.rows).toBe(4);
  });

  it("value/onChange are controlled and placeholder passes through", async () => {
    const screen = await renderWithTheme(
      <TextArea label="Allowed emails" value="a@example.com" onChange={() => {}} placeholder="one per line" />,
    );

    const textarea = screen.container.querySelector<HTMLTextAreaElement>(
      `[data-part="${FIELD_PARTS.input}"]`,
    );
    expect(textarea?.value).toBe("a@example.com");
    expect(textarea?.placeholder).toBe("one per line");
  });
});

describe("RadioGroup (browser)", () => {
  const options = [
    { value: "domains", label: "Anyone at these domains" },
    { value: "emails", label: "These people" },
  ];

  it("renders one field-option label per option, wrapping a radio input", async () => {
    const screen = await renderWithTheme(
      <RadioGroup name="oauth-mode" value="domains" onChange={() => {}} options={options} />,
    );

    const opts = optionsOf(screen.container);
    expect(opts).toHaveLength(2);
    for (const opt of opts) {
      const radio = opt.querySelector<HTMLInputElement>('input[type="radio"]');
      expect(radio).not.toBeNull();
      expect(radio?.name).toBe("oauth-mode");
    }
  });

  it("checked follows value", async () => {
    const screen = await renderWithTheme(
      <RadioGroup name="oauth-mode" value="emails" onChange={() => {}} options={options} />,
    );

    const radios = optionsOf(screen.container).map(
      (opt) => opt.querySelector<HTMLInputElement>('input[type="radio"]')!,
    );
    expect(radios[0]?.checked).toBe(false);
    expect(radios[1]?.checked).toBe(true);
  });

  it("change fires onChange with the option value", async () => {
    const onChange = vi.fn();
    const screen = await renderWithTheme(
      <RadioGroup name="oauth-mode" value="domains" onChange={onChange} options={options} />,
    );

    const radios = optionsOf(screen.container).map(
      (opt) => opt.querySelector<HTMLInputElement>('input[type="radio"]')!,
    );
    radios[1]?.click();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("emails");
  });

  it("renders role=radiogroup on the root", async () => {
    const screen = await renderWithTheme(
      <RadioGroup name="oauth-mode" value="domains" onChange={() => {}} options={options} />,
    );

    expect(rootOf(screen.container).getAttribute("role")).toBe("radiogroup");
  });
});

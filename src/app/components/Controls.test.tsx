import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@mattstack/app-kit/test-utils";
import { describe, expect, it, vi } from "vitest";

import { Controls } from "./Controls";

function baseProps(overrides: Partial<Parameters<typeof Controls>[0]> = {}) {
  return {
    range: "30d",
    onRange: vi.fn(),
    trend: false,
    onTrend: vi.fn(),
    view: "table" as const,
    onView: vi.fn(),
    refreshing: false,
    onRefresh: vi.fn(),
    data: null,
    ...overrides,
  };
}

describe("Controls", () => {
  it("selects a preset range immediately, without opening the custom panel", () => {
    const onRange = vi.fn();
    renderWithProviders(<Controls {...baseProps({ onRange })} />);

    fireEvent.click(screen.getByRole("button", { name: "7d" }));

    expect(onRange).toHaveBeenCalledWith("7d");
    expect(screen.queryByLabelText("Start")).not.toBeInTheDocument();
  });

  it("opens the custom date panel without calling onRange, then applies on demand", () => {
    const onRange = vi.fn();
    renderWithProviders(<Controls {...baseProps({ onRange })} />);

    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(onRange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Start")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Start"), {
      target: { value: "2026-08-01" },
    });
    fireEvent.change(screen.getByLabelText("End"), {
      target: { value: "2026-08-31" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onRange).toHaveBeenCalledWith(
      "custom",
      new Date("2026-08-01").toISOString(),
      new Date("2026-08-31").toISOString(),
    );
  });

  it("toggles trend via the segmented control", () => {
    const onTrend = vi.fn();
    renderWithProviders(<Controls {...baseProps({ onTrend })} />);

    fireEvent.click(screen.getByRole("radio", { name: "Trend" }));

    expect(onTrend).toHaveBeenCalledWith(true);
  });

  it("disables the refresh button while a refresh is in flight", () => {
    renderWithProviders(<Controls {...baseProps({ refreshing: true })} />);

    expect(screen.getByRole("button", { name: /Refresh/ })).toBeDisabled();
  });
});

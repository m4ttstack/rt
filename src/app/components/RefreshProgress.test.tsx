import { screen } from "@testing-library/react";
import { renderWithProviders } from "@mattstack/app-kit/test-utils";
import { describe, expect, it, vi } from "vitest";

import { RefreshProgress } from "./RefreshProgress";

describe("RefreshProgress", () => {
  it("renders indeterminate when the phase reports no total", () => {
    renderWithProviders(
      <RefreshProgress
        progress={{ phase: "users", label: "Fetching users", done: 0, total: 0, window: "current" }}
        onCancel={vi.fn()}
      />,
    );

    const bar = screen.getByTestId("refresh-progress");
    expect(bar).toHaveAttribute("data-state", "indeterminate");
    expect(screen.getByText(/Fetching users/)).toBeInTheDocument();
    expect(screen.queryByText(/\d+\/\d+/)).not.toBeInTheDocument();
  });

  it("renders determinate with a done/total readout once a total is known", () => {
    renderWithProviders(
      <RefreshProgress
        progress={{ phase: "mrs-detail", label: "Fetching MR details", done: 5, total: 10, window: "current" }}
        onCancel={vi.fn()}
      />,
    );

    const bar = screen.getByTestId("refresh-progress");
    expect(bar).toHaveAttribute("data-state", "determinate");
    expect(screen.getByText("5/10")).toBeInTheDocument();
  });

  it("shows the starting label before the first progress event arrives", () => {
    renderWithProviders(<RefreshProgress progress={null} onCancel={vi.fn()} />);

    expect(screen.getByTestId("refresh-progress")).toHaveAttribute("data-state", "indeterminate");
    expect(screen.getByText(/Starting/)).toBeInTheDocument();
  });
});

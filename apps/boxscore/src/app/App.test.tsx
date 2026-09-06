import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@mattstack/app-kit/test-utils";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { buildResponse } from "./components/fixtures";

const { useLeaderboard, useUserDetail } = vi.hoisted(() => ({
  useLeaderboard: vi.fn(),
  useUserDetail: vi.fn(),
}));
vi.mock("./hooks/useLeaderboard", () => ({ useLeaderboard, useUserDetail }));

const { useRefreshJob } = vi.hoisted(() => ({ useRefreshJob: vi.fn() }));
vi.mock("./hooks/useRefreshJob", () => ({ useRefreshJob }));

vi.mock("./routes", () => ({ useAppRoute: () => ({ name: "leaderboard" as const }) }));

function idleRefreshJob(overrides: Partial<ReturnType<typeof useRefreshJob>> = {}) {
  return { jobId: null, refreshing: false, progress: null, start: vi.fn(), cancel: vi.fn(), ...overrides };
}

// Regression coverage for the cold-cache orchestration bug: a cache-only probe that comes back
// cold (no cached data for this selection, e.g. trend just turned on with no prior-window cache)
// used to leave the leaderboard blank -- zero rows, no loading text -- for the whole background
// refresh, because the "Loading…" message was gated on the probe's own isFetching flag, which
// turns false the instant the probe settles, well before the refresh job it kicks off finishes.
describe("App: cold-cache orchestration", () => {
  it("shows a loading indicator, not a blank leaderboard, the instant a cold cache starts a background refresh", () => {
    useLeaderboard.mockReturnValue({ data: { cached: false }, error: null, isFetching: false });
    const start = vi.fn();
    useRefreshJob.mockReturnValue(idleRefreshJob({ start }));

    renderWithProviders(<App />);

    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(start).toHaveBeenCalled();
  });

  it("clears the loading indicator when a running refresh is cancelled, rather than stranding it", async () => {
    const user = userEvent.setup();
    useLeaderboard.mockReturnValue({ data: { cached: false }, error: null, isFetching: false });
    const cancel = vi.fn();
    useRefreshJob.mockReturnValue(idleRefreshJob({ jobId: "job-1", refreshing: true, cancel }));

    renderWithProviders(<App />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /cancel/i }));

    // cancel() never routes through onDone or onError, so if the handler does not clear the
    // flag itself the indicator stays up forever with nothing running behind it.
    expect(cancel).toHaveBeenCalled();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("keeps the loading indicator up once the refresh job is actually running (jobId assigned)", () => {
    useLeaderboard.mockReturnValue({ data: { cached: false }, error: null, isFetching: false });
    useRefreshJob.mockReturnValue(idleRefreshJob({ jobId: "job-1", refreshing: true }));

    renderWithProviders(<App />);

    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders the leaderboard, with no loading text, once warm-cache data is available", () => {
    useLeaderboard.mockReturnValue({ data: { ...buildResponse([]), cached: true }, error: null, isFetching: false });
    useRefreshJob.mockReturnValue(idleRefreshJob());

    renderWithProviders(<App />);

    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    expect(screen.getByText("No users configured, or none resolved on the instance.")).toBeInTheDocument();
  });

  it("does not show a loading indicator before any probe result has arrived and nothing is refreshing", () => {
    useLeaderboard.mockReturnValue({ data: undefined, error: null, isFetching: false });
    useRefreshJob.mockReturnValue(idleRefreshJob());

    renderWithProviders(<App />);

    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });
});

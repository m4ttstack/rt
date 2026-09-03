import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithProviders } from "@mattstack/app-kit/test-utils";
import { describe, expect, it } from "vitest";

import { MetricCards } from "./MetricCards";
import { buildMetrics, buildResponse, buildUser } from "./fixtures";

describe("MetricCards", () => {
  it("ranks each metric's card independently, by that metric's own server-computed rank", () => {
    // Ranking reads `.rank` (server-computed, ties shared), not the raw value, so the cards
    // never disagree with the table or the detail rail's own rank-driven display.
    const aliceMetrics = buildMetrics({ mrsMerged: { value: 9 }, additions: { value: 100 } });
    aliceMetrics.mrsMerged.rank = 2;
    aliceMetrics.additions.rank = 1;
    const bobMetrics = buildMetrics({ mrsMerged: { value: 14 }, additions: { value: 50 } });
    bobMetrics.mrsMerged.rank = 1;
    bobMetrics.additions.rank = 2;

    const data = buildResponse([buildUser("alice", aliceMetrics), buildUser("bob", bobMetrics)]);

    renderWithProviders(<MetricCards data={data} trend={false} />);

    const mrsCard = within(screen.getByTestId("metric-card-mrsMerged"));
    expect(mrsCard.getAllByText(/^(alice|bob)$/).map((el) => el.textContent)).toEqual(["bob", "alice"]);

    const additionsCard = within(screen.getByTestId("metric-card-additions"));
    expect(additionsCard.getAllByText(/^(alice|bob)$/).map((el) => el.textContent)).toEqual(["alice", "bob"]);
  });

  it("navigates to that user's metric detail route when a ranked row is clicked", () => {
    const data = buildResponse([buildUser("alice", buildMetrics({ mrsMerged: { value: 9 } }))]);
    renderWithProviders(<MetricCards data={data} trend={false} />);

    fireEvent.click(within(screen.getByTestId("metric-card-mrsMerged")).getByText("alice"));

    expect(window.location.pathname).toBe("/user/alice/mrsMerged");
  });

  it("renders a delta badge with the trend's sign when trend is on, and omits it when off", () => {
    const withTrend = buildResponse(
      [buildUser("alice", buildMetrics({ mrsMerged: { value: 10, delta: 4 } }))],
      { hasTrend: true },
    );
    const { unmount } = renderWithProviders(<MetricCards data={withTrend} trend />);
    const badge = within(screen.getByTestId("metric-card-mrsMerged")).getByText(/▲ 4/);
    expect(badge).toHaveAttribute("data-good", "true");
    unmount();

    renderWithProviders(<MetricCards data={withTrend} trend={false} />);
    expect(within(screen.getByTestId("metric-card-mrsMerged")).queryByText(/▲ 4/)).not.toBeInTheDocument();
  });

  it("excludes unresolved users and users with no value for that metric from a card's ranking", () => {
    const data = buildResponse([
      buildUser("alice", buildMetrics({ mrsMerged: { value: 9 } })),
      buildUser("bob", buildMetrics({ mrsMerged: { value: 3 } }), { resolved: false }),
    ]);

    renderWithProviders(<MetricCards data={data} trend={false} />);

    const mrsCard = within(screen.getByTestId("metric-card-mrsMerged"));
    expect(mrsCard.getByText("alice")).toBeInTheDocument();
    expect(mrsCard.queryByText("bob")).not.toBeInTheDocument();
  });
});

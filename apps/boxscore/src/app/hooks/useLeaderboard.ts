import { useQuery } from "@tanstack/react-query";

import {
  client,
  readOrThrow,
  selectionQuery,
  type DetailResult,
  type LeaderboardResult,
  type RangeSelection,
} from "../api";

/** Cache-only read: matches the probe the old fetchLeaderboard({cacheOnly:true}) made before deciding whether to start a refresh job. */
export function useLeaderboard(selection: RangeSelection) {
  return useQuery({
    queryKey: ["leaderboard", selection],
    queryFn: async () => {
      const res = await client.api.leaderboard.$get({
        query: { ...selectionQuery(selection), cacheOnly: "1" },
      });
      return readOrThrow<LeaderboardResult>(res, "leaderboard");
    },
    // Matches the old one-shot fetch: no silent retries before an error reaches the UI.
    retry: false,
  });
}

export function useUserDetail(username: string, selection: RangeSelection) {
  return useQuery({
    queryKey: ["detail", username, selection],
    queryFn: async () => {
      const res = await client.api.detail.$get({
        query: { ...selectionQuery(selection), user: username },
      });
      return readOrThrow<DetailResult>(res, "user detail");
    },
    retry: false,
  });
}

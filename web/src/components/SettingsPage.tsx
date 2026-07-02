import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Save, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { clearCache, fetchCacheStats, fetchLinearStates, fetchSettings, fetchSuspectedBots, saveSettings } from "@/api";
import type { SuspectedBot } from "@/api";
import { navigateHome } from "@/hooks/useHashRoute";
import type { AppSettings, LinearStateInfo } from "../../../shared/types";

const BUILTIN_PATTERNS = ["project_N_bot", "group_N_bot", "*_bot_*", "*_bot", "ghost"];

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function parsePatterns(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseUsers(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function groupByType(states: LinearStateInfo[]): Map<string, LinearStateInfo[]> {
  const map = new Map<string, LinearStateInfo[]>();
  for (const s of states) {
    const g = map.get(s.type) ?? [];
    g.push(s);
    map.set(s.type, g);
  }
  const order = ["completed", "canceled", "started", "unstarted", "backlog"];
  const sorted = new Map<string, LinearStateInfo[]>();
  for (const k of order) {
    const g = map.get(k);
    if (g) sorted.set(k, g);
    map.delete(k);
  }
  for (const [k, g] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    sorted.set(k, g);
  }
  return sorted;
}

function typeLabel(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export default function SettingsPage() {
  const [saved, setSaved] = useState<AppSettings | null>(null);
  const [defaults, setDefaults] = useState<AppSettings | null>(null);
  const [linearTeam, setLinearTeam] = useState("");
  const [users, setUsers] = useState("");
  const [currentUser, setCurrentUser] = useState("");
  const [tooSmall, setTooSmall] = useState("10");
  const [tooLarge, setTooLarge] = useState("400");
  const [extraBotPatterns, setExtraBotPatterns] = useState("");
  const [excludeFilePatterns, setExcludeFilePatterns] = useState("");
  const [ignoredMrs, setIgnoredMrs] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmText, setConfirmText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suspectedBots, setSuspectedBots] = useState<SuspectedBot[]>([]);
  const [workflowStates, setWorkflowStates] = useState<LinearStateInfo[]>([]);
  const [doneStates, setDoneStates] = useState<string[]>([]);
  const [cachedMrCount, setCachedMrCount] = useState<number | null>(null);
  const [linearIdStats, setLinearIdStats] = useState<{ valid: number; invalid: number } | null>(null);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    setError(null);
    Promise.all([
      fetchSettings(),
      fetchLinearStates().catch(() => ({ states: [] })),
      fetchSuspectedBots().catch(() => ({ bots: [] })),
      fetchCacheStats().catch(() => ({ mrDetails: 0 })),
    ])
      .then(([settingsRes, statesRes, botsRes, cacheRes]) => {
        setSaved(settingsRes.settings);
        setDefaults(settingsRes.defaults);
        setLinearTeam(settingsRes.settings.linearTeam);
        setDoneStates([...settingsRes.settings.doneStates]);
        setUsers(settingsRes.settings.users.join("\n"));
        setCurrentUser(settingsRes.settings.currentUser);
        setTooSmall(String(settingsRes.settings.sizeBand.tooSmall));
        setTooLarge(String(settingsRes.settings.sizeBand.tooLarge));
        setExtraBotPatterns(settingsRes.settings.bots.extraPatterns.join("\n"));
        setExcludeFilePatterns(settingsRes.settings.excludeFilePatterns.join("\n"));
        setIgnoredMrs(settingsRes.settings.ignoredMrs.join("\n"));
        setWorkflowStates(statesRes.states);
        setSuspectedBots(botsRes.bots);
        setCachedMrCount(cacheRes.mrDetails);
        setLinearIdStats(cacheRes.linearIds);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const toggleState = useCallback((name: string) => {
    setDoneStates((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }, []);

  const resetToDefaults = useCallback(() => {
    if (!defaults) return;
    setLinearTeam(defaults.linearTeam);
    setDoneStates([...defaults.doneStates]);
    setUsers(defaults.users.join("\n"));
    setCurrentUser(defaults.currentUser);
    setTooSmall(String(defaults.sizeBand.tooSmall));
    setTooLarge(String(defaults.sizeBand.tooLarge));
    setExtraBotPatterns(defaults.bots.extraPatterns.join("\n"));
    setExcludeFilePatterns(defaults.excludeFilePatterns.join("\n"));
    setIgnoredMrs(defaults.ignoredMrs.join("\n"));
  }, [defaults]);

  const handleSave = useCallback(async () => {
    if (!saved) return;
    setSaving(true);
    setError(null);
    setConfirmText(null);
    try {
      const userList = parseUsers(users);
      const formPatterns = parsePatterns(extraBotPatterns);

      if (userList.length === 0) {
        setError("Team members list cannot be empty.");
        setSaving(false);
        return;
      }
      if (!userList.includes(currentUser)) {
        setError("Current user must be in the team members list.");
        setSaving(false);
        return;
      }

      const partial: Partial<AppSettings> = {};

      const doneStatesChanged = !arraysEqual(doneStates, saved.doneStates);
      const linearTeamChanged = linearTeam !== saved.linearTeam;
      const usersChanged = !arraysEqual(userList, saved.users);
      const currentUserChanged = currentUser !== saved.currentUser;
      const sizeBandChanged =
        Number(tooSmall) !== saved.sizeBand.tooSmall ||
        Number(tooLarge) !== saved.sizeBand.tooLarge;
      const formFilePatterns = parsePatterns(excludeFilePatterns);
      const filePatternsChanged = !arraysEqual(formFilePatterns, saved.excludeFilePatterns);
      const formIgnoredMrs = parsePatterns(ignoredMrs);
      const ignoredMrsChanged = !arraysEqual(formIgnoredMrs, saved.ignoredMrs);
      const botsChanged = !arraysEqual(formPatterns, saved.bots.extraPatterns);

      if (linearTeamChanged || doneStatesChanged || usersChanged || currentUserChanged) {
        partial.linearTeam = linearTeam;
        partial.doneStates = doneStates;
        partial.users = userList;
        partial.currentUser = currentUser;
      }
      if (sizeBandChanged) {
        partial.sizeBand = {
          tooSmall: Number(tooSmall),
          tooLarge: Number(tooLarge),
        };
      }
      if (botsChanged) {
        partial.bots = { extraPatterns: formPatterns };
      }
      if (filePatternsChanged) {
        partial.excludeFilePatterns = formFilePatterns;
      }
      if (ignoredMrsChanged) {
        partial.ignoredMrs = formIgnoredMrs;
      }

      if (Object.keys(partial).length === 0) {
        setConfirmText("No changes to save.");
        setTimeout(() => setConfirmText(null), 2000);
        return;
      }

      const result = await saveSettings(partial);
      setSaved(result.settings);
      setConfirmText("Saved.");
      setTimeout(() => setConfirmText(null), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [saved, linearTeam, doneStates, users, currentUser, tooSmall, tooLarge, extraBotPatterns, excludeFilePatterns, ignoredMrs]);

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const userList = parseUsers(users);

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <header className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={navigateHome} className="-ml-2">
          <ArrowLeft />
          Back
        </Button>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
      </header>

      {error && (
        <div className="mb-5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Linear team */}
      <Card className="mb-5">
        <CardHeader>
          <CardTitle>Linear team</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {(() => {
            const teams = [...new Set(workflowStates.map((s) => s.teamKey))]
              .filter(Boolean)
              .sort((a, b) => a.localeCompare(b));
            if (teams.length === 0) {
              return (
                <p className="text-xs text-muted-foreground">
                  No workflow states available. Linear may not be configured, or the API is unreachable.
                </p>
              );
            }
            const teamStates = linearTeam
              ? workflowStates
                  .filter((s) => s.teamKey === linearTeam)
                  // Dedupe by name — Linear sometimes returns the same state multiple times
                  .filter((s, i, arr) => arr.findIndex((x) => x.name === s.name) === i)
              : [];
            const effective = doneStates.length > 0
              ? doneStates
              : teamStates.filter((s) => s.type === "completed" || s.type === "canceled").map((s) => s.name);
            const groups = groupByType(teamStates);
            return (
              <>
                <label className="flex flex-col gap-1 text-sm text-muted-foreground">
                  Team
                  <select
                    value={linearTeam}
                    onChange={(e) => setLinearTeam(e.target.value)}
                    className="rounded-md border bg-background px-2 py-1.5 text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <option value="">Select a team...</option>
                    {teams.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </label>

                {teamStates.length > 0 && (
                  <fieldset>
                    <legend className="mb-2 text-sm text-muted-foreground">
                      Count tickets in these states
                    </legend>
                    {[...groups.entries()].map(([type, states]) => (
                      <div key={type} className="mb-2">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {typeLabel(type)}
                        </span>
                        <div className="mt-0.5 flex flex-col gap-0.5">
                          {states.map((s) => (
                            <label key={s.name} className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                              <input
                                type="checkbox"
                                checked={effective.includes(s.name)}
                                onChange={() => toggleState(s.name)}
                                className="h-4 w-4 rounded border-border accent-primary"
                              />
                              {s.name}
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </fieldset>
                )}
              </>
            );
          })()}
        </CardContent>
      </Card>

      {/* Team */}
      <Card className="mb-5">
        <CardHeader>
          <CardTitle>Team</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            GitLab usernames (one per line)
            <textarea
              rows={8}
              value={users}
              onChange={(e) => setUsers(e.target.value)}
              className="rounded-md border bg-background px-2 py-1 text-foreground font-mono text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 resize-y"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Current user (highlighted in the leaderboard)
            <select
              value={currentUser}
              onChange={(e) => setCurrentUser(e.target.value)}
              className="rounded-md border bg-background px-2 py-1.5 text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {userList.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
        </CardContent>
      </Card>

      {/* Size health */}
      <Card className="mb-5">
        <CardHeader>
          <CardTitle>Size health</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Too small (lines)
            <input
              type="number"
              min={0}
              value={tooSmall}
              onChange={(e) => setTooSmall(e.target.value)}
              className="rounded-md border bg-background px-2 py-1 text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Too large (lines)
            <input
              type="number"
              min={0}
              value={tooLarge}
              onChange={(e) => setTooLarge(e.target.value)}
              className="rounded-md border bg-background px-2 py-1 text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </label>
        </CardContent>
      </Card>

      {/* Bot accounts */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Bot accounts</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-xs text-muted-foreground">
            GitLab service accounts (project bots, CI automation users) auto-comment on MRs
            without actually reviewing them. These are filtered out of review latency and
            reciprocity metrics so they don't skew the numbers.
          </p>
          {suspectedBots.length > 0 && (
            <div className="rounded-md border bg-muted/30 px-3 py-2">
              <span className="text-xs font-medium text-foreground">
                Suspected bots found in cached data:
              </span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {suspectedBots.map((b) => (
                  <Badge key={b.username} variant="secondary" className="text-xs">
                    {b.username}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Built-in patterns:</span>
            {BUILTIN_PATTERNS.map((pat) => (
              <Badge key={pat} variant="outline" className="text-xs text-muted-foreground">
                {pat}
              </Badge>
            ))}
          </div>
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Extra bot patterns (one regex per line)
            <textarea
              rows={3}
              value={extraBotPatterns}
              onChange={(e) => setExtraBotPatterns(e.target.value)}
              placeholder="e.g. ^ci-bot$"
              className="rounded-md border bg-background px-2 py-1 text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 resize-y"
            />
          </label>
        </CardContent>
      </Card>

      {/* File exclusions */}
      <Card className="mb-5">
        <CardHeader>
          <CardTitle>File exclusions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-xs text-muted-foreground">
            Files matching these glob patterns are excluded from additions/deletions counts.
            One pattern per line. Supports * and ** wildcards.
          </p>
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Exclude patterns
            <textarea
              rows={3}
              value={excludeFilePatterns}
              onChange={(e) => setExcludeFilePatterns(e.target.value)}
              placeholder={"*.json\n*.lock\ngenerated/*"}
              className="rounded-md border bg-background px-2 py-1 text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 resize-y"
            />
          </label>
        </CardContent>
      </Card>

      {/* Ignored MRs */}
      <Card className="mb-5">
        <CardHeader>
          <CardTitle>Ignored MRs</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-xs text-muted-foreground">
            MRs listed here are excluded from all metrics. One per line.
            Use <code className="text-xs">!123</code> to match by IID across all projects,
            or <code className="text-xs">group/project!123</code> to match a specific project.
          </p>
          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Ignored MRs
            <textarea
              rows={3}
              value={ignoredMrs}
              onChange={(e) => setIgnoredMrs(e.target.value)}
              placeholder={"!456\ngroup/project!789"}
              className="rounded-md border bg-background px-2 py-1 text-foreground font-mono text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 resize-y"
            />
          </label>
        </CardContent>
      </Card>

      {/* Cache */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Cache</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Merge request details are cached permanently so refreshes only fetch new data.
            Clear the cache to force a full re-fetch on the next refresh.
          </p>
          <div className="flex items-center gap-3">
            <Button
              variant="destructive"
              size="sm"
              disabled={clearing}
              onClick={async () => {
                setClearing(true);
                try {
                  await clearCache();
                  setCachedMrCount(0);
                  setLinearIdStats({ valid: 0, invalid: 0 });
                  setConfirmText("Cache cleared.");
                  setTimeout(() => setConfirmText(null), 2000);
                } catch {
                  setError("Failed to clear cache");
                } finally {
                  setClearing(false);
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {clearing ? "Clearing..." : "Clear cache"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {cachedMrCount !== null && `${cachedMrCount} MR details`}
              {linearIdStats !== null && linearIdStats.valid + linearIdStats.invalid > 0 &&
                ` · ${linearIdStats.valid} valid / ${linearIdStats.invalid} invalid Linear IDs`}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Footer */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          <Save />
          Save
        </Button>
        <Button variant="outline" onClick={resetToDefaults} disabled={!defaults}>
          Reset to defaults
        </Button>
        {confirmText && (
          <span className="text-sm text-muted-foreground">{confirmText}</span>
        )}
      </div>
    </div>
  );
}

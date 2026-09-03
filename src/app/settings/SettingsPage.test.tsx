import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@mattstack/app-kit/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { SettingDefWire } from "@mattstack/settings-kit/react";

import { SettingsPage } from "./SettingsPage";

const { useSettingsScope, useSettingKey } = vi.hoisted(() => ({
  useSettingsScope: vi.fn(),
  useSettingKey: vi.fn(),
}));
vi.mock("@mattstack/settings-kit/react", () => ({ useSettingsScope, useSettingKey }));

function def(overrides: Partial<SettingDefWire> & { key: string }): SettingDefWire {
  return {
    type: "array",
    scopes: ["team"],
    merge: "replace",
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: "",
    hasDefault: false,
    defaultValue: null,
    effective: { scope: "team", value: [], file: "team.jsonc" },
    ...overrides,
  };
}

function scopeState(defs: SettingDefWire[], overrides: Partial<ReturnType<typeof useSettingsScope>> = {}) {
  return {
    defs,
    loading: false,
    error: null,
    refresh: vi.fn(),
    set: vi.fn().mockResolvedValue(null),
    saving: null,
    unset: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function keyState(rosterDef: SettingDefWire | null, overrides: Partial<ReturnType<typeof useSettingKey>> = {}) {
  return {
    def: rosterDef,
    rows: [],
    loading: false,
    error: null,
    staged: undefined,
    stage: vi.fn(),
    reset: vi.fn(),
    apply: vi.fn().mockResolvedValue(true),
    applying: false,
    applyError: null,
    refresh: vi.fn(),
    ...overrides,
  };
}

const ROSTER_DEF = def({
  key: "mattstack.roster",
  type: "array",
  scopes: ["team"],
  description: "The suite-wide team roster.",
  effective: { scope: "team", value: [{ username: "m4ttheweric", name: "Matthew Goodwin" }], file: "team.jsonc" },
});

const PROJECTS_DEF = def({
  key: "boxscore.projects",
  description: "GitLab projects boxscore scores, as full paths.",
  effective: { scope: "team", value: ["acme/acme-web"], file: "team.jsonc" },
});

const IGNORED_MRS_READONLY = def({
  key: "boxscore.ignoredMrs",
  writable: false,
  description: "MRs excluded from all metrics.",
  effective: { scope: "team", value: ["!123"], file: "team.jsonc" },
});

const DEFAULT_RANGE_DEF = def({
  key: "boxscore.defaultRange",
  type: "string",
  scopes: ["user"],
  description: "The window the leaderboard opens on.",
  effective: { scope: "user", value: "30d", file: "user.jsonc" },
});

describe("SettingsPage", () => {
  it("sends the FULL array back on save when a string-array team key is edited, not a partial patch", () => {
    const set = vi.fn().mockResolvedValue(null);
    useSettingsScope.mockReturnValue(scopeState([PROJECTS_DEF], { set }));
    useSettingKey.mockReturnValue(keyState(ROSTER_DEF));

    renderWithProviders(<SettingsPage />);

    const input = screen.getByRole("combobox", { name: "boxscore.projects" });
    // TagsInput ignores a change event fired at an unfocused input (Mantine's
    // isExternalInputChange guard, meant to ignore autofill/extension writes).
    input.focus();
    fireEvent.change(input, { target: { value: "other/project" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(set).toHaveBeenCalledWith("boxscore.projects", "team", ["acme/acme-web", "other/project"]);
  });

  it("renders a non-writable key read-only, with no editor control", () => {
    useSettingsScope.mockReturnValue(scopeState([IGNORED_MRS_READONLY]));
    useSettingKey.mockReturnValue(keyState(ROSTER_DEF));

    renderWithProviders(<SettingsPage />);

    expect(screen.getByText('["!123"]')).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "boxscore.ignoredMrs" })).not.toBeInTheDocument();
  });

  it("puts team keys (and the roster) in the Team section and user keys in the You section", () => {
    useSettingsScope.mockReturnValue(scopeState([PROJECTS_DEF, DEFAULT_RANGE_DEF]));
    useSettingKey.mockReturnValue(keyState(ROSTER_DEF));

    const { container } = renderWithProviders(<SettingsPage />);
    const text = container.textContent ?? "";

    const teamIdx = text.indexOf("Team");
    const rosterIdx = text.indexOf("mattstack.roster");
    const projectsIdx = text.indexOf("boxscore.projects");
    const youIdx = text.indexOf("You");
    const rangeIdx = text.indexOf("boxscore.defaultRange");

    expect(teamIdx).toBeGreaterThanOrEqual(0);
    expect(rosterIdx).toBeGreaterThan(teamIdx);
    expect(projectsIdx).toBeGreaterThan(rosterIdx);
    expect(youIdx).toBeGreaterThan(projectsIdx);
    expect(rangeIdx).toBeGreaterThan(youIdx);
  });

  it("writes the whole roster array back (not a partial patch) when a member is added", () => {
    const stage = vi.fn();
    useSettingsScope.mockReturnValue(scopeState([]));
    useSettingKey.mockReturnValue(keyState(ROSTER_DEF, { stage }));

    renderWithProviders(<SettingsPage />);

    fireEvent.change(screen.getByLabelText("new roster member username"), { target: { value: "newperson" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(stage).toHaveBeenCalledWith("team", [{ username: "m4ttheweric", name: "Matthew Goodwin" }, { username: "newperson" }]);
  });

  it("renders the default-range key as a select over the range presets", () => {
    useSettingsScope.mockReturnValue(scopeState([DEFAULT_RANGE_DEF]));
    useSettingKey.mockReturnValue(keyState(ROSTER_DEF));

    renderWithProviders(<SettingsPage />);

    expect(screen.getByRole("combobox", { name: "boxscore.defaultRange" })).toHaveValue("30d");
  });
});

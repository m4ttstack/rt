import { useEffect, useState } from "react";

import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  NumberInput,
  PageShell,
  Paper,
  Select,
  Stack,
  Text,
  TagsInput,
  TextInput,
} from "@mattstack/app-kit/core";
import { Icon } from "@mattstack/app-kit/icons";
import {
  useSettingKey,
  useSettingsScope,
  type SettingKeyState,
  type SettingsScopeState,
} from "@mattstack/settings-kit/react";

import {
  COMPOSITE_SHAPES,
  asRosterEntries,
  formatValue,
  getLeaf,
  isSet,
  matchesShape,
  rowKind,
  selectOptions,
  setLeaf,
  type ConfigDef,
  type RosterEntry,
} from "./shapes";

const KEY_LABELS: Record<string, string> = {
  "mattstack.roster": "Roster",
  "boxscore.projects": "Projects",
  "boxscore.linearDoneStates": "Linear done states",
  "boxscore.sizeBand": "Size band",
  "boxscore.excludeFilePatterns": "File exclusions",
  "boxscore.ignoredMrs": "Ignored MRs",
  "boxscore.botPatterns": "Bot patterns",
  "boxscore.hiddenMembers": "Hidden members",
  "boxscore.defaultRange": "Default range",
};

function keyLabel(key: string): string {
  return KEY_LABELS[key] ?? key;
}

const ROW_BORDER = "1px solid var(--mantine-color-default-border)";

function scopeBadge(scope: string) {
  return (
    <Badge
      size="xs"
      variant="light"
      color={scope === "team" ? "purple" : "cyan"}
    >
      {scope} store
    </Badge>
  );
}

/** One row's save affordance over `useSettingsScope`. Every call writes the
    whole value for the key -- there is no partial-patch path on the wire. */
function useRowSave(store: SettingsScopeState, def: ConfigDef) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = def.scopes[0] ?? "team";
  const save = async (value: unknown) => {
    setBusy(true);
    setError(null);
    const err = await store.set(def.key, scope, value);
    setBusy(false);
    if (err) setError(err);
    return err === null;
  };
  return { busy, error, save };
}

function StringListControl({
  def,
  value,
  row,
}: {
  def: ConfigDef;
  value: unknown;
  row: ReturnType<typeof useRowSave>;
}) {
  const list = Array.isArray(value) ? (value as string[]) : [];
  return (
    <TagsInput
      value={list}
      onChange={(next) => void row.save(next)}
      disabled={row.busy}
      placeholder="add…"
      aria-label={def.key}
      size="xs"
    />
  );
}

function LeavesControl({
  def,
  value,
  fields,
  row,
}: {
  def: ConfigDef;
  value: unknown;
  fields: Record<string, "string" | "number">;
  row: ReturnType<typeof useRowSave>;
}) {
  return (
    <Group gap="sm">
      {Object.entries(fields).map(([path, type]) => {
        const leaf = getLeaf(value, path);
        const label = `${def.key}.${path}`;
        return (
          <NumberInput
            key={path}
            label={path}
            size="xs"
            w={110}
            value={
              type === "number"
                ? typeof leaf === "number"
                  ? leaf
                  : ""
                : String(leaf ?? "")
            }
            disabled={row.busy}
            aria-label={label}
            onChange={(v) =>
              void row.save(setLeaf(value, path, v === "" ? undefined : v))
            }
          />
        );
      })}
    </Group>
  );
}

function SelectControl({
  def,
  value,
  row,
}: {
  def: ConfigDef;
  value: unknown;
  row: ReturnType<typeof useRowSave>;
}) {
  return (
    <Select
      data={[...selectOptions(def)]}
      value={typeof value === "string" ? value : null}
      disabled={row.busy}
      aria-label={def.key}
      size="xs"
      w={120}
      onChange={(v) => {
        if (v) void row.save(v);
      }}
    />
  );
}

function ScalarControl({
  def,
  value,
  row,
}: {
  def: ConfigDef;
  value: unknown;
  row: ReturnType<typeof useRowSave>;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  useEffect(() => setText(value === undefined ? "" : String(value)), [value]);
  return (
    <TextInput
      value={text}
      size="xs"
      disabled={row.busy}
      aria-label={def.key}
      onTextChange={setText}
      onBlur={() => {
        if (text !== (value === undefined ? "" : String(value)))
          void row.save(text);
      }}
    />
  );
}

function SettingRow({
  def,
  store,
}: {
  def: ConfigDef;
  store: SettingsScopeState;
}) {
  const kind = rowKind(def);
  const row = useRowSave(store, def);
  const value = def.effective.value;
  const shape = COMPOSITE_SHAPES[def.key];
  const malformed =
    shape !== undefined && value !== undefined && !matchesShape(shape, value);

  let control;
  if (def.secret || kind === "readonly" || malformed) {
    control = (
      <Text size="xs" c="dimmed">
        {value === undefined ? "unset" : formatValue(value)}
        {malformed && " (unexpected shape, edit the store file)"}
      </Text>
    );
  } else if (kind === "stringList") {
    control = <StringListControl def={def} value={value} row={row} />;
  } else if (kind === "leaves" && shape?.kind === "leaves") {
    control = (
      <LeavesControl def={def} value={value} fields={shape.fields} row={row} />
    );
  } else if (kind === "select") {
    control = <SelectControl def={def} value={value} row={row} />;
  } else {
    control = <ScalarControl def={def} value={value} row={row} />;
  }

  return (
    <Group
      align="flex-start"
      wrap="nowrap"
      gap="md"
      p="sm"
      data-key={def.key}
      style={{ borderTop: ROW_BORDER }}
    >
      <Stack gap={2} style={{ minWidth: 220, flex: "none" }}>
        <Text size="sm" fw={600}>
          {keyLabel(def.key)}
        </Text>
        <Text size="xs" c="dimmed">
          {def.key}
        </Text>
      </Stack>
      <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
        {def.description && (
          <Text size="xs" c="dimmed">
            {def.description}
          </Text>
        )}
        {control}
        {row.error && (
          <Text size="xs" c="red">
            {row.error}
          </Text>
        )}
        {row.busy && <Loader size={12} />}
      </Stack>
      <Group gap={6} wrap="nowrap" align="flex-start" style={{ flex: "none" }}>
        {scopeBadge(def.scopes[0] ?? "user")}
        {!isSet(def) && (
          <Text size="xs" c="dimmed">
            unset
          </Text>
        )}
      </Group>
    </Group>
  );
}

/** The roster row's editor. `mattstack.roster` is shared across every
    mattstack app, so it comes from `useSettingKey`, not the boxscore-
    prefixed scope hook. `stage` + `apply` is the kit's two-step write; the
    optimistic value below is boxscore's own bookkeeping so the row reflects
    each edit immediately instead of waiting on the hook's `def` to refetch. */
function RosterRow({ keyState }: { keyState: SettingKeyState }) {
  const def = keyState.def;
  const scope = def?.scopes[0] ?? "team";
  const [optimistic, setOptimistic] = useState<RosterEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftUsername, setDraftUsername] = useState("");
  const [draftName, setDraftName] = useState("");

  // A freshly loaded def (mount, or an explicit refresh) is the new source
  // of truth; a def reference changes only then, never on our own applies.
  useEffect(() => setOptimistic(null), [def]);

  useEffect(() => {
    if (!keyState.staged) return;
    let alive = true;
    void keyState.apply().then((ok) => {
      if (!alive) return;
      setBusy(false);
      if (!ok) setError(keyState.applyError ?? "could not save roster");
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyState.staged]);

  if (!def) return null;
  const roster = optimistic ?? asRosterEntries(def.effective.value);
  const writable = def.writable;

  const commit = (next: RosterEntry[]) => {
    setOptimistic(next);
    setBusy(true);
    setError(null);
    keyState.stage(scope, next);
  };

  const add = () => {
    const username = draftUsername.trim();
    if (!username) return;
    const name = draftName.trim();
    commit([...roster, name ? { username, name } : { username }]);
    setDraftUsername("");
    setDraftName("");
  };

  return (
    <Group align="flex-start" wrap="nowrap" gap="md" p="sm" data-key={def.key}>
      <Stack gap={2} style={{ minWidth: 220, flex: "none" }}>
        <Text size="sm" fw={600}>
          Roster
        </Text>
        <Text size="xs" c="dimmed">
          mattstack.roster
        </Text>
      </Stack>
      <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
        {def.description && (
          <Text size="xs" c="dimmed">
            {def.description}
          </Text>
        )}
        {writable ? (
          <Paper withBorder p="xs">
            <Stack gap={4}>
              {roster.length === 0 && (
                <Text size="xs" c="dimmed">
                  no members
                </Text>
              )}
              {roster.map((m, i) => (
                <Group
                  key={`${m.username}-${i}`}
                  justify="space-between"
                  wrap="nowrap"
                >
                  <Group gap={6} wrap="nowrap">
                    <Text size="xs">{m.username}</Text>
                    {m.name && (
                      <Text size="xs" c="dimmed">
                        {m.name}
                      </Text>
                    )}
                  </Group>
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    color="gray"
                    aria-label={`remove ${m.username} from roster`}
                    disabled={busy}
                    onClick={() => commit(roster.filter((_, j) => j !== i))}
                  >
                    <Icon name="close" size={12} />
                  </ActionIcon>
                </Group>
              ))}
              <Group gap={6} wrap="nowrap">
                <TextInput
                  size="xs"
                  placeholder="gitlab username"
                  aria-label="new roster member username"
                  value={draftUsername}
                  onTextChange={setDraftUsername}
                  disabled={busy}
                />
                <TextInput
                  size="xs"
                  placeholder="name (optional)"
                  aria-label="new roster member name"
                  value={draftName}
                  onTextChange={setDraftName}
                  disabled={busy}
                />
                <Button
                  size="xs"
                  variant="default"
                  disabled={busy || !draftUsername.trim()}
                  onClick={add}
                >
                  Add
                </Button>
              </Group>
            </Stack>
          </Paper>
        ) : (
          <Text size="xs" c="dimmed">
            {roster.length} member{roster.length === 1 ? "" : "s"}
          </Text>
        )}
        {error && (
          <Text size="xs" c="red">
            {error}
          </Text>
        )}
        {busy && <Loader size={12} />}
      </Stack>
      <Group gap={6} wrap="nowrap" align="flex-start" style={{ flex: "none" }}>
        {scopeBadge(scope)}
      </Group>
    </Group>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <Stack gap="xs">
      <Group gap="sm" align="baseline">
        <Text size="sm" fw={700}>
          {title}
        </Text>
        <Text size="xs" c="dimmed">
          {subtitle}
        </Text>
      </Group>
      <Paper withBorder>
        <Stack gap={0}>{children}</Stack>
      </Paper>
    </Stack>
  );
}

export function SettingsPage() {
  const store = useSettingsScope("boxscore.");
  const roster = useSettingKey("mattstack.roster");

  const teamDefs = store.defs.filter((d) => d.scopes[0] === "team");
  const userDefs = store.defs.filter((d) => d.scopes[0] === "user");

  return (
    <PageShell>
      <Stack gap="xl">
        <Stack gap={2}>
          <Text fw={700} size="xl">
            Settings
          </Text>
          <Text size="xs" c="dimmed">
            rt settings explain &lt;key&gt; shows the full resolution chain for
            any key below.
          </Text>
        </Stack>

        {store.error && (
          <Alert color="red" title="Could not load settings">
            {store.error}
          </Alert>
        )}
        {roster.error && (
          <Alert color="red" title="Could not load the roster">
            {roster.error}
          </Alert>
        )}

        {store.loading && !store.error ? (
          <Loader size="sm" />
        ) : (
          <>
            <Section title="Team" subtitle="team store · local until pushed">
              {!roster.loading && !roster.error && (
                <RosterRow keyState={roster} />
              )}
              {teamDefs.map((def) => (
                <SettingRow key={def.key} def={def} store={store} />
              ))}
            </Section>

            <Section
              title="You"
              subtitle="user store · follows you to every machine"
            >
              {userDefs.map((def) => (
                <SettingRow key={def.key} def={def} store={store} />
              ))}
              {userDefs.length === 0 && (
                <Text size="xs" c="dimmed" p="sm">
                  no user-scoped keys
                </Text>
              )}
            </Section>
          </>
        )}
      </Stack>
    </PageShell>
  );
}

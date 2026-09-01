// React port of the Alpine `board` component (core/board.js). Same field
// names, same branch order; derived values delegate to logic.ts and network
// calls delegate to api.ts. Switch/TextField in the kit are controlled
// components, so the ev.target.checked snap-back board.js needed for Alpine's
// checkbox (see onPasswordSwitch/onOauthSwitch there) is unnecessary here:
// leaving `checked`-backing state untouched on a failed request already
// re-renders the control back to the server's last-known truth.
import { useCallback, useEffect, useRef, useState } from "react";
import { apiDelete, apiPatch, apiPost, apiPut, getStatus, pushRemote as postPushRemote, setRemote as postSetRemote } from "./api.ts";
import {
  PROXY_WAIT_MS,
  REFRESH_MS,
  addPayload,
  autoBanner,
  editPatch,
  reconcileRestarting,
  sections as sectionsOf,
  subline as sublineOf,
  tunnels as tunnelsOf,
  type Notice,
  type RestartingMap,
  type Row,
  type StatusData,
} from "./logic.ts";

export interface EditingState {
  app: string;
  value: string;
}

export interface AddModalState {
  name: string;
  external: boolean;
  command: string;
  workingDirectory: string;
  staticPort: string;
  error: string | null;
}

export interface EditModalState {
  original: string;
  name: string;
  port: string;
  kind: string;
  command: string;
  workingDirectory: string;
  error: string | null;
}

export interface AccessModalState {
  app: string;
  password: string;
  pwError: string | null;
  pwBusy: boolean;
  oauthOn: boolean;
  mode: "emails" | "domains";
  entries: string[];
  entryDraft: string;
  oauthError: string | null;
  oauthBusy: boolean;
}

/** Poll until the board answers again. Served through the proxy, that only
    happens once the proxy is back; served on localhost directly, it never
    drops, so stop waiting once the restart has had time to complete. */
async function waitForProxy(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let sawDrop = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch("/healthz", { cache: "no-store" });
      if (res.ok && sawDrop) return true;
      if (!res.ok) sawDrop = true;
    } catch {
      sawDrop = true; // connection refused while the proxy is down
    }
    if (!sawDrop && Date.now() > deadline - timeoutMs + 15000) return true;
  }
  return false;
}

export function useBoardState() {
  const [data, setData] = useState<StatusData | null>(null);
  const [restarting, setRestarting] = useState<RestartingMap>({});
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [addModal, setAddModal] = useState<AddModalState | null>(null);
  const [editModal, setEditModal] = useState<EditModalState | null>(null);
  const [accessModal, setAccessModal] = useState<AccessModalState | null>(null);
  const [pendingRemove, setPendingRemove] = useState<Row | null>(null);
  const [proxyNotice, setProxyNotice] = useState<Notice | null>(null);
  const [reloadingProxy, setReloadingProxy] = useState(false);

  // refresh() runs off a setInterval closure, so it reads `editing` through a
  // ref rather than the state value -- otherwise it would always see the
  // value from the render that started the interval.
  const editingRef = useRef<EditingState | null>(null);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  // An explicit-click notice (via notice()) outranks the automatic banner
  // until this deadline. Not exposed: only refresh()'s autoBanner check reads it.
  const proxyHoldUntil = useRef(0);

  const notice = useCallback((kind: Notice["kind"], message: string, holdMs = 0, command?: string) => {
    setProxyNotice({ kind, message, command });
    if (holdMs) proxyHoldUntil.current = Date.now() + holdMs;
  }, []);

  const refresh = useCallback(async () => {
    if (editingRef.current) return; // don't fight an in-flight port edit
    try {
      const next = await getStatus();
      setRestarting((prev) => reconcileRestarting(prev, next, Date.now()));
      setData(next);
      // A stale proxy serves old ports on .localhost while every health probe
      // (which hits ports directly) still reads green, so say so loudly.
      if (next.canManage && Date.now() > proxyHoldUntil.current) {
        setProxyNotice(autoBanner(next, Date.now()));
      }
    } catch {
      /* transient -- keep the last good render */
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const isRestarting = useCallback(
    (row: Row) => !!(row.service && restarting[row.service.label]),
    [restarting],
  );

  // Restarting the board's own service kills this API mid-response: the fetch
  // rejects, we swallow it, and the poll loop picks up the fresh pid when the
  // platform is back.
  const onRestart = useCallback((row: Row) => {
    if (!row.service) return;
    const label = row.service.label;
    const pid = row.service.pid;
    setRestarting((prev) => ({ ...prev, [label]: { pid, at: Date.now() } }));
    apiPost(`/api/v1/apps/${row.name}/restart`).catch(() => {});
  }, []);

  // Swallow the rejection: a self-restarting deploy kills the API mid-POST,
  // exactly like onRestart; the 5s poll re-syncs once it returns.
  const onRunCommand = useCallback((row: Row, name: string) => {
    apiPost(`/api/v1/apps/${row.name}/commands/${name}`).catch(() => {});
  }, []);

  // ---- dev-mode source linking ----
  // Unlike onRunCommand/onRestart, a link attempt reports its own error
  // inline next to the input rather than through the transient proxyNotice --
  // the server is the sole validator, so a typo'd path must resurface as text
  // the caller can read and correct, not a toast that has already vanished.
  const linkSource = useCallback(
    async (row: Row, workingDirectory: string): Promise<string | null> => {
      let res: Response | null = null;
      try {
        res = await apiPatch(`/api/v1/apps/${row.name}`, { dev: { workingDirectory } });
      } catch {
        res = null;
      }
      if (!res || !res.ok) {
        const body = res ? await res.json().catch(() => ({}) as { message?: string; error?: string }) : {};
        return (body as { message?: string }).message || (body as { error?: string }).error || "linking failed, the board did not answer.";
      }
      await refresh();
      return null;
    },
    [refresh],
  );

  const unlinkSource = useCallback(
    async (row: Row): Promise<void> => {
      try {
        await apiPatch(`/api/v1/apps/${row.name}`, { dev: null });
      } catch {
        /* transient -- the next refresh shows the true state */
      }
      await refresh();
    },
    [refresh],
  );

  const onPublish = useCallback(
    async (row: Row) => {
      try {
        await apiPut(`/api/v1/apps/${row.name}/publish`, { published: !row.published });
      } catch {
        /* transient -- the next refresh shows the true state */
      }
      await refresh();
    },
    [refresh],
  );

  const postPort = useCallback(
    (app: string, port: string) => {
      const devPort = port === "" ? null : Number(port); // null clears the override
      apiPut(`/api/v1/apps/${app}/override`, { devPort })
        .catch(() => {})
        .then(() => refresh());
    },
    [refresh],
  );

  // The board's own row is never port-editable: overriding it would repoint
  // the dashboard itself.
  const startEdit = useCallback(
    (row: Row) => {
      if (!data || !data.canManage || row.self || row.port == null) return;
      setEditing({ app: row.name, value: "" });
    },
    [data],
  );

  const setEditValue = useCallback((v: string) => {
    setEditing((prev) => (prev ? { ...prev, value: v } : prev));
  }, []);

  const submitPort = useCallback(() => {
    setEditing((prev) => {
      if (!prev) return prev;
      const v = prev.value.trim();
      if (v !== "") postPort(prev.app, v); // enter on empty input = cancel
      return null;
    });
  }, [postPort]);

  const cancelEdit = useCallback(() => setEditing(null), []);

  const clearPort = useCallback((row: Row) => postPort(row.name, ""), [postPort]);

  const onPublicFollows = useCallback(
    async (row: Row) => {
      const follows = !row.publicFollowsOverride;
      try {
        const res = await apiPut(`/api/v1/apps/${row.name}/public-follows-override`, { follows });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}) as { error?: string });
          notice("bad", body.error || "the board rejected that change.", 10000);
        }
      } catch {
        /* transient -- the next refresh shows the true state */
      }
      // Refresh regardless: the response carries no preflight, and turning this
      // on is what triggers the probe that reports whether it actually works.
      await refresh();
    },
    [refresh, notice],
  );

  // ---- remote (Railway push) ----
  const onSetRemote = useCallback(
    async (row: Row, enabled: boolean) => {
      try {
        const res = await postSetRemote(row.name, enabled);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}) as { error?: string; message?: string });
          notice("bad", body.message || body.error || "the board rejected that change.", 10000);
        }
      } catch {
        /* transient -- the next refresh shows the true state */
      }
      await refresh();
    },
    [refresh, notice],
  );

  // Fire-and-forget, same as onRunCommand: the deploy that follows can
  // restart the app itself, so a rejected fetch here is expected, not an
  // error -- the poll loop picks the new remote.status up on its own.
  const onPushRemote = useCallback((row: Row) => {
    postPushRemote(row.name).catch(() => {});
  }, []);

  // ---- add ----
  const openAdd = useCallback(() => {
    setAddModal({ name: "", external: false, command: "", workingDirectory: "", staticPort: "", error: null });
  }, []);
  const closeAdd = useCallback(() => setAddModal(null), []);
  const updateAddModal = useCallback((patch: Partial<AddModalState>) => {
    setAddModal((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);
  const submitAdd = useCallback(async () => {
    if (!addModal) return;
    const payload = addPayload(addModal);
    try {
      const res = await apiPost("/api/v1/apps", payload);
      const body = await res.json().catch(() => ({}) as { message?: string; error?: string });
      if (!res.ok) {
        updateAddModal({ error: body.message || body.error || `failed (${res.status})` });
        return;
      }
      setAddModal(null);
    } catch (err) {
      updateAddModal({ error: String(err) });
      return;
    }
    await refresh();
  }, [addModal, refresh, updateAddModal]);

  // ---- edit ----
  // Only user records are structurally editable from the board; the API
  // enforces this (authorizeStructural 409s managed rows), and the drawer
  // only offers "edit app" on user rows since the source screen took over
  // the managed story.
  const openEdit = useCallback((row: Row) => {
    setEditModal({
      original: row.name,
      name: row.name,
      port: row.override ? String(row.override.basePort) : String(row.port ?? ""),
      kind: row.record ? row.record.kind : "external",
      command: row.record && row.record.command ? row.record.command.join(" ") : "",
      workingDirectory: row.record ? row.record.workingDirectory || "" : "",
      error: null,
    });
  }, []);
  const closeEdit = useCallback(() => setEditModal(null), []);
  const updateEditModal = useCallback((patch: Partial<EditModalState>) => {
    setEditModal((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);
  const submitEdit = useCallback(async () => {
    if (!editModal) return false;
    const patch = editPatch(editModal);
    let res: Response | null = null;
    try {
      res = await apiPatch(`/api/v1/apps/${editModal.original}`, patch);
    } catch {
      res = null;
    }
    const body = res ? await res.json().catch(() => ({}) as { message?: string; error?: string }) : {};
    if (!res || !res.ok) {
      updateEditModal({ error: (body as { message?: string; error?: string }).message || (body as { error?: string }).error || "edit failed" });
      return false;
    }
    setEditModal(null);
    await refresh();
    return true;
  }, [editModal, refresh, updateEditModal]);

  // ---- remove ----
  const onRemove = useCallback((row: Row) => setPendingRemove(row), []);
  const cancelRemove = useCallback(() => setPendingRemove(null), []);
  const confirmRemove = useCallback(async () => {
    if (!pendingRemove) return;
    const row = pendingRemove;
    setPendingRemove(null);
    let res: Response | null = null;
    try {
      res = await apiDelete(`/api/v1/apps/${row.name}`);
    } catch {
      res = null;
    }
    if (res && !res.ok) {
      const body = await res.json().catch(() => ({}) as { message?: string; error?: string });
      // Surface the API's message VERBATIM - for managed rows it carries the
      // escape hatch ("Managed by mattstack - `rt uninstall <app>`").
      notice("bad", body.message || body.error || `remove failed (${res.status})`, 15000);
    }
    await refresh();
  }, [pendingRemove, refresh, notice]);

  // ---- access ----
  const openAccess = useCallback((row: Row) => {
    const o = row.oauth || { mode: "off" as const };
    setAccessModal({
      app: row.name,
      password: "",
      pwError: null,
      pwBusy: false,
      oauthOn: o.mode !== "off",
      mode: o.mode === "domains" ? "domains" : "emails",
      entries: o.mode === "emails" ? o.emails : o.mode === "domains" ? o.domains : [],
      entryDraft: "",
      oauthError: null,
      oauthBusy: false,
    });
  }, []);
  const closeAccess = useCallback(() => setAccessModal(null), []);
  const updateAccessModal = useCallback((patch: Partial<AccessModalState>) => {
    setAccessModal((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const addAccessEntry = useCallback((value: string) => {
    setAccessModal((prev) => {
      if (!prev) return prev;
      const trimmed = value.trim();
      if (!trimmed || prev.entries.includes(trimmed)) return { ...prev, entryDraft: "" };
      return { ...prev, entries: [...prev.entries, trimmed], entryDraft: "" };
    });
  }, []);
  const removeAccessEntry = useCallback((index: number) => {
    setAccessModal((prev) => (prev ? { ...prev, entries: prev.entries.filter((_, i) => i !== index) } : prev));
  }, []);

  // No confirm: unlike removing the app itself, a removed password is
  // recoverable by setting a new one, so this fires straight from the row.
  const removePassword = useCallback(async () => {
    if (!accessModal) return false;
    updateAccessModal({ pwBusy: true, pwError: null });
    let res: Response | null = null;
    try {
      res = await apiPut(`/api/v1/apps/${accessModal.app}/password`, { password: null });
    } catch {
      res = null;
    }
    if (!res || !res.ok) {
      updateAccessModal({ pwBusy: false, pwError: "removing the password failed." });
      return false;
    }
    updateAccessModal({ pwBusy: false, password: "" });
    await refresh();
    return true;
  }, [accessModal, refresh, updateAccessModal]);

  const savePassword = useCallback(async () => {
    if (!accessModal || !accessModal.password) return false;
    updateAccessModal({ pwBusy: true, pwError: null });
    let res: Response | null = null;
    try {
      res = await apiPut(`/api/v1/apps/${accessModal.app}/password`, { password: accessModal.password });
    } catch {
      res = null;
    }
    if (!res || !res.ok) {
      updateAccessModal({ pwBusy: false, pwError: "saving the password failed, the board did not answer." });
      return false;
    }
    updateAccessModal({ pwBusy: false, password: "" });
    await refresh();
    return true;
  }, [accessModal, refresh, updateAccessModal]);

  const onOauthSwitch = useCallback(async () => {
    if (!accessModal) return;
    if (!accessModal.oauthOn) {
      updateAccessModal({ oauthOn: true, oauthError: null });
      return;
    }
    updateAccessModal({ oauthBusy: true, oauthError: null });
    let res: Response | null = null;
    try {
      res = await apiPut(`/api/v1/apps/${accessModal.app}/access`, { mode: "off" });
    } catch {
      res = null;
    }
    const b = res ? await res.json().catch(() => ({}) as { message?: string; error?: string; cfSynced?: boolean }) : {};
    if (!res || !res.ok) {
      updateAccessModal({
        oauthBusy: false,
        oauthError: (b as { message?: string }).message || (b as { error?: string }).error || "turning sign-in off failed.",
      });
      return;
    }
    // Turning sign-in off always takes effect locally, so this is a 200 even
    // when the Cloudflare teardown was skipped or failed. cfSynced carries
    // that verdict, and a stale Access app keeps challenging visitors, so
    // say so rather than render an "off" the edge does not agree with.
    updateAccessModal({
      oauthBusy: false,
      oauthOn: false,
      entries: [],
      oauthError:
        (b as { cfSynced?: boolean }).cfSynced === false
          ? "sign-in is off here, but Cloudflare was not updated, so visitors may still be asked to sign in."
          : null,
    });
    await refresh();
  }, [accessModal, refresh, updateAccessModal]);

  // The mode picks what the entries below it MEAN, so entries picked for the
  // other mode are never valid for the new one: clear them rather than leave
  // "a@x.dev" sitting under "anyone at these domains" with save live.
  const onOauthMode = useCallback(() => {
    updateAccessModal({ entries: [], entryDraft: "", oauthError: null });
  }, [updateAccessModal]);

  const applyOauth = useCallback(async () => {
    if (!accessModal) return false;
    const items = accessModal.entries;
    if (!items.length) return false;
    const payload =
      accessModal.mode === "emails" ? { mode: "emails", emails: items } : { mode: "domains", domains: items };
    updateAccessModal({ oauthBusy: true, oauthError: null });
    let res: Response | null = null;
    try {
      res = await apiPut(`/api/v1/apps/${accessModal.app}/access`, payload);
    } catch {
      res = null;
    }
    if (!res || !res.ok) {
      const b = res ? await res.json().catch(() => ({}) as { message?: string; error?: string }) : {};
      updateAccessModal({
        oauthBusy: false,
        oauthError: (b as { message?: string }).message || (b as { error?: string }).error || "Cloudflare sync failed.",
      });
      return false;
    }
    updateAccessModal({ oauthBusy: false });
    await refresh();
    return true;
  }, [accessModal, refresh, updateAccessModal]);

  // ---- portless proxy reload ----
  const onProxyReload = useCallback(async () => {
    setReloadingProxy(true);
    setProxyNotice(null);
    try {
      const res = await apiPost("/api/v1/proxy/restart");
      const body = await res.json().catch(() => ({}) as { ok?: boolean; error?: string; installCommand?: string; detail?: string });
      if (body.ok) {
        // The proxy is going down and, if this page is served through it, so
        // is our connection. Wait for it to answer again rather than assume.
        const back = await waitForProxy(PROXY_WAIT_MS);
        notice(
          back ? "ok" : "bad",
          back
            ? "portless proxy restarted — .localhost now serves the current routes."
            : "the proxy did not come back within 45s. Check: launchctl print system/sh.portless.proxy",
          30000,
        );
      } else if (body.error === "not-authorized") {
        notice(
          "bad",
          "One-time setup: the board isn't allowed to restart the proxy yet. " +
            "Run this in a terminal (it validates the rule before activating it), then try again:",
          60000,
          body.installCommand || "",
        );
      } else {
        notice("bad", `restart failed: ${body.detail || res.status}`, 30000);
      }
    } catch (err) {
      notice("bad", `restart failed: ${String(err)}`);
    }
    setReloadingProxy(false);
    await refresh();
  }, [refresh, notice]);

  return {
    data,
    sections: sectionsOf(data),
    tunnels: tunnelsOf(data),
    subline: sublineOf(data),
    restarting,
    isRestarting,
    refresh,
    onRestart,
    onRunCommand,
    linkSource,
    unlinkSource,
    onPublish,
    editing,
    startEdit,
    setEditValue,
    submitPort,
    cancelEdit,
    clearPort,
    onPublicFollows,
    onSetRemote,
    onPushRemote,
    addModal,
    openAdd,
    closeAdd,
    updateAddModal,
    submitAdd,
    editModal,
    openEdit,
    closeEdit,
    updateEditModal,
    submitEdit,
    pendingRemove,
    onRemove,
    cancelRemove,
    confirmRemove,
    accessModal,
    openAccess,
    closeAccess,
    updateAccessModal,
    addAccessEntry,
    removeAccessEntry,
    removePassword,
    savePassword,
    onOauthSwitch,
    onOauthMode,
    applyOauth,
    proxyNotice,
    reloadingProxy,
    onProxyReload,
  };
}

export type BoardState = ReturnType<typeof useBoardState>;

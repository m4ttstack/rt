// Alpine component for the local-apps board. board.html renders it
// declaratively (x-for rows, x-show banners), so every dynamic string passes
// through x-text and is escaped by Alpine -- there is deliberately no HTML
// building and no direct markup injection in this file.
const REFRESH_MS = 5000;
const RESTART_TIMEOUT_MS = 30000;
const HEAL_RECENT_MS = 120000;

document.addEventListener("alpine:init", () => {
  Alpine.data("board", () => ({
    data: null, // last good /api/v1/status body; null until the first answer
    restarting: {}, // label -> { pid, at }: awaiting a fresh pid
    editing: null, // { app, value } | null: the port cell being edited
    pwModal: null, // { app, value } | null: the password dialog
    addModal: null, // { name, external, command, workingDirectory, staticPort, error } | null
    editModal: null, // { original, name, port, kind, command, workingDirectory, error } | null
    proxyNotice: null, // { kind: "ok"|"bad", message, command? } | null
    proxyHoldUntil: 0, // explicit-click notices outrank the automatic banner until this time
    reloadingProxy: false,

    init() {
      this.refresh();
      setInterval(() => this.refresh(), REFRESH_MS);
    },

    async apiPut(path, payload) {
      return fetch(path, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    },

    // ---- derived ----
    get apps() {
      return this.data ? this.data.apps : [];
    },
    get tunnels() {
      return this.data ? this.data.orphans.filter((r) => r.isTunnel) : [];
    },
    get strays() {
      return this.data ? this.data.orphans.filter((r) => !r.isTunnel) : [];
    },
    // The apps table and the strays table share one row template in board.html.
    get sections() {
      const out = [{ key: "apps", title: null, rows: this.apps }];
      if (this.strays.length)
        out.push({ key: "strays", title: "services without routes", rows: this.strays });
      return out;
    },
    get subline() {
      if (!this.data) return "loading…";
      const d = this.data;
      const pub = d.apps.filter((r) => r.published).length;
      const prot = d.apps.filter((r) => r.hasPassword).length;
      const parts = [`${d.up}/${d.total} healthy`, `${pub} public`];
      if (prot) parts.push(`${prot} protected`);
      if (d.nextPort) parts.push(`next port ${d.nextPort}`);
      parts.push("auto-refreshes");
      return parts.join(" · ");
    },
    tunnelDomain() {
      if (!this.data) return "";
      return this.data.suffix === "localhost" ? "" : this.data.suffix;
    },
    isRestarting(row) {
      return !!(row.service && this.restarting[row.service.label]);
    },

    // ---- polling ----
    async refresh() {
      if (this.editing) return; // don't fight an in-flight port edit
      try {
        const data = await (await fetch("/api/v1/status")).json();
        this.reconcile(data);
        this.data = data;
        // A stale proxy serves old ports on .localhost while every health probe
        // (which hits ports directly) still reads green, so say so loudly.
        if (data.canManage && Date.now() > this.proxyHoldUntil) this.autoBanner(data);
      } catch {
        /* transient -- keep the last good render */
      }
    },

    // Clear a restarting flag once the service is back with a NEW pid and
    // healthy, or when it has clearly got stuck: a spinner that never resolves
    // is worse than no spinner.
    reconcile(data) {
      const rows = [...data.apps, ...data.orphans];
      for (const [label, st] of Object.entries(this.restarting)) {
        const row = rows.find((r) => r.service && r.service.label === label) || null;
        const pid = row && row.service ? row.service.pid : null;
        const healthy = row ? (row.health ? row.health.ok : pid !== null) : false;
        const restarted = pid !== null && pid !== st.pid && healthy;
        if (restarted || Date.now() - st.at > RESTART_TIMEOUT_MS) delete this.restarting[label];
      }
    },

    // ---- actions ----
    // Restarting the board's own service kills this API mid-response (ruled,
    // accepted quirk): the fetch rejects, we swallow it, and the poll loop
    // picks the fresh pid up when the platform is back.
    onRestart(row) {
      const label = row.service.label;
      this.restarting[label] = { pid: row.service.pid, at: Date.now() };
      fetch("/api/v1/apps/" + row.name + "/restart", { method: "POST" }).catch(() => {});
    },

    async onPublish(row) {
      try {
        await this.apiPut("/api/v1/apps/" + row.name + "/publish", { published: !row.published });
      } catch {
        /* transient -- the next refresh shows the true state */
      }
      await this.refresh();
    },

    startEdit(row) {
      // The board's own row is never port-editable: overriding it would repoint
      // the dashboard itself.
      if (!this.data || !this.data.canManage || row.self || row.port == null) return;
      this.editing = { app: row.name, value: "" };
    },
    submitPort() {
      if (!this.editing) return;
      const { app, value } = this.editing;
      this.editing = null;
      const v = value.trim();
      if (v === "") return; // enter on empty input = cancel
      this.postPort(app, v);
    },
    cancelEdit() {
      this.editing = null;
    },
    clearPort(row) {
      this.postPort(row.name, "");
    },
    postPort(app, port) {
      const devPort = port === "" ? null : Number(port); // null clears the override
      this.apiPut("/api/v1/apps/" + app + "/override", { devPort })
        .catch(() => {})
        .then(() => this.refresh());
    },
    async onPublicFollows(row) {
      const follows = !row.publicFollowsOverride;
      try {
        const res = await this.apiPut("/api/v1/apps/" + row.name + "/public-follows-override", { follows });
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({}));
          this.notice("bad", error || "the board rejected that change.", 10000);
        }
      } catch {
        /* transient -- the next refresh shows the true state */
      }
      // Refresh regardless: the response carries no preflight, and turning this
      // on is what triggers the probe that reports whether it actually works.
      await this.refresh();
    },

    openPassword(app) {
      this.pwModal = { app, value: "" };
    },
    async savePassword() {
      if (!this.pwModal || !this.pwModal.value) return;
      const { app, value } = this.pwModal;
      try {
        await this.apiPut("/api/v1/apps/" + app + "/password", { password: value });
        this.pwModal = null;
      } catch {
        this.notice("bad", "saving the password failed -- the board did not answer.", 30000);
      }
      await this.refresh();
    },
    clearPassword(app) {
      this.apiPut("/api/v1/apps/" + app + "/password", { password: null })
        .catch(() => {})
        .then(() => this.refresh());
    },

    async submitAdd() {
      const m = this.addModal;
      if (!m) return;
      const payload = m.external
        ? { name: m.name.trim(), staticPort: Number(m.staticPort) }
        : {
            name: m.name.trim(),
            // Whitespace split is the honest 90% case; commands needing shell
            // quoting belong in a wrapper script, same rule the skill used.
            command: m.command.trim().split(/\s+/),
            workingDirectory: m.workingDirectory.trim(),
          };
      try {
        const res = await fetch("/api/v1/apps", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          m.error = body.message || body.error || ("failed (" + res.status + ")");
          return;
        }
        this.addModal = null;
      } catch (err) {
        m.error = String(err);
        return;
      }
      await this.refresh();
    },

    openEdit(row) {
      // Only user records are structurally editable from the board; the API
      // enforces this too - the UI just avoids offering a dead end.
      this.editModal = {
        original: row.name,
        name: row.name,
        port: row.override ? String(row.override.basePort) : String(row.port ?? ""),
        kind: row.record ? row.record.kind : "external",
        command: row.record && row.record.command ? row.record.command.join(" ") : "",
        workingDirectory: row.record ? (row.record.workingDirectory || "") : "",
        error: null,
      };
    },
    async submitEdit() {
      const m = this.editModal;
      if (!m) return;
      const patch = { name: m.name.trim(), port: Number(m.port) };
      if (m.kind === "service") {
        patch.command = m.command.trim().split(/\s+/);
        patch.workingDirectory = m.workingDirectory.trim();
      }
      const res = await fetch("/api/v1/apps/" + m.original, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }).catch(() => null);
      const body = res ? await res.json().catch(() => ({})) : {};
      if (!res || !res.ok) {
        m.error = body.message || body.error || "edit failed";
        return;
      }
      this.editModal = null;
      await this.refresh();
    },
    async onRemove(row) {
      if (!confirm("Remove " + row.name + "? This deletes its service and route.")) return;
      const res = await fetch("/api/v1/apps/" + row.name, { method: "DELETE" }).catch(() => null);
      if (res && !res.ok) {
        const body = await res.json().catch(() => ({}));
        // Surface the API's message VERBATIM - for managed rows it carries the
        // escape hatch ("Managed by mattstack - `rt uninstall <app>`").
        this.notice("bad", body.message || body.error || ("remove failed (" + res.status + ")"), 15000);
      }
      await this.refresh();
    },

    // ---- portless proxy reload ----
    notice(kind, message, holdMs = 0, command) {
      this.proxyNotice = { kind, message, command };
      if (holdMs) this.proxyHoldUntil = Date.now() + holdMs;
    },

    // The automatic banner: an auto-restart in progress, one that just
    // happened, or a stale proxy nothing is fixing.
    autoBanner(data) {
      const heal = data.autoHeal;
      const recent = heal && Date.now() - heal.at < HEAL_RECENT_MS;
      const at = heal ? new Date(heal.at).toLocaleTimeString() : "";
      if (recent && heal.ok === null) {
        this.notice("bad", `.localhost routes were stale. Restarting the proxy automatically (${at})…`);
      } else if (data.proxyStale) {
        this.notice(
          "bad",
          ".localhost routes are stale. The proxy stopped following routes.json, " +
            "so overrides and renumbered apps are not reaching it. " +
            "Click reload proxy to resync.",
        );
      } else if (recent && heal.ok) {
        this.notice("ok", `Routes were stale; the proxy was restarted automatically at ${at}.`);
      } else {
        this.proxyNotice = null;
      }
    },

    // Poll until the board answers again. Served through the proxy, that only
    // happens once the proxy is back; served on localhost directly, it never
    // drops, so stop waiting once the restart has had time to complete.
    async waitForProxy(timeoutMs = 45000) {
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
    },

    async onProxyReload() {
      this.reloadingProxy = true;
      this.proxyNotice = null;
      try {
        const res = await fetch("/api/v1/proxy/restart", { method: "POST" });
        const body = await res.json().catch(() => ({}));
        if (body.ok) {
          // The proxy is going down and, if this page is served through it, so
          // is our connection. Wait for it to answer again rather than assume.
          const back = await this.waitForProxy();
          this.notice(
            back ? "ok" : "bad",
            back
              ? "portless proxy restarted — .localhost now serves the current routes."
              : "the proxy did not come back within 45s. Check: launchctl print system/sh.portless.proxy",
            30000,
          );
        } else if (body.error === "not-authorized") {
          this.notice(
            "bad",
            "One-time setup: the board isn't allowed to restart the proxy yet. " +
              "Run this in a terminal (it validates the rule before activating it), then try again:",
            60000,
            body.installCommand || "",
          );
        } else {
          this.notice("bad", `restart failed: ${body.detail || res.status}`, 30000);
        }
      } catch (err) {
        this.notice("bad", `restart failed: ${String(err)}`);
      }
      this.reloadingProxy = false;
      await this.refresh();
    },
  }));
});

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { extractTicketId, ticketUrl } from "./ticket.ts";
import type { BoardMR } from "./data.ts";

interface BoardData {
  title: string;
  fetchedAt: number;
  fetchError: string | null;
  groups: { projectPath: string; mrs: BoardMR[] }[];
}

declare global {
  interface Window {
    __applyTheme: () => void;
  }
}

// ── toggles ────────────────────────────────────────────────────────────────

type ThemeMode = "light" | "dark" | "system";
type ViewMode = "rows" | "grid";
const THEME_KEY = "mrs-theme";
const VIEW_KEY = "mrs-view";

function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <span className="tui-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o} className={o === value ? "active" : ""} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </span>
  );
}

// ── formatting helpers ─────────────────────────────────────────────────────

function ago(iso: string | null, now: number): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function statusReasons(mr: BoardMR): string {
  const b = mr.blockers;
  if (!b?.any) return "ready to merge";
  const reasons: string[] = [];
  if (b.isDraft) reasons.push("marked as draft");
  if (b.hasConflicts) reasons.push("merge conflicts with target branch");
  if (b.needsRebase) reasons.push("source branch needs a rebase");
  if (b.pipelineFailing) reasons.push("pipeline is failing");
  if (b.pipelineRunning) reasons.push("pipeline still running");
  if (b.awaitingApprovals)
    reasons.push(`awaiting approvals (${mr.reviews.given}/${mr.reviews.required})`);
  if (b.hasUnresolvedDiscussions) reasons.push(`unresolved discussions (${mr.unresolvedThreads})`);
  if (b.hasMergeError) reasons.push(`merge error: ${b.mergeError ?? "unknown"}`);
  return reasons.length ? `blocked:\n${reasons.map((r) => `· ${r}`).join("\n")}` : "blocked";
}

function activeReviewers(mr: BoardMR): string[] {
  return (mr.reviews?.reviewers ?? [])
    .filter((r) => (r.displayState ?? (r.reviewState === "REVIEW_STARTED" ? "reviewing" : null)) === "reviewing")
    .map((r) => r.name || r.username);
}

function openMR(e: React.MouseEvent, mr: BoardMR) {
  if ((e.target as HTMLElement).closest("a, button")) return;
  if (mr.webUrl) window.open(mr.webUrl, "_blank", "noopener");
}

// ── pieces ─────────────────────────────────────────────────────────────────

function StatusDot({ mr }: { mr: BoardMR }) {
  const cls = !mr.blockers?.any ? "ok" : mr.blockers.hasConflicts || mr.blockers.pipelineFailing ? "bad" : "warn";
  return (
    <span className="tui-dot-wrap" data-tip={statusReasons(mr)}>
      <span className={`tui-dot ${cls}`}>●</span>
    </span>
  );
}

function Tokens({ mr, now }: { mr: BoardMR; now: number }) {
  const p = mr.pipeline;
  const behind = mr.rebaseButton?.behindBy ?? 0;
  return (
    <span className="tui-tokens">
      {p && (
        <span className={p.status === "failed" || p.failing > 0 ? "t-bad" : p.status === "running" || p.running > 0 ? "t-warn" : "t-ok"}>
          ci {p.status === "failed" || p.failing > 0 ? "✗" : p.status === "running" || p.running > 0 ? "…" : "✓"}
        </span>
      )}
      {mr.reviews.required > 0 && (
        <span className={mr.reviews.isApproved ? "t-ok" : "t-warn"}>
          {mr.reviews.given}/{mr.reviews.required}
        </span>
      )}
      {mr.unresolvedThreads > 0 && <span className="t-cyan">🗨 {mr.unresolvedThreads}</span>}
      {behind > 0 && <span className="t-warn">↓{behind}</span>}
      {mr.diff && (
        <span className="t-diff">
          <span className="t-ok">+{mr.diff.additions}</span> <span className="t-bad">−{mr.diff.deletions}</span>
        </span>
      )}
      <span className="t-muted">{ago(mr.updatedAt, now)}</span>
    </span>
  );
}

function TicketLink({ ticket }: { ticket: string }) {
  return (
    <a
      className="tui-ticket"
      href={ticketUrl(ticket)}
      target="_blank"
      rel="noopener noreferrer"
      title={`open ${ticket} in Linear`}
      aria-label={`open ${ticket} in Linear`}
      onClick={(e) => e.stopPropagation()}
    >
      <svg viewBox="0 0 100 100" width="13" height="13" fill="currentColor" aria-hidden>
        <path d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857L39.3342 97.1783c.6889.6889.0915 1.8189-.857 1.5964C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228ZM.00189135 46.8891c-.01764375.2833.08887215.5599.28957165.7606L52.3503 99.7085c.2007.2007.4773.3072.7606.2896 2.3692-.1476 4.6938-.46 6.9624-.9259.7645-.157 1.0301-1.0963.4782-1.6481L2.57595 39.4485c-.55186-.5519-1.49117-.2863-1.648174.4782-.465915 2.2686-.77832 4.5932-.92588465 6.9624ZM4.21093 29.7054c-.16649.3738-.08169.8106.20765 1.1l64.77602 64.776c.2894.2894.7262.3742 1.1.2077 1.7861-.7956 3.5171-1.6927 5.1855-2.684.5521-.328.6373-1.0867.1832-1.5407L8.43566 24.3367c-.45409-.4541-1.21271-.3689-1.54074.1832-.99128 1.6684-1.88843 3.3994-2.68399 5.1855ZM12.6587 18.074c-.3701-.3701-.393-.9637-.0443-1.3541C21.7795 6.45931 35.1114 0 49.9519 0 77.5927 0 100 22.4073 100 50.0481c0 14.8405-6.4593 28.1724-16.7199 37.3375-.3904.3487-.984.3258-1.3541-.0443L12.6587 18.074Z" />
      </svg>
    </a>
  );
}

function Watching({ mr }: { mr: BoardMR }) {
  const names = activeReviewers(mr);
  if (!names.length) return null;
  return (
    <div className="tui-watching">
      👀 {names.join(", ")} {names.length === 1 ? "is" : "are"} reviewing right now
    </div>
  );
}

function Panel({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="tui-panel">
      <span className="tui-panel-title">
        {title} <span className="tui-panel-count">{count}</span>
      </span>
      {children}
    </section>
  );
}

// ── views ──────────────────────────────────────────────────────────────────

function RowView({ mrs, now }: { mrs: BoardMR[]; now: number }) {
  return (
    <div className="tui-rows">
      {mrs.map((mr) => {
        const ticket = extractTicketId(mr.sourceBranch, mr.title);
        return (
          <div key={mr.iid} className="tui-row" onClick={(e) => openMR(e, mr)}>
            <div className="tui-row-1">
              <StatusDot mr={mr} />
              <span className="tui-iid">!{mr.iid}</span>
              <span className="tui-title">{mr.title}</span>
              <Tokens mr={mr} now={now} />
              {ticket && <TicketLink ticket={ticket} />}
            </div>
            <div className="tui-row-2">
              {mr.sourceBranch} <span className="tui-arrow">→</span> {mr.targetBranch}
            </div>
            <Watching mr={mr} />
          </div>
        );
      })}
    </div>
  );
}

function GridView({ mrs, now }: { mrs: BoardMR[]; now: number }) {
  return (
    <div className="tui-grid">
      {mrs.map((mr) => {
        const ticket = extractTicketId(mr.sourceBranch, mr.title);
        const reasons = mr.blockers?.any ? statusReasons(mr).split("\n").slice(1) : [];
        return (
          <div key={mr.iid} className="tui-card" onClick={(e) => openMR(e, mr)}>
            <span className="tui-card-label">
              <StatusDot mr={mr} /> !{mr.iid}
              {ticket && <TicketLink ticket={ticket} />}
            </span>
            <div className="tui-card-title">{mr.title}</div>
            <div className="tui-row-2">
              {mr.sourceBranch} <span className="tui-arrow">→</span> {mr.targetBranch}
            </div>
            <div className="tui-card-tokens">
              <Tokens mr={mr} now={now} />
            </div>
            {reasons.length > 0 && (
              <ul className="tui-blockers">
                {reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
            <Watching mr={mr} />
          </div>
        );
      })}
    </div>
  );
}

// ── board ──────────────────────────────────────────────────────────────────

function Board() {
  const [data, setData] = useState<BoardData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [view, setView] = useState<ViewMode>(
    () => (localStorage.getItem(VIEW_KEY) as ViewMode) ?? "rows",
  );
  const [theme, setTheme] = useState<ThemeMode>(
    () => (localStorage.getItem(THEME_KEY) as ThemeMode) ?? "system",
  );
  const pickView = (v: ViewMode) => {
    localStorage.setItem(VIEW_KEY, v);
    setView(v);
  };
  const pickTheme = (m: ThemeMode) => {
    localStorage.setItem(THEME_KEY, m);
    window.__applyTheme();
    setTheme(m);
  };

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const load = () =>
      fetch("/data.json")
        .then((r) => r.json())
        .then((d) => {
          setData(d);
          setLoadError(false);
        })
        .catch(() => setLoadError(true));
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    load();
    timer = setInterval(() => {
      if (!document.hidden) load();
    }, 60_000);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!data) {
    return <p className="tui-loading">{loadError ? "✗ failed to load board data" : "fetching…"}</p>;
  }

  const total = data.groups.reduce((n, g) => n + g.mrs.length, 0);
  const staleMins = Math.round((Date.now() - data.fetchedAt) / 60_000);
  const now = Date.now();

  return (
    <div className={view === "grid" ? "tui tui-wide" : "tui"}>
      <header className="tui-header">
        <div>
          <h1>
            <span className="tui-prompt">❯</span> {data.title.toLowerCase()}
          </h1>
          <p className="tui-sub">
            {total} open · click a line to open the MR in gitlab
          </p>
        </div>
        <div className="tui-controls">
          <Segmented options={["rows", "grid"] as const} value={view} onChange={pickView} label="view" />
          <Segmented options={["light", "dark", "system"] as const} value={theme} onChange={pickTheme} label="theme" />
        </div>
      </header>

      {data.fetchError && (
        <div className="tui-banner">⚠ data from {staleMins}m ago — gitlab fetch failing</div>
      )}

      {total === 0 && !data.fetchError ? (
        <p className="tui-empty">nothing waiting on review ✓</p>
      ) : (
        data.groups.map((g) => (
          <Panel key={g.projectPath} title={g.projectPath} count={g.mrs.length}>
            {view === "rows" ? <RowView mrs={g.mrs} now={now} /> : <GridView mrs={g.mrs} now={now} />}
          </Panel>
        ))
      )}

      <footer className="tui-footer">
        updated {staleMins < 1 ? "just now" : `${staleMins}m ago`} · {total} MR{total === 1 ? "" : "s"}
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Board />
  </StrictMode>,
);

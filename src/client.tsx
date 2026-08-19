import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { BoardMR } from "./data.ts";
import { filterByMember, sortMRs, groupMRs, parseViewState, serializeViewState, dataAgeLabel } from "./view.ts";
import type { ViewState } from "./view.ts";
import { selectionOf, postableOf } from "./selection.ts";
import type {
  ReviewInfo,
  RespondInfo,
  DoctorInfo,
  DraftInfo,
  BoardMRWithReview,
  BoardData,
  ThemeMode,
  ViewMode,
  Toast,
  RowMenuState,
} from "./client/types.ts";
import { setSlackMarks, getSlackMarks, mrLine, boardSummary, draftKey, RESPOND_ACTIVE, DOCTOR_ACTIVE } from "./client/board/format.ts";
import { ICONS } from "./client/ui/Icon.tsx";
import { Panel } from "./client/ui/Panel.tsx";
import { ToastHost } from "./client/ui/Toast.tsx";
import { Sidebar } from "./client/board/Sidebar.tsx";
import { Controls } from "./client/board/Controls.tsx";
import { SelectionBar } from "./client/board/SelectionBar.tsx";
import { RowView } from "./client/board/RowView.tsx";
import { GridView } from "./client/board/GridView.tsx";
import { SettingsModal } from "./client/board/SettingsModal.tsx";
import { RowMenu } from "./client/board/RowMenu.tsx";
import { ReviewModal } from "./client/board/ReviewModal.tsx";
import { DraftModal } from "./client/board/DraftModal.tsx";

declare global {
  interface Window {
    __applyTheme: () => void;
  }
}

// ── toggles ────────────────────────────────────────────────────────────────

const THEME_KEY = "mrs-theme";
const VIEW_KEY = "mrs-view";
const STATE_KEY = "mrs-view-state";

// ── board ──────────────────────────────────────────────────────────────────

function Board() {
  const [data, setData] = useState<BoardData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [view, setView] = useState<ViewMode>(() => (localStorage.getItem(VIEW_KEY) as ViewMode) ?? "rows");
  const [theme, setTheme] = useState<ThemeMode>(() => (localStorage.getItem(THEME_KEY) as ThemeMode) ?? "system");

  // View state (member/group/sort). Members are validated once data arrives.
  const [state, setState] = useState<ViewState>(() => {
    let stored: Partial<ViewState> | null = null;
    try {
      stored = JSON.parse(localStorage.getItem(STATE_KEY) ?? "null");
    } catch {
      stored = null;
    }
    return parseViewState(location.search, stored, []);
  });
  const validatedOnce = useRef(false);

  const pickView = (v: ViewMode) => {
    localStorage.setItem(VIEW_KEY, v);
    setView(v);
  };
  const pickTheme = (m: ThemeMode) => {
    localStorage.setItem(THEME_KEY, m);
    window.__applyTheme();
    setTheme(m);
  };
  const update = (patch: Partial<ViewState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(STATE_KEY, JSON.stringify(next));
      history.replaceState(null, "", serializeViewState(next) || location.pathname);
      return next;
    });
  };

  const load = useCallback(
    (fresh = false) =>
      fetch(fresh ? "/data.json?fresh=1" : "/data.json")
        .then((r) => r.json())
        .then((d: BoardData) => {
          if (d.slackEmoji) setSlackMarks(d.slackEmoji);
          setData(d);
          setLoadError(false);
          const usernames = d.members.map((m) => m.username);
          if (!validatedOnce.current) {
            // First load: the real roster and configured default are now known, so
            // re-resolve from URL/localStorage/defaultMember against them.
            validatedOnce.current = true;
            let stored: Partial<ViewState> | null = null;
            try {
              stored = JSON.parse(localStorage.getItem(STATE_KEY) ?? "null");
            } catch {
              stored = null;
            }
            setState(parseViewState(location.search, stored, usernames, d.defaultMember));
          } else {
            // Subsequent refreshes: keep the user's current selection, only
            // dropping a member who's no longer on the (visible) roster.
            setState((prev) =>
              prev.member === "all" || usernames.includes(prev.member) ? prev : { ...prev, member: "all" },
            );
          }
        })
        .catch(() => setLoadError(true)),
    [],
  );

  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, 60_000);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // Server push: rt relay events land as SSE nudges; re-pull the board.
  // Polling stays as the fallback when the stream is down.
  useEffect(() => {
    const es = new EventSource("/events");
    es.onmessage = () => {
      if (!document.hidden) load();
    };
    return () => es.close();
  }, [load]);

  // Merge a scoped (single-member) refresh into the current board: replace that
  // member's rows and update their roster count, leaving everyone else untouched.
  const mergeMember = useCallback((username: string, mrs: BoardMRWithReview[], fetchedAt: number) => {
    setData((prev) => {
      if (!prev) return prev;
      const others = prev.mrs.filter((m) => m.author.username !== username);
      const members = prev.members.map((m) => (m.username === username ? { ...m, count: mrs.length } : m));
      return { ...prev, mrs: [...others, ...mrs], members, fetchedAt };
    });
  }, []);

  const fetchMember = useCallback(
    (username: string) =>
      fetch(`/member?u=${encodeURIComponent(username)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad status"))))
        .then((d: { mrs: BoardMRWithReview[]; fetchedAt: number }) => mergeMember(username, d.mrs, d.fetchedAt)),
    [mergeMember],
  );

  // When viewing one person, poll just their MRs every 15s — 1 query instead of
  // the whole team, so a reviewer's comment shows up fast and cheap. The "All"
  // view keeps the slower full poll above.
  useEffect(() => {
    if (state.member === "all") return;
    const member = state.member;
    const timer = setInterval(() => {
      if (!document.hidden) fetchMember(member).catch(() => {});
    }, 15_000);
    return () => clearInterval(timer);
  }, [state.member, fetchMember]);

  const [refreshing, setRefreshing] = useState(false);
  const refreshNow = useCallback(() => {
    setRefreshing(true);
    const task = state.member === "all" ? load(true) : fetchMember(state.member);
    task.catch(() => {}).finally(() => setRefreshing(false));
  }, [state.member, load, fetchMember]);

  // Selection for the multi-copy bar, keyed by webUrl so it survives the
  // refresh poll and every member/group/sort change. Deliberately not
  // persisted: a reload should not hand you yesterday's selection.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const toggleSelect = useCallback((webUrl: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(webUrl)) next.add(webUrl);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const [showSettings, setShowSettings] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Row action menu (right-click) and transient toasts.
  const [rowMenu, setRowMenu] = useState<RowMenuState | null>(null);
  // The MR whose saved review is open in the modal, if any.
  const [reviewModal, setReviewModal] = useState<BoardMRWithReview | null>(null);
  // The held draft open in its drawer, if any, and the drafts already acted on
  // this session (optimistic — the next /data.json pull drops resolved drafts).
  const [draftModal, setDraftModal] = useState<{ mr: BoardMRWithReview; draft: DraftInfo } | null>(null);
  const [draftResolved, setDraftResolved] = useState<ReadonlyMap<string, "posted" | "dismissed">>(new Map());
  const openDraft = useCallback((mr: BoardMRWithReview, draft: DraftInfo) => setDraftModal({ mr, draft }), []);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const addToast = useCallback((text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  // A drawer action succeeded: swap the chip to its resolved state, close the
  // drawer, and confirm with a toast (the board's transient-confirmation form).
  const handleDraftResolved = useCallback(
    (outcome: "posted" | "dismissed") => {
      if (!draftModal) return;
      const { mr, draft } = draftModal;
      setDraftResolved((prev) => new Map(prev).set(draftKey(mr.webUrl ?? "", draft.kind), outcome));
      setDraftModal(null);
      addToast(outcome === "posted" ? `held note posted to !${mr.iid}` : `held note dismissed on !${mr.iid}`);
    },
    [draftModal, addToast],
  );

  const applyHidden = useCallback((username: string, hidden: boolean) => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            // Predict what the reload will send, so nothing flickers when it lands:
            // a checked-out member's MRs aren't fetched, so they have no count.
            allMembers: prev.allMembers.map((m) =>
              m.username === username ? { ...m, hidden, count: hidden ? null : m.count } : m,
            ),
          }
        : prev,
    );
  }, []);

  // Check a member in/out. The box flips locally first and never waits on the
  // network: the POST is quick, but the reload behind it refetches the team from
  // GitLab (~25s, since a checked-in member's MRs aren't in the snapshot). The
  // board catches up when that lands; a failed POST flips the box back.
  const toggleMember = useCallback(
    (username: string, hidden: boolean) => {
      applyHidden(username, hidden);
      fetch("/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, hidden }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`settings failed: ${res.status}`);
          return load();
        })
        .catch(() => {
          applyHidden(username, !hidden);
          addToast(`could not check ${username} ${hidden ? "out" : "in"}`);
        });
    },
    [applyHidden, load, addToast],
  );

  // Optimistic review state: show a "queued" badge the instant a launch is
  // requested, before the server's state file round-trips back via /data.json.
  // Cleared per MR once the server reports any real review status for it.
  const [optimistic, setOptimistic] = useState<Record<string, ReviewInfo>>({});
  /** Same idea for responses -- show a queued state instantly on click. */
  const [optimisticRespond, setOptimisticRespond] = useState<Record<string, RespondInfo>>({});
  const [optimisticDoctor, setOptimisticDoctor] = useState<Record<string, DoctorInfo>>({});

  const openRowMenu = useCallback((e: React.MouseEvent, mr: BoardMR) => {
    e.preventDefault();
    setRowMenu({ x: e.clientX, y: e.clientY, mr });
  }, []);

  const handleLaunch = useCallback(
    (mr: BoardMR, note?: string) => {
      if (!mr.webUrl) return;
      const url = mr.webUrl;
      setOptimistic((o) => ({ ...o, [url]: { status: "queued" } }));
      addToast(`launching review for !${mr.iid}…`);
      fetch("/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mrUrl: url, iid: mr.iid, note }),
      })
        .then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok) {
            setOptimistic((o) => {
              const next = { ...o };
              delete next[url];
              return next;
            });
            addToast(`couldn't launch review for !${mr.iid} (${r.status})`);
            return;
          }
          if (body?.focused) addToast(`review already running for !${mr.iid} — focused its tab`);
          load();
        })
        .catch(() => {
          setOptimistic((o) => {
            const next = { ...o };
            delete next[url];
            return next;
          });
          addToast(`couldn't launch review for !${mr.iid}`);
        });
    },
    [addToast, load],
  );

  const handleReReview = useCallback(
    (mr: BoardMR, note?: string) => {
      if (!mr.webUrl) return;
      const url = mr.webUrl;
      setOptimistic((o) => ({ ...o, [url]: { status: "queued" } }));
      addToast(`re-reviewing !${mr.iid}…`);
      fetch("/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mrUrl: url, iid: mr.iid, reReview: true, note }),
      })
        .then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok) {
            setOptimistic((o) => {
              const next = { ...o };
              delete next[url];
              return next;
            });
            addToast(`couldn't re-review !${mr.iid} (${r.status})`);
            return;
          }
          if (body?.focused) addToast(`review already running for !${mr.iid} — focused its tab`);
          load();
        })
        .catch(() => {
          setOptimistic((o) => {
            const next = { ...o };
            delete next[url];
            return next;
          });
          addToast(`couldn't re-review !${mr.iid}`);
        });
    },
    [addToast, load],
  );

  // Ask a peer's board for a re-review of one of our MRs. No optimistic chip:
  // the server writes the sent-nudge file before answering, so the reload right
  // behind this brings back the real state one poll sooner than guessing would.
  const handleNudge = useCallback(
    (mr: BoardMR, reviewer: string) => {
      if (!mr.webUrl) return;
      addToast(`requesting re-review of !${mr.iid} from ${reviewer}…`);
      fetch("/nudge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mrUrl: mr.webUrl, iid: mr.iid, reviewer }),
      })
        .then(async (r) => {
          if (!r.ok) {
            // A permanent refusal (409) answers in plain text with the reason
            // the relay gave -- e.g. the reviewer has no board on the
            // switchboard. That's the whole point of the failure, so show it.
            const why = await r.text().then((t) => t.trim()).catch(() => "");
            addToast(why || `couldn't request re-review for !${mr.iid} (${r.status})`);
            return;
          }
          const body = await r.json().catch(() => ({}));
          if (body?.queued) addToast(`switchboard unreachable... queued the ask to ${reviewer}`);
          load();
        })
        .catch(() => {
          addToast(`couldn't request re-review for !${mr.iid}`);
        });
    },
    [addToast, load],
  );

  const handleRespond = useCallback(
    (mr: BoardMR, note?: string) => {
      if (!mr.webUrl) return;
      const url = mr.webUrl;
      setOptimisticRespond((o) => ({ ...o, [url]: { status: "queued" } }));
      addToast(`launching response for !${mr.iid}…`);
      fetch("/respond", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mrUrl: url, iid: mr.iid, note }),
      })
        .then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok) {
            setOptimisticRespond((o) => {
              const next = { ...o };
              delete next[url];
              return next;
            });
            addToast(`couldn't launch response for !${mr.iid} (${r.status})`);
            return;
          }
          if (body?.focused) addToast(`response already running for !${mr.iid} — focused its tab`);
          load();
        })
        .catch(() => {
          setOptimisticRespond((o) => {
            const next = { ...o };
            delete next[url];
            return next;
          });
          addToast(`couldn't launch response for !${mr.iid}`);
        });
    },
    [addToast, load],
  );

  const handleResume = useCallback(
    (mr: BoardMR, kind: "review" | "respond", note?: string) => {
      if (!mr.webUrl) return;
      addToast(`resuming ${kind} for !${mr.iid}…`);
      fetch(`/${kind}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mrUrl: mr.webUrl, iid: mr.iid, resume: true, note }),
      })
        .then(async (r) => {
          if (!r.ok) {
            const msg = await r.text().catch(() => "");
            addToast(`resume ${kind} failed for !${mr.iid} (${r.status})${msg ? `: ${msg}` : ""}`);
            return;
          }
          load();
        })
        .catch(() => addToast(`resume ${kind} failed for !${mr.iid}`));
    },
    [addToast, load],
  );
  const handleResumeReview = useCallback((mr: BoardMR, note?: string) => handleResume(mr, "review", note), [handleResume]);
  const handleResumeRespond = useCallback((mr: BoardMR, note?: string) => handleResume(mr, "respond", note), [handleResume]);

  // Flip one of your own MRs between draft and ready. No optimistic state: the
  // flip lives in GitLab, so the row waits for the reload rather than claiming a
  // change the API might have refused.
  const handleDraftState = useCallback(
    (mr: BoardMR, draft: boolean) => {
      if (!mr.webUrl) return;
      const verb = draft ? "draft" : "ready";
      addToast(`marking !${mr.iid} ${verb}…`);
      fetch("/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mrUrl: mr.webUrl, iid: mr.iid, draft }),
      })
        .then(async (r) => {
          if (!r.ok) {
            addToast(`couldn't mark !${mr.iid} ${verb} (${r.status})`);
            return;
          }
          addToast(draft ? `!${mr.iid} is back to draft` : `!${mr.iid} is ready for review`);
          void load(true);
        })
        .catch(() => addToast(`couldn't mark !${mr.iid} ${verb}`));
    },
    [addToast, load],
  );

  const handleDoctor = useCallback(
    (mr: BoardMR, note?: string) => {
      if (!mr.webUrl) return;
      const url = mr.webUrl;
      setOptimisticDoctor((o) => ({ ...o, [url]: { status: "queued" } }));
      addToast(`calling doctor for !${mr.iid}…`);
      fetch("/doctor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mrUrl: url, iid: mr.iid, note }),
      })
        .then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok) {
            setOptimisticDoctor((o) => {
              const next = { ...o };
              delete next[url];
              return next;
            });
            addToast(`couldn't call doctor for !${mr.iid} (${r.status})`);
            return;
          }
          if (body?.focused) addToast(`doctor already running for !${mr.iid} — focused its tab`);
          load();
        })
        .catch(() => {
          setOptimisticDoctor((o) => {
            const next = { ...o };
            delete next[url];
            return next;
          });
          addToast(`couldn't call doctor for !${mr.iid}`);
        });
    },
    [addToast, load],
  );

  const handleCopy = useCallback(
    (mr: BoardMR) => {
      const text = data ? mrLine(mr, data.slackTemplates) : mr.webUrl ?? mr.title;
      navigator.clipboard?.writeText(text).then(
        () => addToast(`copied !${mr.iid} for slack`),
        () => {},
      );
    },
    [addToast, data],
  );

  const [postingSummary, setPostingSummary] = useState(false);

  const handlePostSlack = useCallback(
    (mr: BoardMR) => {
      if (!mr.webUrl) return;
      addToast(`posting !${mr.iid} to slack…`);
      fetch("/slack/post", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mrUrls: [mr.webUrl] }),
      })
        .then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok) return addToast(`slack post failed for !${mr.iid} (${r.status})`);
          addToast(body?.linked ? `!${mr.iid} already in slack — linked` : `posted !${mr.iid} to slack`);
          load();
        })
        .catch(() => addToast(`slack post failed for !${mr.iid}`));
    },
    [addToast, load],
  );

  /** `onPosted` runs only when the message actually landed -- the selection bar
      uses it to clear the selection, and a failed post must leave the selection
      intact so the user can retry. */
  const handlePostSummary = useCallback(
    (mrs: BoardMR[], header?: string, onPosted?: () => void) => {
      const urls = mrs.map((m) => m.webUrl).filter((u): u is string => !!u);
      if (!urls.length) return;
      setPostingSummary(true);
      addToast(`posting ${urls.length} MR${urls.length === 1 ? "" : "s"} to slack…`);
      fetch("/slack/post", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(header ? { mrUrls: urls, header } : { mrUrls: urls }),
      })
        .then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok) return addToast(`slack post failed (${r.status})${typeof body === "string" ? `: ${body}` : ""}`);
          addToast(`posted ${urls.length} MR${urls.length === 1 ? "" : "s"} to slack`);
          onPosted?.();
          load();
        })
        .catch(() => addToast(`slack post failed`))
        .finally(() => setPostingSummary(false));
    },
    [addToast, load],
  );

  const handleResolveSlack = useCallback(
    (mr: BoardMR) => {
      if (!mr.webUrl) return;
      addToast(`finding slack thread for !${mr.iid}…`);
      fetch("/slack/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mrUrl: mr.webUrl, iid: mr.iid }),
      })
        .then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok) return addToast(`slack lookup failed for !${mr.iid} (${r.status})`);
          addToast(body.status === "found" ? `found slack thread for !${mr.iid}` : `no slack thread found for !${mr.iid}`);
          load();
        })
        .catch(() => addToast(`slack lookup failed for !${mr.iid}`));
    },
    [addToast, load],
  );

  const handleReactSlack = useCallback(
    (mr: BoardMR, emoji: string, remove: boolean): Promise<string[] | null> => {
      if (!mr.webUrl) return Promise.resolve(null);
      const glyph = getSlackMarks().find((m) => m.emoji === emoji)?.glyph ?? emoji;
      const verb = remove ? "unmark" : "add";
      return fetch("/slack/react", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mrUrl: mr.webUrl, emoji, remove }),
      })
        .then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok) {
            addToast(`couldn't ${verb} ${glyph} for !${mr.iid} (${r.status})`);
            return null;
          }
          addToast(`${remove ? "unmarked" : "marked"} ${glyph} on !${mr.iid}`);
          load();
          return (body.reactions as string[]) ?? null;
        })
        .catch(() => {
          addToast(`couldn't ${verb} ${glyph} for !${mr.iid}`);
          return null;
        });
    },
    [addToast, load],
  );

  // Drop optimistic entries once the server has a real review for that MR.
  useEffect(() => {
    if (!data) return;
    setOptimistic((o) => {
      let changed = false;
      const next = { ...o };
      for (const mr of data.mrs) {
        if (mr.webUrl && (mr as BoardMRWithReview).review && next[mr.webUrl]) {
          delete next[mr.webUrl];
          changed = true;
        }
      }
      return changed ? next : o;
    });
    setOptimisticRespond((o) => {
      let changed = false;
      const next = { ...o };
      for (const mr of data.mrs) {
        if (mr.webUrl && (mr as BoardMRWithReview).respond && next[mr.webUrl]) {
          delete next[mr.webUrl];
          changed = true;
        }
      }
      return changed ? next : o;
    });
    setOptimisticDoctor((o) => {
      let changed = false;
      const next = { ...o };
      for (const mr of data.mrs) {
        if (mr.webUrl && (mr as BoardMRWithReview).doctor && next[mr.webUrl]) {
          delete next[mr.webUrl];
          changed = true;
        }
      }
      return changed ? next : o;
    });
  }, [data]);

  // Poll faster while a review or response is running, so the badge updates
  // promptly instead of waiting for the normal 60s cadence.
  const reviewActive =
    Object.values(optimistic).some((r) => r.status === "queued" || r.status === "reviewing") ||
    (!!data &&
      data.mrs.some((mr) => {
        const s = (mr as BoardMRWithReview).review?.status;
        return s === "queued" || s === "reviewing";
      }));
  const respondActive =
    Object.values(optimisticRespond).some((r) => RESPOND_ACTIVE.has(r.status)) ||
    (!!data &&
      data.mrs.some((mr) => {
        const s = (mr as BoardMRWithReview).respond?.status;
        return !!s && RESPOND_ACTIVE.has(s);
      }));
  const doctorActive =
    Object.values(optimisticDoctor).some((r) => DOCTOR_ACTIVE.has(r.status)) ||
    (!!data &&
      data.mrs.some((mr) => {
        const s = (mr as BoardMRWithReview).doctor?.status;
        return !!s && DOCTOR_ACTIVE.has(s);
      }));

  useEffect(() => {
    if (!reviewActive && !respondActive && !doctorActive) return;
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 4000);
    return () => clearInterval(t);
  }, [reviewActive, respondActive, doctorActive, load]);

  if (!data) {
    return <p className="tui-loading">{loadError ? "✗ failed to load board data" : "fetching…"}</p>;
  }

  const total = data.members.reduce((n, m) => n + m.count, 0);
  const staleMins = Math.round((Date.now() - data.fetchedAt) / 60_000);
  const now = Date.now();
  const dataAge = dataAgeLabel(data.dataSyncedAt, now);
  // Both known and the board asks for more history than rt actually syncs --
  // config drift the board can't self-correct, so it needs to be visible.
  const windowMismatch =
    data.scopeWindowDays !== null && data.staleAfterDays > data.scopeWindowDays
      ? `board shows ${data.staleAfterDays} days but rt syncs ${data.scopeWindowDays} days... align configs`
      : null;

  // Server review wins; otherwise show an optimistic "queued" badge if pending.
  const mrs = data.mrs.map((mr) => {
    const mrx = mr as BoardMRWithReview;
    const optRev = mr.webUrl ? optimistic[mr.webUrl] : undefined;
    const optResp = mr.webUrl ? optimisticRespond[mr.webUrl] : undefined;
    const optDoc = mr.webUrl ? optimisticDoctor[mr.webUrl] : undefined;
    let next: BoardMRWithReview = mrx;
    if (!mrx.review && optRev) next = { ...next, review: optRev };
    if (!mrx.respond && optResp) next = { ...next, respond: optResp };
    if (!mrx.doctor && optDoc) next = { ...next, doctor: optDoc };
    return next;
  });
  const filtered = filterByMember(mrs, state.member);
  const groups = groupMRs(filtered, state.group, data.members.map((m) => m.username), now).map((g) => ({
    label: g.label,
    mrs: sortMRs(g.mrs, state.sort),
  }));
  const activeMember = state.member === "all" ? null : data.members.find((m) => m.username === state.member) ?? null;
  // Show each row's author only when the view mixes authors: the All view
  // grouped by anything but author (where the group header isn't the name).
  const showAuthor = state.member === "all" && state.group !== "author";
  const flatMrs = groups.flatMap((g) => g.mrs);
  // Drawn from `mrs`, not `filtered` -- that's what lets a selection span
  // member filters.
  const selectedMrs = selectionOf(mrs, selected);
  const summaryText = boardSummary(flatMrs, data.slackTemplates);
  const postableMrs = postableOf(flatMrs as BoardMRWithReview[]);
  const postableSelected = postableOf(selectedMrs as BoardMRWithReview[]);
  const openSettings = () => {
    setMenuOpen(false);
    setShowSettings(true);
  };
  const controlProps = {
    state,
    update,
    view,
    pickView,
    theme,
    pickTheme,
    // The bar owns copy while a selection is live -- its header input has to
    // sit next to the button that consumes it.
    canCopy: filtered.length > 0 && selectedMrs.length === 0,
    summaryText,
    onRefresh: refreshNow,
    refreshing,
    canPostSummary: data.slackEnabled && data.local && postableMrs.length > 0,
    postingSummary,
    onPostSummary: () => handlePostSummary(postableMrs),
  };

  return (
    <div className={view === "grid" ? "tui tui-wide tui-app" : "tui tui-app"}>
      {/* Desktop roster (hidden on mobile, where it moves into the drawer). */}
      <Sidebar
        members={data.members}
        total={total}
        active={state.member}
        onPick={(member) => update({ member })}
        onSettings={openSettings}
        scopeUncovered={data.scopeUncovered}
      />

      <div className="tui-main">
        <header className="tui-header">
          {/* Mobile-only: burger opens the drawer with roster + controls. */}
          <button className="tui-burger" onClick={() => setMenuOpen(true)} aria-label="open menu">
            {ICONS.menu}
          </button>
          <div className="tui-header-title">
            <h1>
              <span className="tui-prompt">❯</span> {data.title.toLowerCase()}{" "}
              {activeMember && <span className="tui-author">--author @{activeMember.username}</span>}
            </h1>
            <p className="tui-sub">
              <span className="tui-comment"># {filtered.length} awaiting review · pick one, it opens in gitlab</span>
            </p>
          </div>
          <div className="tui-controls tui-controls-header">
            <Controls {...controlProps} />
          </div>
        </header>

        {selectedMrs.length > 0 && (
          <SelectionBar
            selectedMrs={selectedMrs}
            inViewCount={selectionOf(filtered, selected).length}
            templates={data.slackTemplates}
            onClear={clearSelection}
            posting={postingSummary}
            slackPost={
              data.slackEnabled && data.local && postableSelected.length > 0
                ? {
                    count: postableSelected.length,
                    // Clear only on success: the posted MRs drop out of
                    // postableSelected, so leaving them checked would sit the
                    // bar there with no post button and read like a bug.
                    send: (header) => handlePostSummary(postableSelected, header, clearSelection),
                  }
                : null
            }
          />
        )}

        {data.fetchError && <div className="tui-banner">⚠ data from {staleMins}m ago — gitlab fetch failing</div>}
        {windowMismatch && <div className="tui-banner">⚠ {windowMismatch}</div>}

        {filtered.length === 0 && !data.fetchError ? (
          <p className="tui-empty">nothing waiting on review ✓</p>
        ) : (
          groups.map((g) => (
            <Panel key={g.label} title={g.label} count={g.mrs.length}>
              {view === "rows" ? (
                <RowView mrs={g.mrs} now={now} showAuthor={showAuthor} local={data.local} slackTemplates={data.slackTemplates} onContext={openRowMenu} onOpenReview={setReviewModal} onOpenDraft={openDraft} draftResolved={draftResolved} onResumeRespond={handleResumeRespond} selected={selected} onToggleSelect={toggleSelect} />
              ) : (
                <GridView mrs={g.mrs} now={now} showAuthor={showAuthor} local={data.local} slackTemplates={data.slackTemplates} onContext={openRowMenu} onOpenReview={setReviewModal} onOpenDraft={openDraft} draftResolved={draftResolved} onResumeRespond={handleResumeRespond} selected={selected} onToggleSelect={toggleSelect} />
              )}
            </Panel>
          ))
        )}

        <footer className={dataAge.stale ? "tui-footer tui-footer-stale" : "tui-footer"}>{dataAge.text}</footer>
      </div>

      {/* Mobile drawer: roster + controls, tucked behind the burger. */}
      {menuOpen && (
        <div className="tui-drawer-overlay" onClick={() => setMenuOpen(false)}>
          <div className="tui-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="menu">
            <div className="tui-drawer-head">
              <span className="tui-modal-title">❯ menu</span>
              <button className="tui-modal-x" onClick={() => setMenuOpen(false)} aria-label="close menu">
                {ICONS.close}
              </button>
            </div>
            <Sidebar
              members={data.members}
              total={total}
              active={state.member}
              onPick={(member) => {
                update({ member });
                setMenuOpen(false);
              }}
              onSettings={openSettings}
              scopeUncovered={data.scopeUncovered}
            />
            <div className="tui-drawer-controls">
              <Controls {...controlProps} stacked />
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <SettingsModal
          members={data.allMembers}
          canInvite={data.canInvite}
          local={data.local}
          peering={data.peering}
          defaultMember={data.defaultMember}
          onToggle={toggleMember}
          onJoined={() => load()}
          onClose={() => setShowSettings(false)}
        />
      )}

      {rowMenu && (
        <RowMenu
          menu={rowMenu}
          local={data.local}
          slackEnabled={data.slackEnabled}
          onClose={() => setRowMenu(null)}
          onLaunch={handleLaunch}
          onReReview={handleReReview}
          onOpenReview={setReviewModal}
          onCopy={handleCopy}
          onResolveSlack={handleResolveSlack}
          onReactSlack={handleReactSlack}
          onPostSlack={handlePostSlack}
          onRespond={handleRespond}
          canRespond={rowMenu.mr.author.username === data.defaultMember}
          onDoctor={handleDoctor}
          // Doctor is mechanical repair (rebase / CI), so it's offered for anyone's
          // MR that's actually broken — not gated to your own MRs the way respond is.
          canDoctor={!!(rowMenu.mr.blockers?.pipelineFailing || rowMenu.mr.blockers?.hasConflicts)}
          onDraftState={handleDraftState}
          // Your own MRs only, both directions. buildBoard already hides other
          // people's drafts, but their ready MRs are on the board, so this gate
          // is what keeps "mark as draft" off them.
          canDraftState={rowMenu.mr.author.username === data.defaultMember}
          onNudge={handleNudge}
          // Your own MRs only: a nudge asks a peer to re-review YOUR work, and
          // the server enforces the same gate (403 "not your MR").
          canNudge={rowMenu.mr.author.username === data.defaultMember}
          onResumeReview={handleResumeReview}
          onResumeRespond={handleResumeRespond}
        />
      )}

      {reviewModal && <ReviewModal mr={reviewModal} onClose={() => setReviewModal(null)} />}

      {draftModal && (
        <DraftModal
          mr={draftModal.mr}
          draft={draftModal.draft}
          local={data.local}
          onResolved={handleDraftResolved}
          onClose={() => setDraftModal(null)}
        />
      )}

      <ToastHost toasts={toasts} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Board />
  </StrictMode>,
);

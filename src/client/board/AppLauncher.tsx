import { useEffect, useMemo, useRef, useState } from "react";
import { useEscapeClose } from "@mattstack/tui-kit";
import { deriveDeckBase } from "./deck-discovery.ts";
import type { DiscoveryApp } from "./deck-discovery.ts";
import { useDiscoveryApps } from "./useDiscoveryApps.ts";

// ── app launcher (cross-app switcher) ────────────────────────────────────
// The shared mattstack mark, matching the mark rendered by app-kit's own
// MattstackMark/AppLauncher (deck.mattstack, chat, console) byte-for-byte --
// this is the one visual anchor that must read as "the same button" across
// every mattstack surface.

const CURRENT_APP = "board";

function sortApps(apps: DiscoveryApp[]): DiscoveryApp[] {
  return [...apps].sort((a, b) => {
    if (a.name === CURRENT_APP) return -1;
    if (b.name === CURRENT_APP) return 1;
    return 0;
  });
}

function MattstackMark() {
  return (
    <svg width="32" height="32" viewBox="0 0 64 64" style={{ display: "block" }}>
      <rect width="64" height="64" rx="14.4" fill="#161224" />
      <text x="12.5" y="41.5" fontFamily="ui-monospace, 'SF Mono', Menlo, monospace" fontSize="26" fontWeight="600" fill="#ff6b9d">
        m
      </text>
      <g transform="translate(31.6 22.4) scale(0.8)" fill="none" stroke="#ff6b9d" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2.5 L21.8 7 L12 11.5 L2.2 7 Z" />
        <path d="M2.2 12.3 L12 16.8 L21.8 12.3" />
        <path d="M2.2 17.3 L12 21.8 L21.8 17.3" />
      </g>
    </svg>
  );
}

function Tile({ app }: { app: DiscoveryApp }) {
  const current = app.name === CURRENT_APP;
  return (
    <a
      href={app.url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 7,
        padding: "11px 4px",
        borderRadius: 6,
        position: "relative",
        textDecoration: "none",
        ...(current
          ? {
              background: "color-mix(in srgb, var(--accent) 15%, transparent)",
              boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent)",
            }
          : {}),
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 9,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        {app.icon ? (
          <img src={app.icon} width={40} height={40} alt="" style={{ borderRadius: 9 }} />
        ) : (
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 9,
              background: "var(--border)",
            }}
          />
        )}
        {current && (
          <span
            style={{
              position: "absolute",
              top: -5,
              right: -5,
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: "var(--accent)",
              border: "2px solid var(--panel)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#1d1830" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
        )}
      </div>
      <span
        style={{
          fontSize: "0.72rem",
          color: current ? "var(--accent)" : "var(--fg)",
          fontWeight: current ? 600 : 400,
        }}
      >
        {app.displayName}
      </span>
    </a>
  );
}

/**
 * The board's cross-app switcher trigger + dropdown. Renders nothing when no
 * deck base resolves (an origin that's neither `*.mattstack` nor
 * `*.localhost`), so a non-mattstack surface simply has no launcher rather
 * than a dead button firing a doomed cross-origin fetch.
 */
export function AppLauncher() {
  const origin = typeof location === "undefined" ? "" : location.origin;
  const base = deriveDeckBase(origin);
  const { apps, refresh } = useDiscoveryApps(base);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const ordered = useMemo(() => sortApps(apps), [apps]);

  // Preload on mount so the dropdown opens fully-sized on first click instead
  // of popping tiles in once the fetch lands. The hook's 30s cache makes the
  // open-time refresh below a no-op inside that window.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEscapeClose(() => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  if (!base) return null;

  const toggle = () => {
    if (!open) void refresh();
    setOpen((o) => !o);
  };

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        aria-label="Apps"
        onClick={toggle}
        style={{
          width: 40,
          height: 40,
          borderRadius: 8,
          border: "none",
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          background: open ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "transparent",
        }}
      >
        <MattstackMark />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 10px)",
            right: 0,
            width: 252,
            zIndex: 20,
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 14px 34px rgba(0,0,0,0.55)",
            padding: 10,
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              top: -6,
              right: 14,
              width: 11,
              height: 11,
              transform: "rotate(45deg)",
              background: "var(--panel)",
              borderLeft: "1px solid var(--border)",
              borderTop: "1px solid var(--border)",
            }}
          />
          <div
            style={{
              fontSize: "0.6rem",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--muted)",
              padding: "1px 4px 9px",
            }}
          >
            switch app
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 4 }}>
            {ordered.map((app) => (
              <Tile key={app.name} app={app} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * ActionCableClient — outgoing WebSocket client for GitLab's ActionCable endpoint.
 *
 * Connects to wss://{baseURL}/-/cable, implements the ActionCable protocol
 * (subscribe/unsubscribe/ping/confirm), and auto-reconnects with exponential backoff.
 *
 * Mirrors Swift's ActionCableClient.swift.
 */

import { type ForgeLogger, noopLogger } from "./logger.ts";

export interface ActionCableCallbacks {
  onConnected(): void;
  onDisconnected(intentional: boolean, reason: string): void;
  onMessage(identifier: string, message: unknown): void;
  onConfirm(identifier: string): void;
  onReject(identifier: string): void;
}

const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 120_000;
const MAX_RECONNECT_ATTEMPTS = 8;

export class ActionCableClient {
  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private intentionalDisconnect = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly wsUrl: string;
  private readonly originUrl: string;
  private readonly log: ForgeLogger;
  private readonly logContext: string;

  constructor(
    baseURL: string,
    private readonly token: string,
    private readonly callbacks: ActionCableCallbacks,
    options: { logger?: ForgeLogger; logContext?: string } = {},
  ) {
    this.log = options.logger ?? noopLogger;
    this.logContext = options.logContext ?? "";
    const stripped = baseURL.replace(/\/$/, "");
    this.originUrl = stripped;
    this.wsUrl =
      stripped.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://") + "/-/cable";
  }

  connect(): void {
    this.intentionalDisconnect = false;
    this.reconnectAttempt = 0;
    this.performConnect();
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    this.cleanup();
    this.log.info("ActionCable intentionally disconnected", {
      url: this.wsUrl,
      ctx: this.logContext,
    });
  }

  subscribe(identifier: string): void {
    this.send({ command: "subscribe", identifier });
  }

  unsubscribe(identifier: string): void {
    this.send({ command: "unsubscribe", identifier });
  }

  private performConnect(): void {
    this.cleanup();

    let ws: WebSocket;
    try {
      // Bun extends the standard WebSocket constructor to accept an options object
      // with a `headers` field (Bun-specific, not in the browser WebSocket API).
      ws = new WebSocket(
        this.wsUrl,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {
          headers: {
            Authorization: `Bearer ${this.token}`,
            Origin: this.originUrl,
          },
        } as any,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error("ActionCable failed to create WebSocket", {
        url: this.wsUrl,
        message,
        ctx: this.logContext,
      });
      this.scheduleReconnect();
      return;
    }

    this.ws = ws;

    ws.onmessage = (event: MessageEvent) => {
      const raw = typeof event.data === "string" ? event.data : String(event.data);
      this.handleMessage(raw);
    };

    ws.onclose = (event: CloseEvent) => {
      if (this.intentionalDisconnect) {
        this.callbacks.onDisconnected(true, "intentional disconnect");
      } else {
        const reason = event.reason || `code ${event.code}`;
        this.log.warn("ActionCable disconnected", {
          url: this.wsUrl,
          reason,
          ctx: this.logContext,
        });
        this.callbacks.onDisconnected(false, reason);
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // onclose always fires after onerror and handles the reconnect schedule.
      this.log.warn("ActionCable WebSocket error", { url: this.wsUrl, ctx: this.logContext });
    };

    this.log.info("ActionCable connecting", { url: this.wsUrl, ctx: this.logContext });
  }

  private handleMessage(raw: string): void {
    let msg: {
      type?: string;
      identifier?: string;
      message?: unknown;
      reason?: string;
      reconnect?: boolean;
    };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return;
    }

    if (!msg.type) {
      // Data message — no "type" field present.
      if (typeof msg.identifier === "string" && msg.message !== undefined) {
        this.callbacks.onMessage(msg.identifier, msg.message);
      }
      return;
    }

    switch (msg.type) {
      case "welcome":
        this.reconnectAttempt = 0;
        this.log.info("ActionCable connected (welcome)", { url: this.wsUrl, ctx: this.logContext });
        this.callbacks.onConnected();
        break;

      case "ping":
        // Server heartbeat — no response needed.
        break;

      case "confirm_subscription":
        if (typeof msg.identifier === "string") {
          this.log.debug("ActionCable subscription confirmed", { ctx: this.logContext });
          this.callbacks.onConfirm(msg.identifier);
        }
        break;

      case "reject_subscription":
        if (typeof msg.identifier === "string") {
          this.log.warn("ActionCable subscription rejected", { ctx: this.logContext });
          this.callbacks.onReject(msg.identifier);
        }
        break;

      case "disconnect": {
        const shouldReconnect = msg.reconnect !== false;
        this.log.info("ActionCable server disconnect", {
          reason: msg.reason,
          reconnect: shouldReconnect,
          ctx: this.logContext,
        });
        if (!shouldReconnect) this.intentionalDisconnect = true;
        this.callbacks.onDisconnected(!shouldReconnect, msg.reason ?? "server disconnect");
        break;
      }
    }
  }

  private send(obj: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  private cleanup(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws !== null) {
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      this.log.error("ActionCable max reconnect attempts reached", {
        url: this.wsUrl,
        ctx: this.logContext,
      });
      return;
    }

    const base = BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempt);
    const jitter = Math.random() * base * 0.3;
    const delayMs = Math.min(base + jitter, MAX_RECONNECT_DELAY_MS);
    this.reconnectAttempt++;

    this.log.info("ActionCable scheduling reconnect", {
      attempt: this.reconnectAttempt,
      delayMs: Math.round(delayMs),
      ctx: this.logContext,
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.intentionalDisconnect) {
        this.performConnect();
      }
    }, delayMs);
  }
}

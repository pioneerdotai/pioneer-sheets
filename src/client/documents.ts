import { getAppClient } from "./pioneer/client";
import { MessageReader, sendMessage } from "../shared/collaboration/framing";
import { newId } from "../shared/id";
import * as Y from "yjs";
import {
  LOCAL,
  snapshot,
  writeSnapshot,
  base64,
  unbase64,
  equal,
  anchorSelection,
  type Snapshot,
} from "../shared/documents/model";
import type { Presence, Identity } from "../shared/types";

export class OfficeClient {
  doc = new Y.Doc();
  undo: Y.UndoManager;
  socket?: WebSocket;
  revision = 0;
  role = "editor";
  members: Presence[] = [];
  connected = false;
  editorReady = false;
  pending = new Map<string, string>();
  private sent = new Set<string>();
  private offlineHandler = () => {
    this.connected = false;
    this.serverReady = false;
    this.socket?.close();
    this.onRole?.();
    this.onStatus?.();
  };
  private onlineHandler = () => this.connect();
  private pageHideHandler = () => {
    this.beforeRemote?.();
    this.sendPending();
  };
  private stopped = false;
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private sendTimer?: ReturnType<typeof setTimeout>;
  private selectionTimer?: ReturnType<typeof setTimeout>;
  private selection?: Presence["selection"];
  private sentSelection?: Presence["selection"];
  private selectionSentAt = 0;
  private serverReady = false;
  onRole?: () => void;
  beforeRemote?: () => void;
  beforeFlush?: () => Promise<void>;
  onSnapshot?: (value: Snapshot) => void;
  onPresence?: () => void;
  onStatus?: () => void;
  onEvent?: (e: any) => void;
  onError?: (s: string) => void;
  constructor(
    public id: string,
    public who: Identity,
  ) {
    window.addEventListener("offline", this.offlineHandler);
    window.addEventListener("online", this.onlineHandler);
    window.addEventListener("pagehide", this.pageHideHandler);
    this.undo = new Y.UndoManager(this.doc.getMap("unit"), {
      trackedOrigins: new Set([LOCAL]),
      captureTimeout: 500,
    });
    this.doc.on("update", (update: Uint8Array, origin: any) => {
      if (origin === LOCAL || origin === "derived" || origin === this.undo) {
        const encoded = base64(update);
        const unsent = [...this.pending.keys()].find(
          (id) =>
            !this.sent.has(id) &&
            this.pending.get(id)!.length + encoded.length < 24_000_000,
        );
        const requestId = unsent ?? newId();
        this.pending.set(
          requestId,
          unsent
            ? base64(
                Y.mergeUpdates([unbase64(this.pending.get(unsent)!), update]),
              )
            : encoded,
        );
        this.sendTimer ??= setTimeout(() => this.sendPending(), 150);
        this.onStatus?.();
      }
    });
  }
  async connect() {
    if (
      !navigator.onLine ||
      this.stopped ||
      (this.socket && this.socket.readyState < 2)
    )
      return;
    clearInterval(this.heartbeat);
    const app = await getAppClient();
    if (this.stopped) return;
    const url = new URL(app.webSocketUrl("collaboration"));
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("document", this.id);
    const ws = new WebSocket(url);
    this.socket = ws;
    const reader = new MessageReader();
    ws.onmessage = (event) => {
      const msg = reader.read(event.data);
      if (!msg) return;
      if (msg.type === "sync") {
        this.beforeRemote?.();
        this.revision = msg.revision;
        this.role = msg.role;
        Y.applyUpdate(this.doc, unbase64(msg.update), "server");
        this.connected = true;
        this.serverReady = true;
        this.onSnapshot?.(snapshot(this.doc));
        this.sendPending();
        this.publishSelection(true);
        this.onRole?.();
        this.onStatus?.();
      } else if (msg.type === "update") {
        // The server echoes the exact accepted delta. It is already in this
        // document; an echo must not capture or redraw the editor again.
        if (!this.pending.has(msg.requestId)) {
          this.beforeRemote?.();
          let changed = false;
          const unit = this.doc.getMap("unit");
          const observe = () => {
            changed = true;
          };
          unit.observeDeep(observe);
          try {
            Y.applyUpdate(this.doc, unbase64(msg.update), "server");
          } finally {
            unit.unobserveDeep(observe);
          }
          if (changed) this.onSnapshot?.(snapshot(this.doc));
        }
        this.revision = Math.max(this.revision, msg.revision);
        this.onStatus?.();
      } else if (msg.type === "ack") {
        this.pending.delete(msg.requestId);
        this.sent.delete(msg.requestId);
        this.revision = Math.max(this.revision, msg.revision);
        this.sendPending();
        this.onStatus?.();
      } else if (msg.type === "presence") {
        const changed = !equal(
          this.members.map(({ selection, updatedAt, ...member }) => member),
          msg.members.map(
            ({ selection, updatedAt, ...member }: Presence) => member,
          ),
        );
        this.members = msg.members;
        this.onPresence?.();
        if (changed) this.onStatus?.();
      } else if (msg.type === "error") this.onError?.(msg.message);
      else this.onEvent?.(msg);
    };
    ws.onclose = () => {
      this.sent.clear();
      this.connected = false;
      this.serverReady = false;
      this.onRole?.();
      this.onStatus?.();
      if (!this.stopped) this.retry = setTimeout(() => this.connect(), 1500);
    };
    ws.onerror = () => {
      this.connected = false;
      this.onRole?.();
      this.onStatus?.();
    };
    this.heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
        this.publishSelection(true);
      }
    }, 20000);
  }
  private sendPending() {
    clearTimeout(this.sendTimer);
    this.sendTimer = undefined;
    if (this.socket?.readyState !== WebSocket.OPEN || !this.serverReady) return;
    if (this.sent.size) return;
    for (const [requestId, update] of this.pending) {
      if (this.sent.has(requestId)) continue;
      this.sent.add(requestId);
      sendMessage((text) => this.socket!.send(text), {
        type: "update",
        requestId,
        update,
      });
      break;
    }
  }
  apply(before: Snapshot, after: Snapshot, trackHistory = true) {
    if (this.stopped || this.role === "viewer" || !this.connected) return;
    writeSnapshot(this.doc, before, after, trackHistory ? LOCAL : "derived");
  }
  async flush(timeout = 15000) {
    await this.beforeFlush?.();
    this.beforeRemote?.();
    this.sendPending();
    const start = Date.now();
    do {
      if (!this.connected)
        throw new Error("No connection. Export is available after saving.");
      if (!this.pending.size) return this.revision;
      if (Date.now() - start > timeout)
        throw new Error("Wait for saving to finish before exporting");
      await new Promise((r) => setTimeout(r, 50));
    } while (true);
  }
  setSelection(selection: Presence["selection"]) {
    const next = anchorSelection(this.doc, selection);
    if (equal(this.selection, next)) return this.selection;
    this.selection = next;
    this.publishSelection();
    return next;
  }
  private publishSelection(force = false) {
    if (this.socket?.readyState !== WebSocket.OPEN || !this.serverReady) return;
    if (!force && equal(this.selection, this.sentSelection)) return;
    const delay = 100 - (Date.now() - this.selectionSentAt);
    if (!force && delay > 0) {
      this.selectionTimer ??= setTimeout(() => {
        this.selectionTimer = undefined;
        this.publishSelection();
      }, delay);
      return;
    }
    clearTimeout(this.selectionTimer);
    this.selectionTimer = undefined;
    this.sentSelection = this.selection;
    this.selectionSentAt = Date.now();
    this.socket.send(
      JSON.stringify({ type: "presence", selection: this.selection }),
    );
  }
  undoEdit() {
    if (this.role === "viewer" || !this.connected) return;
    this.beforeRemote?.();
    this.undo.stopCapturing();
    this.undo.undo();
    this.onSnapshot?.(snapshot(this.doc));
  }
  redoEdit() {
    if (this.role === "viewer" || !this.connected) return;
    this.beforeRemote?.();
    this.undo.redo();
    this.onSnapshot?.(snapshot(this.doc));
  }
  close() {
    if (this.stopped) return;
    this.pageHideHandler();
    this.stopped = true;
    this.connected = false;
    window.removeEventListener("offline", this.offlineHandler);
    window.removeEventListener("online", this.onlineHandler);
    window.removeEventListener("pagehide", this.pageHideHandler);
    clearTimeout(this.retry);
    clearInterval(this.heartbeat);
    clearTimeout(this.sendTimer);
    clearTimeout(this.selectionTimer);
    this.socket?.close();
    this.undo.destroy();
    this.doc.destroy();
  }
}

export async function api<T = any>(
  path: string,
  body?: any,
  method?: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch((await getAppClient()).url("api/" + path), {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "Request failed");
  return value;
}

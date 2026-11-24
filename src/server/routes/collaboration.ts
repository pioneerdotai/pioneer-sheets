import { trackConnection } from "../../client/pioneer/lifecycle";
import { pioneerIdentity } from "#sheets-authority";
import { MessageReader, sendMessage } from "../../shared/collaboration/framing";
import { defineWebSocketHandler } from "nitro";
import { getService } from "../runtime";
import type { Identity } from "../../shared/types";

const peers = new Map<
  string,
  {
    id: string;
    who: Identity;
    unsubscribe: () => void;
    untrack: () => void;
    reader: MessageReader;
    queue: Promise<unknown>;
    queuedFrames: number;
  }
>();

export default defineWebSocketHandler({
  async upgrade(request) {
    const url = new URL(request.url);
    const service = await getService();
    const who = await pioneerIdentity(request.headers);
    const id = url.searchParams.get("document") ?? "";
    await service.describe(id, who);
    return { context: { who, id } };
  },
  async open(peer) {
    const service = await getService();
    const { who, id } = peer.context as any;
    // Subscribe before reading the initial state: commits during the database
    // read must reach a reconnecting peer after its sync frame.
    const queued: any[] = [];
    let ready = false;
    const unsubscribe = service.subscribe(id, (event) => {
      if (ready) sendMessage((text) => peer.send(text), event);
      else queued.push(event);
    });
    try {
      const current = await service.sync(id, who);
      peers.set(peer.id, {
        id,
        who,
        unsubscribe,
        untrack: trackConnection(() =>
          peer.close(1001, "Application stopping"),
        ),
        reader: new MessageReader(),
        queue: Promise.resolve(),
        queuedFrames: 0,
      });
      sendMessage((text) => peer.send(text), {
        type: "sync",
        id,
        revision: current.revision,
        role: current.role,
        update: current.update,
      });
      ready = true;
      for (const event of queued) sendMessage((text) => peer.send(text), event);
      service.presence(id, who, peer.id);
    } catch (error) {
      unsubscribe();
      throw error;
    }
  },
  async message(peer, message) {
    const state = peers.get(peer.id);
    if (!state) return;
    if (++state.queuedFrames > 300) {
      peer.close(1009, "Collaboration backpressure");
      return;
    }
    const text = message.text();
    state.queue = state.queue
      .catch(() => {})
      .then(async () => {
        const service = await getService();
        try {
          if (text.length > 30_000_000) throw new Error("Message is too large");
          const input = state.reader.read(text);
          if (!input) return;
          if (input.type === "update") {
            const result = await service.update(state.id, state.who, input);
            sendMessage((text) => peer.send(text), {
              type: "ack",
              requestId: input.requestId,
              ...result,
            });
          } else if (input.type === "presence")
            service.presence(state.id, state.who, peer.id, input.selection);
          else if (input.type === "ping")
            sendMessage((text) => peer.send(text), { type: "pong" });
        } catch (e) {
          sendMessage((text) => peer.send(text), {
            type: "error",
            message: e instanceof Error ? e.message : String(e),
          });
        }
      });
    await state.queue.finally(() => {
      state.queuedFrames--;
    });
  },
  async close(peer) {
    const state = peers.get(peer.id);
    if (state) {
      state.unsubscribe();
      state.untrack();
      peers.delete(peer.id);
      (await getService()).leave(state.id, peer.id);
    }
  },
  error(peer) {
    const state = peers.get(peer.id);
    if (state) {
      state.unsubscribe();
      state.untrack();
      peers.delete(peer.id);
      void getService().then((s) => s.leave(state.id, peer.id));
    }
  },
});

/** Application frames stay below Gateway's 1 MiB WebSocket message limit. */
const CHUNK = 128 * 1024;

const MAX_TEXT = 32 * 1024 * 1024;

let sequence = 0;

export function sendMessage(send: (text: string) => unknown, value: unknown) {
  const text = JSON.stringify(value);
  if (text.length > MAX_TEXT)
    throw new Error("COLLABORATION_MESSAGE_TOO_LARGE");
  if (text.length <= CHUNK) {
    send(text);
    return;
  }
  const id = `${Date.now()}:${++sequence}`,
    total = Math.ceil(text.length / CHUNK);
  for (let index = 0; index < total; index++)
    send(
      JSON.stringify({
        type: "frame",
        id,
        index,
        total,
        data: text.slice(index * CHUNK, (index + 1) * CHUNK),
      }),
    );
}

export class MessageReader {
  private current?: {
    id: string;
    total: number;
    chunks: string[];
    size: number;
    started: number;
  };
  read(text: string): any | undefined {
    if (text.length > CHUNK * 6 + 1024)
      throw new Error("COLLABORATION_FRAME_TOO_LARGE");
    const message = JSON.parse(text);
    if (message.type !== "frame") return message;
    const { id, index, total, data } = message;
    if (
      typeof id !== "string" ||
      id.length > 100 ||
      !Number.isInteger(total) ||
      total < 2 ||
      total > MAX_TEXT / CHUNK ||
      !Number.isInteger(index) ||
      typeof data !== "string" ||
      data.length > CHUNK
    )
      throw new Error("INVALID_COLLABORATION_FRAME");
    if (index === 0)
      this.current = { id, total, chunks: [], size: 0, started: Date.now() };
    const current = this.current;
    if (
      !current ||
      current.id !== id ||
      current.total !== total ||
      index !== current.chunks.length ||
      Date.now() - current.started > 30000
    )
      throw new Error("COLLABORATION_FRAME_ORDER");
    current.size += data.length;
    if (current.size > MAX_TEXT)
      throw new Error("COLLABORATION_MESSAGE_TOO_LARGE");
    current.chunks.push(data);
    if (current.chunks.length !== total) return;
    this.current = undefined;
    return JSON.parse(current.chunks.join(""));
  }
}

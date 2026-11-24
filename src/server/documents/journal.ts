import * as Y from "yjs";
import type { Storage } from "../db/database";
import type { units } from "../db/schema/documents";
import { encode, snapshot, type Snapshot } from "../../shared/documents/model";
import { decodeRecord, encodeRecord } from "./record-codec";

export type DocumentHead = typeof units.$inferSelect;
export type ResidentDocument = {
  doc: Y.Doc;
  data: Snapshot;
  sequence: number;
  weight: number;
  busy: boolean;
  usedAt: number;
};

// Encoded bytes underestimate Yjs + snapshot heap. The multiplier is a cache
// accounting estimate, not a process RSS limit. Oversize books are not retained.
const HEAP_FACTOR = 16;
const MAX_WEIGHT = 128 * 1024 * 1024;
const MAX_DOCUMENTS = 8;
const IDLE_MS = 60_000;

export class DocumentJournal {
  private entries = new Map<string, ResidentDocument>();
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private storage: Storage) {}

  async read(id: string, sequence: number): Promise<Y.Doc> {
    const checkpoint = await this.storage.checkpoint(id, sequence);
    if (!checkpoint) throw new Error("Document checkpoint is missing");
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, await decodeRecord(checkpoint));
      const deltas = await this.storage.deltas(
        id,
        checkpoint.sequence,
        sequence,
      );
      let cursor = checkpoint.sequence;
      for (const record of deltas) {
        if (record.sequence !== ++cursor || record.kind !== "delta")
          throw new Error("Document journal is incomplete");
        Y.applyUpdate(doc, await decodeRecord(record));
      }
      if (cursor !== sequence)
        throw new Error("Document journal is incomplete");
      return doc;
    } catch (error) {
      doc.destroy();
      throw error;
    }
  }

  // Called only inside OfficeService's existing per-document lock. A cache
  // entry stays private until validation and the database transaction succeed.
  async use<T>(
    head: DocumentHead,
    operation: (entry: ResidentDocument) => Promise<T>,
  ): Promise<T> {
    let entry = this.entries.get(head.id);
    if (entry && entry.sequence !== head.sequence) {
      this.discard(head.id);
      entry = undefined;
    }
    if (!entry) {
      const doc = await this.read(head.id, head.sequence);
      try {
        entry = {
          doc,
          data: snapshot(doc),
          sequence: head.sequence,
          weight: HEAP_FACTOR * (head.checkpointSize + head.deltaBytes),
          busy: false,
          usedAt: Date.now(),
        };
        this.entries.set(head.id, entry);
      } catch (error) {
        doc.destroy();
        throw error;
      }
    }
    entry.busy = true;
    this.trim();
    try {
      return await operation(entry);
    } catch (error) {
      // Yjs has already applied the candidate. A rejected/failed write must
      // never become the base of another read, update or WebSocket sync.
      this.discard(head.id);
      throw error;
    } finally {
      entry.busy = false;
      entry.usedAt = Date.now();
      this.trim();
      this.schedule();
    }
  }

  private schedule() {
    if (!this.entries.size || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.trim();
      this.schedule();
    }, IDLE_MS);
    this.timer.unref?.();
  }

  async prepare(
    head: DocumentHead,
    entry: ResidentDocument,
    delta: Uint8Array,
  ) {
    const sequence = head.sequence + 1;
    const checkpoint =
      sequence - head.checkpointSequence >= 256 ||
      head.deltaBytes + delta.length >= head.checkpointSize * 0.25;
    const bytes = checkpoint ? encode(entry.doc) : delta;
    const record = await encodeRecord(bytes, checkpoint);
    return {
      record: {
        ...record,
        documentId: head.id,
        sequence,
        kind: checkpoint ? ("checkpoint" as const) : ("delta" as const),
      },
      head: {
        sequence,
        checkpointSequence: checkpoint ? sequence : head.checkpointSequence,
        checkpointSize: checkpoint ? bytes.length : head.checkpointSize,
        deltaBytes: checkpoint ? 0 : head.deltaBytes + delta.length,
      },
    };
  }

  committed(
    entry: ResidentDocument,
    head: Pick<DocumentHead, "sequence" | "checkpointSize" | "deltaBytes">,
    data: Snapshot,
  ) {
    entry.sequence = head.sequence;
    entry.data = data;
    entry.weight = HEAP_FACTOR * (head.checkpointSize + head.deltaBytes);
  }

  discard(id: string) {
    const entry = this.entries.get(id);
    this.entries.delete(id);
    entry?.doc.destroy();
  }

  private trim() {
    let weight = [...this.entries.values()].reduce(
      (sum, e) => sum + e.weight,
      0,
    );
    const oldest = [...this.entries].sort((a, b) => a[1].usedAt - b[1].usedAt);
    for (const [id, entry] of oldest) {
      if (entry.busy) continue;
      if (
        Date.now() - entry.usedAt < IDLE_MS &&
        this.entries.size <= MAX_DOCUMENTS &&
        weight <= MAX_WEIGHT
      )
        continue;
      weight -= entry.weight;
      this.discard(id);
    }
    if (!this.entries.size) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  close() {
    clearTimeout(this.timer);
    this.timer = undefined;
    for (const id of this.entries.keys()) this.discard(id);
  }
}

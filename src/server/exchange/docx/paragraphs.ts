import { createHash } from "node:crypto";
import type { Snapshot } from "../../../shared/documents/model";
import {
  docBlocks,
  paragraphSegments,
  type DocBlock,
  type ParagraphBlock,
} from "../doc-model";

export function paragraphFingerprint(
  snapshot: Snapshot,
  body: any,
  block: ParagraphBlock,
) {
  const p = { ...block.paragraph };
  delete p.startIndex;
  const value = {
    paragraph: p,
    segments: paragraphSegments(body, block).map((s) => ({
      text: s.text,
      style: s.style,
      url: s.url,
      ...(s.drawingId
        ? {
            drawing: (() => {
              const d = snapshot.drawings?.[s.drawingId] ?? {};
              return {
                source: d.pioneerFileSource ?? d.source,
                size: d.docTransform?.size ?? d.transform,
                positionH: d.docTransform?.positionH,
                positionV: d.docTransform?.positionV,
                angle: d.docTransform?.angle,
                layoutType: d.layoutType,
                math: d.pioneerMath,
                note: body.customBlocks?.find(
                  (b: any) => b.blockId === s.drawingId,
                ),
              };
            })(),
          }
        : {}),
    })),
  };
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function recordParagraphFingerprints(snapshot: Snapshot, extras: any) {
  const visit = (body: any) => {
    if (!body) return;
    const walk = (blocks: DocBlock[]) => {
      for (const b of blocks) {
        if (b.kind === "table")
          for (const row of b.rows) for (const cell of row) walk(cell.blocks);
        else if (extras.paragraphs?.[b.paragraph.paragraphId])
          extras.paragraphs[b.paragraph.paragraphId].fingerprint =
            paragraphFingerprint(snapshot, body, b);
      }
    };
    walk(docBlocks(body));
  };
  visit(snapshot.body);
  for (const s of [
    ...Object.values(snapshot.headers ?? {}),
    ...Object.values(snapshot.footers ?? {}),
    ...Object.values(snapshot.notes ?? {}),
  ] as any[])
    visit(s.body);
}

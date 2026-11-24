import { newId } from "../../../shared/id";
import { ServiceError } from "../error";

export function shiftDoc(
  body: any,
  start: number,
  end: number,
  text: string,
  style?: any,
) {
  const stream = body.dataStream;
  const limit = stream.length - 2;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > limit
  )
    throw new ServiceError(400, "Position is outside the document");
  const delta = text.length - (end - start);
  const map = (i: number) =>
    i <= start ? i : i >= end ? i + delta : start + text.length;
  body.dataStream = stream.slice(0, start) + text + stream.slice(end);
  body.textRuns = (body.textRuns ?? []).flatMap((run: any) => {
    const result = [];
    if (run.st < start) result.push({ ...run, ed: Math.min(run.ed, start) });
    if (run.ed > end)
      result.push({
        ...run,
        st: Math.max(run.st, end) + delta,
        ed: run.ed + delta,
      });
    return result.filter((x) => x.ed > x.st);
  });
  if (text.length && style)
    body.textRuns.push({ st: start, ed: start + text.length, ts: style });
  body.textRuns.sort((a: any, b: any) => a.st - b.st);
  const existing = new Map(
    (body.paragraphs ?? [])
      .filter((p: any) => p.startIndex < start || p.startIndex >= end)
      .map((p: any) => [map(p.startIndex), p]),
  );
  body.paragraphs = [];
  for (let i = 0; i < body.dataStream.length; i++)
    if (body.dataStream[i] === "\r")
      body.paragraphs.push({
        ...(existing.get(i) as any),
        startIndex: i,
        paragraphId: (existing.get(i) as any)?.paragraphId ?? newId(),
      });
  for (const key of [
    "customRanges",
    "customBlocks",
    "sectionBreaks",
    "tables",
    "customDecorations",
  ])
    if (body[key])
      body[key] = body[key].map((x: any) => ({
        ...x,
        ...("startIndex" in x
          ? {
              startIndex:
                start === end &&
                x.startIndex === start &&
                ["tables", "customBlocks", "sectionBreaks"].includes(key)
                  ? start + text.length
                  : map(x.startIndex),
            }
          : {}),
        ...("endIndex" in x ? { endIndex: map(x.endIndex) } : {}),
      }));
}

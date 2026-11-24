import type { Snapshot } from "./model";

export function resolveSheetId(s: Snapshot, selector?: string): string {
  const id = selector?.startsWith("id:")
    ? selector.slice(3)
    : selector?.startsWith("index:")
      ? s.sheetOrder[Number(selector.slice(6))]
      : selector && s.sheets[selector]
        ? selector
        : selector
          ? s.sheetOrder.find(
              (id: string) =>
                s.sheets[id].name === selector.replace(/^name:/, ""),
            )
          : s.sheetOrder[0];
  if (!id || !s.sheets[id]) throw new Error("WORKSHEET_NOT_FOUND");
  return id;
}

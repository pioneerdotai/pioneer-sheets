import type { Kind, Snapshot } from "./model";

/** A Doc's drawings belong to its unit. Imports/clones/runtime replacements have
 * a new unit ID, unlike Sheets where subUnitId denotes a worksheet. */
export function retargetUnit(
  input: Snapshot,
  id: string,
  kind: Kind,
): Snapshot {
  const data = structuredClone(input),
    oldId = data.id;
  data.id = id;
  const visit = (value: any) => {
    if (!value || typeof value !== "object") return;
    for (const key of Object.keys(value)) {
      if (key === "unitId" && (kind === "doc" || value[key] === oldId))
        value[key] = id;
      else if (kind === "doc" && key === "subUnitId") value[key] = id;
      else visit(value[key]);
    }
  };
  visit(data);
  for (const resource of data.resources ?? [])
    if (resource.name !== "PIONEER_FONT_BUNDLE")
      try {
        const parsed = JSON.parse(resource.data);
        visit(parsed);
        resource.data = JSON.stringify(parsed);
      } catch {}
  if (kind === "doc" && data.drawings) {
    data.drawingsOrder ??= Object.keys(data.drawings);
    data.resources ??= [];
    const resource = {
      name: "DOC_DRAWING_PLUGIN",
      data: JSON.stringify({ data: data.drawings, order: data.drawingsOrder }),
    };
    const index = data.resources.findIndex(
      (r: any) => r.name === resource.name,
    );
    if (index < 0) data.resources.push(resource);
    else data.resources[index] = resource;
  }
  return data;
}

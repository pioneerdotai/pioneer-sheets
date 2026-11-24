import { xmlPart, descendants, attr, esc, putXml } from "../package";
import type { WriteContext } from "./write-context";

export function addRel(
  context: Pick<
    WriteContext,
    "relationshipsByPart" | "originalParts" | "serial"
  >,
  part: string,
  type: string,
  target: string,
  external = false,
) {
  let list = context.relationshipsByPart.get(part);
  if (!list) {
    list = [];
    const relPath =
      part === "_root"
        ? "_rels/.rels"
        : part.replace(/([^/]+)$/, "_rels/$1.rels");
    if (context.originalParts[relPath])
      for (const node of descendants(
        xmlPart(context.originalParts, relPath),
        "Relationship",
      ))
        list.push({
          Id: attr(node, "Id")!,
          Type: attr(node, "Type")!,
          Target: attr(node, "Target")!,
          ...(attr(node, "TargetMode")
            ? { TargetMode: attr(node, "TargetMode") }
            : {}),
        });
    context.relationshipsByPart.set(part, list);
  }
  const existing = list.find(
    (r) =>
      r.Type === type && r.Target === target && !!r.TargetMode === external,
  );
  if (existing) return existing.Id;
  let Id = "rIdPioneer" + ++context.serial;
  while (list.some((r) => r.Id === Id)) Id = "rIdPioneer" + ++context.serial;
  list.push({
    Id,
    Type: type,
    Target: target,
    ...(external ? { TargetMode: "External" } : {}),
  });
  return Id;
}

export function writeRelationships(
  context: Pick<WriteContext, "relationshipsByPart" | "parts">,
  part: string,
) {
  const rels = context.relationshipsByPart.get(part);
  if (!rels) return;
  putXml(
    context.parts,
    part.replace(/([^/]+)$/, "_rels/$1.rels"),
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      rels
        .map(
          (r) =>
            '<Relationship Id="' +
            esc(r.Id) +
            '" Type="' +
            esc(r.Type) +
            '" Target="' +
            esc(r.Target) +
            '"' +
            (r.TargetMode ? ' TargetMode="External"' : "") +
            "/>",
        )
        .join("") +
      "</Relationships>",
  );
}

import type { Snapshot } from "../../shared/documents/model";

const loaded = new Map<string, Promise<void>>();

export function fontBundleKey(data: Snapshot) {
  return (data.resources ?? []).find(
    (r: any) => r.name === "PIONEER_FONT_BUNDLE",
  )?.data as string | undefined;
}

export async function loadDocumentFonts(data: Snapshot) {
  const key = fontBundleKey(data);
  if (!key) return;
  let ready = loaded.get(key);
  if (!ready) {
    ready = (async () => {
      const bundle = JSON.parse(key);
      if (!Array.isArray(bundle.faces) || bundle.faces.length > 32)
        throw new Error("INVALID_FONT_BUNDLE");
      for (const face of bundle.faces) {
        if (
          typeof face.data !== "string" ||
          face.data.length > 28_000_000 ||
          typeof face.family !== "string"
        )
          throw new Error("INVALID_FONT_BUNDLE");
        const binary = Uint8Array.from(atob(face.data), (c) => c.charCodeAt(0));
        const font = await new FontFace(face.family, binary, {
          weight: face.weight ?? "normal",
          style: face.style ?? "normal",
        }).load();
        document.fonts.add(font);
      }
    })();
    loaded.set(key, ready);
  }
  await ready;
}

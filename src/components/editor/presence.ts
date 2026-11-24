import { equal, resolveSelection } from "../../shared/documents/model";
import { identityPresentation, subscribeProfiles } from "../../client/pioneer/profiles";
import type { OfficeClient } from "../../client/documents";
import type { createEngine } from "./engine";

/** Redraw peer overlays on presence/viewport changes, at most once per frame. */
export function createPresence(
  runtime: ReturnType<typeof createEngine>,
  client: OfficeClient,
  host: HTMLElement,
  overlay: HTMLElement,
) {
  let frame = 0;
  let highlights: any[] = [];
  let drawn: unknown;
  const clear = () => {
    for (const highlight of highlights) highlight.dispose?.();
    highlights = [];
    overlay.replaceChildren();
    drawn = undefined;
  };
  const draw = () => {
    frame = 0;
    const peers = client.members.filter(
      (peer) => peer.id !== client.who.id || peer.type !== client.who.type,
    );
    const marks: any[] = [];
    if (peers.length) {
      const bounds = host.getBoundingClientRect();
      const book = runtime.univerAPI.getActiveWorkbook();
      for (const peer of peers) {
        const selection = resolveSelection(client.doc, peer.selection);
        if (!selection?.range) continue;
        try {
          const sheet = book?.getSheetBySheetId(selection.sheetId);
          if (
            !sheet ||
            book!.getActiveSheet().getSheetId() !== sheet.getSheetId()
          )
            continue;
          const rect = runtime.cellRect(sheet, sheet.getRange(selection.range));
          if (!rect) continue;
          marks.push({
            connectionId: peer.connectionId,
            ...identityPresentation(peer),
            color: peer.color,
            sheetId: selection.sheetId,
            range: selection.range,
            x: Math.max(0, rect.x - bounds.x),
            y: Math.max(16, rect.y - bounds.y) - 16,
          });
        } catch {}
      }
    }
    if (equal(drawn, marks)) return;
    clear();
    drawn = marks;
    for (const mark of marks) {
      try {
        const sheet = runtime.univerAPI
          .getActiveWorkbook()!
          .getSheetBySheetId(mark.sheetId)!;
        highlights.push(
          sheet.getRange(mark.range).highlight({
            stroke: mark.color,
            fill: mark.color + "18",
            strokeWidth: 2,
          }),
        );
        const label = document.createElement("span");
        label.className = "peer-cursor";
        label.textContent = mark.label;
        if (mark.avatarUrl) {
          const image = document.createElement("img");
          image.alt = "";
          image.addEventListener("error", () => image.remove(), { once: true });
          image.src = mark.avatarUrl;
          label.prepend(image);
        }
        label.style.cssText = `left:${mark.x}px;top:${mark.y}px;background:${mark.color}`;
        overlay.append(label);
      } catch {}
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };
  const unsubscribe = subscribeProfiles(schedule);
  const resize = new ResizeObserver(schedule);
  resize.observe(host);
  host.addEventListener("scroll", schedule, true);
  host.addEventListener("wheel", schedule, { passive: true });
  return {
    clear,
    schedule,
    dispose() {
      cancelAnimationFrame(frame);
      unsubscribe();
      resize.disconnect();
      host.removeEventListener("scroll", schedule, true);
      host.removeEventListener("wheel", schedule);
      clear();
    },
  };
}

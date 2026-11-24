import { retargetUnit } from "../../shared/documents/unit-data";
import { fontBundleKey, loadDocumentFonts } from "./fonts";
import { memo, useEffect, useRef } from "react";
import {
  ICommandService,
  CommandType,
  LifecycleService,
  LifecycleStages,
} from "@univerjs/core";
import { createEngine } from "./engine";
import { createPresence } from "./presence";
import { preserveView, cellChanges } from "./snapshot";
import { SetRangeValuesMutation } from "@univerjs/sheets";
import { sameContent, documentStructure } from "../../shared/documents/content";
import { appConfig } from "../../app-config";
import {
  equal,
  snapshot,
  resolveSelection,
  type Snapshot,
} from "../../shared/documents/model";
import type { OfficeClient } from "../../client/documents";

function Editor({
  client,
  onError,
}: {
  client: OfficeClient;
  onError: (message: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let runtime: ReturnType<typeof createEngine> | undefined;
    let applied: Snapshot | undefined;
    let nativeBaseline: Snapshot | undefined;
    let disposed = false;
    let suppress = false;
    let captureQueued = false;
    let captureTimer: ReturnType<typeof setTimeout> | undefined;
    let selectionFrame = 0;
    let presence: ReturnType<typeof createPresence> | undefined;
    let selection: any;
    const axisEdits: any[] = [];
    const container = document.createElement("div");
    container.className = "univer-container";
    host.current!.append(container);
    const getUnit = () => runtime?.univerAPI.getActiveWorkbook();
    function readSelection() {
      try {
        const api: any = runtime!.univerAPI;
        const book = api.getActiveWorkbook();
        const sheet = book?.getActiveSheet();
        const range = sheet?.getActiveRange();
        return range
          ? { sheetId: sheet.getSheetId(), range: range.getA1Notation() }
          : undefined;
      } catch {
        return selection;
      }
    }
    let permissionUnit: any, permissionEnabled: boolean | undefined;
    function setEditable(enabled: boolean) {
      if (!runtime) return;
      const unit: any = getUnit();
      if (!unit) return;
      const model = unit.getWorkbook();
      const allowed = enabled && client.editorReady;
      if (permissionUnit === model && permissionEnabled === allowed) return;
      permissionUnit = model;
      permissionEnabled = allowed;
      unit.setEditable(allowed);
    }
    function capture() {
      clearTimeout(captureTimer);
      captureTimer = undefined;
      if (!captureQueued) return;
      captureQueued = false;
      if (suppress || !runtime || !applied || disposed) return;
      try {
        const unit: any = getUnit();
        if (!unit) return;
        const next = unit.save();
        preserveView(nativeBaseline ?? applied, next);
        if (nativeBaseline) {
          const resources = new Map(
            (nativeBaseline.resources ?? []).map((r: any) => [r.name, r]),
          );
          for (const r of applied.resources ?? [])
            if (r.name.startsWith("PIONEER_")) resources.set(r.name, r);
          nativeBaseline.resources = [...resources.values()].sort(
            (a: any, b: any) => a.name.localeCompare(b.name),
          );
        }
        const custom = new Map(
          (applied.resources ?? [])
            .filter((r: any) => r.name.startsWith("PIONEER_"))
            .map((r: any) => [r.name, r]),
        );
        for (const resource of next.resources ?? [])
          custom.set(resource.name, resource);
        next.resources = [...custom.values()].sort((a: any, b: any) =>
          a.name.localeCompare(b.name),
        );
        next.id = client.id;
        if (!equal(nativeBaseline ?? applied, next)) {
          if (axisEdits.length) next.$axisEdits = axisEdits.splice(0);
          client.apply(
            nativeBaseline ?? applied,
            next,
            client.editorReady && !sameContent(nativeBaseline ?? applied, next),
          );
          delete next.$axisEdits;
          applied = snapshot(client.doc);
          nativeBaseline = next;
        }
        publishSelection();
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      }
    }
    function publishSelection() {
      selection = client.setSelection(readSelection());
    }
    function queueSelection() {
      if (selectionFrame) return;
      selectionFrame = requestAnimationFrame(() => {
        selectionFrame = 0;
        if (!disposed) publishSelection();
      });
    }
    async function start() {
      if (disposed) return;
      runtime = createEngine(container);
      presence = createPresence(
        runtime,
        client,
        host.current!,
        overlay.current!,
      );
      client.onPresence = presence.schedule;
      const commands = runtime.univer.__getInjector().get(ICommandService);
      const listener = commands.onCommandExecuted((event: any, options) => {
        if (options?.onlyLocal || options?.fromCollab) return;
        if (
          !suppress &&
          /^sheet\.mutation\.(insert-row|insert-col|remove-rows|remove-col)$/.test(
            event.id,
          )
        ) {
          const p = event.params;
          const row = event.id.includes("row");
          if (p?.range)
            axisEdits.push({
              sheetId: p.subUnitId,
              axis: row ? "row" : "column",
              index: row ? p.range.startRow : p.range.startColumn,
              count:
                (row
                  ? p.range.endRow - p.range.startRow
                  : p.range.endColumn - p.range.startColumn) + 1,
              remove: event.id.includes("remove"),
            });
        }
        if (suppress) return;
        if (
          event.type === CommandType.MUTATION &&
          !event.id.startsWith("formula.mutation.")
        ) {
          captureQueued = true;
          captureTimer ??= setTimeout(capture, 120);
        }
        queueSelection();
        presence?.schedule();
      });
      cleanup.push(() => listener.dispose());
      const api: any = runtime.univerAPI;
      const undoListener = api.addEvent(
        api.Event.BeforeCommandExecute,
        (event: any) => {
          if (
            !suppress &&
            ["univer.command.undo", "univer.command.redo"].includes(event.id)
          ) {
            event.cancel = true;
            capture();
            if (event.id.endsWith("undo")) client.undoEdit();
            else client.redoEdit();
          }
        },
      );
      cleanup.push(() => undoListener.dispose());
      client.beforeRemote = capture;
      client.beforeFlush = async () => {
        if (!client.editorReady)
          throw new Error("The editor is still starting");
        await runtime?.univerAPI.getActiveWorkbook()?.endEditingAsync(true);
        capture();
      };
      client.onRole = () =>
        setEditable(client.role !== "viewer" && client.connected);
      client.onSnapshot = render;
      const value = snapshot(client.doc);
      if (value.id) render(value);
      client.connect();
      void runtime.univer
        .__getInjector()
        .get(LifecycleService)
        .onStage(LifecycleStages.Rendered)
        .then(() => {
          if (disposed) return;
          captureQueued = true;
          capture();
          client.undo.stopCapturing();
          client.editorReady = true;
          client.onRole?.();
          client.onStatus?.();
        })
        .catch((error) => {
          if (!disposed) onError(String(error));
        });
      container.addEventListener("pointerup", queueSelection);
      container.addEventListener("keyup", queueSelection);
      cleanup.push(() => {
        container.removeEventListener("pointerup", queueSelection);
        container.removeEventListener("keyup", queueSelection);
      });
    }
    let loadedFontBundle: string | undefined,
      fontPending = false;
    function render(value: Snapshot) {
      const fontKey = fontBundleKey(value);
      if (fontKey && fontKey !== loadedFontBundle) {
        if (!fontPending) {
          fontPending = true;
          void loadDocumentFonts(value)
            .then(() => {
              fontPending = false;
              loadedFontBundle = fontKey;
              render(snapshot(client.doc));
            })
            .catch((e) => {
              fontPending = false;
              onError(String(e));
            });
        }
        return;
      }
      if (!runtime || disposed) return;
      if (captureQueued) capture();
      const api: any = runtime.univerAPI;
      selection = resolveSelection(client.doc, selection ?? readSelection());
      suppress = true;
      setEditable(true);
      presence?.clear();
      try {
        const old: any = getUnit();
        // Apply ordinary remote edits in place. This preserves the active input,
        // IME, scroll and toolbar rather than recreating the editor per keystroke.
        if (old && applied) {
          if (equal(documentStructure(applied), documentStructure(value))) {
            for (const id of value.sheetOrder) {
              const a = applied.sheets[id].cellData ?? {},
                b = value.sheets[id].cellData ?? {};
              const changes = cellChanges(a, b);
              if (Object.keys(changes).length)
                runtime.univer
                  .__getInjector()
                  .get(ICommandService)
                  .syncExecuteCommand(
                    SetRangeValuesMutation.id,
                    {
                      unitId: old.getId(),
                      subUnitId: id,
                      cellValue: changes,
                      isOverrideStyle: true,
                    },
                    { fromCollab: true },
                  );
            }
            applied = structuredClone(value);
            nativeBaseline = getUnit()?.save() as Snapshot;
            presence?.schedule();
            return;
          }
        }

        const next: any = retargetUnit(value, client.id, appConfig.kind);
        if (old) {
          preserveView(old.getWorkbook().getSnapshot(), next);
          api.disposeUnit(old.getId());
        }
        const book = api.createWorkbook(next);
        if (selection?.sheetId) {
          const sheet = book.getSheetBySheetId(selection.sheetId);
          if (sheet) {
            book.setActiveSheet(sheet);
            if (selection.range)
              sheet.setActiveRange(sheet.getRange(selection.range));
          }
        }
        applied = structuredClone(value);
        nativeBaseline = getUnit()?.save() as Snapshot;
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      } finally {
        setEditable(client.role !== "viewer" && client.connected);
        suppress = false;
      }
      presence?.schedule();
    }
    const cleanup: Array<() => void> = [];
    void start().catch((error) => onError(String(error)));
    const key = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        ["z", "y"].includes(e.key.toLowerCase())
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.key.toLowerCase() === "y" || e.shiftKey) client.redoEdit();
        else client.undoEdit();
      }
    };
    container.addEventListener("keydown", key, true);
    return () => {
      capture();
      disposed = true;
      client.onSnapshot = undefined;
      client.beforeRemote = undefined;
      client.onRole = undefined;
      client.beforeFlush = undefined;
      clearTimeout(captureTimer);
      cancelAnimationFrame(selectionFrame);
      client.onPresence = undefined;
      presence?.dispose();
      cleanup.forEach((f) => f());
      container.removeEventListener("keydown", key, true);
      queueMicrotask(() => {
        runtime?.dispose();
        container.remove();
      });
    };
  }, [client]);
  return (
    <div className="editor-host" ref={host} aria-label="Editor">
      <div ref={overlay} className="presence-overlay" />
    </div>
  );
}

export default memo(Editor);

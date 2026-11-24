import { embeddedImageSize } from "./image";
import { inspectSnapshot } from "./inspection";
import { HeadlessDocument } from "./headless";
import { executeFacade } from "./execution";
import { equal } from "../../shared/documents/model";

let document: HeadlessDocument | undefined;

class ResourceBindings {
  constructor(
    private _items: Record<string, { mimeType: string; base64: string }>,
  ) {}
  private _get(id: string) {
    const item = this._items[id];
    if (!item) throw new Error("RESOURCE_NOT_BOUND");
    return item;
  }
  text(id: string) {
    return Buffer.from(this._get(id).base64, "base64").toString("utf8");
  }
  json(id: string) {
    return JSON.parse(this.text(id));
  }
  size(id: string) {
    return embeddedImageSize(this.image(id));
  }
  base64(id: string) {
    return this._get(id).base64;
  }
  image(id: string) {
    const item = this._get(id);
    if (!/^image\/(png|jpeg|webp|gif)$/.test(item.mimeType))
      throw new Error("RASTER_IMAGE_REQUIRED");
    return "data:" + item.mimeType + ";base64," + item.base64;
  }
}

process.on("message", async (message: any) => {
  const { id, method, input } = message;
  try {
    let result: any;
    if (method === "load") {
      if (document && document.kind !== input.kind) {
        document.close();
        document = undefined;
      }
      document ??= new HeadlessDocument(input.kind);
      await document.load(input.snapshot);
      result = { snapshot: document.save() };
    } else if (method === "export") {
      if (!document) throw new Error("RUNTIME_NOT_LOADED");
      result = { snapshot: document.save() };
    } else if (method === "capabilities") {
      if (!document) throw new Error("RUNTIME_NOT_LOADED");
      const methods = (object: any) => {
        const names = new Set<string>();
        for (
          let p = object;
          p && p !== Object.prototype;
          p = Object.getPrototypeOf(p)
        )
          for (const key of Object.getOwnPropertyNames(p))
            if (!key.startsWith("_") && key !== "constructor") {
              const descriptor = Object.getOwnPropertyDescriptor(p, key);
              if (typeof descriptor?.value === "function") names.add(key);
            }
        return [...names].sort();
      };
      result = {
        sdkVersion: "1.5.0",
        kind: document.kind,
        bindings: {
          univerAPI: methods(document.api),
          [document.kind === "sheet" ? "workbook" : "document"]: methods(
            document.unit,
          ),
        },
        execution: {
          engine: "QuickJS WASM",
          host: "isolated Node child",
          modes: ["read", "write"],
          manualCommit: true,
          codeLimit: 200000,
          resourceBytesLimit: 20000000,
          resultLimit: 2000000,
          timeoutMs: 30000,
          wasmHeapBytes: 67108864,
        },
        scope: {
          unitId: document.unit.getId(),
          foreignUnits: false,
          lifecycle: "write-only same target ID and kind",
          resourceAccess: "explicit owned resourceIds only",
        },
        uiApis: false,
      };
      if (document.kind === "sheet") {
        result.bindings.worksheet = methods(document.unit.getActiveSheet());
        result.bindings.range = methods(
          document.unit.getActiveSheet().getRange("A1"),
        );
      }
    } else if (method === "inspect") {
      if (!document) throw new Error("RUNTIME_NOT_LOADED");
      result = inspectSnapshot(document.save(), document.kind, input);
    } else if (method === "execute") {
      if (!document) throw new Error("RUNTIME_NOT_LOADED");
      const before = document.save();
      document.mode = input.mode;
      document.mutations = [];
      document.axes = [];
      try {
        const value = await executeFacade(
          {
            univerAPI: document.api,
            workbook: document.kind === "sheet" ? document.unit : undefined,
            document: document.kind === "doc" ? document.unit : undefined,
            resources: new ResourceBindings(input.resources ?? {}),
          },
          input.code,
          input.timeoutMs,
          {
            before: () => {
              document!.facadeScope++;
            },
            after: () => {
              document!.facadeScope--;
            },
            scope: { mode: input.mode, kind: document.kind, unitId: before.id },
            replaced: (unit, data) => {
              document!.unit = unit;
              document!.loaded = structuredClone(data);
              document!.mutations.push("agent.replace-unit");
            },
          },
        );
        if (input.mode === "write") {
          const active =
            document.kind === "sheet"
              ? document.api.getActiveWorkbook()
              : document.api.getActiveDocument();
          if (!active || active.getId() !== before.id)
            throw new Error(
              "SCOPE_VIOLATION: execution must retain its bound document",
            );
          document.unit = active;
          document.mode = "internal";
          await document.calculate();
        }
        const after = document.save();
        if (input.mode === "read" && !equal(before, after))
          throw new Error("READ_ONLY: content changed during read execution");
        if (document.axes.length) after.$axisEdits = document.axes;
        result = {
          value: value ?? null,
          snapshot: after,
          mutations: document.mutations,
          changed: !equal(before, after),
        };
      } catch (error) {
        document.unit = undefined;
        const active =
          document.kind === "sheet"
            ? document.api.getActiveWorkbook()
            : document.api.getActiveDocument();
        if (active) document.api.disposeUnit(active.getId());
        await document.load(before);
        throw error;
      } finally {
        document.mode = "internal";
      }
    } else if (method === "close") {
      document?.close();
      document = undefined;
      result = { closed: true };
    } else throw new Error("UNKNOWN_WORKER_METHOD");
    process.send?.({ id, result });
  } catch (error) {
    process.send?.({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

process.on("disconnect", () => {
  document?.close();
  process.exit(0);
});

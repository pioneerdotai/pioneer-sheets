import { retargetUnit } from "../../shared/documents/unit-data";
import { getQuickJS } from "quickjs-emscripten";

/**
 * Agent source runs in QuickJS WASM, never node:vm/eval in the host process.
 * Only public Facade objects cross the bridge. Node globals, modules, filesystem,
 * sockets, object internals and prototype constructors are not exposed.
 */
export async function executeFacade(
  bindings: Record<string, any>,
  code: string,
  timeoutMs = 10000,
  hooks?: {
    before: () => void;
    after: () => void;
    scope?: { mode: "read" | "write"; kind: "doc" | "sheet"; unitId: string };
    replaced?: (unit: any, data: any) => void;
  },
) {
  if (typeof code !== "string" || code.length > 200000)
    throw new Error("INVALID_CODE");
  const module = await getQuickJS(),
    runtime = module.newRuntime();
  runtime.setMemoryLimit(64 * 1024 * 1024);
  runtime.setMaxStackSize(1024 * 1024);
  const deadline = Date.now() + Math.min(30000, Math.max(50, timeoutMs));
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const context = runtime.newContext(),
    objects = new Map<number, any>(),
    ids = new WeakMap<object, number>();
  let nextId = 0,
    pendingId = 0,
    alive = true;
  const subscriptions: any[] = [];
  const jobs = new Set<Promise<void>>();
  const forbidden = (key: string) =>
    key.startsWith("_") ||
    ["constructor", "prototype", "getUniver", "getInjector"].includes(key);
  function jsonData(value: any, seen = new Set<any>()): boolean {
    if (
      value === undefined ||
      value === null ||
      ["string", "number", "boolean"].includes(typeof value)
    )
      return true;
    if (
      typeof value !== "object" ||
      seen.has(value) ||
      (!Array.isArray(value) &&
        ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    )
      return false;
    seen.add(value);
    const result = Object.values(value).every((v) => jsonData(v, seen));
    seen.delete(value);
    return result;
  }
  function pack(value: any): any {
    if (value === undefined) return { t: "undefined" };
    if (
      value === null ||
      ["string", "number", "boolean"].includes(typeof value)
    )
      return { t: "value", value };
    if (typeof value === "bigint") return { t: "value", value: String(value) };
    if (value instanceof Promise) {
      const id = ++pendingId;
      const job = Promise.resolve(value)
        .then(
          (result) => settle(id, true, pack(result)),
          (error) => settle(id, false, String(error?.message ?? error)),
        )
        .finally(() => jobs.delete(job));
      jobs.add(job);
      return { t: "promise", id };
    }
    if (Array.isArray(value)) return { t: "array", value: value.map(pack) };
    if (
      typeof value === "object" &&
      (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null)
    )
      return {
        t: "object",
        value: Object.fromEntries(
          Object.entries(value)
            .filter(
              ([key]) =>
                !forbidden(key) ||
                (!["constructor", "prototype", "__proto__"].includes(key) &&
                  jsonData(value)),
            )
            .map(([k, v]) => [k, pack(v)]),
        ),
      };
    if (typeof value === "function")
      throw new Error("Unsupported standalone host function");
    let id = ids.get(value);
    if (!id) {
      id = ++nextId;
      ids.set(value, id);
      objects.set(id, value);
    }
    return { t: "reference", id };
  }
  function unpack(value: any): any {
    if (value?.t === "reference") return objects.get(value.id);
    if (value?.t === "callback")
      return (...args: any[]) => {
        if (!alive) return;
        const result = context.evalCode(
          "__invokeCallback(" +
            value.id +
            "," +
            JSON.stringify(pack(args)) +
            ")",
        );
        try {
          if (result.error) throw new Error(String(context.dump(result.error)));
          return unpack(JSON.parse(context.getString(result.value)));
        } finally {
          result.dispose();
        }
      };
    if (value?.t === "array") return value.value.map(unpack);
    if (value?.t === "object")
      return Object.fromEntries(
        Object.entries(value.value).map(([k, v]) => [k, unpack(v)]),
      );
    return value?.value;
  }
  function settle(id: number, ok: boolean, value: any) {
    if (!alive) return;
    const result = context.evalCode(
      "__settle(" +
        id +
        "," +
        JSON.stringify(ok) +
        "," +
        JSON.stringify(value) +
        ")",
    );
    if (result.error) {
      const message = String(context.dump(result.error));
      result.dispose();
      throw new Error(message);
    }
    result.dispose();
  }
  function expose(name: string, fn: (...args: any[]) => any) {
    const handle = context.newFunction(name, (...args) => {
      try {
        return context.newString(
          JSON.stringify(fn(...args.map((x) => context.getString(x)))),
        );
      } catch (e) {
        throw new Error(e instanceof Error ? e.message : String(e));
      }
    });
    context.setProp(context.global, name, handle);
    handle.dispose();
  }
  expose("__hostGet", (id, key) => {
    if (forbidden(key)) throw new Error("PRIVATE_API: " + key);
    const object = objects.get(Number(id));
    if (!object) throw new Error("Invalid Facade handle");
    const value = object[key];
    return typeof value === "function"
      ? { t: "method", id: Number(id), key }
      : pack(value);
  });
  expose("__hostCall", (id, key, args) => {
    if (forbidden(key)) throw new Error("PRIVATE_API: " + key);
    if (key === "dispose")
      throw new Error(
        "SCOPE_VIOLATION: close resources through their owning runtime",
      );
    const object = objects.get(Number(id));
    if (!object || typeof object[key] !== "function")
      throw new Error("Unknown Facade method: " + key);
    const argumentsValue = unpack(JSON.parse(args));
    const lifecycle =
      object === bindings.univerAPI &&
      [
        "createWorkbook",
        "createDocument",
        "createUnit",
        "disposeUnit",
      ].includes(key);
    if (lifecycle) {
      const scope = hooks?.scope,
        creation = key === "createWorkbook" || key === "createDocument";
      if (
        !scope ||
        scope.mode !== "write" ||
        key === "createUnit" ||
        (key === "disposeUnit"
          ? argumentsValue[0] !== scope.unitId
          : !creation ||
            argumentsValue[0]?.id !== scope.unitId ||
            (key === "createWorkbook") !== (scope.kind === "sheet"))
      )
        throw new Error(
          "SCOPE_VIOLATION: lifecycle operations require write mode and the exact bound target ID/kind",
        );
    }
    if (lifecycle && key === "createDocument")
      argumentsValue[0] = retargetUnit(
        argumentsValue[0],
        argumentsValue[0].id,
        "doc",
      );
    hooks?.before();
    try {
      const value = object[key](...argumentsValue);
      if (value?.dispose && /^(addEvent|on|before|calculation)/.test(key))
        subscriptions.push(value);
      if (lifecycle && key !== "disposeUnit")
        hooks?.replaced?.(value, argumentsValue[0]);
      return pack(value);
    } finally {
      hooks?.after();
    }
  });
  try {
    const prelude = context.evalCode(
      "const __refs=new Map(),__promises=new Map(),__callbacks=new Map();let __callbackId=0;" +
        'function __encode(v){if(v===undefined)return {t:"undefined"};if(v===null||["string","number","boolean"].includes(typeof v))return {t:"value",value:v};if(v&&v.__facadeId)return {t:"reference",id:v.__facadeId};if(typeof v==="function"){const id=++__callbackId;__callbacks.set(id,v);return {t:"callback",id};}if(Array.isArray(v))return {t:"array",value:v.map(__encode)};return {t:"object",value:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,__encode(x)]))};}' +
        'function __decode(v){if(v.t==="undefined")return undefined;if(v.t==="value")return v.value;if(v.t==="array")return v.value.map(__decode);if(v.t==="object")return Object.fromEntries(Object.entries(v.value).map(([k,x])=>[k,__decode(x)]));if(v.t==="method")return (...args)=>__decode(JSON.parse(__hostCall(String(v.id),v.key,JSON.stringify(__encode(args)))));if(v.t==="promise")return new Promise((resolve,reject)=>__promises.set(v.id,{resolve,reject}));if(!__refs.has(v.id))__refs.set(v.id,new Proxy(Object.create(null),{get(_,key){if(key==="then")return undefined;if(key==="__facadeId")return v.id;if(typeof key!=="string")return undefined;return __decode(JSON.parse(__hostGet(String(v.id),key)));},set(){throw new Error("Use Facade methods rather than assigning properties");}}));return __refs.get(v.id);}' +
        "function __settle(id,ok,value){const p=__promises.get(id);if(p){__promises.delete(id);if(ok)p.resolve(__decode(value));else p.reject(new Error(value));}}" +
        "function __invokeCallback(id,args){return JSON.stringify(__encode(__callbacks.get(id)(...__decode(args))));}" +
        Object.entries(bindings)
          .map(
            ([name, value]) =>
              "const " +
              name +
              "=__decode(" +
              JSON.stringify(pack(value)) +
              ");",
          )
          .join(""),
    );
    if (prelude.error) {
      const e = context.dump(prelude.error);
      prelude.dispose();
      throw new Error(JSON.stringify(e));
    }
    prelude.dispose();
    const result = context.evalCode(
      "globalThis.__executionDone=false;globalThis.__executionError=null;globalThis.__executionOutput=null;(async function(){" +
        code +
        "\n})().then(value=>{try{__executionOutput=JSON.stringify(value===undefined?null:value);}catch(error){__executionError=String(error.message||error);}__executionDone=true;},error=>{__executionError=String(error.message||error);__executionDone=true;});",
    );
    if (result.error) {
      const error = context.dump(result.error);
      result.dispose();
      throw new Error(error?.message ?? String(error));
    }
    result.dispose();
    while (true) {
      if (Date.now() > deadline) throw new Error("EXECUTION_TIMEOUT");
      const pending = runtime.executePendingJobs();
      if (pending.error) {
        const e = context.dump(pending.error);
        pending.dispose();
        throw new Error(e?.message ?? String(e));
      }
      pending.dispose();
      const done = context.getProp(context.global, "__executionDone");
      const finished = context.dump(done);
      done.dispose();
      if (finished && jobs.size === 0) break;
      await new Promise((r) => setTimeout(r, 1));
    }
    const errorHandle = context.getProp(context.global, "__executionError");
    const error = context.dump(errorHandle);
    errorHandle.dispose();
    if (error) throw new Error(error);
    const outputHandle = context.getProp(context.global, "__executionOutput");
    const serialized = context.dump(outputHandle);
    outputHandle.dispose();
    if (typeof serialized !== "string" || serialized.length > 2_000_000)
      throw new Error("RESULT_TOO_LARGE: narrow the query");
    const output = JSON.parse(serialized);

    return output;
  } finally {
    alive = false;
    for (const subscription of subscriptions)
      try {
        subscription.dispose();
      } catch {}
    context.dispose();
    runtime.dispose();
  }
}

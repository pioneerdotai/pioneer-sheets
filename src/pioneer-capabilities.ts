// Univer probes for IndexedDB during module evaluation. Opaque App documents
// expose the factory even though opening a database is forbidden. Advertise
// that capability as unavailable before lazy editor modules load. Preferences
// use the injected in-memory service; documents are always stored by the backend.
if (typeof window !== "undefined" && window.origin === "null")
  Object.defineProperty(window, "indexedDB", {
    value: undefined,
    configurable: true,
  });

import type { ILocalStorageService } from "@univerjs/core";

/** Per-view editor preferences only. No browser storage or authentication data. */
export function editorPreferences(): ILocalStorageService {
  const items = new Map<string, unknown>();
  return {
    async getItem<T>(key: string) {
      return items.has(key) ? (items.get(key) as T) : null;
    },
    async setItem<T>(key: string, value: T) {
      items.set(key, value);
      return value;
    },
    async removeItem(key) {
      items.delete(key);
    },
    async clear() {
      items.clear();
    },
    async key(index) {
      return [...items.keys()][index] ?? null;
    },
    async keys() {
      return [...items.keys()];
    },
    async iterate<T, U>(fn: (value: T, key: string, index: number) => U) {
      let i = 0;
      for (const [key, value] of items) {
        const result = fn(value as T, key, ++i);
        if (result !== undefined) return result;
      }
      return undefined as U;
    },
  };
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  pageChangeStorageKey,
  pageChangeToken,
  recordPageChange
} from "../apps/web/web/editor-sync.js";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) || null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    }
  };
}

test("page change markers are isolated by slug and locale", () => {
  const english = { slug: "home", locale: "en" };
  const german = { slug: "home", locale: "de" };

  assert.notEqual(pageChangeStorageKey(english), pageChangeStorageKey(german));
  assert.equal(pageChangeStorageKey({}), "");
});

test("recording a page change replaces the builder's observed token", () => {
  const storage = memoryStorage();
  const page = { slug: "services", locale: "en" };

  assert.equal(pageChangeToken(page, storage), "");
  const firstToken = recordPageChange(page, storage);
  assert.equal(pageChangeToken(page, storage), firstToken);

  const secondToken = recordPageChange(page, storage);
  assert.notEqual(secondToken, firstToken);
  assert.equal(pageChangeToken(page, storage), secondToken);
});

test("successful page mutations publish a change marker through the shared API", async () => {
  const storage = memoryStorage();
  const page = { slug: "home", locale: "en", sections: [] };
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

  try {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
      writable: true
    });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { page } })
      }),
      writable: true
    });

    const { api, state } = await import("../apps/web/web/core.js");
    state.apiUrl = "/api/v1";
    await api("/cms/pages/home/blocks/hero", { method: "PATCH", body: "{}" });

    assert.notEqual(pageChangeToken(page, storage), "");
  } finally {
    restoreGlobal("fetch", fetchDescriptor);
    restoreGlobal("localStorage", storageDescriptor);
  }
});

function restoreGlobal(name: "fetch" | "localStorage", descriptor?: PropertyDescriptor) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
    return;
  }

  delete (globalThis as Record<string, unknown>)[name];
}

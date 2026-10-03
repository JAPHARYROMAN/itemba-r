/** Test-only IndexedDB transaction harness: serial writes, rollback and request chaining. */
export function deviceDatabase(rows = new Map<string, unknown>()) {
  let tail: Promise<void> = Promise.resolve();
  let abortNext = false;
  const db = {
    close: () => undefined,
    transaction: () => {
      const before = tail;
      let done: () => void;
      tail = new Promise<void>((resolve) => {
        done = resolve;
      });
      let values: Map<string, unknown>;
      let outstanding = 0;
      let aborted = false;
      let end: ReturnType<typeof setTimeout>;
      const ready = before.then(() => {
        values = new Map(rows);
      });
      const tx = {
        oncomplete: null as null | (() => void),
        onabort: null as null | (() => void),
        onerror: null,
        error: null,
        abort: () => {
          aborted = true;
          setTimeout(() => {
            tx.onabort?.();
            done();
          }, 0);
        },
        objectStore: () => ({
          get: (key: string) => request(() => structuredClone(values.get(key))),
          put: (value: unknown, key: string) =>
            request(() => {
              values.set(key, structuredClone(value));
              return key;
            }),
          delete: (key: string) =>
            request(() => {
              values.delete(key);
            }),
          getAll: () => request(() => structuredClone([...values.values()])),
        }),
      };
      function request(action: () => unknown) {
        outstanding++;
        clearTimeout(end);
        const req = {
          result: undefined as unknown,
          onsuccess: null as null | (() => void),
          onerror: null,
          error: null,
        };
        void ready.then(() => {
          if (aborted) return;
          req.result = action();
          req.onsuccess?.();
          outstanding--;
          if (!outstanding && !aborted)
            end = setTimeout(() => {
              if (abortNext) {
                abortNext = false;
                tx.abort();
                return;
              }
              rows.clear();
              values.forEach((v, k) => rows.set(k, v));
              tx.oncomplete?.();
              done();
            }, 0);
        });
        return req;
      }
      return tx;
    },
  };
  return {
    db: db as unknown as IDBDatabase,
    rows,
    abortNext: () => {
      abortNext = true;
    },
  };
}

export function deviceLocks() {
  const held = new Set<string>();
  const waiting = new Map<string, (() => void)[]>();
  return {
    request: async (
      name: string,
      options: { ifAvailable?: boolean },
      callback: (lock: object | null) => Promise<unknown>,
    ) => {
      if (options.ifAvailable && held.has(name)) return callback(null);
      if (held.has(name))
        await new Promise<void>((resolve) => {
          waiting.set(name, [...(waiting.get(name) ?? []), resolve]);
        });
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
        waiting.get(name)?.shift()?.();
      }
    },
  };
}

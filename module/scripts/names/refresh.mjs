/** One running build and one latest request. Invalidation is synchronous;
 * expensive work starts in a microtask, coalescing a burst without stale output. */
export function createRefreshQueue({invalidate, build}) {
  let generation = 0, pending = false, running, pendingOptions;
  async function drain() {
    try {
      while (pending) {
        pending = false;
        const current = generation;
        const options = pendingOptions;
        pendingOptions = undefined;
        try { await build(() => current === generation, options); }
        catch (error) { if (current === generation) throw error; }
      }
    } finally { running = null; }
  }
  return {
    request(options) {
      generation++; pending = true;
      pendingOptions = options;
      invalidate(options);
      return running ??= Promise.resolve().then(drain);
    },
    stop() { generation++; pending = false; pendingOptions = undefined; }
  };
}

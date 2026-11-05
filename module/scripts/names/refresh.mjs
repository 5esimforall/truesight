/** One running build and one latest request. Invalidation is synchronous;
 * expensive work starts in a microtask, coalescing a burst without stale output. */
export function createRefreshQueue({invalidate, build}) {
  let generation = 0, pending = false, running;
  async function drain() {
    try {
      while (pending) {
        pending = false;
        const current = generation;
        try { await build(() => current === generation); }
        catch (error) { if (current === generation) throw error; }
      }
    } finally { running = null; }
  }
  return {
    request() {
      generation++; pending = true; invalidate();
      return running ??= Promise.resolve().then(drain);
    },
    stop() { generation++; pending = false; }
  };
}

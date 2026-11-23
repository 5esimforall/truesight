/** One running build and one latest request. Invalidation is synchronous;
 * expensive work starts in a microtask or optional debounce timer, coalescing
 * bursts without stale output. */
export function createRefreshQueue({invalidate, build}) {
  let generation = 0, pending = false, immediatePending = false;
  let running = null, pendingOptions, timer = null;
  let delayedPromise = null, delayedResolve = null, delayedReject = null;

  function settleDelayed(run) {
    if (!delayedResolve) return;
    const resolve = delayedResolve, reject = delayedReject;
    delayedPromise = delayedResolve = delayedReject = null;
    if (run) run.then(resolve, reject);
    else resolve();
  }

  async function drain() {
    try {
      while (pending && !timer) {
        pending = false;
        immediatePending = false;
        const current = generation;
        const options = pendingOptions;
        pendingOptions = undefined;
        try { await build(() => current === generation, options); }
        catch (error) { if (current === generation) throw error; }
      }
    } finally { running = null; }
  }

  function startDrain() {
    return running ??= Promise.resolve().then(drain);
  }

  return {
    request(options) {
      generation++;
      pending = true;
      pendingOptions = options;
      const requestedDelay = Number.isFinite(options?.delay) && options.delay > 0 ? options.delay : 0;
      const immediate = requestedDelay === 0 || Boolean(options?.retract) || immediatePending;
      invalidate(options);
      if (immediate) {
        immediatePending = true;
        if (timer) { clearTimeout(timer); timer = null; }
        const run = startDrain();
        settleDelayed(run);
        return run;
      }
      if (!delayedPromise) {
        delayedPromise = new Promise((resolve, reject) => {
          delayedResolve = resolve;
          delayedReject = reject;
        });
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (!pending) { settleDelayed(null); return; }
        settleDelayed(startDrain());
      }, requestedDelay);
      return delayedPromise;
    },
    stop() {
      generation++;
      pending = false;
      immediatePending = false;
      pendingOptions = undefined;
      if (timer) { clearTimeout(timer); timer = null; }
      settleDelayed(null);
    }
  };
}

/** At most one active snapshot read and one queued batch, even during event bursts. */
export function createRefreshQueue(load, onData, onError) {
  let pending = null;
  let running = false;
  let disposed = false;

  async function drain() {
    if (running || disposed || !pending) return;
    const batch = pending;
    pending = null;
    running = true;
    try {
      const result = await load();
      // Reads finish in order. Publish progress even if events keep arriving.
      if (!disposed) onData(result);
    } catch (error) {
      if (!disposed) onError(error);
    } finally {
      running = false;
      batch.resolve();
      if (pending && !disposed) queueMicrotask(drain);
    }
  }

  function request() {
    if (disposed) return Promise.resolve();
    if (!pending) {
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      pending = { promise, resolve };
      if (!running) queueMicrotask(drain);
    }
    // Each caller waits for its batch, not for an endless stream of later events.
    return pending.promise;
  }

  return {
    request,
    dispose() {
      disposed = true;
      pending?.resolve();
      pending = null;
    },
  };
}

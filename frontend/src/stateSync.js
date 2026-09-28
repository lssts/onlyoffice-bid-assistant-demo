// Coalesce event bursts; never overlap reads or apply an old editor's response.
export function createStateSync({read, apply, fail, paused, visible}) {
  let active = false, generation = 0, dirty = false, inFlight = false;
  let debounce = null, poll = null;
  function request() {
    if (!active) return;
    dirty = true;
    if (!debounce && !inFlight) debounce = setTimeout(flush, 100);
  }
  async function flush() {
    debounce = null;
    if (!active || inFlight || paused() || !visible()) return;
    const session = generation;
    dirty = false;
    inFlight = true;
    try {
      const value = await read();
      if (active && session === generation && !dirty && !paused()) apply(value);
    } catch (error) {
      if (active && session === generation && !paused()) fail(error);
    } finally {
      if (session === generation) {
        inFlight = false;
        if (dirty && active && !paused() && visible()) request();
      }
    }
  }
  function stop() {
    active = false;
    generation++;
    dirty = false;
    inFlight = false;
    clearTimeout(debounce);
    clearInterval(poll);
    debounce = poll = null;
  }
  function start() {
    stop();
    active = true;
    poll = setInterval(() => { if (visible()) request(); }, 1500);
    request();
  }
  return {start, stop, request};
}

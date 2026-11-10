import { useEffect, useRef } from "react";
import { create } from "zustand";

// Data kept current without F5: one clock for the whole app ticks when the browser tab / window comes back into view
// and every AUTO_REFRESH_MS while it is in view (never while hidden). Pages reload on a tick silently - the rows stay
// on screen, no "Memuat...".
export const AUTO_REFRESH_MS = 30_000;

const useJam = create<{ tick: number }>(() => ({ tick: 0 }));
let jalan = false;
function mulaiJam() {
  if (jalan) return;
  jalan = true;
  let last = Date.now();
  const run = () => {
    if (document.visibilityState !== "visible") return;
    last = Date.now();
    useJam.setState((s) => ({ tick: s.tick + 1 }));
  };
  // Back to the tab: at once, unless it just ran (focus and visibilitychange often fire together).
  const onShow = () => {
    if (document.visibilityState === "visible" && Date.now() - last > 5_000) run();
  };
  document.addEventListener("visibilitychange", onShow);
  window.addEventListener("focus", onShow);
  setInterval(run, AUTO_REFRESH_MS);
}

// The clock's tick, to put in the deps of an effect that loads data (with useTickDiam to load it silently).
export function useRefreshTick() {
  useEffect(mulaiJam, []);
  return useJam((s) => s.tick);
}

// In an effect that depends on tick: true when this run is the clock's (load silently), false when something else
// changed (a filter, a save - show Memuat... as usual).
export function useTickDiam(tick: number) {
  const last = useRef(tick);
  return () => {
    const diam = tick !== last.current;
    last.current = tick;
    return diam;
  };
}

// Run refresh() on every tick of the clock (not on the first render).
export function useAutoRefresh(refresh: () => void) {
  const tick = useRefreshTick();
  const ref = useRef(refresh);
  ref.current = refresh;
  const seen = useRef(tick);
  useEffect(() => {
    if (tick === seen.current) return;
    seen.current = tick;
    ref.current();
  }, [tick]);
}

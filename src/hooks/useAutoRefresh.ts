import { useEffect, useRef } from "react";

// A page's data kept current without F5: refresh() runs when the browser tab / window comes back into view and every
// minute while it is in view (not while hidden). It should reload silently - keep the rows on screen, no "Memuat...".
export function useAutoRefresh(refresh: () => void, ms = 60_000) {
  const ref = useRef(refresh);
  ref.current = refresh;
  useEffect(() => {
    let last = Date.now();
    const run = () => {
      if (document.visibilityState !== "visible") return;
      last = Date.now();
      ref.current();
    };
    // Back to the tab: at once, unless it just ran (focus and visibilitychange often fire together).
    const onShow = () => {
      if (document.visibilityState === "visible" && Date.now() - last > 5_000) run();
    };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    const t = setInterval(run, ms);
    return () => {
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
      clearInterval(t);
    };
  }, [ms]);
}

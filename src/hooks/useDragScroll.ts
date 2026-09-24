import { useCallback, useEffect, useRef, useState } from "react";

// Lets a horizontally scrollable container be dragged sideways with the mouse, like grabbing the
// table. Drags that start on a button/input/link are ignored so row actions keep working, and a
// click right after a real drag is swallowed so letting go doesn't trigger whatever is under it.
// Returns a callback ref, so it also attaches to a container that only renders after data loads.
export function useDragScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  // Bumped when the container mounts/unmounts, so the effect re-attaches to the new element.
  const [attached, setAttached] = useState(0);
  const setRef = useCallback((node: T | null) => {
    ref.current = node;
    setAttached((n) => n + 1);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let startX = 0;
    let startScroll = 0;
    let pressed = false;
    let dragged = false;

    const updateCursor = () => {
      el.style.cursor = el.scrollWidth > el.clientWidth ? "grab" : "";
    };

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0 || el.scrollWidth <= el.clientWidth) return;
      if ((e.target as HTMLElement).closest("button, a, input, select, textarea, label")) return;
      pressed = true;
      dragged = false;
      startX = e.pageX;
      startScroll = el.scrollLeft;
    };

    const onMove = (e: MouseEvent) => {
      if (!pressed) return;
      const dx = e.pageX - startX;
      if (!dragged && Math.abs(dx) < 5) return;
      if (!dragged) {
        dragged = true;
        el.style.cursor = "grabbing";
        el.style.userSelect = "none";
      }
      e.preventDefault();
      el.scrollLeft = startScroll - dx;
    };

    const onUp = () => {
      if (!pressed) return;
      pressed = false;
      el.style.userSelect = "";
      updateCursor();
    };

    const onClick = (e: MouseEvent) => {
      if (!dragged) return;
      dragged = false;
      e.preventDefault();
      e.stopPropagation();
    };

    updateCursor();
    const observer = new ResizeObserver(updateCursor);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);

    el.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    el.addEventListener("click", onClick, true);
    return () => {
      observer.disconnect();
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      el.removeEventListener("click", onClick, true);
    };
  }, [attached]);

  return setRef;
}

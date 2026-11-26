import { useEffect } from "react";

// Lets every list table's scroll box (.table-scroll, see index.css) be dragged with the mouse, up /
// down as well as sideways, like grabbing the table. Mounted once in the layout and delegated from
// the document, so a table that renders later (or in a dialog) works too. Drags that start on a
// button/input/link are ignored so row actions keep working, and a click right after a real drag is
// swallowed so letting go doesn't trigger whatever is under it. A press on text selects it instead (text cursor),
// so a name / No PO / number can be copied; the hand shows (and drags) on the empty space between.
export function useTableDragScroll() {
  useEffect(() => {
    let el: HTMLElement | null = null;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let dragged = false;

    const box = (t: EventTarget | null) => (t instanceof Element ? (t.closest(".table-scroll") as HTMLElement | null) : null);
    const scrollable = (b: HTMLElement) => b.scrollWidth > b.clientWidth || b.scrollHeight > b.clientHeight;

    // Is the pointer on the glyphs of a text (not the cell's padding / empty space)?
    const onText = (x: number, y: number) => {
      const d = document as Document & {
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node } | null;
      };
      const node = d.caretRangeFromPoint ? d.caretRangeFromPoint(x, y)?.startContainer : d.caretPositionFromPoint?.(x, y)?.offsetNode;
      if (!node || node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) return false;
      const r = document.createRange();
      r.selectNodeContents(node);
      return Array.from(r.getClientRects()).some((c) => x >= c.left && x <= c.right && y >= c.top && y <= c.bottom);
    };

    // The grab cursor shows only on a box that can actually scroll, and not over text (that selects).
    let hover: HTMLElement | null = null;
    const cursorAt = (e: MouseEvent) => {
      const b = box(e.target);
      if (hover && hover !== b) hover.style.cursor = "";
      hover = b;
      if (!b || el) return;
      b.style.cursor = !scrollable(b) ? "" : onText(e.clientX, e.clientY) ? "text" : "grab";
    };
    const onOver = cursorAt;

    const onDown = (e: MouseEvent) => {
      const b = box(e.target);
      if (!b || e.button !== 0 || !scrollable(b)) return;
      if ((e.target as HTMLElement).closest("button, a, input, select, textarea, label")) return;
      if (onText(e.clientX, e.clientY)) return;
      el = b;
      dragged = false;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = b.scrollLeft;
      startTop = b.scrollTop;
    };

    const onMove = (e: MouseEvent) => {
      if (!el) return cursorAt(e);
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!dragged && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      if (!dragged) {
        dragged = true;
        el.style.cursor = "grabbing";
        el.style.userSelect = "none";
      }
      e.preventDefault();
      el.scrollLeft = startLeft - dx;
      el.scrollTop = startTop - dy;
    };

    const onUp = () => {
      if (!el) return;
      el.style.userSelect = "";
      el.style.cursor = "";
      el = null;
    };

    const onClick = (e: MouseEvent) => {
      if (!dragged) return;
      dragged = false;
      if (!box(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
    };

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.removeEventListener("click", onClick, true);
    };
  }, []);
}

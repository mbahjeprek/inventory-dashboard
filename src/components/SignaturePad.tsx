import { useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";

// A box to sign in with a finger, pen or mouse. onChange gets the signature as a PNG data URL (transparent,
// cropped to the strokes, at most 600 px wide) or null while empty.
export function SignaturePad({ onChange, height = 170 }: { onChange: (png: string | null) => void; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [kosong, setKosong] = useState(true);

  // Sharp on any screen: the canvas has device pixels, drawn in CSS pixels.
  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.clientWidth * dpr;
    c.height = height * dpr;
    const g = c.getContext("2d")!;
    g.scale(dpr, dpr);
    g.lineCap = "round";
    g.lineJoin = "round";
    g.lineWidth = 2.2;
    g.strokeStyle = "#0f2a5c";
  }, [height]);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    ref.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pos(e);
    const g = ref.current!.getContext("2d")!;
    g.beginPath();
    g.arc(last.current.x, last.current.y, 1.1, 0, Math.PI * 2);
    g.fillStyle = "#0f2a5c";
    g.fill();
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current || !last.current) return;
    const p = pos(e);
    const g = ref.current!.getContext("2d")!;
    g.beginPath();
    g.moveTo(last.current.x, last.current.y);
    g.lineTo(p.x, p.y);
    g.stroke();
    last.current = p;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    setKosong(false);
    onChange(exportPng(ref.current!));
  };
  const hapus = () => {
    const c = ref.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setKosong(true);
    onChange(null);
  };

  return (
    <div className="space-y-1">
      <div className="relative rounded-md border border-dashed border-[#94a3b8] bg-white">
        <canvas
          ref={ref}
          style={{ height, touchAction: "none" }}
          className="block w-full cursor-crosshair"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onPointerLeave={up}
        />
        {kosong && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-[#94a3b8]">Tanda tangan di sini</span>}
        <span className="pointer-events-none absolute left-4 right-4 bottom-8 border-b border-[#e2e8f0]" />
      </div>
      <button type="button" onClick={hapus} disabled={kosong} className="inline-flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--accent-red)] disabled:opacity-40">
        <Eraser size={13} /> Hapus, ulangi
      </button>
    </div>
  );
}

// The strokes only (cropped, with a small margin), scaled down to at most 600 px wide.
function exportPng(c: HTMLCanvasElement): string | null {
  const g = c.getContext("2d")!;
  const { width: w, height: h } = c;
  const d = g.getImageData(0, 0, w, h).data;
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (d[(y * w + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  const m = 8;
  x0 = Math.max(0, x0 - m);
  y0 = Math.max(0, y0 - m);
  x1 = Math.min(w - 1, x1 + m);
  y1 = Math.min(h - 1, y1 + m);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const k = Math.min(1, 600 / cw);
  const out = document.createElement("canvas");
  out.width = Math.round(cw * k);
  out.height = Math.round(ch * k);
  out.getContext("2d")!.drawImage(c, x0, y0, cw, ch, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

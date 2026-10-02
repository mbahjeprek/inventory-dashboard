import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, ClipboardPaste, Download, Image as ImageIcon, Loader2, RefreshCw, RotateCcw, RotateCw, Save, Trash2, X, ZoomIn } from "lucide-react";
import { api, errorText } from "../lib/api";

// Photos are shrunk in the browser before upload: longest side at most 1280 px, JPEG at 70% - about
// 100-250 KB, still sharp enough to read a nota or a label. A camera photo of 5-10 MB never leaves
// the phone at full size.
const MAX_SIDE = 1280;
const QUALITY = 0.7;

async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("File bukan gambar yang bisa dibaca"));
      i.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff"; // transparent PNGs get a white background instead of black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", QUALITY);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// A form's photo turned a quarter clockwise before it is saved (a new upload replaces the old one).
async function rotateData(data: string): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Gambar tidak bisa diputar"));
    i.src = data;
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalHeight;
  canvas.height = img.naturalWidth;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return canvas.toDataURL("image/jpeg", QUALITY);
}

// Whether foto bukti is switched on (the server has photo storage). Asked once per page load; until
// the answer is in, the field is hidden and not required.
let status: Promise<boolean> | null = null;
export function useEvidenceEnabled() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    status ??= fetch("/api/evidence-status")
      .then((r) => r.json())
      .then((j) => !!j.enabled)
      .catch(() => false);
    let live = true;
    status.then((v) => live && setOn(v));
    return () => {
      live = false;
    };
  }, []);
  return on;
}

// Link that opens the foto bukti of a transaction (the server redirects to the stored photo).
export const evidenceUrl = (id: string) => `/api/evidence/${id}`;

export function EvidenceLink({ id, label }: { id: string | null | undefined; label?: string }) {
  const [open, setOpen] = useState(false);
  if (!id) return null;
  return (
    <>
      <button
        type="button"
        title="Lihat foto bukti"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="inline-flex items-center gap-1 text-[var(--accent-blue)] hover:underline align-middle"
      >
        <ImageIcon size={14} />
        {label}
      </button>
      {open && <EvidenceViewer id={id} onClose={() => setOpen(false)} />}
    </>
  );
}

// Pop-up with the photo on the page itself (no new tab); Download saves the original file. With `src`
// (a form's photo not saved yet) it shows that picture, without Download. A photo taken sideways or
// upside down is turned with the rotate buttons; for a stored one "Simpan arah" keeps that for everyone.
function EvidenceViewer({ id, src, onClose }: { id?: string; src?: string; onClose: () => void }) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [rotation, setRotation] = useState(0);
  const [saved, setSaved] = useState(0);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!id) return;
    api
      .evidenceMeta(id)
      .then((m) => (setRotation(m.rotation), setSaved(m.rotation)))
      .catch(() => {});
  }, [id]);
  const turn = (by: number) => (setRotation((r) => (((r + by) % 360) + 360) % 360), setNote(""));
  const saveRotation = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await api.saveEvidenceRotation(id, rotation);
      setSaved(rotation);
      setNote("Arah foto tersimpan");
    } catch (e) {
      setNote(errorText(e, "Arah foto gagal disimpan"));
    } finally {
      setSaving(false);
    }
  };
  // Turned a quarter, the picture's width is limited by the screen's height and the other way round.
  const sideways = rotation % 180 !== 0;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/80 flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between gap-2 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
        <span className="text-sm font-medium">Foto Bukti</span>
        <div className="flex items-center gap-2">
          {note && <span className="text-xs text-white/80">{note}</span>}
          <button onClick={() => turn(-90)} title="Putar ke kiri" className="p-1.5 rounded-md bg-white/15 hover:bg-white/25">
            <RotateCcw size={18} />
          </button>
          <button onClick={() => turn(90)} title="Putar ke kanan" className="p-1.5 rounded-md bg-white/15 hover:bg-white/25">
            <RotateCw size={18} />
          </button>
          {id && rotation !== saved && (
            <button
              onClick={saveRotation}
              disabled={saving}
              title="Simpan arah ini supaya foto selalu tampil begini"
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-[var(--accent-blue)] hover:opacity-90 disabled:opacity-50"
            >
              <Save size={16} /> {saving ? "Menyimpan..." : "Simpan arah"}
            </button>
          )}
          {id && (
            <a
              href={`${evidenceUrl(id)}?download=1`}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-white/15 hover:bg-white/25"
            >
              <Download size={16} /> Download
            </a>
          )}
          <button onClick={onClose} title="Tutup (Esc)" className="p-1.5 rounded-md hover:bg-white/15">
            <X size={20} />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center p-4 pt-0">
        {state === "loading" && <Loader2 size={28} className="animate-spin text-white/70 absolute" />}
        {state === "error" ? (
          <div className="text-sm text-white/80">Foto tidak bisa dimuat</div>
        ) : (
          <img
            src={src || evidenceUrl(id!)}
            alt="Foto bukti"
            onClick={(e) => e.stopPropagation()}
            onLoad={() => setState("ok")}
            onError={() => setState("error")}
            style={{
              transform: `rotate(${rotation}deg)`,
              maxWidth: sideways ? "calc(100vh - 6rem)" : "100%",
              maxHeight: sideways ? "calc(100vw - 2rem)" : "100%",
            }}
            className={`object-contain rounded shadow-2xl bg-white transition-transform ${state === "ok" ? "" : "invisible"}`}
          />
        )}
      </div>
    </div>,
    document.body
  );
}

// Required "Foto Bukti" field of a Stok Masuk / Keluar form: pick or take a photo, it is shrunk and
// uploaded at once, and `onChange` gets the evidence id (null while there is none). On a laptop the
// picture can also be pasted (Ctrl+V anywhere in the form, or the Tempel button) or dropped on it.
export function EvidenceInput({ value, onChange, label = "Foto Bukti" }: { value: string | null; onChange: (id: string | null) => void; label?: string }) {
  const enabled = useEvidenceEnabled();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [viewing, setViewing] = useState(false);

  useEffect(() => {
    if (!value) setPreview("");
  }, [value]);

  // Ctrl+V of an image while the form is open, wherever the cursor is (a pasted text still goes to
  // its field). Only one form with a Foto Bukti is open at a time.
  const pickRef = useRef<(f: File | undefined) => void>(() => {});
  useEffect(() => {
    if (!enabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      pickRef.current(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [enabled]);

  // The photo came in sideways / upside down: turn it a quarter and upload that instead.
  const rotate = async () => {
    if (!preview) return;
    setError("");
    setBusy(true);
    onChange(null);
    try {
      const data = await rotateData(preview);
      setPreview(data);
      const { id } = await api.uploadEvidence(data);
      onChange(id);
    } catch (e) {
      setError(errorText(e, "Foto gagal diputar, coba lagi"));
    } finally {
      setBusy(false);
    }
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    setBusy(true);
    onChange(null);
    try {
      const data = await shrink(file);
      setPreview(data);
      const { id } = await api.uploadEvidence(data);
      onChange(id);
    } catch (e) {
      setPreview("");
      setError(errorText(e, "Foto gagal diupload, coba lagi"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  pickRef.current = (f) => {
    if (!busy) pick(f);
  };

  // The Tempel button reads the clipboard itself (the browser may ask for permission first).
  const pasteButton = async () => {
    setError("");
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) {
          const blob = await item.getType(type);
          return pick(new File([blob], "tempel.png", { type }));
        }
      }
      setError("Clipboard tidak berisi gambar. Salin (copy) gambarnya dulu.");
    } catch {
      setError("Browser tidak mengizinkan membaca clipboard. Tekan Ctrl+V di form ini.");
    }
  };
  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if ([...e.dataTransfer.items].some((i) => i.type.startsWith("image/"))) {
        e.preventDefault();
        setDragging(true);
      }
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      pickRef.current([...e.dataTransfer.files].find((f) => f.type.startsWith("image/")));
    },
  };

  if (!enabled) return null;
  return (
    <div>
      <label className="text-xs text-[var(--text-secondary)] mb-1 block">{label}</label>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      {preview ? (
        <div {...dropProps} className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border p-2 ${dragging ? "border-[var(--accent-blue)] bg-[var(--accent-blue-bg)]" : "border-[var(--border)]"}`}>
          <button type="button" onClick={() => setViewing(true)} title="Lihat foto" className="relative group shrink-0">
            <img src={preview} alt="Foto bukti" className="w-16 h-16 object-cover rounded" />
            <span className="absolute inset-0 rounded flex items-center justify-center bg-black/0 group-hover:bg-black/35 text-white opacity-0 group-hover:opacity-100">
              <ZoomIn size={18} />
            </span>
          </button>
          <div className="flex-1 min-w-[120px] text-xs">
            {busy ? (
              <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
                <Loader2 size={14} className="animate-spin" /> Mengupload...
              </span>
            ) : value ? (
              <>
                <div className="text-[var(--accent-green)] font-medium">Foto terupload</div>
                <button type="button" onClick={() => setViewing(true)} className="text-[var(--accent-blue)] hover:underline">
                  Lihat foto
                </button>
                <div className="hidden sm:block text-[11px] text-[var(--text-muted)]">Salah foto? Ctrl+V atau Tempel untuk ganti</div>
              </>
            ) : null}
          </div>
          <div className="flex gap-1.5 ml-auto">
            <button
              type="button"
              onClick={rotate}
              disabled={busy}
              title="Putar foto 90° ke kanan (kalau terbalik / miring)"
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9] disabled:opacity-50"
            >
              <RotateCw size={13} /> Putar
            </button>
            <button
              type="button"
              onClick={pasteButton}
              disabled={busy}
              title="Ganti dengan gambar dari clipboard (Ctrl+V)"
              className="hidden sm:inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9] disabled:opacity-50"
            >
              <ClipboardPaste size={13} /> Tempel
            </button>
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={busy}
              title="Ganti dengan foto / file lain"
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9] disabled:opacity-50"
            >
              <RefreshCw size={13} /> Ganti
            </button>
            <button
              type="button"
              onClick={() => {
                setPreview("");
                setError("");
                onChange(null);
              }}
              disabled={busy}
              title="Hapus foto ini"
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)] disabled:opacity-50"
            >
              <Trash2 size={13} /> Hapus
            </button>
          </div>
        </div>
      ) : (
        <div {...dropProps} className="flex gap-2">
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className={`flex-1 flex flex-col items-center justify-center rounded-md border-2 border-dashed px-3 py-2.5 text-sm hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)] disabled:opacity-50 ${
              dragging ? "border-[var(--accent-blue)] bg-[var(--accent-blue-bg)] text-[var(--accent-blue)]" : "border-[var(--border)] text-[var(--text-secondary)]"
            }`}
          >
            <span className="inline-flex items-center gap-2">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
              {busy ? "Memproses foto..." : dragging ? "Lepas gambar di sini" : "Ambil / pilih foto bukti"}
            </span>
            {!busy && !dragging && <span className="hidden sm:block text-[11px] text-[var(--text-muted)]">atau Ctrl+V untuk tempel · seret gambar ke sini</span>}
          </button>
          <button
            type="button"
            onClick={pasteButton}
            disabled={busy}
            title="Tempel gambar dari clipboard (Ctrl+V)"
            className="hidden sm:flex flex-col items-center justify-center gap-0.5 rounded-md border border-[var(--border)] px-3 text-xs text-[var(--text-secondary)] hover:bg-[#f1f5f9] disabled:opacity-50"
          >
            <ClipboardPaste size={16} /> Tempel
          </button>
        </div>
      )}
      {error && <p className="text-[11px] text-[var(--accent-red)] mt-1">{error}</p>}
      {viewing && preview && <EvidenceViewer src={preview} onClose={() => setViewing(false)} />}
    </div>
  );
}

// Edit forms: the row's current foto bukti (click to view) and a field to replace it. Leaving the
// field empty keeps the current photo; `onChange` gets the new photo's id.
export function EditEvidenceField({ current, value, onChange }: { current: string | null | undefined; value: string | null; onChange: (id: string | null) => void }) {
  const enabled = useEvidenceEnabled();
  if (!enabled) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
        <span>Foto bukti sekarang</span>
        {current ? <EvidenceLink id={current} label="Lihat foto" /> : <span className="text-[var(--text-muted)]">Belum ada foto</span>}
      </div>
      <EvidenceInput value={value} onChange={onChange} label={current ? "Ganti Foto Bukti (kosongkan jika tidak diganti)" : "Tambah Foto Bukti"} />
    </div>
  );
}

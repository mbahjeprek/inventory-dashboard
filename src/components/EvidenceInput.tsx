import { useEffect, useRef, useState } from "react";
import { Camera, Image as ImageIcon, Loader2, RefreshCw } from "lucide-react";
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
  if (!id) return null;
  return (
    <a
      href={evidenceUrl(id)}
      target="_blank"
      rel="noreferrer"
      title="Lihat foto bukti"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 text-[var(--accent-blue)] hover:underline"
    >
      <ImageIcon size={14} />
      {label}
    </a>
  );
}

// Required "Foto Bukti" field of a Stok Masuk / Keluar form: pick or take a photo, it is shrunk and
// uploaded at once, and `onChange` gets the evidence id (null while there is none).
export function EvidenceInput({ value, onChange, label = "Foto Bukti" }: { value: string | null; onChange: (id: string | null) => void; label?: string }) {
  const enabled = useEvidenceEnabled();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!value) setPreview("");
  }, [value]);

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

  if (!enabled) return null;
  return (
    <div>
      <label className="text-xs text-[var(--text-secondary)] mb-1 block">{label}</label>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      {preview ? (
        <div className="flex items-center gap-3 rounded-md border border-[var(--border)] p-2">
          <img src={preview} alt="Foto bukti" className="w-16 h-16 object-cover rounded" />
          <div className="flex-1 min-w-0 text-xs">
            {busy ? (
              <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
                <Loader2 size={14} className="animate-spin" /> Mengupload...
              </span>
            ) : value ? (
              <span className="text-[var(--accent-green)] font-medium">Foto terupload</span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9] disabled:opacity-50"
          >
            <RefreshCw size={13} /> Ganti
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 rounded-md border-2 border-dashed border-[var(--border)] px-3 py-3 text-sm text-[var(--text-secondary)] hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)] disabled:opacity-50"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
          {busy ? "Memproses foto..." : "Ambil / pilih foto bukti"}
        </button>
      )}
      {error && <p className="text-[11px] text-[var(--accent-red)] mt-1">{error}</p>}
    </div>
  );
}

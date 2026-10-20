import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Copy, ExternalLink, FolderOpen, Pencil, Plus, Search, Star, Trash2, X, Check } from "lucide-react";
import { api, errorText, ESTATES, type Dokumen, type DokumenInput } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { can, userEstates } from "../lib/access";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DOK_KATEGORI, DOK_MODUL, jenisOf, kategoriLabel, modulLabel } from "../lib/dokumen";
import { isoDisplay } from "../lib/opname";

// Dokumen & Link: the Google Sheets / Docs / Drive files (and other links) the estates work with, in one place.
// A card opens its link in a new tab; Kelola Dokumen adds / edits / pins them. The files themselves stay in
// Google Drive, which decides who may open them.
const selectCls = "text-sm rounded-md border border-[var(--border)] px-3 py-2 bg-white";

export function DokumenPage() {
  const { user } = useAuth();
  const canEdit = can(user, "dokumen.edit");
  const [params] = useSearchParams();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [kategori, setKategori] = useState("");
  const [modul, setModul] = useState(params.get("modul") ?? "");
  const [estate, setEstate] = useState(params.get("estate") ?? "");
  const [rows, setRows] = useState<Dokumen[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Dokumen | "new" | null>(null);
  const [hapus, setHapus] = useState<Dokumen | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const req = useRef(0);
  const estates = user?.role === "superuser" ? [...ESTATES] : userEstates(user);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  const load = () => {
    // Only the latest request's answer is shown (a slow earlier search can't overwrite it).
    const n = ++req.current;
    api
      .dokumen({ search: q, kategori, modul, estate })
      .then((r) => n === req.current && (setRows(r.data), setError("")))
      .catch((e) => n === req.current && (setRows([]), setError(errorText(e, "Gagal memuat dokumen"))));
  };
  useEffect(load, [q, kategori, modul, estate]); // eslint-disable-line react-hooks/exhaustive-deps

  const pin = async (d: Dokumen) => {
    try {
      await api.dokumenPin(d.id, !d.pinned);
      load();
    } catch (e) {
      setError(errorText(e, "Gagal menyematkan"));
    }
  };
  const copy = async (d: Dokumen) => {
    try {
      await navigator.clipboard.writeText(d.url);
      setCopied(d.id);
      setTimeout(() => setCopied((c) => (c === d.id ? null : c)), 1500);
    } catch {
      window.prompt("Salin link ini:", d.url);
    }
  };
  const doHapus = async () => {
    if (!hapus) return;
    try {
      await api.dokumenHapus(hapus.id);
      setHapus(null);
      load();
    } catch (e) {
      setHapus(null);
      setError(errorText(e, "Gagal menghapus"));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Dokumen & Link</h1>
          <p className="text-sm text-[var(--text-secondary)]">Spreadsheet, Docs, folder Drive dan file penting. Klik kartunya untuk membuka di tab baru.</p>
        </div>
        {canEdit && (
          <button onClick={() => setEditing("new")} className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md bg-[var(--accent-blue)] text-white hover:opacity-90">
            <Plus size={16} /> Tambah Link
          </button>
        )}
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3 flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari judul, keterangan atau link..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue-border)]"
          />
        </div>
        <select value={kategori} onChange={(e) => setKategori(e.target.value)} className={selectCls} aria-label="Kategori">
          <option value="">Semua kategori</option>
          {DOK_KATEGORI.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        <select value={modul} onChange={(e) => setModul(e.target.value)} className={selectCls} aria-label="Modul">
          <option value="">Semua modul</option>
          {DOK_MODUL.filter((m) => m.value).map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        {estates.length > 1 && (
          <select value={estate} onChange={(e) => setEstate(e.target.value)} className={selectCls} aria-label="Estate">
            <option value="">Semua estate</option>
            {estates.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && <p className="text-sm text-[var(--accent-red)]">{error}</p>}

      {rows === null ? (
        <p className="text-sm text-[var(--text-muted)]">Memuat...</p>
      ) : !rows.length ? (
        <div className="bg-[var(--bg-card)] border border-dashed border-[var(--border)] rounded-lg p-10 text-center text-sm text-[var(--text-muted)]">
          <FolderOpen size={28} className="mx-auto mb-2 opacity-60" />
          {q || kategori || modul || estate ? "Tidak ada link yang cocok dengan filter." : "Belum ada link."}
          {canEdit && !q && (
            <div className="mt-3">
              <button onClick={() => setEditing("new")} className="text-[var(--accent-blue)] hover:underline">
                Tambah link pertama
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {rows.map((d) => {
            const j = jenisOf(d.url);
            const Icon = j.icon;
            return (
              <div key={d.id} className={`group relative bg-[var(--bg-card)] border rounded-lg transition-shadow hover:shadow-md ${d.pinned ? "border-[#f5c542]" : "border-[var(--border)]"}`}>
                <a href={d.url} target="_blank" rel="noopener noreferrer" className="flex gap-3 p-4 pr-12" title={`Buka ${d.judul}`}>
                  <span className="shrink-0 w-11 h-11 rounded-lg flex items-center justify-center" style={{ background: j.bg, color: j.color }}>
                    <Icon size={22} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)] leading-snug group-hover:text-[var(--accent-blue)]">
                      <span className="line-clamp-2">{d.judul}</span>
                      <ExternalLink size={13} className="shrink-0 opacity-0 group-hover:opacity-70" />
                    </span>
                    {d.keterangan && <span className="block text-xs text-[var(--text-secondary)] mt-0.5 line-clamp-2">{d.keterangan}</span>}
                    <span className="flex flex-wrap gap-1 mt-2">
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: j.bg, color: j.color }}>
                        {j.label}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#f1f5f9] text-[var(--text-secondary)]">{kategoriLabel(d.kategori)}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#f1f5f9] text-[var(--text-secondary)]">{modulLabel(d.modul)}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#f1f5f9] text-[var(--text-secondary)]">{d.estate || "Semua estate"}</span>
                    </span>
                    <span className="block text-[10px] text-[var(--text-muted)] mt-1.5">
                      {d.oleh ? `${d.oleh} · ` : ""}diubah {isoDisplay(d.updated_at.slice(0, 10))}
                    </span>
                  </span>
                </a>
                <div className="absolute top-2 right-2 flex flex-col gap-0.5">
                  {canEdit ? (
                    <button onClick={() => pin(d)} title={d.pinned ? "Lepas sematan" : "Sematkan di atas"} className="p-1.5 rounded-md hover:bg-[#f1f5f9]">
                      <Star size={15} className={d.pinned ? "fill-[#f5c542] text-[#e0a800]" : "text-[var(--text-muted)]"} />
                    </button>
                  ) : (
                    d.pinned && (
                      <span className="p-1.5" title="Disematkan">
                        <Star size={15} className="fill-[#f5c542] text-[#e0a800]" />
                      </span>
                    )
                  )}
                  <button onClick={() => copy(d)} title="Salin link" className="p-1.5 rounded-md text-[var(--text-muted)] hover:bg-[#f1f5f9] hover:text-[var(--text-primary)]">
                    {copied === d.id ? <Check size={15} className="text-[var(--accent-green)]" /> : <Copy size={15} />}
                  </button>
                  {canEdit && (
                    <>
                      <button onClick={() => setEditing(d)} title="Edit" className="p-1.5 rounded-md text-[var(--text-muted)] hover:bg-[#f1f5f9] hover:text-[var(--text-primary)]">
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => setHapus(d)} title="Hapus" className="p-1.5 rounded-md text-[var(--text-muted)] hover:bg-[var(--accent-red-bg)] hover:text-[var(--accent-red)]">
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <DokumenModal
          record={editing === "new" ? null : editing}
          estates={estates}
          defaults={{ modul, estate }}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {hapus && <ConfirmDialog message={`Hapus link "${hapus.judul}"? File aslinya di Google Drive tidak ikut terhapus.`} onCancel={() => setHapus(null)} onConfirm={doHapus} />}
    </div>
  );
}

export function DokumenModal({
  record,
  estates,
  defaults,
  onClose,
  onSuccess,
}: {
  record: Dokumen | null;
  estates: string[];
  defaults: { modul: string; estate: string };
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<DokumenInput>({
    judul: record?.judul ?? "",
    url: record?.url ?? "",
    kategori: record?.kategori ?? "LAPORAN",
    modul: record?.modul ?? defaults.modul,
    estate: record?.estate ?? defaults.estate,
    keterangan: record?.keterangan ?? "",
    pinned: record?.pinned ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof DokumenInput>(k: K, v: DokumenInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const urlOk = /^https?:\/\/\S+$/i.test(form.url.trim());
  const j = urlOk ? jenisOf(form.url) : null;
  const save = async () => {
    if (!form.judul.trim()) return setError("Judul wajib diisi");
    if (!urlOk) return setError("Link harus diawali https:// (salin dari address bar atau tombol Share)");
    setBusy(true);
    setError("");
    try {
      const body = { ...form, judul: form.judul.trim(), url: form.url.trim(), keterangan: form.keterangan.trim() };
      if (record) await api.dokumenEdit(record.id, body);
      else await api.dokumenTambah(body);
      onSuccess();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan", true));
      setBusy(false);
    }
  };
  const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-3 py-2";
  const labelCls = "text-xs text-[var(--text-secondary)] mb-1 block";
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-lg shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h3 className="font-semibold text-sm text-[var(--text-primary)]">{record ? "Edit Link" : "Tambah Link"}</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className={labelCls}>Link (https://...)</label>
            <input value={form.url} onChange={(e) => set("url", e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." className={inputCls} autoFocus={!record} />
            {j && (
              <p className="text-[11px] mt-1" style={{ color: j.color }}>
                Terdeteksi: {j.label}
              </p>
            )}
          </div>
          <div>
            <label className={labelCls}>Judul</label>
            <input value={form.judul} onChange={(e) => set("judul", e.target.value)} placeholder="cth. Rekap Solar KNS 2026" className={inputCls} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Kategori</label>
              <select value={form.kategori} onChange={(e) => set("kategori", e.target.value as DokumenInput["kategori"])} className={inputCls}>
                {DOK_KATEGORI.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Modul</label>
              <select value={form.modul} onChange={(e) => set("modul", e.target.value)} className={inputCls}>
                {DOK_MODUL.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Estate</label>
              <select value={form.estate} onChange={(e) => set("estate", e.target.value)} className={inputCls}>
                <option value="">Semua estate</option>
                {estates.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Keterangan (opsional)</label>
            <input value={form.keterangan} onChange={(e) => set("keterangan", e.target.value)} placeholder="cth. diupdate tiap Senin" className={inputCls} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.pinned} onChange={(e) => set("pinned", e.target.checked)} />
            Sematkan di atas
          </label>
          <p className="text-[11px] text-[var(--text-muted)]">Siapa yang boleh membuka file tetap diatur dari tombol Share di Google Drive.</p>
          {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
        </div>
        <div className="px-5 py-4 border-t border-[var(--border)] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-[var(--border)] text-[var(--text-secondary)]">
            Batal
          </button>
          <button onClick={save} disabled={busy} className="px-4 py-2 rounded-md text-sm font-medium bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50">
            {busy ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </div>
    </div>
  );
}

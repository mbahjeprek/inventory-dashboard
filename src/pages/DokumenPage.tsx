import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, Copy, ExternalLink, Lock, LockOpen, Plus, Search, Trash2 } from "lucide-react";
import { api, errorText, ESTATES, type Dokumen, type DokumenInput } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { can, userEstates } from "../lib/access";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DOK_MODUL, jenisOf } from "../lib/dokumen";

// Master Data > Dokumen & Link: the list of documents (Google Sheets / Docs / Drive, PDF...) like a
// spreadsheet - No, Nama Dokumen, PIC, Link, plus the menu / estate whose "Dokumen" button shows it.
// With Dokumen & Link an account adds rows and types in place (saved when a cell is left) in the rows it
// added itself; with Kelola semua (or as Super User) in every row, and it can lock a row (gembok) so nobody
// else - not even who added it - changes or deletes it. Other rows are read-only; links open in a new tab.
const selectCls = "text-sm rounded-md border border-[var(--border)] px-3 py-2 bg-white";
const cellCls =
  "w-full bg-transparent px-2 py-1.5 text-sm rounded border border-transparent hover:border-[var(--border)] focus:border-[var(--accent-blue)] focus:bg-white focus:outline-none";
const urlOk = (u: string) => /^https?:\/\/\S+$/i.test(u.trim());

type Row = DokumenInput & { id: number | null; key: string; boleh_ubah: boolean; dikunci: boolean; oleh: string | null };
const toRow = (d: Dokumen): Row => ({
  id: d.id,
  key: `d${d.id}`,
  judul: d.judul,
  url: d.url,
  kategori: d.kategori,
  modul: d.modul,
  estate: d.estate,
  keterangan: d.keterangan,
  pic: d.pic ?? "",
  pinned: d.pinned,
  boleh_ubah: d.boleh_ubah,
  dikunci: d.dikunci,
  oleh: d.oleh,
});
const emptyRow = (modul: string, estate: string): Row => ({
  id: null,
  boleh_ubah: true,
  dikunci: false,
  oleh: null,
  key: `n${Date.now()}${Math.random()}`,
  judul: "",
  url: "",
  kategori: "LAINNYA",
  modul,
  estate,
  keterangan: "",
  pic: "",
  pinned: false,
});

export function DokumenPage() {
  const { user } = useAuth();
  const canEdit = can(user, "dokumen.edit");
  const [params] = useSearchParams();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [modul, setModul] = useState(params.get("modul") ?? "");
  const [estate, setEstate] = useState(params.get("estate") ?? "");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [hapus, setHapus] = useState<Row | null>(null);
  const [kelola, setKelola] = useState(false);
  const req = useRef(0);
  const estates = user?.role === "superuser" ? [...ESTATES] : userEstates(user);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  const load = () => {
    // Only the latest request's answer is shown; unsaved new rows stay at the bottom.
    const n = ++req.current;
    api
      .dokumen({ search: q, modul, estate })
      .then((r) => n === req.current && (setRows((cur) => [...r.data.map(toRow), ...(cur ?? []).filter((x) => x.id === null)]), setKelola(r.kelola), setError("")))
      .catch((e) => n === req.current && (setRows([]), setError(errorText(e, "Gagal memuat dokumen"))));
  };
  useEffect(load, [q, modul, estate]); // eslint-disable-line react-hooks/exhaustive-deps

  const kunci = async (r: Row) => {
    if (r.id === null) return;
    try {
      await api.dokumenKunci(r.id, !r.dikunci);
      setRows((x) => (x ?? []).map((y) => (y.key === r.key ? { ...y, dikunci: !r.dikunci } : y)));
    } catch (e) {
      setError(errorText(e, "Gagal mengunci dokumen"));
    }
  };
  // The gembok: a button for Kelola semua, else just a sign that the row is locked / who owns it.
  const gembok = (r: Row) =>
    r.id === null ? null : kelola ? (
      <button
        onClick={() => kunci(r)}
        title={r.dikunci ? "Dikunci: hanya pengelola dokumen yang bisa mengubah / menghapus. Klik untuk membuka kunci." : "Kunci supaya tidak bisa diubah / dihapus selain oleh pengelola dokumen"}
        className={`p-1.5 rounded hover:bg-[#f1f5f9] ${r.dikunci ? "text-[var(--accent-amber)]" : "text-[var(--text-muted)]"}`}
      >
        {r.dikunci ? <Lock size={14} /> : <LockOpen size={14} />}
      </button>
    ) : !r.boleh_ubah && canEdit ? (
      <span title={r.dikunci ? "Dikunci oleh pengelola dokumen" : `Hanya bisa diubah oleh pembuatnya${r.oleh ? ` (${r.oleh})` : ""} atau pengelola dokumen`} className="inline-flex p-1.5 text-[var(--text-muted)]">
        <Lock size={14} />
      </span>
    ) : null;
  const tambah = () => setRows((r) => [...(r ?? []), emptyRow(modul, estate)]);
  const saved = (key: string, d: Row) => setRows((r) => (r ?? []).map((x) => (x.key === key ? d : x)));
  const doHapus = async () => {
    if (!hapus) return;
    const target = hapus;
    setHapus(null);
    if (target.id === null) return setRows((r) => (r ?? []).filter((x) => x.key !== target.key));
    try {
      await api.dokumenHapus(target.id);
      setRows((r) => (r ?? []).filter((x) => x.key !== target.key));
    } catch (e) {
      setError(errorText(e, "Gagal menghapus"));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Dokumen & Link</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Daftar dokumen (Google Sheets, Docs, Drive, PDF) dan PIC-nya.{" "}
            {canEdit ? "Klik sel untuk mengetik; tersimpan otomatis saat pindah sel." : "Klik nama atau link untuk membuka di tab baru."}
          </p>
        </div>
        {canEdit && (
          <button onClick={tambah} className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md bg-[var(--accent-blue)] text-white hover:opacity-90">
            <Plus size={16} /> Tambah baris
          </button>
        )}
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3 flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama dokumen, PIC atau link..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue-border)]"
          />
        </div>
        <select value={modul} onChange={(e) => setModul(e.target.value)} className={selectCls} aria-label="Menu">
          <option value="">Semua menu</option>
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

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
        <div className="table-scroll">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-[#d5edc9] text-left text-xs text-[var(--text-primary)]">
                <th className="px-3 py-2.5 w-12 text-right border-r border-[#c3dcb5]">No</th>
                <th className="px-3 py-2.5 min-w-[220px] border-r border-[#c3dcb5]">Nama Dokumen</th>
                <th className="px-3 py-2.5 min-w-[140px] border-r border-[#c3dcb5]">PIC</th>
                <th className="px-3 py-2.5 min-w-[240px] border-r border-[#c3dcb5]">Link Dokumen</th>
                <th className="px-3 py-2.5 min-w-[120px] border-r border-[#c3dcb5]">Menu</th>
                <th className="px-3 py-2.5 min-w-[140px] border-r border-[#c3dcb5]">Estate</th>
                <th className="px-3 py-2.5 min-w-[160px] border-r border-[#c3dcb5]">Keterangan</th>
                <th className="px-2 py-2.5 w-24" />
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Memuat...
                  </td>
                </tr>
              ) : !rows.length ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-[var(--text-muted)]">
                    {q || modul || estate ? "Tidak ada dokumen yang cocok." : "Belum ada dokumen."}
                    {canEdit && (
                      <button onClick={tambah} className="ml-2 text-[var(--accent-blue)] hover:underline">
                        Tambah baris
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((r, i) =>
                  canEdit && r.boleh_ubah ? (
                    <EditRow
                      key={r.key}
                      no={i + 1}
                      row={r}
                      estates={estates}
                      extra={gembok(r)}
                      onSaved={(d) => saved(r.key, { ...d, boleh_ubah: r.boleh_ubah, dikunci: r.dikunci, oleh: r.oleh })}
                      onHapus={() => (r.id === null && !r.judul && !r.url ? setRows((x) => (x ?? []).filter((y) => y.key !== r.key)) : setHapus(r))}
                    />
                  ) : (
                    <ViewRow key={r.key} no={i + 1} row={r} extra={gembok(r)} />
                  )
                )
              )}
            </tbody>
          </table>
        </div>
        {canEdit && rows && rows.length > 0 && (
          <button onClick={tambah} className="w-full flex items-center gap-1.5 px-4 py-2 text-sm text-[var(--accent-blue)] border-t border-[var(--border)] hover:bg-[#f8fafc]">
            <Plus size={15} /> Tambah baris
          </button>
        )}
      </div>
      <p className="text-[11px] text-[var(--text-muted)]">
        Menu & estate menentukan di halaman mana dokumen muncul lewat tombol "Dokumen". Siapa yang boleh membuka file tetap diatur dari tombol Share di Google Drive.
      </p>

      {hapus && (
        <ConfirmDialog
          message={`Hapus "${hapus.judul || "baris ini"}" dari daftar? File aslinya di Google Drive tidak ikut terhapus.`}
          onCancel={() => setHapus(null)}
          onConfirm={doHapus}
        />
      )}
    </div>
  );
}

function CopyBtn({ url }: { url: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        } catch {
          window.prompt("Salin link ini:", url);
        }
      }}
      title="Salin link"
      className="p-1.5 rounded text-[var(--text-muted)] hover:bg-[#f1f5f9] hover:text-[var(--text-primary)]"
    >
      {ok ? <Check size={14} className="text-[var(--accent-green)]" /> : <Copy size={14} />}
    </button>
  );
}

function LinkCell({ url }: { url: string }) {
  if (!urlOk(url)) return <span className="text-[var(--text-muted)]">-</span>;
  const j = jenisOf(url);
  const Icon = j.icon;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 max-w-full text-[var(--accent-blue)] hover:underline" title={url}>
      <Icon size={14} style={{ color: j.color }} className="shrink-0" />
      <span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
    </a>
  );
}

function ViewRow({ no, row, extra }: { no: number; row: Row; extra?: React.ReactNode }) {
  return (
    <tr className="border-t border-[var(--border)] hover:bg-[#f8fafc] align-top">
      <td className="px-3 py-2 text-right text-[var(--text-muted)] border-r border-[var(--border)]">{no}</td>
      <td className="px-3 py-2 border-r border-[var(--border)]">
        {urlOk(row.url) ? (
          <a href={row.url} target="_blank" rel="noopener noreferrer" className="font-medium text-[var(--text-primary)] hover:text-[var(--accent-blue)] hover:underline">
            {row.judul}
          </a>
        ) : (
          row.judul
        )}
      </td>
      <td className="px-3 py-2 border-r border-[var(--border)]">{row.pic || "-"}</td>
      <td className="px-3 py-2 border-r border-[var(--border)] max-w-[320px]">
        <LinkCell url={row.url} />
      </td>
      <td className="px-3 py-2 border-r border-[var(--border)] text-xs">{DOK_MODUL.find((m) => m.value === row.modul)?.label ?? "Umum"}</td>
      <td className="px-3 py-2 border-r border-[var(--border)] text-xs">{row.estate || "Semua estate"}</td>
      <td className="px-3 py-2 border-r border-[var(--border)] text-xs text-[var(--text-secondary)]">{row.keterangan || "-"}</td>
      <td className="px-2 py-1.5 text-right whitespace-nowrap">
        {urlOk(row.url) && (
          <>
            <a href={row.url} target="_blank" rel="noopener noreferrer" title="Buka" className="inline-flex p-1.5 rounded text-[var(--text-muted)] hover:bg-[#f1f5f9] hover:text-[var(--accent-blue)]">
              <ExternalLink size={14} />
            </a>
            <CopyBtn url={row.url} />
          </>
        )}
        {extra}
      </td>
    </tr>
  );
}

// One row typed in place: saved when a cell is left with something changed (a new row once it has a
// name and a valid link). The row shows whether it is saved and why not.
function EditRow({
  no,
  row,
  estates,
  extra,
  onSaved,
  onHapus,
}: {
  no: number;
  row: Row;
  estates: string[];
  extra?: React.ReactNode;
  onSaved: (r: Row) => void;
  onHapus: () => void;
}) {
  const [v, setV] = useState<Row>(row);
  const [state, setState] = useState<"" | "saving" | "saved" | "error">("");
  const [msg, setMsg] = useState("");
  const last = useRef(JSON.stringify(row));
  const set = <K extends keyof Row>(k: K, val: Row[K]) => setV((x) => ({ ...x, [k]: val }));

  const save = async (next: Row = v) => {
    const body: DokumenInput = {
      judul: next.judul.trim(),
      url: next.url.trim(),
      kategori: next.kategori,
      modul: next.modul,
      estate: next.estate,
      keterangan: next.keterangan.trim(),
      pic: next.pic.trim(),
      pinned: next.pinned,
    };
    const snap = JSON.stringify({ ...next, ...body });
    if (snap === last.current) return;
    if (!body.judul || !urlOk(body.url)) {
      // A new row being filled in: wait until it has both, unless a link was typed that isn't one.
      if (next.id === null && (!body.url || !body.judul)) return setState("");
      setState("error");
      setMsg(!body.judul ? "Isi nama dokumen" : "Link harus diawali https://");
      return;
    }
    setState("saving");
    setMsg("");
    try {
      let id = next.id;
      if (id === null) id = (await api.dokumenTambah(body)).id;
      else await api.dokumenEdit(id, body);
      const done = { ...next, ...body, id };
      last.current = JSON.stringify(done);
      setV(done);
      onSaved(done);
      setState("saved");
      setTimeout(() => setState((s) => (s === "saved" ? "" : s)), 1500);
    } catch (e) {
      setState("error");
      setMsg(errorText(e, "Gagal menyimpan"));
    }
  };
  const blurSave = () => void save();
  const enter = (e: React.KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur();
  const pick = <K extends "modul" | "estate">(k: K, val: string) => {
    const next = { ...v, [k]: val };
    setV(next);
    void save(next);
  };

  return (
    <>
      <tr className={`border-t border-[var(--border)] align-top ${state === "error" ? "bg-[#fff6f6]" : row.id === null ? "bg-[#f8fbff]" : "hover:bg-[#fafcff]"}`}>
        <td className="px-3 py-2 text-right text-[var(--text-muted)] border-r border-[var(--border)]">{no}</td>
        <td className="px-1 py-1 border-r border-[var(--border)]">
          <input value={v.judul} onChange={(e) => set("judul", e.target.value)} onBlur={blurSave} onKeyDown={enter} placeholder="Nama dokumen" className={`${cellCls} font-medium`} autoFocus={row.id === null && !row.judul} />
        </td>
        <td className="px-1 py-1 border-r border-[var(--border)]">
          <input value={v.pic} onChange={(e) => set("pic", e.target.value)} onBlur={blurSave} onKeyDown={enter} placeholder="PIC" className={cellCls} />
        </td>
        <td className="px-1 py-1 border-r border-[var(--border)]">
          <div className="flex items-center gap-1">
            {urlOk(v.url) && (() => {
              const j = jenisOf(v.url);
              const Icon = j.icon;
              return <Icon size={14} style={{ color: j.color }} className="shrink-0 ml-1" />;
            })()}
            <input value={v.url} onChange={(e) => set("url", e.target.value)} onBlur={blurSave} onKeyDown={enter} placeholder="https://docs.google.com/..." className={`${cellCls} text-[var(--accent-blue)]`} />
          </div>
        </td>
        <td className="px-1 py-1 border-r border-[var(--border)]">
          <select value={v.modul} onChange={(e) => pick("modul", e.target.value)} className={`${cellCls} cursor-pointer`}>
            {DOK_MODUL.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </td>
        <td className="px-1 py-1 border-r border-[var(--border)]">
          <select value={v.estate} onChange={(e) => pick("estate", e.target.value)} className={`${cellCls} cursor-pointer`}>
            <option value="">Semua estate</option>
            {estates.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </td>
        <td className="px-1 py-1 border-r border-[var(--border)]">
          <input value={v.keterangan} onChange={(e) => set("keterangan", e.target.value)} onBlur={blurSave} onKeyDown={enter} placeholder="-" className={`${cellCls} text-xs`} />
        </td>
        <td className="px-2 py-1.5 text-right whitespace-nowrap">
          {state === "saving" ? (
            <span className="text-[11px] text-[var(--text-muted)]">menyimpan...</span>
          ) : state === "saved" ? (
            <Check size={14} className="inline text-[var(--accent-green)]" />
          ) : (
            <>
              {urlOk(v.url) && v.id !== null && (
                <a href={v.url} target="_blank" rel="noopener noreferrer" title="Buka" className="inline-flex p-1.5 rounded text-[var(--text-muted)] hover:bg-[#f1f5f9] hover:text-[var(--accent-blue)]">
                  <ExternalLink size={14} />
                </a>
              )}
              {urlOk(v.url) && <CopyBtn url={v.url} />}
              {extra}
              <button onClick={onHapus} title="Hapus baris" className="p-1.5 rounded text-[var(--text-muted)] hover:bg-[var(--accent-red-bg)] hover:text-[var(--accent-red)]">
                <Trash2 size={14} />
              </button>
            </>
          )}
        </td>
      </tr>
      {state === "error" && msg && (
        <tr className="bg-[#fff6f6]">
          <td />
          <td colSpan={7} className="px-3 pb-1.5 text-[11px] text-[var(--accent-red)]">
            {row.id === null ? `Belum tersimpan: ${msg}` : msg}
          </td>
        </tr>
      )}
    </>
  );
}

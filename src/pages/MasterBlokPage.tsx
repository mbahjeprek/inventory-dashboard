import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { api, errorText, type Blok, type BlokInput } from "../lib/api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ExportButtons } from "../components/ExportButtons";
import { fetchAllRows, type TableReport } from "../lib/printTable";

type SortKey = "urut" | "estate" | "divisi" | "blok" | "planting_material" | "tahun_tanam" | "ha" | "sph" | "pkk";
const ESTATE_LABEL: Record<string, string> = { NILAM: "Nilam", KNS: "KNS", WJA: "WJA", ZAMRUD: "Zamrud", FIRUS: "Firus" };
const estateLabel = (e: string) => ESTATE_LABEL[e] ?? e;
const fmt = (n: number | null | undefined, d = 0) => (n === null || n === undefined ? "-" : n.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d }));

// Master Blok: the estates' blocks laid out like the "AKSS - BLOCK DETAIL" sheet (Estate, Divisi,
// Blok, Planting Material, Tahun Tanam, Ha, SPH, PKK), in the sheet's order unless sorted.
export function MasterBlokPage() {
  const [rows, setRows] = useState<Blok[]>([]);
  const [total, setTotal] = useState(0);
  const [totalHa, setTotalHa] = useState(0);
  const [totalPkk, setTotalPkk] = useState(0);
  const [opts, setOpts] = useState<Awaited<ReturnType<typeof api.masterBlokOptions>> | null>(null);
  const [search, setSearch] = useState("");
  const [estate, setEstate] = useState("");
  const [divisi, setDivisi] = useState("");
  const [pm, setPm] = useState("");
  const [tt, setTt] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("urut");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Blok | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Blok | null>(null);
  const [error, setError] = useState("");
  const pageSize = 100;

  const filters = () => ({ search, estate, divisi, planting_material: pm, tahun_tanam: tt, sortBy, sortDir });
  const load = () => {
    setLoading(true);
    api
      .masterBlok({ ...filters(), page, pageSize })
      .then((res) => {
        setRows(res.data);
        setTotal(res.total);
        setTotalHa(res.totalHa);
        setTotalPkk(res.totalPkk);
      })
      .catch((e) => setError(errorText(e, "Gagal memuat blok")))
      .finally(() => setLoading(false));
  };
  const loadOptions = () => api.masterBlokOptions().then(setOpts).catch(() => {});

  useEffect(() => {
    loadOptions();
  }, []);
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, estate, divisi, pm, tt, sortBy, sortDir]);
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      load();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const toggleSort = (key: SortKey) => {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(key);
      setSortDir("asc");
    }
    setPage(1);
  };
  const filterSet = (set: (v: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value);
    setPage(1);
  };

  const remove = async (b: Blok) => {
    setError("");
    try {
      await api.deleteBlok(b.id);
      load();
      loadOptions();
    } catch (e) {
      setError(errorText(e, "Gagal menghapus blok"));
    }
  };

  const buildReport = async (): Promise<TableReport> => {
    const all = await fetchAllRows((p, ps) => api.masterBlok({ ...filters(), page: p, pageSize: ps }));
    const active = [
      search && `Cari: "${search}"`,
      estate && `Estate: ${estateLabel(estate)}`,
      divisi && `Divisi: ${divisi}`,
      pm && `Planting Material: ${pm}`,
      tt && `Tahun Tanam: ${tt}`,
    ].filter(Boolean);
    return {
      title: "Master Blok - Block Detail",
      subtitle: [
        ...(active.length ? [`Filter: ${active.join(" · ")}`] : []),
        `${total.toLocaleString("id-ID")} blok · ${fmt(totalHa, 2)} Ha · ${fmt(totalPkk)} pokok`,
      ],
      columns: [
        { label: "Estate" },
        { label: "Divisi" },
        { label: "Blok", nowrap: true },
        { label: "Planting Material" },
        { label: "Tahun Tanam", align: "right" },
        { label: "Ha", align: "right" },
        { label: "SPH", align: "right" },
        { label: "PKK", align: "right" },
      ],
      rows: all.map((b) => [estateLabel(b.estate), b.divisi, b.blok, b.planting_material, b.tahun_tanam, b.ha, b.sph, b.pkk]),
    };
  };

  const selectCls = "text-sm rounded-md border border-[var(--border)] px-3 py-2 bg-white";
  const th = (label: string, key: SortKey, right = false) => {
    const active = sortBy === key;
    const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <th className={`px-4 py-2.5 ${right ? "text-right" : "text-left"}`}>
        <button onClick={() => toggleSort(key)} className={`inline-flex items-center gap-1 hover:text-[var(--text-primary)] ${active ? "text-[var(--accent-blue)]" : ""}`}>
          {label}
          <Icon size={12} />
        </button>
      </th>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Master Data Blok</h1>
          <p className="text-sm text-[var(--text-secondary)]">Block detail per estate & divisi: planting material, tahun tanam, luas, SPH dan jumlah pokok</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportButtons total={total} buildReport={buildReport} fileName="master-blok" />
          <button onClick={() => setCreating(true)} className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-[var(--accent-blue)] text-white hover:opacity-90">
            <Plus size={16} />
            Tambah Blok
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari blok (cth. I-5 atau I5), divisi, planting material..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue-border)]"
          />
        </div>
        {(opts?.estates.length ?? 0) > 1 && (
          <select value={estate} onChange={filterSet(setEstate)} className={selectCls} aria-label="Estate">
            <option value="">Semua Estate</option>
            {opts!.estates.map((e) => (
              <option key={e} value={e}>
                {estateLabel(e)}
              </option>
            ))}
          </select>
        )}
        <select value={divisi} onChange={filterSet(setDivisi)} className={selectCls} aria-label="Divisi">
          <option value="">Semua Divisi</option>
          {opts?.divisi.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select value={pm} onChange={filterSet(setPm)} className={selectCls} aria-label="Planting Material">
          <option value="">Semua Planting Material</option>
          {opts?.planting_material.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select value={tt} onChange={filterSet(setTt)} className={selectCls} aria-label="Tahun Tanam">
          <option value="">Semua Tahun Tanam</option>
          {opts?.tahun_tanam.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      <div className="text-sm text-[var(--text-secondary)]">
        {total.toLocaleString("id-ID")} blok · luas <span className="font-medium text-[var(--text-primary)]">{fmt(totalHa, 2)} Ha</span> · <span className="font-medium text-[var(--text-primary)]">{fmt(totalPkk)}</span> pokok
        {totalHa > 0 && <> · rata-rata {fmt(totalPkk / totalHa)} pokok/Ha</>}
      </div>

      {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
        <div className="table-scroll">
          <table className="grid-table data-table text-sm">
            <thead>
              <tr className="text-xs uppercase">
                {th("Estate", "estate")}
                {th("Divisi", "divisi")}
                {th("Blok", "blok")}
                {th("Planting Material", "planting_material")}
                {th("Tahun Tanam", "tahun_tanam", true)}
                {th("Ha", "ha", true)}
                {th("SPH", "sph", true)}
                {th("PKK", "pkk", true)}
                <th className="px-4 py-2.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Memuat...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Tidak ada blok
                  </td>
                </tr>
              ) : (
                rows.map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-2">{estateLabel(b.estate)}</td>
                    <td className="px-4 py-2">{b.divisi || "-"}</td>
                    <td className="px-4 py-2 font-semibold text-[var(--text-primary)] whitespace-nowrap">{b.blok}</td>
                    <td className="px-4 py-2">{b.planting_material || "-"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{b.tahun_tanam ?? "-"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(b.ha, 2)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(b.sph)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(b.pkk)}</td>
                    <td className="px-4 py-2 text-right">
                      <div className="inline-flex gap-1.5">
                        <button onClick={() => setEditing(b)} title="Edit blok" className="p-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]">
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(b)}
                          title="Hapus blok"
                          className="p-1.5 rounded-md border border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] text-sm text-[var(--text-secondary)]">
          <span>
            Halaman {page} dari {totalPages}
          </span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded-md border border-[var(--border)] disabled:opacity-40">
              <ChevronLeft size={16} />
            </button>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded-md border border-[var(--border)] disabled:opacity-40">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {(editing || creating) && (
        <BlokModal
          blok={editing}
          estates={opts?.estates ?? []}
          defaultEstate={estate}
          options={opts}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSuccess={() => {
            setEditing(null);
            setCreating(false);
            load();
            loadOptions();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Hapus blok "${confirmDelete.blok}" (${estateLabel(confirmDelete.estate)}, Divisi ${confirmDelete.divisi || "-"}${confirmDelete.tahun_tanam ? `, TT ${confirmDelete.tahun_tanam}` : ""})?`}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            remove(confirmDelete);
            setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}

function BlokModal({
  blok,
  estates,
  defaultEstate,
  options,
  onClose,
  onSuccess,
}: {
  blok: Blok | null;
  estates: string[];
  defaultEstate: string;
  options: Awaited<ReturnType<typeof api.masterBlokOptions>> | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const str = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  const [f, setF] = useState({
    estate: blok?.estate ?? (defaultEstate || (estates.length === 1 ? estates[0] : "")),
    divisi: blok?.divisi ?? "",
    blok: blok?.blok ?? "",
    planting_material: blok?.planting_material ?? "",
    tahun_tanam: str(blok?.tahun_tanam),
    ha: str(blok?.ha),
    sph: str(blok?.sph),
    pkk: str(blok?.pkk),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((c) => ({ ...c, [k]: e.target.value }));
  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

  const submit = async () => {
    setError("");
    if (!f.estate) return setError("Pilih estate");
    if (!f.blok.trim()) return setError("Nama blok wajib diisi");
    const payload: BlokInput = {
      estate: f.estate,
      divisi: f.divisi,
      blok: f.blok,
      planting_material: f.planting_material,
      tahun_tanam: num(f.tahun_tanam),
      ha: num(f.ha),
      sph: num(f.sph),
      pkk: num(f.pkk),
    };
    setSaving(true);
    try {
      if (blok) await api.updateBlok(blok.id, payload);
      else await api.createBlok(payload);
      onSuccess();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan blok"));
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-3 py-2";
  const label = (t: string) => <label className="text-xs text-[var(--text-secondary)] mb-1 block">{t}</label>;
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-lg shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h3 className="font-semibold text-sm text-[var(--text-primary)]">{blok ? `Edit Blok ${blok.blok}` : "Tambah Blok"}</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 grid grid-cols-2 gap-3">
          <div>
            {label("Estate")}
            <select value={f.estate} onChange={set("estate")} className={inputCls}>
              <option value="">Pilih estate</option>
              {estates.map((e) => (
                <option key={e} value={e}>
                  {estateLabel(e)}
                </option>
              ))}
            </select>
          </div>
          <div>
            {label("Divisi")}
            <input value={f.divisi} onChange={set("divisi")} list="blok-divisi" placeholder="cth. A" className={inputCls} />
          </div>
          <div>
            {label("Blok")}
            <input value={f.blok} onChange={set("blok")} placeholder="cth. I-5 atau I5" className={inputCls} />
            <span className="text-[10px] text-[var(--text-muted)]">Ditulis persis: I-5 (minus 5) beda dengan I5</span>
          </div>
          <div>
            {label("Planting Material")}
            <input value={f.planting_material} onChange={set("planting_material")} list="blok-pm" placeholder="cth. Lonsum" className={inputCls} />
          </div>
          <div>
            {label("Tahun Tanam")}
            <input type="number" value={f.tahun_tanam} onChange={set("tahun_tanam")} placeholder="cth. 2013" className={inputCls} />
          </div>
          <div>
            {label("Ha")}
            <input type="number" step="0.01" value={f.ha} onChange={set("ha")} placeholder="cth. 20,41" className={inputCls} />
          </div>
          <div>
            {label("SPH")}
            <input type="number" value={f.sph} onChange={set("sph")} placeholder="pokok per Ha" className={inputCls} />
          </div>
          <div>
            {label("PKK")}
            <input type="number" value={f.pkk} onChange={set("pkk")} placeholder="jumlah pokok" className={inputCls} />
          </div>
          <datalist id="blok-divisi">
            {options?.divisi.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          <datalist id="blok-pm">
            {options?.planting_material.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          {error && <p className="col-span-2 text-xs text-[var(--accent-red)]">{error}</p>}
          <button
            onClick={submit}
            disabled={saving}
            className="col-span-2 w-full py-2.5 rounded-md text-sm font-medium bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Menyimpan..." : blok ? "Simpan Perubahan" : "Simpan Blok"}
          </button>
        </div>
      </div>
    </div>
  );
}

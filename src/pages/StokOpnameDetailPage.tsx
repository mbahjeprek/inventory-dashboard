import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Search,
  ChevronLeft,
  ChevronRight,
  Save,
  Send,
  CheckCircle2,
  Undo2,
  XCircle,
  Plus,
  Trash2,
  Check,
  Lock,
  Boxes,
  ClipboardList,
  AlertTriangle,
  CircleDashed,
  X,
  Pencil,
} from "lucide-react";
import { api, ApiError, errorText, type Opname, type OpnameLine, type PickerItem, type StockScope } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { OpnameStatusBadge } from "../components/OpnameStatusBadge";
import { canOpname } from "../lib/access";
import { StatCard } from "../components/StatCard";
import { ExportButtons } from "../components/ExportButtons";
import { ItemPickerModal } from "../components/ItemPickerModal";
import type { TableReport } from "../lib/printTable";
import { OPNAME_MODULE_LABEL, OPNAME_STATUS, expLabel, fmtQty, opnameModule, opnameWhole, round3, when } from "../lib/opname";
import { tanggalWaktu } from "../lib/datetime";

const PAGE_SIZE = 50;
type Filter = "" | "dihitung" | "belum" | "selisih" | "sesuai";
// What the counter typed, kept as text until saved (so "1," or "" can be typed freely).
// exp: klinik batch expiry as found, only once changed ('' = none).
type Edit = { fisik: string; ket: string; exp?: string };

// Indonesian number format, as shown everywhere else: "." groups thousands, "," is the decimal
// separator ("47.600" = 47600, "2,5" = 2.5).
const parseQty = (s: string): number | null | undefined => {
  const t = s.trim().replace(/\./g, "").replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined; // undefined = invalid
};
const toInput = (n: number | null) => (n === null ? "" : String(n).replace(".", ","));

// One Stok Opname: count (DRAFT), then submit, then approve / send back.
export function StokOpnameDetailPage() {
  const id = Number(useParams().id);
  const { user } = useAuth();
  const [opname, setOpname] = useState<Opname | null>(null);
  const [lines, setLines] = useState<OpnameLine[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("");
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const navigate = useNavigate();
  const [adding, setAdding] = useState<"" | "picker" | "jenis">("");
  const [pickedObat, setPickedObat] = useState<PickerItem | null>(null);
  // Rows typed into stay in the current filter (e.g. "Belum dihitung") until the filter or search
  // changes, so the reason for a difference can be filled in right away instead of the row vanishing.
  const viewKey = `${filter}|${search}`;
  const [touched, setTouched] = useState<{ key: string; ids: Set<number> }>({ key: "", ids: new Set() });
  const keep = touched.key === viewKey ? touched.ids : null;

  const load = () =>
    api
      .opname(id)
      .then((res) => {
        setOpname(res.opname);
        setLines(res.lines);
        setEdits({});
      })
      .catch(() => setNotFound(true));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const dirtyIds = Object.keys(edits).map(Number);
  const dirty = dirtyIds.length > 0;

  // Unsaved counts are lost on reload / closing the tab; the browser asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Current value of a line: what was typed (if valid) or what is saved.
  const fisikOf = (l: OpnameLine): number | null => {
    const e = edits[l.id];
    if (!e) return l.stok_fisik;
    const v = parseQty(e.fisik);
    return v === undefined ? l.stok_fisik : v;
  };
  // Klinik: the batch expiry as found (typed, saved correction or the system's).
  const expOf = (l: OpnameLine) => edits[l.id]?.exp ?? l.exp_fisik ?? l.exp;
  const expCell = (l: OpnameLine) => (expOf(l) === l.exp ? expLabel(l.exp) : `${expLabel(expOf(l))} (sistem: ${expLabel(l.exp)})`);
  const selisihOf = (l: OpnameLine) => {
    const f = fisikOf(l);
    return f === null ? null : round3(f - l.stok_sistem);
  };

  const stats = useMemo(() => {
    let dihitung = 0,
      plus = 0,
      minus = 0;
    for (const l of lines) {
      const s = selisihOf(l);
      if (s === null) continue;
      dihitung++;
      if (s > 0) plus++;
      if (s < 0) minus++;
    }
    return { total: lines.length, dihitung, plus, minus, belum: lines.length - dihitung };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, edits]);

  const filtered = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return lines.filter((l) => {
      const hay = `${l.kode} ${l.nama}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
      if (keep?.has(l.id)) return true;
      const s = selisihOf(l);
      if (filter === "dihitung") return s !== null;
      if (filter === "belum") return s === null;
      if (filter === "selisih") return s !== null && s !== 0;
      if (filter === "sesuai") return s === 0;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, edits, search, filter, keep]);

  if (notFound) {
    return (
      <div className="space-y-3">
        <BackLink />
        <p className="text-sm text-[var(--text-secondary)]">Stok opname tidak ditemukan atau Anda tidak punya akses.</p>
      </div>
    );
  }
  if (!opname) return <p className="text-sm text-[var(--text-muted)]">Memuat...</p>;

  const m = opnameModule(opname.module);
  const isSuper = user?.role === "superuser";
  const canCount = opname.status === "DRAFT" && canOpname(user, m, "opname");
  const approver = canOpname(user, m, "approve");
  const ownSubmission = opname.submitted_by === user?.id && !isSuper;
  const canApprove = opname.status === "SUBMITTED" && approver;
  const canCancel = (opname.status === "DRAFT" && (canCount || approver)) || (opname.status === "SUBMITTED" && approver);
  const isKlinik = opname.module === "KLINIK";
  const whole = opnameWhole(opname.module, opname.estate);
  const locName = `${OPNAME_MODULE_LABEL[opname.module]} ${opname.estate}`;
  const locked = opname.status === "DRAFT" || opname.status === "SUBMITTED";
  // A superuser may still correct the counts of a submitted or approved opname; on an approved one the
  // stock moves by the difference (only lines counted at approval, see PUT /api/stock-opname/:id).
  const superEdit = isSuper && (opname.status === "SUBMITTED" || opname.status === "APPROVED");
  const canEdit = canCount || superEdit;
  const editableLine = (l: OpnameLine) => canCount || (superEdit && (opname.status !== "APPROVED" || l.stok_fisik !== null));
  // The expiry of a klinik batch can be corrected until approval (the approval moves the stock to it).
  const canExp = isKlinik && (canCount || (isSuper && opname.status === "SUBMITTED"));

  const totalPages = Math.max(Math.ceil(filtered.length / PAGE_SIZE), 1);
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const invalidIds = dirtyIds.filter((lid) => {
    const v = parseQty(edits[lid].fisik);
    return v === undefined || (v !== null && whole && !Number.isInteger(v));
  });

  const setEdit = (l: OpnameLine, patch: Partial<Edit>) => {
    setTouched((t) => ({ key: viewKey, ids: new Set([...(t.key === viewKey ? t.ids : []), l.id]) }));
    setEdits((cur) => ({
      ...cur,
      [l.id]: { ...cur[l.id], fisik: cur[l.id]?.fisik ?? toInput(l.stok_fisik), ket: cur[l.id]?.ket ?? l.keterangan, ...patch },
    }));
  };

  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    if (invalidIds.length) {
      setError(whole ? "Ada stok fisik yang bukan bilangan bulat ≥ 0" : "Ada stok fisik yang bukan angka ≥ 0");
      return false;
    }
    setSaving(true);
    setError("");
    try {
      const res = await api.saveOpname(opname.id, {
        lines: dirtyIds.map((lid) => {
          const e = edits[lid];
          const sysExp = lines.find((l) => l.id === lid)?.exp;
          return {
            id: lid,
            stok_fisik: parseQty(e.fisik) ?? null,
            keterangan: e.ket,
            ...(e.exp !== undefined ? { exp_fisik: e.exp === sysExp ? null : e.exp } : {}),
          };
        }),
      });
      await load();
      setNotice(opname.status === "APPROVED" ? `Perubahan tersimpan: ${res.adjusted ?? 0} item stoknya disesuaikan` : "Hitungan tersimpan");
      setTimeout(() => setNotice(""), 2500);
      return true;
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan hitungan", true));
      if (opname.status === "APPROVED") throw e;
      return false;
    } finally {
      setSaving(false);
    }
  };

  const runAction = (action: "submit" | "return" | "approve" | "cancel") => async (catatan: string) => {
    if (action === "submit" && !(await save())) throw new Error("Simpan hitungan dulu gagal");
    const res = await api.opnameAction(opname.id, action, catatan);
    setDialog(null);
    await load();
    if (action === "approve") setNotice(`Opname disetujui: ${res.corrected ?? 0} item dikoreksi, transaksi stok dibuka kembali`);
  };

  const addLine = async (kode: string, exp = "") => {
    setError("");
    try {
      if (!(await save())) return;
      await api.addOpnameLine(opname.id, kode, exp);
      setAdding("");
      setPickedObat(null);
      await load();
      setFilter("");
      setSearch(kode);
      setPage(1);
    } catch (e) {
      setAdding("");
      setPickedObat(null);
      setError(errorText(e, "Gagal menambah baris", true));
    }
  };

  const removeLine = async (l: OpnameLine) => {
    try {
      await api.deleteOpnameLine(opname.id, l.id);
      await load();
    } catch (e) {
      setError(errorText(e, "Gagal menghapus baris", true));
    }
  };

  // Enter in Stok Fisik goes to the row's Keterangan when the count differs (the reason is needed),
  // otherwise to the next row's Stok Fisik; Enter in Keterangan goes to the next row.
  const nextOnEnter = (l: OpnameLine, field: "fisik" | "ket") => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const v = parseQty(e.currentTarget.value);
    if (field === "fisik" && typeof v === "number" && round3(v - l.stok_sistem) !== 0) {
      document.querySelector<HTMLInputElement>(`input[data-ket="${l.id}"]`)?.focus();
      return;
    }
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-fisik]"));
    const here = document.querySelector<HTMLInputElement>(`input[data-fisik="${l.id}"]`);
    inputs[inputs.indexOf(here!) + 1]?.focus();
  };

  const pickerScope: StockScope | undefined =
    opname.module === "KLINIK" ? { kind: "klinik", name: opname.estate } : opname.estate !== "NILAM" ? { kind: "gudang", name: opname.estate } : undefined;

  const buildReport = async (): Promise<TableReport> => ({
    title: `Berita Acara Stok Opname #${opname.id} - ${locName}`,
    subtitle: [
      `Tanggal opname: ${tanggalWaktu(opname.tanggal, opname.created_at)} · Status: ${OPNAME_STATUS[opname.status].label}${opname.catatan ? ` · ${opname.catatan}` : ""}`,
      [
        `Dibuat: ${opname.created_by_nama ?? "-"} (${when(opname.created_at)})`,
        opname.submitted_by_nama && `Diajukan: ${opname.submitted_by_nama} (${when(opname.submitted_at)})`,
        opname.approved_by_nama && `Disetujui: ${opname.approved_by_nama} (${when(opname.approved_at)})`,
      ]
        .filter(Boolean)
        .join(" · "),
      `Dihitung ${stats.dihitung} dari ${stats.total} item · Selisih lebih ${stats.plus} · Selisih kurang ${stats.minus}${
        filter || search ? ` · Filter: ${[filter === "dihitung" ? "Sudah dihitung" : filter === "belum" ? "Belum dihitung" : filter === "selisih" ? "Ada selisih" : filter === "sesuai" ? "Sesuai" : "", search && `"${search}"`].filter(Boolean).join(", ")}` : ""
      }`,
    ],
    landscape: true,
    columns: [
      { label: "No", align: "right" },
      { label: "Kode", nowrap: true },
      { label: "Nama" },
      ...(isKlinik ? [{ label: "Expired", nowrap: true }] : []),
      { label: "Satuan" },
      { label: "Stok Sistem", align: "right" as const },
      { label: "Stok Fisik", align: "right" as const },
      { label: "Selisih", align: "right" as const },
      { label: "Keterangan" },
    ],
    rows: filtered.map((l, i) => {
      const s = selisihOf(l);
      return [
        i + 1,
        l.kode,
        l.nama,
        ...(isKlinik ? [expCell(l)] : []),
        l.satuan,
        l.stok_sistem,
        fisikOf(l),
        s === null ? "Belum dihitung" : s,
        edits[l.id]?.ket ?? l.keterangan,
      ];
    }),
  });

  const filterChip = (f: Filter, label: string, count: number) => (
    <button
      onClick={() => (setFilter(f), setPage(1))}
      className={`text-xs px-2.5 py-1.5 rounded-md border ${
        filter === f
          ? "border-[var(--accent-blue)] bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] font-medium"
          : "border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]"
      }`}
    >
      {label} <span className="opacity-70">{count.toLocaleString("id-ID")}</span>
    </button>
  );

  const btn = "inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md disabled:opacity-50";
  const colCount = (isKlinik ? 9 : 8) + (canCount ? 1 : 0);

  return (
    <div className="space-y-4">
      <BackLink />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">
              Stok Opname #{opname.id} · {locName}
            </h1>
            <OpnameStatusBadge status={opname.status} />
          </div>
          <p className="text-sm text-[var(--text-secondary)] mt-0.5">
            Tanggal {tanggalWaktu(opname.tanggal, opname.created_at)} · Dibuat {opname.created_by_nama ?? "-"}
            {opname.submitted_by_nama && ` · Diajukan ${opname.submitted_by_nama}`}
            {opname.approved_by_nama && ` · Disetujui ${opname.approved_by_nama} (${when(opname.approved_at)})`}
            {opname.catatan && ` · ${opname.catatan}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportButtons total={filtered.length} buildReport={buildReport} fileName={`stok-opname-${opname.id}`} />
          {superEdit && (
            <button
              onClick={() =>
                opname.status === "APPROVED"
                  ? setDialog({
                      title: "Simpan perubahan opname yang sudah disetujui?",
                      message: `${dirtyIds.length} baris diubah. Stok ${locName} sekarang disesuaikan sebesar selisih perubahannya (dicatat sebagai Koreksi Stok).`,
                      confirmLabel: "Simpan & Sesuaikan Stok",
                      tone: "amber",
                      onConfirm: async () => {
                        await save();
                        setDialog(null);
                      },
                    })
                  : save()
              }
              disabled={!dirty || saving}
              className={`${btn} border border-[var(--accent-amber-border)] text-[var(--accent-amber)] hover:bg-[var(--accent-amber-bg)]`}
            >
              <Pencil size={16} /> {saving ? "Menyimpan..." : dirty ? `Simpan Perubahan (${dirtyIds.length})` : "Edit: ubah Stok Fisik di tabel"}
            </button>
          )}
          {isSuper && (
            <button
              onClick={() =>
                setDialog({
                  title: `Hapus Stok Opname #${opname.id}?`,
                  message:
                    opname.status === "APPROVED"
                      ? `Opname ini sudah disetujui. Semua koreksi stoknya dibalik (stok ${locName} dikembalikan sebesar selisih yang dulu dikoreksi), lalu opname dihapus permanen.`
                      : "Opname dihapus permanen beserta hitungannya. Stok tidak berubah.",
                  confirmLabel: "Ya, Hapus Opname",
                  cancelLabel: "Tidak",
                  tone: "red",
                  note: { label: "Alasan penghapusan", required: true },
                  onConfirm: async (catatan) => {
                    try {
                      await api.deleteOpname(opname.id, catatan);
                    } catch (e) {
                      // Undoing would take stock that has been used since: offer to drop only the record.
                      if (opname.status !== "APPROVED" || !(e instanceof ApiError && e.status === 400)) throw e;
                      setDialog({
                        title: "Koreksi tidak bisa dibalik",
                        message: `${errorText(e, "Stok tidak cukup", true)}. Stok sudah terpakai sejak opname disetujui. Hapus catatan opname saja tanpa mengubah stok?`,
                        confirmLabel: "Hapus tanpa ubah stok",
                        cancelLabel: "Batal",
                        tone: "red",
                        onConfirm: async () => {
                          await api.deleteOpname(opname.id, catatan, true);
                          setDialog(null);
                          navigate("/stok-opname", { replace: true });
                        },
                      });
                      return;
                    }
                    setDialog(null);
                    navigate("/stok-opname", { replace: true });
                  },
                })
              }
              className={`${btn} border border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]`}
            >
              <Trash2 size={16} /> Hapus
            </button>
          )}
          {canCount && (
            <>
              <button
                onClick={save}
                disabled={!dirty || saving}
                className={`${btn} border border-[var(--accent-blue-border)] text-[var(--accent-blue)] hover:bg-[var(--accent-blue-bg)]`}
              >
                <Save size={16} /> {saving ? "Menyimpan..." : dirty ? `Simpan (${dirtyIds.length})` : "Tersimpan"}
              </button>
              <button
                onClick={() =>
                  setDialog({
                    title: "Ajukan untuk approval?",
                    message: `${stats.dihitung.toLocaleString("id-ID")} dari ${stats.total.toLocaleString("id-ID")} item sudah dihitung (${
                      stats.plus + stats.minus
                    } selisih).${stats.belum ? ` ${stats.belum.toLocaleString("id-ID")} item belum dihitung, stoknya tidak akan diubah.` : ""} Setelah diajukan hitungan tidak bisa diubah kecuali dikembalikan.`,
                    confirmLabel: "Ajukan",
                    tone: "blue",
                    onConfirm: runAction("submit"),
                  })
                }
                disabled={saving || stats.dihitung === 0}
                className={`${btn} bg-[var(--accent-blue)] text-white hover:opacity-90`}
              >
                <Send size={16} /> Ajukan
              </button>
            </>
          )}
          {canApprove && (
            <>
              <button
                onClick={() =>
                  setDialog({
                    title: "Kembalikan ke penghitung?",
                    message: "Opname kembali ke status Sedang Dihitung supaya hitungannya bisa diperbaiki. Tulis apa yang perlu dicek.",
                    confirmLabel: "Kembalikan",
                    tone: "amber",
                    note: { label: "Alasan", required: true },
                    onConfirm: runAction("return"),
                  })
                }
                className={`${btn} border border-[var(--accent-amber-border)] text-[var(--accent-amber)] hover:bg-[var(--accent-amber-bg)]`}
              >
                <Undo2 size={16} /> Kembalikan
              </button>
              <button
                onClick={() =>
                  setDialog({
                    title: "Setujui dan terapkan koreksi?",
                    message: `${(stats.plus + stats.minus).toLocaleString("id-ID")} item akan dikoreksi ke stok fisiknya (${stats.plus} lebih, ${stats.minus} kurang). Item yang belum dihitung tidak diubah. Setelah itu transaksi stok ${locName} dibuka kembali.`,
                    confirmLabel: "Setujui",
                    tone: "green",
                    onConfirm: runAction("approve"),
                  })
                }
                disabled={ownSubmission}
                title={ownSubmission ? "Opname yang Anda ajukan sendiri harus disetujui orang lain" : ""}
                className={`${btn} bg-[var(--accent-green)] text-white hover:opacity-90`}
              >
                <CheckCircle2 size={16} /> Setujui
              </button>
            </>
          )}
          {canCancel && (
            <button
              onClick={() =>
                setDialog({
                  title: "Batalkan opname ini?",
                  message: `Hitungan tidak diterapkan ke stok dan transaksi stok ${locName} dibuka kembali. Tidak bisa dibatalkan.`,
                  confirmLabel: "Ya, Batalkan Opname",
                  cancelLabel: "Tidak",
                  tone: "red",
                  note: { label: "Alasan (opsional)", required: false },
                  onConfirm: runAction("cancel"),
                })
              }
              className={`${btn} border border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]`}
            >
              <XCircle size={16} /> Batalkan
            </button>
          )}
        </div>
      </div>

      {locked && (
        <div className="flex gap-2 text-sm rounded-lg border border-[var(--accent-amber-border)] bg-[var(--accent-amber-bg)] text-[#92400e] px-4 py-3">
          <Lock size={16} className="shrink-0 mt-0.5" />
          <div>
            {opname.status === "DRAFT" ? (
              <>
                Transaksi stok <b>{locName}</b> dikunci selama opname berjalan. Isi Stok Fisik hasil hitungan, simpan, lalu klik <b>Ajukan</b>.
              </>
            ) : (
              <>
                Menunggu approval. Transaksi stok <b>{locName}</b> tetap dikunci sampai opname disetujui atau dibatalkan.
                {ownSubmission && approver && " Opname yang Anda ajukan sendiri harus disetujui orang lain."}
              </>
            )}
            {opname.status === "DRAFT" && opname.catatan_review && (
              <div className="mt-1">
                <b>Dikembalikan:</b> {opname.catatan_review}
              </div>
            )}
          </div>
        </div>
      )}
      {opname.status === "BATAL" && opname.catatan_review && (
        <div className="text-sm rounded-lg border border-[var(--border)] bg-white px-4 py-3 text-[var(--text-secondary)]">
          <b>Alasan dibatalkan:</b> {opname.catatan_review}
        </div>
      )}
      {notice && (
        <div className="text-sm rounded-lg border border-[var(--accent-green-border)] bg-[var(--accent-green-bg)] text-[var(--accent-green)] px-4 py-2.5">
          {notice}
        </div>
      )}
      {error && <p className="text-sm text-[var(--accent-red)]">{error}</p>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Total Item"
          value={stats.total.toLocaleString("id-ID")}
          icon={Boxes}
          tone="blue"
          title="Tampilkan semua item"
          onClick={() => (setFilter(""), setPage(1))}
        />
        <StatCard
          label="Sudah Dihitung"
          value={stats.dihitung.toLocaleString("id-ID")}
          suffix={stats.total ? `${Math.round((stats.dihitung / stats.total) * 100)}%` : undefined}
          icon={ClipboardList}
          tone="green"
          active={filter === "dihitung"}
          onClick={() => (setFilter(filter === "dihitung" ? "" : "dihitung"), setPage(1))}
        />
        <StatCard
          label="Ada Selisih"
          value={(stats.plus + stats.minus).toLocaleString("id-ID")}
          suffix={stats.plus + stats.minus ? `+${stats.plus} / −${stats.minus}` : undefined}
          icon={AlertTriangle}
          tone="amber"
          active={filter === "selisih"}
          onClick={() => (setFilter(filter === "selisih" ? "" : "selisih"), setPage(1))}
        />
        <StatCard
          label="Belum Dihitung"
          value={stats.belum.toLocaleString("id-ID")}
          icon={CircleDashed}
          tone="red"
          active={filter === "belum"}
          onClick={() => (setFilter(filter === "belum" ? "" : "belum"), setPage(1))}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={search}
            onChange={(e) => (setSearch(e.target.value), setPage(1))}
            placeholder="Cari kode atau nama..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue-border)]"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {filterChip("", "Semua", stats.total)}
          {filterChip("belum", "Belum dihitung", stats.belum)}
          {filterChip("selisih", "Ada selisih", stats.plus + stats.minus)}
          {filterChip("sesuai", "Sesuai", stats.dihitung - stats.plus - stats.minus)}
        </div>
        {canCount && opname.module !== "BBM" && (
          <button
            onClick={() => setAdding(opname.module === "PUPUK" || opname.module === "OLI" ? "jenis" : "picker")}
            className={`${btn} border border-[var(--border)] text-[var(--text-primary)] hover:bg-[#f1f5f9]`}
            title="Barang yang ditemukan saat hitung tapi tidak ada di daftar"
          >
            <Plus size={16} /> Tambah {isKlinik ? "Obat/Batch" : opname.module === "PUPUK" ? "Jenis Pupuk" : opname.module === "OLI" ? "Jenis Oli" : "Barang"}
          </button>
        )}
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="grid-table data-table text-sm">
            <thead>
              <tr className="bg-[#f8fafc] text-[var(--text-secondary)] text-xs uppercase">
                <th className="px-4 py-2.5 text-right">No</th>
                <th className="px-4 py-2.5 text-left">Kode</th>
                <th className="px-4 py-2.5 text-left">Nama</th>
                {isKlinik && <th className="px-4 py-2.5 text-left">Expired</th>}
                <th className="px-4 py-2.5 text-left">Satuan</th>
                <th className="px-4 py-2.5 text-right">Stok Sistem</th>
                <th className="px-4 py-2.5 text-right">Stok Fisik</th>
                <th className="px-4 py-2.5 text-right">Selisih</th>
                <th className="px-4 py-2.5 text-left">Keterangan</th>
                {canCount && <th className="px-2 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    {lines.length ? "Tidak ada item yang cocok dengan filter" : "Tidak ada stok di lokasi ini saat opname dibuat"}
                  </td>
                </tr>
              ) : (
                pageRows.map((l, idx) => {
                  const s = selisihOf(l);
                  const e = edits[l.id];
                  const invalid = invalidIds.includes(l.id);
                  return (
                    <tr key={l.id} className={`border-t border-[var(--border)] ${e ? "bg-[#fffbeb]" : "hover:bg-[#f8fafc]"}`}>
                      <td className="px-4 py-2 text-right text-[var(--text-muted)]">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                      <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">{l.kode}</td>
                      <td className="col-grow px-4 py-2">
                        {l.nama}
                        {l.ditambahkan && <span className="ml-1.5 text-[10px] uppercase text-[var(--accent-blue)]">ditambahkan</span>}
                      </td>
                      {isKlinik && (
                        <td className="px-4 py-2 whitespace-nowrap text-[var(--text-secondary)]">
                          {canExp ? (
                            <div className="flex flex-col gap-0.5">
                              <input
                                type="date"
                                value={expOf(l)}
                                onChange={(ev) => setEdit(l, { exp: ev.target.value })}
                                title="Tanggal expired di fisik barang (kosongkan kalau tidak ada)"
                                aria-label={`Expired ${l.nama}`}
                                className={`text-sm rounded-md border px-2 py-1 ${
                                  expOf(l) !== l.exp ? "border-[var(--accent-amber-border)] bg-[var(--accent-amber-bg)]" : "border-[var(--border)]"
                                }`}
                              />
                              {expOf(l) !== l.exp && <span className="text-[11px] text-[var(--text-muted)]">Sistem: {expLabel(l.exp)}</span>}
                            </div>
                          ) : (
                            expCell(l)
                          )}
                        </td>
                      )}
                      <td className="px-4 py-2 text-[var(--text-secondary)] whitespace-nowrap">{l.satuan || "-"}</td>
                      <td className="px-4 py-2 text-right">{fmtQty(l.stok_sistem)}</td>
                      <td className="px-4 py-2 text-right">
                        {editableLine(l) ? (
                          <div className="inline-flex items-center gap-1">
                            <input
                              data-fisik={l.id}
                              inputMode="decimal"
                              value={e ? e.fisik : toInput(l.stok_fisik)}
                              onChange={(ev) => setEdit(l, { fisik: ev.target.value })}
                              onKeyDown={nextOnEnter(l, "fisik")}
                              placeholder="-"
                              aria-label={`Stok fisik ${l.nama}`}
                              className={`w-24 text-right text-sm rounded-md border px-2 py-1 ${
                                invalid ? "border-[var(--accent-red)] bg-[var(--accent-red-bg)]" : "border-[var(--border)]"
                              }`}
                            />
                            <button
                              onClick={() => setEdit(l, { fisik: toInput(l.stok_sistem) })}
                              title="Sesuai sistem"
                              className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent-green)] hover:bg-[var(--accent-green-bg)]"
                            >
                              <Check size={14} />
                            </button>
                          </div>
                        ) : l.stok_fisik === null ? (
                          <span className="text-[var(--text-muted)]">-</span>
                        ) : (
                          fmtQty(l.stok_fisik)
                        )}
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-medium whitespace-nowrap ${
                          s === null ? "text-[var(--text-muted)] font-normal" : s > 0 ? "text-[var(--accent-green)]" : s < 0 ? "text-[var(--accent-red)]" : "text-[var(--text-secondary)] font-normal"
                        }`}
                      >
                        {s === null ? "-" : s === 0 ? "0" : `${s > 0 ? "+" : "−"}${fmtQty(Math.abs(s))}`}
                      </td>
                      <td className="col-grow px-4 py-2">
                        {editableLine(l) ? (
                          <input
                            data-ket={l.id}
                            onKeyDown={nextOnEnter(l, "ket")}
                            value={e ? e.ket : l.keterangan}
                            onChange={(ev) => setEdit(l, { ket: ev.target.value })}
                            placeholder={s ? "Alasan selisih" : ""}
                            className="w-full text-sm rounded-md border border-[var(--border)] px-2 py-1"
                          />
                        ) : (
                          <span className="text-[var(--text-secondary)]">{l.keterangan || "-"}</span>
                        )}
                      </td>
                      {canCount && (
                        <td className="px-2 py-2">
                          {l.ditambahkan && (
                            <button
                              onClick={() => removeLine(l)}
                              title="Hapus baris ini"
                              className="p-1.5 rounded-md border border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-[var(--border)] text-sm text-[var(--text-secondary)]">
          <span>
            {filtered.length.toLocaleString("id-ID")} item · Halaman {page} dari {totalPages}
            {canEdit && <span className="text-xs text-[var(--text-muted)]"> · Enter = lanjut (ke Keterangan kalau ada selisih)</span>}
          </span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded-md border border-[var(--border)] disabled:opacity-40">
              <ChevronLeft size={16} />
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="p-1.5 rounded-md border border-[var(--border)] disabled:opacity-40"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {dialog && <ActionDialog key={dialog.title} spec={dialog} onClose={() => setDialog(null)} />}
      {adding === "picker" && !pickedObat && (
        <ItemPickerModal
          scope={pickerScope}
          onClose={() => setAdding("")}
          onSelect={(item) => (isKlinik ? setPickedObat(item) : addLine(item.kode))}
        />
      )}
      {pickedObat && (
        <SmallFormModal
          title={`Batch ${pickedObat.nama}`}
          label="Tanggal expired (kosongkan kalau tidak ada)"
          type="date"
          confirmLabel="Tambah"
          onClose={() => (setPickedObat(null), setAdding(""))}
          onConfirm={(exp) => addLine(pickedObat.kode, exp)}
        />
      )}
      {adding === "jenis" && (
        <AddJenisModal oli={opname.module === "OLI"} estate={opname.estate} onClose={() => setAdding("")} onConfirm={(jenis) => addLine(jenis)} />
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/stok-opname" className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
      <ArrowLeft size={16} /> Daftar Stok Opname
    </Link>
  );
}

type DialogSpec = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone: "blue" | "green" | "amber" | "red";
  note?: { label: string; required: boolean };
  onConfirm: (catatan: string) => Promise<void>;
};

const TONE_BTN: Record<DialogSpec["tone"], string> = {
  blue: "bg-[var(--accent-blue)]",
  green: "bg-[var(--accent-green)]",
  amber: "bg-[var(--accent-amber)]",
  red: "bg-[var(--accent-red)]",
};

function ActionDialog({ spec, onClose }: { spec: DialogSpec; onClose: () => void }) {
  const [catatan, setCatatan] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirm = async () => {
    if (spec.note?.required && !catatan.trim()) {
      setError(`${spec.note.label} wajib diisi`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await spec.onConfirm(catatan.trim());
    } catch (e) {
      setError(errorText(e, e instanceof Error && !e.message.startsWith("API error") ? e.message : "Gagal memproses opname", true));
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl p-5">
        <h3 className="font-semibold text-sm text-[var(--text-primary)]">{spec.title}</h3>
        <p className="text-sm text-[var(--text-secondary)] mt-1.5">{spec.message}</p>
        {spec.note && (
          <div className="mt-3">
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">{spec.note.label}</label>
            <textarea
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              rows={3}
              className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
            />
          </div>
        )}
        {error && <p className="text-xs text-[var(--accent-red)] mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-3.5 py-2 rounded-md text-sm border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]"
          >
            {spec.cancelLabel ?? "Batal"}
          </button>
          <button
            onClick={confirm}
            disabled={busy}
            className={`px-3.5 py-2 rounded-md text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 ${TONE_BTN[spec.tone]}`}
          >
            {busy ? "Memproses..." : spec.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function SmallFormModal({
  title,
  label,
  type = "text",
  options,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  title: string;
  label: string;
  type?: "text" | "date";
  options?: string[];
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (value: string) => Promise<void> | void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h3 className="font-semibold text-sm text-[var(--text-primary)]">{title}</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">
          <label className="text-xs text-[var(--text-secondary)] mb-1 block">{label}</label>
          <input
            autoFocus
            type={type}
            list={options ? "opname-options" : undefined}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
          />
          {options && (
            <datalist id="opname-options">
              {options.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          )}
        </div>
        <div className="px-5 py-4 border-t border-[var(--border)]">
          <button
            onClick={async () => {
              setBusy(true);
              await onConfirm(value.trim());
              setBusy(false);
            }}
            disabled={busy || (type === "text" && !value.trim())}
            className="w-full py-2.5 rounded-md text-sm font-medium bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Menyimpan..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// A jenis pupuk / jenis oli line, picked from the known ones or typed.
function AddJenisModal({ oli, estate, onClose, onConfirm }: { oli: boolean; estate: string; onClose: () => void; onConfirm: (jenis: string) => Promise<void> }) {
  const [jenis, setJenis] = useState<string[]>([]);
  useEffect(() => {
    (oli ? api.oliOptions(estate) : api.pupukOptions(estate)).then((r) => setJenis(r.jenis)).catch(() => setJenis([]));
  }, [estate, oli]);
  const noun = oli ? "Oli" : "Pupuk";
  return <SmallFormModal title={`Tambah Jenis ${noun}`} label={`Jenis ${noun.toLowerCase()}`} options={jenis} confirmLabel="Tambah" onClose={onClose} onConfirm={onConfirm} />;
}

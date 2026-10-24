import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ExternalLink,
  Lock,
  LockOpen,
  Plus,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import { api, errorText, type Sop, type SopInput } from "../lib/api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ExportButtons } from "../components/ExportButtons";
import { ActivityLogButton } from "../components/ActivityLogButton";
import type { SectionReport } from "../lib/printTable";
import { jenisOf } from "../lib/dokumen";
import { SOP_BAGIAN, SOP_STATUS, statusOf } from "../lib/sop";

// Master Data > Daftar SOP: the SOPs the kebun needs, per bagian (1-14 as the ISPO / RSPO checklist, 15 Umum
// for the rest), each with its no. dokumen, revisi, tanggal berlaku, PIC, status and the link to the file.
// The star marks the ones almost always checked at an ISPO / RSPO audit. Seen with Lihat Daftar SOP; with Ubah
// an account types in place (saved when a cell is left) in the SOPs not locked and adds SOPs under any bagian;
// with Kunci it locks / unlocks an SOP or a whole bagian (gembok) and changes the locked ones too. Every change
// is in the Log (module SOP).
const cellCls =
  "w-full bg-transparent px-2 py-1.5 text-sm rounded border border-transparent hover:border-[var(--border)] focus:border-[var(--accent-blue)] focus:bg-white focus:outline-none";
const selectCls =
  "text-sm rounded-md border border-[var(--border)] px-3 py-2 bg-white";
const urlOk = (u: string) => /^https?:\/\/\S+$/i.test(u.trim());
const fmtTgl = (iso: string) =>
  iso
    ? new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "";

type Row = SopInput & {
  id: number | null;
  key: string;
  urut: number;
  dikunci: boolean;
  boleh_ubah: boolean;
};
const toRow = (s: Sop): Row => ({
  id: s.id,
  key: `s${s.id}`,
  urut: s.urut,
  bagian: s.bagian,
  judul: s.judul,
  audit: s.audit,
  no_dokumen: s.no_dokumen,
  revisi: s.revisi,
  tgl_berlaku: s.tgl_berlaku,
  pic: s.pic,
  status: s.status,
  url: s.url,
  keterangan: s.keterangan,
  dikunci: s.dikunci,
  boleh_ubah: s.boleh_ubah,
});
const emptyRow = (bagian: string): Row => ({
  id: null,
  key: `n${Date.now()}${Math.random()}`,
  urut: Number.MAX_SAFE_INTEGER,
  dikunci: false,
  boleh_ubah: true,
  bagian,
  judul: "",
  audit: false,
  no_dokumen: "",
  revisi: "",
  tgl_berlaku: "",
  pic: "",
  status: "BELUM",
  url: "",
  keterangan: "",
});

function StatusPill({ status }: { status: string }) {
  const s = statusOf(status);
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ color: s.color, background: s.bg }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: s.color }}
      />
      {s.label}
    </span>
  );
}

function AuditStar({ on, onClick }: { on: boolean; onClick?: () => void }) {
  const icon = (
    <Star
      size={14}
      className={on ? "fill-[#f59e0b] text-[#f59e0b]" : "text-[#cbd5e1]"}
    />
  );
  const title = on
    ? "Hampir selalu diperiksa saat audit ISPO / RSPO"
    : "Tandai sebagai SOP yang diperiksa saat audit ISPO / RSPO";
  if (!onClick)
    return on ? (
      <span title={title} className="inline-flex shrink-0 mt-0.5">
        {icon}
      </span>
    ) : null;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="p-1 rounded hover:bg-[#fff7e6] shrink-0"
    >
      {icon}
    </button>
  );
}

export function SopPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [edit, setEdit] = useState(false);
  const [kunciHak, setKunciHak] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [bagian, setBagian] = useState("");
  const [auditSaja, setAuditSaja] = useState(false);
  const [tutup, setTutup] = useState<Record<string, boolean>>({});
  const [hapus, setHapus] = useState<Row | null>(null);

  useEffect(() => {
    api
      .sop()
      .then(
        (r) => (
          setRows(r.data.map(toRow)),
          setEdit(r.edit),
          setKunciHak(r.kunci),
          setError("")
        ),
      )
      .catch(
        (e) => (setRows([]), setError(errorText(e, "Gagal memuat daftar SOP"))),
      );
  }, []);

  const q = search.trim().toLowerCase();
  const filtering = !!(q || status || bagian || auditSaja);
  const cocok = (r: Row) =>
    r.id === null ||
    ((!status || r.status === status) &&
      (!auditSaja || r.audit) &&
      (!q ||
        [r.judul, r.no_dokumen, r.pic, r.keterangan].some((v) =>
          v.toLowerCase().includes(q),
        )));
  // Per bagian: every row (for the numbering and the progress) and the rows the filters keep.
  const groups = useMemo(
    () =>
      SOP_BAGIAN.filter((b) => !bagian || b.value === bagian).map((b) => {
        const semua = (rows ?? [])
          .filter((r) => r.bagian === b.value)
          .sort((x, y) => x.urut - y.urut);
        return { b, semua, tampil: semua.filter(cocok) };
      }),
    [rows, q, status, bagian, auditSaja], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const saved = (rows ?? []).filter((r) => r.id !== null);
  const n = (f: (r: Row) => boolean) => saved.filter(f).length;
  const total = saved.length;
  const berlaku = n((r) => r.status === "BERLAKU");
  const audit = n((r) => r.audit);
  const auditBerlaku = n((r) => r.audit && r.status === "BERLAKU");
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

  const tambah = (bg: string) => {
    setTutup((t) => ({ ...t, [bg]: false }));
    setRows((r) => [...(r ?? []), emptyRow(bg)]);
  };
  const onSaved = (key: string, d: Row) =>
    setRows((r) => (r ?? []).map((x) => (x.key === key ? d : x)));
  // Gembok: one SOP, or every SOP of a bagian at once.
  const kunciSop = async (r: Row) => {
    if (r.id === null) return;
    try {
      await api.sopKunci({ id: r.id }, !r.dikunci);
      setRows((x) =>
        (x ?? []).map((y) =>
          y.key === r.key ? { ...y, dikunci: !r.dikunci } : y,
        ),
      );
    } catch (e) {
      setError(errorText(e, "Gagal mengunci SOP"));
    }
  };
  const kunciBagian = async (bg: string, kunci: boolean) => {
    try {
      await api.sopKunci({ bagian: bg }, kunci);
      setRows((x) =>
        (x ?? []).map((y) =>
          y.bagian === bg && y.id !== null ? { ...y, dikunci: kunci } : y,
        ),
      );
    } catch (e) {
      setError(errorText(e, "Gagal mengunci bagian"));
    }
  };
  // A button for Kunci, else a sign that the SOP is locked.
  const gembok = (r: Row) =>
    r.id === null ? null : kunciHak ? (
      <button
        onClick={() => kunciSop(r)}
        title={
          r.dikunci
            ? "Dikunci: hanya pemegang hak Kunci yang bisa mengubah / menghapus. Klik untuk membuka kunci."
            : "Kunci supaya tidak bisa diubah / dihapus"
        }
        className={`p-1.5 rounded hover:bg-[#f1f5f9] ${r.dikunci ? "text-[var(--accent-amber)]" : "text-[var(--text-muted)]"}`}
      >
        {r.dikunci ? <Lock size={14} /> : <LockOpen size={14} />}
      </button>
    ) : r.dikunci ? (
      <span
        title="Dikunci: tidak bisa diubah / dihapus"
        className="inline-flex p-1.5 text-[var(--accent-amber)]"
      >
        <Lock size={14} />
      </span>
    ) : null;
  const aksiCol = edit || kunciHak || saved.some((r) => r.dikunci);
  const doHapus = async () => {
    if (!hapus) return;
    const target = hapus;
    setHapus(null);
    try {
      if (target.id !== null) await api.sopHapus(target.id);
      setRows((r) => (r ?? []).filter((x) => x.key !== target.key));
    } catch (e) {
      setError(errorText(e, "Gagal menghapus"));
    }
  };

  const buildReport = async (): Promise<SectionReport> => ({
    title: "Daftar SOP",
    subtitle: [
      `${total} SOP · ${berlaku} berlaku (${pct(berlaku, total)}%) · ${audit} diperiksa saat audit ISPO / RSPO (★), ${auditBerlaku} berlaku`,
      ...(filtering ? ["Sesuai filter di layar"] : []),
    ],
    landscape: true,
    sections: groups
      .filter((g) => g.tampil.some((r) => r.id !== null))
      .map(({ b, semua, tampil }) => ({
        heading: `${b.no}. ${b.label}${b.catatan ? ` (${b.catatan})` : ""}`,
        columns: [
          { label: "No", nowrap: true },
          { label: "Nama SOP" },
          { label: "Audit", nowrap: true },
          { label: "No. Dokumen", nowrap: true },
          { label: "Rev.", nowrap: true },
          { label: "Tgl Berlaku", nowrap: true },
          { label: "PIC" },
          { label: "Status", nowrap: true },
          { label: "Link" },
          { label: "Keterangan" },
        ],
        rows: tampil
          .filter((r) => r.id !== null)
          .map((r) => [
            `${b.no}.${semua.indexOf(r) + 1}`,
            r.judul,
            r.audit ? "★" : "",
            r.no_dokumen,
            r.revisi,
            fmtTgl(r.tgl_berlaku),
            r.pic,
            statusOf(r.status).label,
            r.url,
            r.keterangan,
          ]),
      })),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">
            Daftar SOP
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Standard Operating Procedure per bagian kebun, dengan no. dokumen,
            PIC, status dan link file-nya.{" "}
            {edit
              ? "Klik sel untuk mengetik; tersimpan otomatis saat pindah sel. SOP bergembok tidak bisa diubah."
              : "Klik nama SOP untuk membuka file-nya."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActivityLogButton module="SOP" estate="" />
          <ExportButtons
            total={total}
            buildReport={buildReport}
            fileName="daftar-sop"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label="Total SOP"
          value={total}
          note={`${SOP_BAGIAN.length} bagian`}
        />
        <Stat
          label="Berlaku"
          value={berlaku}
          note={`${pct(berlaku, total)}% dari semua SOP`}
          color="#15803d"
          bar={pct(berlaku, total)}
        />
        <Stat
          label="Draft / perlu revisi"
          value={n((r) => r.status === "DRAFT" || r.status === "REVISI")}
          note="Sedang disusun / diperbaiki"
          color="#b45309"
        />
        <Stat
          label="Wajib audit ISPO / RSPO"
          value={`${auditBerlaku} / ${audit}`}
          note="SOP bertanda ★ yang sudah berlaku"
          color="#b45309"
          bar={pct(auditBerlaku, audit)}
          star
        />
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama SOP, no. dokumen atau PIC..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue-border)]"
          />
        </div>
        <select
          value={bagian}
          onChange={(e) => setBagian(e.target.value)}
          className={selectCls}
          aria-label="Bagian"
        >
          <option value="">Semua bagian</option>
          {SOP_BAGIAN.map((b) => (
            <option key={b.value} value={b.value}>
              {b.no}. {b.label}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={selectCls}
          aria-label="Status"
        >
          <option value="">Semua status</option>
          {SOP_STATUS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border border-[var(--border)] bg-white cursor-pointer select-none">
          <input
            type="checkbox"
            checked={auditSaja}
            onChange={(e) => setAuditSaja(e.target.checked)}
          />
          <Star size={14} className="fill-[#f59e0b] text-[#f59e0b]" /> Audit
          saja
        </label>
      </div>

      {error && <p className="text-sm text-[var(--accent-red)]">{error}</p>}

      {rows === null ? (
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-4 py-8 text-center text-sm text-[var(--text-muted)]">
          Memuat...
        </div>
      ) : (
        <div className="space-y-3">
          {groups
            .filter(
              (g) => !filtering || g.tampil.length || g.b.value === bagian,
            )
            .map(({ b, semua, tampil }) => {
              const ada = semua.filter((r) => r.id !== null);
              const ok = ada.filter((r) => r.status === "BERLAKU").length;
              const bAudit = ada.filter((r) => r.audit).length;
              const open = !tutup[b.value];
              const nKunci = ada.filter((r) => r.dikunci).length;
              const semuaKunci = ada.length > 0 && nKunci === ada.length;
              return (
                <section
                  key={b.value}
                  className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden"
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setTutup((t) => ({ ...t, [b.value]: open }))}
                    onKeyDown={(e) =>
                      (e.key === "Enter" || e.key === " ") &&
                      (e.preventDefault(),
                      setTutup((t) => ({ ...t, [b.value]: open })))
                    }
                    className="w-full flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left bg-[#f3f9ef] hover:bg-[#eaf5e3] border-b border-[var(--border)] cursor-pointer select-none"
                  >
                    <span className="w-7 h-7 shrink-0 rounded-md bg-[#1f6f43] text-white text-xs font-semibold flex items-center justify-center">
                      {b.no}
                    </span>
                    <span className="flex-1 min-w-[180px]">
                      <span className="font-semibold text-[var(--text-primary)]">
                        {b.label}
                      </span>
                      {b.catatan && (
                        <span className="ml-2 text-xs text-[var(--text-muted)]">
                          ({b.catatan})
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
                      <span>{ada.length} SOP</span>
                      {bAudit > 0 && (
                        <span
                          className="inline-flex items-center gap-1"
                          title="Diperiksa saat audit ISPO / RSPO"
                        >
                          <Star
                            size={12}
                            className="fill-[#f59e0b] text-[#f59e0b]"
                          />{" "}
                          {bAudit}
                        </span>
                      )}
                      <span
                        className="inline-flex items-center gap-2"
                        title="SOP yang sudah berlaku"
                      >
                        <span className="w-20 h-1.5 rounded-full bg-[#dfe7dc] overflow-hidden">
                          <span
                            className="block h-full bg-[var(--accent-green)]"
                            style={{ width: `${pct(ok, ada.length)}%` }}
                          />
                        </span>
                        {ok}/{ada.length} berlaku
                      </span>
                      {kunciHak && ada.length > 0 ? (
                        <button
                          onClick={(e) => (
                            e.stopPropagation(),
                            kunciBagian(b.value, !semuaKunci)
                          )}
                          title={
                            semuaKunci
                              ? "Buka kunci semua SOP di bagian ini"
                              : "Kunci semua SOP di bagian ini"
                          }
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border bg-white hover:bg-[#f8fafc] ${
                            nKunci
                              ? "border-[var(--accent-amber-border)] text-[var(--accent-amber)]"
                              : "border-[var(--border)] text-[var(--text-secondary)]"
                          }`}
                        >
                          {semuaKunci ? (
                            <Lock size={12} />
                          ) : (
                            <LockOpen size={12} />
                          )}
                          {semuaKunci
                            ? "Terkunci"
                            : nKunci
                              ? `${nKunci} dikunci`
                              : "Kunci"}
                        </button>
                      ) : (
                        nKunci > 0 && (
                          <span
                            className="inline-flex items-center gap-1 text-[var(--accent-amber)]"
                            title="SOP yang dikunci"
                          >
                            <Lock size={12} />{" "}
                            {semuaKunci ? "Terkunci" : nKunci}
                          </span>
                        )
                      )}
                      <ChevronDown
                        size={16}
                        className={`transition-transform ${open ? "" : "-rotate-90"}`}
                      />
                    </span>
                  </div>
                  {open && (
                    <>
                      <div className="table-scroll">
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr className="text-left text-xs text-[var(--text-secondary)] bg-[#fafbfc]">
                              <th className="px-3 py-2 w-14 text-right font-medium">
                                No
                              </th>
                              <th className="px-3 py-2 min-w-[280px] font-medium">
                                Nama SOP
                              </th>
                              <th className="px-3 py-2 min-w-[150px] font-medium">
                                No. Dokumen
                              </th>
                              <th className="px-3 py-2 w-16 font-medium">
                                Rev.
                              </th>
                              <th className="px-3 py-2 min-w-[130px] font-medium">
                                Tgl Berlaku
                              </th>
                              <th className="px-3 py-2 min-w-[130px] font-medium">
                                PIC
                              </th>
                              <th className="px-3 py-2 min-w-[130px] font-medium">
                                Status
                              </th>
                              <th className="px-3 py-2 min-w-[180px] font-medium">
                                Link File
                              </th>
                              <th className="px-3 py-2 min-w-[150px] font-medium">
                                Keterangan
                              </th>
                              {aksiCol && <th className="px-2 py-2 w-16" />}
                            </tr>
                          </thead>
                          <tbody>
                            {!tampil.length ? (
                              <tr>
                                <td
                                  colSpan={aksiCol ? 10 : 9}
                                  className="px-4 py-5 text-center text-xs text-[var(--text-muted)] border-t border-[var(--border)]"
                                >
                                  {filtering && semua.length
                                    ? "Tidak ada SOP yang cocok di bagian ini."
                                    : "Belum ada SOP di bagian ini."}
                                </td>
                              </tr>
                            ) : (
                              tampil.map((r) => {
                                const no =
                                  r.id === null
                                    ? ""
                                    : `${b.no}.${semua.indexOf(r) + 1}`;
                                return edit && r.boleh_ubah ? (
                                  <EditRow
                                    key={r.key}
                                    no={no}
                                    row={r}
                                    kode={b.kode}
                                    extra={gembok(r)}
                                    onSaved={(d) =>
                                      onSaved(r.key, {
                                        ...d,
                                        dikunci: r.dikunci,
                                        boleh_ubah: r.boleh_ubah,
                                      })
                                    }
                                    onHapus={() =>
                                      r.id === null && !r.judul
                                        ? setRows((x) =>
                                            (x ?? []).filter(
                                              (y) => y.key !== r.key,
                                            ),
                                          )
                                        : setHapus(r)
                                    }
                                  />
                                ) : (
                                  <ViewRow
                                    key={r.key}
                                    no={no}
                                    row={r}
                                    aksiCol={aksiCol}
                                    extra={gembok(r)}
                                  />
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                      {edit && (
                        <button
                          onClick={() => tambah(b.value)}
                          className="w-full flex items-center gap-1.5 px-4 py-2 text-sm text-[var(--accent-blue)] border-t border-[var(--border)] hover:bg-[#f8fafc]"
                        >
                          <Plus size={15} /> Tambah SOP di {b.label}
                        </button>
                      )}
                    </>
                  )}
                </section>
              );
            })}
        </div>
      )}

      <p className="text-[11px] text-[var(--text-muted)]">
        <Star
          size={11}
          className="inline fill-[#f59e0b] text-[#f59e0b] -mt-0.5"
        />{" "}
        = hampir selalu diperiksa saat audit ISPO / RSPO. SOP yang tidak masuk
        bagian 1-14 dimasukkan ke bagian 15 (Umum).{" "}
        <Lock size={11} className="inline -mt-0.5" /> = dikunci, tidak bisa
        diubah / dihapus kecuali oleh pemegang hak Kunci Daftar SOP. Semua
        perubahan tercatat di Log. Siapa yang boleh membuka file tetap diatur
        dari tombol Share di Google Drive.
      </p>

      {hapus && (
        <ConfirmDialog
          message={`Hapus SOP "${hapus.judul || "baris ini"}" dari daftar? File aslinya di Google Drive tidak ikut terhapus.`}
          onCancel={() => setHapus(null)}
          onConfirm={doHapus}
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  color,
  bar,
  star,
}: {
  label: string;
  value: number | string;
  note: string;
  color?: string;
  bar?: number;
  star?: boolean;
}) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-4 py-3">
      <p className="text-xs text-[var(--text-secondary)] flex items-center gap-1">
        {star && <Star size={12} className="fill-[#f59e0b] text-[#f59e0b]" />}
        {label}
      </p>
      <p
        className="text-2xl font-semibold mt-0.5"
        style={{ color: color ?? "var(--text-primary)" }}
      >
        {value}
      </p>
      {bar !== undefined && (
        <div className="h-1.5 rounded-full bg-[#eef2f6] overflow-hidden mt-1.5">
          <div
            className="h-full"
            style={{ width: `${bar}%`, background: color }}
          />
        </div>
      )}
      <p className="text-[11px] text-[var(--text-muted)] mt-1">{note}</p>
    </div>
  );
}

function LinkCell({ url }: { url: string }) {
  if (!urlOk(url)) return <span className="text-[var(--text-muted)]">-</span>;
  const j = jenisOf(url);
  const Icon = j.icon;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-[var(--accent-blue)] hover:underline"
      title={url}
    >
      <Icon size={14} style={{ color: j.color }} className="shrink-0" />
      Buka {j.label}
      <ExternalLink size={12} className="text-[var(--text-muted)]" />
    </a>
  );
}

function ViewRow({
  no,
  row,
  aksiCol,
  extra,
}: {
  no: string;
  row: Row;
  aksiCol: boolean;
  extra?: React.ReactNode;
}) {
  return (
    <tr className="border-t border-[var(--border)] hover:bg-[#f8fafc] align-top">
      <td className="px-3 py-2 text-right text-[var(--text-muted)] tabular-nums">
        {no}
      </td>
      <td className="px-3 py-2">
        <span className="flex items-start gap-1.5">
          {urlOk(row.url) ? (
            <a
              href={row.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[var(--text-primary)] hover:text-[var(--accent-blue)] hover:underline"
            >
              {row.judul}
            </a>
          ) : (
            <span className="font-medium text-[var(--text-primary)]">
              {row.judul}
            </span>
          )}
          <AuditStar on={row.audit} />
        </span>
      </td>
      <td className="px-3 py-2 text-xs font-mono">{row.no_dokumen || "-"}</td>
      <td className="px-3 py-2 text-xs">{row.revisi || "-"}</td>
      <td className="px-3 py-2 text-xs whitespace-nowrap">
        {fmtTgl(row.tgl_berlaku) || "-"}
      </td>
      <td className="px-3 py-2">{row.pic || "-"}</td>
      <td className="px-3 py-2">
        <StatusPill status={row.status} />
      </td>
      <td className="px-3 py-2 text-xs">
        <LinkCell url={row.url} />
      </td>
      <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">
        {row.keterangan || "-"}
      </td>
      {aksiCol && (
        <td className="px-2 py-1.5 text-right whitespace-nowrap">{extra}</td>
      )}
    </tr>
  );
}

// One SOP typed in place: saved when a cell is left with something changed (a new one once it has a name).
function EditRow({
  no,
  row,
  kode,
  extra,
  onSaved,
  onHapus,
}: {
  no: string;
  row: Row;
  kode: string;
  extra?: React.ReactNode;
  onSaved: (r: Row) => void;
  onHapus: () => void;
}) {
  const [v, setV] = useState<Row>(row);
  const [state, setState] = useState<"" | "saving" | "saved" | "error">("");
  const [msg, setMsg] = useState("");
  const last = useRef(JSON.stringify(row));
  const set = <K extends keyof Row>(k: K, val: Row[K]) =>
    setV((x) => ({ ...x, [k]: val }));

  const save = async (next: Row = v) => {
    const body: SopInput = {
      bagian: next.bagian,
      judul: next.judul.trim(),
      audit: next.audit,
      no_dokumen: next.no_dokumen.trim(),
      revisi: next.revisi.trim(),
      tgl_berlaku: next.tgl_berlaku,
      pic: next.pic.trim(),
      status: next.status,
      url: next.url.trim(),
      keterangan: next.keterangan.trim(),
    };
    const snap = JSON.stringify({ ...next, ...body });
    if (snap === last.current) return;
    if (!body.judul || (body.url && !urlOk(body.url))) {
      // A new row being filled in waits for its name.
      if (next.id === null && !body.judul) return setState("");
      setState("error");
      setMsg(!body.judul ? "Isi nama SOP" : "Link harus diawali https://");
      return;
    }
    setState("saving");
    setMsg("");
    try {
      let { id, urut } = next;
      if (id === null) ({ id, urut } = await api.sopTambah(body));
      else await api.sopEdit(id, body);
      const done = { ...next, ...body, id, urut };
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
  const enter = (e: React.KeyboardEvent<HTMLInputElement>) =>
    e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur();
  const pick = <K extends "status" | "audit" | "tgl_berlaku">(
    k: K,
    val: Row[K],
  ) => {
    const next = { ...v, [k]: val };
    setV(next);
    void save(next);
  };
  const st = statusOf(v.status);

  return (
    <>
      <tr
        className={`border-t border-[var(--border)] align-top ${state === "error" ? "bg-[#fff6f6]" : row.id === null ? "bg-[#f8fbff]" : "hover:bg-[#fafcff]"}`}
      >
        <td className="px-3 py-2 text-right text-[var(--text-muted)] tabular-nums">
          {no}
        </td>
        <td className="px-1 py-1">
          <div className="flex items-center">
            <input
              value={v.judul}
              onChange={(e) => set("judul", e.target.value)}
              onBlur={blurSave}
              onKeyDown={enter}
              placeholder="Nama SOP"
              className={`${cellCls} font-medium`}
              autoFocus={row.id === null}
            />
            <AuditStar on={v.audit} onClick={() => pick("audit", !v.audit)} />
          </div>
        </td>
        <td className="px-1 py-1">
          <input
            value={v.no_dokumen}
            onChange={(e) => set("no_dokumen", e.target.value)}
            onBlur={blurSave}
            onKeyDown={enter}
            placeholder={`SOP/${kode}/001`}
            className={`${cellCls} text-xs font-mono`}
          />
        </td>
        <td className="px-1 py-1">
          <input
            value={v.revisi}
            onChange={(e) => set("revisi", e.target.value)}
            onBlur={blurSave}
            onKeyDown={enter}
            placeholder="00"
            className={`${cellCls} text-xs`}
          />
        </td>
        <td className="px-1 py-1">
          <input
            type="date"
            value={v.tgl_berlaku}
            onChange={(e) => pick("tgl_berlaku", e.target.value)}
            className={`${cellCls} text-xs`}
          />
        </td>
        <td className="px-1 py-1">
          <input
            value={v.pic}
            onChange={(e) => set("pic", e.target.value)}
            onBlur={blurSave}
            onKeyDown={enter}
            placeholder="PIC"
            className={cellCls}
          />
        </td>
        <td className="px-1 py-1">
          <select
            value={v.status}
            onChange={(e) => pick("status", e.target.value as Row["status"])}
            className={`${cellCls} cursor-pointer text-xs font-medium`}
            style={{ color: st.color }}
          >
            {SOP_STATUS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </td>
        <td className="px-1 py-1">
          <div className="flex items-center gap-1">
            {urlOk(v.url) &&
              (() => {
                const j = jenisOf(v.url);
                const Icon = j.icon;
                return (
                  <a
                    href={v.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Buka file"
                    className="shrink-0 ml-1"
                  >
                    <Icon size={14} style={{ color: j.color }} />
                  </a>
                );
              })()}
            <input
              value={v.url}
              onChange={(e) => set("url", e.target.value)}
              onBlur={blurSave}
              onKeyDown={enter}
              placeholder="https://docs.google.com/..."
              className={`${cellCls} text-xs text-[var(--accent-blue)]`}
            />
          </div>
        </td>
        <td className="px-1 py-1">
          <input
            value={v.keterangan}
            onChange={(e) => set("keterangan", e.target.value)}
            onBlur={blurSave}
            onKeyDown={enter}
            placeholder="-"
            className={`${cellCls} text-xs`}
          />
        </td>
        <td className="px-2 py-1.5 text-right whitespace-nowrap">
          {state === "saving" ? (
            <span className="text-[11px] text-[var(--text-muted)]">...</span>
          ) : state === "saved" ? (
            <Check size={14} className="inline text-[var(--accent-green)]" />
          ) : (
            <>
              {extra}
              <button
                onClick={onHapus}
                title="Hapus SOP"
                className="p-1.5 rounded text-[var(--text-muted)] hover:bg-[var(--accent-red-bg)] hover:text-[var(--accent-red)]"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </td>
      </tr>
      {state === "error" && msg && (
        <tr className="bg-[#fff6f6]">
          <td />
          <td
            colSpan={9}
            className="px-3 pb-1.5 text-[11px] text-[var(--accent-red)]"
          >
            {row.id === null ? `Belum tersimpan: ${msg}` : msg}
          </td>
        </tr>
      )}
    </>
  );
}

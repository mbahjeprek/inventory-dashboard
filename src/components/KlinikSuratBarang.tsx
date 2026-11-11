import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, CircleDashed, FilePlus2, FileUp, Plus, Printer, Save, Send, Trash2, X } from "lucide-react";
import { api, errorText, type SbBox, type SbItem, type SbOrang, type SuratBarang, type SuratBarangInput, type SuratBarangRow } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { can } from "../lib/access";
import { localToday } from "../lib/opname";
import { printDocument } from "../lib/printTable";
import { waktuTtd } from "../lib/permintaanSurat";
import { SB_LABEL, SB_URUT, formatNomor, gabungNomor, ikutTanggal, pisahNomor, suratBarangHtml } from "../lib/suratBarang";
import { EvidenceInput, EvidenceLink, useEvidenceEnabled } from "./EvidenceInput";
import { useAutoRefresh } from "../hooks/useAutoRefresh";

// Klinik > Permintaan > Permintaan Barang (non-obat): the klinik's letter asking for a barang that isn't an obat (a
// printer...), made on its template (see lib/suratBarang), sent, then signed in the app in order - Dimohon Oleh (the
// klinik staff), Diperiksa Oleh, Disetujui Oleh - by the person named in each box (or an account with that box's tick),
// or uploaded signed on paper. Printed at any time; a box signed in the app prints with its electronic stamp.

const tgl = (iso: string) => iso.split("-").reverse().join("/");
const inputCls = "text-sm rounded-md border border-[var(--border)] px-3 py-2 bg-white";
const cellIn = "w-full rounded border border-[var(--border)] px-1.5 py-1 text-sm bg-white";
const btn = "inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[#f1f5f9] disabled:opacity-50";
const btnBlue = "inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50";
const cetak = async (id: number) => printDocument(suratBarangHtml(await api.sbGet(id)));

// The addressees and signers of the klinik's letter template; a new letter copies the klinik's last one instead.
const DEFAULT = {
  kepada: { nama: "Fitriono Efendi", jabatan: "Coorporate GM Plantation" },
  cc: [
    { nama: "Mohd.Nasrul Hakim Bin Anuyar", jabatan: "GM Finance & Audit" },
    { nama: "Dessy Ana", jabatan: "KTU PT.AKSS" },
  ],
  diperiksa: "Sikam",
  disetujui: "Fitriono Efendi",
};

type View = { kind: "list" } | { kind: "edit"; id: number | null } | { kind: "detail"; id: number };

export function KlinikSuratBarang({ klinik }: { klinik: string }) {
  const [view, setView] = useState<View>({ kind: "list" });
  if (view.kind === "edit") return <Editor klinik={klinik} id={view.id} onDone={(id) => setView(id ? { kind: "detail", id } : { kind: "list" })} onBack={() => setView({ kind: "list" })} />;
  if (view.kind === "detail") return <SuratBarangDetail id={view.id} onBack={() => setView({ kind: "list" })} />;
  return <Daftar klinik={klinik} setView={setView} />;
}

export function StatusSuratBarang({ s }: { s: Pick<SuratBarang, "status" | "approval" | "tolak"> }) {
  const cls = "text-xs px-2 py-0.5 rounded-full border whitespace-nowrap";
  if (s.status === "DRAFT")
    return s.tolak ? (
      <span className={`${cls} border-[var(--accent-red-border)] text-[var(--accent-red)] bg-[var(--accent-red-bg)]`} title={`Alasan: ${s.tolak.alasan}`}>
        Ditolak ({SB_LABEL[s.tolak.level]})
      </span>
    ) : (
      <span className={`${cls} border-[var(--border)] text-[var(--text-secondary)]`}>Draft</span>
    );
  if (s.status === "DISETUJUI") return <span className={`${cls} border-[var(--accent-green-border)] text-[var(--accent-green)] bg-[var(--accent-green-bg)]`}>Disetujui</span>;
  const n = SB_URUT.filter((k) => s.approval?.[k]).length;
  return <span className={`${cls} border-[var(--accent-amber-border)] text-[var(--accent-amber)] bg-[var(--accent-amber-bg)]`}>Menunggu tanda tangan ({n}/3)</span>;
}

function Daftar({ klinik, setView }: { klinik: string; setView: (v: View) => void }) {
  const { user } = useAuth();
  const canInput = can(user, "klinik.input");
  const [rows, setRows] = useState<SuratBarangRow[] | null>(null);
  const [error, setError] = useState("");
  const load = () =>
    api
      .sbList(klinik)
      .then((r) => (setRows(r.rows), setError("")))
      .catch((e) => setError(errorText(e, "Gagal memuat surat")));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [klinik]);
  useAutoRefresh(load);
  const hapus = async (s: SuratBarangRow) => {
    if (!window.confirm(`Hapus surat ${s.nomor || s.perihal}?`)) return;
    try {
      await api.sbDelete(s.id);
      load();
    } catch (e) {
      setError(errorText(e, "Gagal menghapus"));
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-[var(--text-muted)]">Surat permintaan barang selain obat (mis. printer), dengan template surat klinik. Ditandatangani Dimohon → Diperiksa → Disetujui.</p>
        {canInput && (
          <button onClick={() => setView({ kind: "edit", id: null })} className={`${btnBlue} ml-auto`}>
            <FilePlus2 size={16} /> Buat Surat Permintaan
          </button>
        )}
      </div>
      {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#f8fafc] text-xs text-[var(--text-secondary)]">
            <tr className="text-left">
              <th className="px-3 py-2">Nomor</th>
              <th className="px-3 py-2">Tanggal</th>
              <th className="px-3 py-2">Perihal</th>
              <th className="px-3 py-2 text-right">Barang</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Dibuat oleh</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {!rows ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-[var(--text-muted)]">
                  Memuat...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-[var(--text-muted)]">
                  Belum ada surat permintaan barang.
                </td>
              </tr>
            ) : (
              rows.map((s) => (
                <tr key={s.id} className="border-t border-[var(--border)] hover:bg-[#f8fafc]">
                  <td className="px-3 py-2 font-medium">
                    <button onClick={() => setView(s.status === "DRAFT" && canInput ? { kind: "edit", id: s.id } : { kind: "detail", id: s.id })} className="text-[var(--accent-blue)] hover:underline text-left">
                      {s.nomor || "(tanpa nomor)"}
                    </button>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{tgl(s.tanggal)}</td>
                  <td className="px-3 py-2">{s.perihal}</td>
                  <td className="px-3 py-2 text-right">{s.items}</td>
                  <td className="px-3 py-2">
                    <StatusSuratBarang s={s} />
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">{s.created_by}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-right">
                    <button onClick={() => cetak(s.id).catch((e) => setError(errorText(e, "Gagal mencetak")))} title="Cetak" className="p-1.5 text-[var(--text-muted)] hover:text-[var(--accent-blue)]">
                      <Printer size={15} />
                    </button>
                    {(s.status === "DRAFT" || user?.role === "superuser") && can(user, "klinik.delete") && (
                      <button onClick={() => hapus(s)} title="Hapus" className="p-1.5 text-[var(--text-muted)] hover:text-[var(--accent-red)]">
                        <Trash2 size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Buat / ubah (draft), with the letter as it prints beside it ----
type ItemIn = { nama: string; type: string; qty: string; satuan: string; keterangan: string };
const itemKosong = (): ItemIn => ({ nama: "", type: "", qty: "1", satuan: "Unit", keterangan: "" });

function Editor({ klinik, id, onDone, onBack }: { klinik: string; id: number | null; onDone: (id: number | null) => void; onBack: () => void }) {
  const { user } = useAuth();
  const [tanggal, setTanggal] = useState(localToday());
  const [urut, setUrut] = useState("");
  const [format, setFormat] = useState("");
  const [perihal, setPerihal] = useState("");
  const [kepada, setKepada] = useState<SbOrang>(DEFAULT.kepada);
  const [cc, setCc] = useState<SbOrang[]>(DEFAULT.cc);
  const [dari, setDari] = useState<SbOrang>({ nama: user?.nama ?? "", jabatan: "Medis" });
  const [keperluan, setKeperluan] = useState("Klinik");
  const [items, setItems] = useState<ItemIn[]>([itemKosong()]);
  const [ttd, setTtd] = useState<Record<SbBox, string>>({ dimohon: user?.nama ?? "", diperiksa: DEFAULT.diperiksa, disetujui: DEFAULT.disetujui });
  const [tolak, setTolak] = useState<SuratBarang["tolak"]>(null);
  const [lastNomor, setLastNomor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        if (id) {
          const s = await api.sbGet(id);
          const n = pisahNomor(s.nomor);
          setTanggal(s.tanggal);
          setUrut(n.urut);
          setFormat(n.format);
          setPerihal(s.perihal);
          setKepada(s.kepada?.nama ? s.kepada : DEFAULT.kepada);
          setCc(s.cc ?? []);
          setDari(s.dari);
          setKeperluan(s.keperluan);
          setItems(s.items.map((i) => ({ ...i, qty: String(i.qty) })));
          setTtd({ dimohon: s.ttd?.dimohon?.nama ?? "", diperiksa: s.ttd?.diperiksa?.nama ?? "", disetujui: s.ttd?.disetujui?.nama ?? "" });
          setTolak(s.tolak);
        } else {
          const r = await api.sbList(klinik);
          const l = r.last;
          setLastNomor(l?.nomor ?? null);
          setFormat(formatNomor(klinik, localToday(), l?.nomor));
          if (l) {
            if (l.kepada?.nama) setKepada(l.kepada);
            setCc(l.cc ?? []);
            if (l.dari?.nama) setDari(l.dari);
            setTtd({ dimohon: l.ttd?.dimohon?.nama || user?.nama || "", diperiksa: l.ttd?.diperiksa?.nama || DEFAULT.diperiksa, disetujui: l.ttd?.disetujui?.nama || DEFAULT.disetujui });
          }
        }
      } catch (e) {
        setError(errorText(e, "Gagal memuat"));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, klinik]);

  const body = (ajukan: boolean): SuratBarangInput => ({
    klinik,
    ajukan,
    nomor: gabungNomor(urut, format),
    tanggal,
    perihal: perihal.trim(),
    kepada,
    cc: cc.filter((o) => o.nama.trim()),
    dari,
    keperluan: keperluan.trim(),
    items: items.filter((i) => i.nama.trim()).map((i): SbItem => ({ nama: i.nama.trim(), type: i.type.trim(), qty: Number(i.qty), satuan: i.satuan.trim(), keterangan: i.keterangan.trim() })),
    ttd: { dimohon: { nama: ttd.dimohon.trim() }, diperiksa: { nama: ttd.diperiksa.trim() }, disetujui: { nama: ttd.disetujui.trim() } },
  });
  // The letter as it prints, from what is typed now.
  const preview = useMemo(
    () => suratBarangHtml({ ...body(false), id: 0, status: "DRAFT", approval: {}, tolak: null, created_by: "", created_at: "", diajukan_at: null }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [klinik, urut, format, tanggal, perihal, kepada, cc, dari, keperluan, items, ttd]
  );
  const simpan = async (ajukan: boolean) => {
    setError("");
    const b = body(ajukan);
    if (!b.items.length) return setError("Isi minimal satu barang");
    const salah = b.items.find((i) => !(i.qty > 0));
    if (salah) return setError(`${salah.nama}: qty harus lebih dari 0`);
    if (ajukan) {
      const kurang = [!urut.trim() && "nomor surat", !b.perihal && "perihal", !kepada.nama.trim() && "Kepada Yth", !dari.nama.trim() && "Dari", ...SB_URUT.filter((k) => !ttd[k].trim()).map((k) => `nama ${SB_LABEL[k]}`)].filter(Boolean);
      if (kurang.length) return setError(`Lengkapi dulu: ${kurang.join(", ")}`);
      if (!window.confirm(`Ajukan surat ${b.nomor}? Setelah diajukan isinya tidak bisa diubah; berikutnya tanda tangan ${SB_LABEL.dimohon} (${ttd.dimohon}).`)) return;
    }
    setSaving(true);
    try {
      const nid = id ? (await api.sbUpdate(id, b), id) : (await api.sbCreate(b)).id;
      onDone(ajukan ? nid : null);
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan"));
    } finally {
      setSaving(false);
    }
  };
  if (loading) return <p className="p-4 text-sm text-[var(--text-muted)]">{error || "Memuat..."}</p>;
  const setItem = (i: number, patch: Partial<ItemIn>) => setItems((x) => x.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const orangIn = (o: SbOrang, set: (o: SbOrang) => void, ph = "Nama") => (
    <div className="grid grid-cols-2 gap-2">
      <input value={o.nama} onChange={(e) => set({ ...o, nama: e.target.value })} placeholder={ph} maxLength={100} className={inputCls} />
      <input value={o.jabatan} onChange={(e) => set({ ...o, jabatan: e.target.value })} placeholder="Jabatan (dalam kurung)" maxLength={100} className={inputCls} />
    </div>
  );
  const label = "block text-xs font-medium text-[var(--text-secondary)] mb-1";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onBack} className={btn}>
          <ArrowLeft size={15} /> Kembali
        </button>
        <h2 className="font-semibold text-[var(--text-primary)]">{id ? "Ubah surat permintaan barang (draft)" : "Surat permintaan barang baru"}</h2>
      </div>
      {tolak && (
        <p className="text-sm px-3 py-2 rounded-md border border-[var(--accent-red-border)] bg-[var(--accent-red-bg)] text-[var(--accent-red)]">
          Ditolak {tolak.nama} di kotak {SB_LABEL[tolak.level]} · {waktuTtd(tolak.at)}: {tolak.alasan}. Perbaiki lalu ajukan lagi.
        </p>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <div className="space-y-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
          <div className="grid grid-cols-1 sm:grid-cols-[110px_1fr_160px] gap-2">
            <div>
              <span className={label}>Nomor urut</span>
              <input value={urut} onChange={(e) => setUrut(e.target.value)} placeholder="mis. 590" maxLength={20} className={`${inputCls} w-full`} />
            </div>
            <div>
              <span className={label}>Format nomor</span>
              <input value={format} onChange={(e) => setFormat(e.target.value)} maxLength={100} className={`${inputCls} w-full`} />
            </div>
            <div>
              <span className={label}>Tanggal</span>
              <input
                type="date"
                value={tanggal}
                onChange={(e) => {
                  const t = e.target.value;
                  setTanggal(t);
                  // The format's month / year follow the tanggal; what was typed before them stays.
                  if (t) setFormat(ikutTanggal(klinik, t, format, lastNomor));
                }}
                className={`${inputCls} w-full`}
              />
            </div>
          </div>
          <div>
            <span className={label}>Perihal</span>
            <input value={perihal} onChange={(e) => setPerihal(e.target.value)} placeholder="mis. Permintaan Pengadaan Printer Epson L3210" maxLength={300} className={`${inputCls} w-full`} />
          </div>
          <div>
            <span className={label}>Kepada Yth</span>
            {orangIn(kepada, setKepada)}
          </div>
          <div>
            <span className={label}>cc</span>
            <div className="space-y-2">
              {cc.map((o, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <div className="flex-1">{orangIn(o, (n) => setCc((x) => x.map((y, j) => (j === i ? n : y))))}</div>
                  <button onClick={() => setCc((x) => x.filter((_, j) => j !== i))} title="Hapus cc" className="p-1.5 text-[var(--text-muted)] hover:text-[var(--accent-red)]">
                    <X size={15} />
                  </button>
                </div>
              ))}
              {cc.length < 6 && (
                <button onClick={() => setCc((x) => [...x, { nama: "", jabatan: "" }])} className="text-xs text-[var(--accent-blue)] hover:underline inline-flex items-center gap-1">
                  <Plus size={13} /> Tambah cc
                </button>
              )}
            </div>
          </div>
          <div>
            <span className={label}>Dari</span>
            {orangIn(dari, setDari)}
          </div>
          <div>
            <span className={label}>Kebutuhan untuk (isi kalimat pembuka)</span>
            <input value={keperluan} onChange={(e) => setKeperluan(e.target.value)} placeholder="mis. Klinik (print surat Rujukan,dll)" maxLength={500} className={`${inputCls} w-full`} />
            <p className="text-[11px] text-[var(--text-muted)] mt-1">Sehubungan dengan adanya kebutuhan untuk <b>{keperluan || "..."}</b> maka dengan ini kami mengajukan permintaan barang ...</p>
          </div>
          <div>
            <span className={label}>Barang</span>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-[var(--text-secondary)]">
                  <tr className="text-left">
                    <th className="px-1 py-1">Nama barang</th>
                    <th className="px-1 py-1">Type</th>
                    <th className="px-1 py-1 w-20">Qty</th>
                    <th className="px-1 py-1 w-24">Satuan</th>
                    <th className="px-1 py-1">Keterangan</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i}>
                      <td className="px-1 py-1">
                        <input value={it.nama} onChange={(e) => setItem(i, { nama: e.target.value })} placeholder="mis. Printer" maxLength={200} className={cellIn} />
                      </td>
                      <td className="px-1 py-1">
                        <input value={it.type} onChange={(e) => setItem(i, { type: e.target.value })} placeholder="mis. Epson L3210" maxLength={200} className={cellIn} />
                      </td>
                      <td className="px-1 py-1">
                        <input type="number" min={0} value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })} className={cellIn} />
                      </td>
                      <td className="px-1 py-1">
                        <input value={it.satuan} onChange={(e) => setItem(i, { satuan: e.target.value })} maxLength={30} className={cellIn} />
                      </td>
                      <td className="px-1 py-1">
                        <input value={it.keterangan} onChange={(e) => setItem(i, { keterangan: e.target.value })} placeholder="mis. Kebutuhan Klinik" maxLength={300} className={cellIn} />
                      </td>
                      <td className="px-1 py-1">
                        {items.length > 1 && (
                          <button onClick={() => setItems((x) => x.filter((_, j) => j !== i))} title="Hapus baris" className="p-1 text-[var(--text-muted)] hover:text-[var(--accent-red)]">
                            <X size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button onClick={() => setItems((x) => [...x, itemKosong()])} className="mt-1 text-xs text-[var(--accent-blue)] hover:underline inline-flex items-center gap-1">
              <Plus size={13} /> Tambah barang
            </button>
          </div>
          <div>
            <span className={label}>Yang bertanda tangan (berurutan)</span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {SB_URUT.map((k) => (
                <div key={k}>
                  <p className="text-[11px] text-[var(--text-secondary)] mb-0.5">{SB_LABEL[k]}</p>
                  <input value={ttd[k]} onChange={(e) => setTtd({ ...ttd, [k]: e.target.value })} placeholder="Nama" maxLength={100} className={`${inputCls} w-full`} />
                </div>
              ))}
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mt-1">
              Setelah diajukan, tiap kotak ditandatangani orang yang namanya tertulis (kalau namanya akun estate ini), atau akun yang punya hak tanda tangan kotak itu.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {error && <span className="text-sm text-[var(--accent-red)]">{error}</span>}
            <span className="ml-auto" />
            <button onClick={() => printDocument(preview)} className={btn} title="Cetak untuk ditandatangani di kertas">
              <Printer size={15} /> Cetak
            </button>
            <button onClick={() => simpan(false)} disabled={saving} className={btn}>
              <Save size={15} /> Simpan draft
            </button>
            <button onClick={() => simpan(true)} disabled={saving} className={btnBlue}>
              <Send size={15} /> {saving ? "Menyimpan..." : "Ajukan"}
            </button>
          </div>
        </div>
        <Pratinjau html={preview} />
      </div>
    </div>
  );
}

// The letter as it prints, scaled into the page.
function Pratinjau({ html }: { html: string }) {
  return (
    <div className="bg-[#e5e7eb] border border-[var(--border)] rounded-lg p-3 overflow-auto">
      <p className="text-xs text-[var(--text-secondary)] mb-2">Pratinjau surat</p>
      <iframe title="Pratinjau surat" srcDoc={html.replace("</style>", ".kaki{position:static;margin-top:60px}</style>").replace("<body>", '<body style="background:#fff;padding:0.39in 1in;width:6.5in;margin:0 auto;">')} className="w-full h-[900px] bg-white border-0" />
    </div>
  );
}

// ---- Detail: the letter, its signatures and Cetak; signing / refusing the next box, or uploading the paper letter ----
export function SuratBarangDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const [s, setS] = useState<SuratBarang | null>(null);
  const [error, setError] = useState("");
  const load = () =>
    api
      .sbGet(id)
      .then(setS)
      .catch((e) => setError(errorText(e, "Gagal memuat surat")));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!s) return <p className="p-4 text-sm text-[var(--text-muted)]">{error || "Memuat..."}</p>;
  const html = suratBarangHtml(s);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onBack} className={btn}>
          <ArrowLeft size={15} /> Kembali
        </button>
        <div>
          <h2 className="font-semibold text-[var(--text-primary)]">{s.nomor || "(tanpa nomor)"}</h2>
          <p className="text-xs text-[var(--text-secondary)]">
            {tgl(s.tanggal)} · {s.perihal} · dibuat {s.created_by}
            {s.diajukan_at && ` · diajukan ${new Date(s.diajukan_at).toLocaleDateString("id-ID")}`}
          </p>
        </div>
        <button onClick={() => printDocument(html)} className={`${s.status === "DISETUJUI" ? btnBlue : btn} ml-auto`}>
          <Printer size={15} /> Cetak
        </button>
      </div>
      <TtdPanel s={s} onDone={load} />
      {s.status === "DISETUJUI" && (
        <p className="text-sm px-3 py-2 rounded-md border border-[var(--accent-green-border)] bg-[var(--accent-green-bg)] text-[var(--accent-green)]">Disetujui lengkap. Cetak sebagai bukti permintaan.</p>
      )}
      <Pratinjau html={html} />
    </div>
  );
}

function TtdPanel({ s, onDone }: { s: SuratBarang; onDone: () => void }) {
  const { user } = useAuth();
  const [tolakMode, setTolakMode] = useState(false);
  const [alasan, setAlasan] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  if (s.status === "DRAFT") return null;
  const berikut = SB_URUT.find((k) => !s.approval?.[k]);
  const bisa = s.status === "DIAJUKAN" ? (s.bisa_ttd ?? [])[0] : undefined;
  const bisaOffline = s.status === "DIAJUKAN" && can(user, "klinik.ttd_offline");
  const kirim = async (aksi: "SETUJU" | "TOLAK") => {
    if (!bisa) return;
    if (aksi === "TOLAK" && alasan.trim().length < 3) return setError("Isi alasan penolakan");
    if (aksi === "SETUJU" && !window.confirm(`Tandatangani surat ${s.nomor} sebagai ${SB_LABEL[bisa]}?`)) return;
    setBusy(true);
    setError("");
    try {
      await api.sbTtd(s.id, { level: bisa, aksi, alasan: alasan.trim() });
      setTolakMode(false);
      setAlasan("");
      onDone();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-[var(--text-primary)]">Tanda Tangan</p>
        <StatusSuratBarang s={s} />
        {bisaOffline && !offline && (
          <button onClick={() => setOffline(true)} className={`${btn} ml-auto`} title="Surat ini sudah ditandatangani lengkap di kertas: upload fotonya, surat langsung Disetujui">
            <FileUp size={15} /> Upload surat bertanda tangan
          </button>
        )}
      </div>
      {offline && <SuratOffline s={s} onClose={() => setOffline(false)} onDone={() => (setOffline(false), onDone())} />}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {SB_URUT.map((k) => {
          const a = s.approval?.[k];
          const now = bisa === k;
          return (
            <div
              key={k}
              className={`rounded-md border px-3 py-2 ${a ? "border-[var(--accent-green-border)] bg-[var(--accent-green-bg)]" : now ? "border-[var(--accent-amber-border)] bg-[var(--accent-amber-bg)]" : "border-[var(--border)]"}`}
            >
              <p className="text-[11px] text-[var(--text-secondary)] flex items-center gap-1">
                {a ? <Check size={12} className="text-[var(--accent-green)]" /> : <CircleDashed size={12} />}
                {SB_LABEL[k]}
              </p>
              <p className="text-sm font-medium text-[var(--text-primary)] leading-tight mt-0.5">{a?.nama || s.ttd?.[k]?.nama || "-"}</p>
              <p className={`text-[11px] mt-0.5 ${a ? "text-[var(--accent-green)]" : now ? "text-[var(--accent-amber)]" : "text-[var(--text-muted)]"}`}>
                {a?.offline
                  ? `Di surat asli · diupload ${waktuTtd(a.at)}`
                  : a
                    ? `Ditandatangani ${waktuTtd(a.at)}`
                    : now
                      ? "Giliran Anda tanda tangan"
                      : k === berikut && s.status === "DIAJUKAN"
                        ? "Giliran tanda tangan"
                        : "Menunggu kotak sebelumnya"}
              </p>
              {a?.offline && (
                <p className="text-[11px] mt-0.5 flex flex-wrap gap-x-2">
                  {(a.fotos ?? []).map((f, i) => (
                    <EvidenceLink key={f} id={f} label={(a.fotos?.length ?? 0) > 1 ? `hal ${i + 1}` : "foto surat"} />
                  ))}
                  {a.upload_oleh && <span className="text-[var(--text-muted)]">oleh {a.upload_oleh}</span>}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {bisa && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
          {tolakMode ? (
            <>
              <input autoFocus value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="Alasan penolakan (wajib)" maxLength={500} className={`${inputCls} flex-1 min-w-[240px]`} />
              <button onClick={() => kirim("TOLAK")} disabled={busy} className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-[var(--accent-red)] text-white hover:opacity-90 disabled:opacity-50">
                Tolak & kembalikan
              </button>
              <button onClick={() => (setTolakMode(false), setError(""))} disabled={busy} className={btn}>
                Batal
              </button>
            </>
          ) : (
            <>
              <span className="text-sm text-[var(--text-secondary)]">
                Anda menandatangani sebagai <b>{SB_LABEL[bisa]}</b>.
              </span>
              <span className="ml-auto" />
              {bisa !== "dimohon" && (
                <button onClick={() => setTolakMode(true)} disabled={busy} className={btn}>
                  Tolak
                </button>
              )}
              <button onClick={() => kirim("SETUJU")} disabled={busy} className={btnBlue}>
                <Check size={15} /> {busy ? "Menyimpan..." : bisa === "dimohon" ? "Tandatangani" : "Setujui & tandatangani"}
              </button>
            </>
          )}
        </div>
      )}
      {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
      {s.status === "DIAJUKAN" && (
        <p className="text-[11px] text-[var(--text-muted)]">
          Tanda tangan berurutan: Dimohon Oleh → Diperiksa Oleh → Disetujui Oleh; notifikasi ke penandatangan berikutnya. Ditolak = kembali ke draft dengan alasannya.
        </p>
      )}
    </div>
  );
}

// The letter signed in full on paper: photos of every page and the names as on the paper for the boxes not signed
// in the app; the letter is then approved.
function SuratOffline({ s, onClose, onDone }: { s: SuratBarang; onClose: () => void; onDone: () => void }) {
  const fotoAktif = useEvidenceEnabled();
  const [fotos, setFotos] = useState<string[]>([]);
  const kosong = SB_URUT.filter((k) => !s.approval?.[k]);
  const [nama, setNama] = useState<Record<string, string>>(() => Object.fromEntries(kosong.map((k) => [k, s.ttd?.[k]?.nama ?? ""])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const kirim = async () => {
    setError("");
    if (!fotos.length) return setError("Upload foto surat yang sudah ditandatangani");
    const tanpa = kosong.filter((k) => nama[k].trim().length < 2);
    if (tanpa.length) return setError(`Isi nama sesuai surat: ${tanpa.map((k) => SB_LABEL[k]).join(", ")}`);
    if (!window.confirm(`Simpan ${s.nomor} sebagai Disetujui dari surat bertanda tangan?`)) return;
    setBusy(true);
    try {
      await api.sbSuratOffline(s.id, { evidence_ids: fotos, ttd: Object.fromEntries(kosong.map((k) => [k, { nama: nama[k].trim() }])) });
      onDone();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-md border border-[var(--accent-blue-border)] bg-[var(--accent-blue-bg)] p-3 space-y-3">
      <div>
        <p className="text-sm font-semibold text-[var(--text-primary)]">Upload surat yang sudah ditandatangani</p>
        <p className="text-xs text-[var(--text-secondary)]">Kotak yang belum ditandatangani di aplikasi diisi nama sesuai surat dan ditandai &quot;di surat asli&quot;; surat langsung Disetujui.</p>
      </div>
      <div>
        <p className="text-xs font-medium text-[var(--text-secondary)] mb-1">1. Foto surat ({fotos.length} halaman)</p>
        {!fotoAktif ? (
          <p className="text-xs text-[var(--accent-red)]">Penyimpanan foto belum aktif, surat belum bisa diupload.</p>
        ) : (
          <div className="flex flex-wrap items-start gap-3">
            {fotos.map((f, i) => (
              <span key={f} className="inline-flex items-center gap-1 text-xs rounded border border-[var(--border)] bg-white px-2 py-1">
                <EvidenceLink id={f} label={`Halaman ${i + 1}`} />
                <button onClick={() => setFotos((x) => x.filter((y) => y !== f))} title="Hapus halaman ini" className="text-[var(--text-muted)] hover:text-[var(--accent-red)]">
                  <X size={12} />
                </button>
              </span>
            ))}
            {fotos.length < 10 && (
              <div className="min-w-[220px]">
                <EvidenceInput key={fotos.length} value={null} onChange={(fid) => fid && setFotos((x) => (x.includes(fid) ? x : [...x, fid]))} label={fotos.length ? "Tambah halaman" : "Foto halaman 1"} />
              </div>
            )}
          </div>
        )}
      </div>
      {kosong.length > 0 && (
        <div>
          <p className="text-xs font-medium text-[var(--text-secondary)] mb-1">2. Penanda tangan di surat</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {kosong.map((k) => (
              <div key={k}>
                <p className="text-[11px] text-[var(--text-secondary)] mb-0.5">{SB_LABEL[k]}</p>
                <input value={nama[k]} onChange={(e) => setNama({ ...nama, [k]: e.target.value })} placeholder="Nama" maxLength={100} className={`${inputCls} w-full`} />
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {error && <span className="text-sm text-[var(--accent-red)]">{error}</span>}
        <span className="ml-auto" />
        <button onClick={onClose} disabled={busy} className={btn}>
          Batal
        </button>
        <button onClick={kirim} disabled={busy || !fotoAktif} className={btnBlue}>
          <Check size={15} /> {busy ? "Menyimpan..." : "Simpan & setujui"}
        </button>
      </div>
    </div>
  );
}

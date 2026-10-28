import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ClipboardList, Pencil, Plus, Printer, Trash2, X } from "lucide-react";
import { api, errorText, type KopBarang, type KopPermintaan, type KopPermintaanLine, type KopPermintaanRow, type KopPermintaanTtd } from "../lib/api";
import { kopTtdLengkap, permintaanKoperasiHtml } from "../lib/permintaanKoperasi";
import { printDocument } from "../lib/printTable";
import { fmtQty, isoDisplay, localToday } from "../lib/opname";
import { parseNum } from "./BatchGrid";
import { ConfirmDialog } from "./ConfirmDialog";

// Permintaan Barang Koperasi: the koperasi's order lists (was an Excel sheet per order). Each one is saved with its
// nomor, printed with the kop and the two signatures, and shows per barang when it came in (Tgl Masuk: the first
// Stock In of that barang after the request, or a date typed for one that came in another way).

type Baris = { key: number; kode: string; teks: string; nama: string; jenis: string; jumlah: string; satuan: string; isi: string; tgl_masuk: string; masuk: string | null; manual?: boolean };
let nextKey = 1;
const barisKosong = (): Baris => ({ key: nextKey++, kode: "", teks: "", nama: "", jenis: "", jumlah: "", satuan: "", isi: "", tgl_masuk: "", masuk: null });
const labelBarang = (b: Pick<KopBarang, "kode" | "nama">) => `${b.kode} · ${b.nama}`;
const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-2 py-1.5 bg-white";

export function KopPermintaanTab({ canInput, canEdit }: { canInput: boolean; canEdit: boolean }) {
  const [list, setList] = useState<Awaited<ReturnType<typeof api.kopPermintaanList>> | null>(null);
  const [error, setError] = useState("");
  const [buka, setBuka] = useState<number | "baru" | null>(null);
  const [hapus, setHapus] = useState<KopPermintaanRow | null>(null);
  const [muat, setMuat] = useState(0);

  useEffect(() => {
    api
      .kopPermintaanList()
      .then(setList)
      .catch((e) => setError(errorText(e, "Gagal memuat permintaan")));
  }, [muat]);

  const cetak = async (id: number) => {
    try {
      printDocument(permintaanKoperasiHtml(await api.kopPermintaanGet(id)));
    } catch (e) {
      window.alert(errorText(e, "Gagal memuat permintaan"));
    }
  };
  const doHapus = async () => {
    if (!hapus) return;
    try {
      await api.kopPermintaanDelete(hapus.id);
      setHapus(null);
      setMuat((n) => n + 1);
    } catch (e) {
      setHapus(null);
      window.alert(errorText(e, "Gagal menghapus"));
    }
  };

  return (
    <section className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
      <div className="p-3 flex flex-wrap items-center gap-2 border-b border-[var(--border)]">
        <div>
          <div className="text-sm font-medium text-[var(--text-primary)]">Permintaan Barang</div>
          <div className="text-xs text-[var(--text-muted)]">Daftar order barang koperasi, dicetak dengan kop surat. Setelah disimpan, Tgl Masuk tiap barang terisi sendiri saat Stock In-nya dicatat.</div>
        </div>
        {canInput && (
          <button onClick={() => setBuka("baru")} className="ml-auto inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md bg-[var(--accent-blue)] text-white hover:opacity-90">
            <Plus size={15} /> Permintaan Baru
          </button>
        )}
      </div>
      {error ? (
        <p className="p-4 text-sm text-[var(--accent-red)]">{error}</p>
      ) : !list ? (
        <p className="p-4 text-sm text-[var(--text-muted)]">Memuat...</p>
      ) : list.rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-[var(--text-muted)]">Belum ada permintaan barang{canInput ? ". Klik Permintaan Baru untuk membuat." : "."}</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table text-sm w-full">
            <thead>
              <tr className="bg-[#f8fafc] text-left text-xs uppercase text-[var(--text-secondary)]">
                <th className="px-3 py-2.5">Nomor</th>
                <th className="px-3 py-2.5">Tanggal</th>
                <th className="px-3 py-2.5 text-right">Item</th>
                <th className="px-3 py-2.5">Sudah masuk</th>
                <th className="px-3 py-2.5">Catatan</th>
                <th className="px-3 py-2.5">Dibuat oleh</th>
                <th className="px-3 py-2.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {list.rows.map((r) => {
                const lengkap = r.item > 0 && r.masuk >= r.item;
                return (
                  <tr key={r.id} className="align-top">
                    <td className="px-3 py-2 font-medium whitespace-nowrap">
                      <button onClick={() => setBuka(r.id)} className="text-[var(--accent-blue)] hover:underline">
                        {r.nomor}
                      </button>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{isoDisplay(r.tanggal)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.item}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                          lengkap
                            ? "bg-[var(--accent-green-bg)] border-[var(--accent-green-border)] text-[var(--accent-green)]"
                            : "bg-[var(--accent-amber-bg)] border-[var(--accent-amber-border)] text-[var(--accent-amber)]"
                        }`}
                      >
                        {lengkap ? "Semua masuk" : `${r.masuk} dari ${r.item}`}
                      </span>
                    </td>
                    <td className="col-grow px-3 py-2 text-xs text-[var(--text-secondary)]">{r.catatan || "-"}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{r.created_by || "-"}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button onClick={() => cetak(r.id)} title="Cetak" className="p-1.5 rounded text-[var(--text-secondary)] hover:bg-[#f1f5f9]">
                        <Printer size={15} />
                      </button>
                      <button onClick={() => setBuka(r.id)} title={canInput ? "Buka / ubah" : "Lihat"} className="p-1.5 rounded text-[var(--text-secondary)] hover:bg-[#f1f5f9]">
                        <Pencil size={15} />
                      </button>
                      {canEdit && (
                        <button onClick={() => setHapus(r)} title="Hapus" className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--accent-red)] hover:bg-[#f1f5f9]">
                          <Trash2 size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {buka !== null && list && (
        <PermintaanForm
          id={buka === "baru" ? null : buka}
          ttdTerakhir={list.ttd}
          terakhir={list.terakhir}
          bisaUbah={canInput}
          onClose={() => setBuka(null)}
          onSaved={() => setMuat((n) => n + 1)}
        />
      )}
      {hapus && <ConfirmDialog message={`Hapus permintaan ${hapus.nomor} (${hapus.item} item)?`} onConfirm={doHapus} onCancel={() => setHapus(null)} />}
    </section>
  );
}

function PermintaanForm({
  id,
  ttdTerakhir,
  terakhir,
  bisaUbah,
  onClose,
  onSaved,
}: {
  id: number | null;
  ttdTerakhir: Partial<KopPermintaanTtd> | null;
  terakhir: { kode: string; jenis: string; satuan: string; isi: number | null }[];
  bisaUbah: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [barang, setBarang] = useState<KopBarang[]>([]);
  const [nomor, setNomor] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<number | null>(id);
  const [tanggal, setTanggal] = useState(localToday());
  const [catatan, setCatatan] = useState("");
  const [ttd, setTtd] = useState<KopPermintaanTtd>(kopTtdLengkap(ttdTerakhir));
  const [rows, setRows] = useState<Baris[]>(() => Array.from({ length: 3 }, barisKosong));
  const [loading, setLoading] = useState(id !== null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .kopBarang({ aktif: "1" })
      .then(setBarang)
      .catch(() => setBarang([]));
  }, []);
  useEffect(() => {
    if (id === null) return;
    api
      .kopPermintaanGet(id)
      .then((p) => {
        setNomor(p.nomor);
        setTanggal(p.tanggal);
        setCatatan(p.catatan);
        setTtd(kopTtdLengkap(p.ttd));
        setRows(
          p.lines.map((l) => ({
            key: nextKey++,
            kode: l.barang_kode ?? "",
            teks: l.barang_kode ? `${l.barang_kode} · ${l.nama}` : l.nama,
            nama: l.nama,
            jenis: l.jenis,
            jumlah: String(l.jumlah),
            satuan: l.satuan,
            isi: l.isi === null ? "" : String(l.isi),
            tgl_masuk: l.tgl_masuk ?? "",
            masuk: l.masuk ?? null,
          }))
        );
      })
      .catch((e) => setError(errorText(e, "Gagal memuat permintaan")))
      .finally(() => setLoading(false));
  }, [id]);

  const byLabel = useMemo(() => new Map(barang.map((b) => [labelBarang(b).toUpperCase(), b])), [barang]);
  const byKode = useMemo(() => new Map(barang.map((b) => [b.kode.toUpperCase(), b])), [barang]);
  const lalu = useMemo(() => new Map(terakhir.map((t) => [t.kode, t])), [terakhir]);

  const ubah = (key: number, patch: Partial<Baris>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  // The barang typed / picked: "K0012 · SAMBAL ..." or its kode is one of the master (jenis / satuan / isi as it was last
  // asked); anything else is a barang outside the master, by name.
  const pilihBarang = (r: Baris, teks: string) => {
    const t = teks.trim().toUpperCase();
    const b = byLabel.get(t) ?? byKode.get(t);
    if (!b) return ubah(r.key, { teks, kode: "", nama: teks.trim() });
    const l = lalu.get(b.kode);
    ubah(r.key, {
      teks: labelBarang(b),
      kode: b.kode,
      nama: b.nama,
      jenis: r.jenis || l?.jenis || "",
      satuan: r.satuan || l?.satuan || "",
      isi: r.isi || (l?.isi ? String(l.isi) : ""),
    });
  };
  const dariBarang = (b: KopBarang): Baris => {
    const l = lalu.get(b.kode);
    return { ...barisKosong(), kode: b.kode, teks: labelBarang(b), nama: b.nama, jenis: l?.jenis ?? "", satuan: l?.satuan ?? "", isi: l?.isi ? String(l.isi) : "" };
  };
  // Stok menipis / habis (at or under its minimum) not in the list yet.
  const menipis = barang.filter((b) => b.aktif && b.lacak_stok && !b.depo_air && Number(b.stok) <= Number(b.stok_min) && !rows.some((r) => r.kode === b.kode));
  const tambahMenipis = () => setRows((rs) => [...rs.filter((r) => r.teks.trim() || r.jumlah.trim()), ...menipis.map(dariBarang)]);

  const isiRows = rows.filter((r) => r.teks.trim() || r.jumlah.trim());
  const simpan = async (lanjut: "tutup" | "cetak") => {
    const lines: KopPermintaanLine[] = isiRows.map((r) => ({
      barang_kode: r.kode || null,
      nama: r.nama || r.teks.trim(),
      jenis: r.jenis.trim(),
      jumlah: parseNum(r.jumlah),
      satuan: r.satuan.trim(),
      isi: r.isi.trim() ? parseNum(r.isi) : null,
      tgl_masuk: r.tgl_masuk || null,
    }));
    const bad = lines.findIndex((l) => !l.nama || !(l.jumlah > 0));
    if (!lines.length) return setError("Isi minimal satu barang");
    if (bad >= 0) return setError(`Baris ${bad + 1}: nama barang dan jumlah (> 0) wajib diisi`);
    setSaving(true);
    setError("");
    try {
      const res = await api.kopPermintaanSave(savedId, { tanggal, catatan, ttd, lines });
      setSavedId(res.id);
      setNomor(res.nomor);
      onSaved();
      if (lanjut === "cetak") printDocument(permintaanKoperasiHtml(await api.kopPermintaanGet(res.id)));
      else onClose();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan"));
    } finally {
      setSaving(false);
    }
  };
  const setOrang = (k: keyof KopPermintaanTtd, f: "nama" | "jabatan", v: string) => setTtd((t) => ({ ...t, [k]: { ...t[k], [f]: v } }));
  const ro = !bisaUbah;
  // Tgl Masuk only once the request exists: a new one is only what is asked; it then fills from Stock In.
  const tersimpan = savedId !== null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-2 sm:p-6 overflow-y-auto" onClick={onClose}>
      <div className="bg-[var(--bg-card)] rounded-lg shadow-xl w-full max-w-6xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-[var(--text-primary)] inline-flex items-center gap-2">
              <ClipboardList size={17} /> {nomor ? `Permintaan Barang ${nomor}` : "Permintaan Barang Baru"}
            </h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">Ketik kode / nama barang (atau barang baru di luar daftar). Jenis, satuan dan isi diambil dari permintaan terakhir barang itu.</p>
          </div>
          <button onClick={onClose} title="Tutup" className="p-1 rounded hover:bg-[#f1f5f9] text-[var(--text-muted)]">
            <X size={18} />
          </button>
        </div>
        {loading ? (
          <p className="p-5 text-sm text-[var(--text-muted)]">Memuat...</p>
        ) : (
          <div className="p-5 space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs text-[var(--text-secondary)] mb-1 block">Tanggal</label>
                <input type="date" value={tanggal} disabled={ro} onChange={(e) => e.target.value && setTanggal(e.target.value)} className={inputCls} />
              </div>
              <div className="flex-1 min-w-[220px]">
                <label className="text-xs text-[var(--text-secondary)] mb-1 block">Catatan (opsional, ikut tercetak)</label>
                <input value={catatan} disabled={ro} onChange={(e) => setCatatan(e.target.value)} className={inputCls} />
              </div>
              {!ro && menipis.length > 0 && (
                <button
                  onClick={tambahMenipis}
                  title={menipis.map((b) => b.nama).join(", ")}
                  className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-[var(--accent-amber-border)] bg-[var(--accent-amber-bg)] text-[var(--accent-amber)]"
                >
                  <AlertTriangle size={14} /> Tambah {menipis.length} barang stok menipis / habis
                </button>
              )}
            </div>

            <datalist id="kop-pmt-barang">
              {barang.map((b) => (
                <option key={b.kode} value={labelBarang(b)} />
              ))}
            </datalist>
            <div className="table-scroll">
              <table className="text-sm w-full" style={{ minWidth: 1000 }}>
                <thead>
                  <tr className="text-left text-xs text-[var(--text-secondary)]">
                    <th className="py-1.5 pr-2 w-8">No</th>
                    <th className="py-1.5 pr-2">Barang (kode / nama)</th>
                    <th className="py-1.5 pr-2 w-28">Jenis/Type</th>
                    <th className="py-1.5 pr-2 w-20 text-right">Jumlah</th>
                    <th className="py-1.5 pr-2 w-24">Satuan</th>
                    <th className="py-1.5 pr-2 w-20 text-right" title="Isi dalam satu satuan (mis. 48 per dus)">
                      Isi/Satuan
                    </th>
                    <th className="py-1.5 pr-2 w-16 text-right">Total</th>
                    <th className="py-1.5 pr-2 w-20 text-right" title="Stok koperasi sekarang">
                      Stok skrg
                    </th>
                    {tersimpan && (
                      <th className="py-1.5 pr-2 w-36" title="Otomatis dari Stock In pertama barang ini setelah tanggal permintaan">
                        Tgl Masuk
                      </th>
                    )}
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const b = r.kode ? byKode.get(r.kode) : undefined;
                    const total = parseNum(r.jumlah) * parseNum(r.isi);
                    return (
                      <tr key={r.key} className="align-top">
                        <td className="py-1 pr-2 pt-2.5 text-[var(--text-muted)]">{i + 1}</td>
                        <td className="py-1 pr-2">
                          <input
                            list="kop-pmt-barang"
                            value={r.teks}
                            disabled={ro}
                            onChange={(e) => pilihBarang(r, e.target.value)}
                            placeholder="ketik kode / nama"
                            className={`${inputCls} ${r.teks.trim() && !r.kode ? "border-[var(--accent-amber-border)]" : ""}`}
                          />
                          {r.teks.trim() && !r.kode && <div className="text-[10px] text-[var(--accent-amber)] mt-0.5">di luar daftar barang koperasi</div>}
                        </td>
                        <td className="py-1 pr-2">
                          <input value={r.jenis} disabled={ro} onChange={(e) => ubah(r.key, { jenis: e.target.value })} placeholder="cth. 135 GR" className={inputCls} />
                        </td>
                        <td className="py-1 pr-2">
                          <input value={r.jumlah} disabled={ro} inputMode="decimal" onChange={(e) => ubah(r.key, { jumlah: e.target.value })} className={`${inputCls} text-right`} />
                        </td>
                        <td className="py-1 pr-2">
                          <input value={r.satuan} disabled={ro} onChange={(e) => ubah(r.key, { satuan: e.target.value.toUpperCase() })} placeholder="cth. DUS" list="kop-pmt-satuan" className={inputCls} />
                        </td>
                        <td className="py-1 pr-2">
                          <input value={r.isi} disabled={ro} inputMode="decimal" onChange={(e) => ubah(r.key, { isi: e.target.value })} className={`${inputCls} text-right`} />
                        </td>
                        <td className="py-1 pr-2 pt-2.5 text-right tabular-nums">{total > 0 ? fmtQty(total) : ""}</td>
                        <td className="py-1 pr-2 pt-2.5 text-right tabular-nums text-xs">
                          {b && b.lacak_stok ? (
                            <span className={Number(b.stok) <= Number(b.stok_min) ? "text-[var(--accent-red)] font-medium" : "text-[var(--text-secondary)]"}>
                              {fmtQty(Number(b.stok))} {b.satuan}
                            </span>
                          ) : (
                            ""
                          )}
                        </td>
                        {tersimpan && (
                          <td className="py-1 pr-2">
                            {r.masuk && !r.tgl_masuk ? (
                              <div className="pt-1.5 text-xs text-[var(--accent-green)] font-medium" title="Dari Stock In">
                                {isoDisplay(r.masuk)} <span className="font-normal text-[var(--text-muted)]">(Stock In)</span>
                              </div>
                            ) : r.tgl_masuk || r.manual ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="date"
                                  value={r.tgl_masuk}
                                  min={tanggal}
                                  max={localToday()}
                                  disabled={ro}
                                  onChange={(e) => ubah(r.key, { tgl_masuk: e.target.value })}
                                  className={`${inputCls} text-xs`}
                                  title="Tanggal barang ini diterima (dicatat manual, tanpa Stock In)"
                                />
                                {!ro && (
                                  <button onClick={() => ubah(r.key, { tgl_masuk: "", manual: false })} title="Batal catat manual" className="p-0.5 text-[var(--text-muted)] hover:text-[var(--accent-red)]">
                                    <X size={13} />
                                  </button>
                                )}
                              </div>
                            ) : (
                              <div className="pt-1.5 text-xs text-[var(--text-muted)]">
                                Belum masuk
                                {!ro && (
                                  <button
                                    onClick={() => ubah(r.key, { manual: true })}
                                    title="Barang sudah diterima tapi tidak lewat Stock In: catat tanggalnya"
                                    className="ml-1.5 text-[var(--accent-blue)] hover:underline"
                                  >
                                    Catat manual
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        )}
                        <td className="py-1 pt-1.5">
                          {!ro && (
                            <button onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} title="Hapus baris" className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent-red)] hover:bg-[#f1f5f9]">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <datalist id="kop-pmt-satuan">
                {["DUS", "PACK", "KTK", "BAL", "KARUNG", "PCS", "RENCENG", "SAK", "LUSIN"].map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
            {!ro && (
              <button onClick={() => setRows((rs) => [...rs, barisKosong()])} className="inline-flex items-center gap-1 text-sm text-[var(--accent-blue)] hover:underline">
                <Plus size={14} /> Tambah baris
              </button>
            )}

            <div className="grid sm:grid-cols-2 gap-3 border-t border-[var(--border)] pt-4">
              {(
                [
                  ["dibuat", "Dibuat oleh"],
                  ["diketahui", "Diketahui oleh"],
                ] as const
              ).map(([k, judul]) => (
                <div key={k} className="space-y-1.5">
                  <div className="text-xs font-medium text-[var(--text-secondary)]">{judul}</div>
                  <input value={ttd[k].nama} disabled={ro} onChange={(e) => setOrang(k, "nama", e.target.value)} placeholder="Nama" className={inputCls} />
                  <input value={ttd[k].jabatan} disabled={ro} onChange={(e) => setOrang(k, "jabatan", e.target.value)} placeholder="Jabatan" className={inputCls} />
                </div>
              ))}
            </div>

            {error && <p className="text-sm text-[var(--accent-red)]">{error}</p>}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="mr-auto text-xs text-[var(--text-muted)]">{isiRows.length} barang</span>
              <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-[var(--border)] text-[var(--text-secondary)]">
                {ro ? "Tutup" : "Batal"}
              </button>
              {ro ? (
                savedId && (
                  <button
                    onClick={async () => printDocument(permintaanKoperasiHtml((await api.kopPermintaanGet(savedId)) as KopPermintaan))}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-md bg-[var(--accent-blue)] text-white"
                  >
                    <Printer size={15} /> Cetak
                  </button>
                )
              ) : (
                <>
                  <button onClick={() => simpan("tutup")} disabled={saving} className="px-4 py-2 text-sm rounded-md border border-[var(--accent-blue-border)] text-[var(--accent-blue)] disabled:opacity-50">
                    {saving ? "Menyimpan..." : "Simpan"}
                  </button>
                  <button onClick={() => simpan("cetak")} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-md bg-[var(--accent-blue)] text-white disabled:opacity-50">
                    <Printer size={15} /> Simpan &amp; Cetak
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

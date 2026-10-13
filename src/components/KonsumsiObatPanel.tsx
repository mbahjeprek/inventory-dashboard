import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Search, X } from "lucide-react";
import { api, errorText, type KunjunganOptions } from "../lib/api";
import { ExportButtons } from "./ExportButtons";
import { useDragScroll } from "../hooks/useDragScroll";
import type { SectionReport, TableReport } from "../lib/printTable";

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const fmt = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 1 });
const bulanLabel = (ym: string) => `${BULAN[Number(ym.slice(5)) - 1]} ${ym.slice(2, 4)}`;
const tgl = (iso: string) => iso.split("-").reverse().join("/");
const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type Data = Awaited<ReturnType<typeof api.konsumsiObat>>;
type Detail = Awaited<ReturnType<typeof api.konsumsiObatDetail>>["data"];
type ObatRow = { kode: string; nama: string; satuan: string; per: Map<string, number>; total: number; pasien: number; avg: number; stok: number | null };

// Every month from `from` to `to` (to capped at today), as YYYY-MM.
function monthsBetween(from: string, to: string) {
  const end = (to > localIso(new Date()) ? localIso(new Date()) : to).slice(0, 7);
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  while (`${y}-${String(m).padStart(2, "0")}` <= end && out.length < 60) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

// Klinik > Laporan Harian > Konsumsi Obat: how much of each obat the clinic gave per month (the
// terapi of its visits), to how many patients, the monthly average and how long the stock now lasts
// at that rate. One obat picked: its bars per month.
export function KonsumsiObatPanel({ klinik, dateFrom, dateTo, periodText }: { klinik: string; dateFrom: string; dateTo: string; periodText: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [master, setMaster] = useState<KunjunganOptions["obat"]>([]);
  const [obatText, setObatText] = useState("");
  const [search, setSearch] = useState("");
  const scrollRef = useDragScroll<HTMLDivElement>();
  // The month whose patients are listed (YYYY-MM, "" = the whole period, null = none).
  const [bulan, setBulan] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

  useEffect(() => {
    api
      .kunjunganOptions(klinik)
      .then((o) => setMaster(o.obat))
      .catch(() => setMaster([]));
  }, [klinik]);
  const obat = master.find((o) => `${o.nama} · ${o.kode}` === obatText || o.nama.toLowerCase() === obatText.trim().toLowerCase());

  useEffect(() => {
    let stale = false;
    setData(null);
    setError("");
    api
      .konsumsiObat({ klinik, dateFrom, dateTo, obat: obat?.kode })
      .then((d) => !stale && setData(d))
      .catch((e) => !stale && setError(errorText(e, "Gagal memuat konsumsi obat")));
    return () => {
      stale = true;
    };
  }, [klinik, dateFrom, dateTo, obat?.kode]);

  useEffect(() => {
    if (!obat || bulan === null) return;
    let stale = false;
    setDetail(null);
    api
      .konsumsiObatDetail({ klinik, dateFrom, dateTo, obat: obat.kode, bulan })
      .then((d) => !stale && setDetail(d.data))
      .catch(() => !stale && setDetail([]));
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [klinik, dateFrom, dateTo, obat?.kode, bulan]);
  // Another period / klinik: the list closes (its month may not be in it).
  useEffect(() => setBulan(null), [klinik, dateFrom, dateTo]);
  const showDetail = (o: { nama: string; kode: string }, m: string) => {
    setObatText(`${o.nama} · ${o.kode}`);
    setBulan(m);
    setTimeout(() => document.getElementById("konsumsi-detail")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 300);
  };

  // Months shown: the period's, from the first month the clinic has visits (earlier ones aren't 0, just no data).
  const months = useMemo(() => {
    if (!data) return [];
    const all = monthsBetween(dateFrom > "0000-01-01" ? dateFrom : (data.bulanData[0] ?? dateTo) + "-01", dateTo);
    const first = data.bulanData[0];
    return first ? all.filter((m) => m >= first) : all;
  }, [data, dateFrom, dateTo]);

  const list = useMemo<ObatRow[]>(() => {
    if (!data) return [];
    const stok = new Map(data.stok.map((s) => [s.kode, Number(s.stok)]));
    const by = new Map<string, ObatRow>();
    for (const r of data.rows) {
      const o = by.get(r.kode) ?? { kode: r.kode, nama: r.nama, satuan: r.satuan, per: new Map(), total: 0, pasien: 0, avg: 0, stok: stok.get(r.kode) ?? null };
      o.per.set(r.bulan, (o.per.get(r.bulan) ?? 0) + Number(r.qty));
      o.total += Number(r.qty);
      o.pasien += r.pasien;
      by.set(r.kode, o);
    }
    const n = Math.max(months.length, 1);
    return [...by.values()].map((o) => ({ ...o, avg: o.total / n })).sort((a, b) => b.total - a.total || a.nama.localeCompare(b.nama));
  }, [data, months]);
  // The search box is hidden while one obat is picked, so it doesn't narrow the table then.
  const shown = !obat && search.trim() ? list.filter((o) => `${o.nama} ${o.kode}`.toLowerCase().includes(search.trim().toLowerCase())) : list;
  const cukup = (o: ObatRow) => (o.stok === null ? null : o.avg > 0 ? o.stok / o.avg : null);

  const one = obat ? list.find((o) => o.kode === obat.kode) : null;
  const chart = one ? months.map((m) => ({ bulan: bulanLabel(m), qty: one.per.get(m) ?? 0 })) : [];
  const openMonth = months.at(-1) === localIso(new Date()).slice(0, 7);

  const buildReport = async (): Promise<SectionReport> => ({
    title: `Konsumsi Obat - Klinik ${klinik}`,
    subtitle: [
      `Periode: ${periodText}${obat ? ` · ${obat.nama}` : ""}`,
      "Sumber: terapi di Laporan Harian. Rata-rata = total dibagi jumlah bulan; stok cukup = stok sekarang dibagi rata-rata per bulan.",
    ],
    landscape: true,
    sections: [
      {
        heading: "",
        columns: [
          { label: "No", align: "right" },
          { label: "Obat" },
          { label: "Satuan" },
          ...months.map((m) => ({ label: bulanLabel(m), align: "right" as const })),
          { label: "Total", align: "right" },
          { label: "Rata-rata / bulan", align: "right" },
          { label: "Pasien", align: "right" },
          { label: "Stok sekarang", align: "right" },
          { label: "Stok cukup (bulan)", align: "right" },
        ],
        rows: shown.map((o, i) => [i + 1, o.nama, o.satuan, ...months.map((m) => o.per.get(m) ?? 0), o.total, Math.round(o.avg * 10) / 10, o.pasien, o.stok, cukup(o) === null ? "" : Math.round(cukup(o)! * 10) / 10]),
        note:
          data && (data.totals.tanpa_master || data.totals.tanpa_qty)
            ? `Tidak terhitung: ${data.totals.tanpa_master} terapi yang namanya belum cocok dengan master obat, ${data.totals.tanpa_qty} terapi tanpa qty.`
            : undefined,
      },
    ],
  });

  return (
    <section className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
      <div className="p-3 flex flex-wrap items-center gap-2 border-b border-[var(--border)]">
        <div className="relative w-full sm:w-72">
          <input
            list="konsumsi-obat"
            value={obatText}
            onChange={(e) => {
              setObatText(e.target.value);
              setBulan(null);
            }}
            placeholder="Semua obat (pilih satu untuk grafiknya)"
            className="w-full text-sm rounded-md border border-[var(--border)] pl-3 pr-8 py-1.5"
            aria-label="Obat"
          />
          {obatText && (
            <button
              onClick={() => {
                setObatText("");
                setBulan(null);
              }}
              title="Semua obat" className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              <X size={14} />
            </button>
          )}
          <datalist id="konsumsi-obat">
            {master.map((o) => (
              <option key={o.kode} value={`${o.nama} · ${o.kode}`} />
            ))}
          </datalist>
        </div>
        {!obat && (
          <div className="relative w-full sm:w-56">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari di tabel..." className="w-full text-sm rounded-md border border-[var(--border)] pl-8 pr-3 py-1.5" />
          </div>
        )}
        <span className="text-xs text-[var(--text-muted)]">
          {data ? `${fmt(shown.length)} obat · ${fmt(data.totals.pasien)} kunjungan dengan terapi · ${months.length} bulan` : ""}
        </span>
        <div className="ml-auto flex gap-2">{data && <ExportButtons total={0} buildReport={buildReport} fileName={`konsumsi-obat-klinik-${klinik.toLowerCase()}`} />}</div>
      </div>

      {error ? (
        <p className="p-4 text-sm text-[var(--accent-red)]">{error}</p>
      ) : !data ? (
        <p className="p-4 text-sm text-[var(--text-muted)]">Memuat...</p>
      ) : (
        <>
          {one && (
            <div className="p-4 border-b border-[var(--border)]">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                <div className="text-sm font-medium text-[var(--text-primary)]">
                  {one.nama} per bulan <span className="text-xs font-normal text-[var(--text-muted)]">({one.satuan}) · klik batang untuk daftar pasiennya</span>
                </div>
                <div className="text-xs text-[var(--text-secondary)]">
                  Total <b>{fmt(one.total)}</b> · rata-rata <b>{fmt(one.avg)}</b>/bulan · {fmt(one.pasien)} pasien · stok sekarang <b>{one.stok === null ? "-" : fmt(one.stok)}</b>
                  {cukup(one) !== null && ` (± ${fmt(cukup(one)!)} bulan)`}
                </div>
              </div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="#e8edf3" />
                    <XAxis dataKey="bulan" tick={{ fontSize: 11, fill: "#5b6b7c" }} axisLine={{ stroke: "#d5dde6" }} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#5b6b7c" }} axisLine={false} tickLine={false} width={44} />
                    <Tooltip formatter={(v) => [`${fmt(Number(v))} ${one.satuan}`, "Diberikan"]} cursor={{ fill: "#f1f5f9" }} />
                    <Bar dataKey="qty" fill="#2a78d6" radius={[4, 4, 0, 0]} maxBarSize={40} cursor="pointer" onClick={(_, i) => showDetail(one, months[i])}>
                      {chart.map((c, i) => (
                        <Cell key={c.bulan} fill={bulan === months[i] ? "#16448a" : "#2a78d6"} />
                      ))}
                      <LabelList dataKey="qty" position="top" formatter={(v: unknown) => (Number(v) ? fmt(Number(v)) : "")} style={{ fontSize: 10, fill: "#1a2634" }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {openMonth && <p className="text-[10px] text-[var(--text-muted)] mt-1">Bulan {bulanLabel(months.at(-1)!)} masih berjalan, belum penuh.</p>}
            </div>
          )}

          {one && bulan !== null && (
            <DetailList
              klinik={klinik}
              obat={one}
              bulan={bulan}
              periodText={periodText}
              rows={detail}
              onAll={() => setBulan("")}
              onClose={() => setBulan(null)}
            />
          )}

          <div ref={scrollRef} className="overflow-x-auto">
            <table className="grid-table data-table text-sm">
              <thead>
                <tr className="bg-[#f8fafc] text-[var(--text-secondary)] text-xs uppercase">
                  <th className="px-3 py-2.5 text-right">No</th>
                  <th className="px-3 py-2.5 text-left">Obat</th>
                  {months.map((m) => (
                    <th key={m} className="px-3 py-2.5 text-right whitespace-nowrap">
                      {bulanLabel(m)}
                    </th>
                  ))}
                  <th className="px-3 py-2.5 text-right">Total</th>
                  <th className="px-3 py-2.5 text-right">Rata-rata / bln</th>
                  <th className="px-3 py-2.5 text-right">Pasien</th>
                  <th className="px-3 py-2.5 text-right">Stok skrg</th>
                  <th className="px-3 py-2.5 text-right" title="Stok sekarang dibagi rata-rata per bulan">
                    Cukup (bln)
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr>
                    <td colSpan={months.length + 7} className="px-4 py-8 text-center text-[var(--text-muted)]">
                      Tidak ada obat diberikan di periode ini
                    </td>
                  </tr>
                ) : (
                  shown.map((o, i) => {
                    const c = cukup(o);
                    return (
                      <tr key={o.kode} className="align-top cursor-pointer" onClick={() => setObatText(`${o.nama} · ${o.kode}`)} title="Lihat grafik per bulan">
                        <td className="px-3 py-2 text-right text-[var(--text-muted)]">{i + 1}</td>
                        <td className="col-grow px-3 py-2">
                          <div className="font-medium text-[var(--text-primary)]">{o.nama}</div>
                          <div className="text-[11px] text-[var(--text-muted)]">
                            {o.kode} · {o.satuan}
                          </div>
                        </td>
                        {months.map((m) => (
                          <td
                            key={m}
                            onClick={(e) => {
                              if (!o.per.get(m)) return;
                              e.stopPropagation();
                              showDetail(o, m);
                            }}
                            title={o.per.get(m) ? `Pasien ${o.nama} di ${bulanLabel(m)}` : undefined}
                            className={`px-3 py-2 text-right tabular-nums ${
                              o.per.get(m)
                                ? `hover:underline hover:text-[var(--accent-blue)] ${obat?.kode === o.kode && bulan === m ? "bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] font-semibold" : ""}`
                                : "text-[var(--text-muted)]"
                            }`}
                          >
                            {fmt(o.per.get(m) ?? 0)}
                          </td>
                        ))}
                        <td
                          onClick={(e) => {
                            e.stopPropagation();
                            showDetail(o, "");
                          }}
                          title={`Semua pasien ${o.nama} di periode ini`}
                          className="px-3 py-2 text-right tabular-nums font-semibold hover:underline hover:text-[var(--accent-blue)]"
                        >
                          {fmt(o.total)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(o.avg)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-[var(--text-secondary)]">{fmt(o.pasien)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{o.stok === null ? <span className="text-[var(--accent-red)]">tidak ada</span> : fmt(o.stok)}</td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums font-medium ${
                            c === null ? "text-[var(--text-muted)]" : c < 1 ? "text-[var(--accent-red)]" : c < 2 ? "text-[var(--accent-amber)]" : "text-[var(--accent-green)]"
                          }`}
                        >
                          {c === null ? "-" : fmt(c)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-[var(--border)] text-[11px] text-[var(--text-muted)] space-y-0.5">
            <div>
              Sumber: terapi di Laporan Harian {klinik}
              {data.bulanData[0] && ` (data mulai ${bulanLabel(data.bulanData[0])})`}. Rata-rata = total ÷ {months.length} bulan
              {openMonth && " (bulan berjalan dihitung penuh)"}. Cukup = stok sekarang ÷ rata-rata per bulan: merah &lt; 1 bulan, kuning &lt; 2 bulan. Klik baris untuk grafiknya, klik angka bulan / total untuk daftar pasiennya.
            </div>
            {(data.totals.tanpa_master > 0 || data.totals.tanpa_qty > 0) && (
              <div className="text-[var(--accent-amber)]">
                Tidak terhitung: {fmt(data.totals.tanpa_master)} terapi yang namanya belum cocok dengan master obat (Super User: Cocokkan Nama Obat di Data Kunjungan)
                {data.totals.tanpa_qty > 0 && `, ${fmt(data.totals.tanpa_qty)} terapi tanpa qty`}.
              </div>
            )}
            {dateFrom > "0000-01-01" && <div>Periode {tgl(dateFrom)} - {tgl(dateTo)}.</div>}
          </div>
        </>
      )}
    </section>
  );
}

// The patients who got one obat in a month (or the whole period): date, patient, diagnosis, qty and
// whether it was cut from the clinic's stock. Cetak / Excel of the list.
function DetailList({
  klinik,
  obat,
  bulan,
  periodText,
  rows,
  onAll,
  onClose,
}: {
  klinik: string;
  obat: { kode: string; nama: string; satuan: string };
  bulan: string;
  periodText: string;
  rows: Detail | null;
  onAll: () => void;
  onClose: () => void;
}) {
  const when = bulan ? bulanLabelPanjang(bulan) : `periode ${periodText}`;
  const total = (rows ?? []).reduce((s, r) => s + (r.qty ?? 0), 0);
  const stok = (r: Detail[number]) => (r.sebelum_opname ? "sebelum opname" : r.terpotong ? "terpotong" : r.qty === null ? "qty kosong" : "belum terpotong");
  const report = async (): Promise<TableReport> => ({
    title: `${obat.nama} - Klinik ${klinik}`,
    subtitle: [`Pasien yang menerima ${obat.nama} · ${when}`, `${fmt(total)} ${obat.satuan} · ${fmt((rows ?? []).length)} pemberian`],
    columns: [
      { label: "No", align: "right" },
      { label: "Tanggal", nowrap: true },
      { label: "Nama Pasien" },
      { label: "L/P" },
      { label: "Usia", align: "right" },
      { label: "Status" },
      { label: "Jabatan / Divisi" },
      { label: "Diagnosis" },
      { label: "Qty", align: "right" },
      { label: "Satuan" },
      { label: "Stok" },
    ],
    rows: (rows ?? []).map((r, i) => [
      i + 1,
      tgl(r.tanggal_iso),
      r.nama_pasien,
      r.jenis_kelamin,
      r.usia,
      r.status_pasien,
      [r.jabatan, r.divisi].filter(Boolean).join(" / "),
      r.diagnosis,
      r.qty,
      obat.satuan,
      stok(r),
    ]),
  });
  return (
    <div id="konsumsi-detail" className="border-b border-[var(--border)]">
      <div className="px-4 py-2.5 flex flex-wrap items-center gap-2 bg-[var(--accent-blue-bg)]">
        <div className="text-sm text-[var(--text-primary)]">
          <b>{obat.nama}</b> · {when}
          {rows && (
            <span className="text-[var(--text-secondary)]">
              {" "}
              · {fmt(total)} {obat.satuan} untuk {fmt(rows.length)} pemberian
            </span>
          )}
        </div>
        {bulan && (
          <button onClick={onAll} className="text-xs text-[var(--accent-blue)] hover:underline">
            Lihat semua bulan
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {rows && rows.length > 0 && <ExportButtons total={0} buildReport={report} fileName={`pasien-${obat.kode.toLowerCase()}-klinik-${klinik.toLowerCase()}`} />}
          <button onClick={onClose} title="Tutup" className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white">
            <X size={16} />
          </button>
        </div>
      </div>
      {rows === null ? (
        <p className="px-4 py-3 text-sm text-[var(--text-muted)]">Memuat...</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-[var(--text-muted)]">Tidak ada pemberian</p>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="data-table text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-xs text-[var(--text-secondary)] border-b border-[var(--border)]">
                <th className="px-3 py-2 text-right">No</th>
                <th className="px-3 py-2">Tanggal</th>
                <th className="px-3 py-2">Pasien</th>
                <th className="px-3 py-2">Status / Divisi</th>
                <th className="px-3 py-2">Diagnosis</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2">Stok</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {rows.map((r, i) => (
                <tr key={`${r.id}-${i}`} className="align-top">
                  <td className="px-3 py-2 text-right text-[var(--text-muted)]">{i + 1}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{tgl(r.tanggal_iso)}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-[var(--text-primary)]">{r.nama_pasien}</div>
                    <div className="text-[11px] text-[var(--text-muted)]">{[r.jenis_kelamin, r.usia !== null && `${r.usia} th`, r.jenis_kunjungan].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="px-3 py-2 text-[var(--text-secondary)]">
                    {r.status_pasien}
                    {(r.jabatan || r.divisi) && <div className="text-[11px] text-[var(--text-muted)]">{[r.jabatan, r.divisi].filter(Boolean).join(" · ")}</div>}
                  </td>
                  <td className="col-grow px-3 py-2">{r.diagnosis || "-"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.qty === null ? "-" : fmt(r.qty)} <span className="text-[11px] text-[var(--text-muted)]">{obat.satuan}</span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.sebelum_opname ? (
                      <span className="text-[var(--text-muted)]">sebelum opname</span>
                    ) : r.terpotong ? (
                      <span className="text-[var(--accent-green)]">✓ terpotong</span>
                    ) : (
                      <span className="text-[var(--accent-amber)]">{r.qty === null ? "qty kosong" : "belum terpotong"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
const BULAN_PANJANG = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const bulanLabelPanjang = (ym: string) => `${BULAN_PANJANG[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;

import { useEffect, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, HandCoins, PackageSearch, Receipt, ShoppingBasket, Truck, Users } from "lucide-react";
import { api, type KopDashboard } from "../lib/api";
import { StatCard } from "./StatCard";

// Dashboard of the Koperasi page (its own tab, not the main Dashboard): totals over the chosen months,
// sales per month and per day, top 15 barang and pengebon, per estate / divisi, barang that sell but
// are running out, and karyawan near their monthly limit. One series per chart, so no legend boxes.
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const BULAN_PANJANG = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const bulanPendek = (p: string) => `${BULAN[Number(p.slice(5, 7)) - 1]} ${p.slice(2, 4)}`;
const bulanLabel = (p: string) => `${BULAN_PANJANG[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
// Axis ticks: "Rp 1,5 jt" / "Rp 250 rb".
const rpShort = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 1 })} M` : n >= 1e6 ? `${(n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt` : n >= 1e3 ? `${Math.round(n / 1e3)} rb` : String(Math.round(n));
const qty = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 1 });

const BAR = "#2a78d6";
const BAR_STRONG = "#16448a";
const GRID = "#e8edf3";
const TICK = { fontSize: 11, fill: "#5b6b7c" };

const RANGES = [
  { n: 1, label: "Bulan ini" },
  { n: 3, label: "3 bulan" },
  { n: 6, label: "6 bulan" },
  { n: 12, label: "12 bulan" },
];
const monthsBack = (p: string, n: number) => {
  const d = new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

function Panel({ title, note, children, className = "" }: { title: string; note?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`bg-[var(--bg-card)] border border-[var(--border)] rounded-lg ${className}`}>
      <div className="px-4 pt-3 pb-2">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        {note && <p className="text-[11px] text-[var(--text-muted)]">{note}</p>}
      </div>
      <div className="px-4 pb-4">{children}</div>
    </section>
  );
}

function Tip({ lines }: { lines: ReactNode[] }) {
  return <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-md shadow px-3 py-2 text-xs space-y-0.5">{lines}</div>;
}

export function KoperasiDashboard({ periode, reload }: { periode: string; reload: number }) {
  const [range, setRange] = useState(1);
  const [d, setD] = useState<KopDashboard | null>(null);
  const [error, setError] = useState("");
  const dari = monthsBack(periode, range - 1);
  useEffect(() => {
    setError("");
    api
      .kopDashboard(dari, periode)
      .then(setD)
      .catch(() => setError("Dashboard gagal dimuat, coba muat ulang"));
  }, [dari, periode, reload]);

  const rangeText = range === 1 ? bulanLabel(periode) : `${bulanLabel(dari)} – ${bulanLabel(periode)}`;
  const k = d?.kpi;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-[var(--border)] overflow-hidden text-sm bg-white">
          {RANGES.map((r) => (
            <button
              key={r.n}
              onClick={() => setRange(r.n)}
              className={`px-3 py-1.5 ${range === r.n ? "bg-[var(--accent-blue)] text-white" : "text-[var(--text-secondary)] hover:bg-[#f1f5f9]"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-[var(--text-muted)]">{rangeText} · sampai periode yang dipilih di atas</span>
      </div>

      {error && <p className="text-sm text-[var(--accent-red)]">{error}</p>}
      {!d || !k ? (
        !error && <p className="text-sm text-[var(--text-muted)]">Memuat dashboard...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-3">
            <StatCard label="Total penjualan" value={rp(k.jual)} icon={ShoppingBasket} tone="blue" footer={<span className="text-[11px] text-[var(--text-muted)]">{k.jenis_barang} jenis barang terjual</span>} />
            <StatCard label="Potong gaji" value={rp(k.potong_gaji)} icon={HandCoins} tone="amber" footer={<span className="text-[11px] text-[var(--text-muted)]">Instansi {rp(k.instansi)}</span>} />
            <StatCard
              label="Karyawan pengebon"
              value={k.pengebon.toLocaleString("id-ID")}
              icon={Users}
              tone="green"
              footer={<span className="text-[11px] text-[var(--text-muted)]">rata-rata {rp(k.pengebon ? k.potong_gaji / k.pengebon : 0)} / orang</span>}
            />
            <StatCard label="Jumlah bon" value={k.bon.toLocaleString("id-ID")} icon={Receipt} tone="blue" footer={<span className="text-[11px] text-[var(--text-muted)]">rata-rata {rp(k.bon ? k.jual / k.bon : 0)} / bon</span>} />
            <StatCard label="Pembelian barang" value={rp(k.beli)} icon={Truck} tone="green" footer={<span className="text-[11px] text-[var(--text-muted)]">belanja stok di periode ini</span>} />
          </div>

          {d.dekatLimit.length > 0 && (
            <div className="flex items-start gap-3 rounded-lg border border-[var(--accent-amber-border)] bg-[var(--accent-amber-bg)] px-4 py-3 text-sm text-[var(--accent-amber)]">
              <AlertTriangle size={18} className="shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">
                  {d.dekatLimit.length} karyawan sudah memakai ≥ 80% limit {rp(d.limit)} di {bulanLabel(d.sampai)}
                </div>
                <div className="text-xs mt-0.5">
                  {d.dekatLimit.map((x) => `${x.nama} (${rp(x.total)}${x.total > d.limit ? ", lewat" : ""})`).join(" · ")}
                </div>
              </div>
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-4">
            <Panel title="Penjualan per bulan" note={`12 bulan sampai ${bulanLabel(d.sampai)} · batang gelap = bulan yang dipilih`}>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.perBulan} margin={{ top: 18, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke={GRID} />
                    <XAxis dataKey="periode" tickFormatter={bulanPendek} tick={TICK} axisLine={{ stroke: "#d5dde6" }} tickLine={false} minTickGap={4} />
                    <YAxis tickFormatter={rpShort} tick={TICK} axisLine={false} tickLine={false} width={48} />
                    <Tooltip
                      cursor={{ fill: "#f1f5f9" }}
                      content={({ active, payload }) => {
                        const r = active && (payload?.[0]?.payload as KopDashboard["perBulan"][number] | undefined);
                        return r ? (
                          <Tip
                            lines={[
                              <div key="b" className="font-medium text-[var(--text-primary)]">{bulanLabel(r.periode)}</div>,
                              <div key="j">Penjualan <b>{rp(r.jual)}</b></div>,
                              <div key="p">{r.pengebon} karyawan pengebon</div>,
                              <div key="be" className="text-[var(--text-muted)]">Pembelian {rp(r.beli)}</div>,
                            ]}
                          />
                        ) : null;
                      }}
                    />
                    <Bar dataKey="jual" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false}>
                      {d.perBulan.map((r) => (
                        <Cell key={r.periode} fill={r.periode >= d.dari && r.periode <= d.sampai ? BAR_STRONG : BAR} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            {d.perHari.length > 0 ? (
              <Panel title={`Penjualan harian ${bulanLabel(d.sampai)}`} note="Arahkan ke batang untuk jumlah orang yang mengambil">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={d.perHari} margin={{ top: 18, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid vertical={false} stroke={GRID} />
                      <XAxis dataKey="tanggal" tickFormatter={(t: string) => String(Number(t.slice(8)))} tick={TICK} axisLine={{ stroke: "#d5dde6" }} tickLine={false} />
                      <YAxis tickFormatter={rpShort} tick={TICK} axisLine={false} tickLine={false} width={48} />
                      <Tooltip
                        cursor={{ fill: "#f1f5f9" }}
                        content={({ active, payload }) => {
                          const r = active && (payload?.[0]?.payload as KopDashboard["perHari"][number] | undefined);
                          return r ? (
                            <Tip
                              lines={[
                                <div key="t" className="font-medium text-[var(--text-primary)]">{r.tanggal.split("-").reverse().join("/")}</div>,
                                <div key="j">Penjualan <b>{rp(r.jual)}</b></div>,
                                <div key="o">{r.orang} orang</div>,
                              ]}
                            />
                          ) : null;
                        }}
                      />
                      <Bar dataKey="jual" fill={BAR} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
            ) : (
              <Panel title="Penjualan per estate / divisi" note={rangeText}>
                <DivisiChart d={d} />
              </Panel>
            )}
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Panel title="Top 15 barang terlaris" note={`Menurut nilai penjualan · ${rangeText}`}>
              {d.topBarang.length ? (
                <div style={{ height: 30 + d.topBarang.length * 26 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={d.topBarang} layout="vertical" margin={{ top: 0, right: 104, bottom: 0, left: 0 }} barCategoryGap={4}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="nama" width={190} tick={{ fontSize: 11, fill: "#1a2634" }} axisLine={false} tickLine={false} tickFormatter={(n: string) => (n.length > 28 ? `${n.slice(0, 27)}…` : n)} />
                      <Tooltip
                        cursor={{ fill: "#f1f5f9" }}
                        content={({ active, payload }) => {
                          const r = active && (payload?.[0]?.payload as KopDashboard["topBarang"][number] | undefined);
                          return r ? (
                            <Tip
                              lines={[
                                <div key="n" className="font-medium text-[var(--text-primary)]">{r.nama}</div>,
                                <div key="k" className="text-[var(--text-muted)]">{r.kode}</div>,
                                <div key="v">Penjualan <b>{rp(r.nilai)}</b></div>,
                                <div key="q">
                                  {qty(r.qty)} {r.satuan} · {r.orang} orang
                                </div>,
                              ]}
                            />
                          ) : null;
                        }}
                      />
                      <Bar dataKey="nilai" fill={BAR} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                        <LabelList dataKey="nilai" position="right" formatter={(v: unknown) => rp(Number(v))} style={{ fontSize: 10, fill: "#1a2634" }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">Belum ada penjualan.</p>
              )}
            </Panel>

            <Panel title="Top 15 pengebon" note={`Karyawan dengan potong gaji terbesar · ${rangeText}`}>
              {d.topPengebon.length ? (
                <div className="table-scroll -mx-1">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-[var(--text-secondary)] border-b border-[var(--border)]">
                        <th className="px-1 py-1.5 w-6">#</th>
                        <th className="px-1 py-1.5">Nama</th>
                        <th className="px-1 py-1.5 whitespace-nowrap">Estate / Divisi</th>
                        <th className="px-1 py-1.5 text-right">Bon</th>
                        <th className="px-1 py-1.5 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.topPengebon.map((p, i) => {
                        const perBulan = p.total / Math.max(range, 1);
                        return (
                          <tr key={p.kode} className="border-b border-[var(--border)] last:border-0 align-top">
                            <td className="px-1 py-1.5 text-[var(--text-muted)]">{i + 1}</td>
                            <td className="px-1 py-1.5">
                              <div className="font-medium text-[var(--text-primary)]">{p.nama}</div>
                              <div className="text-[11px] text-[var(--text-muted)]">
                                {p.kode}
                                {p.jabatan && ` · ${p.jabatan}`}
                              </div>
                            </td>
                            <td className="px-1 py-1.5 text-xs whitespace-nowrap">{[p.estate, p.divisi].filter(Boolean).join(" / ") || "-"}</td>
                            <td className="px-1 py-1.5 text-right">{p.bon}</td>
                            <td className="px-1 py-1.5 text-right whitespace-nowrap">
                              <div className="font-semibold">{rp(p.total)}</div>
                              {range > 1 && <div className="text-[11px] text-[var(--text-muted)]">± {rp(perBulan)}/bln</div>}
                              {range === 1 && (
                                <div className="mt-1 h-1 w-24 ml-auto rounded-full bg-[#eef2f6] overflow-hidden" title={`${Math.round((p.total / d.limit) * 100)}% dari limit`}>
                                  <div className="h-full" style={{ width: `${Math.min(100, (p.total / d.limit) * 100)}%`, background: p.total > d.limit ? "var(--accent-red)" : BAR }} />
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {range === 1 && <p className="text-[10px] text-[var(--text-muted)] mt-1.5">Garis kecil = pemakaian limit {rp(d.limit)} bulan ini.</p>}
                </div>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">Belum ada pengambilan potong gaji.</p>
              )}
            </Panel>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            {d.perHari.length > 0 && (
              <Panel title="Penjualan per estate / divisi" note={rangeText}>
                <DivisiChart d={d} />
              </Panel>
            )}
            <Panel title="Perlu dibeli" note="Barang laku 3 bulan terakhir yang stoknya kurang dari kebutuhan sebulan" className={d.perHari.length ? "" : "lg:col-span-2"}>
              {d.perluBeli.length ? (
                <div className="table-scroll -mx-1">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-[var(--text-secondary)] border-b border-[var(--border)]">
                        <th className="px-1 py-1.5">Barang</th>
                        <th className="px-1 py-1.5 text-right">Stok</th>
                        <th className="px-1 py-1.5 text-right whitespace-nowrap">Laku / bln</th>
                        <th className="px-1 py-1.5 text-right whitespace-nowrap">Harga beli</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.perluBeli.map((b) => (
                        <tr key={b.kode} className="border-b border-[var(--border)] last:border-0">
                          <td className="px-1 py-1.5">
                            <div className="text-[var(--text-primary)]">{b.nama}</div>
                            <div className="text-[11px] text-[var(--text-muted)]">{b.kode}</div>
                          </td>
                          <td className={`px-1 py-1.5 text-right whitespace-nowrap font-semibold ${b.stok <= 0 ? "text-[var(--accent-red)]" : "text-[var(--accent-amber)]"}`}>
                            {b.stok <= 0 ? "Habis" : `${qty(b.stok)} ${b.satuan}`}
                          </td>
                          <td className="px-1 py-1.5 text-right whitespace-nowrap">
                            ± {qty(b.rata)} {b.satuan}
                          </td>
                          <td className="px-1 py-1.5 text-right whitespace-nowrap">{rp(b.harga_beli)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                  <PackageSearch size={16} /> Stok barang yang laku masih cukup.
                </p>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function DivisiChart({ d }: { d: KopDashboard }) {
  if (!d.perDivisi.length) return <p className="text-sm text-[var(--text-muted)]">Belum ada penjualan.</p>;
  return (
    <div style={{ height: 30 + d.perDivisi.length * 28 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={d.perDivisi} layout="vertical" margin={{ top: 0, right: 104, bottom: 0, left: 0 }} barCategoryGap={4}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="grup" width={130} tick={{ fontSize: 11, fill: "#1a2634" }} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: "#f1f5f9" }}
            content={({ active, payload }) => {
              const r = active && (payload?.[0]?.payload as KopDashboard["perDivisi"][number] | undefined);
              return r ? (
                <Tip
                  lines={[
                    <div key="g" className="font-medium text-[var(--text-primary)]">{r.grup}</div>,
                    <div key="t">Penjualan <b>{rp(r.total)}</b></div>,
                    <div key="o">{r.orang} orang</div>,
                  ]}
                />
              ) : null;
            }}
          />
          <Bar dataKey="total" fill={BAR} radius={[0, 4, 4, 0]} isAnimationActive={false}>
            <LabelList dataKey="total" position="right" formatter={(v: unknown) => rp(Number(v))} style={{ fontSize: 10, fill: "#1a2634" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

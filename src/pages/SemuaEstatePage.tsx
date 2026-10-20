import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { api, type OpnameModule } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { canModule, userEstates, type Module } from "../lib/access";
import { useEstateFilter } from "../hooks/useEstateFilter";
import { ESTATES } from "./DashboardPage";
import { TopKeluarPanel } from "../components/TopKeluarPanel";
import { PerbandinganPanel } from "../components/PerbandinganPanel";

// "Semua estate" in the sidebar's estate picker: one menu (Gudang, BBM, Pupuk, Oli, Klinik) across every
// estate the account has (narrowed to the ones picked on the Dashboard, if any) - the stock / saldo of
// each estate side by side, the most-taken barang / obat over them all, and the estate comparison.
type Key = "gudang" | "bbm" | "pupuk" | "oli" | "klinik";
const MENU: Record<Key, { module: Module; label: string; unit?: string }> = {
  gudang: { module: "GUDANG", label: "Gudang" },
  bbm: { module: "BBM", label: "BBM", unit: "L" },
  pupuk: { module: "PUPUK", label: "Pupuk", unit: "KG" },
  oli: { module: "OLI", label: "Oli", unit: "L" },
  klinik: { module: "KLINIK", label: "Klinik" },
};
const fmt = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });

type Estate = (typeof ESTATES)[number];
// Rows of the side-by-side table: a jenis (saldo modules) or a count (Gudang / Klinik), one value per estate.
type Matrix = { rows: { label: string; values: Record<string, number | null>; warn?: boolean }[]; total: boolean };

async function loadMatrix(key: Key, estates: Estate[]): Promise<Matrix> {
  const per = await Promise.all(
    estates.map(async (e) => {
      try {
        if (key === "bbm") return { e, m: Object.fromEntries((await api.bbmSummary(e.estate)).saldoTerakhir.map((s) => [s.jenis_bbm, Number(s.saldo_stock)])) };
        if (key === "pupuk") return { e, m: Object.fromEntries((await api.pupukSummary(e.estate)).saldoTerakhir.map((s) => [s.jenis_pupuk, Number(s.saldo_stock)])) };
        if (key === "oli") return { e, m: Object.fromEntries((await api.oliSummary(e.estate)).saldoTerakhir.map((s) => [s.jenis_oli, Number(s.saldo_stock)])) };
        if (key === "klinik") {
          const s = await api.klinikSummary(e.estate);
          return { e, m: { "Jenis obat": s.totalItems, "Stok menipis": s.lowStock, "Stok habis": s.outOfStock, "Hampir expired": s.expiring } };
        }
        const s = e.estate === "NILAM" ? await api.summary() : await api.gudangStockSummary(e.estate);
        return { e, m: { "Jenis barang": s.totalItems, "Stok menipis": s.lowStock, "Stok habis": s.outOfStock } };
      } catch {
        return { e, m: null };
      }
    })
  );
  const labels = [...new Set(per.flatMap((p) => Object.keys(p.m ?? {})))];
  const saldo = key === "bbm" || key === "pupuk" || key === "oli";
  if (saldo) labels.sort();
  return {
    total: saldo,
    rows: labels.map((label) => ({
      label,
      values: Object.fromEntries(per.map((p) => [p.e.estate, p.m ? (p.m[label] ?? (saldo ? 0 : null)) : null])),
      warn: /habis|menipis|expired/i.test(label),
    })),
  };
}

export function SemuaEstatePage() {
  const { modul = "" } = useParams();
  const { user } = useAuth();
  const picked = useEstateFilter((s) => s.picked);
  const key = modul as Key;
  const menu = MENU[key];
  const own = userEstates(user);
  const narrowed = picked.filter((e) => own.includes(e));
  const estates = ESTATES.filter((e) => (narrowed.length ? narrowed : own).includes(e.estate));
  const estatesKey = estates.map((e) => e.estate).join(",");
  const [matrix, setMatrix] = useState<Matrix | null>(null);

  useEffect(() => {
    if (!menu) return;
    let stale = false;
    setMatrix(null);
    loadMatrix(key, estates).then((m) => !stale && setMatrix(m));
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, estatesKey]);

  if (!menu || !canModule(user, menu.module)) return <Navigate to="/" replace />;
  const pageOf = (e: Estate) => e[key];
  const neg = (v: number | null) => v !== null && v < 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">{menu.label} · Semua Estate</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          {estates.map((e) => e.label).join(", ")} · klik nama estate untuk membuka halamannya
        </p>
      </div>

      <section className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
        <div className="px-4 pt-3 pb-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{matrix?.total ? `Saldo stok per estate${menu.unit ? ` (${menu.unit})` : ""}` : "Ringkasan stok per estate"}</h3>
          <p className="text-[11px] text-[var(--text-muted)]">Saldo terakhir yang tercatat di tiap estate</p>
        </div>
        <div className="table-scroll">
          <table className="data-table text-sm">
            <thead>
              <tr className="bg-[#d5edc9] text-left text-xs text-[var(--text-primary)]">
                <th className="px-3 py-2.5">{matrix?.total ? "Jenis" : "Keterangan"}</th>
                {estates.map((e) => (
                  <th key={e.estate} className="px-3 py-2.5 text-right whitespace-nowrap">
                    <Link to={pageOf(e)} className="hover:underline">
                      {e.label}
                    </Link>
                  </th>
                ))}
                {matrix?.total && <th className="px-3 py-2.5 text-right">Total</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {matrix === null ? (
                <tr>
                  <td colSpan={estates.length + 2} className="px-4 py-6 text-center text-[var(--text-muted)]">
                    Memuat...
                  </td>
                </tr>
              ) : !matrix.rows.length ? (
                <tr>
                  <td colSpan={estates.length + 2} className="px-4 py-6 text-center text-[var(--text-muted)]">
                    Belum ada data
                  </td>
                </tr>
              ) : (
                matrix.rows.map((r) => {
                  const total = Object.values(r.values).reduce<number>((s, v) => s + (v ?? 0), 0);
                  return (
                    <tr key={r.label}>
                      <td className="px-3 py-2 font-medium text-[var(--text-primary)]">{r.label}</td>
                      {estates.map((e) => {
                        const v = r.values[e.estate];
                        return (
                          <td
                            key={e.estate}
                            className={`px-3 py-2 text-right whitespace-nowrap ${neg(v) ? "text-[var(--accent-red)] font-semibold" : r.warn && v ? "text-[var(--accent-amber)] font-semibold" : ""}`}
                          >
                            {v === null ? "-" : fmt(v)}
                          </td>
                        );
                      })}
                      {matrix.total && <td className={`px-3 py-2 text-right whitespace-nowrap font-semibold ${total < 0 ? "text-[var(--accent-red)]" : ""}`}>{fmt(total)}</td>}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {(key === "gudang" || key === "klinik") && <TopKeluarPanel estates={estates} only={key} />}
      <PerbandinganPanel estates={estates} only={menu.module as OpnameModule} />
    </div>
  );
}

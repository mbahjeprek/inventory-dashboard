import { useEffect, useState } from "react";
import { ClipboardCheck, X } from "lucide-react";
import { api, errorText, type KoreksiPengajuan } from "../lib/api";
import { usePersetujuan } from "../hooks/usePersetujuan";

// Pengajuan Koreksi Stok: a Koreksi Stok from an admin (not a Super User) waits here until someone else with
// Setujui Koreksi Stok (HR / akunting / above) or a Super User approves it; only then the difference is booked.

const expTeks = (exp: string) => (exp ? exp.split("-").reverse().join("/") : "tanpa tgl");
const total = (rows: { qty: number }[]) => Math.round(rows.reduce((n, r) => n + r.qty, 0) * 1000) / 1000;
const angka = (n: number) => n.toLocaleString("id-ID");

// What changes: the total (and per expiry date for Klinik), with the difference.
function Perubahan({ k }: { k: KoreksiPengajuan }) {
  const sebelum = total(k.sebelum);
  const sesudah = total(k.sesudah);
  const selisih = Math.round((sesudah - sebelum) * 1000) / 1000;
  const rinci =
    k.module === "KLINIK"
      ? [...new Set([...k.sebelum, ...k.sesudah].map((r) => r.exp))]
          .map((exp) => ({ exp, a: k.sebelum.find((r) => r.exp === exp)?.qty ?? 0, b: k.sesudah.find((r) => r.exp === exp)?.qty ?? 0 }))
          .filter((r) => r.a !== r.b)
      : [];
  return (
    <div>
      <div className="whitespace-nowrap">
        {angka(sebelum)} → <b>{angka(sesudah)}</b> {k.satuan}{" "}
        <span className={selisih < 0 ? "text-[var(--accent-red)]" : "text-[var(--accent-green)]"}>
          ({selisih > 0 ? "+" : ""}
          {angka(selisih)})
        </span>
      </div>
      {rinci.map((r) => (
        <div key={r.exp} className="text-[11px] text-[var(--text-muted)] whitespace-nowrap">
          ED {expTeks(r.exp)}: {angka(r.a)} → {angka(r.b)}
        </div>
      ))}
    </div>
  );
}

// The list of requests: on Persetujuan (all the account may approve) or on a gudang / klinik page (that one, hidden
// while nothing waits). Setujui / Tolak for an approver who didn't ask; Batal for who asked.
export function KoreksiPengajuanList({
  module,
  estate,
  sembunyiKosong = false,
  reload = 0,
  onChanged,
}: {
  module?: "GUDANG" | "KLINIK";
  estate?: string;
  sembunyiKosong?: boolean;
  reload?: number;
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<KoreksiPengajuan[] | null>(null);
  const [error, setError] = useState("");
  const [periksa, setPeriksa] = useState<{ k: KoreksiPengajuan; setuju: boolean } | null>(null);
  const [catatan, setCatatan] = useState("");
  const [busy, setBusy] = useState(false);
  const refreshJumlah = usePersetujuan((s) => s.refresh);
  const load = () =>
    api
      .koreksiList({ ...(module ? { module } : {}), ...(estate ? { estate } : {}) })
      .then((r) => (setRows(r.data), setError("")))
      .catch((e) => (setRows([]), setError(errorText(e, "Gagal memuat pengajuan koreksi"))));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module, estate, reload]);

  const selesai = () => {
    setPeriksa(null);
    setCatatan("");
    load();
    refreshJumlah();
    onChanged?.();
  };
  const kirim = async () => {
    if (!periksa) return;
    if (!periksa.setuju && !catatan.trim()) return setError("Tulis alasan penolakannya");
    setBusy(true);
    try {
      await api.koreksiPeriksa(periksa.k.id, { setuju: periksa.setuju, catatan: catatan.trim() });
      selesai();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan"));
    } finally {
      setBusy(false);
    }
  };
  const batal = async (k: KoreksiPengajuan) => {
    setBusy(true);
    try {
      await api.koreksiBatal(k.id);
      selesai();
    } catch (e) {
      setError(errorText(e, "Gagal membatalkan"));
    } finally {
      setBusy(false);
    }
  };

  if (sembunyiKosong && (!rows || !rows.length) && !error) return null;
  const btn = "px-2.5 py-1 rounded-md text-xs font-medium disabled:opacity-50";
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--accent-amber-border)] rounded-lg">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)]">
        <ClipboardCheck size={16} className="text-[var(--accent-amber)]" />
        <span className="text-sm font-semibold text-[var(--text-primary)]">Koreksi Stok menunggu persetujuan</span>
        {rows && rows.length > 0 && <span className="text-xs text-[var(--accent-amber)]">{rows.length}</span>}
      </div>
      <p className="px-4 pt-2 text-[11px] text-[var(--text-muted)]">
        Stok baru berubah setelah disetujui orang lain yang punya hak Setujui Koreksi Stok (atau Super User). Yang dibukukan selisihnya, jadi transaksi
        sesudah pengajuan tetap terhitung.
      </p>
      {error && <p className="px-4 pt-2 text-xs text-[var(--accent-red)]">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-[var(--text-secondary)]">
            <tr className="text-left">
              <th className="px-4 py-2">Diajukan</th>
              <th className="px-3 py-2">Barang</th>
              <th className="px-3 py-2">Stok tercatat → hitung fisik</th>
              <th className="px-3 py-2">Alasan</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr>
                <td colSpan={5} className="px-4 py-4 text-center text-[var(--text-muted)]">
                  Memuat...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-4 text-center text-[var(--text-muted)]">
                  Tidak ada koreksi stok yang menunggu.
                </td>
              </tr>
            ) : (
              rows.map((k) => (
                <tr key={k.id} className="border-t border-[var(--border)] align-top">
                  <td className="px-4 py-2 whitespace-nowrap">
                    <div>{k.diajukan_waktu}</div>
                    <div className="text-[11px] text-[var(--text-muted)]">oleh {k.diajukan_nama || "-"}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{k.nama}</div>
                    <div className="text-[11px] text-[var(--text-muted)]">
                      {k.kode} · {k.module === "KLINIK" ? "Klinik" : "Gudang"} {k.estate}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Perubahan k={k} />
                  </td>
                  <td className="px-3 py-2 text-[var(--text-secondary)] min-w-[160px]">{k.alasan}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1.5">
                      {k.bisa_setujui && (
                        <>
                          <button disabled={busy} onClick={() => setPeriksa({ k, setuju: true })} className={`${btn} bg-[var(--accent-green)] text-white hover:opacity-90`}>
                            Setujui
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => setPeriksa({ k, setuju: false })}
                            className={`${btn} border border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]`}
                          >
                            Tolak
                          </button>
                        </>
                      )}
                      {k.bisa_batal && (
                        <button disabled={busy} onClick={() => batal(k)} className={`${btn} border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]`}>
                          Batalkan
                        </button>
                      )}
                      {!k.bisa_setujui && !k.bisa_batal && <span className="text-[11px] text-[var(--text-muted)] whitespace-nowrap">menunggu persetujuan</span>}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {periksa && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !busy && setPeriksa(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <div>
                <h3 className="font-semibold text-sm text-[var(--text-primary)]">{periksa.setuju ? "Setujui Koreksi Stok" : "Tolak Koreksi Stok"}</h3>
                <p className="text-xs text-[var(--text-secondary)]">
                  {periksa.k.kode} · {periksa.k.nama} · {periksa.k.module === "KLINIK" ? "Klinik" : "Gudang"} {periksa.k.estate}
                </p>
              </div>
              <button onClick={() => setPeriksa(null)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <Perubahan k={periksa.k} />
              <p className="text-xs text-[var(--text-secondary)]">
                Alasan: {periksa.k.alasan} · diajukan {periksa.k.diajukan_nama} ({periksa.k.diajukan_waktu})
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                {periksa.setuju
                  ? "Selisihnya langsung dibukukan sebagai Koreksi Stok dan tercatat di riwayat barang."
                  : "Stok tidak berubah. Alasan penolakan terlihat oleh yang mengajukan."}
              </p>
              <input
                value={catatan}
                onChange={(e) => setCatatan(e.target.value)}
                placeholder={periksa.setuju ? "Catatan (boleh kosong)" : "Alasan penolakan (wajib)"}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
              />
              {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
            </div>
            <div className="flex justify-end gap-2 px-5 pb-4">
              <button onClick={() => setPeriksa(null)} className="text-sm px-3.5 py-2 rounded-md border border-[var(--border)] hover:bg-[#f1f5f9]">
                Batal
              </button>
              <button
                disabled={busy}
                onClick={kirim}
                className={`text-sm px-3.5 py-2 rounded-md text-white disabled:opacity-50 ${periksa.setuju ? "bg-[var(--accent-green)]" : "bg-[var(--accent-red)]"}`}
              >
                {busy ? "Menyimpan..." : periksa.setuju ? "Setujui" : "Tolak"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Shown after an admin sends a Koreksi Stok: it waits for approval, the stock hasn't moved yet.
export function KoreksiDiajukan({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-sm shadow-xl p-5 space-y-3">
        <div className="flex items-center gap-2 text-[var(--accent-amber)]">
          <ClipboardCheck size={20} />
          <h3 className="font-semibold text-sm">Koreksi stok diajukan</h3>
        </div>
        <p className="text-sm text-[var(--text-secondary)]">
          Stok belum berubah. Koreksi ini menunggu persetujuan orang yang punya hak <b>Setujui Koreksi Stok</b> (mis. HR / akunting) atau Super User, lalu
          selisihnya dibukukan. Pengajuannya terlihat di daftar "Koreksi Stok menunggu persetujuan" dan bisa dibatalkan selama belum diperiksa.
        </p>
        <button onClick={onClose} className="w-full py-2 rounded-md text-sm font-medium bg-[var(--accent-blue)] text-white hover:opacity-90">
          Mengerti
        </button>
      </div>
    </div>
  );
}

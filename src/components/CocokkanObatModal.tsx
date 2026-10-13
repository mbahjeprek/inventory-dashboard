import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api, errorText, type KunjunganOptions } from "../lib/api";

type Row = Awaited<ReturnType<typeof api.obatBelumCocok>>["rows"][number];
const tgl = (iso: string) => iso.split("-").reverse().join("/");

// Super User: the terapi names typed at a clinic that match no master obat ("Vit C", a misspelling,
// an obat not in the master). Picking the master obat for one saves it as an alias - every terapi
// with that name (any clinic) gets that obat, and so does a visit typed with it later. The visits
// since the last opname then move stock through Sinkron Stok.
export function CocokkanObatModal({ klinik, onClose, onChanged }: { klinik: string; onClose: () => void; onChanged: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [opname, setOpname] = useState("");
  const [master, setMaster] = useState<KunjunganOptions["obat"]>([]);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [done, setDone] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .obatBelumCocok(klinik)
      .then((r) => {
        setRows(r.rows);
        setOpname(r.opname);
      })
      .catch((e) => setError(errorText(e, "Gagal memuat")));
    api
      .kunjunganOptions(klinik)
      .then((o) => setMaster(o.obat))
      .catch(() => setMaster([]));
  }, [klinik]);

  const byNama = new Map(master.map((o) => [`${o.nama} · ${o.kode}`, o]));
  const save = async (r: Row) => {
    const m = byNama.get(pick[r.key] ?? "");
    if (!m) return setError(`Pilih obat master untuk "${r.nama}" dari daftar`);
    setBusy(r.key);
    setError("");
    try {
      const res = await api.saveObatAlias(r.nama, m.kode);
      setDone((d) => ({ ...d, [r.key]: `→ ${m.nama} · ${res.updated} baris diperbarui` }));
      onChanged();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan"));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-white rounded-lg w-full max-w-3xl shadow-xl max-h-[calc(100vh-1rem)] flex flex-col">
        <div className="flex items-start justify-between gap-3 px-5 py-3 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">Cocokkan Nama Obat - Klinik {klinik}</h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Nama terapi yang diketik manual dan belum cocok dengan master obat. Pilih obatnya, lalu Simpan: semua terapi dengan nama itu ikut diperbarui, dan input berikutnya dengan nama
              yang sama otomatis cocok. Setelah itu jalankan Sinkron Stok supaya kunjungan sejak opname{opname ? ` ${tgl(opname)}` : ""} memotong stok.
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>
        <datalist id="cocok-obat">
          {master.map((o) => (
            <option key={o.kode} value={`${o.nama} · ${o.kode}`} />
          ))}
        </datalist>
        <div className="px-5 py-3 overflow-y-auto flex-1 min-h-0">
          {error && <p className="text-xs text-[var(--accent-red)] mb-2">{error}</p>}
          {rows === null ? (
            <p className="text-sm text-[var(--text-muted)]">Memuat...</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-[var(--accent-green)]">Semua nama terapi di klinik ini sudah cocok dengan master obat.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--text-secondary)]">
                  <th className="py-1.5 pr-2">Nama diketik</th>
                  <th className="py-1.5 pr-2 text-right">Baris</th>
                  <th className="py-1.5 pr-2">Obat master</th>
                  <th className="py-1.5 w-20" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rows.map((r) => (
                  <tr key={r.key} className="align-top">
                    <td className="py-2 pr-2">
                      <div className="font-medium text-[var(--text-primary)]">{r.nama}</div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {r.satuan ?? "-"} · terakhir {tgl(r.terakhir)}
                        {r.sejak_opname > 0 && <span className="text-[var(--accent-amber)]"> · {r.sejak_opname} sejak opname (memotong stok)</span>}
                      </div>
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{r.baris}</td>
                    <td className="py-2 pr-2">
                      {done[r.key] ? (
                        <span className="text-xs text-[var(--accent-green)]">{done[r.key]}</span>
                      ) : (
                        <input
                          list="cocok-obat"
                          value={pick[r.key] ?? ""}
                          onChange={(e) => setPick((p) => ({ ...p, [r.key]: e.target.value }))}
                          placeholder="ketik / pilih obat master"
                          className="w-full text-sm rounded-md border border-[var(--border)] px-2 py-1.5"
                        />
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {!done[r.key] && (
                        <button
                          onClick={() => save(r)}
                          disabled={busy === r.key || !byNama.has(pick[r.key] ?? "")}
                          className="text-xs px-3 py-1.5 rounded-md bg-[var(--accent-blue)] text-white disabled:opacity-40"
                        >
                          {busy === r.key ? "..." : "Simpan"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

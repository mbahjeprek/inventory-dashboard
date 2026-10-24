import { useEffect, useState } from "react";
import { Signature } from "lucide-react";
import { api, errorText, type PermintaanMenunggu } from "../lib/api";
import { Detail } from "../components/KlinikPermintaanTab";
import { TTD_LEVEL_LABEL, TTD_URUT, estateLabel, waktuTtd } from "../lib/permintaanSurat";

// Persetujuan: the Permintaan Obat waiting for this account's signature - of its kliniks, sent, and the next
// box one it has the tick for (and hasn't signed another box of). Opening one shows the request with its
// Tanda Tangan panel (Setujui / Tolak); back here the list is read again.
const tgl = (iso: string) => iso.split("-").reverse().join("/");

export function PersetujuanPage() {
  const [rows, setRows] = useState<PermintaanMenunggu[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const load = () =>
    api
      .permintaanMenunggu()
      .then((r) => (setRows(r.rows), setError("")))
      .catch((e) => (setRows([]), setError(errorText(e, "Gagal memuat"))));
  useEffect(() => {
    if (open === null) load();
  }, [open]);

  if (open !== null) return <Detail id={open} onBack={() => setOpen(null)} />;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Persetujuan</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Permintaan Obat yang menunggu tanda tangan Anda. Urutannya Dibuat oleh, Diketahui, Disetujui 1, lalu Disetujui 2; kotak berikutnya terbuka setelah kotak sebelumnya
          ditandatangani.
        </p>
      </div>
      {error && <p className="text-sm text-[var(--accent-red)]">{error}</p>}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#f8fafc] text-xs text-[var(--text-secondary)]">
            <tr className="text-left">
              <th className="px-3 py-2">Nomor</th>
              <th className="px-3 py-2">Klinik</th>
              <th className="px-3 py-2">Tanggal</th>
              <th className="px-3 py-2 text-right">Item</th>
              <th className="px-3 py-2">Sudah ditandatangani</th>
              <th className="px-3 py-2">Giliran Anda</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-[var(--text-muted)]">
                  Memuat...
                </td>
              </tr>
            ) : !rows.length ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-[var(--text-muted)]">
                  Tidak ada permintaan yang menunggu tanda tangan Anda.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-[var(--border)] hover:bg-[#f8fafc] align-top">
                  <td className="px-3 py-2 font-medium">
                    <button onClick={() => setOpen(r.id)} className="text-[var(--accent-blue)] hover:underline text-left">
                      {r.nomor}
                    </button>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      dibuat {r.created_by}
                      {r.diajukan_at && ` · diajukan ${waktuTtd(r.diajukan_at)}`}
                    </p>
                  </td>
                  <td className="px-3 py-2">Klinik {estateLabel(r.klinik)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{tgl(r.tanggal)}</td>
                  <td className="px-3 py-2 text-right">
                    {r.items}
                    {r.high > 0 && <span className="ml-1 text-[11px] text-[var(--accent-red)]">({r.high} high)</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">
                    {TTD_URUT.filter((k) => r.approval?.[k])
                      .map((k) => `${TTD_LEVEL_LABEL[k]}: ${r.approval[k]!.nama}`)
                      .join(" · ") || "-"}
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-xs px-2 py-0.5 rounded-full border border-[var(--accent-amber-border)] text-[var(--accent-amber)] bg-[var(--accent-amber-bg)] whitespace-nowrap">
                      {TTD_LEVEL_LABEL[r.berikut]}
                      {r.ttd?.[r.berikut]?.jabatan && ` · ${r.ttd[r.berikut].jabatan}`}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => setOpen(r.id)}
                      className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-[var(--accent-blue)] text-white hover:opacity-90"
                    >
                      <Signature size={15} /> Periksa & tandatangani
                    </button>
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

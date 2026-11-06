import { useEffect, useState } from "react";
import { PenLine, Printer } from "lucide-react";
import { api, errorText, type BaPeran, type BeritaAcara } from "../lib/api";
import { usePersetujuan } from "../hooks/usePersetujuan";
import { cetakBa, jenisKlinik, jenisKoperasi } from "./BaPemusnahan";

// On Persetujuan: the Berita Acara Pemusnahan that name this account as pelaksana / saksi and wait for its signature
// (before they go to the Estate Manager). Signed with the account; Lihat BA prints it to check the barang first.
const PERAN_LABEL: Record<string, string> = { pelaksana: "Pelaksana", saksi1: "Saksi 1", saksi2: "Saksi 2" };
const tgl = (iso: string) => iso.split("-").reverse().join("/");

export function BaTtdSaya() {
  const [rows, setRows] = useState<{ ba: BeritaAcara; peran: BaPeran[] }[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const refreshJumlah = usePersetujuan((s) => s.refresh);
  const load = () =>
    api
      .baTtdSaya()
      .then((r) => setRows(r.data))
      .catch((e) => (setRows([]), setError(errorText(e, "Gagal memuat berita acara"))));
  useEffect(() => {
    load();
  }, []);

  const jenis = (ba: BeritaAcara) => (ba.modul === "KLINIK" ? jenisKlinik(ba.unit) : jenisKoperasi());
  const tandaTangan = async (ba: BeritaAcara, peran: BaPeran) => {
    setBusy(`${ba.id}:${peran}`);
    setError("");
    try {
      await api.baTtd(ba.id, { peran, cara: "AKUN" });
      await load();
      refreshJumlah();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan tanda tangan"));
    } finally {
      setBusy("");
    }
  };

  if (!rows || !rows.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-[var(--text-primary)]">
        Tanda tangan Berita Acara Pemusnahan <span className="ml-1 text-xs font-normal text-[var(--accent-amber)]">{rows.length} menunggu</span>
      </h2>
      <p className="text-xs text-[var(--text-muted)]">
        Anda ditunjuk sebagai pelaksana / saksi. Periksa barangnya (Lihat BA) lalu tanda tangan dengan akun Anda; BA baru diajukan ke Estate Manager setelah
        pelaksana dan kedua saksi tanda tangan.
      </p>
      {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#f8fafc] text-xs text-[var(--text-secondary)]">
            <tr className="text-left">
              <th className="px-3 py-2">Nomor</th>
              <th className="px-3 py-2">Rencana tgl</th>
              <th className="px-3 py-2 text-right">Barang</th>
              <th className="px-3 py-2">Dibuat</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ ba, peran }) => (
              <tr key={ba.id} className="border-t border-[var(--border)] align-top">
                <td className="px-3 py-2 font-medium whitespace-nowrap">
                  {ba.nomor}
                  <div className="text-[11px] font-normal text-[var(--text-muted)]">{ba.modul === "KLINIK" ? `Klinik ${ba.unit}` : "Koperasi"}</div>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{tgl(ba.tanggal)}</td>
                <td className="px-3 py-2 text-right">{ba.items.length}</td>
                <td className="px-3 py-2 text-[var(--text-secondary)]">{ba.dibuat_nama || "-"}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <button
                      onClick={() => cetakBa(jenis(ba), ba)}
                      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-[var(--border)] hover:bg-[#f1f5f9]"
                    >
                      <Printer size={13} /> Lihat BA
                    </button>
                    {peran.map((k) => (
                      <button
                        key={k}
                        disabled={!!busy}
                        onClick={() => tandaTangan(ba, k)}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50"
                      >
                        <PenLine size={13} /> {busy === `${ba.id}:${k}` ? "Menyimpan..." : `Tanda tangan sebagai ${PERAN_LABEL[k]}`}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

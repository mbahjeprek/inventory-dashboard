import { useEffect, useState } from "react";
import { Signature } from "lucide-react";
import { api, errorText, type BeritaAcara, type PermintaanMenunggu } from "../lib/api";
import { Detail } from "../components/KlinikPermintaanTab";
import { BaPeriksaModal, jenisKlinik, jenisKoperasi } from "../components/BaPemusnahan";
import { useAuth } from "../context/AuthContext";
import { can, TTD_PERMS } from "../lib/access";
import { TTD_LEVEL_LABEL, TTD_URUT, estateLabel, waktuTtd } from "../lib/permintaanSurat";

// Persetujuan: what waits for this account's signature - the Permintaan Obat of its kliniks whose next box it has
// the tick for (and hasn't signed another box of), opened with their Tanda Tangan panel; and the Berita Acara
// Pemusnahan of its kliniks / koperasi to approve (Setujui Berita Acara), opened as they print with Setujui / Tolak.
const tgl = (iso: string) => iso.split("-").reverse().join("/");

export function PersetujuanPage() {
  const [rows, setRows] = useState<PermintaanMenunggu[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const { user } = useAuth();
  const bolehPermintaan = TTD_PERMS.some((p) => can(user, p));
  const bolehBa = can(user, "ba.setujui");
  const [bas, setBas] = useState<BeritaAcara[] | null>(null);
  const [periksa, setPeriksa] = useState<BeritaAcara | null>(null);
  const load = () => {
    if (bolehPermintaan)
      api
        .permintaanMenunggu()
        .then((r) => (setRows(r.rows), setError("")))
        .catch((e) => (setRows([]), setError(errorText(e, "Gagal memuat"))));
    if (bolehBa)
      api
        .baMenunggu()
        .then((r) => setBas(r.data))
        .catch((e) => (setBas([]), setError(errorText(e, "Gagal memuat berita acara"))));
  };
  useEffect(() => {
    if (open === null) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (open !== null) return <Detail id={open} onBack={() => setOpen(null)} />;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Persetujuan</h1>
        <p className="text-sm text-[var(--text-secondary)]">Dokumen yang menunggu tanda tangan / persetujuan Anda.</p>
      </div>
      {error && <p className="text-sm text-[var(--accent-red)]">{error}</p>}
      {bolehBa && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            Berita Acara Pemusnahan{" "}
            {bas && bas.length > 0 && <span className="ml-1 text-xs font-normal text-[var(--accent-amber)]">{bas.length} menunggu</span>}
          </h2>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#f8fafc] text-xs text-[var(--text-secondary)]">
                <tr className="text-left">
                  <th className="px-3 py-2">Nomor</th>
                  <th className="px-3 py-2">Unit</th>
                  <th className="px-3 py-2">Rencana tgl</th>
                  <th className="px-3 py-2 text-right">Barang</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {bas === null ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-[var(--text-muted)]">
                      Memuat...
                    </td>
                  </tr>
                ) : !bas.length ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-[var(--text-muted)]">
                      Tidak ada berita acara yang menunggu persetujuan Anda.
                    </td>
                  </tr>
                ) : (
                  bas.map((b) => (
                    <tr key={b.id} className="border-t border-[var(--border)] hover:bg-[#f8fafc] align-top">
                      <td className="px-3 py-2 font-medium">
                        <button onClick={() => setPeriksa(b)} className="text-[var(--accent-blue)] hover:underline text-left">
                          {b.nomor}
                        </button>
                        <p className="text-[11px] text-[var(--text-muted)]">
                          dibuat {b.dibuat_nama || "-"} · {waktuTtd(b.created_at)}
                        </p>
                      </td>
                      <td className="px-3 py-2">{b.modul === "KLINIK" ? `Klinik ${estateLabel(b.unit)}` : "Koperasi"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{tgl(b.tanggal)}</td>
                      <td className="px-3 py-2 text-right">{b.items.length}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => setPeriksa(b)}
                          className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-[var(--accent-blue)] text-white hover:opacity-90"
                        >
                          <Signature size={15} /> Periksa & setujui
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {periksa && (
        <BaPeriksaModal
          jenis={periksa.modul === "KLINIK" ? jenisKlinik(periksa.unit) : jenisKoperasi()}
          ba={periksa}
          onClose={() => setPeriksa(null)}
          onDone={() => (setPeriksa(null), load())}
        />
      )}
      {bolehPermintaan && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            Permintaan Obat <span className="ml-1 text-xs font-normal text-[var(--text-muted)]">4 tanda tangan, urutan bebas</span>
          </h2>
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
                          {r.bisa.map((k) => TTD_LEVEL_LABEL[k]).join(" / ")}
                          {r.bisa.length === 1 && r.ttd?.[r.bisa[0]]?.jabatan && ` · ${r.ttd[r.bisa[0]].jabatan}`}
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
        </section>
      )}
    </div>
  );
}

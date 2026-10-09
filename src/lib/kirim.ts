import { api, type OpnameModule } from "./api";
import type { Cells, GridCol } from "../components/BatchGrid";

// Nilam supplies the other estates: its Stock Out (BBM, pupuk, oli, klinik - like Gudang's Tujuan)
// names where the goods go. Another estate = a Transfer, so that estate's Stock In is booked at once
// and it doesn't type one itself.
export const PEMASOK = "NILAM";
export const ESTATE_TUJUAN = ["NILAM", "KNS", "WJA", "ZAMRUD", "FIRUS"];

// Books a Stock Out with a Tujuan as a Transfer (the sender's Stock Out and the receiver's Stock In).
export const kirimKe = (p: { module: OpnameModule; dari: string; ke: string; kode: string; qty: number; note: string; tanggal_iso: string; evidence_id: string | null }) =>
  api.createPinjaman({
    jenis: "TRANSFER",
    module: p.module,
    dari: p.dari,
    ke: p.ke,
    kode: p.kode,
    qty: p.qty,
    alasan: p.note.trim() || `Kirim ke ${p.ke}`,
    tanggal_iso: p.tanggal_iso,
    evidence_id: p.evidence_id ?? "",
  });

// Input Banyak from Nilam: the Tujuan column of a Stock Out row ("" = used at Nilam).
export function tujuanColumn(dari: string, keluar: (c: Cells) => boolean): GridCol {
  return {
    key: "ke",
    label: "Tujuan",
    width: 140,
    type: "select",
    options: [{ value: "", label: `Dipakai ${dari[0]}${dari.slice(1).toLowerCase()}` }, ...ESTATE_TUJUAN.filter((e) => e !== dari).map((e) => ({ value: e, label: `Kirim ${e}` }))],
    off: (c) => !keluar(c) && "-",
    hint: (c) => (keluar(c) && c.ke ? `Stock In ${c.ke} otomatis` : undefined),
    tone: (c) => (keluar(c) && c.ke ? "text-[var(--accent-blue)]" : ""),
  };
}

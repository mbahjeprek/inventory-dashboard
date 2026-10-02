import type { OpnameModule, OpnameStatus } from "./api";
import type { Module } from "./access";

// Stok Opname labels shared by the list and detail pages (see server/src/app.ts "Stok Opname").
export const OPNAME_MODULES: OpnameModule[] = ["GUDANG", "KLINIK", "BBM", "PUPUK", "OLI"];
export const OPNAME_MODULE_LABEL: Record<OpnameModule, string> = { GUDANG: "Gudang", KLINIK: "Klinik", BBM: "BBM", PUPUK: "Pupuk NPK", OLI: "Oli" };
export const opnameModule = (m: OpnameModule) => m as Module;

export const OPNAME_STATUS: Record<OpnameStatus, { label: string; cls: string }> = {
  DRAFT: { label: "Sedang Dihitung", cls: "bg-[var(--accent-amber-bg)] border-[var(--accent-amber-border)] text-[var(--accent-amber)]" },
  SUBMITTED: { label: "Menunggu Approval", cls: "bg-[var(--accent-blue-bg)] border-[var(--accent-blue-border)] text-[var(--accent-blue)]" },
  APPROVED: { label: "Disetujui", cls: "bg-[var(--accent-green-bg)] border-[var(--accent-green-border)] text-[var(--accent-green)]" },
  BATAL: { label: "Dibatalkan", cls: "bg-[#f1f5f9] border-[var(--border)] text-[var(--text-secondary)]" },
};

// Nilam items, klinik and BBM are counted in whole numbers; other gudang and pupuk take decimals.
export const opnameWhole = (module: OpnameModule, estate: string) => module === "KLINIK" || module === "BBM" || (module === "GUDANG" && estate === "NILAM");

export const fmtQty = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 3 });
export const round3 = (n: number) => Math.round(n * 1000) / 1000;
export const isoDisplay = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");
export const expLabel = (exp: string) => (exp ? isoDisplay(exp) : "Tanpa expired");
export const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";
export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// A history row booked by the Pinjaman page: a loan or a transfer, told apart by the note it was
// booked with ("Transfer ke / dari X (Transfer #N): ...").
export const loanTag = (id: number, note?: string | null) => `${/\(Transfer #\d+\)|^Hapus Transfer/.test(note ?? "") ? "Transfer" : "Pinjaman"} #${id}`;

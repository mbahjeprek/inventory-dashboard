import { FileSpreadsheet, FileText, FolderOpen, Link as LinkIcon, Presentation, FileType2, type LucideIcon } from "lucide-react";
import type { DokKategori } from "./api";

// What a link points at, told from its address: the icon and colour of its card.
export type DokJenis = { label: string; icon: LucideIcon; color: string; bg: string };
const J = (label: string, icon: LucideIcon, color: string, bg: string): DokJenis => ({ label, icon, color, bg });
export function jenisOf(url: string): DokJenis {
  const u = url.toLowerCase();
  if (u.includes("docs.google.com/spreadsheets") || /\.(xlsx?|csv)(\?|$)/.test(u)) return J("Sheets", FileSpreadsheet, "#15803d", "#e7f7ed");
  if (u.includes("docs.google.com/document") || /\.docx?(\?|$)/.test(u)) return J("Docs", FileText, "#1d4ed8", "#e8f0fe");
  if (u.includes("docs.google.com/presentation") || /\.pptx?(\?|$)/.test(u)) return J("Slides", Presentation, "#b45309", "#fef3c7");
  if (u.includes("drive.google.com/drive/folders")) return J("Folder Drive", FolderOpen, "#475569", "#f1f5f9");
  if (/\.pdf(\?|$)/.test(u)) return J("PDF", FileType2, "#b91c1c", "#fdeaea");
  if (u.includes("drive.google.com")) return J("Drive", FolderOpen, "#475569", "#f1f5f9");
  return J("Link", LinkIcon, "#6d28d9", "#f3e8ff");
}

export const DOK_KATEGORI: { value: DokKategori; label: string }[] = [
  { value: "LAPORAN", label: "Laporan" },
  { value: "REKAP", label: "Rekap" },
  { value: "SOP", label: "SOP" },
  { value: "FORM", label: "Form" },
  { value: "KONTRAK", label: "Kontrak" },
  { value: "LAINNYA", label: "Lainnya" },
];
export const DOK_MODUL: { value: string; label: string }[] = [
  { value: "", label: "Umum" },
  { value: "GUDANG", label: "Gudang" },
  { value: "BBM", label: "BBM" },
  { value: "PUPUK", label: "Pupuk" },
  { value: "OLI", label: "Oli" },
  { value: "KLINIK", label: "Klinik" },
  { value: "KOPERASI", label: "Koperasi" },
];
export const kategoriLabel = (k: string) => DOK_KATEGORI.find((x) => x.value === k)?.label ?? k;
export const modulLabel = (m: string) => DOK_MODUL.find((x) => x.value === m)?.label ?? m;

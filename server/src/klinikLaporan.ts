// Laporan Harian Klinik: reads a clinic's "Daily Report" Google Sheet (one row per patient visit, up
// to 8 obat per row) into klinik_kunjungan / klinik_kunjungan_obat. Pure parsing here; the routes in
// app.ts fetch the sheet and store the result.
import { parse } from "csv-parse/sync";

export type KunjunganObat = { obat_kode: string; nama_obat: string; qty: number | null; satuan: string };
export type Kunjungan = {
  no: number;
  tanggal_iso: string;
  jenis_kunjungan: string;
  nik: string;
  nama_pasien: string;
  jenis_kelamin: string;
  tanggal_lahir_iso: string | null;
  usia: number | null;
  status_pasien: string;
  penanggung: string;
  jabatan: string;
  divisi: string;
  tempat_tinggal: string;
  asal_pasien: string;
  diagnosis: string;
  kecelakaan_kerja: boolean;
  istirahat: boolean;
  hari_istirahat: number;
  rujukan: boolean;
  provider: string;
  detail_kejadian: string;
  obat: KunjunganObat[];
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, agt: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12,
};
const clean = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
const yes = (v: string | undefined) => /^y/i.test(clean(v));

// "01 Jan 26" / "1 Januari 2026" -> [y, m, d]; two-digit years read as 20yy (or 19yy when that would
// be in the future, for birth dates).
function dmy(raw: string, futureOk: boolean): [number, number, number] | null {
  const m = clean(raw).match(/^(\d{1,2})[ -/]([A-Za-z]+)[ -/](\d{2}|\d{4})$/);
  if (!m) return null;
  const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
  if (!mo) return null;
  let y = Number(m[3]);
  if (y < 100) {
    const now = new Date().getFullYear() % 100;
    y += !futureOk && y > now ? 1900 : 2000;
  }
  return [y, mo, Number(m[1])];
}
const isoOf = ([y, m, d]: [number, number, number]) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// "DIvisi A" / "Dividi C" / "divisi b" / "B" -> "Divisi A" / "Divisi B"; "Umu" -> "Umum".
function divisiOf(v: string) {
  const s = clean(v);
  const d = s.match(/^(?:d[a-z]*\s*)?([abc])$/i);
  if (d) return `Divisi ${d[1].toUpperCase()}`;
  if (/^umu/i.test(s)) return "Umum";
  return s;
}

export function parseDailyReport(csv: string): { rows: Kunjungan[]; skipped: number; tahun: number | null } {
  const grid: string[][] = parse(csv, { relax_column_count: true });
  const headerAt = grid.findIndex((r) => clean(r[0]).toLowerCase() === "no" && r.some((c) => clean(c).toLowerCase() === "tanggal"));
  if (headerAt < 0) throw new Error("Header tabel (No, Periode, Tanggal, ...) tidak ditemukan di sheet");
  const header = grid[headerAt].map((h) => clean(h).toLowerCase());
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const c = {
    tanggal: col(/^tanggal$/),
    jenis: col(/^jenis kunjungan/),
    nik: col(/^nik$/),
    nama: col(/^nama pasien/),
    jk: col(/^jenis kelamin/),
    lahir: col(/^tanggal lahir/),
    usia: col(/^usia/),
    status: col(/^status pasien/),
    penanggung: col(/menanggung/),
    jabatan: col(/^jabatan/),
    divisi: col(/^divisi/),
    tinggal: col(/^tempat tinggal/),
    asal: col(/^asal pasien/),
    diagnosis: col(/^diagnosis/),
    kk: col(/^kecelakaan kerja/),
    istirahat: col(/^istirahat$/),
    hari: col(/hari istirahat/),
    rujukan: col(/^rujukan/),
    provider: col(/^provider/),
    detail: col(/^detail kejadian/),
  };
  if (c.tanggal < 0 || c.nama < 0) throw new Error("Kolom Tanggal / Nama Pasien tidak ditemukan");
  // Obat groups: "Terapi N, Qty N, Satuan", with a "Kode Obat" column before it in some sheets (Nilam).
  const obatCols = header.flatMap((h, i) => (/^terapi \d+$/.test(h) ? [{ kode: header[i - 1] === "kode obat" ? i - 1 : -1, nama: i }] : []));
  // "Tahun : 2026" / "Januari Tahun 2026" in the title rows fixes a mistyped year on a row ("02 Jan 25"
  // in a 2026 report).
  const tahunCell = grid.slice(0, headerAt).flat().map(clean).find((v) => /tahun\s*:?\s*\d{4}/i.test(v));
  const tahun = tahunCell ? Number(tahunCell.match(/(\d{4})/)![1]) : null;
  const get = (r: string[], i: number) => (i < 0 ? "" : clean(r[i]));

  const rows: Kunjungan[] = [];
  let skipped = 0;
  for (const r of grid.slice(headerAt + 1)) {
    if (!/^\d+$/.test(clean(r[0])) && !get(r, c.nama)) continue;
    const t = dmy(get(r, c.tanggal), true);
    if (!t || !get(r, c.nama)) {
      if (get(r, c.nama) || get(r, c.tanggal)) skipped++;
      continue;
    }
    if (tahun && t[0] !== tahun) t[0] = tahun;
    const lahir = dmy(get(r, c.lahir), false);
    const usia = parseInt(get(r, c.usia));
    const obat: KunjunganObat[] = [];
    for (const g of obatCols) {
      const kode = g.kode < 0 ? "" : clean(r[g.kode]).toUpperCase(), nama = clean(r[g.nama]), qtyRaw = clean(r[g.nama + 1]), satuan = clean(r[g.nama + 2]).toUpperCase();
      if (!kode && !nama && !qtyRaw) continue;
      const q = parseFloat(qtyRaw.replace(",", "."));
      obat.push({ obat_kode: kode, nama_obat: nama, qty: Number.isFinite(q) ? q : null, satuan });
    }
    rows.push({
      no: Number(clean(r[0])) || rows.length + 1,
      tanggal_iso: isoOf(t),
      jenis_kunjungan: get(r, c.jenis),
      nik: get(r, c.nik),
      nama_pasien: get(r, c.nama),
      jenis_kelamin: get(r, c.jk).toUpperCase().slice(0, 1),
      tanggal_lahir_iso: lahir ? isoOf(lahir) : null,
      usia: Number.isFinite(usia) ? usia : null,
      status_pasien: get(r, c.status),
      penanggung: get(r, c.penanggung),
      jabatan: get(r, c.jabatan),
      divisi: divisiOf(get(r, c.divisi)),
      tempat_tinggal: get(r, c.tinggal),
      asal_pasien: get(r, c.asal),
      diagnosis: get(r, c.diagnosis),
      kecelakaan_kerja: yes(r[c.kk]),
      istirahat: yes(r[c.istirahat]),
      hari_istirahat: parseInt(get(r, c.hari)) || (yes(r[c.istirahat]) ? 1 : 0),
      rujukan: yes(r[c.rujukan]),
      provider: canonProvider(get(r, c.provider)),
      detail_kejadian: get(r, c.detail),
      obat,
    });
  }
  return { rows, skipped, tahun };
}

// A sheet link (…/spreadsheets/d/<id>/edit?gid=<gid>) -> its CSV export URL.
export function sheetCsvUrl(url: string): string | null {
  const id = url.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1];
  if (!id) return null;
  const gid = url.match(/[#&?]gid=(\d+)/)?.[1] ?? "0";
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

// One cell can hold several diagnoses ("Febris, Influenza, Bronchitis", "Vartigo/ANC"): each counts
// once per visit, under its standard name (canonDiagnosis). A "/" between digits is part of a date.
export const splitDiagnosis = (s: string) => [
  ...new Set(
    s
      .split(/\s*(?:[,;+]|(?<!\d)\/|\/(?!\d))\s*/)
      .map(canonDiagnosis)
      .filter((x): x is string => !!x)
  ),
];

// The same place typed differently ("Tidung Pala", "Tideng Pale", "Tipal") -> one name.
const PROVIDERS: [RegExp, string][] = [
  [/wisnu/i, "dr. Wisnu"],
  [/sesayap/i, "Puskesmas Sesayap Hilir"],
  [/tid[eu]ng|^tipal$/i, "Puskesmas Tideng Pale"],
  [/a?k?h?mad|b?e?rahim/i, "RSUD Akhmad Berahim"],
  [/malinau/i, "RSUD Malinau"],
];
export function canonProvider(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return "";
  return PROVIDERS.find(([re]) => re.test(t))?.[1] ?? t;
}

// Standard name of one diagnosis: typos and synonyms of the same condition become one ("Vartigo" ->
// Vertigo, "Oil Pamthom" -> Oil Palm Thorn, "Medical Check Up" -> MCU), the day count after a wound
// check ("H - 3") and the body part after a few conditions are dropped, and pregnancy notes (G1P0A0,
// HPHT, UK : 33 minggu) count as Antenatal Care. Fragments that are only numbers are not a diagnosis.
const BY_KEY: Record<string, string> = {
  mcu: "MCU", medicalcheckup: "MCU", checkup: "MCU", calonkaryawan: "MCU",
  oilpamthom: "Oil Palm Thorn", oilpamathom: "Oil Palm Thorn", oilpalnmthorn: "Oil Palm Thorn", oilpalmthorn: "Oil Palm Thorn",
  vartigo: "Vertigo", vertigo: "Vertigo",
  cepalgia: "Cephalgia", cepalgi: "Cephalgia", cepalagia: "Cephalgia", cheaplgia: "Cephalgia", chelagia: "Cephalgia", chepalgia: "Cephalgia", pusing: "Cephalgia",
  lbp: "Low Back Pain", lowbackpain: "Low Back Pain", sakitpinggang: "Low Back Pain",
  herpeszooter: "Herpes Zoster", herpezzooter: "Herpes Zoster", herpeszoster: "Herpes Zoster",
  insectsting: "Insect Sting", inscetsting: "Insect Sting", insictsting: "Insect Sting", waspsting: "Insect Sting", hymenopersting: "Insect Sting", tersengattawon: "Insect Sting",
  faragitis: "Faringitis", faringitis: "Faringitis",
  konstivasi: "Konstipasi", konjuntivitis: "Konjungtivitis",
  variccella: "Varicella", varisella: "Varicella",
  gaut: "Gout", gatritis: "Gastritis", dermatitris: "Dermatitis", dermatits: "Dermatitis", influensa: "Influenza",
  ambien: "Hemoroid", ambiyen: "Hemoroid", hemoroid: "Hemoroid",
  amenrhea: "Amenorhea", dismenorhea: "Dismenore", disminore: "Dismenore", insonia: "Insomnia",
  hiperkolesterol: "Hiperkolesterolemia", hipercholesterol: "Hiperkolesterolemia", hiperkolesterolemia: "Hiperkolesterolemia", kolestrol: "Hiperkolesterolemia",
  ht: "Hipertensi", hipertensi: "Hipertensi", tb: "TBC", tbc: "TBC", susptb: "Susp. TBC", sinkop: "Sinkop", sinkope: "Sinkop",
  anc: "Antenatal Care", antenatalcare: "Antenatal Care", anteanatcare: "Antenatal Care",
  abdominal: "Abdominal Pain", abdominalpain: "Abdominal Pain", rightabdominalpain: "Abdominal Pain",
  upimplant: "Aff Implan", affimplan: "Aff Implan", susphervers: "Susp. Herpes", suspherves: "Susp. Herpes", suspherpes: "Susp. Herpes",
};
const BY_PREFIX: [RegExp, string][] = [
  [/^(g\d+p\d+a\d+|gravida|gestasi|hpht|hpl|uk\b|uk ?:)/i, "Antenatal Care"],
  [/^(gv\b|gv\.|ganti verban)/i, "Ganti Verban (GV)"],
  [/^pos(t)? ?op/i, "Post Op"],
  [/^(up|aff) h(e)?a?cting/i, "Aff Hecting"],
  [/^vulnus lacer/i, "Vulnus Laceratum"],
  [/^vulnus punct/i, "Vulnus Punctum"],
  [/^vulnu[as] e(k?s|ks)c?k?[oe]?r/i, "Vulnus Ekskoriatum"],
  [/^abses\b/i, "Abses"],
  [/^iritasi mata/i, "Iritasi Mata"],
  [/^chest pain/i, "Chest Pain"],
  [/^otitis media/i, "Otitis Media Eksterna"],
  [/^mimisan/i, "Epistaksis (Mimisan)"],
  [/^tersengat tawon/i, "Insect Sting"],
  [/^dermatitis\b/i, "Dermatitis"],
];
export function canonDiagnosis(raw: string): string | null {
  const t = raw.replace(/\s+/g, " ").replace(/\s+H\s*-\s*\d+\s*$/i, "").trim();
  if (!t || /^[\d\s:.\-?]+$/.test(t)) return null;
  const key = labelKey(t);
  if (BY_KEY[key]) return BY_KEY[key];
  for (const [re, name] of BY_PREFIX) if (re.test(t)) return name;
  // Plain words keep their spelling, with the first letter up ("ispa" -> "Ispa", "FEBRIS" -> "Febris").
  return t === t.toUpperCase() && t.length > 4 ? t[0] + t.slice(1).toLowerCase() : t[0].toUpperCase() + t.slice(1);
}

// Grouping key for free-typed labels: "Oil Pamthom" / "Oilpamthom" / "oil pamthom " are one.
export const labelKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

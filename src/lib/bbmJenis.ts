export type JenisBbm = "SOLAR" | "BENSIN" | "BENSIN_CAMPUR" | "EMERGENCY" | "JATAH_GM";

// The fuels: Solar, Bensin (murni) and Bensin Campur (bensin mixed with 2T oil, bought as such at WJA); and two stocks
// KNS keeps apart from them - BBM Emergency and Jatah GM (the GM's transport) - each its own saldo, the fuel named in the
// keterangan. Solar and Bensin are shown everywhere; the others where they belong or have data.
export const JENIS_BBM: JenisBbm[] = ["SOLAR", "BENSIN", "BENSIN_CAMPUR", "EMERGENCY", "JATAH_GM"];
export const JENIS_BBM_LABEL: Record<JenisBbm, string> = { SOLAR: "Solar", BENSIN: "Bensin", BENSIN_CAMPUR: "Bensin Campur", EMERGENCY: "BBM Emergency", JATAH_GM: "Jatah GM" };
export const jenisBbmLabel = (j: string) => JENIS_BBM_LABEL[j as JenisBbm] ?? j;
// Where Bensin Campur is offered before it has any data.
export const LOKASI_BENSIN_CAMPUR = ["WJA"];
// Stocks kept only at one lokasi (the server refuses them elsewhere).
export const LOKASI_KHUSUS: Partial<Record<JenisBbm, string[]>> = { EMERGENCY: ["KNS"], JATAH_GM: ["KNS"] };
export const jenisDiLokasi = (j: string, lokasi: string) => !LOKASI_KHUSUS[j as JenisBbm] || LOKASI_KHUSUS[j as JenisBbm]!.includes(lokasi);
// Shown as a stock card at a lokasi before it has data (Solar / Bensin everywhere, the rest where they belong).
export const jenisTampil = (j: string, lokasi: string) =>
  j === "SOLAR" || j === "BENSIN" || (j === "BENSIN_CAMPUR" ? LOKASI_BENSIN_CAMPUR.includes(lokasi) : !!LOKASI_KHUSUS[j as JenisBbm]?.includes(lokasi));

// Bensin got typed into the Solar ledger because the form opened on SOLAR: a keterangan that names
// another fuel ("BENSIN MASUK DARI ...") is refused until Jenis BBM matches it. "Bensin campur" names
// Bensin Campur, a plain "bensin" Bensin.
const DISEBUT: Partial<Record<JenisBbm, RegExp>> = { SOLAR: /\bsolar\b/i, BENSIN_CAMPUR: /\bbensin\s*campur(an)?\b/i, BENSIN: /\bbensin\b(?!\s*campur)/i };
export function wrongJenis(jenis: JenisBbm, text: string): string {
  // Emergency / Jatah GM name their fuel in the keterangan on purpose.
  const cek = DISEBUT[jenis];
  if (!cek || cek.test(text)) return "";
  const other = JENIS_BBM.find((k) => k !== jenis && DISEBUT[k]?.test(text));
  return other ? `Keterangan menyebut ${JENIS_BBM_LABEL[other]}, tapi Jenis BBM ${JENIS_BBM_LABEL[jenis]}. Ganti Jenis BBM ke ${JENIS_BBM_LABEL[other]}.` : "";
}

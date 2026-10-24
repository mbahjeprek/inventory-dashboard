export type JenisBbm = "SOLAR" | "BENSIN" | "BENSIN_CAMPUR";

// The fuels: Solar, Bensin (murni) and Bensin Campur (bensin mixed with 2T oil, bought as such at WJA). Solar and
// Bensin are shown everywhere; Bensin Campur where it is used.
export const JENIS_BBM: JenisBbm[] = ["SOLAR", "BENSIN", "BENSIN_CAMPUR"];
export const JENIS_BBM_LABEL: Record<JenisBbm, string> = { SOLAR: "Solar", BENSIN: "Bensin", BENSIN_CAMPUR: "Bensin Campur" };
export const jenisBbmLabel = (j: string) => JENIS_BBM_LABEL[j as JenisBbm] ?? j;
// Where Bensin Campur is offered before it has any data.
export const LOKASI_BENSIN_CAMPUR = ["WJA"];

// Bensin got typed into the Solar ledger because the form opened on SOLAR: a keterangan that names
// another fuel ("BENSIN MASUK DARI ...") is refused until Jenis BBM matches it. "Bensin campur" names
// Bensin Campur, a plain "bensin" Bensin.
const DISEBUT: Record<JenisBbm, RegExp> = { SOLAR: /\bsolar\b/i, BENSIN_CAMPUR: /\bbensin\s*campur(an)?\b/i, BENSIN: /\bbensin\b(?!\s*campur)/i };
export function wrongJenis(jenis: JenisBbm, text: string): string {
  if (DISEBUT[jenis].test(text)) return "";
  const other = JENIS_BBM.find((k) => k !== jenis && DISEBUT[k].test(text));
  return other ? `Keterangan menyebut ${JENIS_BBM_LABEL[other]}, tapi Jenis BBM ${JENIS_BBM_LABEL[jenis]}. Ganti Jenis BBM ke ${JENIS_BBM_LABEL[other]}.` : "";
}

export type JenisBbm = "SOLAR" | "BENSIN";

// Bensin got typed into the Solar ledger because the form opened on SOLAR: a keterangan that names
// the other fuel ("BENSIN MASUK DARI ...") is refused until Jenis BBM matches it.
export function wrongJenis(jenis: JenisBbm, text: string): string {
  const other: JenisBbm = jenis === "SOLAR" ? "BENSIN" : "SOLAR";
  return new RegExp("\\b" + other + "\\b", "i").test(text) ? `Keterangan menyebut ${other}, tapi Jenis BBM ${jenis}. Ganti Jenis BBM ke ${other}.` : "";
}

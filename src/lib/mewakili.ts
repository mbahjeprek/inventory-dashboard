// Names compared the way the server's namaKata does: the words of a name without gelar, doubled letters collapsed
// (Sitti = Siti), the same person when any word is shared.
const GELAR = new Set(["amd", "keb", "kep", "skep", "ners", "ns", "s", "st", "se", "sh", "skm", "spd", "dr", "drg", "apt", "ama", "a", "md", "ak", "sos", "si"]);
const kata = (s: string) =>
  new Set(
    String(s ?? "")
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 1 && !GELAR.has(w))
      .map((w) => w.replace(/(.)\1+/g, "$1"))
  );
export const namaSama = (a: string, b: string) => {
  const ka = kata(a);
  return [...kata(b)].some((w) => ka.has(w));
};

// Signed "for" (mewakili): a box of a letter signed by someone else than the person named in it, like a paper letter
// signed "for" the official. The box keeps the official's name and jabatan; the signer is named with the stamp.
// A box signed on the paper letter and uploaded (offline) is the official's own signature.
export const mewakili = (signer: string | null | undefined, namaKotak: string | null | undefined, offline = false) =>
  !offline && !!signer?.trim() && !!namaKotak?.trim() && !namaSama(signer, namaKotak);

// What a signature box shows: `for` = signed for the person named in it (his name stays, the signer is told apart);
// `kosong` = a box of a position nobody holds yet (no name), signed by someone for that jabatan: the signer's name
// with "for <jabatan>".
type Orang = { nama?: string | null; jabatan?: string | null } | null | undefined;
export function kotakTtd(a: (Orang & { offline?: boolean }) | null | undefined, kotak: Orang) {
  const nk = kotak?.nama?.trim() ?? "";
  const jk = kotak?.jabatan?.trim() ?? "";
  if (a && !a.offline && a.nama?.trim() && !nk) return { mode: "kosong" as const, nama: a.nama, jabatan: `for ${jk || a.jabatan || ""}`.trim() };
  if (a && mewakili(a.nama, nk, a.offline)) return { mode: "for" as const, nama: nk, jabatan: jk || a.jabatan || "" };
  return { mode: null, nama: a?.nama || nk, jabatan: a?.jabatan || jk };
}

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

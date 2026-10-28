import { create } from "zustand";
import { api } from "../lib/api";

// How many documents wait for this account's signature / approval (Permintaan Obat, Berita Acara, Permintaan Barang
// Koperasi for HR): the sidebar
// badge on Persetujuan and the reminder after login. Refreshed by MainLayout on every page change.
export type JumlahPersetujuan = { permintaan: number; ba: number; kop?: number; total: number };
export const usePersetujuan = create<{ jumlah: JumlahPersetujuan | null; refresh: () => void }>((set) => ({
  jumlah: null,
  refresh: () => {
    api
      .persetujuanJumlah()
      .then((jumlah) => set({ jumlah }))
      .catch(() => set({ jumlah: null }));
  },
}));

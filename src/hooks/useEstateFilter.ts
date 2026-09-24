import { create } from "zustand";

// A superuser's choice of estates to view (empty = all). The dashboard sets it; the sidebar then
// only lists those estates' inventory pages. Remembered per browser.
const KEY = "dashboard.estates";

function read(): string[] {
  try {
    return (localStorage.getItem(KEY) ?? "").split(",").filter(Boolean);
  } catch {
    return [];
  }
}

export const useEstateFilter = create<{ picked: string[]; setPicked: (codes: string[]) => void }>((set) => ({
  picked: read(),
  setPicked: (codes) => {
    try {
      if (codes.length) localStorage.setItem(KEY, codes.join(","));
      else localStorage.removeItem(KEY);
    } catch {
      // storage unavailable: the choice just isn't remembered
    }
    set({ picked: codes });
  },
}));

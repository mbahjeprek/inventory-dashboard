import { create } from "zustand";
import { useAuth } from "../context/AuthContext";
import { userEstates } from "../lib/access";

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

// The estates a page shows: the account's own, narrowed to the dashboard's pick if any. `param` is
// the pick for list APIs (`estates`, comma separated; '' = no pick) so totals and exports match.
export function useShownEstates(): { estates: string[]; param: string } {
  const { user } = useAuth();
  const picked = useEstateFilter((s) => s.picked);
  const own = userEstates(user);
  const narrowed = picked.filter((e) => own.includes(e));
  return { estates: narrowed.length ? narrowed : own, param: narrowed.join(",") };
}

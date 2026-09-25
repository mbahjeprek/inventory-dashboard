import { create } from "zustand";
import { api, type Pinjaman } from "../lib/api";

// Loans of the account's estates that haven't fully come back yet. They stay a warning (sidebar
// badge, banner on the module page) until returned. Refreshed by MainLayout on every page change.
export const useOpenPinjaman = create<{ loans: Pinjaman[]; refresh: () => void }>((set) => ({
  loans: [],
  refresh: () => {
    api
      .pinjamanList({ status: "OPEN", pageSize: 200 })
      .then((res) => set({ loans: res.data }))
      .catch(() => set({ loans: [] }));
  },
}));

// Days since the loan was made (by the local calendar date).
export const loanDays = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  const start = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(Math.round((today - start) / 86400000), 0);
};
// From this many days on an open loan is shown in red.
export const LOAN_LATE_DAYS = 14;

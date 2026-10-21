// "+ Masuk" / "− Keluar" on a stock row: opens the Transaksi form on that barang / obat, already set to
// Stock In or Stock Out, so a transaction is: search the list, click the row's button, fill the qty.
export function QuickInOut({ onIn, onOut }: { onIn: () => void; onOut: () => void }) {
  const cls = "inline-flex items-center px-2 py-1 rounded-md border text-xs font-semibold whitespace-nowrap";
  return (
    <>
      <button onClick={onIn} title="Stock In barang ini" className={`${cls} border-[var(--accent-green-border)] text-[var(--accent-green)] hover:bg-[var(--accent-green-bg)]`}>
        + Masuk
      </button>
      <button onClick={onOut} title="Stock Out barang ini" className={`${cls} border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]`}>
        − Keluar
      </button>
    </>
  );
}

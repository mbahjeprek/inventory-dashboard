import { AlertTriangle } from "lucide-react";

export function ConfirmDialog({
  title = "Konfirmasi Hapus",
  message,
  confirmLabel = "Ya, Hapus",
  cancelLabel = "Batal",
  onConfirm,
  onCancel,
}: {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-sm shadow-xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-[var(--accent-red-bg)] flex items-center justify-center shrink-0">
            <AlertTriangle size={20} className="text-[var(--accent-red)]" />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">{title}</h3>
            <p className="text-sm text-[var(--text-secondary)] mt-1">{message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onCancel}
            className="px-3.5 py-2 rounded-md text-sm border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-[var(--accent-red)] text-white hover:opacity-90"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

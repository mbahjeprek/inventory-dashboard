import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

// Password field with a show/hide button.
export function PasswordInput({
  value,
  onChange,
  className,
  autoComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  className: string;
  autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        className={`${className} pr-10`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        title={visible ? "Sembunyikan password" : "Lihat password"}
        aria-label={visible ? "Sembunyikan password" : "Lihat password"}
        className="absolute inset-y-0 right-0 px-3 flex items-center text-[var(--text-muted)] hover:text-[var(--text-primary)]"
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

import type { OpnameStatus } from "../lib/api";
import { OPNAME_STATUS } from "../lib/opname";

export function OpnameStatusBadge({ status }: { status: OpnameStatus }) {
  const s = OPNAME_STATUS[status];
  return <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${s.cls}`}>{s.label}</span>;
}

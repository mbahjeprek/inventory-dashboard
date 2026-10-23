import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Check, CheckCheck, ImagePlus, Link2, MessageCircle, Plus, Search, Send, Users, X } from "lucide-react";
import { api, errorText, type ChatMessage, type ChatRoom } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { shrink } from "./EvidenceInput";
import { halamanLabel } from "./OnlinePanel";

// Chat between the app's accounts: a floating button on every page with the unread count, a panel with
// the rooms (DMs, the estate rooms, groups), a conversation (photos, a link to a page of the app, read
// ticks) and a pop-up with a soft sound when a message comes in. Polled: the unread count every 20 s
// while the tab is visible (it also keeps the account "online"), an open conversation every 3 s.

const jam = (iso: string) => new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
const hariLabel = (iso: string) => {
  const d = new Date(iso).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" });
  const today = new Date().toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" });
  const kemarin = new Date(Date.now() - 86400000).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" });
  return d === today ? "Hari ini" : d === kemarin ? "Kemarin" : new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
};
const waktuList = (iso: string | null) => {
  if (!iso) return "";
  return hariLabel(iso) === "Hari ini" ? jam(iso) : hariLabel(iso) === "Kemarin" ? "Kemarin" : new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", timeZone: "Asia/Jakarta" });
};
// A short, soft two-note chime.
function bunyi() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1175].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = "sine";
      const t = ctx.currentTime + i * 0.12;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.3);
    });
    setTimeout(() => ctx.close(), 800);
  } catch {
    /* no audio */
  }
}
const inisial = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

function Avatar({ nama, jenis, online }: { nama: string; jenis?: string; online?: boolean | null }) {
  return (
    <span className="relative flex-none">
      <span
        className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold ${
          jenis === "ESTATE" ? "bg-[var(--accent-green-bg)] text-[var(--accent-green)]" : jenis === "GRUP" ? "bg-[var(--accent-amber-bg)] text-[var(--accent-amber)]" : "bg-[var(--accent-blue-bg)] text-[var(--accent-blue)]"
        }`}
      >
        {jenis === "GRUP" || jenis === "ESTATE" ? <Users size={16} /> : inisial(nama)}
      </span>
      {online && <span className="absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full bg-[var(--accent-green)] border-2 border-white" />}
    </span>
  );
}

type Toast = { id: number; room_id: number; dari: string; isi: string; room_nama: string | null };

export function ChatWidget() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"list" | "room" | "baru" | "grup">("list");
  const [roomId, setRoomId] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const maxRef = useRef(0);
  const viewRef = useRef({ open, view, roomId });
  viewRef.current = { open, view, roomId };

  // Unread count + pop-ups for messages that arrived since the last check.
  const cek = useCallback(async () => {
    try {
      const r = await api.chatUnread(maxRef.current);
      setTotal(r.total);
      const v = viewRef.current;
      const baru = maxRef.current ? r.baru.filter((m) => !(v.open && v.view === "room" && v.roomId === m.room_id)) : [];
      if (baru.length) {
        bunyi();
        setToasts((t) => [...baru.reverse().map((m) => ({ id: m.id, room_id: m.room_id, dari: m.dari, isi: m.foto && !m.isi ? "📷 Foto" : m.isi, room_nama: m.room_nama })), ...t].slice(0, 3));
      }
      maxRef.current = Math.max(maxRef.current, r.max);
    } catch {
      /* offline / logged out */
    }
  }, []);
  useEffect(() => {
    cek();
    const t = setInterval(() => document.visibilityState === "visible" && cek(), 20_000);
    return () => clearInterval(t);
  }, [cek]);
  useEffect(() => {
    if (!toasts.length) return;
    const t = setTimeout(() => setToasts((x) => x.slice(0, -1)), 8000);
    return () => clearTimeout(t);
  }, [toasts]);

  const buka = (id: number) => {
    setRoomId(id);
    setView("room");
    setOpen(true);
    setToasts((t) => t.filter((x) => x.room_id !== id));
  };
  if (!user) return null;

  return (
    <>
      {/* Pop-ups of new messages, above the chat button. */}
      <div className="fixed z-50 right-4 bottom-20 w-[300px] max-w-[calc(100vw-2rem)] space-y-2">
        {toasts.map((t) => (
          <button
            key={t.id}
            onClick={() => buka(t.room_id)}
            className="w-full text-left rounded-lg border border-[var(--accent-blue-border)] bg-[var(--bg-card)] shadow-lg px-3 py-2 hover:bg-[#f8fafc]"
          >
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--accent-blue)]">
              <MessageCircle size={13} /> {t.dari}
              {t.room_nama ? <span className="font-normal text-[var(--text-muted)]">· {t.room_nama}</span> : null}
            </div>
            <div className="text-sm text-[var(--text-primary)] line-clamp-2">{t.isi}</div>
          </button>
        ))}
      </div>

      <button
        onClick={() => (setOpen((o) => !o), setView(roomId ? view : "list"))}
        title="Chat"
        className="fixed z-40 right-4 bottom-4 w-13 h-13 p-3.5 rounded-full shadow-lg bg-[var(--accent-blue)] text-white hover:opacity-90"
      >
        {open ? <X size={22} /> : <MessageCircle size={22} />}
        {!open && total > 0 && (
          <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-[var(--accent-red)] text-[11px] font-semibold flex items-center justify-center border-2 border-white">
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed z-50 right-2 left-2 sm:left-auto sm:right-4 bottom-20 sm:w-[380px] h-[min(560px,calc(100vh-7rem))] rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-2xl flex flex-col overflow-hidden">
          {view === "room" && roomId ? (
            <Percakapan roomId={roomId} onBack={() => (setView("list"), setRoomId(null), cek())} onRead={cek} />
          ) : view === "baru" ? (
            <ChatBaru onBack={() => setView("list")} onPilih={buka} />
          ) : view === "grup" ? (
            <GrupBaru onBack={() => setView("list")} onDibuat={buka} />
          ) : (
            <DaftarRoom onPilih={buka} onBaru={() => setView("baru")} onGrup={user.role === "superuser" ? () => setView("grup") : undefined} onClose={() => setOpen(false)} />
          )}
        </div>
      )}
    </>
  );
}

function Header({ title, sub, onBack, children }: { title: string; sub?: string; onBack?: () => void; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--border)] bg-[var(--accent-blue)] text-white">
      {onBack && (
        <button onClick={onBack} title="Kembali" className="p-1 rounded hover:bg-white/15">
          <ArrowLeft size={18} />
        </button>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">{title}</div>
        {sub && <div className="text-[11px] opacity-85 truncate">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

function DaftarRoom({ onPilih, onBaru, onGrup, onClose }: { onPilih: (id: number) => void; onBaru: () => void; onGrup?: () => void; onClose: () => void }) {
  const [rooms, setRooms] = useState<ChatRoom[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    const load = () =>
      api
        .chatRooms()
        .then(setRooms)
        .catch(() => setRooms([]));
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 10_000);
    return () => clearInterval(t);
  }, []);
  const shown = (rooms ?? []).filter((r) => !q.trim() || r.nama.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <Header title="Chat" sub="Pesan antar pengguna aplikasi">
        {onGrup && (
          <button onClick={onGrup} title="Buat grup" className="p-1.5 rounded hover:bg-white/15">
            <Users size={17} />
          </button>
        )}
        <button onClick={onBaru} title="Chat baru" className="p-1.5 rounded hover:bg-white/15">
          <Plus size={18} />
        </button>
        <button onClick={onClose} title="Tutup" className="p-1.5 rounded hover:bg-white/15">
          <X size={18} />
        </button>
      </Header>
      <div className="p-2 border-b border-[var(--border)]">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari percakapan..." className="w-full text-sm rounded-md border border-[var(--border)] pl-8 pr-3 py-1.5" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
        {rooms === null ? (
          <p className="p-4 text-sm text-[var(--text-muted)]">Memuat...</p>
        ) : !shown.length ? (
          <div className="p-6 text-center text-sm text-[var(--text-muted)]">
            Belum ada percakapan.
            <button onClick={onBaru} className="block mx-auto mt-2 text-[var(--accent-blue)] hover:underline">
              Mulai chat baru
            </button>
          </div>
        ) : (
          shown.map((r) => (
            <button key={r.id} onClick={() => onPilih(r.id)} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-[#f8fafc]">
              <Avatar nama={r.nama} jenis={r.jenis} online={r.lawan_online} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`flex-1 truncate text-sm ${r.unread ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-primary)]"}`}>{r.nama}</span>
                  <span className={`text-[11px] ${r.unread ? "text-[var(--accent-blue)] font-medium" : "text-[var(--text-muted)]"}`}>{waktuList(r.last_at)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate text-xs text-[var(--text-secondary)]">
                    {r.last_id
                      ? `${r.last_saya ? "Anda: " : r.jenis !== "DM" ? `${r.last_nama}: ` : ""}${r.last_isi || (r.last_foto ? "📷 Foto" : "🔗 Tautan")}`
                      : r.jenis === "ESTATE"
                        ? "Grup semua pengguna estate ini"
                        : "Belum ada pesan"}
                  </span>
                  {r.unread > 0 && <span className="min-w-5 h-5 px-1.5 rounded-full bg-[var(--accent-blue)] text-white text-[11px] font-semibold flex items-center justify-center">{r.unread}</span>}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </>
  );
}

function Percakapan({ roomId, onBack, onRead }: { roomId: number; onBack: () => void; onRead: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const [room, setRoom] = useState<ChatRoom | null>(null);
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  const [reads, setReads] = useState<{ user_id: number; last_read_id: number; nama: string }[]>([]);
  const [teks, setTeks] = useState("");
  const [foto, setFoto] = useState<{ id: string; preview: string } | null>(null);
  const [lampirHalaman, setLampirHalaman] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bawah = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastId = useRef(0);
  const halaman = loc.pathname + loc.search;

  useEffect(() => {
    api
      .chatRooms()
      .then((rs) => setRoom(rs.find((r) => r.id === roomId) ?? null))
      .catch(() => {});
  }, [roomId]);
  const tandaiBaca = useCallback(
    (id: number) => {
      if (id && document.visibilityState === "visible") api.chatRead(roomId, id).then(onRead).catch(() => {});
    },
    [roomId, onRead]
  );
  useEffect(() => {
    let stop = false;
    lastId.current = 0;
    setMsgs(null);
    api
      .chatMessages(roomId)
      .then((r) => {
        if (stop) return;
        setMsgs(r.messages);
        setReads(r.reads);
        lastId.current = r.messages.at(-1)?.id ?? 0;
        tandaiBaca(lastId.current);
      })
      .catch(() => setMsgs([]));
    const t = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await api.chatMessages(roomId, lastId.current);
        setReads(r.reads);
        if (r.messages.length) {
          setMsgs((m) => [...(m ?? []), ...r.messages.filter((x) => !(m ?? []).some((y) => y.id === x.id))]);
          lastId.current = r.messages.at(-1)!.id;
          tandaiBaca(lastId.current);
        }
      } catch {
        /* retry next tick */
      }
    }, 3000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [roomId, tandaiBaca]);
  useEffect(() => {
    bawah.current?.scrollIntoView({ block: "end" });
  }, [msgs?.length]);

  const pilihFoto = async (f: File | undefined) => {
    if (!f) return;
    setError("");
    setBusy(true);
    try {
      const data = await shrink(f);
      const { id } = await api.uploadEvidence(data);
      setFoto({ id, preview: data });
    } catch (e) {
      setError(errorText(e, "Foto gagal diupload"));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const kirim = async () => {
    if (!teks.trim() && !foto && !lampirHalaman) return;
    setBusy(true);
    setError("");
    try {
      const r = await api.chatSend(roomId, {
        isi: teks.trim(),
        evidence_id: foto?.id ?? null,
        link_url: lampirHalaman ? halaman : null,
        link_label: lampirHalaman ? halamanLabel(halaman) : null,
      });
      setMsgs((m) => [
        ...(m ?? []),
        { id: r.id, user_id: user!.id, nama: user!.nama, isi: teks.trim(), evidence_id: foto?.id ?? null, link_url: lampirHalaman ? halaman : null, link_label: lampirHalaman ? halamanLabel(halaman) : null, created_at: new Date().toISOString() },
      ]);
      lastId.current = Math.max(lastId.current, r.id);
      setTeks("");
      setFoto(null);
      setLampirHalaman(false);
    } catch (e) {
      setError(errorText(e, "Pesan gagal dikirim"));
    } finally {
      setBusy(false);
    }
  };
  // Read ticks of my messages: a DM shows ✓✓ once the other one read it; a group shows how many read it.
  const dibaca = (id: number) => reads.filter((r) => r.last_read_id >= id);
  const grup = room?.jenis !== "DM";
  let hariSebelum = "";
  return (
    <>
      <Header title={room?.nama ?? "..."} sub={room ? (room.jenis === "DM" ? (room.lawan_online ? "online" : "pesan pribadi") : room.jenis === "ESTATE" ? "semua pengguna estate ini" : `${room.n_member} anggota`) : ""} onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 bg-[#f4f6f9]">
        {msgs === null ? (
          <p className="text-sm text-[var(--text-muted)] p-2">Memuat...</p>
        ) : !msgs.length ? (
          <p className="text-sm text-[var(--text-muted)] text-center p-6">Belum ada pesan. Tulis pesan pertama.</p>
        ) : (
          msgs.map((m, i) => {
            const saya = m.user_id === user?.id;
            const hari = hariLabel(m.created_at);
            const pemisah = hari !== hariSebelum;
            hariSebelum = hari;
            const namaTampil = !saya && grup && (i === 0 || msgs[i - 1].user_id !== m.user_id || pemisah);
            const baca = saya ? dibaca(m.id) : [];
            return (
              <div key={m.id}>
                {pemisah && (
                  <div className="text-center my-2">
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-white text-[var(--text-muted)] border border-[var(--border)]">{hari}</span>
                  </div>
                )}
                <div className={`flex ${saya ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded-lg px-2.5 py-1.5 text-sm shadow-sm ${saya ? "bg-[#d9fdd3] text-[var(--text-primary)]" : "bg-white text-[var(--text-primary)]"}`}>
                    {namaTampil && <div className="text-[11px] font-semibold text-[var(--accent-blue)]">{m.nama}</div>}
                    {m.evidence_id && (
                      <a href={`/api/evidence/${m.evidence_id}`} target="_blank" rel="noreferrer">
                        <img src={`/api/evidence/${m.evidence_id}`} alt="foto" className="rounded-md max-h-48 mb-1 object-cover" />
                      </a>
                    )}
                    {m.link_url && (
                      <button onClick={() => navigate(m.link_url!)} className="flex items-center gap-1 text-xs text-[var(--accent-blue)] underline mb-0.5 text-left">
                        <Link2 size={12} /> {m.link_label || m.link_url}
                      </button>
                    )}
                    {m.isi && <div className="whitespace-pre-wrap break-words">{m.isi}</div>}
                    <div className="flex items-center justify-end gap-1 text-[10px] text-[var(--text-muted)] mt-0.5">
                      {jam(m.created_at)}
                      {saya &&
                        (grup ? (
                          baca.length > 0 && <span title={baca.map((r) => r.nama).join(", ")}>· dibaca {baca.length}</span>
                        ) : baca.length ? (
                          <CheckCheck size={13} className="text-[var(--accent-blue)]" />
                        ) : (
                          <Check size={13} />
                        ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bawah} />
      </div>
      {(foto || lampirHalaman) && (
        <div className="px-3 pt-2 flex flex-wrap items-center gap-2 border-t border-[var(--border)] text-xs">
          {foto && (
            <span className="relative">
              <img src={foto.preview} alt="" className="h-12 rounded" />
              <button onClick={() => setFoto(null)} className="absolute -top-1.5 -right-1.5 bg-white rounded-full border border-[var(--border)] p-0.5" title="Hapus foto">
                <X size={11} />
              </button>
            </span>
          )}
          {lampirHalaman && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] px-2 py-0.5">
              <Link2 size={12} /> {halamanLabel(halaman)}
              <button onClick={() => setLampirHalaman(false)} title="Hapus tautan">
                <X size={11} />
              </button>
            </span>
          )}
        </div>
      )}
      {error && <p className="px-3 pt-1 text-xs text-[var(--accent-red)]">{error}</p>}
      <div className="flex items-end gap-1.5 p-2 border-t border-[var(--border)]">
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pilihFoto(e.target.files?.[0])} />
        <button onClick={() => fileRef.current?.click()} disabled={busy} title="Kirim foto" className="p-2 rounded-md text-[var(--text-secondary)] hover:bg-[#f1f5f9]">
          <ImagePlus size={18} />
        </button>
        <button
          onClick={() => setLampirHalaman((v) => !v)}
          title={`Tautkan halaman ini (${halamanLabel(halaman)})`}
          className={`p-2 rounded-md hover:bg-[#f1f5f9] ${lampirHalaman ? "text-[var(--accent-blue)]" : "text-[var(--text-secondary)]"}`}
        >
          <Link2 size={18} />
        </button>
        <textarea
          value={teks}
          onChange={(e) => setTeks(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              kirim();
            }
          }}
          rows={1}
          placeholder="Tulis pesan... (Enter kirim, Shift+Enter baris baru)"
          className="flex-1 resize-none text-sm rounded-md border border-[var(--border)] px-3 py-2 max-h-28"
        />
        <button onClick={kirim} disabled={busy || (!teks.trim() && !foto && !lampirHalaman)} title="Kirim" className="p-2 rounded-md bg-[var(--accent-blue)] text-white disabled:opacity-40">
          <Send size={17} />
        </button>
      </div>
    </>
  );
}

function ChatBaru({ onBack, onPilih }: { onBack: () => void; onPilih: (id: number) => void }) {
  const [users, setUsers] = useState<Awaited<ReturnType<typeof api.chatUsers>> | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .chatUsers()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, []);
  const mulai = async (id: number) => {
    try {
      onPilih((await api.chatDm(id)).id);
    } catch (e) {
      setError(errorText(e, "Gagal membuka chat"));
    }
  };
  const shown = (users ?? []).filter((u) => !q.trim() || `${u.nama} ${u.username}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <Header title="Chat baru" sub="Pilih pengguna" onBack={onBack} />
      <div className="p-2 border-b border-[var(--border)]">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama / username..." autoFocus className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-1.5" />
      </div>
      {error && <p className="px-3 pt-1 text-xs text-[var(--accent-red)]">{error}</p>}
      <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
        {users === null ? (
          <p className="p-4 text-sm text-[var(--text-muted)]">Memuat...</p>
        ) : (
          shown.map((u) => (
            <button key={u.id} onClick={() => mulai(u.id)} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[#f8fafc]">
              <Avatar nama={u.nama || u.username} online={u.online} />
              <div className="min-w-0">
                <div className="text-sm text-[var(--text-primary)] truncate">{u.nama || u.username}</div>
                <div className="text-[11px] text-[var(--text-muted)] truncate">
                  @{u.username} · {u.role === "superuser" ? "Super User" : (u.estates ?? "").split(",").filter(Boolean).join(", ")}
                  {u.online ? " · online" : ""}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </>
  );
}

function GrupBaru({ onBack, onDibuat }: { onBack: () => void; onDibuat: (id: number) => void }) {
  const [users, setUsers] = useState<Awaited<ReturnType<typeof api.chatUsers>> | null>(null);
  const [nama, setNama] = useState("");
  const [pilih, setPilih] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .chatUsers()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, []);
  const buat = async () => {
    if (!nama.trim()) return setError("Isi nama grup");
    if (!pilih.size) return setError("Pilih anggota");
    try {
      onDibuat((await api.chatGrup(nama.trim(), [...pilih])).id);
    } catch (e) {
      setError(errorText(e, "Gagal membuat grup"));
    }
  };
  return (
    <>
      <Header title="Grup baru" sub={`${pilih.size} anggota dipilih`} onBack={onBack} />
      <div className="p-2 space-y-2 border-b border-[var(--border)]">
        <input value={nama} onChange={(e) => setNama(e.target.value)} placeholder="Nama grup, mis. Tim Klinik" className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-1.5" />
        {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
        {(users ?? []).map((u) => (
          <label key={u.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-[#f8fafc] cursor-pointer">
            <input
              type="checkbox"
              checked={pilih.has(u.id)}
              onChange={() =>
                setPilih((s) => {
                  const n = new Set(s);
                  if (!n.delete(u.id)) n.add(u.id);
                  return n;
                })
              }
            />
            <span className="text-sm text-[var(--text-primary)]">{u.nama || u.username}</span>
            <span className="text-[11px] text-[var(--text-muted)]">@{u.username}</span>
          </label>
        ))}
      </div>
      <div className="p-2 border-t border-[var(--border)]">
        <button onClick={buat} className="w-full py-2 rounded-md bg-[var(--accent-blue)] text-white text-sm font-medium hover:opacity-90">
          Buat grup
        </button>
      </div>
    </>
  );
}

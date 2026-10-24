import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, ExternalLink, FileText, Lock, Pencil, Printer, Star } from "lucide-react";
import { api, errorText, type Sop, type SopIsi } from "../lib/api";
import { printDocument } from "../lib/printTable";
import { SOP_BAGIAN, SOP_ISI_BAGIAN, statusOf } from "../lib/sop";
import { downloadWord, googleLinks, sopDocHtml, sopIsiAda, sopNomor } from "../lib/sopDoc";
import { jenisOf } from "../lib/dokumen";

// Daftar SOP > one SOP: the SOP as a document - written in the app (formal layout with the kop, printed or
// saved for Word) and / or the file behind its link (Google Docs ...) shown in a frame, with Google's own
// download links. With Ubah (and not locked, or with Kunci) the written SOP is typed here.
const inputCls =
  "w-full text-sm rounded-md border border-[var(--border)] px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue-border)]";
const btn =
  "inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] hover:bg-[#f1f5f9] disabled:opacity-50";

export function SopDokumenPage() {
  const { id } = useParams();
  const [sop, setSop] = useState<Sop | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"dok" | "file">("dok");
  const [draft, setDraft] = useState<SopIsi | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  useEffect(() => {
    setSop(null);
    setDraft(null);
    api
      .sopDetail(Number(id))
      .then((r) => {
        setSop(r.data);
        setError("");
        // A file and nothing written here: open on the file.
        setTab(!sopIsiAda(r.data.isi) && googleLinks(r.data.url) ? "file" : "dok");
      })
      .catch((e) => setError(errorText(e, "Gagal memuat SOP")));
  }, [id]);

  if (error)
    return (
      <div className="space-y-3">
        <BackLink />
        <p className="text-sm text-[var(--accent-red)]">{error}</p>
      </div>
    );
  if (!sop) return <p className="text-sm text-[var(--text-muted)]">Memuat...</p>;

  const bagian = SOP_BAGIAN.find((b) => b.value === sop.bagian);
  const st = statusOf(sop.status);
  const links = googleLinks(sop.url);
  const ada = sopIsiAda(sop.isi);
  const bolehTulis = sop.boleh_ubah;
  const isi = draft ?? sop.isi ?? {};

  const simpan = async () => {
    if (!draft) return;
    setSaving(true);
    setSaveErr("");
    try {
      await api.sopIsi(sop.id, draft);
      setSop({
        ...sop,
        isi: Object.fromEntries(
          Object.entries(draft)
            .map(([k, v]) => [k, (v ?? "").trim()])
            .filter(([, v]) => v),
        ),
      });
      setDraft(null);
    } catch (e) {
      setSaveErr(errorText(e, "Gagal menyimpan"));
    } finally {
      setSaving(false);
    }
  };
  const set = (k: keyof SopIsi, v: string) => setDraft((d) => ({ ...(d ?? {}), [k]: v }));

  return (
    <div className="space-y-4">
      <BackLink />

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-start gap-3">
          <span className="px-2 h-8 min-w-8 shrink-0 rounded-md bg-[#1f6f43] text-white text-sm font-semibold flex items-center justify-center">
            {sopNomor(sop)}
          </span>
          <div className="flex-1 min-w-[220px]">
            <p className="text-xs text-[var(--text-muted)]">{bagian ? `${bagian.no}. ${bagian.label}` : sop.bagian}</p>
            <h1 className="text-lg font-semibold text-[var(--text-primary)] flex flex-wrap items-center gap-2">
              {sop.judul}
              {sop.audit && (
                <span
                  title="Hampir selalu diperiksa saat audit ISPO / RSPO"
                  className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-[#fff7e6] text-[#b45309]"
                >
                  <Star size={12} className="fill-[#f59e0b] text-[#f59e0b]" /> Audit ISPO / RSPO
                </span>
              )}
              {sop.dikunci && (
                <span
                  title="Dikunci: tidak bisa diubah kecuali oleh pemegang hak Kunci"
                  className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--accent-amber-bg)] text-[var(--accent-amber)]"
                >
                  <Lock size={12} /> Dikunci
                </span>
              )}
            </h1>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full" style={{ color: st.color, background: st.bg }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: st.color }} />
            {st.label}
          </span>
        </div>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-sm">
          <Meta label="No. Dokumen" value={sop.no_dokumen} mono />
          <Meta label="Revisi" value={sop.revisi} />
          <Meta
            label="Tgl Berlaku"
            value={
              sop.tgl_berlaku ? new Date(`${sop.tgl_berlaku}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : ""
            }
          />
          <Meta label="PIC" value={sop.pic} />
        </dl>
        {sop.keterangan && <p className="text-xs text-[var(--text-secondary)]">Keterangan: {sop.keterangan}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)]">
        <TabBtn on={tab === "dok"} onClick={() => setTab("dok")}>
          <FileText size={15} /> Dokumen SOP {!ada && <span className="text-[10px] text-[var(--text-muted)]">(belum ditulis)</span>}
        </TabBtn>
        <TabBtn on={tab === "file"} onClick={() => setTab("file")}>
          {(() => {
            const Icon = sop.url ? jenisOf(sop.url).icon : ExternalLink;
            return <Icon size={15} />;
          })()}
          File {sop.url ? jenisOf(sop.url).label : "Google"} {!sop.url && <span className="text-[10px] text-[var(--text-muted)]">(belum ada link)</span>}
        </TabBtn>
      </div>

      {tab === "dok" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {draft ? (
              <>
                <button
                  onClick={simpan}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? "Menyimpan..." : "Simpan"}
                </button>
                <button onClick={() => (setDraft(null), setSaveErr(""))} disabled={saving} className={btn}>
                  Batal
                </button>
                {saveErr && <span className="text-xs text-[var(--accent-red)]">{saveErr}</span>}
              </>
            ) : (
              <>
                <button onClick={() => printDocument(sopDocHtml(sop))} className={btn}>
                  <Printer size={16} /> Cetak / PDF
                </button>
                <button onClick={() => downloadWord(sop)} className={btn}>
                  <Download size={16} /> Word (.doc)
                </button>
                {bolehTulis && (
                  <button onClick={() => setDraft({ ...(sop.isi ?? {}) })} className={btn}>
                    <Pencil size={16} /> {ada ? "Ubah isi" : "Tulis isi SOP"}
                  </button>
                )}
                <span className="text-xs text-[var(--text-muted)]">
                  File Word bisa dibuka di Word atau di-upload ke Google Drive lalu dibuka dengan Google Docs.
                </span>
              </>
            )}
          </div>
          {!ada && !draft && (
            <p className="text-sm px-3 py-2 rounded-md bg-[#f8fafc] border border-[var(--border)] text-[var(--text-secondary)]">
              Isi SOP ini belum ditulis di aplikasi; di bawah ini kerangkanya.{" "}
              {sop.url ? (
                <button onClick={() => setTab("file")} className="text-[var(--accent-blue)] hover:underline">
                  Lihat file-nya
                </button>
              ) : (
                "Belum ada link file."
              )}
            </p>
          )}
          <div className={draft ? "grid xl:grid-cols-2 gap-4 items-start" : ""}>
            {draft && (
              <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-4 space-y-4">
                {SOP_ISI_BAGIAN.map((b, i) => (
                  <label key={b.key} className="block space-y-1">
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      {i + 1}. {b.label}
                    </span>
                    <span className="block text-[11px] text-[var(--text-muted)]">{b.hint}</span>
                    <textarea
                      value={isi[b.key] ?? ""}
                      onChange={(e) => set(b.key, e.target.value)}
                      rows={b.key === "prosedur" ? 12 : 4}
                      className={`${inputCls} font-[inherit]`}
                    />
                  </label>
                ))}
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)] mb-2">Pengesahan</p>
                  <div className="grid sm:grid-cols-3 gap-3">
                    {(["disusun", "diperiksa", "disetujui"] as const).map((k) => (
                      <div key={k} className="space-y-1.5">
                        <p className="text-xs text-[var(--text-secondary)] capitalize">{k} oleh</p>
                        <input value={isi[`${k}_nama`] ?? ""} onChange={(e) => set(`${k}_nama`, e.target.value)} placeholder="Nama" className={inputCls} />
                        <input
                          value={isi[`${k}_jabatan`] ?? ""}
                          onChange={(e) => set(`${k}_jabatan`, e.target.value)}
                          placeholder="Jabatan"
                          className={inputCls}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <DocPreview html={sopDocHtml(sop, isi)} />
          </div>
        </div>
      ) : links ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <a href={links.buka} target="_blank" rel="noopener noreferrer" className={btn}>
              <ExternalLink size={16} /> Buka di Google
            </a>
            {links.office && (
              <a href={links.office.url} target="_blank" rel="noopener noreferrer" className={btn}>
                <Download size={16} /> {links.office.label}
              </a>
            )}
            {links.pdf && (
              <a href={links.pdf} target="_blank" rel="noopener noreferrer" className={btn}>
                <Printer size={16} /> PDF untuk cetak
              </a>
            )}
          </div>
          <iframe src={links.preview} title={sop.judul} className="w-full h-[80vh] rounded-lg border border-[var(--border)] bg-white" allow="autoplay" />
          <p className="text-[11px] text-[var(--text-muted)]">
            Kalau file tidak tampil, minta pemilik file membagikannya (tombol Share di Google Drive) ke akun Google Anda, atau buka lewat tombol Buka di Google.
          </p>
        </div>
      ) : sop.url ? (
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-6 text-sm text-[var(--text-secondary)] space-y-3">
          <p>Link ini tidak bisa ditampilkan di sini.</p>
          <a href={sop.url} target="_blank" rel="noopener noreferrer" className={btn}>
            <ExternalLink size={16} /> Buka link
          </a>
        </div>
      ) : (
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-6 text-sm text-[var(--text-secondary)]">
          Belum ada link file untuk SOP ini. Isi kolom Link File di{" "}
          <Link to="/sop" className="text-[var(--accent-blue)] hover:underline">
            Daftar SOP
          </Link>{" "}
          (link Google Docs dari tombol Share), atau tulis isinya di tab Dokumen SOP.
        </div>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/sop" className="inline-flex items-center gap-1.5 text-sm text-[var(--accent-blue)] hover:underline">
      <ArrowLeft size={15} /> Daftar SOP
    </Link>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] text-[var(--text-muted)]">{label}</dt>
      <dd className={`text-[var(--text-primary)] ${mono ? "font-mono text-xs mt-0.5" : ""}`}>{value || "-"}</dd>
    </div>
  );
}

function TabBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-sm -mb-px border-b-2 ${
        on
          ? "border-[var(--accent-blue)] text-[var(--accent-blue)] font-medium"
          : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      }`}
    >
      {children}
    </button>
  );
}

// The document as it prints: an A4-wide white page in a frame, as tall as its content.
function DocPreview({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(1100);
  const fit = () => {
    const b = ref.current?.contentDocument?.body;
    if (b) setH(b.scrollHeight + 80);
  };
  useEffect(() => {
    const t = setTimeout(fit, 120);
    return () => clearTimeout(t);
  }, [html]);
  return (
    <div className="bg-[#e9edf2] rounded-lg p-3 sm:p-6 overflow-x-auto">
      <div className="mx-auto bg-white shadow-md" style={{ width: "min(100%, 210mm)", minWidth: 0 }}>
        <iframe
          ref={ref}
          srcDoc={html.replace("<body>", '<body style="padding:16mm 15mm">')}
          onLoad={fit}
          title="Pratinjau SOP"
          className="w-full block border-0"
          style={{ height: h }}
        />
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  fetchPdfPreviewHtml,
  fetchBookPreviewHtml,
  fetchBookProducts,
  startBookExport,
  fetchBookExport,
  exportPdf,
} from "./api.js";
import { useI18n } from "./i18n.jsx";
import { Toggle } from "./ui/index.js";

// Side panel (full screen on a phone) previewing the printed output for the
// *current, unsaved* draft, re-rendered shortly after every edit:
//   - Photobook: the lay-flat book as it will be exported to Saal Design
//     Software (cover + spreads), with product choice, per-stop layout
//     pickers inside the preview and the .sswprm export
//   - PDF: the paginated PDF export with its layout packs / paper sizes
const VENDORS = [
  ["saal", "Saal Digital"],
  ["cewe", "CEWE"],
];

export default function PdfLivePreview({
  draft,
  pdfLayouts,
  onChange,
  onOverride,
  onBookOverride,
  onBookSpreadCounts,
  onBookToggle,
  onClose,
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState(() => {
    try {
      return localStorage.getItem("story-builder-preview-mode") || "book";
    } catch {
      return "book";
    }
  });
  const [html, setHtml] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [bookProducts, setBookProducts] = useState([]);
  const [bookLayoutPacks, setBookLayoutPacks] = useState([]);
  const [bookFonts, setBookFonts] = useState({ fonts: [], ceweFonts: [], ceweFontFor: {}, defaultFonts: {} });
  const [job, setJob] = useState(null);
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [pdfError, setPdfError] = useState(null);
  const iframeRef = useRef(null);
  const scrollRef = useRef({ book: 0, pdf: 0 });
  const pollRef = useRef(null);

  useEffect(() => {
    fetchBookProducts()
      .then((r) => {
        setBookProducts(r.products);
        setBookLayoutPacks(r.packs || []);
        setBookFonts({
          fonts: r.fonts || [],
          ceweFonts: r.ceweFonts || [],
          ceweFontFor: r.ceweFontFor || {},
          defaultFonts: r.defaultFonts || {},
        });
      })
      .catch(() => {});
    return () => clearTimeout(pollRef.current);
  }, []);

  function switchMode(next) {
    scrollRef.current[mode] = iframeRef.current?.contentWindow?.scrollY || 0;
    setMode(next);
    setHtml(null);
    try {
      localStorage.setItem("story-builder-preview-mode", next);
    } catch {
      /* per-viewer convenience only */
    }
  }

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const next = mode === "book" ? await fetchBookPreviewHtml(draft.id, draft) : await fetchPdfPreviewHtml(draft.id, draft);
        if (cancelled) return;
        if (iframeRef.current?.contentWindow) scrollRef.current[mode] = iframeRef.current.contentWindow.scrollY;
        setHtml(next);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draft, mode]);

  useEffect(() => {
    function onMessage(e) {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.data?.type === "pdf-template-override") onOverride(e.data.stopId, e.data.templateId);
      if (e.data?.type === "book-layout-override") onBookOverride(e.data.stopId, e.data.layoutId);
      if (e.data?.type === "book-spread-counts" && Array.isArray(e.data.counts)) {
        onBookSpreadCounts(e.data.stopId, e.data.counts);
      }
      if (e.data?.type === "book-toggle" && e.data.toggle) onBookToggle(e.data.toggle);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onOverride, onBookOverride, onBookSpreadCounts, onBookToggle]);

  function restoreScroll() {
    iframeRef.current?.contentWindow?.scrollTo(0, scrollRef.current[mode] || 0);
  }

  async function handleExport() {
    clearTimeout(pollRef.current);
    setJob({ status: "running", stage: "planning", done: 0, total: 0 });
    try {
      const { jobId } = await startBookExport(draft.id, draft);
      const poll = async () => {
        try {
          const j = await fetchBookExport(jobId);
          setJob(j);
          if (j.status === "running") pollRef.current = setTimeout(poll, 1000);
        } catch (e) {
          setJob({ status: "error", error: e.message });
        }
      };
      poll();
    } catch (e) {
      setJob({ status: "error", error: e.message });
    }
  }

  // No job queue here (unlike the book export above) - the PDF export is a
  // synchronous headless-Chromium render, fast enough to just await and
  // hand the browser a real file download (a plain <a href> can't POST the
  // draft, so this builds a temporary blob link instead).
  async function handleDownloadPdf() {
    setPdfDownloading(true);
    setPdfError(null);
    try {
      const blob = await exportPdf(draft.id, draft);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(draft.title || "story").replace(/[^\w -]/g, "")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setPdfError(e.message);
    } finally {
      setPdfDownloading(false);
    }
  }

  const isCewe = bookProducts.find((p) => p.id === (draft.bookProduct || "saal-square-28"))?.vendor === "cewe";
  // CEWE books print with CEWE's own (macOS) fonts; a font chosen for the
  // other vendor shows - and is used - as its closest counterpart.
  const effectiveFont = (name) => {
    const list = isCewe ? bookFonts.ceweFonts : bookFonts.fonts;
    if (list.some((f) => f.name === name)) return name;
    if (isCewe) return bookFonts.ceweFontFor[name] || list[0]?.name || "";
    return Object.keys(bookFonts.ceweFontFor).find((k) => bookFonts.ceweFontFor[k] === name) || list[0]?.name || "";
  };
  const progress = job?.total ? Math.round((job.done / job.total) * 100) : 0;

  return (
    <aside className="pdf-live-preview">
      <div className="pdf-live-head">
        <div className="pdf-live-tabs" role="tablist">
          <button className={mode === "book" ? "active" : ""} onClick={() => switchMode("book")} role="tab">
            📖 {t("bookPreviewTab")}
          </button>
          <button className={mode === "pdf" ? "active" : ""} onClick={() => switchMode("pdf")} role="tab">
            📄 PDF
          </button>
        </div>
        {loading && <span className="pdf-live-status">{t("pdfLiveUpdating")}</span>}
        <button className="pdf-live-close" onClick={onClose} aria-label={t("close")}>
          ✕
        </button>
      </div>

      {mode === "book" ? (
        <div className="pdf-live-controls">
          <div className="pdf-live-packs">
            {bookLayoutPacks.map((p) => (
              <button
                key={p.id}
                className={`lang-picker-btn ${(draft.bookLayoutPack || "photobook") === p.id ? "active" : ""}`}
                onClick={() => onChange({ bookLayoutPack: p.id })}
              >
                {p.label}
              </button>
            ))}
          </div>
          <select
            value={draft.bookProduct || "saal-square-28"}
            onChange={(e) => onChange({ bookProduct: e.target.value })}
            aria-label={t("bookProductLabel")}
          >
            {VENDORS.map(([vendor, name]) => (
              <optgroup key={vendor} label={name}>
                {bookProducts
                  .filter((p) => p.vendor === vendor)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          {[
            ["bookTitleFont", "title", t("bookTitleFontLabel")],
            ["bookBodyFont", "body", t("bookBodyFontLabel")],
          ].map(([field, role, label]) => (
            <label key={field} className="pdf-live-font">
              <span>{label}</span>
              <select
                value={effectiveFont(draft[field] || bookFonts.defaultFonts[role] || "")}
                onChange={(e) => onChange({ [field]: e.target.value })}
              >
                {(isCewe ? bookFonts.ceweFonts : bookFonts.fonts).map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name}
                    {f.kind === "script" && role === "body" ? " ✍" : ""}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {[
            ["bookTitleScale", t("bookTitleSizeLabel")],
            ["bookBodyScale", t("bookBodySizeLabel")],
          ].map(([field, label]) => (
            <label key={field} className="pdf-live-font">
              <span>{label}</span>
              <select value={String(draft[field] ?? 1)} onChange={(e) => onChange({ [field]: Number(e.target.value) })}>
                {[0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6].map((v) => (
                  <option key={v} value={String(v)}>
                    {Math.round(v * 100)} %
                  </option>
                ))}
              </select>
            </label>
          ))}
          <Toggle
            checked={!!draft.bookKeepBursts}
            onChange={(checked) => onChange({ bookKeepBursts: checked })}
            label={t("bookKeepBursts")}
            hint={t("bookKeepBurstsHint")}
          />
          <button
            className="pdf-live-export"
            onClick={handleExport}
            disabled={job?.status === "running"}
            title={t(isCewe ? "ceweExportHint" : "bookExportHint")}
          >
            {job?.status === "running" ? t("bookExporting") : `⬇ ${t(isCewe ? "ceweExport" : "bookExport")}`}
          </button>
        </div>
      ) : (
        <div className="pdf-live-controls">
          <div className="pdf-live-packs">
            {pdfLayouts.packs.map((p) => (
              <button
                key={p.id}
                className={`lang-picker-btn ${(draft.pdfLayoutPack || "photobook") === p.id ? "active" : ""}`}
                onClick={() => onChange({ pdfLayoutPack: p.id })}
              >
                {p.label}
              </button>
            ))}
          </div>
          <select
            value={draft.pdfPaperSize || "a4-portrait"}
            onChange={(e) => onChange({ pdfPaperSize: e.target.value })}
            aria-label={t("pdfPaperSizeLabel")}
          >
            {pdfLayouts.paperSizes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <button className="pdf-live-export" onClick={handleDownloadPdf} disabled={pdfDownloading}>
            {pdfDownloading ? t("pdfDownloading") : `⬇ ${t("downloadPdfBtn")}`}
          </button>
          {pdfError && <p className="error">{pdfError}</p>}
        </div>
      )}

      {mode === "book" && job && (
        <div className={`pdf-live-job ${job.status}`}>
          {job.status === "running" && (
            <>
              <div className="pdf-live-progress">
                <span style={{ width: `${progress}%` }} />
              </div>
              <span>
                {job.stage === "photos"
                  ? t("bookExportPhotos", job.done, job.total)
                  : t(isCewe ? "ceweExportLayout" : "bookExportLayout")}
              </span>
            </>
          )}
          {job.status === "done" && (
            <>
              <a className="pdf-live-download" href={`/api/book-exports/${job.id}/download`}>
                ⬇ {job.fileName} ({Math.round(job.size / 1e6)} MB)
              </a>
              <span className="pdf-live-hint">
                {t(job.fileName?.endsWith(".mcfx") ? "ceweImportHint" : "bookImportHint")}
              </span>
            </>
          )}
          {job.status === "error" && <span className="error">{job.error}</span>}
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {html && (
        <iframe
          ref={iframeRef}
          className="pdf-live-frame"
          title={t("pdfLivePreview")}
          srcDoc={html}
          onLoad={restoreScroll}
        />
      )}
    </aside>
  );
}

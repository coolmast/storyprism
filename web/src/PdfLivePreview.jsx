import { useEffect, useRef, useState } from "react";
import {
  fetchPdfPreviewHtml,
  fetchBookPreviewHtml,
  fetchBookProducts,
  startBookExport,
  fetchBookExport,
} from "./api.js";
import { useI18n } from "./i18n.jsx";

// Side panel (full screen on a phone) previewing the printed output for the
// *current, unsaved* draft, re-rendered shortly after every edit:
//   - Photobook: the lay-flat book as it will be exported to Saal Design
//     Software (cover + spreads), with product choice, per-stop layout
//     pickers inside the preview and the .sswprm export
//   - PDF: the paginated PDF export with its layout packs / paper sizes
export default function PdfLivePreview({
  draft,
  pdfLayouts,
  onChange,
  onOverride,
  onBookOverride,
  onBookSpreadCounts,
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
  const [bookFonts, setBookFonts] = useState({ fonts: [], defaultFonts: {} });
  const [job, setJob] = useState(null);
  const iframeRef = useRef(null);
  const scrollRef = useRef({ book: 0, pdf: 0 });
  const pollRef = useRef(null);

  useEffect(() => {
    fetchBookProducts()
      .then((r) => {
        setBookProducts(r.products);
        setBookFonts({ fonts: r.fonts || [], defaultFonts: r.defaultFonts || {} });
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
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onOverride, onBookOverride, onBookSpreadCounts]);

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
          <select
            value={draft.bookProduct || "saal-square-28"}
            onChange={(e) => onChange({ bookProduct: e.target.value })}
            aria-label={t("bookProductLabel")}
          >
            {bookProducts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          {[
            ["bookTitleFont", "title", t("bookTitleFontLabel")],
            ["bookBodyFont", "body", t("bookBodyFontLabel")],
          ].map(([field, role, label]) => (
            <label key={field} className="pdf-live-font">
              <span>{label}</span>
              <select
                value={draft[field] || bookFonts.defaultFonts[role] || ""}
                onChange={(e) => onChange({ [field]: e.target.value })}
              >
                {bookFonts.fonts.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name}
                    {f.kind === "script" && role === "body" ? " ✍" : ""}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <button
            className="pdf-live-export"
            onClick={handleExport}
            disabled={job?.status === "running"}
            title={t("bookExportHint")}
          >
            {job?.status === "running" ? t("bookExporting") : `⬇ ${t("bookExport")}`}
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
                {job.stage === "photos" ? t("bookExportPhotos", job.done, job.total) : t("bookExportLayout")}
              </span>
            </>
          )}
          {job.status === "done" && (
            <>
              <a className="pdf-live-download" href={`/api/book-exports/${job.id}/download`}>
                ⬇ {job.fileName} ({Math.round(job.size / 1e6)} MB)
              </a>
              <span className="pdf-live-hint">{t("bookImportHint")}</span>
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

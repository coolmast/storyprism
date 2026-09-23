import { useEffect, useRef, useState } from "react";
import { fetchPdfPreviewHtml } from "./api.js";
import { useI18n } from "./i18n.jsx";

// Side panel (full screen on a phone) showing the printed book's pages for
// the *current, unsaved* draft. Every edit re-renders it after a short pause,
// so switching the layout pack, paper size or a stop's layout is visible
// immediately - no save, no PDF download. The per-stop layout pickers inside
// the preview post their choice back here and edit the draft directly.
export default function PdfLivePreview({ draft, pdfLayouts, onChange, onOverride, onClose }) {
  const { t } = useI18n();
  const [html, setHtml] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const iframeRef = useRef(null);
  const scrollRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const next = await fetchPdfPreviewHtml(draft.id, draft);
        if (cancelled) return;
        scrollRef.current = iframeRef.current?.contentWindow?.scrollY || 0;
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
  }, [draft]);

  useEffect(() => {
    function onMessage(e) {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.data?.type === "pdf-template-override") onOverride(e.data.stopId, e.data.templateId);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onOverride]);

  function restoreScroll() {
    iframeRef.current?.contentWindow?.scrollTo(0, scrollRef.current);
  }

  return (
    <aside className="pdf-live-preview">
      <div className="pdf-live-head">
        <strong>{t("pdfLivePreview")}</strong>
        {loading && <span className="pdf-live-status">{t("pdfLiveUpdating")}</span>}
        <button className="pdf-live-close" onClick={onClose} aria-label={t("close")}>
          ✕
        </button>
      </div>
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

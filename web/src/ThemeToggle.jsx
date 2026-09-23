import { useEffect, useState } from "react";
import { SegmentedControl } from "./ui/index.js";
import { useI18n } from "./i18n.jsx";

// Must match the key index.html's inline no-flash script reads/writes,
// and the "system" | "light" | "dark" contract theme.css's
// :root[data-theme="..."] selectors expect.
const STORAGE_KEY = "story-builder-theme";

function readInitialMode() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // localStorage unavailable (private mode) - fall back to system.
  }
  return "system";
}

export default function ThemeToggle() {
  const { t } = useI18n();
  const [mode, setMode] = useState(readInitialMode);

  useEffect(() => {
    try {
      if (mode === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Choice just won't survive a reload - nothing else breaks.
    }
    if (mode === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = mode;
  }, [mode]);

  return (
    <SegmentedControl
      ariaLabel={t("themeModeLabel")}
      value={mode}
      onChange={setMode}
      options={[
        { value: "system", label: "🖥️", title: t("themeModeSystem") },
        { value: "light", label: "☀️", title: t("themeModeLight") },
        { value: "dark", label: "🌙", title: t("themeModeDark") },
      ]}
    />
  );
}

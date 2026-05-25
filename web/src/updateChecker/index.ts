import { subscribeLang, t } from "../i18n";

// GitHub 仓库由 settingsPanel 的 APP_META.repo 决定，这里只做硬编码字符串，避免循环依赖。
const REPO_OWNER = "huanxin996";
const REPO_NAME = "CasualtiesUnknown-SkinEditor";
const RELEASES_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;
const API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

interface CheckResult {
  current: string;
  latest: string;
  hasUpdate: boolean;
}

/**
 * 启动版本检测：拉 GitHub releases/latest，比版本，发现新版后挂个固定红字提示到 body 上，
 * 点击文字调系统浏览器打开 release 页。失败静默 console.warn。
 */
export function startUpdateChecker(currentVersion: string): void {
  void runCheck(currentVersion).then((r) => {
    if (r && r.hasUpdate) showUpdateBanner(r);
  });
}

async function runCheck(current: string): Promise<CheckResult | null> {
  try {
    const resp = await fetch(API_URL, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "SkinEditor" },
    });
    if (!resp.ok) {
      console.warn(`[updateChecker] HTTP ${resp.status}`);
      return null;
    }
    const json = (await resp.json()) as { tag_name?: string };
    const latest = (json.tag_name ?? "").trim();
    if (!latest) return null;
    return { current, latest, hasUpdate: isNewer(current, latest) };
  } catch (e) {
    console.warn(`[updateChecker] check failed: ${String(e)}`);
    return null;
  }
}

function isNewer(current: string, latest: string): boolean {
  const cur = stripV(current);
  const lat = stripV(latest);
  const a = cur.split(".").map((s) => parseInt(s, 10));
  const b = lat.split(".").map((s) => parseInt(s, 10));
  if (a.some((n) => Number.isNaN(n)) || b.some((n) => Number.isNaN(n))) return false;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (y > x) return true;
    if (y < x) return false;
  }
  return false;
}

function stripV(s: string): string {
  return s.trim().replace(/^v/i, "");
}

function showUpdateBanner(r: CheckResult): void {
  const banner = document.createElement("div");
  banner.id = "app-update-banner";
  banner.style.cssText =
    "position:fixed;left:32px;top:12vh;z-index:10000;font-size:18px;font-weight:700;color:#ff4d4d;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,0.4);user-select:none;";
  const updateText = (): void => {
    banner.textContent = t("updateChecker.banner")
      .replace("{current}", r.current)
      .replace("{latest}", r.latest);
  };
  updateText();
  banner.title = RELEASES_URL;
  banner.addEventListener("click", () => openExternal(RELEASES_URL));
  banner.addEventListener("mouseenter", () => {
    banner.style.color = "#ff8c8c";
  });
  banner.addEventListener("mouseleave", () => {
    banner.style.color = "#ff4d4d";
  });
  document.body.appendChild(banner);
  subscribeLang(updateText);
}

function openExternal(url: string): void {
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: unknown) => Promise<unknown> } };
  const invoke = w.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke === "function") {
    invoke("plugin:opener|open_url", { url }).catch(() => {
      window.open(url, "_blank", "noopener,noreferrer");
    });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

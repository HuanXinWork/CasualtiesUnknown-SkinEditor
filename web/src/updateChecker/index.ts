// 启动阶段静默查询 GitHub 最新 Release；发现新版时在右下角展示可关闭的跳转提示。

import { subscribeLang, t } from "../i18n";

const REPO_OWNER = "HuanXinWork";
const REPO_NAME = "CasualtiesUnknown-SkinEditor";
const RELEASES_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;
const API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

interface CheckResult {
  current: string;
  latest: string;
  hasUpdate: boolean;
}

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
  if (document.getElementById("app-update-banner")) return;
  const banner = document.createElement("div");
  banner.id = "app-update-banner";
  banner.className = "panel";
  banner.style.cssText =
    "position:fixed;right:16px;bottom:16px;z-index:10000;display:flex;align-items:center;gap:8px;" +
    "padding:8px 12px;font-size:12px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,0.25);user-select:none;";

  const linkSpan = document.createElement("span");
  linkSpan.style.cssText = "color:#e03e3e;cursor:pointer;";
  linkSpan.title = RELEASES_URL;
  linkSpan.addEventListener("click", () => openExternal(RELEASES_URL));

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn";
  closeBtn.textContent = "×";
  closeBtn.style.cssText = "padding:0 6px;line-height:1.4;";

  const updateText = (): void => {
    linkSpan.textContent = t("updateChecker.banner")
      .replace("{current}", r.current)
      .replace("{latest}", r.latest);
    closeBtn.title = t("common.close");
  };
  updateText();
  const unsubLang = subscribeLang(updateText);

  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    unsubLang();
    banner.remove();
  });

  banner.append(linkSpan, closeBtn);
  document.body.appendChild(banner);
}

function openExternal(url: string): void {
  const w = window as unknown as {
    __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: unknown) => Promise<unknown> };
  };
  const invoke = w.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke === "function") {
    invoke("plugin:opener|open_url", { url }).catch(() => {
      window.open(url, "_blank", "noopener,noreferrer");
    });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

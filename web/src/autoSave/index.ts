// 定时自动保存：开启后按间隔把所有未保存部件覆盖写回原 PNG（含 sidecar 分层）。
import { savePart, type ApiError } from "../apiClient";
import { sessionStore, markPartClean } from "../stateStore";
import { showToast } from "../toast";
import { t } from "../i18n";

const MIN_INTERVAL_SEC = 10;

/// partId（skinName::Category::partName）解码为原始 PNG 目标路径。
function partIdToTarget(skinRoot: string, partId: string): string | null {
  const parts = partId.split("::");
  if (parts.length !== 3) return null;
  const [skinName, categoryDir, partName] = parts;
  return `${skinRoot}/${skinName}/${categoryDir}/${partName}.png`;
}

async function flushDirty(skinRoot: string): Promise<void> {
  const dirty = [...sessionStore.getState().dirtyPartIds];
  if (dirty.length === 0) return;
  let saved = 0;
  for (const partId of dirty) {
    const target = partIdToTarget(skinRoot, partId);
    if (!target) continue;
    try {
      await savePart(partId, target);
      markPartClean(partId);
      saved++;
    } catch (e) {
      console.warn(`[autoSave] save ${partId} failed: ${(e as ApiError)?.message ?? String(e)}`);
    }
  }
  if (saved > 0) {
    showToast(t("autoSave.savedToast").replace("{n}", String(saved)), "info");
  }
}

/// 挂载定时保存；订阅 sessionStore 开关与间隔变化，按需启停定时器。返回卸载函数。
export function mountAutoSave(skinRoot: string): () => void {
  let timer: number | null = null;
  let lastEnabled = false;
  let lastInterval = 0;

  function stop(): void {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  function sync(): void {
    const { autoSaveEnabled, autoSaveIntervalSec } = sessionStore.getState();
    const interval = Math.max(MIN_INTERVAL_SEC, autoSaveIntervalSec || 0);
    if (autoSaveEnabled === lastEnabled && interval === lastInterval) return;
    lastEnabled = autoSaveEnabled;
    lastInterval = interval;
    stop();
    if (autoSaveEnabled) {
      timer = window.setInterval(() => void flushDirty(skinRoot), interval * 1000);
    }
  }

  const unsub = sessionStore.subscribe(sync);
  sync();
  return () => {
    unsub();
    stop();
  };
}

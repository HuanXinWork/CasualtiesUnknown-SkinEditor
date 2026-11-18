// 定时自动保存：单飞串行写盘并校验部件脏版本号，防止保存途中产生的新笔迹被误标干净。

import { savePart, type ApiError } from "../apiClient";
import {
  getPartDirtyRevision,
  markPartClean,
  partIdToTargetPath,
  sessionStore,
} from "../stateStore";
import { showToast } from "../toast";
import { t } from "../i18n";

const MIN_INTERVAL_SEC = 10;
let flushing = false;

async function flushDirty(skinRoot: string): Promise<void> {
  if (flushing) return;
  const dirty = [...sessionStore.getState().dirtyPartIds];
  if (dirty.length === 0) return;
  flushing = true;
  let saved = 0;
  try {
    for (const partId of dirty) {
      const target = partIdToTargetPath(skinRoot, partId);
      if (!target) continue;
      const rev = getPartDirtyRevision(partId);
      try {
        await savePart(partId, target);
        markPartClean(partId, rev);
        saved++;
      } catch (e) {
        console.warn(`[autoSave] save ${partId} failed: ${(e as ApiError)?.message ?? String(e)}`);
      }
    }
  } finally {
    flushing = false;
  }
  if (saved > 0) {
    showToast(t("autoSave.savedToast").replace("{n}", String(saved)), "info");
  }
}

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

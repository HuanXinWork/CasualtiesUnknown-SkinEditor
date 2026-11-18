// 图层跨部件剪贴板：记录源部件与图层 ID，粘贴时追加为目标部件的新顶层。

import { copyLayerToPart, type ApiError, type LayersSnapshot } from "../apiClient";
import { showToast } from "../toast";
import { t } from "../i18n";

interface LayerRef {
  partId: string;
  layerId: string;
  layerName: string;
}

let clipboard: LayerRef | null = null;

export function hasLayerClipboard(): boolean {
  return clipboard !== null;
}

export function copyLayerToClipboard(partId: string, layerId: string, layerName: string): void {
  clipboard = { partId, layerId, layerName };
  showToast(t("layerClipboard.copyToast").replace("{name}", layerName), "info");
}

export function pasteLayerToPart(
  targetPartId: string,
  onDone: (snap: LayersSnapshot) => void,
): void {
  const src = clipboard;
  if (!src) return;
  copyLayerToPart(src.partId, src.layerId, targetPartId)
    .then((snap) => {
      showToast(t("layerClipboard.pasteToast").replace("{name}", src.layerName), "info");
      onDone(snap);
    })
    .catch((e: ApiError) => showToast(e?.message ?? String(e), "error"));
}

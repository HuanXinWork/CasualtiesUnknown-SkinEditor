// 底部居中临时通知。
// info/warn 自动 3s 消失，error 5s。多条同时触发直接堆叠，不做队列。

export type ToastKind = "info" | "warn" | "error";

export function showToast(message: string, kind: ToastKind = "info"): void {
  const el = document.createElement("div");
  el.className = `toast toast-${kind} motion-toast-in`;
  el.textContent = message;
  document.body.appendChild(el);
  const ttl = kind === "error" ? 5000 : 3000;
  window.setTimeout(() => {
    el.classList.replace("motion-toast-in", "motion-toast-out");
    window.setTimeout(() => el.remove(), 200);
  }, ttl);
}

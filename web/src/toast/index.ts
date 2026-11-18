// 底部居中轻量提示条（info/warn 3 秒自动消失，error 5 秒自动消失）。

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

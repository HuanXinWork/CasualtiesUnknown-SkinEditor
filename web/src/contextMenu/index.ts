// 通用右键上下文菜单，挂载后自动钳制在可视窗口边界内。

export interface ContextMenuItem {
  label: string;
  action: () => void;
  disabled?: boolean;
}

let activeMenu: HTMLElement | null = null;

export function showContextMenu(x: number, y: number, items: ContextMenuItem[]): void {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
  const ul = document.createElement("ul");
  ul.className = "dock-context-menu";
  ul.style.left = `${x}px`;
  ul.style.top = `${y}px`;
  for (const it of items) {
    const li = document.createElement("li");
    li.textContent = it.label;
    if (it.disabled) {
      li.style.opacity = "0.4";
      li.style.pointerEvents = "none";
    } else {
      li.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        close();
        it.action();
      });
    }
    ul.appendChild(li);
  }
  document.body.appendChild(ul);
  activeMenu = ul;

  const rect = ul.getBoundingClientRect();
  const maxLeft = Math.max(4, window.innerWidth - rect.width - 4);
  const maxTop = Math.max(4, window.innerHeight - rect.height - 4);
  ul.style.left = `${Math.max(4, Math.min(maxLeft, x))}px`;
  ul.style.top = `${Math.max(4, Math.min(maxTop, y))}px`;

  function close(): void {
    if (activeMenu === ul) activeMenu = null;
    ul.remove();
    document.removeEventListener("mousedown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
  }
  function onOutside(e: MouseEvent): void {
    if (!ul.contains(e.target as Node)) close();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
  }
  document.addEventListener("mousedown", onOutside, true);
  document.addEventListener("keydown", onKey, true);
}

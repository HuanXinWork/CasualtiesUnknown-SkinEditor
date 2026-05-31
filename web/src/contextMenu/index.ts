// 通用右键菜单：position:fixed <ul>，复用 dock-context-menu 样式。
// 点击外部 / 选中条目 / Esc 关闭；同一时刻只存在一个菜单。

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

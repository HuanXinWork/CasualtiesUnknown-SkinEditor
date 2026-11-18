// 工具栏与子窗口共用的 24×24 线条 SVG 图标及画布光标 data URL。

const SVG_BASE =
  'xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" ' +
  'fill="none" stroke="currentColor" stroke-width="1.7" ' +
  'stroke-linecap="round" stroke-linejoin="round"';

export const ICON_BRUSH =
  `<svg ${SVG_BASE}>` +
  `<path d="M4 20l4-1 11-11a2.5 2.5 0 0 0-3.5-3.5L4.5 15.5z"/>` +
  `<path d="M14 7l3 3"/>` +
  `<path d="M5.5 19.5l-1.5 0.5"/>` +
  `</svg>`;

export const ICON_ERASER =
  `<svg ${SVG_BASE}>` +
  `<path d="M14 4l6 6-9 9H6l-3-3z"/>` +
  `<path d="M9 9l6 6"/>` +
  `<path d="M3 21h18"/>` +
  `</svg>`;

export const ICON_PAN =
  `<svg ${SVG_BASE}>` +
  `<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11"/>` +
  `<path d="M12 11V4a1.5 1.5 0 0 1 3 0v7"/>` +
  `<path d="M15 11V5.5a1.5 1.5 0 0 1 3 0V13"/>` +
  `<path d="M18 12.5a1.5 1.5 0 0 1 3 0V17a5 5 0 0 1-5 5h-3a5 5 0 0 1-4.5-2.8L6 13.5a1.7 1.7 0 0 1 2.8-1.8L9 12"/>` +
  `</svg>`;

export const ICON_GRADIENT =
  `<svg ${SVG_BASE}>` +
  `<rect x="3" y="5" width="18" height="14" rx="1.5"/>` +
  `<path d="M3 19l18-14"/>` +
  `</svg>`;

export const ICON_ZONE_BRUSH =
  `<svg ${SVG_BASE}>` +
  `<path d="M5 19l4-1 9-9a2 2 0 0 0-2.8-2.8l-9 9z"/>` +
  `<path d="M14 7l2 2"/>` +
  `<path d="M16 3l0.5 1.5L18 5l-1.5 0.5L16 7l-0.5-1.5L14 5l1.5-0.5z"/>` +
  `<path d="M20 11l0.5 1.5L22 13l-1.5 0.5L20 15l-0.5-1.5L18 13l1.5-0.5z"/>` +
  `<path d="M5 8l0.5 1.5L7 10l-1.5 0.5L5 12l-0.5-1.5L3 10l1.5-0.5z"/>` +
  `</svg>`;

export const ICON_FILL =
  `<svg ${SVG_BASE}>` +
  `<path d="M5 11l6-6 7 7-6 6a2 2 0 0 1-2.8 0L5 13.8a2 2 0 0 1 0-2.8z"/>` +
  `<path d="M11 5L9 3"/>` +
  `<path d="M19 14c1 1.5 1.5 2.6 1.5 3.3A1.5 1.5 0 0 1 19 18.8 1.5 1.5 0 0 1 17.5 17.3c0-0.7 0.5-1.8 1.5-3.3z"/>` +
  `</svg>`;

export const ICON_SOFT_BRUSH =
  `<svg ${SVG_BASE}>` +
  `<path d="M9 15l3-0.8 8-8a2 2 0 0 0-2.8-2.8l-8 8z"/>` +
  `<path d="M15 6l2 2"/>` +
  `<circle cx="7" cy="17" r="3.2" stroke-dasharray="2 2"/>` +
  `</svg>`;

export const ICON_UNDO =
  `<svg ${SVG_BASE}>` +
  `<path d="M9 14L4 9l5-5"/>` +
  `<path d="M4 9h11a5 5 0 0 1 5 5v1a5 5 0 0 1-5 5h-4"/>` +
  `</svg>`;

export const ICON_REDO =
  `<svg ${SVG_BASE}>` +
  `<path d="M15 14l5-5-5-5"/>` +
  `<path d="M20 9H9a5 5 0 0 0-5 5v1a5 5 0 0 0 5 5h4"/>` +
  `</svg>`;

export const ICON_HISTORY =
  `<svg ${SVG_BASE}>` +
  `<path d="M3 12a9 9 0 1 0 3-6.7"/>` +
  `<path d="M3 4v5h5"/>` +
  `<path d="M12 7v5l3 2"/>` +
  `</svg>`;

export const ICON_IMPORT =
  `<svg ${SVG_BASE}>` +
  `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>` +
  `<path d="M7 10l5 5 5-5"/>` +
  `<path d="M12 15V3"/>` +
  `</svg>`;

export const ICON_EXPORT =
  `<svg ${SVG_BASE}>` +
  `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>` +
  `<path d="M7 8l5-5 5 5"/>` +
  `<path d="M12 3v12"/>` +
  `</svg>`;

export const ICON_LANG =
  `<svg ${SVG_BASE}>` +
  `<circle cx="12" cy="12" r="9"/>` +
  `<path d="M3 12h18"/>` +
  `<path d="M12 3a14 14 0 0 1 0 18"/>` +
  `<path d="M12 3a14 14 0 0 0 0 18"/>` +
  `</svg>`;

export const ICON_THEME =
  `<svg ${SVG_BASE}>` +
  `<path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z"/>` +
  `</svg>`;

export const ICON_RESET_LAYOUT =
  `<svg ${SVG_BASE}>` +
  `<rect x="3" y="4" width="18" height="14" rx="1"/>` +
  `<path d="M3 9h18"/>` +
  `<path d="M14 14l-2-2 2-2"/>` +
  `<path d="M9 12h7"/>` +
  `</svg>`;

export const ICON_SETTINGS =
  `<svg ${SVG_BASE}>` +
  `<circle cx="12" cy="12" r="3"/>` +
  `<path d="M19.4 14a7.97 7.97 0 0 0 0-4l2-1.6-2-3.4-2.4 0.9a8 8 0 0 0-3.5-2L13 1h-2l-0.5 2.9a8 8 0 0 0-3.5 2L4.6 5L2.6 8.4l2 1.6a7.97 7.97 0 0 0 0 4l-2 1.6 2 3.4 2.4-0.9a8 8 0 0 0 3.5 2L11 23h2l0.5-2.9a8 8 0 0 0 3.5-2l2.4 0.9 2-3.4z"/>` +
  `</svg>`;

export const ICON_SAVE =
  `<svg ${SVG_BASE}>` +
  `<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1-2-2h11l5 5v11a2 2 0 0 1-2 2z"/>` +
  `<path d="M17 21v-8H7v8"/>` +
  `<path d="M7 3v5h8"/>` +
  `</svg>`;

export const ICON_DROPPER =
  `<svg ${SVG_BASE}>` +
  `<path d="M19 4l1 1a2 2 0 0 1 0 3l-3 3-4-4 3-3a2 2 0 0 1 3 0z"/>` +
  `<path d="M13 7l4 4-9 9H4v-4z"/>` +
  `</svg>`;

export const ICON_PIN =
  `<svg ${SVG_BASE}>` +
  `<path d="M9 4h6"/>` +
  `<path d="M10 4v6l-3 3v2h10v-2l-3-3V4"/>` +
  `<path d="M12 15v5"/>` +
  `</svg>`;

export const ICON_PIN_OFF =
  `<svg ${SVG_BASE}>` +
  `<path d="M9 4h6"/>` +
  `<path d="M10 4v6l-3 3v2h10v-2l-3-3V4"/>` +
  `<path d="M12 15v5"/>` +
  `<path d="M4 4l16 16"/>` +
  `</svg>`;

export const ICON_REATTACH =
  `<svg ${SVG_BASE}>` +
  `<path d="M4 12h12"/>` +
  `<path d="M12 6l-6 6 6 6"/>` +
  `<path d="M20 4v16"/>` +
  `</svg>`;

export const ICON_CLOSE =
  `<svg ${SVG_BASE}>` +
  `<path d="M6 6l12 12"/>` +
  `<path d="M18 6L6 18"/>` +
  `</svg>`;

export const ICON_REFRESH =
  `<svg ${SVG_BASE}>` +
  `<path d="M3 12a9 9 0 1 0 3-6.7"/>` +
  `<path d="M3 4v5h5"/>` +
  `</svg>`;

export const ICON_CHEVRON_DOWN =
  `<svg ${SVG_BASE}>` +
  `<path d="M6 9l6 6 6-6"/>` +
  `</svg>`;

export const ICON_CHEVRON_RIGHT =
  `<svg ${SVG_BASE}>` +
  `<path d="M9 6l6 6-6 6"/>` +
  `</svg>`;

// 吸管光标热点定在左下角滴管尖端 (1, 30)。
export const CURSOR_DROPPER_DATAURL = (() => {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>` +
    `<rect x='-1' y='-1' width='26' height='26' fill='%23fff' stroke='none' opacity='0'/>` +
    `<path d='M19 4l1 1a2 2 0 0 1 0 3l-3 3-4-4 3-3a2 2 0 0 1 3 0z' fill='%23fff'/>` +
    `<path d='M13 7l4 4-9 9H4v-4z' fill='%23fff'/>` +
    `</svg>`;
  return `url("data:image/svg+xml;utf8,${svg}") 1 30, crosshair`;
})();

export const TOOL_ICONS: Record<
  "brush" | "eraser" | "pan" | "gradient" | "zoneBrush" | "fill" | "softBrush",
  string
> = {
  brush: ICON_BRUSH,
  eraser: ICON_ERASER,
  pan: ICON_PAN,
  gradient: ICON_GRADIENT,
  zoneBrush: ICON_ZONE_BRUSH,
  fill: ICON_FILL,
  softBrush: ICON_SOFT_BRUSH,
};

function cursorUrl(svg: string, hotX: number, hotY: number): string {
  const encoded = encodeURIComponent(svg).replace(/'/g, "%27").replace(/"/g, "%22");
  return `url("data:image/svg+xml;utf8,${encoded}") ${hotX} ${hotY}`;
}

const CURSOR_BRUSH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ' +
  'fill="white" stroke="black" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M4 20l4-1 11-11a2.5 2.5 0 0 0-3.5-3.5L4.5 15.5z"/>' +
  '<path d="M14 7l3 3"/>' +
  "</svg>";

const CURSOR_ERASER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ' +
  'fill="white" stroke="black" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M14 4l6 6-9 9H6l-3-3z"/>' +
  '<path d="M9 9l6 6"/>' +
  "</svg>";

const CURSOR_GRADIENT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ' +
  'fill="white" stroke="black" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="3" y="5" width="18" height="14" rx="1.5"/>' +
  '<path d="M3 19l18-14"/>' +
  "</svg>";

const CURSOR_ZONE_BRUSH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ' +
  'fill="white" stroke="black" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M5 19l4-1 9-9a2 2 0 0 0-2.8-2.8l-9 9z"/>' +
  '<path d="M14 7l2 2"/>' +
  '<path d="M16 3l0.5 1.5L18 5l-1.5 0.5L16 7l-0.5-1.5L14 5l1.5-0.5z"/>' +
  "</svg>";

const CURSOR_FILL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ' +
  'fill="white" stroke="black" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M5 11l6-6 7 7-6 6a2 2 0 0 1-2.8 0L5 13.8a2 2 0 0 1 0-2.8z"/>' +
  '<path d="M11 5L9 3"/>' +
  "</svg>";

const CURSOR_SOFT_BRUSH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ' +
  'fill="white" stroke="black" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M9 15l3-0.8 8-8a2 2 0 0 0-2.8-2.8l-8 8z"/>' +
  '<path d="M15 6l2 2"/>' +
  '<circle cx="7" cy="17" r="3.2" stroke-dasharray="2 2"/>' +
  "</svg>";

// 黑描白填光标适配深浅色背景；热点对齐各工具笔尖坐标。
export const CANVAS_CURSORS: Record<
  "brush" | "eraser" | "gradient" | "zoneBrush" | "fill" | "softBrush",
  string
> = {
  brush: `${cursorUrl(CURSOR_BRUSH_SVG, 4, 20)}, crosshair`,
  eraser: `${cursorUrl(CURSOR_ERASER_SVG, 3, 21)}, crosshair`,
  gradient: `${cursorUrl(CURSOR_GRADIENT_SVG, 3, 3)}, crosshair`,
  zoneBrush: `${cursorUrl(CURSOR_ZONE_BRUSH_SVG, 5, 19)}, crosshair`,
  fill: `${cursorUrl(CURSOR_FILL_SVG, 5, 14)}, crosshair`,
  softBrush: `${cursorUrl(CURSOR_SOFT_BRUSH_SVG, 7, 17)}, crosshair`,
};

// 极简前端国际化（zh / en）：单文件双语词典 + 点路径查询 t()。
// 不引入 i18next / react-intl，不做插值与复数处理。
// currentLang() 从 sessionStore.lang 读取，缺省回退 "zh"。

import { sessionStore } from "../stateStore";

export type Lang = "zh" | "en";

export interface Translations {
  common: {
    close: string;
    alwaysOnTop: string;
    unpinFromTop: string;
    toggleCollapse: string;
    detachFallbackToast: string;
    reattachToMain: string;
  };
  partPanel: {
    title: string;
    bodyGroup: string;
    headGroup: string;
    expressionGroup: string;
    loadFailed: string;
    corruptedTag: string;
  };
  layerPanel: {
    title: string;
    addLayer: string;
    moveUp: string;
    moveDown: string;
    removeLayer: string;
    toggleVisible: string;
    opacityHint: string;
    loading: string;
    notSelected: string;
    errAddLayer: string;
    errRemoveLayer: string;
    errReorder: string;
    errSetActive: string;
    errSetVisible: string;
    errSetOpacity: string;
    errLoad: string;
  };
  toolPanel: {
    brush: string;
    eraser: string;
    pan: string;
    gradient: string;
    history: string;
    historyEmpty: string;
    historyTool_brush: string;
    historyTool_eraser: string;
    historyTool_gradient: string;
    historyTool_undo: string;
    historyTool_redo: string;
    size: string;
    undo: string;
    redo: string;
    resetLayout: string;
    export: string;
    importPack: string;
    exportSuccess: string;
    importSuccess: string;
    exportPrompt: string;
    importPrompt: string;
    exportNoSkin: string;
  };
  colorPalette: {
    title: string;
    recent: string;
    color: string;
    alpha: string;
    pickFromCanvas: string;
    swatchGroup_standard: string;
    swatchGroup_gray: string;
    swatchGroup_skin: string;
    swatchGroup_hair: string;
    swatchGroup_cloth: string;
    swatchGroup_shadow: string;
    swatchGroup_nature: string;
    swatchGroup_blood: string;
    swatchGroup_vintage: string;
  };
  editorCanvas: {
    title: string;
    notSelected: string;
    loadingPrefix: string;
    loadFailedPrefix: string;
    saved: string;
    unsaved: string;
    closeConfirmTitle: string;
    closeConfirmBody: string;
    closeSaveAndExit: string;
    closeDiscard: string;
    closeCancel: string;
    saveAllFailedPrefix: string;
  };
  imageWindow: {
    title: string;
    notFound: string;
    tooLarge: string;
  };
  previewCanvas: {
    title: string;
    modeAssembly: string;
    modeMotion: string;
    front: string;
    back: string;
    motionCaptureLabel: string;
    motionCaptureLoading: string;
    motionCaptureEmpty: string;
    motionPlay: string;
    motionPause: string;
    motionFrameLabel: string;
    motionPanelTitle: string;
    motionNoFrame: string;
    motionTailFallback: string;
    expressionPrefix: string;
    expression0: string;
    expression1: string;
    expression2: string;
    expression3: string;
    expression4: string;
    expression5: string;
    expression6: string;
    headVariantLabel: string;
    headVariant_default: string;
    headVariant_mouthHalf: string;
    headVariant_mouth: string;
    headVariant_disfigured1: string;
    headVariant_disfigured2: string;
    headVariant_disfigured3: string;
    headVariant_disfigured1Healed: string;
    headVariant_disfigured2Healed: string;
    headVariant_disfigured3Healed: string;
    notSelectedSkin: string;
    compositeFailedPrefix: string;
    resetView: string;
    resetViewBtn: string;
    livePreview: string;
    livePreviewHint: string;
    manualRefreshIdle: string;
    manualRefreshPending: string;
    dragHintWithPart: string;
    dragHintNoPart: string;
  };
  themeSettings: {
    title: string;
    primary: string;
    background: string;
    surface: string;
    light: string;
    dark: string;
  };
  langSettings: {
    title: string;
  };
    settings: {
      title: string;
      debugTitle: string;
      showMotionDebugPanel: string;
      shortcutsTitle: string;
      clickToRecord: string;
      recordingHint: string;
      resetThis: string;
      resetAll: string;
      aboutBtn: string;
      aboutVersion: string;
      aboutAuthor: string;
      aboutRepo: string;
      aboutDisclaimer: string;
      aboutStarPlea: string;
    action_undo: string;
    action_redo: string;
    action_save: string;
    action_tool_brush: string;
    action_tool_eraser: string;
    action_tool_gradient: string;
    action_tool_pan: string;
    action_brush_larger: string;
    action_brush_smaller: string;
    action_panel_history: string;
    action_panel_settings: string;
  };
  dockHost: {
    menu: {
      openInNewWindow: string;
      cancel: string;
    };
  };
}

export const dictionaries: Record<Lang, Translations> = {
  zh: {
    common: { close: "关闭", alwaysOnTop: "始终置顶", unpinFromTop: "取消置顶", toggleCollapse: "折叠/展开", detachFallbackToast: "无法打开独立窗口，已回退浮动卡片", reattachToMain: "嵌回主窗口" },
    partPanel: {
      title: "角色",
      bodyGroup: "身体",
      headGroup: "头部",
      expressionGroup: "表情部件",
      loadFailed: "加载失败",
      corruptedTag: "[损坏]",
    },
    layerPanel: {
      title: "图层",
      addLayer: "新增图层",
      moveUp: "上移",
      moveDown: "下移",
      removeLayer: "删除图层",
      toggleVisible: "可见",
      opacityHint: "图层不透明度（0% 全透 / 100% 不透明）",
      loading: "加载中...",
      notSelected: "未选择部件",
      errAddLayer: "新增图层",
      errRemoveLayer: "删除图层",
      errReorder: "重排图层",
      errSetActive: "选中图层",
      errSetVisible: "切换可见性",
      errSetOpacity: "设置 opacity",
      errLoad: "加载图层",
    },
    toolPanel: {
      brush: "画笔",
      eraser: "橡皮",
      pan: "拖动",
      gradient: "渐变",
      history: "历史",
      historyEmpty: "暂无历史记录",
      historyTool_brush: "画笔",
      historyTool_eraser: "橡皮",
      historyTool_gradient: "渐变",
      historyTool_undo: "撤销",
      historyTool_redo: "重做",
      size: "尺寸",
      undo: "撤销",
      redo: "重做",
      resetLayout: "重置布局",
      export: "导出",
      importPack: "导入",
      exportSuccess: "成功导出 {n} 个文件",
      importSuccess: "成功导入 {n} 个文件，跳过 {m} 个",
      exportPrompt: "请输入导出 zip 的绝对路径",
      importPrompt: "请输入要导入的 zip 绝对路径",
      exportNoSkin: "请先选择一个角色再导出",
    },
    colorPalette: {
      title: "颜色",
      recent: "最近",
      color: "颜色",
      alpha: "透明度",
      pickFromCanvas: "从画布取色（点击启用，再点取色，Esc 取消）",
      swatchGroup_standard: "标准",
      swatchGroup_gray: "灰阶",
      swatchGroup_skin: "肤色",
      swatchGroup_hair: "毛发",
      swatchGroup_cloth: "服装",
      swatchGroup_shadow: "阴影",
      swatchGroup_nature: "自然",
      swatchGroup_blood: "血色",
      swatchGroup_vintage: "做旧",
    },
    editorCanvas: {
      title: "编辑画布",
      notSelected: "未选择部件",
      loadingPrefix: "加载中：",
      loadFailedPrefix: "无法加载部件",
      saved: "已保存",
      unsaved: "未保存",
      closeConfirmTitle: "尚有未保存的修改",
      closeConfirmBody: "以下部件存在未保存的改动，是否在退出前保存？",
      closeSaveAndExit: "保存并退出",
      closeDiscard: "不保存",
      closeCancel: "取消",
      saveAllFailedPrefix: "部分部件保存失败：",
    },
    imageWindow: {
      title: "图片预览",
      notFound: "图片数据不存在或已被释放",
      tooLarge: "图片过大（超过 8MB）",
    },
    previewCanvas: {
      title: "预览",
      modeAssembly: "装配",
      modeMotion: "动画",
      front: "左面",
      back: "右面",
      motionCaptureLabel: "捕捉",
      motionCaptureLoading: "读取动作中...",
      motionCaptureEmpty: "暂无动作捕捉",
      motionPlay: "播放",
      motionPause: "暂停",
      motionFrameLabel: "帧",
      motionPanelTitle: "当前帧部件",
      motionNoFrame: "暂无帧数据",
      motionTailFallback: "Tail 未被捕捉，预览沿用静态尾巴",
      expressionPrefix: "表情",
      // 7 个表情对应 FacialExpression.eyeList[0..6] 的语义。
      expression0: "中性",
      expression1: "微闭",
      expression2: "闭眼",
      expression3: "惊恐",
      expression4: "恐慌",
      expression5: "悲伤",
      expression6: "开心",
      headVariantLabel: "头部",
      headVariant_default: "默认",
      headVariant_mouthHalf: "嘴半张",
      headVariant_mouth: "嘴张开",
      headVariant_disfigured1: "毁容 1",
      headVariant_disfigured2: "毁容 2",
      headVariant_disfigured3: "毁容 3",
      headVariant_disfigured1Healed: "愈合 1",
      headVariant_disfigured2Healed: "愈合 2",
      headVariant_disfigured3Healed: "愈合 3",
      notSelectedSkin: "未选择皮肤",
      compositeFailedPrefix: "合成失败：",
      resetView: "重置预览（缩放/位置）",
      resetViewBtn: "重置",
      livePreview: "实时预览",
      livePreviewHint: "关闭后预览不再随编辑同步刷新；变化会暂存，点旁边的刷新按钮手动应用",
      manualRefreshIdle: "暂无待应用变化",
      manualRefreshPending: "应用待预览的变化",
      dragHintWithPart: "已选 {part}：按住 Shift 拖动可改部件位置；普通拖动平移视口",
      dragHintNoPart: "在左侧部件列表选中后，可在此处按住 Shift 拖动改装配位置",
    },
    themeSettings: {
      title: "主题",
      primary: "主色",
      background: "背景色",
      surface: "表面色",
      light: "浅色",
      dark: "深色",
    },
    langSettings: { title: "语言" },
    settings: {
      title: "设置",
      debugTitle: "调试",
      showMotionDebugPanel: "显示当前帧部件调试面板",
      shortcutsTitle: "快捷键",
      clickToRecord: "点击录制",
      recordingHint: "按下任意键…（Esc 取消）",
      resetThis: "恢复默认",
      resetAll: "全部恢复默认",
      aboutBtn: "关于",
      aboutVersion: "版本",
      aboutAuthor: "作者",
      aboutRepo: "代码仓库",
      aboutDisclaimer: "本工具为 Casualties Unknown 的非官方皮肤编辑器，作者与原游戏开发商无关。所有资源版权归原作者所有，本工具仅供学习与个人使用。如发现侵权请联系仓库提交 issue 删除。",
      aboutStarPlea: "如果觉得这个项目还不错，可以给仓库点一个 Star嘛🥺",
      action_undo: "撤销",
      action_redo: "重做",
      action_save: "保存当前部件",
      action_tool_brush: "切换：画笔",
      action_tool_eraser: "切换：橡皮",
      action_tool_gradient: "切换：渐变",
      action_tool_pan: "切换：拖动",
      action_brush_larger: "画笔变大",
      action_brush_smaller: "画笔变小",
      action_panel_history: "打开历史面板",
      action_panel_settings: "打开设置面板",
    },
    dockHost: {
      menu: {
        openInNewWindow: "在新窗口打开",
        cancel: "取消",
      },
    },
  },
  en: {
    common: { close: "Close", alwaysOnTop: "Always on top", unpinFromTop: "Unpin", toggleCollapse: "Collapse/Expand", detachFallbackToast: "Could not open standalone window, falling back to floating card", reattachToMain: "Re-dock to main window" },
    partPanel: {
      title: "Character",
      bodyGroup: "Body",
      headGroup: "Head",
      expressionGroup: "Expression Parts",
      loadFailed: "Load failed",
      corruptedTag: "[corrupted]",
    },
    layerPanel: {
      title: "Layers",
      addLayer: "Add layer",
      moveUp: "Move up",
      moveDown: "Move down",
      removeLayer: "Delete layer",
      toggleVisible: "Visible",
      opacityHint: "Layer opacity (0% transparent / 100% opaque)",
      loading: "Loading...",
      notSelected: "No part selected",
      errAddLayer: "Add layer",
      errRemoveLayer: "Remove layer",
      errReorder: "Reorder layers",
      errSetActive: "Select layer",
      errSetVisible: "Toggle visibility",
      errSetOpacity: "Set opacity",
      errLoad: "Load layers",
    },
    toolPanel: {
      brush: "Brush",
      eraser: "Eraser",
      pan: "Pan",
      gradient: "Gradient",
      history: "History",
      historyEmpty: "No history yet",
      historyTool_brush: "Brush",
      historyTool_eraser: "Eraser",
      historyTool_gradient: "Gradient",
      historyTool_undo: "Undo",
      historyTool_redo: "Redo",
      size: "Size",
      undo: "Undo",
      redo: "Redo",
      resetLayout: "Reset layout",
      export: "Export",
      importPack: "Import",
      exportSuccess: "Exported {n} files",
      importSuccess: "Imported {n} files, skipped {m}",
      exportPrompt: "Enter absolute path of zip to export",
      importPrompt: "Enter absolute path of zip to import",
      exportNoSkin: "Please select a character before exporting",
    },
    colorPalette: {
      title: "Color",
      recent: "Recent",
      color: "Color",
      alpha: "Alpha",
      pickFromCanvas: "Pick from canvas (click to enable, click to sample, Esc to cancel)",
      swatchGroup_standard: "Standard",
      swatchGroup_gray: "Gray",
      swatchGroup_skin: "Skin",
      swatchGroup_hair: "Hair",
      swatchGroup_cloth: "Cloth",
      swatchGroup_shadow: "Shadow",
      swatchGroup_nature: "Nature",
      swatchGroup_blood: "Blood",
      swatchGroup_vintage: "Vintage",
    },
    editorCanvas: {
      title: "Edit Canvas",
      notSelected: "No part selected",
      loadingPrefix: "Loading: ",
      loadFailedPrefix: "Failed to load part",
      saved: "Saved",
      unsaved: "Unsaved",
      closeConfirmTitle: "Unsaved changes",
      closeConfirmBody: "The following parts have unsaved changes. Save before exiting?",
      closeSaveAndExit: "Save and exit",
      closeDiscard: "Discard",
      closeCancel: "Cancel",
      saveAllFailedPrefix: "Some parts failed to save: ",
    },
    imageWindow: {
      title: "Image Viewer",
      notFound: "Image data not found or already released",
      tooLarge: "Image too large (over 8MB)",
    },
    previewCanvas: {
      title: "Preview",
      modeAssembly: "Assembly",
      modeMotion: "Motion",
      front: "Left",
      back: "Right",
      motionCaptureLabel: "Capture",
      motionCaptureLoading: "Loading captures...",
      motionCaptureEmpty: "No captures",
      motionPlay: "Play",
      motionPause: "Pause",
      motionFrameLabel: "Frame",
      motionPanelTitle: "Current frame limbs",
      motionNoFrame: "No frame data",
      motionTailFallback: "Tail is not captured; preview uses a static fallback tail",
      expressionPrefix: "Expression",
      // Game eyeList[0..6] real semantics from docs/gameStructureResearch.md.
      expression0: "Neutral",
      expression1: "Half closed",
      expression2: "Closed",
      expression3: "Scared",
      expression4: "Panic",
      expression5: "Sad",
      expression6: "Happy",
      headVariantLabel: "Head",
      headVariant_default: "Default",
      headVariant_mouthHalf: "Mouth half",
      headVariant_mouth: "Mouth open",
      headVariant_disfigured1: "Disfigured 1",
      headVariant_disfigured2: "Disfigured 2",
      headVariant_disfigured3: "Disfigured 3",
      headVariant_disfigured1Healed: "Healed 1",
      headVariant_disfigured2Healed: "Healed 2",
      headVariant_disfigured3Healed: "Healed 3",
      notSelectedSkin: "No skin selected",
      compositeFailedPrefix: "Composite failed: ",
      resetView: "Reset preview (zoom/position)",
      resetViewBtn: "Reset",
      livePreview: "Live preview",
      livePreviewHint: "When off, edits will not refresh preview live; pending changes apply via the refresh button",
      manualRefreshIdle: "No pending changes",
      manualRefreshPending: "Apply pending changes",
      dragHintWithPart: "Selected {part}: hold Shift + drag to move part; plain drag pans viewport",
      dragHintNoPart: "Select a part on the left, then hold Shift + drag here to reposition it",
    },
    themeSettings: {
      title: "Theme",
      primary: "Primary",
      background: "Background",
      surface: "Surface",
      light: "Light",
      dark: "Dark",
    },
    langSettings: { title: "Language" },
    settings: {
      title: "Settings",
      debugTitle: "Debug",
      showMotionDebugPanel: "Show current frame debug panel",
      shortcutsTitle: "Shortcuts",
      clickToRecord: "Click to record",
      recordingHint: "Press any key... (Esc to cancel)",
      resetThis: "Reset to default",
      resetAll: "Reset all to default",
      aboutBtn: "About",
      aboutVersion: "Version",
      aboutAuthor: "Author",
      aboutRepo: "Repository",
      aboutDisclaimer: "Unofficial skin editor for Casualties Unknown. Not affiliated with the game's developer; all asset copyrights remain with their respective owners. Provided for learning and personal use only — please open an issue on the repo if there is any infringement concern.",
      aboutStarPlea: "If you find this project useful, would you give the repo a Star? 🥺",
      action_undo: "Undo",
      action_redo: "Redo",
      action_save: "Save current part",
      action_tool_brush: "Tool: Brush",
      action_tool_eraser: "Tool: Eraser",
      action_tool_gradient: "Tool: Gradient",
      action_tool_pan: "Tool: Pan",
      action_brush_larger: "Brush larger",
      action_brush_smaller: "Brush smaller",
      action_panel_history: "Open history panel",
      action_panel_settings: "Open settings panel",
    },
    dockHost: {
      menu: {
        openInNewWindow: "Open in new window",
        cancel: "Cancel",
      },
    },
  },
};

// 按点路径取值；目标必须是 string 才返回，否则视为缺失。
function lookup(dict: Translations, key: string): string | undefined {
  const parts = key.split(".");
  let cur: unknown = dict;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return typeof cur === "string" ? cur : undefined;
}

export function currentLang(): Lang {
  const v = (sessionStore.getState() as { lang?: Lang }).lang;
  return v === "en" ? "en" : "zh";
}

export function t(key: string, lang?: Lang): string {
  const useLang = lang ?? currentLang();
  return lookup(dictionaries[useLang], key) ?? lookup(dictionaries.zh, key) ?? key;
}

// 语言订阅：基于 sessionStore.subscribe 过滤 lang 变化，避免无关字段触发文案重渲染。
export function subscribeLang(cb: (lang: Lang) => void): () => void {
  let last = currentLang();
  return sessionStore.subscribe(() => {
    const next = currentLang();
    if (next !== last) {
      last = next;
      cb(next);
    }
  });
}

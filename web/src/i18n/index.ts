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
    wingsGroup: string;
    expressionGroup: string;
    accessoriesGroup: string;
    bloodGroup: string;
    loadFailed: string;
    corruptedTag: string;
  };
  wingDebugPanel: {
    title: string;
    hint: string;
    x: string;
    y: string;
    rotation: string;
    zOrder: string;
    reset: string;
    wingUL: string;
    wingUR: string;
    wingDL: string;
    wingDR: string;
  };
  bloodPanel: {
    title: string;
    hint: string;
    sectionParticle: string;
    sectionLimbShader: string;
    sectionVisual: string;
    sectionRandomColors: string;
    particleStartColor: string;
    particleEndColor: string;
    particleSize: string;
    particleLifetime: string;
    fadeCurve: string;
    fadeCurveLinear: string;
    fadeCurveEaseOut: string;
    fadeCurveBlink: string;
    fadeCurveConstant: string;
    bloodDark: string;
    bloodLight: string;
    glow: string;
    glowIntensity: string;
    animated: string;
    animFrames: string;
    animFps: string;
    randomColorsHint: string;
    randomColorAdd: string;
    randomColorRemove: string;
    reset: string;
    notSelected: string;
    saving: string;
    saved: string;
    saveFailed: string;
    overrideOn: string;
    overrideOff: string;
    overrideOnHint: string;
    overrideOffHint: string;
    alpha: string;
  };
  layerPanel: {
    title: string;
    addLayer: string;
    addZone: string;
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
    removeZone: string;
    zonesEmpty: string;
  };
  toolPanel: {
    brush: string;
    eraser: string;
    pan: string;
    gradient: string;
    zoneBrush: string;
    eraserModePart: string;
    eraserModeZone: string;
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
    exportLayoutPrompt: string;
    exportLayoutFlat: string;
    exportLayoutCategorized: string;
    exportIncludeBloodPrompt: string;
    exportConfirmBtn: string;
    exportCancelBtn: string;
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
    swatchGroup_custom: string;
    customSlotEmpty: string;
    customSlotEditTitle: string;
    customSlotUseCurrent: string;
    customSlotClear: string;
    customSlotCancel: string;
    customSlotSave: string;
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
    infoTitle: string;
    infoPartEmpty: string;
    resizeBtn: string;
    resizeTitle: string;
    resizeHint: string;
    resizeCancel: string;
    resizeInvalid: string;
    createSideFBtn: string;
    createSideBBtn: string;
    accessoryEnabledLabel: string;
    accessoryDisabledLabel: string;
    accessoryAdvancedShow: string;
    accessoryAdvancedHide: string;
    accessoryAdvancedSaving: string;
    accessoryAdvancedSaved: string;
    accessoryOffsetX: string;
    accessoryOffsetY: string;
    accessoryRotation: string;
    accessoryZOrder: string;
    accessoryLight: string;
    accessoryLightIntensity: string;
    accessoryLightOuter: string;
    accessoryLightInner: string;
    accessoryParticle: string;
    accessoryParticleRate: string;
    accessoryParticleLifetime: string;
    accessoryParticleSize: string;
    accessoryAnimation: string;
    accessoryAnimationFrames: string;
    accessoryAnimationFps: string;
    accessoryAnimationLoop: string;
    zoneLightColor2: string;
    zoneLightMode: string;
    zoneLightModeRadial: string;
    zoneLightModeDirectional: string;
    zoneLightModeScatter: string;
    zoneLightDirection: string;
    zoneLightSpread: string;
    zoneLightFalloff: string;
    zoneLightBreathing: string;
    zoneLightBreathSpeed: string;
    zoneLightBreathAmp: string;
    zoneParticleEndColor: string;
    zoneParticleMode: string;
    zoneParticleModeGravity: string;
    zoneParticleModeStar: string;
    zoneParticleModeFire: string;
    zoneParticleModeWater: string;
    zoneParticleModeOrbit: string;
    zoneParticleSpeed: string;
    zoneParticleDirection: string;
    zoneParticleSpread: string;
    zoneParticleEndScale: string;
    zoneParticleFadeCurve: string;
    zoneParticleFadeLinear: string;
    zoneParticleFadeEaseOut: string;
    zoneParticleFadeBlink: string;
    zoneParticleFadeConstant: string;
    zoneNamePlaceholder: string;
    zoneDelete: string;
    zoneDisplayColor: string;
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
      showWingDebugPanel: string;
      showBloodPanel: string;
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
  updateChecker: {
    banner: string;
  };
}

export const dictionaries: Record<Lang, Translations> = {
  zh: {
    common: { close: "关闭", alwaysOnTop: "始终置顶", unpinFromTop: "取消置顶", toggleCollapse: "折叠/展开", detachFallbackToast: "无法打开独立窗口，已回退浮动卡片", reattachToMain: "嵌回主窗口" },
    partPanel: {
      title: "角色",
      bodyGroup: "身体",
      headGroup: "头部",
      wingsGroup: "翅膀",
      expressionGroup: "表情部件",
      accessoriesGroup: "配件",
      bloodGroup: "血液贴图",
      loadFailed: "加载失败",
      corruptedTag: "[损坏]",
    },
    wingDebugPanel: {
      title: "翅膀调试",
      hint: "调整 4 片翼的 (x, y) / 旋转 / 层级，预览实时刷新；右翼自动镜像，不写入磁盘。",
      x: "X",
      y: "Y",
      rotation: "旋转",
      zOrder: "层级",
      reset: "重置默认值",
      wingUL: "左上翼",
      wingUR: "右上翼",
      wingDL: "左下翼",
      wingDR: "右下翼",
    },
    bloodPanel: {
      title: "血液粒子",
      hint: "为当前皮肤定制流血粒子与 Limb 受伤色；改动 300ms 后写入 <skin>/blood.json，mod 端按皮肤自动套用。",
      sectionParticle: "粒子",
      sectionLimbShader: "Limb 受伤色",
      sectionVisual: "光影 / 动画",
      sectionRandomColors: "随机配色",
      particleStartColor: "起始色",
      particleEndColor: "结束色",
      particleSize: "粒子尺寸",
      particleLifetime: "粒子寿命（秒）",
      fadeCurve: "Alpha 曲线",
      fadeCurveLinear: "线性",
      fadeCurveEaseOut: "缓出",
      fadeCurveBlink: "闪烁",
      fadeCurveConstant: "常驻",
      bloodDark: "暗部血色",
      bloodLight: "亮部血色",
      glow: "Additive 发光",
      glowIntensity: "发光强度倍率",
      animated: "粒子帧动画",
      animFrames: "帧数",
      animFps: "FPS",
      randomColorsHint: "非空时，每个粒子随机抽一种颜色发射；为空走起始/结束色渐变。",
      randomColorAdd: "添加颜色",
      randomColorRemove: "删除",
      reset: "全部恢复默认（清空覆盖）",
      notSelected: "未选择皮肤",
      saving: "保存中…",
      saved: "已保存",
      saveFailed: "保存失败",
      overrideOn: "已覆盖",
      overrideOff: "默认",
      overrideOnHint: "字段已写入 blood.json；点击恢复默认。",
      overrideOffHint: "字段未覆盖，按游戏默认；点击启用并使用当前控件值。",
      alpha: "Alpha",
    },
    layerPanel: {
      title: "图层",
      addLayer: "新增图层",
      addZone: "新增区块",
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
      removeZone: "删除区块",
      zonesEmpty: "无区块（用魔法笔画一下试试）",
    },
    toolPanel: {
      brush: "画笔",
      eraser: "橡皮",
      pan: "拖动",
      gradient: "渐变",
      zoneBrush: "区块画笔",
      eraserModePart: "清部件",
      eraserModeZone: "清区块",
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
      exportLayoutPrompt: "选择导出格式：",
      exportLayoutFlat: "旧式（皮肤名/Body 下平铺所有部件）",
      exportLayoutCategorized: "新式（皮肤名/Body、Head、Wings、Accessories 分类）",
      exportIncludeBloodPrompt: "一并导出血液配置（blood.json + Blood/*.png）",
      exportConfirmBtn: "导出",
      exportCancelBtn: "取消",
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
      swatchGroup_custom: "自定义（长按或右键编辑）",
      customSlotEmpty: "空槽（长按或右键编辑）",
      customSlotEditTitle: "编辑自定义色卡",
      customSlotUseCurrent: "使用当前颜色",
      customSlotClear: "清空",
      customSlotCancel: "取消",
      customSlotSave: "保存",
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
      infoTitle: "当前部件",
      infoPartEmpty: "未选中部件",
      resizeBtn: "修改分辨率",
      resizeTitle: "修改部件分辨率",
      resizeHint: "选择放大倍数（当前 {w}×{h}）",
      resizeCancel: "取消",
      resizeInvalid: "目标尺寸超出 1~4096 范围",
      createSideFBtn: "创建前侧版本",
      createSideBBtn: "创建后侧版本",
      accessoryEnabledLabel: "已启用",
      accessoryDisabledLabel: "未启用",
      accessoryAdvancedShow: "高级 ▶",
      accessoryAdvancedHide: "高级 ▼",
      accessoryAdvancedSaving: "保存中…",
      accessoryAdvancedSaved: "已保存",
      accessoryOffsetX: "X 偏移",
      accessoryOffsetY: "Y 偏移",
      accessoryRotation: "旋转",
      accessoryZOrder: "Z 序",
      accessoryLight: "发光",
      accessoryLightIntensity: "强度",
      accessoryLightOuter: "外径",
      accessoryLightInner: "内径",
      accessoryParticle: "粒子",
      accessoryParticleRate: "每秒",
      accessoryParticleLifetime: "寿命",
      accessoryParticleSize: "大小",
      accessoryAnimation: "动画",
      accessoryAnimationFrames: "帧序列",
      accessoryAnimationFps: "FPS",
      accessoryAnimationLoop: "循环",
      zoneLightColor2: "渐变末端色",
      zoneLightMode: "光模式",
      zoneLightModeRadial: "径向",
      zoneLightModeDirectional: "定向",
      zoneLightModeScatter: "散射",
      zoneLightDirection: "方向°",
      zoneLightSpread: "扩散°",
      zoneLightFalloff: "衰减幂",
      zoneLightBreathing: "呼吸",
      zoneLightBreathSpeed: "频率",
      zoneLightBreathAmp: "幅度",
      zoneParticleEndColor: "末色",
      zoneParticleMode: "粒子模式",
      zoneParticleModeGravity: "重力",
      zoneParticleModeStar: "星空",
      zoneParticleModeFire: "火焰",
      zoneParticleModeWater: "水流",
      zoneParticleModeOrbit: "环绕",
      zoneParticleSpeed: "速度",
      zoneParticleDirection: "方向°",
      zoneParticleSpread: "扩散°",
      zoneParticleEndScale: "末缩",
      zoneParticleFadeCurve: "曲线",
      zoneParticleFadeLinear: "线性",
      zoneParticleFadeEaseOut: "缓退",
      zoneParticleFadeBlink: "闪烁",
      zoneParticleFadeConstant: "恒定",
      zoneNamePlaceholder: "区块名（可选）",
      zoneDelete: "删除",
      zoneDisplayColor: "显示色",
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
      showWingDebugPanel: "显示翅膀调试面板",
      showBloodPanel: "显示血液粒子面板",
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
    updateChecker: {
      banner: "编辑器有新版本：{current} → {latest}（点击此处打开 release 页）",
    },
  },
  en: {
    common: { close: "Close", alwaysOnTop: "Always on top", unpinFromTop: "Unpin", toggleCollapse: "Collapse/Expand", detachFallbackToast: "Could not open standalone window, falling back to floating card", reattachToMain: "Re-dock to main window" },
    partPanel: {
      title: "Character",
      bodyGroup: "Body",
      headGroup: "Head",
      wingsGroup: "Wings",
      expressionGroup: "Expression Parts",
      accessoriesGroup: "Accessories",
      bloodGroup: "Blood textures",
      loadFailed: "Load failed",
      corruptedTag: "[corrupted]",
    },
    wingDebugPanel: {
      title: "Wing debug",
      hint: "Tune (x, y) / rotation / zOrder of the 4 wing parts; right wings auto-mirror; preview refreshes live, not persisted.",
      x: "X",
      y: "Y",
      rotation: "Rotation",
      zOrder: "zOrder",
      reset: "Reset to defaults",
      wingUL: "Upper Left",
      wingUR: "Upper Right",
      wingDL: "Lower Left",
      wingDR: "Lower Right",
    },
    bloodPanel: {
      title: "Blood particles",
      hint: "Customize bleed particles and limb wound color for the current skin; saved to <skin>/blood.json with 300ms debounce, picked up by the mod per-skin.",
      sectionParticle: "Particles",
      sectionLimbShader: "Limb wound color",
      sectionVisual: "Glow / Animation",
      sectionRandomColors: "Random palette",
      particleStartColor: "Start color",
      particleEndColor: "End color",
      particleSize: "Particle size",
      particleLifetime: "Particle lifetime (sec)",
      fadeCurve: "Alpha curve",
      fadeCurveLinear: "Linear",
      fadeCurveEaseOut: "Ease-out",
      fadeCurveBlink: "Blink",
      fadeCurveConstant: "Constant",
      bloodDark: "Dark wound color",
      bloodLight: "Light wound color",
      glow: "Additive glow",
      glowIntensity: "Glow intensity multiplier",
      animated: "Particle sheet animation",
      animFrames: "Frames",
      animFps: "FPS",
      randomColorsHint: "When non-empty, each particle samples one color at emit; otherwise falls back to start/end gradient.",
      randomColorAdd: "Add color",
      randomColorRemove: "Remove",
      reset: "Reset all (clear overrides)",
      notSelected: "No skin selected",
      saving: "Saving…",
      saved: "Saved",
      saveFailed: "Save failed",
      overrideOn: "Override",
      overrideOff: "Default",
      overrideOnHint: "Field is written to blood.json; click to revert to game default.",
      overrideOffHint: "Field falls back to game default; click to enable and use current control value.",
      alpha: "Alpha",
    },
    layerPanel: {
      title: "Layers",
      addLayer: "Add layer",
      addZone: "Add zone",
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
      removeZone: "Delete zone",
      zonesEmpty: "No zones (try the magic brush)",
    },
    toolPanel: {
      brush: "Brush",
      eraser: "Eraser",
      pan: "Pan",
      gradient: "Gradient",
      zoneBrush: "Zone Brush",
      eraserModePart: "Erase part",
      eraserModeZone: "Erase zone",
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
      exportLayoutPrompt: "Pick export layout:",
      exportLayoutFlat: "Legacy (everything flat in <skin>/Body/)",
      exportLayoutCategorized: "Categorized (<skin>/Body, Head, Wings, Accessories)",
      exportIncludeBloodPrompt: "Include blood config (blood.json + Blood/*.png) in export",
      exportConfirmBtn: "Export",
      exportCancelBtn: "Cancel",
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
      swatchGroup_custom: "Custom (long-press or right-click to edit)",
      customSlotEmpty: "Empty slot (long-press or right-click to edit)",
      customSlotEditTitle: "Edit custom swatch",
      customSlotUseCurrent: "Use current color",
      customSlotClear: "Clear",
      customSlotCancel: "Cancel",
      customSlotSave: "Save",
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
      infoTitle: "Current part",
      infoPartEmpty: "No part selected",
      resizeBtn: "Resize",
      resizeTitle: "Resize part",
      resizeHint: "Pick a scale factor (current {w}×{h})",
      resizeCancel: "Cancel",
      resizeInvalid: "Target size out of range 1-4096",
      createSideFBtn: "Create front variant",
      createSideBBtn: "Create back variant",
      accessoryEnabledLabel: "Enabled",
      accessoryDisabledLabel: "Disabled",
      accessoryAdvancedShow: "Advanced ▶",
      accessoryAdvancedHide: "Advanced ▼",
      accessoryAdvancedSaving: "Saving…",
      accessoryAdvancedSaved: "Saved",
      accessoryOffsetX: "X offset",
      accessoryOffsetY: "Y offset",
      accessoryRotation: "Rotation",
      accessoryZOrder: "Z order",
      accessoryLight: "Light",
      accessoryLightIntensity: "Intensity",
      accessoryLightOuter: "Outer",
      accessoryLightInner: "Inner",
      accessoryParticle: "Particle",
      accessoryParticleRate: "Rate",
      accessoryParticleLifetime: "Lifetime",
      accessoryParticleSize: "Size",
      accessoryAnimation: "Animation",
      accessoryAnimationFrames: "Frames",
      accessoryAnimationFps: "FPS",
      accessoryAnimationLoop: "Loop",
      zoneLightColor2: "End color",
      zoneLightMode: "Mode",
      zoneLightModeRadial: "Radial",
      zoneLightModeDirectional: "Directional",
      zoneLightModeScatter: "Scatter",
      zoneLightDirection: "Dir°",
      zoneLightSpread: "Spread°",
      zoneLightFalloff: "Falloff",
      zoneLightBreathing: "Breathe",
      zoneLightBreathSpeed: "Speed",
      zoneLightBreathAmp: "Amp",
      zoneParticleEndColor: "End",
      zoneParticleMode: "Mode",
      zoneParticleModeGravity: "Gravity",
      zoneParticleModeStar: "Star",
      zoneParticleModeFire: "Fire",
      zoneParticleModeWater: "Water",
      zoneParticleModeOrbit: "Orbit",
      zoneParticleSpeed: "Speed",
      zoneParticleDirection: "Dir°",
      zoneParticleSpread: "Spread°",
      zoneParticleEndScale: "EndScale",
      zoneParticleFadeCurve: "Curve",
      zoneParticleFadeLinear: "Linear",
      zoneParticleFadeEaseOut: "EaseOut",
      zoneParticleFadeBlink: "Blink",
      zoneParticleFadeConstant: "Constant",
      zoneNamePlaceholder: "Zone name (optional)",
      zoneDelete: "Delete",
      zoneDisplayColor: "Display",
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
      showWingDebugPanel: "Show wing debug panel",
      showBloodPanel: "Show blood particles panel",
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
    updateChecker: {
      banner: "Editor update available: {current} → {latest} (click to open the release page)",
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

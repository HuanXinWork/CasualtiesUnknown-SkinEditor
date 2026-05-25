# 构建引用清单

本目录留给本地构建用，不入版本库。请从你本地的游戏安装目录拷贝以下 dll：

```text
<游戏目录>/BepInEx/core/
├── BepInEx.dll
└── 0Harmony.dll

<游戏目录>/CasualtiesUnknown_Data/Managed/
├── Assembly-CSharp.dll
├── UnityEngine.dll
├── UnityEngine.CoreModule.dll
├── UnityEngine.IMGUIModule.dll
├── UnityEngine.UIModule.dll        # SaveManager 用
├── UnityEngine.UI.dll              # SaveManager 用
└── Newtonsoft.Json.dll
```

放到 `references/` 下后即可 `dotnet build -c Release`。SaveManager 的 csproj 也把 HintPath 指到这里，两个 mod 共享同一份 references。

`csproj` 里这些路径以 `HintPath` 引用，不会复制到产物目录里——MotionRecorder.dll 自身只有约几十 KB，运行期由 BepInEx 解析这些依赖。

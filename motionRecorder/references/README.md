# 本地构建引用目录

`references/` 用于存放本地编译 `MotionRecorder.csproj` 所需的游戏与框架程序集（已加入 `.gitignore`，不会提交进版本库）。

编译前请从本机 `Casualties Unknown` 安装目录拷贝以下 7 个文件到当前文件夹：

```text
<游戏目录>/BepInEx/core/
├── BepInEx.dll
└── 0Harmony.dll

<游戏目录>/CasualtiesUnknown_Data/Managed/
├── Assembly-CSharp.dll
├── UnityEngine.dll
├── UnityEngine.CoreModule.dll
├── UnityEngine.IMGUIModule.dll
└── Newtonsoft.Json.dll
```

拷齐后在上一级 `motionRecorder/` 目录执行 `dotnet build -c Release` 即可。`MotionRecorder.csproj` 对这些程序集全部设置了 `Private=false`，输出目录只会生成轻量的 `MotionRecorder.dll`，不会把游戏自身的 DLL 一起打包进去。

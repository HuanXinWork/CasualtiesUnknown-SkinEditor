using System;
using System.Collections.Generic;
using System.IO;
using BepInEx;
using BepInEx.Configuration;
using BepInEx.Logging;
using UnityEngine;

namespace CasualtiesUnknown.MotionRecorder
{
    [BepInPlugin(PluginGuid, PluginName, PluginVersion)]
    public sealed class Plugin : BaseUnityPlugin
    {
        private const string PluginGuid = "com.casualtiesUnknown.motionRecorder";
        private const string PluginName = "MotionRecorder";
        private const string PluginVersion = "1.0.0";

        // —— 配置项 —— //
        private ConfigEntry<KeyboardShortcut> _startHotkey;
        private ConfigEntry<KeyboardShortcut> _stopHotkey;
        private ConfigEntry<bool> _showOverlay;
        private ConfigEntry<KeyboardShortcut> _toggleSettingsHotkey;

        // —— 设置面板 —— //
        private bool _settingsOpen;
        private Rect _settingsRect = new Rect(60f, 60f, 360f, 220f);
        private bool _capturingStartKey;
        private bool _capturingStopKey;

        // —— 录制状态 —— //
        private bool _recording;
        private float _startTime;
        private long _startUnixMs;
        private CaptureFile _capture;
        private Body _target;
        private TailScript _targetTail;

        // —— 浮动按钮坐标（屏幕左下角） —— //
        private Rect _btnRect = new Rect(20f, 0f, 160f, 36f);
        private Rect _statusRect = new Rect(20f, 0f, 280f, 28f);

        private static ManualLogSource _log;

        private string _lastSavedPath;

        private void Awake()
        {
            _log = Logger;

            _startHotkey = Config.Bind(
                "Hotkeys",
                "StartHotkey",
                new KeyboardShortcut(KeyCode.F9),
                "开始录制的快捷键。在录制中按下无效。");

            _stopHotkey = Config.Bind(
                "Hotkeys",
                "StopHotkey",
                new KeyboardShortcut(KeyCode.F10),
                "停止录制的快捷键。在空闲状态按下无效。");

            _toggleSettingsHotkey = Config.Bind(
                "Hotkeys",
                "ToggleSettingsHotkey",
                new KeyboardShortcut(KeyCode.F8),
                "打开 / 关闭设置面板。在面板里可以热改其他按键与 UI 开关。");

            _showOverlay = Config.Bind(
                "UI",
                "ShowOverlay",
                true,
                "是否显示左下角的浮动按钮与状态文字。关掉后只能用快捷键控制。");

            // 准备输出目录：plugins/MotionRecorder/captures/
            try
            {
                Directory.CreateDirectory(GetCapturesDir());
            }
            catch (Exception ex)
            {
                _log.LogWarning($"创建 captures 目录失败：{ex.Message}");
            }

            _log.LogInfo($"{PluginName} ready · start={_startHotkey.Value} · stop={_stopHotkey.Value} · settings={_toggleSettingsHotkey.Value} · captures→{GetCapturesDir()}");
        }

        private void Update()
        {
            // 设置面板开 / 关：始终响应，不被录制状态阻塞
            if (_toggleSettingsHotkey.Value.IsDown())
            {
                _settingsOpen = !_settingsOpen;
                _capturingStartKey = false;
                _capturingStopKey = false;
                return;
            }

            // 录制开始 / 停止：拆成两个键，避免按错把"停"当"开"
            if (!_recording && _startHotkey.Value.IsDown())
            {
                StartRecording();
                return;
            }
            if (_recording && _stopHotkey.Value.IsDown())
            {
                StopRecording();
                return;
            }

            if (_recording)
            {
                CaptureCurrentFrame();
            }
        }

        private void OnGUI()
        {
            DrawSettingsPanel();
            if (!_showOverlay.Value) return;
            if (!IsInGameWorld()) return;

            // 把按钮放到屏幕左下角，避免遮 HUD
            _btnRect.y = Screen.height - _btnRect.height - 20f;
            _statusRect.y = _btnRect.y - _statusRect.height - 4f;

            // 状态条
            var prevColor = GUI.color;
            GUI.color = _recording ? new Color(1f, 0.35f, 0.35f, 0.95f) : new Color(1f, 1f, 1f, 0.7f);
            string status = _recording
                ? $"REC {FormatDuration(Time.unscaledTime - _startTime)} · {_capture?.Frames?.Count ?? 0} frames · 停止 {_stopHotkey.Value}"
                : (_lastSavedPath != null
                    ? $"saved: {Path.GetFileName(_lastSavedPath)}"
                    : $"idle · 开始 {_startHotkey.Value} · 设置 {_toggleSettingsHotkey.Value}");
            GUI.Label(_statusRect, status);
            GUI.color = prevColor;

            // 按钮
            string btnLabel = _recording ? "停止录制" : "开始录制";
            if (GUI.Button(_btnRect, btnLabel))
            {
                ToggleRecording();
            }
        }

        // —— 设置面板 —— //

        private void DrawSettingsPanel()
        {
            if (!_settingsOpen) return;

            _settingsRect = GUI.Window(GetInstanceID(), _settingsRect, DrawSettingsContent, "MotionRecorder 设置");
        }

        private void DrawSettingsContent(int id)
        {
            // 1) 浮动按钮显隐
            bool newOverlay = GUI.Toggle(new Rect(16f, 28f, 320f, 22f), _showOverlay.Value, "  显示左下角录制按钮 / 状态条");
            if (newOverlay != _showOverlay.Value) _showOverlay.Value = newOverlay;

            // 2) 开始键
            GUI.Label(new Rect(16f, 60f, 120f, 22f), "开始录制按键：");
            string startBtn = _capturingStartKey ? "请按下新按键…" : _startHotkey.Value.ToString();
            if (GUI.Button(new Rect(140f, 60f, 200f, 22f), startBtn))
            {
                _capturingStartKey = true;
                _capturingStopKey = false;
            }

            // 3) 停止键
            GUI.Label(new Rect(16f, 88f, 120f, 22f), "停止录制按键：");
            string stopBtn = _capturingStopKey ? "请按下新按键…" : _stopHotkey.Value.ToString();
            if (GUI.Button(new Rect(140f, 88f, 200f, 22f), stopBtn))
            {
                _capturingStopKey = true;
                _capturingStartKey = false;
            }

            // 4) 改键采集：在 Repaint 之外的事件里读 keyDown
            if (_capturingStartKey || _capturingStopKey)
            {
                var ev = Event.current;
                if (ev.type == EventType.KeyDown && ev.keyCode != KeyCode.None)
                {
                    var shortcut = new KeyboardShortcut(ev.keyCode);
                    if (_capturingStartKey) _startHotkey.Value = shortcut;
                    else _stopHotkey.Value = shortcut;
                    _capturingStartKey = false;
                    _capturingStopKey = false;
                    ev.Use();
                }
            }

            // 5) 当前状态摘要
            string status = _recording
                ? $"录制中：{_capture?.Frames?.Count ?? 0} 帧 / {FormatDuration(Time.unscaledTime - _startTime)}"
                : (_lastSavedPath != null ? $"上次保存：{Path.GetFileName(_lastSavedPath)}" : "空闲");
            GUI.Label(new Rect(16f, 124f, 320f, 22f), status);

            // 6) 关闭按钮
            if (GUI.Button(new Rect(16f, 160f, 120f, 28f), "关闭"))
            {
                _settingsOpen = false;
                _capturingStartKey = false;
                _capturingStopKey = false;
            }

            GUI.DragWindow(new Rect(0f, 0f, _settingsRect.width, 24f));
        }

        // —— 状态机 —— //

        private void ToggleRecording()
        {
            if (_recording) StopRecording();
            else StartRecording();
        }

        private void StartRecording()
        {
            _target = FindPlayerBody();
            if (_target == null)
            {
                _log.LogWarning("未找到玩家 Body，跳过录制。请先进入有角色的场景。");
                return;
            }

            _capture = new CaptureFile
            {
                ModVersion = PluginVersion,
                StartedAtUnixMs = DateTimeOffset.Now.ToUnixTimeMilliseconds(),
                PlayerName = _target.gameObject.name,
            };
            _targetTail = FindTailForBody(_target);
            _startTime = Time.unscaledTime;
            _startUnixMs = _capture.StartedAtUnixMs;
            _recording = true;
            _lastSavedPath = null;
            _log.LogInfo($"开始录制：target={_target.gameObject.name} · tail={(_targetTail != null ? _targetTail.gameObject.name : "<none>")}");
        }

        private void StopRecording()
        {
            if (!_recording) return;
            _recording = false;

            try
            {
                _capture.FrameCount = _capture.Frames.Count;
                string fileName = BuildFileName(_capture.PlayerName, _startUnixMs);
                string path = Path.Combine(GetCapturesDir(), fileName);
                string json = Newtonsoft.Json.JsonConvert.SerializeObject(_capture, Newtonsoft.Json.Formatting.Indented);
                File.WriteAllText(path, json);
                _lastSavedPath = path;
                _log.LogInfo($"录制完成：{_capture.FrameCount} frames → {path}");
            }
            catch (Exception ex)
            {
                _log.LogError($"写入录制文件失败：{ex}");
            }
            finally
            {
                _capture = null;
                _target = null;
                _targetTail = null;
            }
        }

        // —— 采样核心 —— //

        private void CaptureCurrentFrame()
        {
            if (Time.timeScale <= 0f) return;
            if (_target == null || _capture == null) return;
            if (_target.limbs == null) return;

            var frame = new FrameSample
            {
                T = Time.unscaledTime - _startTime,
                IsRight = _target.transform.localScale.x >= 0f,
                Expression = TryGetExpressionIndex(_target),
            };

            for (int i = 0; i < _target.limbs.Length; i++)
            {
                var limb = _target.limbs[i];
                if (limb == null) continue;
                frame.Limbs.Add(BuildSample(limb.gameObject.name, i, limb.transform, limb.GetComponent<SpriteRenderer>(), useWorldRotation: false));
            }

            if (_targetTail == null || !_targetTail.gameObject.activeInHierarchy)
            {
                _targetTail = FindTailForBody(_target);
            }
            if (_targetTail != null)
            {
                frame.Limbs.Add(BuildSample("Tail", -1, _targetTail.transform, _targetTail.GetComponent<SpriteRenderer>(), useWorldRotation: true));
            }

            // 翅膀（来自 SkinSync mod 的 HwWings 容器，4 张独立 transform）：
            // 名字固定 WingUL/WingUR/WingDL/WingDR，挂在 UpTorso 子节点下的 HwWings 容器。
            // 录制时直接抓 SpriteRenderer 的位置 / 旋转 / sprite 元信息，编辑器渲染时按 partName 直接用。
            // limbNum 用 -10..-13，避免与 limbs[] 索引冲突。
            CaptureWingSamples(frame);

            _capture.Frames.Add(frame);
        }

        private static readonly string[] WingNames = { "WingUL", "WingUR", "WingDL", "WingDR" };

        private void CaptureWingSamples(FrameSample frame)
        {
            if (_target == null) return;
            // 先找 HwWings 容器：UpTorso 子节点下，找不到就在整个 body 子树里找。
            Transform[] all = _target.GetComponentsInChildren<Transform>(true);
            for (int idx = 0; idx < WingNames.Length; idx++)
            {
                Transform wingTf = null;
                string wn = WingNames[idx];
                foreach (var tf in all)
                {
                    if (tf != null && tf.name == wn) { wingTf = tf; break; }
                }
                if (wingTf == null) continue;
                var sr = wingTf.GetComponent<SpriteRenderer>();
                // 翼名按编辑器约定全小写：wingUL/wingUR/wingDL/wingDR；limbNum 用 -10..-13。
                string editorName = "wing" + wn.Substring(4);
                frame.Limbs.Add(BuildSample(editorName, -10 - idx, wingTf, sr, useWorldRotation: true));
            }
        }

        private LimbSample BuildSample(string name, int limbNum, Transform t, SpriteRenderer sr, bool useWorldRotation = false)
        {
            // 把 SpriteRenderer.bounds.center（世界坐标）转回 Body 根节点局部坐标，
            // 这是 sprite 的真实视觉中心，不受 pivot / 关节锚点 / 旋转影响。
            Vector3 centerLocal = Vector3.zero;
            string spriteName = "";
            float pivotU = 0.5f, pivotV = 0.5f, spriteW = 0f, spriteH = 0f;
            if (sr != null)
            {
                centerLocal = _target.transform.InverseTransformPoint(sr.bounds.center);
                if (sr.sprite != null)
                {
                    spriteName = sr.sprite.name ?? "";
                    var rect = sr.sprite.rect;
                    spriteW = rect.width;
                    spriteH = rect.height;
                    if (spriteW > 0f && spriteH > 0f)
                    {
                        pivotU = sr.sprite.pivot.x / spriteW;
                        pivotV = sr.sprite.pivot.y / spriteH;
                    }
                }
            }
            return new LimbSample
            {
                Name = name,
                LimbNum = limbNum,
                Px = t.localPosition.x,
                Py = t.localPosition.y,
                Pz = t.localPosition.z,
                // 挂 body 子节点的 limb 直接用 localEulerAngles.z（local==画布旋转）；
                // 挂在更深层级（HwWings/UpTorso 子节点）的翼/尾要用世界 z 才能落到画布旋转上。
                RotZ = useWorldRotation ? t.eulerAngles.z : t.localEulerAngles.z,
                ScaleX = t.localScale.x,
                ScaleY = t.localScale.y,
                SortingOrder = sr != null ? sr.sortingOrder : 0,
                Visible = sr != null && sr.enabled && t.gameObject.activeInHierarchy,
                Bcx = centerLocal.x,
                Bcy = centerLocal.y,
                SpriteName = spriteName,
                PivotU = pivotU,
                PivotV = pivotV,
                SpriteW = spriteW,
                SpriteH = spriteH,
            };
        }

        // —— Helpers —— //

        /// <summary>
        /// 是否处于"游戏世界已加载"状态，作为浮动按钮显示门槛。
        /// 主菜单 / 加载中 PlayerCamera.main 与 WorldGeneration.world 都为 null。
        /// </summary>
        private static bool IsInGameWorld()
        {
            try
            {
                if (PlayerCamera.main == null) return false;
                if (WorldGeneration.world == null) return false;
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static Body FindPlayerBody()
        {
            // 取场景里第一个 limbs 非空的 active Body。多数情况下就是玩家。
            var all = UnityEngine.Object.FindObjectsOfType<Body>();
            foreach (var b in all)
            {
                if (b == null) continue;
                if (!b.gameObject.activeInHierarchy) continue;
                if (b.limbs == null || b.limbs.Length == 0) continue;
                return b;
            }
            return null;
        }

        private static TailScript FindTailForBody(Body body)
        {
            if (body == null) return null;
            TailScript best = null;
            float bestScore = float.PositiveInfinity;
            var bodyRoot = body.transform.root;
            var tails = UnityEngine.Object.FindObjectsOfType<TailScript>();
            foreach (var tail in tails)
            {
                if (tail == null) continue;
                if (!tail.gameObject.activeInHierarchy) continue;
                float score = Vector3.Distance(tail.transform.position, body.transform.position);
                if (tail.transform.root == bodyRoot)
                {
                    score -= 1000f;
                }
                if (tail.transform.parent == body.transform.parent)
                {
                    score -= 100f;
                }
                if (score < bestScore)
                {
                    bestScore = score;
                    best = tail;
                }
            }
            return best;
        }

        private static int TryGetExpressionIndex(Body body)
        {
            // FacialExpression 没有 currentIndex 字段，靠 eyes.sprite 在 eyeList[].front 中查找。
            // 失败时返回 -1，与 README 描述一致。
            try
            {
                var fe = body.GetComponentInChildren<FacialExpression>();
                if (fe == null || fe.eyes == null || fe.eyeList == null) return -1;
                var current = fe.eyes.sprite;
                if (current == null) return -1;
                for (int i = 0; i < fe.eyeList.Count; i++)
                {
                    var entry = fe.eyeList[i];
                    if (entry.front == current || entry.back == current) return i;
                }
            }
            catch
            {
                // ignore
            }
            return -1;
        }

        private static string GetCapturesDir()
        {
            // dll 所在目录的兄弟 captures/，落到 BepInEx/plugins/MotionRecorder/captures/
            var asmDir = Path.GetDirectoryName(typeof(Plugin).Assembly.Location)
                          ?? Path.Combine(Paths.PluginPath, "MotionRecorder");
            return Path.Combine(asmDir, "captures");
        }

        private static string BuildFileName(string playerName, long unixMs)
        {
            string safeName = string.IsNullOrEmpty(playerName) ? "player" : SanitizeFileName(playerName);
            string ts = DateTimeOffset.FromUnixTimeMilliseconds(unixMs).LocalDateTime
                .ToString("yyyyMMdd_HHmmss_fff");
            return $"motion_{ts}_{safeName}.json";
        }

        private static string SanitizeFileName(string raw)
        {
            var invalid = Path.GetInvalidFileNameChars();
            var arr = raw.ToCharArray();
            for (int i = 0; i < arr.Length; i++)
            {
                if (Array.IndexOf(invalid, arr[i]) >= 0 || arr[i] == ' ')
                    arr[i] = '_';
            }
            return new string(arr);
        }

        private static string FormatDuration(float seconds)
        {
            int total = Mathf.FloorToInt(seconds);
            int mm = total / 60;
            int ss = total % 60;
            int ms = Mathf.FloorToInt((seconds - total) * 1000f);
            return $"{mm:00}:{ss:00}.{ms:000}";
        }
    }
}

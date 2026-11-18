using System;
using System.IO;
using BepInEx;
using BepInEx.Configuration;
using BepInEx.Logging;
using Newtonsoft.Json;
using UnityEngine;

namespace CasualtiesUnknown.MotionRecorder
{
    /// <summary>逐帧采集玩家角色肢体、尾巴与翅膀变换并输出为皮肤编辑器动作预览 JSON。</summary>
    [BepInPlugin(PluginGuid, PluginName, PluginVersion)]
    public sealed class Plugin : BaseUnityPlugin
    {
        private const string PluginGuid = "com.casualtiesUnknown.motionRecorder";
        private const string PluginName = "MotionRecorder";
        private const string PluginVersion = "1.0.2";
        private const float MaxTailDistance = 3f;

        private static readonly string[] WingNodeNames = { "WingUL", "WingUR", "WingDL", "WingDR" };
        private static readonly string[] WingEditorNames = { "wingUL", "wingUR", "wingDL", "wingDR" };

        private ConfigEntry<KeyboardShortcut> _startHotkey;
        private ConfigEntry<KeyboardShortcut> _stopHotkey;
        private ConfigEntry<KeyboardShortcut> _toggleSettingsHotkey;
        private ConfigEntry<bool> _showOverlay;

        private bool _settingsOpen;
        private Rect _settingsRect = new Rect(60f, 60f, 360f, 220f);
        private bool _capturingStartKey;
        private bool _capturingStopKey;

        private bool _recording;
        private float _startTime;
        private float _pausedDuration;
        private long _startUnixMs;
        private CaptureFile _capture;
        private Body _target;
        private Transform _targetTail;
        private FacialExpression _targetFace;
        private readonly Transform[] _cachedWings = new Transform[4];

        private Rect _btnRect = new Rect(20f, 0f, 160f, 36f);
        private Rect _statusRect = new Rect(20f, 0f, 300f, 28f);

        private static ManualLogSource _log;
        private string _lastSavedPath;

        private void Awake()
        {
            _log = Logger;

            _startHotkey = Config.Bind(
                "Hotkeys",
                "StartHotkey",
                new KeyboardShortcut(KeyCode.F9),
                "开始录制的快捷键（录制中按下无效）。");

            _stopHotkey = Config.Bind(
                "Hotkeys",
                "StopHotkey",
                new KeyboardShortcut(KeyCode.F10),
                "停止录制并保存的快捷键（空闲时按下无效）。");

            _toggleSettingsHotkey = Config.Bind(
                "Hotkeys",
                "ToggleSettingsHotkey",
                new KeyboardShortcut(KeyCode.F8),
                "打开或关闭设置面板。");

            _showOverlay = Config.Bind(
                "UI",
                "ShowOverlay",
                true,
                "是否显示左下角录制按钮与状态栏。");

            try
            {
                Directory.CreateDirectory(GetCapturesDir());
            }
            catch (Exception ex)
            {
                _log.LogWarning($"创建 captures 目录失败：{ex.Message}");
            }

            _log.LogInfo(
                $"{PluginName} ready · start={_startHotkey.Value} · stop={_stopHotkey.Value} · settings={_toggleSettingsHotkey.Value} · captures→{GetCapturesDir()}");
        }

        private void OnDisable()
        {
            if (_recording && _capture != null && _capture.Frames.Count > 0)
            {
                StopRecording();
            }
        }

        private void Update()
        {
            if (_toggleSettingsHotkey.Value.IsDown())
            {
                _settingsOpen = !_settingsOpen;
                _capturingStartKey = false;
                _capturingStopKey = false;
                return;
            }

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

            if (!_recording) return;

            // 游戏暂停期间累扣真实挂钟增量，防止恢复后帧时间戳 `t` 出现断层。
            if (Time.timeScale <= 0f)
            {
                _pausedDuration += Time.unscaledDeltaTime;
                return;
            }

            CaptureCurrentFrame();
        }

        private void OnGUI()
        {
            DrawSettingsPanel();
            if (!_showOverlay.Value || !IsInGameWorld()) return;

            _btnRect.y = Screen.height - _btnRect.height - 20f;
            _statusRect.y = _btnRect.y - _statusRect.height - 4f;

            var prevColor = GUI.color;
            GUI.color = _recording ? new Color(1f, 0.35f, 0.35f, 0.95f) : new Color(1f, 1f, 1f, 0.7f);
            string status = _recording
                ? $"REC {FormatDuration(GetElapsedSeconds())} · {_capture?.Frames?.Count ?? 0} frames · 停止 {_stopHotkey.Value}"
                : (_lastSavedPath != null
                    ? $"saved: {Path.GetFileName(_lastSavedPath)}"
                    : $"idle · 开始 {_startHotkey.Value} · 设置 {_toggleSettingsHotkey.Value}");
            GUI.Label(_statusRect, status);
            GUI.color = prevColor;

            if (GUI.Button(_btnRect, _recording ? "停止录制" : "开始录制"))
            {
                ToggleRecording();
            }
        }

        private void DrawSettingsPanel()
        {
            if (!_settingsOpen) return;
            _settingsRect = GUI.Window(GetInstanceID(), _settingsRect, DrawSettingsContent, "MotionRecorder 设置");
        }

        private void DrawSettingsContent(int id)
        {
            bool newOverlay = GUI.Toggle(new Rect(16f, 28f, 320f, 22f), _showOverlay.Value, "  显示左下角录制按钮 / 状态条");
            if (newOverlay != _showOverlay.Value) _showOverlay.Value = newOverlay;

            GUI.Label(new Rect(16f, 60f, 120f, 22f), "开始录制按键：");
            string startBtn = _capturingStartKey ? "请按下新按键（Esc 取消）…" : _startHotkey.Value.ToString();
            if (GUI.Button(new Rect(140f, 60f, 200f, 22f), startBtn))
            {
                _capturingStartKey = true;
                _capturingStopKey = false;
            }

            GUI.Label(new Rect(16f, 88f, 120f, 22f), "停止录制按键：");
            string stopBtn = _capturingStopKey ? "请按下新按键（Esc 取消）…" : _stopHotkey.Value.ToString();
            if (GUI.Button(new Rect(140f, 88f, 200f, 22f), stopBtn))
            {
                _capturingStopKey = true;
                _capturingStartKey = false;
            }

            if (_capturingStartKey || _capturingStopKey)
            {
                var ev = Event.current;
                if (ev.type == EventType.KeyDown && ev.keyCode != KeyCode.None && !IsMouseKeyCode(ev.keyCode))
                {
                    if (ev.keyCode != KeyCode.Escape)
                    {
                        var shortcut = new KeyboardShortcut(ev.keyCode);
                        if (_capturingStartKey) _startHotkey.Value = shortcut;
                        else _stopHotkey.Value = shortcut;
                    }
                    _capturingStartKey = false;
                    _capturingStopKey = false;
                    ev.Use();
                }
            }

            string status = _recording
                ? $"录制中：{_capture?.Frames?.Count ?? 0} 帧 / {FormatDuration(GetElapsedSeconds())}"
                : (_lastSavedPath != null ? $"上次保存：{Path.GetFileName(_lastSavedPath)}" : "空闲");
            GUI.Label(new Rect(16f, 124f, 320f, 22f), status);

            if (GUI.Button(new Rect(16f, 160f, 120f, 28f), "关闭"))
            {
                _settingsOpen = false;
                _capturingStartKey = false;
                _capturingStopKey = false;
            }

            GUI.DragWindow(new Rect(0f, 0f, _settingsRect.width, 24f));
        }

        private static bool IsMouseKeyCode(KeyCode code)
        {
            return code >= KeyCode.Mouse0 && code <= KeyCode.Mouse6;
        }

        private float GetElapsedSeconds()
        {
            return Mathf.Max(0f, Time.unscaledTime - _startTime - _pausedDuration);
        }

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
            _targetTail = ResolveTailTransform(_target);
            _targetFace = _target.GetComponentInChildren<FacialExpression>(true);
            Array.Clear(_cachedWings, 0, _cachedWings.Length);
            RefreshWingCache(_target);

            _startTime = Time.unscaledTime;
            _pausedDuration = 0f;
            _startUnixMs = _capture.StartedAtUnixMs;
            _recording = true;
            _lastSavedPath = null;
            _log.LogInfo($"开始录制：target={_target.gameObject.name} · tail={(_targetTail != null ? _targetTail.name : "<none>")}");
        }

        private void StopRecording()
        {
            if (!_recording) return;
            _recording = false;

            try
            {
                Directory.CreateDirectory(GetCapturesDir());
                _capture.FrameCount = _capture.Frames.Count;
                string fileName = BuildFileName(_capture.PlayerName, _startUnixMs);
                string path = Path.Combine(GetCapturesDir(), fileName);
                string json = JsonConvert.SerializeObject(_capture, Formatting.Indented);
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
                _targetFace = null;
                Array.Clear(_cachedWings, 0, _cachedWings.Length);
            }
        }

        private void CaptureCurrentFrame()
        {
            if (_target == null || _capture == null || _target.limbs == null) return;

            var frame = new FrameSample
            {
                T = GetElapsedSeconds(),
                IsRight = _target.isRight,
                Expression = TryGetExpressionIndex(_target, ref _targetFace),
            };

            for (int i = 0; i < _target.limbs.Length; i++)
            {
                var limb = _target.limbs[i];
                if (limb == null) continue;
                frame.Limbs.Add(BuildSample(
                    limb.gameObject.name,
                    i,
                    limb.transform,
                    limb.GetComponent<SpriteRenderer>(),
                    useWorldRotation: false));
            }

            if (_targetTail == null || !_targetTail.gameObject.activeInHierarchy)
            {
                _targetTail = ResolveTailTransform(_target);
            }
            if (_targetTail != null)
            {
                frame.Limbs.Add(BuildSample(
                    "Tail",
                    -1,
                    _targetTail,
                    _targetTail.GetComponent<SpriteRenderer>(),
                    useWorldRotation: true));
            }

            CaptureWingSamples(frame);
            _capture.Frames.Add(frame);
        }

        private void RefreshWingCache(Body body)
        {
            if (body == null) return;
            Transform[] all = body.GetComponentsInChildren<Transform>(true);
            for (int idx = 0; idx < WingNodeNames.Length; idx++)
            {
                if (_cachedWings[idx] != null) continue;
                string wn = WingNodeNames[idx];
                for (int i = 0; i < all.Length; i++)
                {
                    var tf = all[i];
                    if (tf != null && tf.name == wn)
                    {
                        _cachedWings[idx] = tf;
                        break;
                    }
                }
            }
        }

        // 采样 SkinSync 挂载的 `WingUL/UR/DL/DR` 节点，编号使用 `-10..-13` 避开肢体槽位。
        private void CaptureWingSamples(FrameSample frame)
        {
            if (_target == null) return;
            bool needRefresh = false;
            for (int idx = 0; idx < _cachedWings.Length; idx++)
            {
                if (_cachedWings[idx] == null)
                {
                    needRefresh = true;
                    break;
                }
            }
            if (needRefresh) RefreshWingCache(_target);

            for (int idx = 0; idx < _cachedWings.Length; idx++)
            {
                var wingTf = _cachedWings[idx];
                if (wingTf == null) continue;
                frame.Limbs.Add(BuildSample(
                    WingEditorNames[idx],
                    -10 - idx,
                    wingTf,
                    wingTf.GetComponent<SpriteRenderer>(),
                    useWorldRotation: true));
            }
        }

        private LimbSample BuildSample(
            string name,
            int limbNum,
            Transform t,
            SpriteRenderer sr,
            bool useWorldRotation)
        {
            Vector3 centerLocal = Vector3.zero;
            string spriteName = "";
            float pivotU = 0.5f, pivotV = 0.5f, spriteW = 0f, spriteH = 0f;
            int sortingOrder = 0;
            bool visible = false;

            if (sr != null)
            {
                sortingOrder = sr.sortingOrder;
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
                if (sr.enabled && t.gameObject.activeInHierarchy)
                {
                    visible = true;
                    centerLocal = _target.transform.InverseTransformPoint(sr.bounds.center);
                }
            }

            // 兼容 SkinSync 流体尾巴：原版 SpriteRenderer 被禁用并替换为启用的 MeshRenderer。
            if (!visible && t.gameObject.activeInHierarchy)
            {
                var meshRenderer = t.GetComponent<MeshRenderer>() ?? t.GetComponentInChildren<MeshRenderer>();
                if (meshRenderer != null && meshRenderer.enabled)
                {
                    visible = true;
                    sortingOrder = meshRenderer.sortingOrder;
                    centerLocal = _target.transform.InverseTransformPoint(meshRenderer.bounds.center);
                }
            }

            return new LimbSample
            {
                Name = name,
                LimbNum = limbNum,
                Px = t.localPosition.x,
                Py = t.localPosition.y,
                Pz = t.localPosition.z,
                RotZ = useWorldRotation ? t.eulerAngles.z : t.localEulerAngles.z,
                ScaleX = t.localScale.x,
                ScaleY = t.localScale.y,
                SortingOrder = sortingOrder,
                Visible = visible,
                Bcx = centerLocal.x,
                Bcy = centerLocal.y,
                SpriteName = spriteName,
                PivotU = pivotU,
                PivotV = pivotV,
                SpriteW = spriteW,
                SpriteH = spriteH,
            };
        }

        private static bool IsInGameWorld()
        {
            try
            {
                return PlayerCamera.main != null && WorldGeneration.world != null;
            }
            catch
            {
                return false;
            }
        }

        private static Body FindPlayerBody()
        {
            try
            {
                if (PlayerCamera.main != null &&
                    PlayerCamera.main.body != null &&
                    PlayerCamera.main.body.gameObject.activeInHierarchy &&
                    PlayerCamera.main.body.limbs != null &&
                    PlayerCamera.main.body.limbs.Length > 0)
                {
                    return PlayerCamera.main.body;
                }
            }
            catch
            {
                // 回退到全局扫描
            }

            var all = UnityEngine.Object.FindObjectsOfType<Body>();
            foreach (var b in all)
            {
                if (b == null || !b.gameObject.activeInHierarchy) continue;
                if (b.limbs == null || b.limbs.Length == 0) continue;
                return b;
            }
            return null;
        }

        private static Transform ResolveTailTransform(Body body)
        {
            if (body == null) return null;
            if (body.tail != null && body.tail.gameObject.activeInHierarchy)
            {
                return body.tail;
            }

            TailScript best = null;
            float bestScore = float.PositiveInfinity;
            var bodyRoot = body.transform.root;
            var tails = UnityEngine.Object.FindObjectsOfType<TailScript>();
            foreach (var tail in tails)
            {
                if (tail == null || !tail.gameObject.activeInHierarchy) continue;
                bool sameHierarchy = tail.transform.root == bodyRoot || tail.transform.parent == body.transform.parent;
                float dist = Vector3.Distance(tail.transform.position, body.transform.position);
                if (!sameHierarchy && dist > MaxTailDistance) continue;

                float score = dist;
                if (tail.transform.root == bodyRoot) score -= 1000f;
                if (tail.transform.parent == body.transform.parent) score -= 100f;
                if (score < bestScore)
                {
                    bestScore = score;
                    best = tail;
                }
            }
            return best != null ? best.transform : null;
        }

        private static int TryGetExpressionIndex(Body body, ref FacialExpression cachedFace)
        {
            try
            {
                if (cachedFace == null)
                {
                    cachedFace = body.GetComponentInChildren<FacialExpression>();
                }
                if (cachedFace == null || cachedFace.eyes == null || cachedFace.eyeList == null) return -1;
                var current = cachedFace.eyes.sprite;
                if (current == null) return -1;
                for (int i = 0; i < cachedFace.eyeList.Count; i++)
                {
                    var entry = cachedFace.eyeList[i];
                    if (entry.front == current || entry.back == current) return i;
                }
            }
            catch
            {
                return -1;
            }
            return -1;
        }

        private static string GetCapturesDir()
        {
            var asmDir = Path.GetDirectoryName(typeof(Plugin).Assembly.Location);
            if (string.IsNullOrEmpty(asmDir))
            {
                asmDir = Path.Combine(Paths.PluginPath, "MotionRecorder");
            }
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
                {
                    arr[i] = '_';
                }
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

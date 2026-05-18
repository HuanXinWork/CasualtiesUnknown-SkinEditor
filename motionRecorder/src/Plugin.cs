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
        private ConfigEntry<KeyboardShortcut> _toggleHotkey;
        private ConfigEntry<bool> _showOverlay;

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

            _toggleHotkey = Config.Bind(
                "General",
                "ToggleHotkey",
                new KeyboardShortcut(KeyCode.F9),
                "开始 / 停止录制的快捷键。同时也可以点屏幕左下角的浮动按钮。");

            _showOverlay = Config.Bind(
                "UI",
                "ShowOverlay",
                true,
                "是否显示左下角的录制按钮与状态文字。");

            // 准备输出目录：plugins/MotionRecorder/captures/
            try
            {
                Directory.CreateDirectory(GetCapturesDir());
            }
            catch (Exception ex)
            {
                _log.LogWarning($"创建 captures 目录失败：{ex.Message}");
            }

            _log.LogInfo($"{PluginName} ready · hotkey={_toggleHotkey.Value} · captures→{GetCapturesDir()}");
        }

        private void Update()
        {
            if (_toggleHotkey.Value.IsDown())
            {
                ToggleRecording();
                return;
            }

            if (_recording)
            {
                CaptureCurrentFrame();
            }
        }

        private void OnGUI()
        {
            if (!_showOverlay.Value) return;

            // 把按钮放到屏幕左下角，避免遮 HUD
            _btnRect.y = Screen.height - _btnRect.height - 20f;
            _statusRect.y = _btnRect.y - _statusRect.height - 4f;

            // 状态条
            var prevColor = GUI.color;
            GUI.color = _recording ? new Color(1f, 0.35f, 0.35f, 0.95f) : new Color(1f, 1f, 1f, 0.7f);
            string status = _recording
                ? $"REC {FormatDuration(Time.unscaledTime - _startTime)} · {_capture?.Frames?.Count ?? 0} frames"
                : (_lastSavedPath != null ? $"saved: {Path.GetFileName(_lastSavedPath)}" : $"idle · 按 {_toggleHotkey.Value} 开始录制");
            GUI.Label(_statusRect, status);
            GUI.color = prevColor;

            // 按钮
            string btnLabel = _recording ? "停止录制" : "开始录制";
            if (GUI.Button(_btnRect, btnLabel))
            {
                ToggleRecording();
            }
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
                frame.Limbs.Add(BuildSample(limb.gameObject.name, i, limb.transform, limb.GetComponent<SpriteRenderer>()));
            }

            if (_targetTail == null || !_targetTail.gameObject.activeInHierarchy)
            {
                _targetTail = FindTailForBody(_target);
            }
            if (_targetTail != null)
            {
                frame.Limbs.Add(BuildSample("Tail", -1, _targetTail.transform, _targetTail.GetComponent<SpriteRenderer>()));
            }

            _capture.Frames.Add(frame);
        }

        private LimbSample BuildSample(string name, int limbNum, Transform t, SpriteRenderer sr)
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
                RotZ = t.localEulerAngles.z,
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

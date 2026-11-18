using System.Collections.Generic;
using Newtonsoft.Json;

namespace CasualtiesUnknown.MotionRecorder
{
    /// <summary>逐帧动作捕捉 JSON 顶层结构（v3，与皮肤编辑器 `MotionCaptureFile` 对齐）。</summary>
    internal sealed class CaptureFile
    {
        [JsonProperty("version")]
        public int Version { get; set; } = 3;

        [JsonProperty("modVersion")]
        public string ModVersion { get; set; }

        [JsonProperty("startedAtUnixMs")]
        public long StartedAtUnixMs { get; set; }

        [JsonProperty("playerName")]
        public string PlayerName { get; set; }

        [JsonProperty("frameCount")]
        public int FrameCount { get; set; }

        [JsonProperty("frames")]
        public List<FrameSample> Frames { get; set; } = new List<FrameSample>();
    }

    internal sealed class FrameSample
    {
        [JsonProperty("t")]
        public float T { get; set; }

        [JsonProperty("isRight")]
        public bool IsRight { get; set; }

        [JsonProperty("expression")]
        public int Expression { get; set; }

        [JsonProperty("limbs")]
        public List<LimbSample> Limbs { get; set; } = new List<LimbSample>();
    }

    /// <summary>单个部位帧数据；`bcx`/`bcy` 为渲染包围盒中心转回 `Body` 局部空间的坐标。</summary>
    internal sealed class LimbSample
    {
        [JsonProperty("name")]
        public string Name { get; set; }

        [JsonProperty("limbNum")]
        public int LimbNum { get; set; }

        [JsonProperty("px")]
        public float Px { get; set; }

        [JsonProperty("py")]
        public float Py { get; set; }

        [JsonProperty("pz")]
        public float Pz { get; set; }

        [JsonProperty("rotZ")]
        public float RotZ { get; set; }

        [JsonProperty("scaleX")]
        public float ScaleX { get; set; }

        [JsonProperty("scaleY")]
        public float ScaleY { get; set; }

        [JsonProperty("sortingOrder")]
        public int SortingOrder { get; set; }

        [JsonProperty("visible")]
        public bool Visible { get; set; }

        [JsonProperty("bcx")]
        public float Bcx { get; set; }

        [JsonProperty("bcy")]
        public float Bcy { get; set; }

        [JsonProperty("spriteName")]
        public string SpriteName { get; set; }

        [JsonProperty("pivotU")]
        public float PivotU { get; set; }

        [JsonProperty("pivotV")]
        public float PivotV { get; set; }

        [JsonProperty("spriteW")]
        public float SpriteW { get; set; }

        [JsonProperty("spriteH")]
        public float SpriteH { get; set; }
    }
}

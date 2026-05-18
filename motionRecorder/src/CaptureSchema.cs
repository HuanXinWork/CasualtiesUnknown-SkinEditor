using System.Collections.Generic;

namespace CasualtiesUnknown.MotionRecorder
{
    /// <summary>
    /// 与 <see cref="Plugin"/> 写盘格式一一对应。Newtonsoft.Json 默认序列化字段名
    /// 即此处的 PascalCase 属性名——为了贴合 README 文档里的 lowerCamelCase JSON
    /// 字段名，统一通过 <see cref="Newtonsoft.Json.JsonPropertyAttribute"/> 改写。
    /// </summary>
    internal sealed class CaptureFile
    {
        [Newtonsoft.Json.JsonProperty("version")]
        public int Version { get; set; } = 3;

        [Newtonsoft.Json.JsonProperty("modVersion")]
        public string ModVersion { get; set; }

        [Newtonsoft.Json.JsonProperty("startedAtUnixMs")]
        public long StartedAtUnixMs { get; set; }

        [Newtonsoft.Json.JsonProperty("playerName")]
        public string PlayerName { get; set; }

        [Newtonsoft.Json.JsonProperty("frameCount")]
        public int FrameCount { get; set; }

        [Newtonsoft.Json.JsonProperty("frames")]
        public List<FrameSample> Frames { get; set; } = new List<FrameSample>();
    }

    internal sealed class FrameSample
    {
        [Newtonsoft.Json.JsonProperty("t")]
        public float T { get; set; }

        [Newtonsoft.Json.JsonProperty("isRight")]
        public bool IsRight { get; set; }

        [Newtonsoft.Json.JsonProperty("expression")]
        public int Expression { get; set; }

        [Newtonsoft.Json.JsonProperty("limbs")]
        public List<LimbSample> Limbs { get; set; } = new List<LimbSample>();
    }

    internal sealed class LimbSample
    {
        [Newtonsoft.Json.JsonProperty("name")]
        public string Name { get; set; }

        [Newtonsoft.Json.JsonProperty("limbNum")]
        public int LimbNum { get; set; }

        [Newtonsoft.Json.JsonProperty("px")]
        public float Px { get; set; }

        [Newtonsoft.Json.JsonProperty("py")]
        public float Py { get; set; }

        [Newtonsoft.Json.JsonProperty("pz")]
        public float Pz { get; set; }

        [Newtonsoft.Json.JsonProperty("rotZ")]
        public float RotZ { get; set; }

        [Newtonsoft.Json.JsonProperty("scaleX")]
        public float ScaleX { get; set; }

        [Newtonsoft.Json.JsonProperty("scaleY")]
        public float ScaleY { get; set; }

        [Newtonsoft.Json.JsonProperty("sortingOrder")]
        public int SortingOrder { get; set; }

        [Newtonsoft.Json.JsonProperty("visible")]
        public bool Visible { get; set; }

        // —— v2 新增：sprite 视觉中心与元信息 —— //

        /// <summary>SpriteRenderer.bounds.center 转 Body 局部坐标后的 X（Unity 单位）。</summary>
        [Newtonsoft.Json.JsonProperty("bcx")]
        public float Bcx { get; set; }

        /// <summary>SpriteRenderer.bounds.center 转 Body 局部坐标后的 Y。</summary>
        [Newtonsoft.Json.JsonProperty("bcy")]
        public float Bcy { get; set; }

        /// <summary>当前 SpriteRenderer.sprite.name；可用于核对皮肤是否被替换。</summary>
        [Newtonsoft.Json.JsonProperty("spriteName")]
        public string SpriteName { get; set; }

        /// <summary>sprite 自身的归一化 pivot.x（0 = 左 / 0.5 = 中心 / 1 = 右）。</summary>
        [Newtonsoft.Json.JsonProperty("pivotU")]
        public float PivotU { get; set; }

        /// <summary>sprite 自身的归一化 pivot.y（0 = 下 / 0.5 = 中心 / 1 = 上）。</summary>
        [Newtonsoft.Json.JsonProperty("pivotV")]
        public float PivotV { get; set; }

        /// <summary>sprite 矩形宽（像素）。</summary>
        [Newtonsoft.Json.JsonProperty("spriteW")]
        public float SpriteW { get; set; }

        /// <summary>sprite 矩形高（像素）。</summary>
        [Newtonsoft.Json.JsonProperty("spriteH")]
        public float SpriteH { get; set; }
    }
}

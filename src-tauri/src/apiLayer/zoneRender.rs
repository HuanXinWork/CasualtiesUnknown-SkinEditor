// 合成预览上的区块灯光、粒子与序列帧动画叠加渲染（混合公式对齐 SkinSync `SkinPreviewZones`）。

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::accessories;
use crate::dataPaths;
use crate::imageOps;
use crate::skinLoader::{self, PartCategory};
use crate::zones;

use super::{categoryFromDir, partIdKey, PartSession};

fn resolveZonesPaths(
    skinRoot: &Path,
    skinName: &str,
    categoryDir: &str,
    renderedName: &str,
    basePart: &str,
) -> Option<(PathBuf, PathBuf)> {
    let m = zones::maskPath(skinRoot, skinName, categoryDir, renderedName);
    let c = zones::configPath(skinRoot, skinName, categoryDir, renderedName);
    if m.exists() {
        return Some((m, c));
    }
    if renderedName != basePart {
        let fbMask = zones::maskPath(skinRoot, skinName, categoryDir, basePart);
        if fbMask.exists() {
            let fbCfg = zones::configPath(skinRoot, skinName, categoryDir, basePart);
            return Some((fbMask, fbCfg));
        }
    }
    None
}

pub(super) fn renderZoneLightsForPart(
    canvas: &mut [u8],
    canvasW: u32,
    canvasH: u32,
    skinRoot: &Path,
    skinName: &str,
    categoryDir: &str,
    renderedName: &str,
    basePart: &str,
    partW: u32,
    partH: u32,
    centerX: i32,
    centerY: i32,
    rotationDeg: f32,
    flipX: bool,
    timeSec: f32,
) {
    let Some((maskFile, configFile)) =
        resolveZonesPaths(skinRoot, skinName, categoryDir, renderedName, basePart)
    else {
        return;
    };
    let Some((mw, mh, ids)) = zones::loadMask(&maskFile) else {
        return;
    };
    if mw == 0 || mh == 0 {
        return;
    }
    let cfg = zones::loadConfig(&configFile);
    if cfg.zones.is_empty() {
        return;
    }
    let geom = zones::computeGeometry(mw, mh, &ids);
    if geom.is_empty() {
        return;
    }

    let scaleX = partW as f32 / mw as f32;
    let scaleY = partH as f32 / mh as f32;
    let rad = -rotationDeg.to_radians();
    let cosT = rad.cos();
    let sinT = rad.sin();
    let halfW = partW as f32 * 0.5;
    let halfH = partH as f32 * 0.5;

    for z in &cfg.zones {
        let Some(light) = &z.light else {
            continue;
        };
        let Some(entry) = geom.iter().find(|g| g.0 == z.id) else {
            continue;
        };
        let lx = entry.1 * scaleX - halfW;
        let ly = entry.2 * scaleY - halfH;
        let fx = if flipX { -lx } else { lx };
        let wx = centerX as f32 + fx * cosT - ly * sinT;
        let wy = centerY as f32 + fx * sinT + ly * cosT;

        let outerPx = light.outerRadius * 8.0;
        let innerPx = light.innerRadius * 8.0;
        let intensity = if light.breathing {
            let phase = (timeSec * light.breathSpeed * std::f32::consts::TAU).sin();
            (light.intensity * (1.0 + phase * light.breathAmplitude)).max(0.0)
        } else {
            light.intensity
        };

        let dirRad = -light.direction.to_radians();
        let baseDx = dirRad.cos();
        let baseDy = -dirRad.sin();
        let dxFlipped = if flipX { -baseDx } else { baseDx };
        let dirX = dxFlipped * cosT - baseDy * sinT;
        let dirY = dxFlipped * sinT + baseDy * cosT;

        blendZoneLight(
            canvas,
            canvasW,
            canvasH,
            wx,
            wy,
            outerPx,
            innerPx,
            light.color,
            light.color2,
            intensity,
            &light.mode,
            dirX,
            dirY,
            light.spread,
            light.falloffPower,
        );
    }
}

/// 在 straight-alpha 画布上按预乘光强归一化叠加径向/定向/散射光，避免透明背景边缘发黑。
#[allow(clippy::too_many_arguments)]
fn blendZoneLight(
    canvas: &mut [u8],
    canvasW: u32,
    canvasH: u32,
    centerX: f32,
    centerY: f32,
    outer: f32,
    inner: f32,
    color: [u8; 4],
    color2: Option<[u8; 4]>,
    intensity: f32,
    mode: &str,
    dirX: f32,
    dirY: f32,
    spreadDeg: f32,
    falloffPower: f32,
) {
    if outer <= 0.0 || intensity <= 0.0 || canvasW == 0 || canvasH == 0 {
        return;
    }
    let lo = inner.clamp(0.0, outer);
    let outerSq = outer * outer;
    let x0 = (centerX - outer).floor().max(0.0) as i32;
    let y0 = (centerY - outer).floor().max(0.0) as i32;
    let x1 = (centerX + outer).ceil().min((canvasW - 1) as f32) as i32;
    let y1 = (centerY + outer).ceil().min((canvasH - 1) as f32) as i32;

    let r1 = color[0] as f32;
    let g1 = color[1] as f32;
    let b1 = color[2] as f32;
    let (r2, g2, b2) = match color2 {
        Some(c) => (c[0] as f32, c[1] as f32, c[2] as f32),
        None => (r1, g1, b1),
    };
    let alphaScale = color[3] as f32 / 255.0;
    let halfCos = ((spreadDeg.clamp(0.0, 360.0) * 0.5).to_radians()).cos();
    let isDirectional = mode == "directional" || mode == "scatter";
    let pow = falloffPower.max(0.1);

    for y in y0..=y1 {
        let dy = y as f32 - centerY;
        for x in x0..=x1 {
            let dx = x as f32 - centerX;
            let d2 = dx * dx + dy * dy;
            if d2 > outerSq {
                continue;
            }
            let d = d2.sqrt();
            let span = (outer - lo).max(0.001);
            let baseT = if d <= lo { 1.0 } else { 1.0 - (d - lo) / span };
            let mut t = baseT.powf(pow);
            let mix = if d <= lo {
                0.0
            } else {
                ((d - lo) / span).clamp(0.0, 1.0)
            };

            if isDirectional && d > 0.001 {
                let nx = dx / d;
                let ny = dy / d;
                let dot = nx * dirX + ny * dirY;
                if dot < halfCos {
                    continue;
                }
                let cone = ((dot - halfCos) / (1.0 - halfCos).max(0.001)).clamp(0.0, 1.0);
                if mode == "directional" {
                    t *= cone;
                } else {
                    t *= 0.7 + 0.3 * cone;
                }
            }

            let a = (intensity * t * alphaScale).clamp(0.0, 1.0);
            if a <= 0.0 {
                continue;
            }
            let cr = r1 * (1.0 - mix) + r2 * mix;
            let cg = g1 * (1.0 - mix) + g2 * mix;
            let cb = b1 * (1.0 - mix) + b2 * mix;

            let idx = ((y as usize) * (canvasW as usize) + (x as usize)) * 4;
            let da = canvas[idx + 3] as f32 / 255.0;
            let outA = (da + a * (1.0 - da)).clamp(0.0, 1.0);
            if outA <= 0.001 {
                continue;
            }
            let premulR = canvas[idx] as f32 * da + cr * a;
            let premulG = canvas[idx + 1] as f32 * da + cg * a;
            let premulB = canvas[idx + 2] as f32 * da + cb * a;
            canvas[idx] = (premulR / outA).clamp(0.0, 255.0).round() as u8;
            canvas[idx + 1] = (premulG / outA).clamp(0.0, 255.0).round() as u8;
            canvas[idx + 2] = (premulB / outA).clamp(0.0, 255.0).round() as u8;
            canvas[idx + 3] = (outA * 255.0).clamp(0.0, 255.0).round() as u8;
        }
    }
}

fn renderZoneParticles(
    canvas: &mut [u8],
    canvasW: u32,
    canvasH: u32,
    centerX: f32,
    centerY: f32,
    cfg: &accessories::ParticleConfig,
    timeSec: f32,
    seed: u32,
) {
    if cfg.rate <= 0.0 || cfg.lifetime <= 0.0 || canvasW == 0 || canvasH == 0 {
        return;
    }
    let active = ((cfg.rate * cfg.lifetime).ceil() as i32).clamp(1, 512);
    let sizePx = (cfg.startSize * 8.0).max(0.5);
    let shapeRadiusPx = if cfg.shapeRadius > 0.0 {
        cfg.shapeRadius * 8.0
    } else {
        4.0
    };
    let mode = cfg.mode.as_str();
    let speedPxPerSec = if cfg.speed > 0.0 {
        cfg.speed * 8.0
    } else {
        match mode {
            "fire" => 28.0,
            "water" => 36.0,
            "orbit" => 18.0,
            "star" => 0.0,
            _ => 12.0,
        }
    };
    let gravityPxPerSec2 = cfg.gravity * 80.0;
    let dirCenterRad = -cfg.direction.to_radians();
    let halfSpread = (cfg.spread.clamp(0.0, 360.0) * 0.5).to_radians();
    let endColor = cfg.endColor.unwrap_or([
        cfg.startColor[0],
        cfg.startColor[1],
        cfg.startColor[2],
        0,
    ]);
    let endScale = cfg.endSizeScale.max(0.01);

    for i in 0..active {
        let h = hashU32(seed.wrapping_add(i as u32));
        let phase = ((h & 0xFFFF) as f32) / 65536.0;
        let birth = phase * cfg.lifetime + (i as f32) / cfg.rate.max(0.0001);
        let age = (timeSec - birth).rem_euclid(cfg.lifetime);
        if age < 0.0 || age > cfg.lifetime {
            continue;
        }
        let lifeT = (age / cfg.lifetime).clamp(0.0, 1.0);
        let baseAlpha = match cfg.fadeCurve.as_str() {
            "constant" => 1.0,
            "easeOut" => (1.0 - lifeT).powf(0.5),
            "blink" => {
                (1.0 - lifeT) * (((lifeT * 6.0 * std::f32::consts::PI).sin() + 1.0) * 0.5)
            }
            _ => 1.0 - lifeT,
        };
        let alpha = baseAlpha.clamp(0.0, 1.0) * (cfg.startColor[3] as f32 / 255.0);
        if alpha <= 0.005 {
            continue;
        }
        let spreadFrac = ((h >> 16) as f32) / 65536.0 * 2.0 - 1.0;
        let angle = dirCenterRad + spreadFrac * halfSpread;
        let r0 = ((h ^ 0xA5A5_A5A5) & 0xFFFF) as f32 / 65536.0 * shapeRadiusPx;
        let (px, py) = match mode {
            "star" => (centerX + angle.cos() * r0, centerY + angle.sin() * r0),
            "fire" => {
                let sway = (age * 4.0 + (h & 0xFF) as f32 * 0.3).sin() * 2.0;
                let dy = -speedPxPerSec * age - 0.5 * gravityPxPerSec2 * age * age;
                (
                    centerX + angle.cos() * r0 + sway,
                    centerY + angle.sin() * r0 + dy,
                )
            }
            "water" => {
                let sway = (age * 3.0 + (h & 0xFF) as f32 * 0.2).sin() * 1.5;
                let dx = angle.cos() * speedPxPerSec * age;
                let dy = angle.sin() * speedPxPerSec * age + 0.5 * gravityPxPerSec2 * age * age;
                (centerX + r0 + dx + sway, centerY + dy)
            }
            "orbit" => {
                let omega = if cfg.speed > 0.0 { cfg.speed } else { 2.0 };
                let theta = angle + omega * age;
                let r = r0 + speedPxPerSec * age * 0.05;
                (centerX + theta.cos() * r, centerY + theta.sin() * r)
            }
            _ => {
                let vx = angle.cos() * speedPxPerSec;
                let vy = -angle.sin() * speedPxPerSec;
                (
                    centerX + r0 * angle.cos() + vx * age,
                    centerY + r0 * (-angle.sin()) + vy * age + 0.5 * gravityPxPerSec2 * age * age,
                )
            }
        };

        let r = cfg.startColor[0] as f32 * (1.0 - lifeT) + endColor[0] as f32 * lifeT;
        let g = cfg.startColor[1] as f32 * (1.0 - lifeT) + endColor[1] as f32 * lifeT;
        let b = cfg.startColor[2] as f32 * (1.0 - lifeT) + endColor[2] as f32 * lifeT;
        let curSize = sizePx * (1.0 + (endScale - 1.0) * lifeT);
        let halfSize = curSize * 0.5;
        let x0 = (px - halfSize).floor().max(0.0) as i32;
        let y0 = (py - halfSize).floor().max(0.0) as i32;
        let x1 = (px + halfSize).ceil().min((canvasW - 1) as f32) as i32;
        let y1 = (py + halfSize).ceil().min((canvasH - 1) as f32) as i32;
        if x1 < x0 || y1 < y0 {
            continue;
        }
        for y in y0..=y1 {
            for x in x0..=x1 {
                let idx = ((y as usize) * (canvasW as usize) + (x as usize)) * 4;
                let da = canvas[idx + 3] as f32 / 255.0;
                let dstFactor = da * (1.0 - alpha);
                let outA = (alpha + dstFactor).clamp(0.0, 1.0);
                if outA <= 0.001 {
                    continue;
                }
                canvas[idx] = ((r * alpha + canvas[idx] as f32 * dstFactor) / outA)
                    .clamp(0.0, 255.0)
                    .round() as u8;
                canvas[idx + 1] = ((g * alpha + canvas[idx + 1] as f32 * dstFactor) / outA)
                    .clamp(0.0, 255.0)
                    .round() as u8;
                canvas[idx + 2] = ((b * alpha + canvas[idx + 2] as f32 * dstFactor) / outA)
                    .clamp(0.0, 255.0)
                    .round() as u8;
                canvas[idx + 3] = (outA * 255.0).clamp(0.0, 255.0).round() as u8;
            }
        }
    }
}

fn hashU32(mut x: u32) -> u32 {
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    x.wrapping_add(0x9e37_79b9)
}

pub(super) fn renderZoneEffectsForPart(
    canvas: &mut [u8],
    canvasW: u32,
    canvasH: u32,
    skinRoot: &Path,
    skinName: &str,
    categoryDir: &str,
    renderedName: &str,
    basePart: &str,
    partW: u32,
    partH: u32,
    centerX: i32,
    centerY: i32,
    rotationDeg: f32,
    flipX: bool,
    timeSec: f32,
    sessions: &HashMap<String, PartSession>,
) {
    let Some((maskFile, configFile)) =
        resolveZonesPaths(skinRoot, skinName, categoryDir, renderedName, basePart)
    else {
        return;
    };
    let Some((mw, mh, ids)) = zones::loadMask(&maskFile) else {
        return;
    };
    if mw == 0 || mh == 0 {
        return;
    }
    let cfg = zones::loadConfig(&configFile);
    if cfg.zones.is_empty() {
        return;
    }
    let geom = zones::computeGeometry(mw, mh, &ids);
    if geom.is_empty() {
        return;
    }
    let scaleX = partW as f32 / mw as f32;
    let scaleY = partH as f32 / mh as f32;
    let rad = -rotationDeg.to_radians();
    let cosT = rad.cos();
    let sinT = rad.sin();
    let halfW = partW as f32 * 0.5;
    let halfH = partH as f32 * 0.5;

    for z in &cfg.zones {
        let Some(entry) = geom.iter().find(|g| g.0 == z.id) else {
            continue;
        };
        let lx = entry.1 * scaleX - halfW;
        let ly = entry.2 * scaleY - halfH;
        let fx = if flipX { -lx } else { lx };
        let wx = centerX as f32 + fx * cosT - ly * sinT;
        let wy = centerY as f32 + fx * sinT + ly * cosT;

        if let Some(p) = &z.particle {
            let mut seed = z.id as u32;
            for b in renderedName.as_bytes() {
                seed = seed.wrapping_mul(31).wrapping_add(*b as u32);
            }
            renderZoneParticles(canvas, canvasW, canvasH, wx, wy, p, timeSec, seed);
        }
        if let Some(a) = &z.animation {
            renderZoneAnimation(
                canvas,
                canvasW,
                canvasH,
                wx,
                wy,
                a,
                rotationDeg,
                flipX,
                timeSec,
                skinRoot,
                skinName,
                sessions,
            );
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn renderZoneAnimation(
    canvas: &mut [u8],
    canvasW: u32,
    canvasH: u32,
    centerX: f32,
    centerY: f32,
    cfg: &accessories::AnimationConfig,
    rotationDeg: f32,
    flipX: bool,
    timeSec: f32,
    skinRoot: &Path,
    skinName: &str,
    sessions: &HashMap<String, PartSession>,
) {
    if cfg.frames.is_empty() || cfg.fps <= 0.0 {
        return;
    }
    let total = cfg.frames.len() as f32;
    let phase = if cfg.loop_ {
        (timeSec * cfg.fps).rem_euclid(total)
    } else {
        (timeSec * cfg.fps).clamp(0.0, total - 1.0)
    };
    let idx = phase.floor() as usize;
    let Some(frameName) = cfg.frames.get(idx).map(String::as_str) else {
        return;
    };
    if !dataPaths::isValidSingleSegment(frameName) {
        return;
    }

    let categories: [&str; 4] = ["Body", "Head", "Wings", "Accessories"];
    let mut pixels: Option<(u32, u32, Vec<u8>)> = None;
    for cat in &categories {
        let catEnum: PartCategory = categoryFromDir(cat);
        let key = partIdKey(skinName, catEnum, frameName);
        if let Some(s) = sessions.get(&key) {
            pixels = Some((
                s.state.width,
                s.state.height,
                imageOps::flatten(&s.state),
            ));
            break;
        }
        let png = skinRoot
            .join(skinName)
            .join(cat)
            .join(format!("{}.png", frameName));
        if png.exists() {
            if let Ok(d) = skinLoader::decodePart(&png) {
                pixels = Some((d.width, d.height, d.pixels));
                break;
            }
        }
    }
    let Some((w, h, buf)) = pixels else {
        return;
    };
    imageOps::blitWithRotation(
        canvas,
        canvasW,
        canvasH,
        &buf,
        w,
        h,
        centerX.round() as i32,
        centerY.round() as i32,
        rotationDeg,
        flipX,
    );
}

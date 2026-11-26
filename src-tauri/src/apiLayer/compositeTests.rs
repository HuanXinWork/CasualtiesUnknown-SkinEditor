// `apiLayer` 静态角色合成与动作捕捉合成单元测试。

use super::motionComposite::buildMotionCompositeEntries;
use super::tests::{writeTinyPng, TempDir};
use super::*;
use crate::assemblyTable::{
    AssemblyEntry, AssemblyPosition, AssemblyTable, AssemblyVariants, HeadVariant, Orientation,
};
use std::fs;
use std::path::Path;

fn writeAssembly(path: &Path, parts: Vec<AssemblyEntry>) {
    let bytes = serde_json::to_vec(&AssemblyTable { parts }).unwrap();
    fs::write(path, bytes).unwrap();
}

fn writeRowPng(path: &Path, colors: &[[u8; 4]]) {
    let w = colors.len() as u32;
    let mut buf = image::RgbaImage::new(w, 1);
    for (x, c) in colors.iter().enumerate() {
        buf.put_pixel(x as u32, 0, image::Rgba(*c));
    }
    buf.save(path).unwrap();
}

fn pixelAt(result: &CompositeResult, x: u32, y: u32) -> [u8; 4] {
    let i = ((y * result.width + x) as usize) * 4;
    [
        result.pixels[i],
        result.pixels[i + 1],
        result.pixels[i + 2],
        result.pixels[i + 3],
    ]
}

fn bodyEntry(
    name: &str,
    zOrder: i32,
    flipX: bool,
    variants: Option<AssemblyVariants>,
) -> AssemblyEntry {
    AssemblyEntry {
        partName: name.into(),
        category: PartCategory::Body,
        position: AssemblyPosition { x: 0, y: 0 },
        zOrder,
        flipX,
        rotation: 0.0,
        variants,
    }
}

fn compositeOf(api: &CoreApi, root: &Path, orientation: Orientation) -> CompositeResult {
    api.getCompositeImage(CompositeParams {
        skinRoot: root.to_string_lossy().into_owned(),
        skinName: "st1".into(),
        orientation,
        expressionIndex: 0,
        headVariant: None,
        timeSec: 0.0,
        isRight: false,
    })
    .expect("composite")
}

#[test]
fn compositeReturnsHundredByHundredCanvas() {
    let tmp = TempDir::new();
    let bodyDir = tmp.path().join("st1").join("Body");
    fs::create_dir_all(&bodyDir).unwrap();
    writeTinyPng(&bodyDir.join("head.png"), [255, 0, 0, 255]);
    writeAssembly(
        &tmp.path().join("assembly.json"),
        vec![bodyEntry("head", 100, false, None)],
    );
    let api = CoreApi::new();
    let result = compositeOf(&api, tmp.path(), Orientation::Front);
    assert_eq!(result.width, 100);
    assert_eq!(result.height, 100);
    assert_eq!(result.pixels.len(), 40_000);
    assert_eq!(pixelAt(&result, 50, 50), [255, 0, 0, 255]);
    assert_eq!(pixelAt(&result, 0, 0), [0, 0, 0, 0]);
}

#[test]
fn compositeRespectsZOrder() {
    let tmp = TempDir::new();
    let bodyDir = tmp.path().join("st1").join("Body");
    fs::create_dir_all(&bodyDir).unwrap();
    writeTinyPng(&bodyDir.join("bottom.png"), [255, 0, 0, 255]);
    writeTinyPng(&bodyDir.join("top.png"), [0, 0, 255, 255]);
    writeAssembly(
        &tmp.path().join("assembly.json"),
        vec![
            bodyEntry("bottom", 10, false, None),
            bodyEntry("top", 100, false, None),
        ],
    );
    let api = CoreApi::new();
    let result = compositeOf(&api, tmp.path(), Orientation::Front);
    assert_eq!(pixelAt(&result, 50, 50), [0, 0, 255, 255]);
}

#[test]
fn compositeFlipsXWhenRequested() {
    let tmp = TempDir::new();
    let bodyDir = tmp.path().join("st1").join("Body");
    fs::create_dir_all(&bodyDir).unwrap();
    writeRowPng(
        &bodyDir.join("row.png"),
        &[[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]],
    );
    writeAssembly(
        &tmp.path().join("assembly.json"),
        vec![bodyEntry("row", 100, true, None)],
    );
    let api = CoreApi::new();
    let result = compositeOf(&api, tmp.path(), Orientation::Front);
    assert_eq!(pixelAt(&result, 49, 50), [0, 0, 255, 255]);
    assert_eq!(pixelAt(&result, 50, 50), [0, 255, 0, 255]);
    assert_eq!(pixelAt(&result, 51, 50), [255, 0, 0, 255]);
}

#[test]
fn compositeFiltersByVariants() {
    let tmp = TempDir::new();
    let bodyDir = tmp.path().join("st1").join("Body");
    fs::create_dir_all(&bodyDir).unwrap();
    writeTinyPng(&bodyDir.join("a.png"), [255, 0, 0, 255]);
    writeTinyPng(&bodyDir.join("b.png"), [0, 0, 255, 255]);
    writeAssembly(
        &tmp.path().join("assembly.json"),
        vec![
            bodyEntry(
                "a",
                100,
                false,
                Some(AssemblyVariants {
                    orientation: Some(Orientation::Front),
                    expressionIndex: None,
                    headVariant: None,
                }),
            ),
            bodyEntry(
                "b",
                100,
                false,
                Some(AssemblyVariants {
                    orientation: Some(Orientation::Back),
                    expressionIndex: None,
                    headVariant: None,
                }),
            ),
        ],
    );
    let api = CoreApi::new();
    let front = compositeOf(&api, tmp.path(), Orientation::Front);
    assert_eq!(pixelAt(&front, 50, 50), [255, 0, 0, 255]);
    let back = compositeOf(&api, tmp.path(), Orientation::Back);
    assert_eq!(pixelAt(&back, 50, 50), [0, 0, 255, 255]);
}

#[test]
fn compositePrefersSessionPixelsOverDisk() {
    let tmp = TempDir::new();
    let bodyDir = tmp.path().join("st1").join("Body");
    fs::create_dir_all(&bodyDir).unwrap();
    writeTinyPng(&bodyDir.join("head.png"), [255, 0, 0, 255]);
    writeAssembly(
        &tmp.path().join("assembly.json"),
        vec![bodyEntry("head", 100, false, None)],
    );
    let api = CoreApi::new();
    let loaded = api
        .loadPartImage(LoadPartParams {
            skinRoot: tmp.path().to_string_lossy().into_owned(),
            skinName: "st1".into(),
            category: PartCategory::Body,
            partName: "head".into(),
        })
        .expect("load");
    api.applyBrush(BrushParams {
        partId: loaded.partId,
        cx: 0,
        cy: 0,
        brushSize: 1,
        color: [0, 0, 255, 255],
    })
    .expect("brush");
    let result = compositeOf(&api, tmp.path(), Orientation::Front);
    assert_eq!(pixelAt(&result, 50, 50), [0, 0, 255, 255]);
}

#[test]
fn motionCompositeUsesBoundsCenterForTail() {
    let frame = MotionCaptureFrame {
        t: 0.0,
        isRight: false,
        expression: 0,
        limbs: vec![MotionCaptureLimb {
            name: "Tail".into(),
            limbNum: -1,
            px: 0.0,
            py: -0.353,
            pz: 0.0,
            rotZ: 18.0,
            scaleX: 1.0,
            scaleY: 1.0,
            sortingOrder: 0,
            visible: true,
            bcx: 0.25,
            bcy: -0.5,
            spriteName: "experimentTail".into(),
            pivotU: 0.5,
            pivotV: 0.5,
            spriteW: 56.0,
            spriteH: 20.0,
        }],
    };

    let entries = buildMotionCompositeEntries(&frame, 0, &None);
    let tail = entries
        .iter()
        .find(|(entry, _)| entry.partName == "experimentTail")
        .map(|(entry, _)| entry)
        .expect("tail entry");

    assert_eq!(tail.position.x, 2);
    assert_eq!(tail.position.y, 4);
    assert_eq!(tail.rotation, 18.0);
}

#[test]
fn motionCompositeAllowsExpressionAndHeadOverridesIncludingLockedIn() {
    let frame = MotionCaptureFrame {
        t: 0.0,
        isRight: false,
        expression: 6,
        limbs: vec![MotionCaptureLimb {
            name: "Head".into(),
            limbNum: 0,
            px: 1.0,
            py: 2.0,
            pz: 0.0,
            rotZ: 347.0,
            scaleX: 1.0,
            scaleY: 1.0,
            sortingOrder: 50,
            visible: true,
            bcx: 1.0,
            bcy: 2.0,
            spriteName: "experimentHeadBack".into(),
            pivotU: 0.5,
            pivotV: 0.5,
            spriteW: 30.0,
            spriteH: 26.0,
        }],
    };

    let entries = buildMotionCompositeEntries(&frame, 7, &Some(HeadVariant::Mouth));
    assert!(entries
        .iter()
        .any(|(entry, _)| entry.partName == "experimentHeadBackMouth"));
    assert!(entries
        .iter()
        .any(|(entry, _)| entry.partName == "experimentEyeLockedIn"));
    assert!(!entries
        .iter()
        .any(|(entry, _)| entry.partName == "experimentEyeHappy"));
}

#[test]
fn motionCompositeUsesUnsavedSessionPixels() {
    let tmp = TempDir::new();
    let bodyDir = tmp.path().join("st1").join("Body");
    fs::create_dir_all(&bodyDir).unwrap();
    writeTinyPng(&bodyDir.join("experimentUpTorso.png"), [255, 0, 0, 255]);

    let capturePath = tmp.path().join("motion.json");
    let capture = MotionCaptureFile {
        version: 3,
        modVersion: "1.0.0".into(),
        startedAtUnixMs: 0,
        playerName: "Body".into(),
        frameCount: 1,
        frames: vec![MotionCaptureFrame {
            t: 0.0,
            isRight: false,
            expression: 0,
            limbs: vec![MotionCaptureLimb {
                name: "UpTorso".into(),
                limbNum: 1,
                px: 0.0,
                py: 0.0,
                pz: 0.0,
                rotZ: 0.0,
                scaleX: 1.0,
                scaleY: 1.0,
                sortingOrder: 20,
                visible: true,
                bcx: 0.0,
                bcy: 0.0,
                spriteName: "experimentUpTorso".into(),
                pivotU: 0.5,
                pivotV: 0.5,
                spriteW: 1.0,
                spriteH: 1.0,
            }],
        }],
    };
    fs::write(&capturePath, serde_json::to_vec(&capture).unwrap()).unwrap();

    let api = CoreApi::new();
    let loaded = api
        .loadPartImage(LoadPartParams {
            skinRoot: tmp.path().to_string_lossy().into_owned(),
            skinName: "st1".into(),
            category: PartCategory::Body,
            partName: "experimentUpTorso".into(),
        })
        .expect("load part");
    api.applyBrush(BrushParams {
        partId: loaded.partId,
        cx: 0,
        cy: 0,
        brushSize: 1,
        color: [0, 0, 255, 255],
    })
    .expect("paint unsaved");

    let result = api
        .getMotionCompositeImage(MotionCompositeParams {
            skinRoot: tmp.path().to_string_lossy().into_owned(),
            skinName: "st1".into(),
            capturePath: capturePath.to_string_lossy().into_owned(),
            frameIndex: 0,
            expressionIndex: 0,
            headVariant: None,
            timeSec: 0.0,
        })
        .expect("motion composite");

    let i = ((50 * result.width + 50) as usize) * 4;
    assert_eq!(&result.pixels[i..i + 4], &[0, 0, 255, 255]);
}

#[test]
fn applyBaseSizeFitPreservesAspectForTallEarsAndHdParts() {
    let mut raw = HashMap::new();
    raw.insert("Head/experimentHeadBack".to_string(), (26, 12));
    let map = crate::baseSizes::BaseSizes::fromMap(raw);

    // 宽度等于基准宽度（26），高度扩展到 24 画高耳朵：必须原样保留 26x24，不得压扁成 26x12。
    let tallPx = vec![255u8; (26 * 24 * 4) as usize];
    let (w1, h1, px1) = super::composite::applyBaseSizeFit(
        &map,
        PartCategory::Head,
        "experimentHeadBack",
        "experimentHeadBack",
        26,
        24,
        tallPx.clone(),
    );
    assert_eq!((w1, h1), (26, 24));
    assert_eq!(px1.len(), tallPx.len());

    // 2x 高清高耳朵（52x48）：按宽度 26/52 = 0.5 等比缩回 26x24，仍保留 24 高度而非压扁到 12。
    let hdTallPx = vec![128u8; (52 * 48 * 4) as usize];
    let (w2, h2, px2) = super::composite::applyBaseSizeFit(
        &map,
        PartCategory::Head,
        "experimentHeadBack",
        "experimentHeadBack",
        52,
        48,
        hdTallPx,
    );
    assert_eq!((w2, h2), (26, 24));
    assert_eq!(px2.len(), (26 * 24 * 4) as usize);
}

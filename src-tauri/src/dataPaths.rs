// 便携模式路径解析、单段文件名安全校验与原子写盘工具。
#![allow(non_snake_case)]

use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

pub const APP_ROOT_ENV: &str = "SKIN_EDITOR_APP_ROOT";

/// 按 `SKIN_EDITOR_APP_ROOT` -> 可执行文件所在目录 -> 当前工作目录 -> `.` 解析应用根目录。
pub fn appRoot() -> PathBuf {
    if let Some(v) = std::env::var_os(APP_ROOT_ENV) {
        if !v.is_empty() {
            return PathBuf::from(v);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            return parent.to_path_buf();
        }
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

pub fn dataDir() -> PathBuf {
    appRoot().join("data")
}

pub fn skinDir(name: &str) -> PathBuf {
    dataDir().join("skin").join(name)
}

/// 相对路径基于 `appRoot()` 解析，绝对路径原样保留。
pub fn resolvePath(raw: &str) -> PathBuf {
    let p = PathBuf::from(raw);
    if p.is_absolute() {
        p
    } else {
        appRoot().join(p)
    }
}

pub fn resolveSkinRoot(skinRoot: &str) -> PathBuf {
    resolvePath(skinRoot)
}

pub fn workspaceFile() -> PathBuf {
    dataDir().join("workspace.json")
}

/// 校验名称是否为安全的单段文件名（禁止路径分隔符、`..`、控制字符、尾随空格/点及 Windows 保留设备名）。
pub fn isValidSingleSegment(name: &str) -> bool {
    if name.is_empty() || name == "." || name == ".." {
        return false;
    }
    if name.ends_with(' ') || name.ends_with('.') {
        return false;
    }
    if name.chars().any(|c| {
        c.is_control()
            || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
    }) {
        return false;
    }
    let mut comps = Path::new(name).components();
    if !matches!(comps.next(), Some(Component::Normal(_))) || comps.next().is_some() {
        return false;
    }
    let stem = name.split('.').next().unwrap_or(name);
    let upper = stem.to_ascii_uppercase();
    !matches!(
        upper.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

/// 先写入同目录临时文件并刷盘，再原子重命名替换目标文件，防止半截写入损坏数据。
pub fn atomicWrite(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    static TMP_SEQ: AtomicU64 = AtomicU64::new(0);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    let fileName = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("target");
    let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let tmpName = format!(".{}.tmp.{}.{}", fileName, std::process::id(), seq);
    let tmpPath = match path.parent() {
        Some(p) if !p.as_os_str().is_empty() => p.join(tmpName),
        _ => PathBuf::from(tmpName),
    };

    let writeRes = (|| -> std::io::Result<()> {
        let mut file = fs::File::create(&tmpPath)?;
        file.write_all(bytes)?;
        file.flush()?;
        Ok(())
    })();
    if let Err(e) = writeRes {
        let _ = fs::remove_file(&tmpPath);
        return Err(e);
    }

    if let Err(e) = fs::rename(&tmpPath, path) {
        let _ = fs::remove_file(&tmpPath);
        return Err(e);
    }
    Ok(())
}

/// 串行化改写 `SKIN_EDITOR_APP_ROOT` 的单元测试。
#[cfg(test)]
pub(crate) fn appRootEnvLock() -> std::sync::MutexGuard<'static, ()> {
    use std::sync::{Mutex, OnceLock};
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::MutexGuard;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            static SEQ: AtomicU64 = AtomicU64::new(0);
            let seq = SEQ.fetch_add(1, Ordering::Relaxed);
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let path = std::env::temp_dir().join(format!(
                "spe_dataPaths_{}_{}_{}",
                std::process::id(),
                nanos,
                seq
            ));
            fs::create_dir_all(&path).expect("create temp dir");
            TempDir(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn envLock() -> MutexGuard<'static, ()> {
        super::appRootEnvLock()
    }

    struct EnvGuard(&'static str, Option<std::ffi::OsString>);

    impl EnvGuard {
        fn set(key: &'static str, value: &Path) -> Self {
            let prev = std::env::var_os(key);
            std::env::set_var(key, value);
            EnvGuard(key, prev)
        }
        fn unset(key: &'static str) -> Self {
            let prev = std::env::var_os(key);
            std::env::remove_var(key);
            EnvGuard(key, prev)
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            match self.1.take() {
                Some(v) => std::env::set_var(self.0, v),
                None => std::env::remove_var(self.0),
            }
        }
    }

    #[test]
    fn envOverridesAppRoot() {
        let _lock = envLock();
        let tmp = TempDir::new();
        let _guard = EnvGuard::set(APP_ROOT_ENV, tmp.path());
        assert_eq!(appRoot(), tmp.path());
    }

    #[test]
    fn dataDirJoinsDataUnderAppRoot() {
        let _lock = envLock();
        let tmp = TempDir::new();
        let _guard = EnvGuard::set(APP_ROOT_ENV, tmp.path());
        assert_eq!(dataDir(), tmp.path().join("data"));
        assert_eq!(workspaceFile(), tmp.path().join("data").join("workspace.json"));
    }

    #[test]
    fn skinDirJoinsSkinNameUnderDataDir() {
        let _lock = envLock();
        let tmp = TempDir::new();
        let _guard = EnvGuard::set(APP_ROOT_ENV, tmp.path());
        assert_eq!(skinDir("st1"), tmp.path().join("data").join("skin").join("st1"));
    }

    #[test]
    fn fallbackWhenEnvAbsent() {
        let _lock = envLock();
        let _guard = EnvGuard::unset(APP_ROOT_ENV);
        let root = appRoot();
        assert!(!root.as_os_str().is_empty());
        let data = dataDir();
        assert!(data.starts_with(&root));
        assert_eq!(data.file_name().and_then(|s| s.to_str()), Some("data"));
    }

    #[test]
    fn singleSegmentValidationRejectsTraversalAndReservedNames() {
        assert!(isValidSingleSegment("exp"));
        assert!(isValidSingleSegment("R_experimentArm"));
        assert!(isValidSingleSegment("layer0.png"));
        assert!(!isValidSingleSegment(""));
        assert!(!isValidSingleSegment("."));
        assert!(!isValidSingleSegment(".."));
        assert!(!isValidSingleSegment("../secret"));
        assert!(!isValidSingleSegment("a/b"));
        assert!(!isValidSingleSegment("a\\b"));
        assert!(!isValidSingleSegment("C:foo"));
        assert!(!isValidSingleSegment("trailing."));
        assert!(!isValidSingleSegment("trailing "));
        assert!(!isValidSingleSegment("CON"));
        assert!(!isValidSingleSegment("nul.png"));
        assert!(!isValidSingleSegment("com1"));
    }

    #[test]
    fn atomicWriteReplacesExistingFile() {
        let tmp = TempDir::new();
        let target = tmp.path().join("nested").join("cfg.json");
        atomicWrite(&target, b"first").expect("first write");
        assert_eq!(fs::read(&target).unwrap(), b"first");
        atomicWrite(&target, b"second").expect("overwrite");
        assert_eq!(fs::read(&target).unwrap(), b"second");
    }
}

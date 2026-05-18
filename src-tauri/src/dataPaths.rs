// 便携模式路径解析。运行时配置与皮肤资源全部在 AppRoot/data/ 下。
// 测试通过 SKIN_EDITOR_APP_ROOT 环境变量覆盖 AppRoot。
#![allow(non_snake_case)]

use std::path::PathBuf;

pub const APP_ROOT_ENV: &str = "SKIN_EDITOR_APP_ROOT";

/// 解析顺序：环境变量 → current_exe().parent() → current_dir()。
/// 三步均失败时返回 "."，让上层有机会兜底而不 panic。
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

pub fn workspaceFile() -> PathBuf {
    dataDir().join("workspace.json")
}

/// 测试期共享互斥锁。所有改写 SKIN_EDITOR_APP_ROOT 的单测都需先持此锁，
/// 防止并行覆盖进程级 env。
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
    use std::fs;
    use std::path::Path;
    use std::sync::atomic::{AtomicU64, Ordering};
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
        assert_eq!(
            workspaceFile(),
            tmp.path().join("data").join("workspace.json")
        );
    }

    #[test]
    fn skinDirJoinsSkinNameUnderDataDir() {
        let _lock = envLock();
        let tmp = TempDir::new();
        let _guard = EnvGuard::set(APP_ROOT_ENV, tmp.path());
        assert_eq!(skinDir("st1"), tmp.path().join("data").join("skin").join("st1"));
        assert_eq!(
            skinDir("default"),
            tmp.path().join("data").join("skin").join("default")
        );
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
}

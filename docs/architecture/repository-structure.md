# 仓库结构

```text
AnimeUta/
  backend/                  # TypeScript + Fastify + SQLite 唯一后端
    src/migrations/         # 顺序执行的 SQLite 迁移
    src/routes/             # REST 路由
    data/                   # 本地数据库与媒体，忽略提交
  frontend/                 # Web、Tauri Windows 与 Capacitor 共享 React UI
    src/api/                # API 客户端
    src/components/         # 播放器、音乐、学习组件
    src/pages/              # 用户与管理页面
    src-tauri/              # Tauri 2 Windows 桌面客户端
    android/                # Capacitor Android 工程
    ios/                    # Capacitor iOS 工程
  docs/                     # 当前产品、架构、数据和 API 规范
  scripts/                  # Windows 一键启停、构建、清理、备份与恢复
  artifacts/                # Windows 客户端、安装包与 APK，忽略提交
  .build-cache/             # Gradle 等可再生成的编译缓存，忽略提交
  .codex-runtime/           # 本地进程 PID、日志及验收临时文件，忽略提交
```

仓库只保留 `backend/` 这一套正式后端。旧 Go + PostgreSQL 实现已经在迁移验证完成后移除；后端源码、SQLite 迁移和运行脚本不得再分叉出第二条实现。

运行时数据位于 `backend/data/`，不得提交。生产部署至少备份 SQLite 数据库、媒体目录和 `.env`。

Android SDK 与 JDK 属于机器级工具链，保留在项目外；项目产生的编译缓存和最终 APK 分别收敛到 `.build-cache/` 与 `artifacts/`。执行 `scripts/clean.ps1` 可删除所有可再生成的编译目录，同时默认保留依赖、业务数据和最终交付物。

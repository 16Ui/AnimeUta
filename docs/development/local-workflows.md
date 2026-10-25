# 本地工作流与详细操作

本文中的命令默认从仓库根目录执行。项目概览见 [README](../../README.md)。

AnimeUta 是一个面向个人和少量受邀好友的 ACG 日语歌曲学习应用。它把用户自己的音频与歌词整理成可播放、可注音、可翻译、可逐词学习的私人曲库。

## 技术结构

- `frontend/`：React + TypeScript，Web、Tauri Windows 客户端和 Capacitor Android/iOS 共用。
- `backend/`：TypeScript + Fastify 单体服务。
- SQLite：账号、曲库、歌词、任务和学习进度的唯一数据源。
- 本地私有媒体目录：音频通过临时签名和 Range 请求播放。
- 外部 OpenAI-compatible API：文本处理与语音转写均通过可配置服务调用。

不需要 PostgreSQL、Redis、Kafka 或 Docker 才能运行。

## 原音乐目录

本机曲库可直接引用原音频，避免在项目内再次复制整套音乐。在 `backend/.env` 配置 `AUDIO_LIBRARY_ROOTS=D:/Music/Vocaloid`；多个目录用分号分隔。服务端读取这些文件，通过原有签名播放接口提供给 Web、桌面和手机客户端，不向前端返回本机文件路径。

从 `backend` 目录运行 `npm run library:import -- --source=D:/Music/Vocaloid` 时，默认只建立音频引用并提取封面、歌词和标签。显式增加 `--copy-audio` 才复制音频。通过浏览器或手机上传的文件仍保存在 `backend/data/media`，因为服务端不能直接读取另一台设备的文件。

已导入的副本可用 `npm run library:link -- --apply` 按 SHA-256 匹配原文件、修改当前数据库与项目内完整备份的引用，并生成 `reports/storage` 清理清单；这一步不删除音频。确认播放正常后，在项目根目录运行 `scripts/clean-linked-audio.ps1 -ReportPath <清单路径>`，脚本再次校验原文件和副本后删除重复文件。找不到内容完全相同的原文件时保留原副本。删除引用型歌曲不会删除原目录音频。

备份清单记录外部音频的路径、大小和校验值；这些外部音频不会复制进备份。数据库、歌词、封面和学习数据仍按原方式备份。恢复到其他电脑时，需要单独准备原音乐目录并配置对应的文件引用。

## 本地启动

需要 Node.js 22.16 或更高版本。

Windows 可以从仓库根目录一键安装、迁移并启动：

```powershell
.\scripts\start-dev.ps1 -Install
```

首次安装会下载并校验 Tomoshi 开放日语词典，保存到 `backend/data/dictionaries/tomoshi-dict-open.db`。运行时只读访问该数据库；它不会被复制到业务数据库或三端客户端。

以后启动时可省略 `-Install`。停止服务：

```powershell
.\scripts\stop-dev.ps1
```

也可以分别启动前后端：

```powershell
cd backend
npm install
npm run dictionary:setup
Copy-Item .env.example .env
npm run migrate
npm run dev
```

另开终端：

```powershell
cd frontend
npm install
npm run dev
```

打开 `http://127.0.0.1:5173`。空数据库中的第一个注册账号自动成为 owner，项目没有默认演示账号。

## 三端调试

在仓库根目录运行统一调试入口：

```powershell
# 启动服务，同时打开浏览器 Web 和 Tauri 桌面客户端；有模拟器或手机时还会启动 Android 应用
.\scripts\debug.ps1

# 首次使用或依赖缺失时
.\scripts\debug.ps1 -Install
```

也可以只启动或打开指定目标：

```powershell
.\scripts\debug.ps1 -Target Services
.\scripts\debug.ps1 -Target Web
.\scripts\debug.ps1 -Target Desktop
.\scripts\debug.ps1 -Target Android

# 已有当前 APK 时跳过 Android 重建
.\scripts\debug.ps1 -Target Android -SkipAndroidBuild
```

桌面端是 Tauri 2 原生 Windows 客户端，不是浏览器 PWA。Android 可使用模拟器或实体手机，USB 不是必需条件；安装脚本会执行 `adb reverse tcp:8080 tcp:8080`。完整首次配置、单端调试、日志和故障排查见 [三端调试手册](three-client-debugging.md)。

## 验证

```powershell
.\scripts\verify.ps1
```

备份与恢复：

```powershell
.\scripts\backup.ps1 -Output D:\Backups\animeuta
.\scripts\restore.ps1 -Backup D:\Backups\animeuta
.\scripts\restore.ps1 -Backup D:\Backups\animeuta -RestoreEnvironment
```

备份使用 SQLite 在线 Backup API，可在 WAL 模式下生成一致数据库快照，并为数据库、每个媒体文件和存在的 `backend/.env` 记录 SHA-256。恢复操作会先验证清单和 SQLite 完整性，再通过同盘临时文件交换数据；损坏、缺失或安装失败不会覆盖现有数据。恢复脚本会先停止本地开发服务。默认保留当前 `.env`，只有显式增加 `-RestoreEnvironment` 才恢复备份配置；备份中可能包含密钥，应存放在受保护的位置。

AI 功能使用外部 OpenAI-compatible API，不安装或启动本地 Ollama/Whisper。请在 `backend/.env` 中设置 `LLM_BASE_URL`、`LLM_MODEL` 和 `LLM_API_KEY`。语音转写通过 `TRANSCRIPTION_BASE_URL`、`TRANSCRIPTION_MODEL` 和 `TRANSCRIPTION_API_KEY` 指向兼容 `/audio/transcriptions` 的服务；两个服务使用同一 Key 时可以省略 `TRANSCRIPTION_API_KEY`。未配置有效 API Key 时，音乐、歌词编辑和学习功能仍可正常使用，AI 任务会保留可解释的失败原因。

配置模型后，可先运行以下命令检查连通性、模型名称和结构化 JSON 能力；命令使用与正式服务相同的 `backend/.env`，不会输出 API Key：

```powershell
npm --prefix backend run ai:check
```

需要验收真实任务链路时运行：

```powershell
npm --prefix backend run ai:acceptance
```

该命令使用临时 SQLite 和媒体目录实际运行翻译、注音、批注、分词、对轴及转写，结束后自动清理，不会写入正式曲库。四类文本任务必须成功；未配置 Whisper-compatible provider 时，两个音频任务会保留稳定、可解释的失败结果。

发布前应使用一段自己持有的真实日语音频强制验收音频任务：

```powershell
$env:AI_ACCEPTANCE_AUDIO_PATH='D:\Music\sample.mp3'
$env:AI_ACCEPTANCE_REQUIRE_AUDIO='true'
npm --prefix backend run ai:acceptance
```

歌声识别会受伴奏、混音和演唱方式影响，转写结果始终作为可编辑歌词草稿，不会绕过人工确认直接发布。

Android/iOS 可以通过构建环境设置 `VITE_API_BASE_URL`，也可以在登录页的“服务端设置”中保存地址；真机不能使用指向设备自身的 `localhost`。局域网 HTTP 只建议用于开发，长期远程访问应使用 HTTPS 或可信私网。Capacitor 的 Android/iOS 默认来源已加入后端 CORS 配置。

可从 `frontend/.env.example` 创建 `frontend/.env.local`，再执行 `npm run mobile:sync`。移动端构建前必须把地址改成手机能够访问的服务端 HTTPS 地址。

Android 工程按 Capacitor 8 的 API 36 基线生成。使用 Android Studio 时需安装 2025.2.1 或更新版本及 Android SDK 36，IDE 会配置适配的 JDK；仅使用命令行时需准备 Android SDK 36 与 JDK 21。当前机器可直接构建并校验 debug APK：

```powershell
.\scripts\build-android.ps1
```

也可通过 `-SdkRoot` 与 `-JavaHome` 指定其他安装目录。Android SDK 与 JDK 是外部工具链，不复制进仓库；Gradle 缓存统一放在项目内的 `.build-cache/gradle`，最终产物位于 `artifacts/android/AnimeUta-debug.apk`。Windows 桌面端通过 `.\scripts\build-desktop.ps1` 构建到 `artifacts/desktop/`。iOS 构建需要 macOS 和 Xcode 26 或更新版本。当前 Web、Tauri、Android 和 iOS 已使用同一套 AnimeUta 图标。

连接一台已开启 USB 调试并授权的 Android 设备后，可构建、安装、映射本机后端端口并启动应用：

```powershell
.\scripts\install-android.ps1
```

该脚本通过 `adb reverse` 让 debug 应用访问 `http://127.0.0.1:8080`。Android 网络策略和 WebView 混合内容策略都只在可调试构建中放开；release 构建仍应使用 HTTPS。已经生成 APK 时可加 `-SkipBuild`。

## 清理生成文件

```powershell
# 清理可重新生成的前后端构建目录和编译缓存，保留 APK、依赖和业务数据
.\scripts\clean.ps1

# 服务停止后额外清理运行日志和临时测试文件
.\scripts\clean.ps1 -Runtime

# 运行中也可只清理已确认无用的旧验收资料
.\scripts\clean.ps1 -StaleTests

# 按需连同依赖或最终产物一起清理
.\scripts\clean.ps1 -Dependencies
.\scripts\clean.ps1 -Artifacts
```

完整自动化和本机验收结果见 [V1 验收记录](../planning/validation-report-v1.md)，详细设计见 [文档中心](../README.md)。

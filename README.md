<div align="center">
  <img src="frontend/public/animeuta-icon-192.png" width="96" height="96" alt="AnimeUta" />
  <h1>AnimeUta</h1>
  <p>把喜欢的歌，变成每天都想打开的日语学习材料。</p>
  <p>自托管曲库 · 同步歌词 · 假名与罗马音 · 逐词学习 · 跨端播放</p>
</div>

[![Original code: MIT](https://img.shields.io/badge/original_code-MIT-3b9b87)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.16-43853d)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-React_%2B_Fastify-3178c6)](#技术栈)

[快速开始](#快速开始) · [客户端](#客户端) · [文档](docs/README.md) · [反馈问题](https://github.com/161610/AnimeUta/issues) · [参与贡献](CONTRIBUTING.md)

---

AnimeUta 是面向个人和少量受邀用户的歌曲学习应用。浏览器、Windows 客户端和 Android 客户端连接同一个后端，共享曲库、歌单和学习数据。无需 PostgreSQL、Redis 或消息队列。

> 项目仍在持续迭代。源码可自行构建；各端安装包与网页发布节奏可能不同。在线平台能力取决于上游接口及你配置的音源，不保证所有歌曲都可播放或下载。

## 功能概览

| 模块 | 已实现能力 |
| --- | --- |
| 播放与曲库 | 收藏、播放历史、队列恢复、顺序/循环/随机播放、批量操作 |
| 歌词 | 同步滚动、中文翻译、假名、罗马音、字号、歌曲级时间偏移 |
| Windows 桌面歌词 | 透明浮窗、锁定与点击穿透、显示设置、可选半透明背景 |
| 歌单 | 私人/公共歌单、名称和封面编辑、批量加入、新建并加入 |
| 在线曲库 | 多平台歌曲/歌单搜索、聚合搜索、网易云昵称搜索与公开用户歌单 |
| 下载管理 | 自定义音源、按实际能力选择音质、批量下载、进度、取消、重试、重复检测、公共曲库入库 |
| 日语学习 | 逐词查询、生词与复习、词典、歌词学习与语法内容 |
| 可选 AI | 翻译、注音、词汇分析、歌词对齐与语音转写，通过外部兼容 API 调用 |

没有配置 AI 密钥也可以使用基础音乐、歌词编辑和学习功能。AI 输出需要人工检查，尤其是歌声转写和时间轴。

## 客户端

| 平台 | 方式 | 状态 |
| --- | --- | --- |
| Web | 桌面/手机浏览器 | 已支持 |
| Windows | Tauri 2，EXE 安装包与桌面歌词 | 已支持 |
| Android | Capacitor 8，APK | 已支持，需自行构建或由部署者提供 |
| iOS | Capacitor 工程 | 已提供工程，未完成实体设备验收；需要 macOS/Xcode |

部署者可以在网页 `/clients` 提供安装包和版本信息。仓库不包含 EXE、APK、音乐或运行数据库，也不提供默认公共账号。三端请配置同一个后端地址；不同部署实例的数据不会自动同步。

## 快速开始

### 环境要求

- Node.js **22.16 或更高**，建议使用受支持的 LTS 版本。
- npm、Git。首次安装依赖和日语词典需要联网。
- 仅运行 Web 不需要 Rust、Android SDK 或 Docker。

### Windows 一键启动

```powershell
git clone https://github.com/161610/AnimeUta.git
cd AnimeUta
.\scripts\start-dev.ps1 -Install
```

脚本会安装依赖、准备词典、生成本地媒体签名密钥并执行数据库迁移。
打开终端输出的地址，默认是 <http://127.0.0.1:5173>。以后可省略 `-Install`。

### 手动启动（Linux / macOS / Windows）

```bash
git clone https://github.com/161610/AnimeUta.git
cd AnimeUta
npm ci --prefix backend
npm ci --prefix frontend
cp backend/.env.example backend/.env
```

Windows PowerShell 使用 `Copy-Item backend/.env.example backend/.env`。
编辑 `backend/.env`，把 `MEDIA_SIGNING_SECRET` 替换为随机密钥；可用以下命令生成：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npm --prefix backend run dictionary:setup
npm --prefix backend run migrate
npm --prefix backend run dev
```

另开终端，在项目根目录运行：

```bash
npm --prefix frontend run dev
```

空数据库的第一个注册账号成为所有者。**务必先在本地或可信网络完成首个账号初始化，再开放公网访问。** 注册策略及邀请由部署者管理。

## 配置与数据

完整示例见 [`backend/.env.example`](backend/.env.example) 和 [`frontend/.env.example`](frontend/.env.example)。

| 配置 | 用途 |
| --- | --- |
| `DATABASE_PATH` / `MEDIA_ROOT` | SQLite 与上传/下载媒体的位置 |
| `MEDIA_SIGNING_SECRET` | 媒体访问签名密钥，必须私密保存 |
| `AUDIO_LIBRARY_ROOTS` | 可直接引用的本地音频目录，多个目录以分号分隔 |
| `APP_ORIGIN` | 允许访问后端的前端来源 |
| `REGISTRATION_MODE` | 注册策略：`open`、`invite`、`closed` |
| `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` | 可选文本 AI 服务 |
| `TRANSCRIPTION_BASE_URL` / `TRANSCRIPTION_MODEL` / `TRANSCRIPTION_API_KEY` | 可选语音转写服务 |
| `VITE_API_BASE_URL` | 前端构建时使用的后端地址 |

本地导入默认引用原音频，不复制整套音乐；上传与在线下载的媒体存入服务端媒体目录。外部音频引用不包含在数据库备份中，换机器时需要单独迁移原文件。具体流程见[本地工作流](docs/development/local-workflows.md)。

公网部署请使用 HTTPS，后端与数据库不直接暴露到公网。手机不能用 `localhost` 访问另一台电脑。参见[自托管部署](docs/development/self-hosting.md)和[安全说明](SECURITY.md)。

## 开发与构建

```bash
npm --prefix backend test
npm --prefix backend run build
npm --prefix frontend run build
node --test scripts/player-media.test.mjs
```

Windows 客户端与 Android 的环境准备、构建、安装和调试见[三端调试手册](docs/development/three-client-debugging.md)。

```powershell
.\scripts\build-desktop.ps1
.\scripts\build-android.ps1
```

产物写入 `artifacts/`，不提交到 Git。Android debug 包用于测试，公开分发前应配置自己的签名；Windows 签名也需要部署者自行配置。

### 技术栈

```text
Web / Tauri Windows / Capacitor Android
                    |
             Fastify + TypeScript
                    |
        SQLite + 媒体目录 + 只读日语词典
                    |
       可选外部 AI API / 在线音乐平台
```

前端使用 React、Vite、Zustand 和 TanStack Query。歌词偏好保存在用户级，歌词时间偏移保存在歌曲级。源码按 `frontend/`、`backend/`、`scripts/`、`deploy/` 和 `docs/` 分层。

## 贡献与反馈

提交问题时请提供平台、版本、复现步骤与脱敏日志。不要公开账号密码、令牌、私有曲库或音源密钥。
开发约定及验证方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。已知限制应如实写入 PR，避免只通过构建便声明三端验收完成。

## 许可与致谢

AnimeUta 原创代码采用 [MIT License](LICENSE)。**第三方代码和数据不因此改为 MIT**：洛雪目录模块保留 Apache-2.0 及其上游补充条款；日语词典、依赖及媒体分别适用自己的许可。详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

感谢 [LX Music](https://github.com/lyswhut/lx-music-desktop)、[Tomoshi Dictionary](https://github.com/tomoshi-app/tomoshi-dict-data) 及依赖项目。项目不附带音乐版权授权，请只导入、下载和分享你有权使用的内容。

README 的信息组织参考 [Navidrome](https://github.com/navidrome/navidrome) 和 [Koel](https://github.com/koel/koel)，未复制其产品文案或界面素材。

# AnimeUta 三端调试手册

本文说明如何在 Windows 上调试 AnimeUta 的三个正式客户端：

- Web：React 页面运行在浏览器中。
- Desktop：Tauri 2 原生 Windows 客户端，不是 PWA，也不是 Edge/Chrome 应用窗口。
- Android：Capacitor 原生 Android 应用，可运行在模拟器或实体手机中。

三端共用 frontend/src 的 React 业务界面，并访问同一个 TypeScript + Fastify 后端。后端使用 SQLite 和本地媒体目录，因此开发时必须先启动后端。

旧版曾提供 PWA。新版首次在浏览器打开时会自动注销旧 Service Worker 并清理旧静态缓存；如果 Windows 开始菜单中仍保留旧 PWA 图标，需要在 Edge/Chrome 的应用管理中手动卸载一次，之后使用 Tauri 客户端。

## 1. 目录与端口

~~~text
AnimeUta/
  backend/                    Fastify、SQLite、媒体和 AI 任务
  frontend/src/               三端共用 React 页面
  frontend/src-tauri/         Windows 桌面客户端
  frontend/android/           Android 客户端
  scripts/                    启动、构建和清理脚本
  .build-cache/               Rust、Cargo、Gradle 等可删除缓存
  .codex-runtime/             开发进程 PID 和日志
  artifacts/desktop/          Windows 可执行文件和安装包
  artifacts/android/          Android APK
~~~

| 服务 | 地址 |
| --- | --- |
| Web/Vite | http://127.0.0.1:5173 |
| 后端 API | http://127.0.0.1:8080 |
| 健康检查 | http://127.0.0.1:8080/api/v1/health |

## 2. 首次准备

所有命令都从仓库根目录运行：

~~~powershell
cd D:\develop\agent\Utau\AnimeUta
~~~

安装前后端依赖并创建开发配置：

~~~powershell
.\scripts\start-dev.ps1 -Install
.\scripts\stop-dev.ps1
~~~

这会安装 Node.js 依赖、下载并校验只读 Tomoshi 日语词典、从 backend/.env.example 创建 backend/.env，并执行 SQLite 迁移。词典保存在 `backend/data/dictionaries/tomoshi-dict-open.db`，不会打包到客户端。空数据库中的第一个注册账号会成为 owner，项目没有默认账号。

### 桌面工具链

首次构建 Tauri 桌面端需要 Rust、Microsoft C++ Build Tools 和系统 WebView2：

~~~powershell
.\scripts\setup-desktop.ps1
~~~

脚本把 Rust/Cargo 的主目录和编译缓存放在项目的 .build-cache/ 中。Microsoft C++ Build Tools 和 WebView2 是 Windows 机器级组件，无法放入仓库；脚本只在缺失时安装 C++ 工具。Windows 10/11 通常已经包含 WebView2。

### Android 工具链

命令行构建需要 JDK 21、Android SDK 36、Build Tools 和 Platform Tools。调试模拟器时还需要 Android Emulator 与一个 AVD。

当前脚本默认查找：

~~~text
JDK:         D:\develop\Java\microsoft-jdk-21
Android SDK: D:\develop\Android\Sdk
~~~

也可给脚本传入 -JavaHome 和 -SdkRoot。

## 3. 一键调试

首次运行：

~~~powershell
.\scripts\debug.ps1 -Install
~~~

日常运行：

~~~powershell
.\scripts\debug.ps1
~~~

该命令启动后端和 Vite，打开 Web，并启动 Tauri 桌面窗口。有正在运行的 Android 模拟器或已授权手机时，还会构建、安装并启动 Android 应用；没有设备时只跳过 Android，不影响另外两端。

按需只打开某一端：

~~~powershell
.\scripts\debug.ps1 -Target Services
.\scripts\debug.ps1 -Target Web
.\scripts\debug.ps1 -Target Desktop
.\scripts\debug.ps1 -Target Android
~~~

已有最新 APK 时可跳过 Android 重建：

~~~powershell
.\scripts\debug.ps1 -Target Android -SkipAndroidBuild
~~~

结束所有开发进程：

~~~powershell
.\scripts\stop-dev.ps1
~~~

## 4. Web 单独调试

~~~powershell
.\scripts\start-dev.ps1
~~~

浏览器打开 http://127.0.0.1:5173。React 修改会热更新。浏览器开发者工具可查看网络请求、控制台和布局。API 无响应时先直接访问健康检查地址。

## 5. Windows 桌面端单独调试

Tauri 开发窗口会加载本机 Vite 页面，但它是独立的 Windows 可执行进程。

终端一：

~~~powershell
.\scripts\start-dev.ps1
~~~

终端二：

~~~powershell
. .\scripts\desktop-env.ps1
npm --prefix frontend run desktop:dev
~~~

也可用一个脚本完成：

~~~powershell
.\scripts\start-desktop.ps1
~~~

首次配置工具链和依赖时：

~~~powershell
.\scripts\start-desktop.ps1 -Install
~~~

在桌面窗口中按 F12 可打开 WebView2 开发者工具。脚本后台启动时，日志位于 .codex-runtime/desktop.out.log 和 .codex-runtime/desktop.err.log。

播放歌曲后，点击底部播放器中的“桌面歌词”图标可显示或隐藏独立歌词窗口。该窗口默认置顶，拖动歌词区域可调整位置；当前句会随主播放器进度更新。桌面歌词只在 Tauri Windows 客户端中显示，Web 和 Android 不展示此按钮。

### 构建 Windows 客户端

先关闭正在运行的便携版 AnimeUta.exe，避免 Windows 锁定待覆盖的交付文件，然后执行：

~~~powershell
.\scripts\build-desktop.ps1
~~~

产物：

~~~text
artifacts/desktop/AnimeUta.exe
artifacts/desktop/AnimeUta-Setup.exe
~~~

AnimeUta.exe 是便携客户端，AnimeUta-Setup.exe 是 NSIS 安装程序。桌面客户端仍需要可访问的 AnimeUta 后端，因为数据库和媒体由后端统一管理；正式使用时应让后端随服务器开机启动，或先手动启动后端。

当前本地构建没有商业代码签名证书。安装包首次运行时可能出现 Windows SmartScreen 提示；个人设备可核对构建脚本输出的 SHA-256 后选择继续，公开分发前应配置正式代码签名。

## 6. Android 模拟器调试

USB 不是必需条件。推荐使用 Android Studio 的 Device Manager：

1. 安装 Android Studio、Android SDK 36 和 Android Emulator。
2. 打开 Tools > Device Manager。
3. 创建一个 API 36 的 Pixel 虚拟设备。
4. 点击启动按钮，等待系统桌面出现。
5. 在 PowerShell 中确认：

~~~powershell
D:\develop\Android\Sdk\platform-tools\adb.exe devices
~~~

应看到类似：

~~~text
emulator-5554    device
~~~

然后启动服务、构建、安装并打开应用：

~~~powershell
.\scripts\start-dev.ps1
.\scripts\install-android.ps1
~~~

脚本会执行 adb reverse tcp:8080 tcp:8080，因此模拟器中的 AnimeUta 可以继续使用 http://127.0.0.1:8080，无需改成 10.0.2.2。

查看 Android 日志：

~~~powershell
D:\develop\Android\Sdk\platform-tools\adb.exe logcat
~~~

只查看应用相关输出：

~~~powershell
D:\develop\Android\Sdk\platform-tools\adb.exe logcat chromium:V Capacitor:V AndroidRuntime:E '*:S'
~~~

## 7. Android 实体手机调试

实体手机与模拟器二选一即可。需要实体手机时：

1. 打开开发者选项和 USB 调试。
2. 用 USB 连接电脑并允许本机调试授权。
3. 运行 adb devices，确认状态为 device。
4. 运行：

~~~powershell
.\scripts\start-dev.ps1
.\scripts\install-android.ps1
~~~

adb reverse 只在连接期间有效，重新连接手机后需要再次运行安装脚本或手动执行端口映射。

### 构建 APK

无需连接手机或启动模拟器也能构建：

~~~powershell
.\scripts\build-android.ps1
~~~

产物为 artifacts/android/AnimeUta-debug.apk。

## 8. 三端 API 地址规则

| 场景 | 推荐 API 地址 |
| --- | --- |
| 同一电脑上的 Web | http://127.0.0.1:8080 |
| 同一电脑上的 Tauri | http://127.0.0.1:8080 |
| Android 模拟器 + adb reverse | http://127.0.0.1:8080 |
| USB 手机 + adb reverse | http://127.0.0.1:8080 |
| 未连接电脑的手机 | 后端电脑的局域网 IP 或 HTTPS 域名 |

Android/iOS 可在登录页的“服务端设置”中测试并保存地址。长期跨设备使用建议配置 HTTPS；debug APK 的明文 HTTP 仅用于本地调试。

## 9. 完整验证

~~~powershell
.\scripts\verify.ps1
.\scripts\build-desktop.ps1
.\scripts\build-android.ps1
~~~

推荐手工检查：

1. 三端使用同一账号登录。
2. 首页、搜索、歌曲详情和学习页均能加载。
3. 播放、暂停、拖动进度和音量记忆正常。
4. 歌词高亮只滚动歌词容器。
5. Android 能从系统文件选择器导入文件。
6. 桌面和 Android 能看到同一后端中的曲库与学习进度。

## 10. 常见问题

### cargo 或 rustc 找不到

~~~powershell
. .\scripts\desktop-env.ps1
rustc --version
cargo --version
~~~

仍找不到时重新运行 .\scripts\setup-desktop.ps1。

### Tauri 报 linker 或 link.exe 错误

重新运行 .\scripts\setup-desktop.ps1，确认 Microsoft C++ Build Tools 已安装 Desktop development with C++ 工作负载，然后重开终端。

### 桌面窗口空白

确认 http://127.0.0.1:5173 可访问，并查看 .codex-runtime/desktop.err.log。开发模式中的 Tauri 依赖 Vite；发布版使用内置的 frontend/dist。

### Android 找不到设备

先启动 AVD 或连接手机，再运行 adb devices。状态为 offline 时重启模拟器；状态为 unauthorized 时在手机上重新确认授权。

### Android 显示网络异常

重新运行 .\scripts\install-android.ps1 -SkipBuild 以恢复 adb reverse，并确认后端健康检查返回 200。

### 端口被占用

先执行 .\scripts\stop-dev.ps1。如果进程不是脚本启动的，再在任务管理器或对应终端中结束占用 5173/8080 的进程。

## 11. 清理

~~~powershell
.\scripts\stop-dev.ps1
.\scripts\clean.ps1 -Runtime
.\scripts\clean.ps1
~~~

按需清理依赖或最终交付物：

~~~powershell
.\scripts\clean.ps1 -Dependencies
.\scripts\clean.ps1 -Artifacts
~~~

backend/data/ 是正式 SQLite 和媒体数据，清理脚本不会删除它。

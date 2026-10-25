# Changelog

## 2026-09-09

- 导入器可识别 MP3 内嵌歌词中重复出现的日文、中文和罗马音时间轴，并按时间戳拆分写入原文、翻译和罗马音字段；普通单轨 LRC 保持原行为。
- AI 运行模式改为纯外部 OpenAI-compatible API；文本与语音转写可独立配置，开发启动不再自动运行本地 Ollama/Whisper。
- 默认 AI 配置不再回退到本机端口，并增加外部端点回归测试；API Key 仅保存在被 Git 忽略的 `backend/.env`。
- Android 原生返回键在子页面执行历史返回，在首页最小化应用以保留播放状态；软键盘显示时可靠收起底部播放器和导航。
- 接入 Capacitor App、Keyboard 与 System Bars，补齐旧版 Android WebView 安全区变量、全屏键盘 resize 和状态栏样式适配。
- Android 正式清单关闭系统云备份，避免私人会话和服务器地址进入设备云备份；明文 HTTP 仍只在 debug 构建中开放。
- 增加 Android 配置审计并接入全量验证，持续检查 SDK 目标、插件、返回键、键盘、安全区和网络边界。
- ACG 创作者详情和搜索不再将 `composer`、`person` 等内部类型作为副标题返回。
- 管理歌曲的创作者、角色和声优改为结构化编辑，不再要求用户填写 `composer`、`character_song` 等内部值。
- 图片编辑统一为预览、上传替换、外部地址和移除操作；内部短期签名地址不再显示，清空歌曲、艺人、作品或专辑图片会真实写回数据库。
- 搜索歌曲结果接入统一歌曲行，补齐封面、艺人、时长、详情入口和直接播放。
- 增加可校验、可重复执行的本地 `whisper.cpp` 与 FFmpeg 安装/启停脚本，并接入开发服务生命周期。
- 转写请求携带歌曲语言，兼容 OpenAI 顶层 words 与 `whisper.cpp` segment 内嵌 words。
- 增加真实音频强制 AI 验收模式；日语 MP3 已通过六类持久任务完整写回。

- 新增 `ai:check` 真实模型预检命令，使用正式配置验证 OpenAI-compatible provider 的连通性与结构化 JSON 响应。
- Android debug 构建允许通过 ADB 连接本机 HTTP 后端，并新增构建、端口反向映射、安装和启动真机应用的一键脚本；release 构建继续要求 HTTPS。
- 新增隔离的 `ai:acceptance` 真实任务验收，使用临时 SQLite 完整运行四类文本任务，并检查音频任务的成功或稳定 provider 失败，不污染正式曲库。
- 分词任务会在模型给出错误 UTF-16 偏移时按有序词面确定性校正；无法在原歌词中定位的词面仍会拒绝，且不会清除已有学习数据。

- Hardened single-machine backup and restore with checksummed environment configuration, explicit opt-in configuration restore, and tamper regression coverage.
- Replaced placeholder branding with AnimeUta Web, Tauri, Android and iOS icon/splash assets and added a cross-platform asset audit.
- Added a repeatable Android SDK 36/JDK 21 build script with APK signature and SHA-256 verification; produced the first validated debug APK.

## Unreleased

### Added

- TypeScript + Fastify + SQLite 单体后端及持久迁移。
- 邀请制账号、owner/admin/user 权限、不透明会话与刷新撤销。
- 私人歌曲智能导入、音频标签、嵌入封面/歌词、ZIP 匹配和临时文件清理。
- 私有签名音频 Range 播放、播放列表、循环、音量记忆和媒体按键控制。
- 歌词版本、LRC/SRT/TXT、双语、假名、罗马音、逐句时间与管理编辑。
- OpenAI-compatible 歌词转写、翻译、注音、对轴、批注和分词任务。
- ACG 作品、角色、声优、创作者、发行商、厂牌和歌曲版本聚合。
- 日语词元、词库、双向卡片、间隔复习、每日限制、朗读和来源跳转。
- Tauri Windows、Capacitor Android/iOS 工程与中日英界面。
- 登录页运行时服务端地址设置、Capacitor WebView CORS 支持与三语静态检查。
- 歌词 AI 任务稳定错误码，以及六种任务完成和失败状态的中日英本地化提示。
- 后端全部稳定错误码的中日英覆盖检查，以及跟随界面语言的绝对时间格式。
- 歌词选词支持一次事务写入多个词库，避免多请求造成部分成功。
- 学习分词、学习卡来源和歌词批注增加歌词版本级隐私隔离。
- 普通用户可在共享歌曲上运行个人 AI 任务，结果写入私人歌词草稿；任务查看、重试和运行中去重按请求者隔离。
- 歌曲封面、头像和 ACG 实体图片使用短期签名地址读取，移除本地图片目录的公开静态访问。
- ZIP 导入对所有条目执行路径、加密、类型和总解压体积校验。
- 个人歌单强制保持私有，旧的共享状态也不会允许其他账号读取。
- 歌曲与歌词发布只切换共享歌词版本，保留每位用户自己的当前私人歌词。
- 导入预览使用原子认领与事务提交，避免重复确认创建两首歌；失败和服务中断后可安全重试。
- 歌词与学习批注增加显式审核请求，私人及 AI 草稿不再自动出现在管理员队列，并支持按审核意见重新提交。
- 移动布局增加刘海屏安全区、动态视口高度与键盘聚焦避让，导入页补全 Opus/AAC 格式提示。
- PWA 受保护图片改为 NetworkOnly，并增加生成产物隐私审计，避免过期签名内容留在运行时缓存。
- 首位 Owner 判定、邀请码消费、账号与初始会话创建改为单事务串行提交，阻止并发注册产生多个 Owner 或超额使用邀请码。
- AI 分词增加逐行完整覆盖、UTF-16 偏移、原文切片和字段类型校验；非法结果不再清除已有分词，对轴更新也改为整批事务提交。
- 刷新令牌撤销与替代会话创建改为同一事务；替代会话创建失败时保留原会话，成功轮换后旧令牌不可重放。
- 六类 AI 任务的内容写回与任务成功状态改为同一事务，避免服务中断后重复生成歌词、批注或分词。
- Owner 账号禁止被降级，用户角色与状态值改为严格校验，禁用账号时同步撤销现有会话。
- 每日学习限制、连续学习和 AI 调用额度按用户 IANA 时区计算，并正确处理夏令时日界线。
- AI 任务查看与重试严格限制为请求者本人，输出范围在创建时固定；管理员只能通过显式审核入口读取他人的私人歌词和学习内容。
- 导入临时文件除启动清理外增加每小时清理，长期运行时也能回收过期预览，同时不重置正在提交的导入。
- 学习卡到期查询统一使用 SQLite 日期比较，避免数据库时间与 ISO 时间格式不同导致未来卡片提前出现。
- 备份改用 SQLite 在线 Backup API，并记录数据库与媒体文件 SHA-256；恢复会先暂存和校验，再原子交换数据库、WAL、媒体与可选配置，安装失败时恢复旧数据。

### Changed

- 主后端从 Go + PostgreSQL 迁移为轻量 TypeScript 单体 + SQLite。
- 普通用户导入默认私有，仅主动申请共享后进入审核。
- 移除绕过导入预览确认的旧歌曲直传接口，所有导入统一经过识别、修正和确认。
- 最低 Node.js 版本提升至 22.16，以使用运行时内置的 SQLite 在线备份能力。

### Removed

- Redis、Kafka、微服务和分布式基础设施规划。
- 音乐弹幕与未授权在线音源接入方向。

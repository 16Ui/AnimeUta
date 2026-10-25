# 自托管部署

本文描述通用部署流程，不包含维护者的服务器账号、IP、密码或私钥。

## 运行结构

建议使用 Linux、受支持的 Node.js LTS、Nginx 与 systemd。单实例后端使用 SQLite，无需另建数据库服务。将数据库、媒体和词典放在独立的持久化目录，避免更新源码时覆盖数据。

## 准备与首次启动

1. 安装依赖，复制 `backend/.env.example`，填写实际的数据库、媒体和词典路径。
2. 生成独立 `MEDIA_SIGNING_SECRET`，配置 `APP_ORIGIN` 与注册策略。生产配置不写入 Git。
3. 执行 `npm ci --prefix backend`、`npm ci --prefix frontend`。
4. 执行 `npm --prefix backend run dictionary:setup`、`npm --prefix backend run migrate`、`npm --prefix backend run build`。
5. 使用 `VITE_API_BASE_URL=https://music.example.com npm --prefix frontend run build` 构建前端，域名替换为自己的服务地址。
6. 通过受控网络启动 `backend/dist/server.js` 并初始化首个所有者账号；在开放公网前确认注册策略。
7. 配置 Nginx：静态根目录指向 `frontend/dist`，SPA 路由回退到 `index.html`；`/api/` 代理到仅监听回环地址的后端。保留 Range 头以支持音频拖动。
8. 配置 HTTPS 与续期，再开放所需 Web 端口。不要开放 SQLite、开发服务器或调试端口。

`deploy/animeuta.service` 和 `deploy/backend.env.example` 可作为部署布局参考，使用前核对路径、用户和权限；不要直接执行针对其他实例的一次性迁移或发布脚本。

## 更新与回滚

发布前先备份数据库、媒体、外部引用音频及配置，运行测试。为每个版本准备独立发布目录，依赖安装及构建成功后再切换服务指向，重启并检查健康状态、登录和音频播放。

代码回滚不等于数据库回滚。包含迁移的版本应先确认兼容性，必要时使用验证过的备份恢复；不要将生产数据库复制进 Git。

## 客户端与更新源

三端都连接同一后端地址。Web 更新后刷新页面；Windows 和 Android 若包含前端或原生代码变更，需要重新构建并分发安装包。

当前客户端更新源固定在源码中，尚未抽成部署配置。自行分发前须同时检查：

- `frontend/src/lib/clientUpdates.ts`
- `frontend/src-tauri/src/lib.rs`
- `frontend/android/app/src/main/java/app/animeuta/mobile/ClientUpdatesPlugin.java`
- `scripts/package-client-release.mjs` 与 `scripts/verify-client-release.mjs`

不要将自己的客户端指向不受自己控制的更新服务。安装包独立存放，不随源代码提交。

备份及本地音频引用的详细操作见 [本地工作流](local-workflows.md)。

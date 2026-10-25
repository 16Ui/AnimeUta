# ADR-001：采用 TypeScript 单体后端与 SQLite

- 状态：Accepted
- 日期：2026-09-09

## 背景

AnimeUta 最终只服务个人与极少量受邀好友，预计用户数不超过 10。产品复杂度主要来自音频、歌词、日语学习和多端体验，而不是并发与分布式吞吐。

## 决策

- 放弃 Go + PostgreSQL 主线。
- 使用 TypeScript + Fastify 单体后端。
- 使用 SQLite WAL 作为唯一权威数据库。
- 使用数据库任务表和应用内 Worker 处理 AI 任务。
- 默认使用本地私有媒体目录，保留对象存储适配空间。
- 前端通过 Tauri 与 Capacitor 复用同一套 React 代码。

## 后果

优点是部署只需要 Node.js、SQLite 文件和媒体目录，备份与迁移简单，前后端共享语言与数据契约。代价是单机写入能力与后台任务扩展性有限，但这符合真实使用规模。

Redis、Kafka、PostgreSQL、微服务和分布式锁不属于当前架构。只有在实际负载和运维证据证明必要时，才通过新的 ADR 引入。

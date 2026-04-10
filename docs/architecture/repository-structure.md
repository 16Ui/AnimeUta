# 仓库目录结构

## 目标

本文档将 AnimeUta 的目录规划正式化，用于指导后续项目骨架创建与模块落地。

## 根目录结构

```text
AnimeUta/
├─ frontend/                # React Web 用户端
├─ backend/                 # Spring Boot + MyBatis-Plus 服务端
├─ docs/                    # 正式设计文档与架构决策
├─ .context/                # 开发决策上下文与提交历史
├─ .claude/                 # AI 工具索引与本地配置
├─ agent-service/           # 后续独立 AI / Agent 服务
├─ mobile-app/              # 后续 React Native Android 客户端
└─ CLAUDE.md                # 项目蓝图摘要与 AI 快速上下文
```

## 第一阶段必须创建的目录

### `frontend/`
职责：
- 承载首页、搜索页、歌曲详情页、登录页、收藏页
- 承载全局底部播放器
- 承载三语界面与前端状态管理

### `backend/`
职责：
- 提供鉴权、用户、歌曲、作品、专辑、收藏、歌单、搜索 API
- 承载 PostgreSQL 数据访问逻辑
- 承载搜索聚合与业务规则

### `docs/`
职责：
- 作为正式规格文档目录
- 用于承载结构设计、数据库设计、API 规划与 ADR

## 后续保留但暂不落地的目录

### `agent-service/`
- 第一阶段只保留扩展位
- 后续用于承载元数据补全、自然语言搜索、内容生成等能力
- 不在 MVP 中实际创建代码骨架

### `mobile-app/`
- 第一阶段只保留扩展位
- 后续使用 React Native 进行 Android 客户端开发
- 不纳入当前 MVP 落地范围

## 目录落地原则

1. 先做 `frontend/`、`backend/`、`docs/`
2. 不为未来需求过早创建大量空目录
3. 结构以“够清晰、够扩展”为目标，不做过度设计
4. `CLAUDE.md` 保留蓝图摘要，`docs/` 承担正式规范职责

## 当前执行结论

本阶段正式认定：
- 一期主线目录：`frontend/`、`backend/`、`docs/`
- 后续扩展目录：`agent-service/`、`mobile-app/`
- 目录结构以 MVP 闭环优先，不提前引入额外基础设施目录

# AnimeUta 文档中心

本目录用于承载项目的正式规格文档。

## 文档角色分工

- `CLAUDE.md`：项目蓝图摘要、技术基线、LLM 快速上下文。
- `docs/`：团队协作主规范，后续设计、实现、审查都应以这里为准。
- `.context/`：记录决策过程、提交历史与工作流规则。

## 当前文档地图

### 架构设计
- [architecture/repository-structure.md](architecture/repository-structure.md) — 仓库目录结构与模块职责
- [architecture/module-boundaries.md](architecture/module-boundaries.md) — 前后端模块边界与职责划分

### 数据模型
- [data-model/database-schema-v1.md](data-model/database-schema-v1.md) — PostgreSQL 第一版数据库表结构
- [data-model/domain-model-v1.md](data-model/domain-model-v1.md) — 业务实体定义与领域关系说明

### 规划与决策
- [planning/mvp-roadmap-v1.md](planning/mvp-roadmap-v1.md) — MVP 阶段实施顺序与未决问题
- [adr/ADR-001-docs-and-db-v1.md](adr/ADR-001-docs-and-db-v1.md) — 本轮文档与数据库方案决策记录

## 推荐阅读顺序

1. 先看 [architecture/repository-structure.md](architecture/repository-structure.md)
2. 再看 [data-model/domain-model-v1.md](data-model/domain-model-v1.md)
3. 再看 [data-model/database-schema-v1.md](data-model/database-schema-v1.md)
4. 最后看 [planning/mvp-roadmap-v1.md](planning/mvp-roadmap-v1.md)

## 当前范围

本批文档只覆盖：
- 第一版项目目录结构
- 第一版数据库表结构
- MVP 实施顺序
- 当前关键架构取舍

本批文档暂不覆盖：
- 具体 API 字段细节
- 前后端代码骨架
- SQL migration 脚本
- Agent 服务具体实现

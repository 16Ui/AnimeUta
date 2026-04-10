# 后端 API V1 设计

## 文档目标

本文档用于定义 AnimeUta 第一版后端 API 清单，作为前后端协作边界。

当前目标是先把接口清单、职责和基本入出参方向定下来，不进入最终代码实现与 OpenAPI 细节。

## 设计原则

### 1. 风格
- 采用 RESTful 风格
- 路径使用资源名，不在路径里堆业务动词
- 返回结构尽量统一

### 2. 版本
第一版统一挂在：
- `/api/v1`

### 3. 响应结构建议

成功响应建议：

```json
{
  "data": {}
}
```

列表响应建议：

```json
{
  "data": [],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total": 100
  }
}
```

错误响应建议：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "参数不合法"
  }
}
```

### 4. 多语言内容策略
- UI 文案由前端 i18n 处理
- 内容字段由后端直接返回多语言字段
- 第一版不做“按请求语言只裁剪一个标题字段”的复杂逻辑
- 第一版优先直接返回 `title_ja`、`title_zh`、`title_en`、`title_romaji`

这样前端更容易接，也更适合你当前边做边学。

## API 模块划分

### `auth`
负责：
- 注册
- 登录
- 获取当前登录用户

### `user`
负责：
- 用户资料查询与更新
- 语言偏好维护

### `music`
负责：
- 歌曲列表
- 歌曲详情
- 艺人详情
- 专辑详情

### `work`
负责：
- 作品详情
- 作品关联歌曲列表

### `favorite`
负责：
- 收藏歌曲
- 取消收藏
- 获取收藏列表

### `playlist`
负责：
- 创建歌单
- 修改歌单
- 删除歌单
- 查询歌单
- 歌单内歌曲增删改序

### `search`
负责：
- 多语言搜索
- 搜索建议
- 分类搜索结果

## 一、认证与用户 API

### 1. 注册
`POST /api/v1/auth/register`

用途：
- 创建本地账号

请求体建议：
- `email`
- `password`
- `display_name`

响应核心字段：
- 用户 ID
- 基础资料
- 登录凭证（具体采用 JWT 还是 Session 还未最终定）

### 2. 登录
`POST /api/v1/auth/login`

用途：
- 用户登录

请求体建议：
- `email`
- `password`

响应核心字段：
- 用户信息
- 登录凭证

### 3. 获取当前用户
`GET /api/v1/auth/me`

用途：
- 获取当前登录用户的账户与资料信息

响应核心字段：
- `user_account`
- `user_profile`

### 4. 获取用户资料
`GET /api/v1/users/{id}`

用途：
- 获取指定用户公开资料

### 5. 更新我的资料
`PATCH /api/v1/users/me`

请求体建议：
- `display_name`
- `avatar_url`
- `bio`
- `preferred_language`
- `timezone`

## 二、歌曲与内容 API

### 1. 获取歌曲列表
`GET /api/v1/songs`

用途：
- 首页歌曲列表
- 通用歌曲分页列表

查询参数建议：
- `page`
- `page_size`
- `sort`
- `work_id`
- `artist_id`
- `album_id`
- `language_code`

响应字段建议：
- 歌曲基础信息
- 封面
- 主艺人摘要
- 作品摘要
- 是否已收藏（登录态下）

### 2. 获取歌曲详情
`GET /api/v1/songs/{id}`

用途：
- 歌曲详情页

响应字段建议：
- 歌曲基础信息
- 多语言标题
- 艺人列表
- 作品列表
- 专辑列表
- 收藏状态
- 音频来源信息

### 3. 获取艺人详情
`GET /api/v1/artists/{id}`

用途：
- 艺人详情页或艺人聚合信息

### 4. 获取作品详情
`GET /api/v1/works/{id}`

用途：
- 查看动画 / 游戏作品信息
- 承载该作品关联歌曲入口

### 5. 获取专辑详情
`GET /api/v1/albums/{id}`

用途：
- 查看专辑信息和曲目列表

## 三、搜索 API

### 1. 全局搜索
`GET /api/v1/search`

用途：
- 搜索页主入口

查询参数建议：
- `keyword`
- `page`
- `page_size`
- `type`（可选：song / artist / work / album）
- `language`

响应建议：
按类型分组返回：
- `songs`
- `artists`
- `works`
- `albums`

说明：
- 第一版先允许后端统一聚合返回
- 排序规则目前仍是未决问题，文档先保留为后续补充

### 2. 搜索建议
`GET /api/v1/search/suggestions`

用途：
- 搜索框联想

查询参数建议：
- `keyword`
- `limit`

响应建议：
- 建议词列表
- 可附带类型信息

## 四、收藏 API

### 1. 获取我的收藏歌曲列表
`GET /api/v1/me/favorites/songs`

用途：
- 收藏页

查询参数建议：
- `page`
- `page_size`

### 2. 收藏歌曲
`POST /api/v1/me/favorites/songs/{songId}`

用途：
- 将歌曲加入收藏

### 3. 取消收藏歌曲
`DELETE /api/v1/me/favorites/songs/{songId}`

用途：
- 取消收藏

## 五、歌单 API

### 1. 获取我的歌单列表
`GET /api/v1/me/playlists`

### 2. 创建歌单
`POST /api/v1/me/playlists`

请求体建议：
- `name`
- `description`
- `visibility`
- `cover_url`

### 3. 获取歌单详情
`GET /api/v1/playlists/{id}`

### 4. 更新歌单
`PATCH /api/v1/playlists/{id}`

### 5. 删除歌单
`DELETE /api/v1/playlists/{id}`

### 6. 向歌单添加歌曲
`POST /api/v1/playlists/{id}/songs`

请求体建议：
- `song_id`
- `position`（可选）

### 7. 从歌单删除歌曲
`DELETE /api/v1/playlists/{id}/songs/{songId}`

### 8. 调整歌单歌曲顺序
`PATCH /api/v1/playlists/{id}/songs/reorder`

请求体建议：
- 排序后的歌曲位置列表

## 六、播放历史 API

### 1. 上报播放历史
`POST /api/v1/me/play-history`

用途：
- 播放器上报播放行为

请求体建议：
- `song_id`
- `played_at`
- `play_duration_seconds`

### 2. 获取我的播放历史
`GET /api/v1/me/play-history`

用途：
- 最近播放列表

## 七、第一版建议暂不开放的 API

当前先不纳入 V1 主清单：
- 评论 / 乐评 API
- 推荐算法 API
- Agent 对话 API
- 后台管理录入 API
- 下载离线 API

## 八、与 PostgreSQL 设计的对应关系

这里顺手帮你建立一点数据库到接口的对应思路。

### 1. 为什么搜索 API 单独成模块
因为搜索后面会用到 PostgreSQL 的：
- `ILIKE`
- `pg_trgm`
- 可能的全文搜索

所以搜索逻辑不要散落在歌曲、艺人、作品接口里。

### 2. 为什么歌曲详情要聚合返回
因为数据库里本来就是：
- `song`
- `song_artist`
- `song_work`
- `album_song`

所以后端详情接口天然就是聚合接口。

### 3. 为什么收藏和歌单走 `/me/` 前缀
因为这些资源强依赖当前登录用户。

这在接口语义上会比到处传 `user_id` 更清晰。

## 九、当前未决问题

1. 登录凭证最终使用 JWT 还是 Session
2. 搜索结果排序规则
3. 歌曲详情里音频来源字段是否直接暴露完整 URI
4. 收藏范围第一版是否只做歌曲
5. 歌单是否允许重复歌曲
6. 是否要在歌曲列表中返回已收藏状态

## 十、下一步建议

在这份 API 文档之后，最适合继续做的是：

1. 选择数据库 migration 工具
2. 初始化 `backend/` 项目骨架
3. 按本 API 清单开始定义 Controller / DTO / VO
4. 初始化 `frontend/`，按页面逐步对接这些接口

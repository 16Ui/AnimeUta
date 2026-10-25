# AnimeUta HTTP API V1

Base URL：`http://127.0.0.1:8080/api/v1`。除 setup、注册、登录、刷新和带签名的媒体读取外，接口需要 `Authorization: Bearer <token>`。

成功响应通常为 `{ "data": ... }`，分页响应附带 `pagination`。失败响应为 `{ "error": { "code": "...", "message": "..." } }`。

## 账号

- `GET /setup/status`
- `POST /auth/register`、`POST /auth/login`、`POST /auth/refresh`、`POST /auth/logout`
- `GET /auth/me`、`PATCH /auth/me`、`PATCH /auth/password`
- `POST /admin/invites`、`GET /admin/users`、`PATCH /admin/users/{id}`

第一个注册账号自动成为 owner；之后默认需要邀请码。

## 导入与歌曲

- `POST /imports/inspect`：multipart，支持 `audio` + 可选 `lyrics_file`/`cover`，或单独 `bundle` ZIP。
- `POST /imports/{id}/commit`：确认标题和语言并加入私人曲库。
- `DELETE /imports/{id}`：放弃预览并清理临时文件。
- `GET /songs`、`GET /songs/{id}`、`GET /songs/{id}/stream?expires=&signature=`。
- `GET /media/images/{name}?expires=&signature=`：读取歌曲封面、头像和 ACG 实体图片。
- `POST /me/songs/{id}/share-request`：申请加入共享曲库。
- `POST /songs/{id}/audio`、`POST /songs/{id}/lyrics`。
- `GET /artists/{id}`、`GET /works/{id}`、`GET /albums/{id}`。
- `GET /acg/{kind}/{id}`：创作者、角色、声优、发行商、厂牌和歌曲版本组详情。

音频流支持 HTTP Range，音频和图片签名地址默认一小时有效。API 响应会把数据库中的本地图片路径转换为短期签名地址；音频与图片目录均不作为静态目录公开。

## 歌词与 AI

- `GET /songs/{id}/lyrics`、`GET /songs/{id}/lyrics/versions`。
- `POST /lyrics/{id}/share-request`、`POST /annotations/{id}/share-request`：由创建者明确提交私人歌词或批注审核。
- `PATCH /lyrics/{id}/lines`：管理员批量修改原文、翻译、罗马音和毫秒时间。
- `GET|POST /lyrics/{id}/annotations`。
- `GET|POST /songs/{id}/lyrics/jobs`。
- `POST /lyrics/jobs/{id}/retry`。

任务类型：`transcribe`、`translate`、`furigana`、`align`、`annotate`、`tokenize`。AI 返回格式不合法时任务失败并保留错误，不生成伪造结果。普通用户可以在可见的共享歌曲上创建个人任务；非转写任务会先复制为其私人歌词草稿，转写结果也默认私有。普通用户只能查看和重试自己的任务，不同请求者的同类个人任务可以并行；管理员任务维护共享歌词。私人 AI 结果不会自动出现在管理员审核队列，必须由请求者明确提交。任务响应中的 `errorCode` 是供客户端本地化的稳定错误码；`errorMessage` 是管理诊断信息，不应直接作为用户界面文案。

## 学习

- `GET /songs/{id}/study/words`、`POST /songs/{id}/study/tokenize`。分词接口先用 Kuromoji 提取基本形，再按基本形、读音和词性查询只读 Tomoshi 词典；仅词典未命中或义项有歧义时调用已配置的外部 LLM。响应的 `analysis` 返回本地词典、LLM 与未解析数量。
- `PATCH /study/lexemes/{id}`：保存当前用户对词语写法、平假名、罗马音、词性、释义和双语例句的私人修正。片假名是服务端词典匹配用内部字段，不作为学习界面的重复读音展示。
- `POST /study/cards`：在一个事务中将所选词语加入一个或多个词库。
- `GET|POST /study/decks`、`POST /study/decks/{id}/cards`。
- `GET|PATCH /study/preferences`。
- `GET /study/today`、`GET /study/review/next`、`POST /study/reviews`。

词语响应中的学习字段为 `reading`、`readingKatakana`、`romaji`、`partOfSpeech`、`meaningZh`、`meaningEn`、`exampleJa` 和 `exampleZh`；出现位置同时返回原歌词和翻译语境。复习卡的 `source.tokens` 返回例句中各词的原文区间、平假名、罗马音、词性和释义，供三端按分词结果显示逐词注音；`resolutionStatus` 区分已确定、待确认和词典未命中。卡片方向为 `ja_zh` 或 `zh_ja`，评分为 1 忘记、2 困难、3 良好、4 简单。

## 个人曲库与搜索

- 收藏：`GET|POST /me/favorites/songs`、`DELETE /me/favorites/songs/{id}`。
- 历史：`GET|POST /me/play-history`。
- 歌单：`GET|POST /me/playlists` 及歌曲增删、排序接口；歌单始终属于当前用户，客户端不能创建公共歌单。
- 搜索：`GET /search`、`GET /search/suggestions`。
- 搜索结果覆盖歌曲、艺人、作品、专辑、创作者、角色、声优、发行商、厂牌和版本组，并按当前账号的歌曲可见范围过滤。

## 管理

- `GET /admin/song-submissions`、`PATCH /admin/songs/{id}/review`。
- `PATCH /admin/songs/{id}/metadata`、`DELETE /admin/songs/{id}`。
- `PATCH /admin/acg/{kind}/{id}`：维护 ACG 实体的多语言名称、图片、简介、官网和别名。
- `PATCH /lyrics/{id}/review`、`POST /media/images`。上传接口返回稳定的受控存储路径，读取时由响应层生成短期签名地址。

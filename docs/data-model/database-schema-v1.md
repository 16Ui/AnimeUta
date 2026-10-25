# SQLite 数据模型 V1

权威结构是 `backend/src/migrations/*.sql`。数据库启用外键、WAL 和 busy timeout。

## 账号与权限

- `app_user`：邮箱、密码摘要、资料、语言、owner/admin/user 角色。
- `auth_session`：不透明 access/refresh token 的哈希、有效期与撤销状态。
- `invite_code`：使用次数、有效期与禁用状态。

## ACG 音乐模型

- `song`：多语言标题、时长、私有音频路径、封面、审核与可见性。
- `artist`、`work`、`album`：艺人、作品和专辑。
- `creator`、`acg_character`、`voice_actor`：创作者、角色与声优。
- `publisher`、`label`：发行商与厂牌。
- `song_version_group`：Full、TV Size、伴奏、Cover、OST 变奏聚合。
- 各关联表保存角色、关系类型、顺序和曲序。
- `song_alias`、`artist_alias`、`work_alias`、`album_alias` 以及各 ACG 实体 alias 表支撑中文、日文、英文、罗马音和别名搜索。
- 迁移 `009_acg_entity_profiles.sql` 为创作者、角色、声优、发行商、厂牌和版本组补齐图片、别名及缺失的多语言名称字段。

## 导入、歌词与 AI

- `import_session`：一次上传后的识别预览和提交状态；确认时先原子进入 processing，歌曲创建与 committed 状态在同一事务完成，中断状态在重启时恢复为可重试。
- `lyric`：歌词版本、来源、审核、当前版本和显式审核请求时间。
- `lyric_line`：逐句原文、翻译、ruby、罗马音和时间轴。
- `lyric_annotation`：词汇、语法、文化、翻译和时间批注；私人批注与明确提交审核分开记录。
- `lyric_processing_job`：transcribe/translate/furigana/align/annotate/tokenize 任务状态、输出、稳定错误码、原始诊断信息和重试。
- `lyric_token`、`lexeme`：Kuromoji 逐词位置、活用信息、可选时间和按基本形归并的词元；词元保存程序生成的平假名/罗马音、词性、选中的 Tomoshi 条目与义项、释义和歌词双语例句。片假名读音仅用于内部匹配。
- `user_lexeme_override`：用户对词元写法、读音、释义、词性与例句的私人修正，读取学习词汇和卡片时优先于共享词元。

Tomoshi 的完整只读词典独立保存在 `backend/data/dictionaries/tomoshi-dict-open.db`，不复制到主数据库。主数据库只保存歌词中实际出现的词元、最终选中的义项和用户修正；`dictionary_source`、`dictionary_entry_id`、`selected_sense_index`、`dictionary_version` 与 `resolution_status` 用于追踪解析来源。

## 学习与个人曲库

- `study_deck`、`study_card`、`review_log`、`study_preference`：词库、双向卡片、复习记录、每日限制与朗读设置。
- `user_favorite_song`、`playlist`、`playlist_song`、`play_history`：收藏、严格私有的个人歌单和历史。
- `search_keyword_stat`、`behavior_event`：当前用户常用搜索词和轻量行为记录。

## 数据约束

- 用户、歌曲、歌词等删除依赖外键级联清理。
- 媒体删除由服务在数据库事务完成后执行。
- 音频与本地图片路径必须是媒体根目录下的受控相对路径；API 读取时生成短期签名地址，不直接暴露目录。
- ZIP 导入对全部条目校验路径、加密状态、文件类型和总解压体积，而不只检查最终匹配到的文件。
- 管理审核队列只读取 `review_requested_at` 非空的歌词和批注；`pending` 本身不赋予管理员查看私人草稿的权限。
- 学习卡按用户、词库、词元和方向去重。
- 迁移只追加，不修改已发布迁移。

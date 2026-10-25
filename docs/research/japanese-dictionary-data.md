# 日语词典与歌词分词数据源调研

调研日期：2026-09-15。

## 结论

不存在一个成熟、开放并且能对每个日语词可靠提供全部学习属性的数据源。AnimeUta 最适合采用三层组合：

1. **Tomoshi 开放数据层**作为日中词典主数据，提供词形、JMdict 词条、词性、完整简繁中文释义、优先级、JLPT、频率、近义词语体说明和自他动词关系。
2. **Kuromoji.js**在导入歌词时完成语境分词，产生表层形、基本形、词性、活用、片假名读音和发音。
3. **歌词原句与已有翻译**直接作为学习例句，不要求通用词典为每个词提供脱离歌曲的例句；缺少翻译时再由外部 LLM 补齐。

平假名、片假名和罗马音不是三套独立词典数据。应以分词器或 JMdict 的假名读音为基准，通过确定性转换生成三种显示形式。需要精确到汉字的 ruby 对齐时再接 JmdictFurigana。

## 推荐数据源

### Tomoshi Dictionary Open Data

[Tomoshi 开放数据仓库](https://github.com/tomoshi-app/tomoshi-dict-data)发布一个可直接查询的 SQLite 数据库。当前版本包含约 21.7 万 JMdict 词条和词形索引，`zh_defs`、`zh_defs_zhtw` 覆盖全部词条的简繁中文释义，还包含 JLPT、频率、汉字、近义词语体说明、写法辨析和自他动词关系。项目 README 列出了各表及来源。

当前发布文件约 86 MB 压缩、650 MB 解压，例句和音调数据没有包含在开放数据库中。[2026-09-02 发布说明](https://github.com/tomoshi-app/tomoshi-dict-data/releases/tag/v2026-09-02)

许可证按表记录：除笔顺外主要为 CC BY-SA 4.0，`kanji_strokes` 为 CC BY-SA 3.0。应用若再分发这些数据，需要保留署名、许可证和相同方式共享的要求。[许可证说明](https://github.com/tomoshi-app/tomoshi-dict-data/blob/main/LICENSE.md)

风险：该开放仓库目前较新，中文释义中包含基于 JMdict 的衍生和 LLM 生成内容。AnimeUta 应固定使用已验证的 release 与 SHA-256，不跟随未审核的最新文件自动覆盖用户词条。

### JMdict 与 jmdict-simplified

JMdict 是日语多语言词汇数据库，适合作为稳定的词条标识、写法、读音、词性、语义和常用度基础。[EDRDG 项目主页](https://www.edrdg.org/wiki/Main_Page.html)

[scriptin/jmdict-simplified](https://github.com/scriptin/jmdict-simplified)把原始 XML 转成结构清晰的 JSON，并提供 TypeScript 类型和 loader，每周生成 release。名称中的 “simplified” 指简化 JSON 结构，不是“简体中文词典”。当前正式语言版本没有中文；带例句版本也只有英文，因此不能单独满足 AnimeUta 的中文释义需求。

它适合作为 Tomoshi 不可用时的保底源，或者用于校验 Tomoshi 中的 JMdict 词条编号与原始字段。

### Kuromoji.js

[Kuromoji.js](https://github.com/takuyaa/kuromoji.js)是可在 Node.js 直接运行的日语形态分析器。每个 token 可返回表层形、基本形、主词性与细分词性、活用类型、活用形、片假名读音和发音。它不需要 Python、Java 服务或联网，符合 AnimeUta 当前轻量 TypeScript 单体架构。

不足是其 IPADIC 词典偏旧，对新词、Vocaloid 曲名、角色名和特殊歌词写法可能切分不准。应用必须保留重新分词和人工合并/修正能力。

如果以后更看重分词质量，可以换成 [SudachiDict](https://github.com/WorksApplications/SudachiDict)。Sudachi 提供 Small、Core、Full 三种词典，Core 适合通用场景，采用 Apache 2.0；但在当前 Node 服务中通常需要额外运行 Python/JVM/Rust 绑定，部署复杂度高于 Kuromoji。

### 假名、罗马音与 ruby

[Kuroshiro](https://github.com/hexenq/kuroshiro)支持把日文转换成平假名、片假名和多种罗马字，并支持 furigana、okurigana 模式，许可证为 MIT。它可以配合 Kuromoji analyzer 使用。

[JmdictFurigana](https://github.com/Doublevil/JmdictFurigana)按 JMdict 写法和读音提供汉字到假名片段的对齐，适合生成 `<ruby>`，每月随 JMdict 更新。它不能替代歌词分词，也不能覆盖所有歌词中的未知词和特殊拼写。

### 例句

[Tatoeba](https://tatoeba.org/en/downloads)提供可下载的多语言句子和关联数据，但句子由社区贡献，许可证和质量需要按记录处理，且并非每个 JMdict 词义都有合适的日中例句。

AnimeUta 的学习目标是理解当前歌曲，因此优先使用词语在歌词中的原句和该句中文翻译作为例句。这样能保证每张由歌词生成的学习卡都有真实上下文，也能保留歌曲和时间位置。Tatoeba 只适合作为可选补充源。

## 字段归属

不要把所有属性都塞进 `lexeme`：

| 层级 | 保存内容 |
| --- | --- |
| 词典词条 | JMdict ID、写法、读音、多个词义、多个词性、标签、常用度、JLPT、关系 |
| 歌词 token | 表层形、实际基本形、当前语境词性、活用类型、活用形、字符位置、歌词行和时间 |
| 用户学习卡 | 当前选用词义、自定义释义、例句、个人笔记、学习方向和复习状态 |

同一个词可能有多个读音、词性和词义。导入时不能直接取第一项作为永久答案，应保留词典候选，并根据歌词 token 的读音、词性和上下文选择默认义项，允许用户切换。

## AnimeUta 落地方案

1. 把 Tomoshi release 下载到 `backend/data/dictionaries/tomoshi-dict-open.db`，以只读方式 ATTACH 或建立独立查询连接，不合并进主业务数据库，也不发送到 Web、桌面或 Android 客户端。
2. 增加 `dictionary_entry` 引用和 `lexeme_sense`，让一个词元可以关联多个词义，而不是继续把全部属性压成单列。
3. 用 Kuromoji 替换当前简易歌词切分；将片假名 reading 转为平假名，并生成 Hepburn 罗马音。
4. 以基本形、读音和词性查询 Tomoshi `forms`/`entries`，将最匹配的中文词义设为默认候选。
5. 使用歌词原句、翻译和时间作为例句；词典没命中或义项无法判定时才创建外部 LLM 补全任务。
6. 提供词典版本页和更新脚本，记录 release、SHA-256、许可证和导入时间；更新只替换只读词典，不覆盖用户修正。

## 最终选择

第一版采用 **Tomoshi SQLite + Kuromoji.js + Kuroshiro + 歌词原句**。这套方案不引入新服务，不要求联网查询，运行时仍然只有 AnimeUta 后端和现有 SQLite；约 650 MB 的词典文件只保存在服务端。JmdictFurigana 和 Tatoeba作为后续可选增强，不应阻塞第一版。

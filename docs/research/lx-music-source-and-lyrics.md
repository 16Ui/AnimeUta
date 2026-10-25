# LX Music 与 163MusicLyrics 的音源、歌词机制调研

调研日期：2026-09-08

调研基于以下上游版本：

- `lyswhut/lx-music-mobile`：`d2956044533150057d65bfeaf2ae0fb5179433f5`
- `jitwxs/163MusicLyrics`：`26d8a73471ea88ab6d4c97406853391b2fadad19`

本文只记录架构、数据流和对 AnimeUta 有用的设计结论，不记录可直接复现第三方私有接口、签名、Cookie、解密或音频提取的操作细节。

## 结论摘要

LX Music Mobile 并不是通过一个统一、稳定的官方音乐 API 完成全部功能。它把“搜索与歌曲元数据”“播放地址”“歌词”“封面”拆成不同能力：内置平台适配器负责搜索、元数据和部分歌词能力，实际播放地址主要通过用户导入的自定义来源脚本解析，再交给本地播放器。歌词优先读本地缓存，未命中时调用来源适配器，并可在失败时尝试匹配其他来源。

163MusicLyrics 是一个独立桌面应用，而不是可直接嵌入 TypeScript 项目的歌词 SDK。它使用统一的音乐提供方接口封装歌曲搜索、详情、播放链接和歌词，然后对原文、译文、音译、逐字时间信息进行标准化、组合、缓存和格式转换。其网易云实现直接适配网页/客户端使用的请求协议，因而与平台内部协议高度耦合。

两者最值得 AnimeUta 学习的是“来源适配层 + 统一歌词模型 + 本地缓存 + 失败降级”，而不是具体来源请求实现。

## LX Music Mobile

### 1. 来源能力分层

LX 为每个音乐来源提供统一入口，包含搜索、歌单、榜单、歌词、封面和播放地址等能力。以网易云适配器为例，`getMusicUrl` 与 `getLyric` 是两个独立调用：播放地址委托给可切换的 API 来源，歌词则由网易云歌词模块处理。[来源入口](https://github.com/lyswhut/lx-music-mobile/blob/d2956044533150057d65bfeaf2ae0fb5179433f5/src/utils/musicSdk/wy/index.js#L13-L28)

当前版本的内置播放 API 表为空，选择项以 `user_api` 开头时，从运行时的 `global.lx.apis` 读取用户导入来源。[API 来源选择](https://github.com/lyswhut/lx-music-mobile/blob/d2956044533150057d65bfeaf2ae0fb5179433f5/src/utils/musicSdk/api-source.js#L19-L55) 这说明应用核心与实际播放地址解析已经分离，项目本身并未在这一层内置一个稳定的官方播放服务。

自定义来源协议把能力声明为 `musicUrl`、`lyric`、`pic`，并同时声明支持的音质。[自定义来源类型](https://github.com/lyswhut/lx-music-mobile/blob/d2956044533150057d65bfeaf2ae0fb5179433f5/src/types/user_api.d.ts#L1-L18) 自定义脚本由原生模块加载，网络请求和脚本响应通过事件桥传递。[自定义来源桥接](https://github.com/lyswhut/lx-music-mobile/blob/d2956044533150057d65bfeaf2ae0fb5179433f5/src/utils/nativeModules/userApi.ts#L1-L72)

### 2. 音频播放数据流

高层数据流如下：

```text
歌曲对象 + 目标音质
  -> 查询本地播放地址缓存
  -> 调用当前来源的 getMusicUrl
  -> 获得临时播放地址
  -> 写入本地缓存
  -> 交给原生播放器
```

在线音乐模块先按“歌曲 ID + 音质”读取播放地址缓存，未命中或主动刷新时才请求来源；返回后再保存地址。[在线地址获取](https://github.com/lyswhut/lx-music-mobile/blob/d2956044533150057d65bfeaf2ae0fb5179433f5/src/core/music/online.ts#L42-L63) 本地数据层也明确以歌曲和音质为键保存地址。[本地地址缓存](https://github.com/lyswhut/lx-music-mobile/blob/d2956044533150057d65bfeaf2ae0fb5179433f5/src/utils/data.ts#L343-L349)

当当前来源解析失败且设置允许切换来源时，LX 会搜索其他平台上的同名歌曲，依次尝试可用音质和来源。[跨来源降级](https://github.com/lyswhut/lx-music-mobile/blob/d2956044533150057d65bfeaf2ae0fb5179433f5/src/core/music/utils.ts#L232-L326) 这是容错机制，但歌曲匹配主要依赖名称、歌手、专辑和时长，存在版本误配风险。

### 3. 歌词数据流

歌词同样先读取本地缓存；缓存不足时调用来源的 `getLyric`，随后保存统一的歌词对象。[在线歌词获取](https://github.com/lyswhut/lx-music-mobile/blob/d2956044533150057d65bfeaf2ae0fb5179433f5/src/core/music/online.ts#L83-L103) 本地同时保留原始歌词和用户编辑歌词，播放器优先使用编辑版本。[歌词缓存与编辑版本](https://github.com/lyswhut/lx-music-mobile/blob/d2956044533150057d65bfeaf2ae0fb5179433f5/src/utils/data.ts#L350-L382)

统一歌词对象能承载原文、翻译、罗马音以及逐字时间信息。获取失败时也可像音频一样尝试其他来源。[歌词来源降级](https://github.com/lyswhut/lx-music-mobile/blob/d2956044533150057d65bfeaf2ae0fb5179433f5/src/core/music/utils.ts#L415-L507) 播放器再根据当前播放位置驱动歌词时间轴，而不是让歌词模块自己计时。[歌词播放同步](https://github.com/lyswhut/lx-music-mobile/blob/d2956044533150057d65bfeaf2ae0fb5179433f5/src/core/lyric.ts#L39-L110)

### 4. 维护特征

- 播放地址通常是临时结果，缓存只能减少请求，不能消除失效与刷新问题。
- 平台协议变化会分别影响搜索、歌词、封面和地址解析，适配器需要持续维护。
- 跨来源匹配提高可用性，但 TV Size、Full Size、Cover、Live 等版本可能被错误匹配。
- 自定义脚本拥有发起网络请求的能力，需要可信来源、权限限制和隔离；对公开分发产品而言，这是明显的安全边界。

## 163MusicLyrics

### 1. 提供方接口

项目定义了 `IMusicApi`，统一抽象歌单、专辑、歌曲详情、歌曲链接、歌词和搜索。[提供方接口](https://github.com/jitwxs/163MusicLyrics/blob/26d8a73471ea88ab6d4c97406853391b2fadad19/cross-platform/MusicLyricApp/Core/Service/Music/IMusicApi.cs#L6-L52) 网易云和 QQ 音乐分别实现该接口，因此 UI、批量搜索和保存逻辑不直接依赖某个平台的响应结构。

`MusicCacheableApi` 在具体提供方外再包一层缓存，按来源和数据类型缓存搜索结果、歌曲、专辑、歌词与歌曲链接。[缓存装饰层](https://github.com/jitwxs/163MusicLyrics/blob/26d8a73471ea88ab6d4c97406853391b2fadad19/cross-platform/MusicLyricApp/Core/Service/Music/MusicCacheableApi.cs#L8-L80)

### 2. 获取与标准化

网易云适配器将原始响应转换成统一 `SongVo` 和 `LyricVo`。普通歌词模式可承载原文、中文译文和音译；逐字模式则处理更细粒度的时间信息。[网易云结果标准化](https://github.com/jitwxs/163MusicLyrics/blob/26d8a73471ea88ab6d4c97406853391b2fadad19/cross-platform/MusicLyricApp/Core/Service/Music/NetEaseMusicApi.cs#L68-L169)

搜索服务按来源批量查询歌曲，优先使用本地缓存，未命中时获取歌曲信息和歌词，再保存统一结果。[批量搜索流程](https://github.com/jitwxs/163MusicLyrics/blob/26d8a73471ea88ab6d4c97406853391b2fadad19/cross-platform/MusicLyricApp/Core/Service/SearchService.cs#L86-L157) 本地缓存采用每首歌一个 JSON 文件，并设置总容量上限，超限后按文件更新时间清理旧项。[本地文件缓存](https://github.com/jitwxs/163MusicLyrics/blob/26d8a73471ea88ab6d4c97406853391b2fadad19/cross-platform/MusicLyricApp/Core/Service/LocalSongCacheService.cs#L10-L145)

项目还将歌词获取和歌词输出分开：获取层形成统一对象，后续工具负责原文/译文组合、逐字时间处理以及 LRC/SRT 转换。README 列出了批量查询、目录导入、歌词保存、格式转换、翻译和本地缓存等能力。[项目能力说明](https://github.com/jitwxs/163MusicLyrics/blob/26d8a73471ea88ab6d4c97406853391b2fadad19/README.md#L7-L23)

### 3. 与平台协议的耦合

网易云底层实现并未使用公开、稳定的第三方 SDK，而是自行实现网页/客户端请求格式、请求参数处理和响应映射。因此其可用性取决于平台内部协议没有发生不兼容变化。本文不记录这些请求和签名细节。

这种实现的工程后果包括：

- 平台调整协议、风控、Cookie 或返回字段后需要升级客户端。
- 歌曲链接与歌词缓存可能过期或与地区、账户权益不一致。
- 桌面工具可容忍的失败率和人工重试，不一定适合服务端自动化产品。
- Apache-2.0 许可解决的是软件代码使用条件，不会同时授予第三方音乐、歌词或平台接口使用权。[项目许可证](https://github.com/jitwxs/163MusicLyrics/blob/26d8a73471ea88ab6d4c97406853391b2fadad19/LICENSE)

## 对 AnimeUta 的启示

AnimeUta 当前播放器把 `audioSourceUri` 直接交给浏览器 `<audio>`。如果未来接入任意合规在线来源，应先改成异步播放提供方模型，而不是继续扩展 URL 字段：

```text
MusicProvider
  search(query)
  getMetadata(providerTrackId)
  resolvePlayback(providerTrackId, quality)
  getLyrics(providerTrackId)

PlaybackResult
  kind: local | direct-url | official-sdk | external-open
  expiresAt
  sourceTrackId
```

歌词层应独立于播放层，并标准化为：原文、翻译、读音、逐行时间、逐词时间、来源和版本。日语学习模块只消费这个标准歌词模型，不关心歌词来自本地文件、授权 API 还是管理员录入。

可以直接借鉴的部分：

- 播放、歌词、封面能力分离。
- 提供方接口与统一领域对象。
- 临时播放结果带过期时间，失败时重新解析。
- 原文、译文、罗马音、逐字时间分轨保存。
- 缓存与获取逻辑分离。
- 跨来源匹配时使用版本类型、ISRC、时长和人工确认，避免只按歌名匹配。

不建议照搬的部分：

- 将第三方私有协议和签名逻辑写进 AnimeUta 后端。
- 在服务端保存用户平台 Cookie。
- 把临时歌曲链接当作永久 `audioSourceUri`。
- 允许未审查脚本直接执行任意网络请求。
- 将来源歌词不加版本和授权信息地写入公共数据库。

## 最终判断

从源码看，LX Music 的关键能力不是“一个现成网易云接口”，而是一套可插拔来源机制：平台模块负责目录与歌词，自定义来源负责补齐播放地址，缓存和跨来源重试负责维持体验。163MusicLyrics 则提供了更清晰的歌词提供方接口、标准化和格式转换管线。

这些模式适合用来重构 AnimeUta 的边界，但两者的网易云获取实现都不是稳定的官方第三方集成，维护成本、可用性和合规风险不会因为个人使用而消失。

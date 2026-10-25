# Third-party notices

The root MIT license covers original AnimeUta code and documentation. It does
not relicense third-party code, datasets, media, artwork, trademarks or music
source scripts. Their respective notices and terms continue to apply.

## LX Music catalogue adapters

- Upstream: https://github.com/lyswhut/lx-music-desktop
- Pinned revision: `ad95d5091c9ed689fa72b5e5c849df65f5a679ce`
- Location: `backend/vendor/lx/`
- License: [Apache License 2.0](backend/vendor/lx/LICENSE), with upstream
  [supplementary terms](https://lxmusic.toside.cn/desktop/license).
- Attribution and local changes: [vendor notice](backend/vendor/lx/NOTICE.md).

Do not interpret the root MIT license as permission to disregard these terms.
In particular, review the upstream supplementary terms before redistributing
or commercially using a build containing these modules.

## Japanese dictionary

The Tomoshi dictionary is downloaded separately and is not included in Git.
The tables used by AnimeUta identify CC BY-SA 4.0 and underlying JMdict/EDRDG
attribution in the dataset metadata. See the [dictionary notice](backend/data/dictionaries/README.md)
and [upstream dataset](https://github.com/tomoshi-app/tomoshi-dict-data).
Do not redistribute the database without its applicable attribution and terms.

## Dependencies and content

React, Fastify, Tauri, Capacitor, Lucide, Kuromoji, ts-fsrs and other dependencies
retain their individual licenses. Exact JavaScript dependency versions are
recorded in the two `package-lock.json` files; Rust dependencies are recorded
in `frontend/src-tauri/Cargo.lock`. Consult each package's license when
redistributing a compiled application.

Audio, lyrics, covers and imported music-source scripts are not licensed by
this repository. Only import, share or download content you are authorized
to use. A working download URL does not establish a right to redistribute it.

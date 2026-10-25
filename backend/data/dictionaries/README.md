# Tomoshi Dictionary Data

AnimeUta reads `tomoshi-dict-open.db` directly in SQLite read-only mode. The binary database is deliberately excluded from Git.

Run from `backend/`:

```powershell
npm run dictionary:setup
```

The setup script pins Tomoshi release `v2026-09-02` and verifies both compressed and uncompressed SHA-256 checksums. Runtime configuration can override the path with `TOMOSHI_DICTIONARY_PATH`.

The database is published by [tomoshi-app/tomoshi-dict-data](https://github.com/tomoshi-app/tomoshi-dict-data). Its `table_licenses` metadata identifies the `entries`, `forms`, and `zh_defs` data used by AnimeUta as CC BY-SA 4.0, derived from JMdict/EDRDG and Tomoshi Chinese definition work. See the source database for complete per-table attribution.

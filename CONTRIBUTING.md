# 参与贡献

感谢你帮助改进 AnimeUta。提交较大的功能前，请先在 Issue 中说明使用场景、影响平台和计划，避免重复实现。

## 本地开发

1. 按 [README](README.md#快速开始) 准备开发环境，使用测试数据库与媒体目录。
2. 从最新 `main` 创建功能分支，保持改动聚焦；不要混入构建输出或本机配置。
3. 修改共享接口时同步更新调用端和测试；数据库变更通过新迁移完成，不修改用户已有数据库。
4. 为新增行为补充测试，运行下面的验证，再提交 PR。

```bash
npm --prefix backend test
npm --prefix backend run build
npm --prefix frontend run build
node --test scripts/player-media.test.mjs
```

UI 改动还应检查桌面和手机宽度下的加载、空状态、错误、键盘操作与长文本。
涉及 Windows 原生窗口、Android 权限或更新安装时，说明实际测试的系统和设备；没有测试的平台请明确标注。

## 提交约定

- 使用 TypeScript，优先沿用现有组件、状态管理与服务边界。
- 每次提交只解决一组相关问题，例如 `fix: preserve playlist order`。
- PR 写明原因、变更、验证步骤和已知限制，界面改动可附脱敏截图。
- 不提交 `.env`、Cookie、API Key、数据库、音乐文件、用户数据或签名密钥。
- 不提交 `node_modules`、`dist`、构建缓存、EXE 或 APK；安装包应单独发布。
- 修改第三方适配器时保留版权声明，更新对应 NOTICE，不以项目 MIT 覆盖上游许可。

提交贡献意味着你有权提交这些改动，并同意原创贡献按本项目 MIT 许可发布；第三方内容仍受其原许可约束。

# ComfyUI-Civitai-Studio 项目约定

## 版本号 bump(改名)必须先经用户确认

- **不要在每次改动后默认重命名 `js/civitai_studio_app.js` 来 bump 版本号**(主文件为固定名,不再带 v0_X_Y 后缀;历史带版本号的副本已删除)。文件改名会导致 ComfyUI 重新加载模块、用户侧 UI 状态(画布上的浮层/面板)被重置。
- 只有用户在对话中**明确确认** bump(例如"bump 一下"/"发新版本")后才改名并同步更新 `docs/civitai-benchmark.md` 里的文件名引用。
- 日常改动后的缓存刷新,用不改名的方式(顺序执行):
  1. 让页面 `fetch(JS_URL, { cache: "reload" })` 刷新该 URL 的缓存条目;
  2. 再 `location.reload()`;
  3. 或直接让用户开新标签页打开 ComfyUI。
  背景与原理见 `docs/civitai-benchmark.md` 附二的 ZCode 内嵌浏览器缓存备忘(`persist:zcode-embedded-browser` 分区缓存、无用户开关)。
- 后端(`civitai_studio/*.py`)改动需要重启 ComfyUI 才生效,这一点不受本约定影响,照常提醒用户。

## 版本 bump 与发版必须经用户确认

- 以下动作每一项都要用户明确确认后才执行(平时只准备材料、给建议,不实际执行):
  1. 修改版本号(`pyproject.toml` / `civitai_studio/version.py` / JS 里的 `JS_VERSION`);
  2. 推送 `v*` tag(会触发 release.yml 自动打包并发布 GitHub Release);
  3. `comfy node publish` 上架 ComfyUI Registry(registry API key 在 `C:\Users\Ex_SL\.zcode\secrets\comfy_org_registry_api_key`)。
- 收到"发版/bump/确认"等明确指令后按当时流程执行,发版前核对 CHANGELOG 与版本号三处一致。

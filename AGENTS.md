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

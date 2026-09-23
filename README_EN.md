# ComfyUI Civitai Studio

A ComfyUI sidebar plugin: Civitai **online browser + local model manager + download queue**. Search models on Civitai, download them straight into your ComfyUI model folders, track installed versions, check for updates, locate/delete local files.

> Inspired by [ComfyUI-Civitai-Toolkit](https://github.com/BAIKEMARK/ComfyUI-Civitai-Toolkit) (MIT) and a private helper script (`civitai_pull.py`). A lightweight rewrite: no database, no full-library hash scanning, plus a **real download queue (resumable + SHA256 verified)**.

[中文说明](README.md) | **English**

**Contents**: [Features](#features) · [Compatibility](#compatibility) · [Install](#install) · [Usage](#usage) · [Networking](#networking-cn-users) · [API Key](#api-key) · [Data locations](#data-locations) · [Uninstall](#uninstall) · [License](#license)

## Features

- **🌐 Browse**: search Civitai (type / base model / sort / period / NSFW filters) with infinite scroll; installed models are badged; detail view with version switcher, trigger words, file list and preview gallery — click a preview to inspect generation params (prompt / sampler / seed / resources, one-click copy).
- **⬇ Download**: pick a target folder (auto-mapped by model type to checkpoints / loras / vae / controlnet etc.) + subfolder + filename; serial/parallel queue, live speed, **resumable downloads**, optional **SHA256 verification**; writes `<file>.civitai.json` metadata (version_id / trigger words / hash) on completion.
- **📁 Local library**: scan all local models by folder; search, reveal in Explorer, delete (with confirm), **check updates** (compares sidecar version_id against Civitai's latest — no giant-file hashing), one-click download of new versions into the same folder; **rename** (sidecar follows); **expand details** (cover / metadata / trigger words / description / files / copyable Model & Version IDs / refresh metadata); **manually associate** unlinked files (filename-based smart search or paste a link, pick the version to confirm).
- **⚙ Settings**: API key, HTTP proxy, API host, download concurrency, image-proxy toggle, SHA256 toggle, **description persistence toggle (default off)** (NSFW level is picked in the browse filter and remembered).

## Compatibility

- Requires a frontend with `extensionManager.registerSidebarTab` (any frontend after 2024-07; tested on **ComfyUI 0.37.0 / frontend 1.52.7**).
- Pure UI plugin, no custom nodes; Python deps are `aiohttp` (bundled with ComfyUI) + `aiohttp-socks` (installed with the release; the code still runs without it — only SOCKS proxies become unavailable, with a hint shown).

## Install

```bash
cd <ComfyUI>/custom_nodes
git clone <this repo> ComfyUI-Civitai-Studio
```

Restart ComfyUI — a **Civitai** icon (pi-images) appears in the left sidebar.

## Usage

1. Open the「Civitai」sidebar → 🌐 Browse, search a model → click a card for details →「⬇ Download」next to a file.
2. Pick the target folder (auto-mapped by type, adjustable) → start → progress on the「Download」tab.
3. Manage installed models on the「Local library」tab: check updates / details / associate / rename / reveal / delete.

### Networking (CN users)

- **Default API host is `civitai.red`** (following the upstream Toolkit repo's `civitai_pull.py` practice): full API + download endpoints, rarely blocked by Cloudflare; switch back to `https://civitai.com` in Settings if needed.
- Configure an **HTTP or SOCKS5 proxy** in Settings: bare addresses default to HTTP, `localhost` is rewritten to `127.0.0.1`. API, downloads and previews all go through the backend, so the proxy covers everything.
- SOCKS support needs `aiohttp-socks` (declared in requirements.txt; without it HTTP proxies still work and SOCKS shows an install hint).
- Occasional "returned a web page instead of JSON" = your proxy exit IP got a Cloudflare challenge; the plugin rebuilds the connection and retries 3 times — otherwise switch nodes.
- Search/detail time out after 30s; downloads have no total limit (only a 90s stall guard) and resume from `.part` files.

### API Key

Generate one at [civitai.com/user/account](https://civitai.com/user/account) and paste it in Settings. Needed for login-gated models, NSFW content and higher API rate limits. Stored in plaintext locally at `<user_dir>/civitai_studio/config.json`.

Note: **the key is only sent to official hosts (civitai.com / civitai.green)**; mirrors such as civitai.red reject civitai.com keys with a 403 (verified), so it is withheld there automatically. On download 401/403 the plugin automatically retries with the token and via the official host.

## Data locations

- Settings: `<ComfyUI>/user/civitai_studio/config.json`
- Model metadata: `<file>.civitai.json` next to each model file (travels with the file, shareable). With「description persistence」on it also holds `description_html` (capped at 51200 chars) / `tags` / `cover_url` so details work offline; the local library's detail view has a「Refresh metadata」action.
- Download temp files: `<target>/xxx.<hash>.part` (resumable; safe to delete any `*.part` when a job fails)

## Uninstall

Delete `custom_nodes/ComfyUI-Civitai-Studio`; settings live in `user/civitai_studio/` and can be removed too.

## License

MIT

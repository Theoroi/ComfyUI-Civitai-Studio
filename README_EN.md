# ComfyUI Civitai Studio

A ComfyUI sidebar plugin: Civitai **online browser + local model manager + download queue**. Search models on Civitai, download them straight into your ComfyUI model folders, track installed versions, check for updates, locate/delete local files.

> Inspired by [ComfyUI-Civitai-Toolkit](https://github.com/BAIKEMARK/ComfyUI-Civitai-Toolkit) (MIT) and a private helper script (`civitai_pull.py`). A lightweight rewrite: no external database dependency (a single-file local sqlite is managed automatically), no full-library hash scanning, plus a **real download queue (resumable + SHA256 verified)**.

[中文说明](README.md) | **English**

**Contents**: [Features](#features) · [Compatibility](#compatibility) · [Install](#install) · [Usage](#usage) · [Networking](#networking-cn-users) · [API Key](#api-key) · [Data locations](#data-locations) · [Uninstall](#uninstall) · [License](#license)

## Features

- **🌐 Browse**: search Civitai models (type / base model / sort / period / NSFW-level multi-select / hide paid), infinite scroll; installed models are badged, covers blur by model rating, and **hover carousels** cycle previews (interval configurable, ≤8 images preloaded on start, optional video autoplay); four card sizes (XS/S/M/L); the filter panel mirrors the gallery's layout; detail view with version switcher, trigger words, file list and preview gallery — click a preview to inspect generation params (prompt / sampler / seed / resources, one-click copy).
- **⬇ Download**: pick a target folder (auto-mapped by model type to checkpoints / loras / vae / controlnet etc.) + subfolder + filename; serial/parallel queue, live speed, **resumable downloads**, optional **SHA256 verification**; on completion the model metadata (version / trigger words / hash) goes into the local library — **no `.civitai.json` sidecar files are written anymore** (retired in v0.8.0).
- **📁 Local library**: scan all local models by folder; search, reveal in Explorer, delete (with confirm), **check updates** (compares the version_id recorded in the library against Civitai's latest — no giant-file hashing), one-click download of new versions into the same folder; **rename** and **move** (metadata lives in the library, nothing to carry along); **expand details** (cover / metadata / trigger words / description / files / copyable Model & Version IDs / refresh metadata); **manually associate** unlinked files (filename-based smart search or paste a link, pick the version to confirm).
- **⚙ Settings**: six collapsible groups — 🔑 Account & connection (API key / site mirror / HTTP·SOCKS5 proxy / image proxy) / 🧩 Models (real CDN thumbnail tiers 96/320/450, carousel interval & video autoplay) / ⬇ Download (concurrency / SHA256 toggle) / 💾 Storage & cache (disk cache limit 50-2000MB + clear cache / deep rescan) / 🧪 Experimental (favorites sync master switch, auto-sync, tag scraping, generation-data fallback — unofficial-API features live here) / Logs (debug logging, timestamp prefix).
- **🧩 Workflow nodes**: Civitai Image Search (thumbnail picker, tag filtering with numeric IDs and per-node OR/AND semantics; outputs positive / negative / trigger_words / local_checkpoint / image), LoRA Recipe, Show Text, Export with A1111 geninfo (IMAGE passthrough); a minimal verification workflow ships in `examples/image_search_verify.json`.
- **🖼 Gallery**: site-wide image feed filtered by base model / tag / period / NSFW-level multi-select / media type (image | video, server-side), six sorts (newest / oldest / most reactions / comments / collected / random) and six quick presets; file-format badges on cards; reopening the panel restores the last feed & filters; the lightbox shows generation params, category tags and license badges — images without embedded params fall back to Civitai's unofficial generation-data API for the checkpoint/LoRA chain (click to copy IDs); detail overlays and dialogs are resizable by dragging the right edge (remembered).
- **👁 NSFW masking**: top-bar 👁 toggles blur per rating (PG/PG-13/R/X/XXX, X/XXX by default, hover for a temporary peek); covers model covers, gallery & favorites grids, node thumbnails and the image overlay.
- **★ Favorites**: a dedicated Favorites tab (assets / models, groups, sorting, search) that **two-way syncs** with your Civitai account — model favorites read & write (SocialWrite scope needed), collections aligned with local groups (CollectionsRead/Write), image favorites follow collections; Civitai system collections (e.g. Liked Models) are read-only mirrors; per-item ratings are remembered so masking survives import/export; JSON import/export supported. The manual **Sync** button forces a **full enumeration** — items just saved on civitai.com appear immediately; auto-sync is incremental (the site's collection list lags by minutes, so brand-new collections take a few minutes to show up — known limit).
- **🏷 Tag tools**: scrape category tags (id + name) from the image page, accumulated into a local `tag_mapping.json` for filtering and autocomplete.

## Compatibility

- Requires a frontend with `extensionManager.registerSidebarTab` (any frontend after 2024-07; tested on **ComfyUI 0.37.0 / frontend 1.52.7**).
- Ships 4 custom nodes (Image Search / LoRA Recipe / Show Text / Export with A1111 geninfo); Python deps are `aiohttp` (bundled with ComfyUI) + `aiohttp-socks` (installed with the release; the code still runs without it — only SOCKS proxies become unavailable, with a hint shown).

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

- **Default API host is `https://civitai.com`**; if Cloudflare blocks you, switch「API host」in Settings to the mirror `https://civitai.red` (full API + download endpoints, rarely blocked by Cloudflare).
- Configure an **HTTP or SOCKS5 proxy** in Settings: bare addresses default to HTTP, `localhost` is rewritten to `127.0.0.1`. API, downloads and previews all go through the backend, so the proxy covers everything.
- SOCKS support needs `aiohttp-socks` (declared in requirements.txt; without it HTTP proxies still work and SOCKS shows an install hint).
- Occasional "returned a web page instead of JSON" = your proxy exit IP got a Cloudflare challenge; the plugin rebuilds the connection and retries 3 times — otherwise switch nodes.
- On Civitai overload (503) requests back off exponentially across 5 retries (0.5/1/2/4/8s, longer if the server sends Retry-After); the gallery additionally throttles client-side to 900ms, keeps rendered thumbnails on failure and shows a clickable retry banner.
- Search/detail time out after 30s; downloads have no total limit (only a 90s stall guard) and resume from `.part` files.

### API Key

Generate one at [civitai.com/user/account](https://civitai.com/user/account) and paste it in Settings. Needed for login-gated models, NSFW content and higher API rate limits. Stored in plaintext locally at `<user_dir>/civitai_studio/config.json`.

Note: **the key is sent to all Civitai hosts (civitai.com / civitai.green, plus the optional civitai.red mirror)** — mirrors accept civitai.com-issued Bearer keys too (verified 2026-09); leave the API key empty or skip the mirror if you don't want your key sent to it. On download 401/403 the plugin automatically retries with the token and via the official host.

## Data locations

- Settings: `<ComfyUI>/user/civitai_studio/config.json`
- Model metadata: kept in the local sqlite library (below) — **no** `<file>.civitai.json` sidecar next to model files anymore (retired in v0.8.0); leftovers from older versions can be deleted manually and are cleaned up automatically on rename.
- Download temp files: `<target>/xxx.<hash>.part` (resumable; safe to delete any `*.part` when a job fails)
- Cache & queue: `<ComfyUI>/user/civitai_studio/cache/` (cache.sqlite: fingerprints / favorites & groups / local-library associations / download jobs; media/: image-proxy cache, counted toward the cache limit)

## Uninstall

Delete `custom_nodes/ComfyUI-Civitai-Studio`; settings live in `user/civitai_studio/` and can be removed too.

## License

MIT

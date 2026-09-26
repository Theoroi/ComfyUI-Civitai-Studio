"""图片/视频内嵌生成数据解析 + 解析结果缓存(存储系统阶段4,设计 L3 media_meta).

背景:REST /api/v1/images 对部分条目 meta 脱敏(hasMeta:true 但 meta:null),
tRPC 同样拿不到 — 生成数据只能从文件内嵌段拿:
- PNG:tEXt/iTXt 块(prompt / workflow / parameters — ComfyUI 与 A1111 约定)
- MP4:QuickTime mdta 元数据(moov>udta>meta>keys+ilst,键 workflow/prompt/encoder)

缓存:cache_store kv,key "mm:"+normpath,payload {size,mtime,meta};
文件不变则命中(permanent 档),变更/删除自动失效。sqlite 不可用时退化为每次直读。

大文件注意:MP4 不整读,按 top-level box 定位 moov 再读入(通常几 MB);
PNG 交 PIL 按块解析,不解码像素。
"""

import json
import os

from . import cache_store


# ---------- MP4 mdta(标准 box 结构;lab 分支实测 ComfyUI 写入 workflow/prompt/encoder) ----------

def _iter_boxes(data, start, end):
    i = start
    while i + 8 <= end:
        size = int.from_bytes(data[i:i + 4], "big")
        typ = data[i + 4:i + 8]
        hdr = 8
        if size == 1:  # 64 位 largesize
            if i + 16 > end:
                return
            size = int.from_bytes(data[i + 8:i + 16], "big")
            hdr = 16
        elif size == 0:  # 到文件尾
            size = end - i
        if size < hdr or i + size > end:
            return
        yield typ, i + hdr, i + size
        i += size


def _parse_meta(data, start, end):
    """meta box(fullbox,调用方已跳过 4 字节 version/flags)内的 keys + ilst."""
    key_names = {}
    ilst_ranges = []
    for typ, s, e in _iter_boxes(data, start, end):
        if typ == b"keys":
            for kt, ks, ke in _iter_boxes(data, s, e):
                if kt == b"mdta":  # payload: 4B 索引 + 键名
                    idx = int.from_bytes(data[ks:ks + 4], "big")
                    key_names[idx] = data[ks + 4:ke].decode("utf-8", "replace")
        elif typ == b"ilst":
            ilst_ranges.append((s, e))
    out = {}
    for s, e in ilst_ranges:
        for typ, ks, ke in _iter_boxes(data, s, e):
            # mdta keyspace:ilst 子 box 的 type 字段就是键索引(4B 大端)
            name = key_names.get(int.from_bytes(typ, "big"), "")
            if name not in ("workflow", "prompt", "encoder"):
                continue
            for dt, ds, de in _iter_boxes(data, ks, ke):
                if dt == b"data":  # payload: 4B 类型指示 + 4B locale + 值
                    raw = data[ds + 8:de]
                    val = raw.decode("utf-8", "replace")
                    if name != "encoder":
                        try:
                            val = json.loads(val)
                        except ValueError:
                            pass  # 少见:非 JSON 文本,原样保留
                    out[name] = val
    return out or None


def _parse_moov(data):
    """data = moov box 的 payload(不含 box 头),找 udta>meta。"""
    for typ, s, e in _iter_boxes(data, 0, len(data)):
        if typ == b"udta":
            for typ2, s2, e2 in _iter_boxes(data, s, e):
                if typ2 == b"meta":
                    return _parse_meta(data, s2 + 4, e2)
    return None


def extract_mp4_bytes(data):
    for typ, s, e in _iter_boxes(data, 0, len(data)):
        if typ == b"moov":
            return _parse_moov(data[s:e])
    return None


def extract_mp4_file(path):
    """流式定位 moov(不整读大视频),moov 本体通常 < 几 MB。"""
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            end = f.tell()
            pos = 0
            while pos + 8 <= end:
                f.seek(pos)
                hdr = f.read(16)
                if len(hdr) < 8:
                    return None
                size = int.from_bytes(hdr[0:4], "big")
                typ = hdr[4:8]
                hdr_len = 8
                if size == 1:
                    if len(hdr) < 16:
                        return None
                    size = int.from_bytes(hdr[8:16], "big")
                    hdr_len = 16
                elif size == 0:
                    size = end - pos
                if size < hdr_len or pos + size > end:
                    return None
                if typ == b"moov":
                    if size > 64 * 1024 * 1024:
                        return None  # 异常大 moov:放弃
                    f.seek(pos + hdr_len)
                    return _parse_moov(f.read(size - hdr_len))
                pos += size
    except OSError:
        return None
    return None


# ---------- PNG(tEXt/iTXt) ----------

def extract_png_file(path):
    try:
        from PIL import Image
        with Image.open(path) as img:
            text = getattr(img, "text", None) or {}
        out = {}
        for k, v in text.items():
            if k in ("prompt", "workflow"):
                try:
                    out[k] = json.loads(v)
                except ValueError:
                    out[k] = v
            elif k == "parameters":
                out[k] = v
        return out or None
    except Exception:  # PIL 缺失/坏图/密码保护等:一律降级为无数据
        return None


# ---------- 缓存入口 ----------

def extract_from_bytes(data, ext):
    ext = (ext or "").lower()
    if ext == ".png":
        import io
        try:
            from PIL import Image
            with Image.open(io.BytesIO(data)) as img:
                text = getattr(img, "text", None) or {}
            out = {}
            for k, v in text.items():
                if k in ("prompt", "workflow"):
                    try:
                        out[k] = json.loads(v)
                    except ValueError:
                        out[k] = v
                elif k == "parameters":
                    out[k] = v
            return out or None
        except Exception:
            return None
    if ext in (".mp4", ".mov"):
        return extract_mp4_bytes(data)
    return None


def get_embedded(path):
    """取文件内嵌生成数据(带 kv 缓存,mtime/size 校验);无数据/损坏返回 None."""
    path = os.path.normpath(path)
    try:
        st = os.stat(path)
    except OSError:
        return None
    key = "mm:" + path
    rec = cache_store.kv_get(key)
    if (isinstance(rec, dict) and rec.get("size") == st.st_size
            and rec.get("mtime") == st.st_mtime):
        return rec.get("meta")
    ext = os.path.splitext(path)[1].lower()
    meta = None
    if ext == ".png":
        meta = extract_png_file(path)
    elif ext in (".mp4", ".mov"):
        meta = extract_mp4_file(path)
    cache_store.kv_put(key, {"size": st.st_size, "mtime": st.st_mtime, "meta": meta})
    return meta

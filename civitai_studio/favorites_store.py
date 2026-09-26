"""收藏系统存储(fav_items/fav_groups,sqlite)+ 旧 favorites.json 迁移 + 导入导出.

语义:
- toggle 开 = 活动行(dirty=1 待上推);关 = 墓碑(deleted=1, dirty=1)— 墓碑让
  同步能区分"本地刚取消"与"远端已取消",避免拉回循环;30 天后 purge。
- 冲突按 updated_at 最新者胜(upsert_remote 见函数内注释)。
- 所有函数为同步实现,调用方须在 bg 线程池执行(run_bg)。
sqlite 不可用时降级:读返回空,写静默丢弃(收藏功能退化为不可用但不报错)。
"""

import json
import os
import threading
import time

import folder_paths

from . import cache_store

KIND_MODEL = "model"
KIND_ASSET = "asset"

_LOCK = threading.RLock()
_TOMBSTONE_TTL = 30 * 86400.0


def _legacy_path():
    return os.path.join(folder_paths.get_user_directory(), "civitai_studio", "favorites.json")


def _row(r):
    return {
        "kind": r[0], "oid": r[1], "group_id": r[2], "name": r[3], "cover": r[4],
        "added_at": r[5], "updated_at": r[6], "src": r[7], "dirty": r[8],
        "deleted": r[9], "extra": json.loads(r[10]) if r[10] else None,
    }


_COLS = "kind, oid, group_id, name, cover, added_at, updated_at, src, dirty, deleted, extra"


def _conn():
    cache_store.init()
    return cache_store._CONN


def _migrate_legacy():
    """旧 favorites.json(图片 id 列表)一次性导入;旧文件按设计保留只读不删."""
    conn = _conn()
    if conn is None:
        return
    try:
        done = cache_store.kv_get("fav:migrated_v1")
        if done:
            return
        try:
            with open(_legacy_path(), encoding="utf-8") as f:
                ids = json.load(f)
        except (OSError, ValueError):
            ids = []
        now = time.time()
        if isinstance(ids, list) and ids:
            conn.executemany(
                "INSERT OR IGNORE INTO fav_items(kind, oid, group_id, name, cover, added_at,"
                " updated_at, src, dirty, deleted, extra) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                [("asset", str(x), None, None, None, now, now, "local", 0, 0, None)
                 for x in ids if str(x).strip()][:5000],
            )
            conn.commit()
        cache_store.kv_put("fav:migrated_v1", True)
    except Exception as e:  # 迁移失败不致命:旧文件还在,下轮再试
        print("[Civitai-Studio] 旧收藏迁移失败(下轮重试):", e)


def list_items(kind=None, group_id=None, include_deleted=False):
    conn = _conn()
    if conn is None:
        return []
    _migrate_legacy()
    with _LOCK:
        try:
            sql = f"SELECT {_COLS} FROM fav_items WHERE 1=1"
            args = []
            if not include_deleted:
                sql += " AND deleted=0"
            if kind:
                sql += " AND kind=?"
                args.append(kind)
            if group_id:  # 空串表示"未分组":group_id IS NULL
                sql += " AND group_id=?" if group_id != "_" else " AND group_id IS NULL"
                if group_id != "_":
                    args.append(group_id)
            rows = conn.execute(sql + " ORDER BY updated_at DESC", args).fetchall()
            return [_row(r) for r in rows]
        except Exception as e:
            print("[Civitai-Studio] 收藏读取失败:", e)
            return []


def get_item(kind, oid):
    conn = _conn()
    if conn is None:
        return None
    with _LOCK:
        try:
            r = conn.execute(
                f"SELECT {_COLS} FROM fav_items WHERE kind=? AND oid=?", (kind, str(oid))
            ).fetchone()
            return _row(r) if r else None
        except Exception:
            return None


def is_active(kind, oid):
    it = get_item(kind, oid)
    return bool(it and not it["deleted"])


def toggle(kind, oid, fields=None):
    """本地★切换;返回切换后的状态(True=已收藏).oid 必须非空."""
    conn = _conn()
    if conn is None:
        return False
    oid = str(oid)
    now = time.time()
    f = fields or {}
    with _LOCK:
        try:
            cur = get_item(kind, oid)
            if cur and not cur["deleted"]:
                conn.execute(
                    "UPDATE fav_items SET deleted=1, dirty=1, updated_at=? WHERE kind=? AND oid=?",
                    (now, kind, oid),
                )
                conn.commit()
                return False
            base = cur or {}
            extra = f.get("extra") if f.get("extra") is not None else base.get("extra")
            conn.execute(
                "INSERT OR REPLACE INTO fav_items(kind, oid, group_id, name, cover, added_at,"
                " updated_at, src, dirty, deleted, extra) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (kind, oid, f.get("group_id") or base.get("group_id"),
                 f.get("name") or base.get("name"), f.get("cover") or base.get("cover"),
                 base.get("added_at") or now, now, "local", 1, 0,
                 json.dumps(extra, ensure_ascii=False) if extra else None),
            )
            conn.commit()
            return True
        except Exception as e:
            print("[Civitai-Studio] 收藏切换失败:", e)
            return False


def upsert_remote(kind, oid, *, name=None, cover=None, group_id=None, extra=None,
                  remote_updated=None, deleted=False):
    """远端条目落地:本地无 → 收;本地 dirty → 以本地为准(待上推,不动);
    本地墓碑且墓碑较新 → 保持(上推取消);否则采纳远端(时间戳新者胜)."""
    conn = _conn()
    if conn is None:
        return
    oid = str(oid)
    ru = float(remote_updated or 0.0)
    now = time.time()
    with _LOCK:
        try:
            cur = get_item(kind, oid)
            if cur and cur["deleted"]:
                if cur["updated_at"] >= ru:
                    return  # 墓碑较新:远端旧收藏不拉回
                # 远端更新:落入下方 REPLACE 复活(dirty=0,src=remote)
            elif cur and cur["dirty"]:
                return  # 活动行有未同步的本地改动:等上推,远端旧值不覆盖
            conn.execute(
                "INSERT OR REPLACE INTO fav_items(kind, oid, group_id, name, cover, added_at,"
                " updated_at, src, dirty, deleted, extra) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (kind, oid, group_id or (cur or {}).get("group_id"),
                 name or (cur or {}).get("name"), cover or (cur or {}).get("cover"),
                 (cur or {}).get("added_at") or now, max(ru, now - 1) if ru else now,
                 "remote", 0, 1 if deleted else 0,
                 json.dumps(extra, ensure_ascii=False) if extra else None),
            )
            conn.commit()
        except Exception as e:
            print("[Civitai-Studio] 远端收藏写入失败:", e)


def set_group(kind, oid, group_id):
    conn = _conn()
    if conn is None:
        return
    with _LOCK:
        try:
            conn.execute("UPDATE fav_items SET group_id=?, dirty=1, updated_at=? WHERE kind=? AND oid=?",
                         (group_id or None, time.time(), kind, str(oid)))
            conn.commit()
        except Exception as e:
            print("[Civitai-Studio] 收藏分组失败:", e)


def mark_synced(kind, oid):
    """上推成功:清 dirty(墓碑条目直接删除)."""
    conn = _conn()
    if conn is None:
        return
    with _LOCK:
        try:
            it = get_item(kind, oid)
            if it and it["deleted"]:
                conn.execute("DELETE FROM fav_items WHERE kind=? AND oid=?", (kind, str(oid)))
            else:
                conn.execute("UPDATE fav_items SET dirty=0 WHERE kind=? AND oid=?", (kind, str(oid)))
            conn.commit()
        except Exception:
            pass


def assign_group_many(oids, kind, group_id):
    for oid in oids:
        set_group(kind, oid, group_id)


# ---------- 分组 ----------

def groups_list():
    conn = _conn()
    if conn is None:
        return []
    with _LOCK:
        try:
            return [
                {"gid": r[0], "name": r[1], "civitai_id": r[2], "dirty": r[3], "updated_at": r[4]}
                for r in conn.execute(
                    "SELECT gid, name, civitai_id, dirty, updated_at FROM fav_groups ORDER BY updated_at DESC"
                ).fetchall()
            ]
        except Exception as e:
            print("[Civitai-Studio] 分组读取失败:", e)
            return []


def upsert_group(name, gid=None, civitai_id=None, dirty=0, updated_at=None):
    conn = _conn()
    if conn is None:
        return None
    now = time.time()
    with _LOCK:
        try:
            if not gid:
                gid = "g_" + str(int(now * 1000))
            conn.execute(
                "INSERT OR REPLACE INTO fav_groups(gid, name, civitai_id, dirty, updated_at)"
                " VALUES(?,?,?,?,?)",
                (gid, name, civitai_id, dirty, updated_at or now),
            )
            conn.commit()
            return {"gid": gid, "name": name, "civitai_id": civitai_id, "dirty": dirty,
                    "updated_at": updated_at or now}
        except Exception as e:
            print("[Civitai-Studio] 分组写入失败:", e)
            return None


def delete_group(gid):
    """删组不删条目:组内条目回到未分组."""
    conn = _conn()
    if conn is None:
        return
    with _LOCK:
        try:
            conn.execute("UPDATE fav_items SET group_id=NULL, dirty=1 WHERE group_id=?", (gid,))
            conn.execute("DELETE FROM fav_groups WHERE gid=?", (gid,))
            conn.commit()
        except Exception as e:
            print("[Civitai-Studio] 分组删除失败:", e)


def purge_tombstones(older_than=_TOMBSTONE_TTL):
    conn = _conn()
    if conn is None:
        return
    with _LOCK:
        try:
            conn.execute("DELETE FROM fav_items WHERE deleted=1 AND updated_at < ?",
                         (time.time() - older_than,))
            conn.commit()
        except Exception:
            pass


# ---------- 导入/导出 ----------

def export_json():
    return {
        "version": 2,
        "exported_at": time.time(),
        "groups": groups_list(),
        "items": list_items(include_deleted=True),
    }


def import_json(payload, replace=False):
    """导入导出文件:replace=True 先清库(整库迁移);否则合并(dirty 保留本地改动)."""
    if not isinstance(payload, dict):
        raise ValueError("payload 必须是对象")
    conn = _conn()
    if conn is None:
        raise RuntimeError("sqlite 不可用")
    groups = payload.get("groups") or []
    items = payload.get("items") or []
    now = time.time()
    with _LOCK:
        try:
            if replace:
                conn.execute("DELETE FROM fav_items")
                conn.execute("DELETE FROM fav_groups")
            for g in groups:
                if not isinstance(g, dict) or not g.get("name"):
                    continue
                conn.execute(
                    "INSERT OR REPLACE INTO fav_groups(gid, name, civitai_id, dirty, updated_at)"
                    " VALUES(?,?,?,?,?)",
                    (str(g.get("gid") or "g_" + str(int(now * 1000))), str(g["name"]),
                     g.get("civitai_id"), 1, float(g.get("updated_at") or now)),
                )
            n = 0
            for it in items:
                if not isinstance(it, dict) or not it.get("oid") or it.get("kind") not in (KIND_MODEL, KIND_ASSET):
                    continue
                conn.execute(
                    "INSERT OR REPLACE INTO fav_items(kind, oid, group_id, name, cover, added_at,"
                    " updated_at, src, dirty, deleted, extra) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    (it["kind"], str(it["oid"]), it.get("group_id"), it.get("name"),
                     it.get("cover"), float(it.get("added_at") or now),
                     float(it.get("updated_at") or now), it.get("src") or "local",
                     1 if it.get("dirty") else 0, 1 if it.get("deleted") else 0,
                     json.dumps(it["extra"], ensure_ascii=False) if it.get("extra") else None),
                )
                n += 1
            conn.commit()
            return {"groups": len(groups), "items": n}
        except Exception as e:
            print("[Civitai-Studio] 收藏导入失败:", e)
            raise

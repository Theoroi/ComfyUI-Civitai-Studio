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
import sqlite3
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
        "gpushed": json.loads(r[11]) if r[11] else [],
    }


_COLS = "kind, oid, group_id, name, cover, added_at, updated_at, src, dirty, deleted, extra, gpushed"
_INS = ("INSERT OR REPLACE INTO fav_items(kind, oid, group_id, name, cover, added_at,"
        " updated_at, src, dirty, deleted, extra, gpushed) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")


_gpushed_checked = False


def _conn():
    cache_store.init()
    conn = cache_store._CONN
    if conn is not None:
        _ensure_gpushed(conn)
    return conn


def _ensure_gpushed(conn):
    """早期建库无 gpushed 列(分组上行推送标记 JSON 数组):惰性补列."""
    global _gpushed_checked
    if _gpushed_checked:
        return
    try:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(fav_items)")}
        if cols and "gpushed" not in cols:
            conn.execute("ALTER TABLE fav_items ADD COLUMN gpushed TEXT")
            conn.commit()
        _gpushed_checked = True
    except sqlite3.Error:
        pass  # 列已存在/库暂不可用:下次再查


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
                " updated_at, src, dirty, deleted, extra, gpushed) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                [("asset", str(x), None, None, None, now, now, "local", 0, 0, None, None)
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
                _INS,
                (kind, oid, f.get("group_id") or base.get("group_id"),
                 f.get("name") or base.get("name"), f.get("cover") or base.get("cover"),
                 base.get("added_at") or now, now, "local", 1, 0,
                 json.dumps(extra, ensure_ascii=False) if extra else None,
                 json.dumps(base["gpushed"], ensure_ascii=False) if base.get("gpushed") else None),
            )
            conn.commit()
            return True
        except Exception as e:
            print("[Civitai-Studio] 收藏切换失败:", e)
            return False


def upsert_remote(kind, oid, *, name=None, cover=None, group_id=None, extra=None,
                  remote_updated=None, deleted=False):
    """远端条目落地.裁决(依审计收紧):
    - 本地墓碑 → 一律保持(终局):本地取消不被远端拉回,复活须本地显式★;
      否则无上推通道的资产取消会在下次同步被静默撤销
    - 活动行 dirty → 让位(本地改动等上推)
    - 其余:收为/刷新为 src=remote dirty=0;updated_at 记远端时间(无则本地时刻)"""
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
                return  # 墓碑终局
            if cur and cur["dirty"]:
                return  # 本地改动待上推
            base = cur or {}
            conn.execute(
                _INS,
                (kind, oid, group_id or base.get("group_id"),
                 name or base.get("name"), cover or base.get("cover"),
                 base.get("added_at") or now, ru or now, "remote", 0, 0,
                 json.dumps(extra, ensure_ascii=False) if extra else
                 (json.dumps(base["extra"], ensure_ascii=False) if base.get("extra") else None),
                 json.dumps(base["gpushed"], ensure_ascii=False) if base.get("gpushed") else None),
            )
            conn.commit()
        except Exception as e:
            print("[Civitai-Studio] 远端收藏写入失败:", e)


def set_group(kind, oid, group_id):
    """分组是本地组织行为,不动 dirty(分组不应触发模型收藏上推/冻结远端更新)."""
    conn = _conn()
    if conn is None:
        return
    with _LOCK:
        try:
            conn.execute("UPDATE fav_items SET group_id=? WHERE kind=? AND oid=?",
                         (group_id or None, kind, str(oid)))
            conn.commit()
        except Exception as e:
            print("[Civitai-Studio] 收藏分组失败:", e)


def mark_synced(kind, oid, expected_updated=None):
    """上推成功:清 dirty(墓碑条目直接删除).expected_updated 防"上推期间用户又点了★"
    的竞态把新改动误标已同步."""
    conn = _conn()
    if conn is None:
        return
    with _LOCK:
        try:
            it = get_item(kind, oid)
            if not it:
                return
            if expected_updated is not None and it["updated_at"] != expected_updated:
                return  # 行在快照后被改过:留给下轮同步
            if it["deleted"]:
                conn.execute("DELETE FROM fav_items WHERE kind=? AND oid=?", (kind, str(oid)))
            else:
                # src 转 remote:此后纳入远端缺席对账(网页端取消收藏可传播到本地)
                conn.execute("UPDATE fav_items SET dirty=0, src='remote' WHERE kind=? AND oid=?",
                             (kind, str(oid)))
            conn.commit()
        except Exception:
            pass


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
            if civitai_id and not gid:
                # 同步反复落地同一集合:按 civitai_id 复用既有 gid,防分组无限膨胀
                r = conn.execute("SELECT gid FROM fav_groups WHERE civitai_id=?",
                                 (civitai_id,)).fetchone()
                if r:
                    gid = r[0]
            if not gid:
                gid = "g_" + str(int(now * 1000))
            else:
                # 保留既有联动字段:按 gid 改名不抹 civitai_id(防下次同步分叉)
                r = conn.execute("SELECT civitai_id, dirty, name FROM fav_groups WHERE gid=?", (gid,)).fetchone()
                if r and civitai_id is None:
                    civitai_id = r[0]
                if r and r[1] == 1 and civitai_id is not None:
                    # 守卫仅限下行落地路径(civitai_id 非空):本地改名(civitai_id=None)一律写新名,
                    # 否则"建组(即 dirty)后未同步前改名"会被旧名吞掉
                    new_cid = int(civitai_id) if civitai_id else r[0]
                    conn.execute(
                        "UPDATE fav_groups SET civitai_id=?, updated_at=? WHERE gid=?",
                        (new_cid, updated_at or now, gid),
                    )
                    conn.commit()
                    return {"gid": gid, "name": r[2], "civitai_id": new_cid,
                            "dirty": 1, "updated_at": updated_at or now}
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
            conn.execute("UPDATE fav_items SET group_id=NULL WHERE group_id=?", (gid,))
            conn.execute("DELETE FROM fav_groups WHERE gid=?", (gid,))
            conn.commit()
        except Exception as e:
            print("[Civitai-Studio] 分组删除失败:", e)


def mark_group_synced(gid, civitai_id):
    """上行成功:绑定 Civitai 集合 id 并清 dirty."""
    conn = _conn()
    if conn is None:
        return
    with _LOCK:
        try:
            conn.execute("UPDATE fav_groups SET civitai_id=?, dirty=0, updated_at=? WHERE gid=?",
                         (int(civitai_id), time.time(), gid))
            conn.commit()
        except (sqlite3.Error, ValueError):
            pass


def mark_group_pushed(kind, oid, gid):
    """条目成功推入远端集合:记入 gpushed 防重推.推送 await 期间条目被改组/取消
    (group_id 变化/墓碑)则不记——该推送已不反映当前归属,留下轮按新状态重推."""
    conn = _conn()
    if conn is None:
        return
    with _LOCK:
        try:
            it = get_item(kind, oid)
            if not it or it["deleted"] or it["group_id"] != gid:
                return
            pushed = it.get("gpushed") or []
            if gid in pushed:
                return
            pushed.append(gid)
            conn.execute("UPDATE fav_items SET gpushed=? WHERE kind=? AND oid=?",
                         (json.dumps(pushed, ensure_ascii=False), kind, str(oid)))
            conn.commit()
        except (sqlite3.Error, OSError):
            pass


def purge_tombstones(older_than=_TOMBSTONE_TTL):
    """只清"已同步"的墓碑(dirty=0,模型上推成功后本应被 mark_synced 删除,这里兜底).
    dirty=1 的墓碑是资产取消收藏的唯一防线,永不过期 — 过期即复活(审计 P0)."""
    conn = _conn()
    if conn is None:
        return
    with _LOCK:
        try:
            conn.execute("DELETE FROM fav_items WHERE deleted=1 AND dirty=0 AND updated_at < ?",
                         (time.time() - older_than,))
            conn.commit()
        except Exception:
            pass


def mark_remote_absent(kind, seen_oids, now=None):
    """远端缺席对账:src=remote、未 dirty、仍活动的条目本次远端列表未出现 → 落墓碑
    (远端已取消收藏).只对模型做——资产收藏与集合条目重叠,缺席≠取消."""
    seen = {str(x) for x in (seen_oids or [])}
    conn = _conn()
    if conn is None:
        return 0
    ts = now or time.time()
    n = 0
    with _LOCK:
        try:
            for r in list_items(kind=kind, include_deleted=False):
                if r["src"] == "remote" and not r["dirty"] and r["oid"] not in seen:
                    conn.execute(
                        "UPDATE fav_items SET deleted=1, dirty=0, updated_at=? WHERE kind=? AND oid=?",
                        (ts, kind, r["oid"]),
                    )
                    n += 1
            conn.commit()
        except Exception as e:
            print("[Civitai-Studio] 缺席对账失败:", e)
    return n


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
                deleted = 1 if it.get("deleted") else 0
                # 活动行强制 dirty=1 仅供模型(有上推通道);资产无上推,置 dirty 反而永久冻结远端刷新
                dirty = 1 if it.get("dirty") else 0
                if not deleted and it["kind"] == KIND_MODEL:
                    dirty = 1
                conn.execute(
                    _INS,
                    (it["kind"], str(it["oid"]), it.get("group_id"), it.get("name"),
                     it.get("cover"), float(it.get("added_at") or now),
                     float(it.get("updated_at") or now), it.get("src") or "local",
                     dirty, deleted,
                     json.dumps(it["extra"], ensure_ascii=False) if it.get("extra") else None,
                     json.dumps(it["gpushed"], ensure_ascii=False)
                     if isinstance(it.get("gpushed"), list) else None),
                )
                n += 1
            conn.commit()
            return {"groups": len(groups), "items": n}
        except Exception as e:
            try:
                conn.rollback()  # replace 模式清库后导入失败:回滚,防半截事务被无关 commit 落盘
            except Exception:
                pass
            print("[Civitai-Studio] 收藏导入失败:", e)
            raise

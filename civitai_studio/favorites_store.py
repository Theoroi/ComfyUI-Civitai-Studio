"""收藏系统存储(fav_items/fav_groups,sqlite)+ 旧 favorites.json 迁移 + 导入导出.

语义:
- toggle 开 = 活动行(dirty=1 待上推);关 = 墓碑(deleted=1, dirty=1)— 墓碑让
  同步能区分"本地刚取消"与"远端已取消",避免拉回循环;已同步墓碑(dirty=0)30 天后
  purge,未同步墓碑(dirty=1)永存——它是资产取消收藏的唯一防线。
- 冲突按 updated_at 最新者胜(upsert_remote 见函数内注释)。
- 所有函数为同步实现,调用方须在 bg 线程池执行(run_bg)。
sqlite 不可用时降级:读返回空,写静默丢弃(收藏功能退化为不可用但不报错)。
"""

import json
import os
import sqlite3
import time

import folder_paths

from . import cache_store
from .log import info, warn, error  # 统一日志(E2)

KIND_MODEL = "model"
KIND_ASSET = "asset"

_LOCK = cache_store._LOCK  # 统一单连接锁(F-S2-4):与 cache_store 共用一把 RLock 跨模块
                           # 串行化同一 sqlite 连接,防 A 模块事务被 B 模块 commit 半提交
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
        _ensure_ctype(conn)
        _clear_legacy_ctype(conn)
        _migrate_memberships(conn)
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


_ctype_checked = False


def _ensure_ctype(conn):
    """fav_groups.ctype 列(Civitai 集合类型 Model/Image;本地哨兵值 'Legacy')."""
    global _ctype_checked
    if _ctype_checked:
        return
    try:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(fav_groups)")}
        if cols and "ctype" not in cols:
            conn.execute("ALTER TABLE fav_groups ADD COLUMN ctype TEXT")
            conn.commit()
        _ctype_checked = True
    except sqlite3.Error:
        pass


_LEGACY_CLEARED = False


def _clear_legacy_ctype(conn):
    """批A:legacy 哨兵机制退役 — 存量 Legacy 组降级为普通本地组(可经组管理删除)."""
    global _LEGACY_CLEARED
    if _LEGACY_CLEARED:
        return
    try:
        conn.execute("UPDATE fav_groups SET ctype=NULL WHERE ctype='Legacy'")
        conn.commit()
        cache_store.kv_put("fav:legacy_ctype_cleared_v1", True)
        _LEGACY_CLEARED = True
    except Exception:
        pass


_FIG_MIGRATED = False


def _migrate_memberships(conn):
    """一次性迁移:fav_items.group_id/gpushed → fav_item_groups 会员行(跨集合挂组,批1-6).
    旧行只有单 group_id + gpushed(JSON gid 数组);全部视作 source='local',
    gpushed 里的 gid 记 pushed=1(已上行,item_id 未知→移除对账时按需查询)。
    Legacy 哨兵组不入会员表(整组垃圾,由 purge_legacy_group 清理)。幂等(kv 旗标)。"""
    global _FIG_MIGRATED
    if _FIG_MIGRATED:
        return
    try:
        if cache_store.kv_get("fav:fig_migrated_v1"):
            _FIG_MIGRATED = True
            return
        # 不能走 groups_list()/_conn():本函数在 _conn() 内被调,会无限递归
        legacy_gids = set()  # legacy 哨兵已退役(ctype 清理迁移在前)
        rows = conn.execute("SELECT kind, oid, group_id, gpushed FROM fav_items").fetchall()
        n = 0
        for kind, oid, group_id, gpushed in rows:
            pushed = set(json.loads(gpushed)) if gpushed else set()
            gids = set()
            if group_id and group_id not in legacy_gids:
                gids.add(group_id)
            gids |= {g for g in pushed if g not in legacy_gids}
            for gid in gids:
                conn.execute(
                    "INSERT OR IGNORE INTO fav_item_groups(kind, oid, gid, item_id, source,"
                    " pushed, deleted, added_at) VALUES(?,?,?,NULL,'local',?,0,?)",
                    (kind, str(oid), gid, 1 if gid in pushed else 0, time.time()),
                )
                n += 1
        conn.commit()
        cache_store.kv_put("fav:fig_migrated_v1", True)
        _FIG_MIGRATED = True
        if n:
            info(f"[Civitai-Studio] 收藏会员表迁移完成:{n} 条挂载关系")
    except Exception as e:
        error("[Civitai-Studio] 收藏会员表迁移失败(下轮重试):", e)


def memberships(kind=None, oid=None, gid=None, include_deleted=False):
    """会员行查询:条目→组挂载关系(跨集合多挂的唯一事实源).
    返回 [{kind, oid, gid, item_id, source, pushed, deleted, added_at}]"""
    conn = _conn()
    if conn is None:
        return []
    sql = "SELECT kind, oid, gid, item_id, source, pushed, deleted, added_at FROM fav_item_groups WHERE 1=1"
    args = []
    if kind:
        sql += " AND kind=?"
        args.append(kind)
    if oid:
        sql += " AND oid=?"
        args.append(str(oid))
    if gid:
        sql += " AND gid=?"
        args.append(gid)
    if not include_deleted:
        sql += " AND deleted=0"
    with _LOCK:
        try:
            return [
                {"kind": r[0], "oid": r[1], "gid": r[2], "item_id": r[3], "source": r[4],
                 "pushed": r[5], "deleted": r[6], "added_at": r[7]}
                for r in conn.execute(sql, args).fetchall()
            ]
        except Exception as e:
            error("[Civitai-Studio] 会员读取失败:", e)
            return []


def _sync_primary_group(conn, kind, oid):
    """把最老的活动会员回写 fav_items.group_id(前端旧字段/导出兼容列,非事实源)."""
    try:
        r = conn.execute(
            "SELECT gid FROM fav_item_groups WHERE kind=? AND oid=? AND deleted=0"
            " ORDER BY added_at ASC, gid ASC LIMIT 1", (kind, str(oid)),
        ).fetchone()
        conn.execute("UPDATE fav_items SET group_id=? WHERE kind=? AND oid=?",
                     (r[0] if r else None, kind, str(oid)))
    except sqlite3.Error:
        pass


def membership_add(kind, oid, gid, source="local", item_id=None, pushed=0, ts=None):
    """挂载条目到分组.返回 True=新建了活动行(同步计数只认新建);
    已存在软删行(本地移出待对账)不复活——本地移出优先于远端镜像,直到对账完成."""
    conn = _conn()
    if conn is None or not gid:
        return False
    with _LOCK:
        try:
            r = conn.execute(
                "SELECT item_id, pushed, deleted FROM fav_item_groups WHERE kind=? AND oid=? AND gid=?",
                (kind, str(oid), gid)).fetchone()
            if r:
                if r[2]:
                    return False  # 软删待对账:本地移出胜过远端/重复挂载
                if item_id is not None or pushed:
                    conn.execute(
                        "UPDATE fav_item_groups SET item_id=COALESCE(?,item_id),"
                        " pushed=MAX(pushed,?) WHERE kind=? AND oid=? AND gid=?",
                        (item_id, pushed, kind, str(oid), gid))
                    conn.commit()
                return False
            conn.execute(
                "INSERT INTO fav_item_groups(kind, oid, gid, item_id, source, pushed, deleted, added_at)"
                " VALUES(?,?,?,?,?,?,0,?)",
                (kind, str(oid), gid, item_id, source, pushed, ts or time.time()))
            _sync_primary_group(conn, kind, oid)
            conn.commit()
            return True
        except sqlite3.Error as e:
            error("[Civitai-Studio] 会员写入失败:", e)
            return False


def membership_remove(kind, oid, gid, hard=False):
    """摘除挂载.pushed=1 的行软删(待 removeFromCollection 对账);未上行的直接硬删.
    hard=True(远端缺席对账/对账成功)无条件硬删."""
    conn = _conn()
    if conn is None or not gid:
        return False
    with _LOCK:
        try:
            if hard:
                cur = conn.execute("DELETE FROM fav_item_groups WHERE kind=? AND oid=? AND gid=?",
                                   (kind, str(oid), gid))
            else:
                cur = conn.execute(
                    "UPDATE fav_item_groups SET deleted=1 WHERE kind=? AND oid=? AND gid=? AND deleted=0"
                    " AND pushed=1", (kind, str(oid), gid))
                if cur.rowcount == 0:  # 没推过的挂载没有远端形态:直接硬删
                    cur = conn.execute("DELETE FROM fav_item_groups WHERE kind=? AND oid=? AND gid=?",
                                       (kind, str(oid), gid))
            n = cur.rowcount or 0
            _sync_primary_group(conn, kind, oid)
            conn.commit()
            return n > 0
        except sqlite3.Error as e:
            error("[Civitai-Studio] 会员移除失败:", e)
            return False


def set_memberships(kind, oid, gids):
    """UI 分组赋值(多选):把条目的活动挂载对齐到 gids.
    新增→source=local pushed=0(等上推);移除→pushed=1 软删(待对账)/未推硬删.
    返回变更数。"""
    conn = _conn()
    if conn is None:
        return 0
    want = [str(g) for g in (gids or []) if g]
    with _LOCK:
        try:
            cur_rows = conn.execute(
                "SELECT gid, pushed FROM fav_item_groups WHERE kind=? AND oid=? AND deleted=0",
                (kind, str(oid))).fetchall()
            have = {r[0]: r[1] for r in cur_rows}
            sys_gids = {r[0] for r in conn.execute(
                "SELECT gid FROM fav_groups WHERE ctype='Bookmark'").fetchall()}
            n = 0
            for gid in want:
                if gid not in have:
                    conn.execute(
                        "INSERT INTO fav_item_groups(kind, oid, gid, item_id, source, pushed, deleted, added_at)"
                        " VALUES(?,?,?,NULL,'local',0,0,?)", (kind, str(oid), gid, time.time()))
                    n += 1
            for gid in have:
                if gid in sys_gids:
                    continue  # 批4 F1:系统集合(Liked Models)挂载只读,不因 UI 多选对齐被摘
                if gid not in want:
                    if have[gid]:
                        conn.execute("UPDATE fav_item_groups SET deleted=1 WHERE kind=? AND oid=? AND gid=?",
                                     (kind, str(oid), gid))
                    else:
                        conn.execute("DELETE FROM fav_item_groups WHERE kind=? AND oid=? AND gid=?",
                                     (kind, str(oid), gid))
                    n += 1
            _sync_primary_group(conn, kind, oid)
            conn.commit()
            return n
        except sqlite3.Error as e:
            error("[Civitai-Studio] 分组赋值失败:", e)
            return 0


def mark_membership_pushed(kind, oid, gid, item_id=None):
    """saveItem 成功:记 pushed=1 + 集合条目主键(removeFromCollection 必需)."""
    conn = _conn()
    if conn is None:
        return
    with _LOCK:
        try:
            conn.execute(
                "UPDATE fav_item_groups SET pushed=1, item_id=COALESCE(?, item_id)"
                " WHERE kind=? AND oid=? AND gid=?",
                (item_id, kind, str(oid), gid))
            conn.commit()
        except sqlite3.Error:
            pass


def mark_membership_removed(kind, oid, gid):
    """removeFromCollection 成功:软删行硬删(对账闭环)."""
    conn = _conn()
    if conn is None:
        return
    with _LOCK:
        try:
            conn.execute("DELETE FROM fav_item_groups WHERE kind=? AND oid=? AND gid=?",
                         (kind, str(oid), gid))
            conn.commit()
        except sqlite3.Error:
            pass


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
        error("[Civitai-Studio] 旧收藏迁移失败(下轮重试):", e)


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
            if group_id:  # "_"=未分组(无任何活动挂载);其余按会员表过滤(group_ids 为事实源)
                if group_id == "_":
                    sql += " AND NOT EXISTS (SELECT 1 FROM fav_item_groups f WHERE"
                    sql += " f.kind=fav_items.kind AND f.oid=fav_items.oid AND f.deleted=0)"
                else:
                    sql += " AND EXISTS (SELECT 1 FROM fav_item_groups f WHERE f.gid=?"
                    sql += " AND f.kind=fav_items.kind AND f.oid=fav_items.oid AND f.deleted=0)"
                    args.append(group_id)
            rows = conn.execute(sql + " ORDER BY updated_at DESC", args).fetchall()
            out = [_row(r) for r in rows]
            # 挂载关系(fav_item_groups)是分组事实源;group_ids=条目当前全部组(跨集合多挂),
            # mem_pushed=各组上行状态(E2E #10 上推角标数据源)
            by_key, push_key = {}, {}
            for r in conn.execute(
                "SELECT kind, oid, gid, pushed FROM fav_item_groups WHERE deleted=0"
                " ORDER BY added_at ASC"
            ).fetchall():
                by_key.setdefault((r[0], r[1]), []).append(r[2])
                push_key.setdefault((r[0], r[1]), {})[r[2]] = r[3]
            for it in out:
                it["group_ids"] = by_key.get((it["kind"], it["oid"]), [])
                it["mem_pushed"] = push_key.get((it["kind"], it["oid"]), {})
            return out
        except Exception as e:
            error("[Civitai-Studio] 收藏读取失败:", e)
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
            if not r:
                return None
            it = _row(r)
            ms = memberships(kind, str(oid))  # 挂载为事实源,与 list_items 同口径
            it["group_ids"] = [m["gid"] for m in ms]
            it["mem_pushed"] = {m["gid"]: m["pushed"] for m in ms}
            return it
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
                # 取消收藏=退出本地收藏库:挂载一并退场(pushed=1 软删待 removeFromCollection,
                # 未推的硬删)——否则远端集合里的条目会在下轮下行把墓碑复活成"created"
                for g in (cur.get("group_ids") or []):
                    membership_remove(kind, oid, g, hard=False)
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
            if f.get("group_id"):  # ★+指定组一次落库:同记会员行(UI 弹组选择器的写入路径)
                # F-S2-7:同挂载的软删行(在途移除对账中)一并复活(deleted=0, pushed=0,
                # item_id=NULL)——重新收藏=重新挂载,意图优先于在途对账;否则 INSERT OR
                # IGNORE 对既有行静默忽略,该挂载永远回不来
                conn.execute(
                    "UPDATE fav_item_groups SET deleted=0, pushed=0, item_id=NULL"
                    " WHERE kind=? AND oid=? AND gid=? AND deleted=1",
                    (kind, oid, f["group_id"]))
                conn.execute(
                    "INSERT OR IGNORE INTO fav_item_groups(kind, oid, gid, item_id, source,"
                    " pushed, deleted, added_at) VALUES(?,?,?,NULL,'local',0,0,?)",
                    (kind, oid, f["group_id"], now))
            _sync_primary_group(conn, kind, oid)
            conn.commit()
            return True
        except Exception as e:
            error("[Civitai-Studio] 收藏切换失败:", e)
            return False


def upsert_remote(kind, oid, *, name=None, cover=None, group_id=None, extra=None,
                  remote_updated=None, override_group=False, resurrect=False):
    """远端条目落地.裁决:
    - 本地墓碑 → 一律保持(终局):本地取消不被远端拉回;其上行移除闭环是
      removeFromCollection 成功后 mark_synced 删行,下轮下行远端已无此条目
    - 活动行 dirty → 让位(本地改动等上推)
    - 组归属:override_group=True(集合条目,远端权威镜像)时传 group_id 即覆盖;
      False 时只填空缺、绝不覆盖既有组(保护用户手动分组)
    - 其余:收为/刷新为 src=remote dirty=0;updated_at 记远端时间(无则本地时刻)
    返回落库状态 "created"(首入库,同步计数)/"updated"(刷新)/"blocked"(墓碑或
    dirty 挡下) — 计数不得把刷新/挡下算进"下拉"(E2E 7 根因之二)。"""
    conn = _conn()
    if conn is None:
        return "blocked"
    oid = str(oid)
    ru = float(remote_updated or 0.0)
    now = time.time()
    with _LOCK:
        try:
            cur = get_item(kind, oid)
            if cur and cur["deleted"]:
                # 复活门控(F-S2-1 改判):仅 dirty=0 的墓碑(mark_remote_tombstone/缺席对账
                # 产物=站方权威取消)可随远端重新出现而复活;dirty=1=本地取消在途(含旧引擎
                # 遗留脏墓碑)一律终局——否则"用户刚取消而远端集合仍挂着它"会被拉回复活,
                # 等于悄悄回滚用户的取消。资产无收藏状态上行通道,只能以站方 dirty=0 权威为准。
                _soft = [m for m in memberships(kind, oid, include_deleted=True) if m["deleted"]]
                if resurrect and kind == KIND_ASSET and not _soft and not cur["dirty"]:
                    conn.execute("UPDATE fav_items SET deleted=0, dirty=0, updated_at=?"
                                 " WHERE kind=? AND oid=?", (ru or now, kind, oid))
                    conn.commit()
                    cur = get_item(kind, oid)
                if cur and cur["deleted"]:
                    return "blocked"  # 墓碑终局
            if cur and cur["dirty"]:
                return "blocked"  # 本地改动待上推
            base = cur or {}
            gid = group_id if (override_group and group_id) else (base.get("group_id") or group_id)
            conn.execute(
                _INS,
                (kind, oid, gid,
                 name or base.get("name"), cover or base.get("cover"),
                 base.get("added_at") or now, ru or now, "remote", 0, 0,
                 json.dumps(extra, ensure_ascii=False) if extra else
                 (json.dumps(base["extra"], ensure_ascii=False) if base.get("extra") else None),
                 json.dumps(base["gpushed"], ensure_ascii=False) if base.get("gpushed") else None),
            )
            conn.commit()
            return "updated" if base else "created"  # 复活也记 created(真落地)
        except Exception as e:
            error("[Civitai-Studio] 远端收藏写入失败:", e)
            return "blocked"


def update_extra(kind, oid, patch):
    """批8:合并写 extra(分级补全等元数据回填)——不动 dirty/deleted,不触发收藏上推."""
    conn = _conn()
    if conn is None or not patch:
        return
    with _LOCK:
        try:
            it = get_item(kind, oid)
            if not it:
                return
            extra = dict(it.get("extra") or {})
            extra.update(patch)
            conn.execute("UPDATE fav_items SET extra=? WHERE kind=? AND oid=?",
                         (json.dumps(extra, ensure_ascii=False), kind, str(oid)))
            conn.commit()
        except Exception as e:
            error("[Civitai-Studio] extra 更新失败:", e)


def set_group(kind, oid, group_id):
    """分组是本地组织行为,不动 dirty(分组不应触发模型收藏上推/冻结远端更新).
    事实源是 fav_item_groups(跨集合多挂);单 group_id 参数=对齐到唯一组。"""
    set_memberships(kind, oid, [group_id] if group_id else [])


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
                {"gid": r[0], "name": r[1], "civitai_id": r[2], "dirty": r[3], "updated_at": r[4],
                 "ctype": r[5]}
                for r in conn.execute(
                    "SELECT gid, name, civitai_id, dirty, updated_at, ctype"
                    " FROM fav_groups ORDER BY updated_at DESC"
                ).fetchall()
            ]
        except Exception as e:
            error("[Civitai-Studio] 分组读取失败:", e)
            return []


def upsert_group(name, gid=None, civitai_id=None, dirty=0, updated_at=None, ctype=None):
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
                if not r:
                    # 批4 E2E 5b:同名未绑定组(本地新建待上行)与下行同名集合合并,
                    # 防"同名不同 id"的本地分叉上行后再造远端重复集合;
                    # F-S2-5:Bookmark 系统集合(Liked Models 等)只读,不吞同名本地组
                    r = conn.execute(
                        "SELECT gid FROM fav_groups WHERE name=? AND (civitai_id IS NULL OR civitai_id=0)"
                        " AND (ctype IS NULL OR ctype!='Bookmark')"
                        " ORDER BY updated_at DESC LIMIT 1", (name,)).fetchone()
                if r:
                    gid = r[0]
            if not gid:
                # 毫秒时间戳+随机后缀:同毫秒连建多组(新集合批量首下)时纯时间戳会主键碰撞,
                # 后组静默覆盖前组(refine R1 新增桩测试逮到的真 bug)
                gid = "g_%d_%s" % (int(now * 1000), os.urandom(2).hex())
            else:
                # 保留既有联动字段:按 gid 改名不抹 civitai_id(防下次同步分叉)
                r = conn.execute("SELECT civitai_id, dirty, name, ctype FROM fav_groups WHERE gid=?", (gid,)).fetchone()
                if r and civitai_id is None:
                    civitai_id = r[0]
                if r and ctype is None:
                    ctype = r[3]
                if r and r[1] == 1 and civitai_id is not None:
                    # 守卫仅限下行落地路径(civitai_id 非空):本地改名(civitai_id=None)一律写新名,
                    # 否则"建组(即 dirty)后未同步前改名"会被旧名吞掉
                    new_cid = int(civitai_id) if civitai_id else r[0]
                    conn.execute(
                        "UPDATE fav_groups SET civitai_id=?, updated_at=?, ctype=? WHERE gid=?",
                        (new_cid, updated_at or now, ctype, gid),  # ctype 透传(审计 F-5)
                    )
                    conn.commit()
                    return {"gid": gid, "name": r[2], "civitai_id": new_cid,
                            "dirty": 1, "updated_at": updated_at or now, "ctype": ctype}
            conn.execute(
                "INSERT OR REPLACE INTO fav_groups(gid, name, civitai_id, dirty, updated_at, ctype)"
                " VALUES(?,?,?,?,?,?)",
                (gid, name, civitai_id, dirty, updated_at or now, ctype),
            )
            conn.commit()
            return {"gid": gid, "name": name, "civitai_id": civitai_id, "dirty": dirty,
                    "updated_at": updated_at or now, "ctype": ctype}
        except Exception as e:
            error("[Civitai-Studio] 分组写入失败:", e)
            return None


def reset_all():
    """收藏库全量重置(用户拍板:全清)— 三表清空 + 同步缓存/迁移旗标清除,
    下次同步从 Civitai 全量重新下拉。⚠️ 本地★一并清除,重置前请先导出备份。"""
    conn = _conn()
    if conn is None:
        raise RuntimeError("sqlite 不可用")
    with _LOCK:
        conn.execute("DELETE FROM fav_items")
        conn.execute("DELETE FROM fav_item_groups")
        conn.execute("DELETE FROM fav_groups")
        conn.commit()
    cache_store.kv_delete("fav:colitems_v3")  # 当前版本
    cache_store.kv_delete("fav:colitems_v2")  # 历史版本残留(批5 缓存键升级)
    cache_store.kv_delete("fav:fig_migrated_v1")
    cache_store.kv_delete("fav:legacy_ctype_cleared_v1")
    cache_store.kv_delete("legacy_purged_v2")
    global _FIG_MIGRATED
    _FIG_MIGRATED = False


def delete_group(gid):
    """删组不删条目:组内条目回到未分组(挂载行一并删除)."""
    conn = _conn()
    if conn is None:
        return
    with _LOCK:
        try:
            affected = conn.execute(
                "SELECT kind, oid FROM fav_item_groups WHERE gid=? AND deleted=0", (gid,)).fetchall()
            conn.execute("DELETE FROM fav_item_groups WHERE gid=?", (gid,))
            for kind, oid in affected:
                _sync_primary_group(conn, kind, oid)
            conn.execute("UPDATE fav_items SET group_id=NULL WHERE group_id=?", (gid,))
            conn.execute("DELETE FROM fav_groups WHERE gid=?", (gid,))
            conn.commit()
        except Exception as e:
            error("[Civitai-Studio] 分组删除失败:", e)


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


def mark_remote_tombstone(kind, oid):
    """对账墓碑(站方已把条目移出全部集合):deleted=1, dirty=0 — 30 天后随
    purge_tombstones 兜底清除;不复活为活动行,除非远端重新出现(重新入库)。"""
    conn = _conn()
    if conn is None:
        return
    with _LOCK:
        try:
            conn.execute("UPDATE fav_items SET deleted=1, dirty=0, updated_at=?"
                         " WHERE kind=? AND oid=?", (time.time(), kind, str(oid)))
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
            error("[Civitai-Studio] 缺席对账失败:", e)
    return n


# ---------- 导入/导出 ----------

def export_json():
    return {
        "version": 3,
        "exported_at": time.time(),
        "groups": groups_list(),
        "items": list_items(include_deleted=True),
        "memberships": memberships(include_deleted=True),
    }


def _import_src(it):
    """导入行 src 归一:缺省 local."""
    return it.get("src") or "local"


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
                conn.execute("DELETE FROM fav_item_groups")
            for g in groups:
                if not isinstance(g, dict) or not g.get("name"):
                    continue
                conn.execute(
                    "INSERT OR REPLACE INTO fav_groups(gid, name, civitai_id, dirty, updated_at, ctype)"
                    " VALUES(?,?,?,?,?,?)",
                    (str(g.get("gid") or "g_" + str(int(now * 1000))), str(g["name"]),
                     g.get("civitai_id"), 1, float(g.get("updated_at") or now),
                     g.get("ctype")),
                )
            n = 0
            for it in items:
                if not isinstance(it, dict) or not it.get("oid") or it.get("kind") not in (KIND_MODEL, KIND_ASSET):
                    continue
                if not str(it["oid"]).isdigit():
                    # F-S2-6:非数字 oid=损坏数据,拒收整单(回滚)走既有 ValueError→400 路径
                    raise ValueError("条目 oid 必须是数字: %r" % (it["oid"],))
                deleted = 1 if it.get("deleted") else 0
                # 活动行强制 dirty=1 仅供模型(有上推通道);资产无上推,置 dirty 反而永久冻结远端刷新
                dirty = 1 if it.get("dirty") else 0
                if not deleted and it["kind"] == KIND_MODEL:
                    dirty = 1
                conn.execute(
                    _INS,
                    (it["kind"], str(it["oid"]), it.get("group_id"), it.get("name"),
                     it.get("cover"), float(it.get("added_at") or now),
                     float(it.get("updated_at") or now), _import_src(it),
                     dirty, deleted,
                     json.dumps(it["extra"], ensure_ascii=False) if it.get("extra") else None,
                     json.dumps(it["gpushed"], ensure_ascii=False)
                     if isinstance(it.get("gpushed"), list) else None),
                )
                n += 1
            # 挂载:导入文件带 memberships 用之(v3);否则按 group_id 派生(v2 兼容)
            ms = payload.get("memberships")
            if not isinstance(ms, list):
                ms = [{"kind": it["kind"], "oid": it["oid"], "gid": it["group_id"]}
                      for it in items if isinstance(it, dict) and it.get("group_id")
                      and it.get("kind") in (KIND_MODEL, KIND_ASSET)]
            for m in ms:
                if not isinstance(m, dict) or not m.get("gid"):
                    continue
                conn.execute(
                    "INSERT OR REPLACE INTO fav_item_groups(kind, oid, gid, item_id, source,"
                    " pushed, deleted, added_at) VALUES(?,?,?,?,?,?,?,?)",
                    (str(m.get("kind")), str(m.get("oid")), str(m["gid"]), m.get("item_id"),
                     str(m.get("source") or "local"), 1 if m.get("pushed") else 0,
                     1 if m.get("deleted") else 0, float(m.get("added_at") or now)),
                )
            for row in conn.execute(
                "SELECT DISTINCT kind, oid FROM fav_item_groups WHERE deleted=0").fetchall():
                _sync_primary_group(conn, row[0], row[1])
            conn.commit()
            return {"groups": len(groups), "items": n}
        except Exception as e:
            try:
                conn.rollback()  # replace 模式清库后导入失败:回滚,防半截事务被无关 commit 落盘
            except Exception:
                pass
            error("[Civitai-Studio] 收藏导入失败:", e)
            raise

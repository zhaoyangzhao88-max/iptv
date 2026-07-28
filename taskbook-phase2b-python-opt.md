本文是你唯一任务来源。换会话先读 PROGRESS.md。目的：Python 引擎三项优化——normalizer 缓存、黑名单统一、merger 副作用修复。82/82 不可退。

## 我替领导拍的板

- 本次只做 Python 引擎优化三项，不碰 v1 模块、不碰 Electron、不碰 app.js
- 每项完成后跑 pytest 确认 82 passed
- constants.py 是唯一新建文件，其余只改现有文件

## 界限

只改：`iptv-engine-b/python_engine/src/normalizer.py`、`blocklist.py`、`speedtest.py`、`merger.py`、`constants.py`（新建）。不改函数签名（内部实现可改）、不新增 pip 依赖。顺手活进 BLOCKED.md。

## 现状（2026-07-27）

- normalizer.py L93-110：`get_channel_metadata()` 每次 `open()`+`json.load()` 缓存文件，千频道=千次 I/O
- blocklist.py `DEFAULT_BLOCKLIST_DOMAINS` 与 speedtest.py `BLACKLIST_DOMAINS`+`AD_KEYWORDS` 是同一份黑名单、两个变量名
- merger.py L55-91：L89 `standard_channels.append()` 直接修改入参，L73-74 修改入参 channel.urls。调用方原始列表被静默篡改

**任务0 基线**
```bash
cd iptv-engine-b
/d/python/python.exe -m pytest python_engine/tests/ -q 2>&1 | tail -1
# 期望：82 passed
grep -n "DEFAULT_BLOCKLIST_DOMAINS" python_engine/src/blocklist.py
grep -n "BLACKLIST_DOMAINS\|AD_KEYWORDS" python_engine/src/speedtest.py
```

## 任务1 normalizer 懒加载缓存

`get_channel_metadata` 上方加 `_METADATA_CACHE = None`。函数内若缓存为空且文件存在则加载；之后用内存 dict。`sync_iptv_org_dict()` 调用后置 None 强制重载。

```bash
grep -q "_METADATA_CACHE" iptv-engine-b/python_engine/src/normalizer.py && echo "PASS: cache added"
/d/python/python.exe -m pytest python_engine/tests/ -q 2>&1 | tail -1
# 期望仍为 82 passed
```
反向验证：删掉缓存变量→pytest 仍应全绿（缓存是性能优化，不影响正确性）。

## 任务2 constants.py 统一黑名单

新建 `constants.py`，定义 `BLOCKLIST_DOMAINS` 和 `AD_BYTES_KEYWORDS`。blocklist.py 改为 `from python_engine.src.constants import BLOCKLIST_DOMAINS as DEFAULT_BLOCKLIST_DOMAINS`。speedtest.py 的 `BLACKLIST_DOMAINS` 和 `AD_KEYWORDS` 改为从 constants 导入。

```bash
test -f iptv-engine-b/python_engine/src/constants.py && echo "PASS: file created"
grep -q "from python_engine.src.constants import" iptv-engine-b/python_engine/src/blocklist.py && echo "PASS: blocklist imports"
grep -q "from python_engine.src.constants import" iptv-engine-b/python_engine/src/speedtest.py && echo "PASS: speedtest imports"
/d/python/python.exe -m pytest python_engine/tests/ -q 2>&1 | tail -1
```
反向验证：改 constants 里一个域名→两个模块应同步生效。

## 任务3 修复 merger.py 列表副作用

`merge_priority_channels` 函数开头加 `channels = list(standard_channels)`（浅拷贝），后续操作全部用 `channels` 而非 `standard_channels`。L71-76 的 `.remove()`/`.insert()` 之前先判断 `url in channel.urls`（已有判断）。函数末尾 `return channels`。

```bash
grep -q "list(standard_channels)" iptv-engine-b/python_engine/src/merger.py && echo "PASS: shallow copy"
/d/python/python.exe -m pytest python_engine/tests/ -q 2>&1 | tail -1
```
反向验证：函数返回前打印 `standard_channels` 长度→应与传入时一致（未被修改）。

## 规矩

- 禁止 echo 造假
- 禁止新增 pip 依赖
- 禁止改公共函数签名（函数名、参数名和个数不能变）
- 每步跑 pytest，失败即停修
- 连败 3 次跳下一项，记 BLOCKED.md

## 完成条件

1. 三项优化全部 PASS，pytest 82/82
2. blocklist.py 和 speedtest.py 的黑名单来自同一源（constants.py）
3. merger.py 不修改入参 `standard_channels` 列表
4. 交付 BLOCKED.md + PROGRESS.md

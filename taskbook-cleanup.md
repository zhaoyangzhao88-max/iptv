本文是你唯一任务来源。换会话先读 PROGRESS.md。目的：清掉三个子项目里重复、废弃、脏的东西。安全>彻底>速度。

## 我替领导拍的板

- v1 独有模块 cp 到 v2 加 `_from_v1` 后缀再删 v1，不改代码
- iptv-project/scripts/ 只留 `_test_sources.py`，其余 M3U 脚本全删
- 脏目录 `E:VSCODEiptv-engine-bnode_apisrc/` 直接删
- 延后：Electron preload.js、normalizer I/O 缓存、constants.py 统一黑名单、merger.py 副作用修复
- 缺 app.js 不碰

## 界限

只改：`iptv-engine/`、`iptv-engine-b/`（脏目录+测试+.gitignore）、`iptv-project/scripts/`、各 README。不改 v2 核心源码函数签名、不新增依赖、不 git commit。顺手活进 BLOCKED.md。

## 现状（2026-07-27）

v1=39文件 0测试 | v2=122文件 ~82用例 | 播放器=39文件
v1：parse_m3u 双份定义，fetch_all 在4文件重复
v2：7个测试失败（Lesson 3/10/12/16/19，mock不同步）
脏目录：`E:VSCODEiptv-engine-bnode_apisrc/`（空）
v1独有：cdn_explorer, cztv_explorer, cdn_probe, aggregator_crawler

**任务0 核对基线**
```bash
find iptv-engine -not -path '*/.git/*' -type f | wc -l
find iptv-engine-b -not -path '*/.git/*' -type f | wc -l
find iptv-project -not -path '*/.git/*' -not -path '*/node_modules/*' -type f | wc -l
```
期望39/122/39。偏差>5→记 BLOCKED.md 暂停。

## 任务1 抢救v1模块+删除v1

```bash
cp iptv-engine/engine/{cdn_explorer,cztv_explorer,cdn_probe,aggregator_crawler}.py iptv-engine-b/python_engine/src/
cd iptv-engine-b/python_engine/src
for f in cdn_explorer cztv_explorer cdn_probe aggregator_crawler; do mv ${f}.py ${f}_from_v1.py; done
cd ../../..
rm -rf iptv-engine
test ! -d iptv-engine && echo "PASS: v1 gone"
for f in cdn_explorer cztv_explorer cdn_probe aggregator_crawler; do
  test -f iptv-engine-b/python_engine/src/${f}_from_v1.py && echo "PASS: ${f}" || echo "FAIL: ${f}"
done
```
反向验证：故意少 cp 一个→验收应红灯。

## 任务2 删脏目录+补.gitignore

```bash
rm -rf "iptv-engine-b/E:VSCODEiptv-engine-bnode_apisrc"
test ! -d "iptv-engine-b/E:VSCODEiptv-engine-bnode_apisrc" && echo "PASS"
cat >> iptv-engine-b/.gitignore << 'EOF'
python_engine/data/history_scores.json
python_engine/data/iptv_org_cache.json
.pytest_cache/
__pycache__/
*.pyc
EOF
grep -q "history_scores" iptv-engine-b/.gitignore && echo "PASS: gitignore"
```

## 任务3 清理冗余脚本

```bash
cd iptv-project/scripts
rm -f merge_sources.py filter_channels.py check_and_group_locals.py check_streams.py optimize_m3u.py deduplicate_by_speed.py export_clean_m3u.py
test $(ls *.py | wc -l) -eq 1 && echo "PASS: 1 left"
test -f _test_sources.py && echo "PASS: keeper"
```
反向验证：故意漏删→验收应红灯。

## 任务4 同步文档

README.md：删"推荐处理顺序"和"文件流向"，换"直播源由 iptv-engine-b 自动生成"。PROJECT_CONTEXT.md：第5节只列 `_test_sources.py`，第9节整节删。handover_manual.md：更新文件数。

```bash
! grep -q "merge_sources.py" iptv-project/README.md && echo "PASS: README"
! grep -q "filter_channels.py" iptv-project/PROJECT_CONTEXT.md && echo "PASS: CONTEXT"
```

## 任务5 修复7个失败测试

Lesson 3/10/12/16/19 mock 签名不同步。只改测试文件 mock 参数。

```bash
cd iptv-engine-b
python -m pytest python_engine/tests/ -q 2>&1 | tail -1
# 期望：XX passed（无 failed）
```

## 任务6 生成 AUDIT_RESULT.md

包含：6任务勾选、变更明细表（文件/操作/说明）、pytest 输出、延后事项。

```bash
test -f AUDIT_RESULT.md && echo "PASS: audit"
```

## 规矩

禁止 echo 造假、禁止新增 pip 依赖、禁止改 v2 核心源码函数签名、连败3次跳下一项、不 git 操作。

## 完成条件

6任务全 PASS + pytest 0 failed + v2 核心源码签名不变 + 交付 BLOCKED.md / PROGRESS.md / AUDIT_RESULT.md。止损：3轮未全绿→提交剩余失败清单。

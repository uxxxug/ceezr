#!/usr/bin/env python3
"""LOAD-01 · ملخّصُ ملفِّ تعريفِ المعالجِ للبوّابة (PROTOCOL-load01-cpuprof.md). تشخيصٌ لا قبول.

يقرأ ملفَّ `.cpuprofile` (صيغةُ Chrome DevTools التي يكتبُها `bun --cpu-prof`) ويطبع:
  - زمنَ المعالجِ التقريبيَّ = عددُ العيّناتِ × الفاصل، وحصّةَ `(program)` و`(garbage collector)`.
    لا تُستعملُ الفروقُ الزمنيّةُ (timeDeltas): Bun يحمّلُ فيها الخمولَ آخرَ إطار (عيبُ الدفعة 11).
  - الزمنَ الذاتيَّ لكلِّ دالّةٍ (أعلى 40) ولكلِّ ملفٍّ/حزمة (أعلى 25).
  - الزمنَ الشاملَ (ذاتيًّا + أبناء) لأعلى 30 دالّة.
لا يقدّرُ ولا يستكمل: الأرقامُ عيّناتٌ كما هي.
"""

import collections
import json
import re
import sys

p = json.load(open(sys.argv[1]))
nodes = {n["id"]: n for n in p["nodes"]}
parent = {}
for n in p["nodes"]:
    for c in n.get("children", []):
        parent[c] = n["id"]

samples = p.get("samples", [])
deltas = p.get("timeDeltas", [])
if not samples or len(samples) != len(deltas):
    raise SystemExit(f"عيّناتٌ غائبةٌ أو غيرُ متّسقة: samples={len(samples)} deltas={len(deltas)}")

# Bun يأخذُ العيّنةَ حينَ يجري JS فقط ويُحمِّلُ فجوةَ الخمولِ على الفرقِ الزمنيّ (عيبُ الدفعة 11)؛
# فالوزنُ عددُ العيّناتِ × الفاصلِ المُعلَن (الوسيطُ الثاني، افتراضيًّا 1000µs) لا الفروقُ الزمنيّة.
# ضابطٌ محلّيٌّ (Bun 1.4.4): 1ms عملٍ كلَّ 10ms لـ5ث ⇒ 483 عيّنة ≈ 0.48ث مقابلَ 0.54ث من /proc.
interval_us = int(sys.argv[2]) if len(sys.argv) > 2 else 1000
self_us = collections.Counter()
for sid in samples:
    self_us[sid] += interval_us

total = sum(self_us.values())


def label(n):
    cf = n["callFrame"]
    fn = cf.get("functionName") or "(anonymous)"
    url = cf.get("url") or ""
    url = re.sub(r"^.*/(node_modules/)", r"\1", url)
    url = re.sub(r"^.*/(apps|packages)/", r"\1/", url)
    return f"{fn} @ {url}:{cf.get('lineNumber', -1) + 1}" if url else fn


def bucket(n):
    url = n["callFrame"].get("url") or ""
    m = re.search(r"node_modules/((?:@[^/]+/)?[^/]+)", url)
    if m:
        return "node_modules/" + m.group(1)
    m = re.search(r"/(apps/[^/]+/src/[^/]+|packages/[^/]+/[^/]+)", url)
    if m:
        return m.group(1)
    return url or n["callFrame"].get("functionName") or "?"


by_fn = collections.Counter()
by_file = collections.Counter()
special = collections.Counter()
for nid, us in self_us.items():
    n = nodes[nid]
    fn = n["callFrame"].get("functionName") or ""
    if fn in ("(idle)", "(program)", "(garbage collector)", "(root)"):
        special[fn] += us
    by_fn[label(n)] += us
    by_file[bucket(n)] += us

incl = collections.Counter()
for nid, us in self_us.items():
    seen = set()
    cur = nid
    while cur is not None:
        lab = label(nodes[cur])
        if lab not in seen:
            incl[lab] += us
            seen.add(lab)
        cur = parent.get(cur)

s = lambda us: f"{us / 1e6:9.2f}s {100 * us / total:5.1f}%"
wall = (p.get("endTime", 0) - p.get("startTime", 0)) / 1e6
print(f"FILE {sys.argv[1]}")
print(f"PROFILE wall={wall:.1f}s cpu≈{total / 1e6:.1f}s (samples={len(samples)} × {interval_us}µs) mainThreadShare≈{total / 1e6 / wall:.2f}" if wall else "")
for k in ("(idle)", "(program)", "(garbage collector)", "(root)"):
    print(f"SPECIAL {s(special[k])} {k}")
busy = total - special["(idle)"]
print(f"BUSY {busy / 1e6:.1f}s ({100 * busy / total:.1f}% of sampled)")
print("\n== SELF by function (top 40)")
for k, v in by_fn.most_common(40):
    print(s(v), k)
print("\n== SELF by file/package (top 25)")
for k, v in by_file.most_common(25):
    print(s(v), k)
print("\n== INCLUSIVE by function (top 30)")
for k, v in incl.most_common(30):
    print(s(v), k)

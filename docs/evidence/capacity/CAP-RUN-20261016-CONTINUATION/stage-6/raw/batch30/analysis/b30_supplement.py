#!/usr/bin/env python3
"""LOAD-01 · الدفعة 30 — مقاييسُ وصفيّةٌ تكميليّةٌ من الخامِّ المُودَع (ليست معيارَ قرار).

كُتبَ **بعدَ** رؤيةِ الحكم (b30-decision.json)، فلا يدخلُ قاعدةَ القرارِ المسجَّلةِ مسبقًا ولا يغيّرُها.
سببُه: `b30-analyze.py` يقرأُ انتظارَ الحجزِ من سجلّاتِ `rsig` (`waitMs`) وmain لا يكتبُه هناك (أُضيفَ في
`45571268` غيرِ المدموج)؛ فالانتظارُ موجودٌ فقط في نوافذِ `k=db` لكلِّ مجمّعٍ ونوع. يحسبُ لكلِّ موجة:
انتظارَ حجزِ `ceezr:gatewayRequest` لكلِّ حجز (كلُّ الطرق)، وp95 الانتظارِ الموزونَ بالعدد، وزمنَ وظائفِ تيليجرام.

الاستعمال: b30_supplement.py <gh-seat-dir> > b30-supplement.json
"""
import gzip
import json
import statistics
import sys
from pathlib import Path

POOL = "ceezr:gatewayRequest"


def wave(d: Path) -> dict:
    n = 0
    wait = 0.0
    p95w = []
    with gzip.open(d / "load-trace.jsonl.gz", "rt", encoding="utf-8") as f:
        for line in f:
            if '"k":"db"' not in line:
                continue
            t = json.loads(line)
            if t.get("pool") != POOL or t.get("kind") == "txQuery":
                continue
            k = int(t.get("n") or 0)
            n += k
            wait += float(t.get("waitSumMs") or 0)
            if t.get("waitP95Ms") is not None:
                p95w.append((float(t["waitP95Ms"]), k))
    p95w.sort()
    tot = sum(k for _, k in p95w)
    acc, wp95 = 0, None
    for v, k in p95w:
        acc += k
        if acc >= 0.5 * tot:
            wp95 = v
            break
    snap = json.loads((d / "db-audit-post.json").read_text(encoding="utf-8"))["snapshot"]
    lat = snap["telegramUpdates"].get("jobDoneLatencySec") or {}
    return {"acq": n, "wait_ms_per_acq": round(wait / n, 2) if n else None,
            "window_wait_p95_ms_median": None if wp95 is None else round(wp95, 1),
            "telegram_job_done_p50_s": lat.get("p50"), "telegram_job_done_p95_s": lat.get("p95")}


def main() -> int:
    root = Path(sys.argv[1]) / "raw"
    out = {"note": "وصفيٌّ تكميليّ — ليس معيارَ قرار؛ الحكمُ في b30-decision.json", "waves": {}, "arm_median": {}}
    for d in sorted(p for p in root.iterdir() if "-smoke-" not in p.name):
        out["waves"][d.name] = wave(d)
    for a in "ALS":
        ws = [w for k, w in out["waves"].items() if k.split("-")[2].startswith(a)]
        out["arm_median"][a] = {m: statistics.median([w[m] for w in ws if w[m] is not None])
                                for m in ("wait_ms_per_acq", "window_wait_p95_ms_median",
                                          "telegram_job_done_p50_s", "telegram_job_done_p95_s")}
    print(json.dumps(out, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())

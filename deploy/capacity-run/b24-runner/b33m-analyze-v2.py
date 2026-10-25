#!/usr/bin/env python3
"""LOAD-01 · b33m — المحلّلُ المصحَّح v2 (PROTOCOL-b33m-confirm.md)، مُثبَّتٌ قبلَ الموجةِ التأكيديّة.

v1 (`b33m-analyze.py`) يبقى حرفًا لإعادةِ إنتاجِ m1 وحكمِه (NOT_READY). v2 يستوردُ حقائقَ v1 كما هي
ويستبدلُ ثلاثةَ مقاييسَ ثبتَ عيبُها على m1، بأسبابٍ من الشيفرةِ والبيانات:
  H1  v1 يعدُّ الفجوةَ «بعملٍ مستحقّ» إن وقعت عيّنةٌ داخلها؛ المُعايِنُ (5ث) والمشغّلُ (نبضةُ 10ث) متزامنان
      فلم تقع عيّنةٌ في أيِّ فجوة (تداخلُ تردّد). v2: الفجوةُ «بعملٍ مستحقّ» إن كانت العيّنةُ السابقةُ لها
      واللاحقةُ بها كلتاهما eligible>0 (إحاطة).
  H2  v1 يقسمُ مجموعَ waitMs على ثواني-المسارات؛ لكنّ `backpressure` يُطلَقُ لكلِّ نومٍ في كلِّ مستدعٍ (ومنه
      مساراتُ الردِّ المباشرةُ بميزانيّة 5ث) والإجهاضُ لا يُطلِقُ حدثًا (rate-aware-telegram-sender.ts) فالنسبةُ
      ليست زمنَ المسار (4.6 > 1 على m1). v2: H2 مستقلٌّ فقط إن كانت الإعادةُ ≥50% من الاستحواذات **و**معدّلُ
      الإرسالِ داخلَ الدوراتِ < 90% من 25/ث (مساراتٌ تدورُ والدلوُ غيرُ مشبَع).
  H3  v1 يعدُّ `failed` من تفاصيلِ الدورة إخفاقًا؛ وهو يشملُ إعاداتِ الازدحام. v2: الإخفاقُ الحقيقيّ = 429 من المحاكي
      + صفوفٌ بـ error_code.
  H5  v1 يقيسُ المتوسّطَ في كلِّ ثانيةٍ مشغولةٍ (تشملُ ثواني الحدودِ الجزئيّة). v2: معدّلُ قبولِ بوتِ الراكبِ داخلَ
      دوراتِ التصريفِ وحدَها ≥ 0.9×25 ⇒ السقفُ مُلزِمٌ داخلَ الدورة.
قاعدةُ القرار (§3 من PROTOCOL-b33m-confirm.md) تُطبَّقُ على الموجةِ التأكيديّةِ وحدَها.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

_spec = importlib.util.spec_from_file_location("v1", Path(__file__).with_name("b33m-analyze.py"))
v1 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(v1)  # type: ignore[union-attr]

BOT_BUDGET_PER_SEC = v1.BOT_BUDGET_PER_SEC     # 25 — لا يُغيَّر
CAP_FRACTION = 0.90
H1_IDLE_SUPPORT, H1_IDLE_REFUTE = v1.H1_IDLE_SUPPORT, v1.H1_IDLE_REFUTE
H2_REQUEUE_SHARE = 0.50
H3_RETRY_SHARE = v1.H3_RETRY_SHARE
NEEDED_RATE = 20.4                             # BATCH-33-READINESS §3: اللازمُ عندَ 750 لـ P7 ≤ 120ث


def analyse2(raw: Path) -> dict:
    res = v1.analyse(raw)
    d = v1.load(raw)
    S = sorted((s for s in d["samples"] if "kinds" in s), key=lambda s: s["t"])
    R = v1.drain_runs(d["events"])
    elig = lambda s: sum((v.get("eligible") or 0) for v in s["kinds"].values()) > 0  # noqa: E731

    def bracketed(lo: float, hi: float) -> bool:
        before = [s for s in S if s["t"] <= lo]
        after = [s for s in S if s["t"] >= hi]
        return bool(before and after and elig(before[-1]) and elig(after[0]))

    gaps = [(R[i]["end"], R[i + 1]["start"]) for i in range(len(R) - 1)]
    span = (R[-1]["end"] - R[0]["start"]) if R else 0
    idle_e = (sum(max(0.0, b - a) for a, b in gaps if bracketed(a, b)) / span) if span else None
    idle_all = (sum(max(0.0, b - a) for a, b in gaps) / span) if span else None

    # الإرسالُ داخلَ الدوراتِ وفي الفجوات (المحاكي)
    lo, hi = (R[0]["start"], R[-1]["end"]) if R else (0, 0)
    busy_s = sum(r["dur"] for r in R) / 1000
    gap_s = (hi - lo) / 1000 - busy_s if R else 0
    inrun = lambda t: any(r["start"] <= t <= r["end"] for r in R)  # noqa: E731
    cnt: dict = {}
    for m in d["mock"]:
        if m.get("status") == 200 and R and lo <= (m.get("t") or 0) <= hi:
            k = (m.get("bot"), "run" if inrun(m["t"]) else "gap")
            cnt[k] = cnt.get(k, 0) + 1
    egress = {f"{b}|{w}": {"n": n, "per_s": round(n / (busy_s if w == "run" else gap_s), 2) if (busy_s if w == "run" else gap_s) else None}
              for (b, w), n in sorted(cnt.items())}
    rider_run = (cnt.get(("rider", "run"), 0) / busy_s) if busy_s else None
    rider_all = ((cnt.get(("rider", "run"), 0) + cnt.get(("rider", "gap"), 0)) / ((hi - lo) / 1000)) if R else None
    per_run_deliv = [r.get("delivered", 0) for r in R]

    F = res["facts"]
    F["v2"] = {"idle_with_eligible_bracketed": round(idle_e, 3) if idle_e is not None else None,
               "idle_share_all": round(idle_all, 3) if idle_all is not None else None,
               "egress_run_vs_gap": egress, "rider_rate_in_runs": round(rider_run, 2) if rider_run else None,
               "rider_rate_overall": round(rider_all, 2) if rider_all else None,
               "delivered_per_run_p50": v1.pct(per_run_deliv, .5), "delivered_per_run_max": max(per_run_deliv, default=None),
               "run_start_offsets_mod_10s": sorted({round((r["start"] - R[0]["start"]) / 1000 % 10, 1) for r in R})[:12]}

    H = {}
    if idle_e is None:
        H["H1_drain_loop"] = {"verdict": "غير محسوم"}
    else:
        H["H1_drain_loop"] = {"idle_with_eligible": round(idle_e, 3),
                              "verdict": "مدعوم" if idle_e >= H1_IDLE_SUPPORT else "مرفوض" if idle_e < H1_IDLE_REFUTE else "غير محسوم"}
    req = F["pgss"]["congestion_requeue_share_of_claims"]
    cap_bind = rider_run is not None and rider_run >= CAP_FRACTION * BOT_BUDGET_PER_SEC
    H["H5_cap_in_runs"] = {"rider_rate_in_runs": F["v2"]["rider_rate_in_runs"], "threshold": CAP_FRACTION * BOT_BUDGET_PER_SEC,
                           "verdict": "غير محسوم" if rider_run is None else "مدعوم" if cap_bind else "مرفوض"}
    H["H2_sender_requeue_independent"] = {
        "requeue_share_of_claims": req, "cap_binding_in_runs": cap_bind,
        "verdict": ("غير محسوم" if req is None or rider_run is None
                    else "مدعوم" if req >= H2_REQUEUE_SHARE and not cap_bind else "مرفوض"),
        "note": "الإعادةُ مع دلوٍ مشبَعٍ نتيجةٌ للسقف لا سببٌ مستقلّ" if cap_bind else None}
    mock429 = sum(1 for m in d["mock"] if m.get("status") == 429)
    errc = sum(F["rows"]["error_code_counts"].values())
    tg = res["hypotheses"]["H3_retry_ack"]["telegram_delivered"]
    H["H3_retry_ack"] = {"mock_429": mock429, "rows_with_error_code": errc, "telegram_delivered": tg,
                         "verdict": "غير محسوم" if not tg else "مدعوم" if (mock429 + errc) / tg >= H3_RETRY_SHARE else "مرفوض"}
    ok = F["p7_tool"]["oldestPendingKind"]
    H["H4_lifecycle_kind"] = {"oldestPendingKind": ok,
                              "verdict": "غير محسوم" if ok is None else "مرفوض" if ok == "rider_trip_notice" else "مدعوم"}
    sup = [k for k, v in H.items() if v["verdict"] == "مدعوم"]
    H["H6_mixed_or_other"] = {"supported": sup, "verdict": "مختلط" if len(sup) > 1 else "واحدة" if sup else "لا شيء"}
    res["hypotheses_v1_as_computed"] = res.pop("hypotheses")
    res["b33_choice_rule_v1_as_computed"] = res.pop("b33_choice_rule")
    res["hypotheses"] = H

    C = res["completeness"]
    if not C["complete"]:
        ch = {"decision": "NOT_READY", "why": "بياناتٌ ناقصة (§7.1 من PROTOCOL-b33m.md)"}
    elif H["H4_lifecycle_kind"]["verdict"] == "مدعوم":
        ch = {"decision": "LIFECYCLE", "why": f"الأقدمُ «{ok}»"}
    elif H["H2_sender_requeue_independent"]["verdict"] == "مدعوم" and H["H1_drain_loop"]["verdict"] != "مدعوم":
        ch = {"decision": "B33_VARIABLE", "variable": "sender_congestion_requeue"}
    elif H["H1_drain_loop"]["verdict"] == "مدعوم" and H["H2_sender_requeue_independent"]["verdict"] != "مدعوم":
        # إزالةُ الخمولِ ترفعُ المعدّلَ الكليَّ إلى معدّلِ ما داخلَ الدورةِ على الأكثر
        if rider_run is not None and rider_run >= NEEDED_RATE:
            ch = {"decision": "B33_VARIABLE", "variable": "drain_loop_scheduling",
                  "expected_rate_upper": round(rider_run, 2), "needed_rate_750": NEEDED_RATE}
        else:
            ch = {"decision": "NOT_READY", "why": f"معدّلُ ما داخلَ الدورة {rider_run} < اللازمِ {NEEDED_RATE} — إزالةُ الخمولِ وحدَها لا تكفي"}
    elif H["H1_drain_loop"]["verdict"] == "مدعوم" and H["H2_sender_requeue_independent"]["verdict"] == "مدعوم":
        ch = {"decision": "NOT_READY", "why": "H1 وH2 مستقلّتانِ مدعومتانِ معًا"}
    elif H["H5_cap_in_runs"]["verdict"] == "مدعوم":
        ch = {"decision": "OWNER", "why": "السقفُ مُلزِمٌ ولا خمولَ قابلٌ للاسترداد"}
    else:
        ch = {"decision": "NOT_READY", "why": "لا فرضيةَ مدعومة"}
    ch["note_1000"] = "عندَ 1000 يلزمُ ≈27/ث > 25/ث (BATCH-33-READINESS §3) — متوقّفٌ على المالكِ أيًّا كان متغيّرُ 750"
    res["b33_choice_rule"] = ch
    return res


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] != "wave":
        print(__doc__, file=sys.stderr)
        return 2
    print(json.dumps(analyse2(Path(sys.argv[2])), ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())

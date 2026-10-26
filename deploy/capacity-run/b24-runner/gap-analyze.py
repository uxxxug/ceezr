#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""تحليلُ دورةِ LOAD-01-GAP-PROBE (فصلُ فجوةِ العميل/الخادمِ) — وصفيٌّ لا حكمَ سعةٍ.

البروتوكولُ: docs/evidence/capacity/LOAD01-GAP-PROBE-TOOL-20261026/PROTOCOL-load01-gap-probe.md
وملحقُه 1 (docs/evidence/capacity/LOAD01-GAP-PROBE-20261026/PROTOCOL-ANNEX-1.md) المسجَّلُ قبلَ أيِّ موجةٍ.

الأوضاعُ:
  valid <wave> <out.json>                                  بواباتُ الصلاحيةِ المركّبةُ لموجةٍ واحدة
  aa    <AA1> <AA2> <out.json>                             بوابةُ A/A (وصفيّةٌ: |AA1−AA2| ≤ δ لكلِّ حدٍّ)
  ab    <A1> <B1> <B2> <A2> <A3> <B3> <B4> <A4> <out.json> موجاتُ الحكمِ (قاعدةُ الحالاتِ الثلاثِ)

(بوابةُ الكلفةِ ON–OFF–OFF–ON = probe-analyze.py cost دونَ تغييرٍ — «قاعدةُ C2 نفسُها».)

وحدةُ التحليلِ: الطلبُ الفرديُّ المربوطُ بمعرّفِه (X-Request-Id) لمسارِ rides
(‏http_call.label = rides_create ↔ httpgap/httpreq.route = POST /v1/rides). كلُّ مركّبٍ يُحسبُ
منْ حدودِ الطلبِ الواحدِ فقط. الإسنادُ للنافذةِ ببدءِ نداءِ العميلِ (t − elapsedMs، ساعةُ
المضيفِ نفسُه — إسنادٌ لا طرحُ مددٍ عبرَ ساعتينِ). نوافذُ 5ث كاملةٌ داخلَ طورِ الحقنِ
مرساتُها phase.start؛ متوسطُ النافذةِ ثمَّ متوسطُ النوافذِ بأوزانٍ متساويةٍ؛ فروقُ الأزواجِ
الأربعةِ (A1,B1) (A2,B2) (A3,B3) (A4,B4) بأوزانٍ متساويةٍ؛ فاصلٌ مئينيٌّ ببوستربِ الزوجِ
B=2000، 95%. δ = 15.0ms.
"""
import datetime
import gzip
import hashlib
import json
import os
import random
import sys

DELTA_MS = 15.0
WINDOW_MS = 5000.0
MIN_SAMPLES = 2000
BOOTSTRAP_B = 2000
BOOTSTRAP_SEED = 20261026
RIDES_ROUTE = "POST /v1/rides"
RIDES_LABEL = "rides_create"

# الحدودُ المرصودةُ مباشرةً (إزاحاتٌ من ساعةٍ واحدةٍ في كلِّ جانبٍ)
SERVER_BOUNDS = ("fetchMs", "writeHeadMs", "firstWriteMs", "endMs", "finishMs")
CLIENT_BOUNDS = ("ttfbMs", "bodyMs")
# المركّباتُ — كلُّها منْ حدودِ الطلبِ الواحدِ (لا جمعَ عبرَ طلباتٍ)
COMPOSITES = (
    "seg_head",      # writeHeadMs − fetchMs
    "seg_body",      # endMs − writeHeadMs
    "seg_flush",     # finishMs − endMs
    "bridge_over",   # fetchMs − serverMs  (هامشُ الجسرِ فوقَ زمنِ المسارِ)
    "client_total",  # elapsedMs
    "residual",      # elapsedMs − finishMs  (البقايا غيرُ المفصولةِ)
)
ALL_METRICS = SERVER_BOUNDS + CLIENT_BOUNDS + COMPOSITES
AB_PAIRS = (("A1", "B1"), ("A2", "B2"), ("A3", "B3"), ("A4", "B4"))
AB_ORDER = ("A1", "B1", "B2", "A2", "A3", "B3", "B4", "A4")


def resolve(path):
    if not os.path.exists(path) and os.path.exists(path + ".gz"):
        return path + ".gz"
    return path


def sha256_file(path):
    h = hashlib.sha256()
    with open(resolve(path), "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def read_jsonl_counting(path):
    """(rows, unreadable) — الأسطرُ غيرُ القابلةِ للقراءةِ تُعدُّ ولا تُحذفُ بصمت."""
    p = resolve(path)
    if not os.path.exists(p):
        raise SystemExit(f"INPUT_MISSING {path}")
    opener = gzip.open if p.endswith(".gz") else open
    rows, bad = [], 0
    with opener(p, "rt", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except ValueError:
                bad += 1
    return rows, bad


def iso_ms(s):
    return datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() * 1000.0


def num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def diff(a, b):
    return None if a is None or b is None else a - b


class Wave:
    def __init__(self, wave_dir):
        self.dir = wave_dir
        self.name = os.path.basename(wave_dir.rstrip("/"))
        ev_p = os.path.join(wave_dir, "miniapp-load-events.jsonl")
        le_p = os.path.join(wave_dir, "load-events.jsonl")
        tr_p = os.path.join(wave_dir, "load-trace.jsonl")
        with open(os.path.join(wave_dir, "gap-input-sha256sums.txt"), "w", encoding="utf-8") as hf:
            for p in (ev_p, le_p, tr_p):
                hf.write(f"{sha256_file(p)}  {os.path.basename(resolve(p))}\n")
        ev, self.bad_phase_lines = read_jsonl_counting(ev_p)
        le, self.bad_event_lines = read_jsonl_counting(le_p)
        tr, self.bad_trace_lines = read_jsonl_counting(tr_p)

        ph = {}
        self.phase_dup = 0
        for r in ev:
            e = r.get("event")
            if e in ("phase.start", "phase.drain_start", "phase.end"):
                if e in ph:
                    self.phase_dup += 1
                ph[e] = iso_ms(r["t"])
        self.t0 = ph.get("phase.start")
        self.drain0 = ph.get("phase.drain_start")
        self.end0 = ph.get("phase.end")

        self.calls, self.call_dup, self.call_noid = {}, 0, 0
        self.call_rows = 0
        pct_by_gen = {}  # آخرُ لقطةِ مئيناتٍ لكلِّ (مسار، مولّد) تحملُ rides_create
        for r in le:
            if r.get("event") == "latency_percentiles":
                v = r.get(RIDES_LABEL)
                if isinstance(v, dict):
                    pct_by_gen[(r.get("path"), r.get("gen"))] = v.get("n")
            if r.get("event") != "http_call" or r.get("label") != RIDES_LABEL:
                continue
            self.call_rows += 1
            rid = r.get("requestId")
            if not rid:
                self.call_noid += 1
                continue
            if rid in self.calls:
                self.call_dup += 1
                continue
            self.calls[rid] = r
        self.pct_n = sum(pct_by_gen.values()) if pct_by_gen else None

        self.gaps, self.gap_dup, self.gap_noid, self.gap_rows = {}, 0, 0, 0
        self.reqs, self.req_dup, self.req_noid, self.req_rows = {}, 0, 0, 0
        self.other_gap_rows = 0
        for r in tr:
            k = r.get("k")
            if k not in ("httpgap", "httpreq"):
                continue
            if r.get("route") != RIDES_ROUTE:
                if k == "httpgap":
                    self.other_gap_rows += 1
                continue
            rid = r.get("requestId")
            if k == "httpgap":
                self.gap_rows += 1
                store, dup_attr, noid_attr = self.gaps, "gap_dup", "gap_noid"
            else:
                self.req_rows += 1
                store, dup_attr, noid_attr = self.reqs, "req_dup", "req_noid"
            if not rid:
                setattr(self, noid_attr, getattr(self, noid_attr) + 1)
                continue
            if rid in store:
                setattr(self, dup_attr, getattr(self, dup_attr) + 1)
                continue
            store[rid] = r

        verified = None
        wr = os.path.join(wave_dir, "wave-report.json")
        if os.path.exists(wr):
            with open(wr, encoding="utf-8") as f:
                verified = json.load(f).get("verified")
        self.verified = verified
        self._build_samples()

    def _build_samples(self):
        self.samples = []
        self.unmatched_gap = sum(1 for k in self.gaps if k not in self.calls)
        self.unmatched_req = sum(1 for k in self.reqs if k not in self.calls)
        self.call_without_gap = sum(1 for k in self.calls if k not in self.gaps)
        self.call_without_req = sum(1 for k in self.calls if k not in self.reqs)
        self.ok_but_gap_hole = 0  # ردٌّ سليمٌ عندَ العميلِ وحدٌّ خادميٌّ معدومٌ أو اتصالٌ مغلق
        self.outside_phases = 0
        for rid, c in self.calls.items():
            g = self.gaps.get(rid)
            q = self.reqs.get(rid)
            el = num(c.get("elapsedMs"))
            end_t = iso_ms(c["t"]) if c.get("t") else None
            start = None if (end_t is None or el is None) else end_t - el
            if start is None or self.t0 is None or self.end0 is None or not (self.t0 <= start <= self.end0):
                self.outside_phases += 1
            s = {"rid": rid, "start": start, "status": c.get("status")}
            for b in CLIENT_BOUNDS:
                s[b] = num(c.get(b))
            for b in SERVER_BOUNDS:
                s[b] = num(g.get(b)) if g else None
            server_ms = num(q.get("serverMs")) if q else None
            s["seg_head"] = diff(s["writeHeadMs"], s["fetchMs"])
            s["seg_body"] = diff(s["endMs"], s["writeHeadMs"])
            s["seg_flush"] = diff(s["finishMs"], s["endMs"])
            s["bridge_over"] = diff(s["fetchMs"], server_ms)
            s["client_total"] = el
            s["residual"] = diff(el, s["finishMs"])
            st = c.get("status")
            if isinstance(st, int) and 200 <= st < 300 and (g is None or g.get("closed") or s["finishMs"] is None):
                self.ok_but_gap_hole += 1
            self.samples.append(s)

    # ---------- بواباتُ الصلاحيةِ المركّبةُ ----------
    def validity(self):
        reasons = []
        phases_ok = (self.t0 is not None and self.drain0 is not None and self.end0 is not None
                     and self.t0 < self.drain0 < self.end0 and self.phase_dup == 0)
        if not phases_ok:
            reasons.append("حدودُ الأطوارِ الثلاثةُ غائبةٌ أو غيرُ مرتّبةٍ أو مكرّرة")
        if self.bad_phase_lines or self.bad_event_lines or self.bad_trace_lines:
            reasons.append(f"أسطرٌ غيرُ قابلةٍ للقراءةِ (أطوار={self.bad_phase_lines} أحداث={self.bad_event_lines} أثر={self.bad_trace_lines})")
        if not (self.call_rows == self.pct_n == self.verified):
            reasons.append(f"عدُّ rides_create غيرُ متطابقٍ: http_call={self.call_rows} مئينات={self.pct_n} متحقّقة={self.verified}")
        if self.call_noid or self.gap_noid or self.req_noid:
            reasons.append(f"صفوفٌ بلا معرّف (عميل={self.call_noid} httpgap={self.gap_noid} httpreq={self.req_noid})")
        if self.call_dup or self.gap_dup or self.req_dup:
            reasons.append(f"معرّفاتٌ مكرّرة (عميل={self.call_dup} httpgap={self.gap_dup} httpreq={self.req_dup})")
        if self.unmatched_gap or self.unmatched_req:
            reasons.append(f"سطورٌ خادميّةٌ بلا نداءِ عميل (httpgap={self.unmatched_gap} httpreq={self.unmatched_req})")
        if self.call_without_gap or self.call_without_req:
            reasons.append(f"نداءاتُ عميلٍ بلا سطرٍ خادميّ (بلا httpgap={self.call_without_gap} بلا httpreq={self.call_without_req})")
        if self.outside_phases:
            reasons.append(f"عيّناتٌ خارجَ حدودِ الأطوار={self.outside_phases}")
        if self.gap_rows == 0:
            reasons.append("لا سطورَ httpgap لمسارِ rides — الأداةُ غيرُ مفعّلة")
        return {
            "wave": self.name,
            "valid": not reasons,
            "reasons": reasons,
            "counts": {
                "rides_http_call": self.call_rows, "latency_percentiles_n": self.pct_n,
                "verified": self.verified, "httpgap_rides": self.gap_rows,
                "httpreq_rides": self.req_rows, "httpgap_other_routes": self.other_gap_rows,
                "linked": len(self.samples), "ok_but_gap_hole": self.ok_but_gap_hole,
            },
            "note": "الربطُ الفرديُّ يُطبَّقُ على مسارِ rides (مجالُ δ)؛ سطورُ المساراتِ الأخرى معدودةٌ وصفيًّا (ملحق 1 §3).",
        }

    # ---------- المتوسطُ الشرطيُّ ----------
    def windows(self):
        out, s = [], self.t0
        while s + WINDOW_MS <= self.drain0:
            out.append((s, s + WINDOW_MS))
            s += WINDOW_MS
        return out

    def conditional_mean(self, metric):
        """(متوسطُ النوافذِ بأوزانٍ متساويةٍ، عددُ العيّناتِ المستعملةِ، عددُ النوافذِ)."""
        wins = self.windows()
        sums = [0.0] * len(wins)
        cnts = [0] * len(wins)
        for s in self.samples:
            v = s.get(metric)
            if v is None or s["start"] is None:
                continue
            i = int((s["start"] - self.t0) // WINDOW_MS)
            if 0 <= i < len(wins):
                sums[i] += v
                cnts[i] += 1
        vals = [sums[i] / cnts[i] for i in range(len(wins)) if cnts[i] > 0]
        if not vals:
            return None, 0, 0
        return sum(vals) / len(vals), sum(cnts), len(vals)


def three_case(lo, hi, delta=DELTA_MS):
    if lo is None or hi is None:
        return "غيرُ_محسوم"
    if -delta < lo and hi < delta:
        return "متّسق"
    if lo >= delta:  # الفاصلُ كلُّه وراءَ +δ (B أبطأُ)
        return "تفسيرٌ_سلوكيٌّ_مطلوب"
    return "غيرُ_محسوم"


def percentile(vals, q):
    v = sorted(vals)
    i = (len(v) - 1) * q
    lo, hi = int(i), min(int(i) + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (i - lo)


def bootstrap_pairs(diffs, rng):
    n = len(diffs)
    point = sum(diffs) / n
    means = []
    for _ in range(BOOTSTRAP_B):
        pick = [diffs[rng.randrange(n)] for _ in range(n)]
        means.append(sum(pick) / n)
    return point, percentile(means, 0.025), percentile(means, 0.975)


def write(out_path, obj):
    print(json.dumps(obj, ensure_ascii=False, indent=1))
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)


def mode_valid(wave_dir, out_path):
    v = Wave(wave_dir).validity()
    write(out_path, v)
    return v


def mode_aa(aa1, aa2, out_path):
    w1, w2 = Wave(aa1), Wave(aa2)
    v1, v2 = w1.validity(), w2.validity()
    detail, ok = {}, v1["valid"] and v2["valid"]
    for m in SERVER_BOUNDS + CLIENT_BOUNDS:
        m1, n1, _ = w1.conditional_mean(m)
        m2, n2, _ = w2.conditional_mean(m)
        d = None if (m1 is None or m2 is None) else m2 - m1
        enough = n1 >= MIN_SAMPLES and n2 >= MIN_SAMPLES
        rule = "إعادةُ_إنتاجٍ_ضمنَ_±δ" if (d is not None and abs(d) <= DELTA_MS and enough) else "قابليةُ_إعادةِ_الإنتاجِ_غيرُ_مثبتة"
        if rule != "إعادةُ_إنتاجٍ_ضمنَ_±δ":
            ok = False
        detail[m] = {"AA1": m1, "AA2": m2, "d": d, "n1": n1, "n2": n2, "rule": rule}
    res = {
        "mode": "aa", "delta_ms": DELTA_MS, "min_samples": MIN_SAMPLES,
        "delta_domain": "δ قيستْ لمتوسطاتٍ شرطيّةٍ لمسارِ rides في نفسِ الإعدادِ (C2)",
        "validity": [v1, v2], "detail": detail,
        "verdict": "إعادةُ_إنتاجٍ_ضمنَ_±δ" if ok else "قابليةُ_إعادةِ_الإنتاجِ_غيرُ_مثبتة",
        "note": "وصفيٌّ بلا فاصلٍ: زوجٌ واحدٌ لا يُعادُ اغترافُه (ملحق C2 §2، موروث).",
    }
    write(out_path, res)
    return res


def mode_ab(wave_dirs, out_path):
    waves = dict(zip(AB_ORDER, (Wave(d) for d in wave_dirs)))
    validity = {k: w.validity() for k, w in waves.items()}
    all_valid = all(v["valid"] for v in validity.values())
    rng = random.Random(BOOTSTRAP_SEED)
    per_metric = {}
    for m in ALL_METRICS:
        means = {k: w.conditional_mean(m) for k, w in waves.items()}
        ns = {k: means[k][1] for k in waves}
        enough = all(n >= MIN_SAMPLES for n in ns.values())
        diffs = []
        for a, b in AB_PAIRS:
            ma, mb = means[a][0], means[b][0]
            if ma is not None and mb is not None:
                diffs.append(mb - ma)
        if len(diffs) == len(AB_PAIRS):
            point, lo, hi = bootstrap_pairs(diffs, rng)
        else:
            point = lo = hi = None
        rule = three_case(lo, hi) if enough else "غيرُ_محسوم"
        per_metric[m] = {
            "wave_means": {k: means[k][0] for k in waves}, "samples": ns,
            "pair_diffs_B_minus_A": diffs, "point": point, "ci95": [lo, hi],
            "enough_samples": enough, "rule": rule,
        }
    bounds = SERVER_BOUNDS + CLIENT_BOUNDS + ("seg_head", "seg_body", "seg_flush", "bridge_over")
    behavioral = [m for m in bounds if per_metric[m]["rule"] == "تفسيرٌ_سلوكيٌّ_مطلوب"]
    unresolved = [m for m in bounds if per_metric[m]["rule"] == "غيرُ_محسوم"]
    residual_rule = per_metric["residual"]["rule"]
    holes = sum(validity[k]["counts"]["ok_but_gap_hole"] for k in waves)
    reasons = []
    if not all_valid:
        reasons.append("إخفاقُ بوابةِ صلاحيةٍ في موجةٍ واحدةٍ على الأقل")
    if residual_rule != "متّسق":
        reasons.append(f"البقايا غيرُ المفصولةِ (elapsedMs − finishMs) فرقُها B−A ليسَ متّسقًا ({residual_rule}) — القصةُ ناقصةٌ لا تُكمَلُ بالتخمين")
    if holes:
        reasons.append(f"ردودٌ سليمةٌ معَ ثغرةِ قياسٍ خادميّةٍ = {holes}")
    if any(not per_metric[m]["enough_samples"] for m in ALL_METRICS):
        reasons.append("عيّناتٌ أقلُّ منَ 2000 لحدٍّ واحدٍ على الأقلِّ في موجةٍ واحدةٍ على الأقل")
    if reasons:
        overall = "غيرُ_محسوم"
    elif behavioral:
        overall = "مرشّحُ_تفسيرٍ_وصفيّ"
    elif not unresolved:
        overall = "كلُّ_الحدودِ_متّسقة_والبقايا_مسمّاةٌ_غيرُ_مفصولة"
    else:
        overall = "غيرُ_محسوم"
    res = {
        "mode": "ab", "delta_ms": DELTA_MS, "min_samples": MIN_SAMPLES,
        "bootstrap": {"B": BOOTSTRAP_B, "seed": BOOTSTRAP_SEED, "unit": "الزوج", "level": 0.95},
        "delta_domain": "δ قيستْ لمتوسطاتٍ شرطيّةٍ لمسارِ rides في نفسِ الإعدادِ (C2)",
        "validity": validity, "metrics": per_metric,
        "behavioral_candidates": behavioral, "unresolved_bounds": unresolved,
        "unresolved_reasons": reasons, "overall": overall,
        "restriction": "لا حكمَ سعةٍ، لا سببيّةَ، لا قرارَ مسارٍ؛ ما قبلَ الجسرِ وما بعدَ finish لا يُنسبُ إليهِ شيءٌ ولا يُبرَّأ.",
    }
    write(out_path, res)
    return res


def main(argv):
    if len(argv) < 2:
        raise SystemExit(__doc__)
    mode = argv[1]
    if mode == "valid" and len(argv) == 4:
        return mode_valid(argv[2], argv[3])
    if mode == "aa" and len(argv) == 5:
        return mode_aa(argv[2], argv[3], argv[4])
    if mode == "ab" and len(argv) == 11:
        return mode_ab(argv[2:10], argv[10])
    raise SystemExit(f"USAGE_ERROR {mode} argc={len(argv)}\n{__doc__}")


if __name__ == "__main__":
    main(sys.argv)

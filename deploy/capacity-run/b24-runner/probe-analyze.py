#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""تحليلُ دورةِ تحقّقِ المستوى 3 (LOAD-01 C2 HTTP-wait probe).

الأوضاعُ:
  strata <waveAA1> <out.json>        حدودُ شرائحِ معدّلِ الوصولِ (معايرةٌ تُجمَّدُ قبلَ ABBA)
  aa     <AA1> <AA2> <out.json>      بوابةُ A/A (وصفيٌّ بلا فاصلٍ استدلاليٍّ)
  cost   <ON1> <OFF1> <OFF2> <ON2> <out.json>   فحصُ كلفةِ الأداةِ (d1, d2 مقابلَ δ)
  ab     <A1> <B1> <B2> <A2> <A3> <B3> <B4> <A4> <out.json>  موجاتُ الحكمِ (H1 + H2)

المصادرُ: load-trace.jsonl[.gz] ‏(pdb / arr1s / pseat) وminiapp-load-events.jsonl[.gz]
‏(phase.start / phase.drain_start / phase.end). الإسنادُ كما في ملحقِ البروتوكولِ (2026-10-26):
نوافذُ 5ث مرساتُها بدءُ الطورِ؛ إسنادُ الحجزِ بwaitStartAt؛ pseat مقيدٌ بالمجمّعِ
gatewayRequest؛ متوسطُ النافذةِ ثمّ متوسطُ النوافذِ بأوزانٍ متساويةٍ؛ نوافذُ بلا مقاعدِ
في الشريحةِ لا تدخلُ في متوسطِ الموجةِ (شرطيُّ غيرُ معرّفٍ)؛ الكلفةُ والانحدارُ H2 على
نوافذِ التفريغِ (إسنادُ اكتمالٍ). δ = 15.0 ms.
"""
import argparse
import gzip
import hashlib
import json
import math
import os
import random
import sys

DELTA_MS = 15.0
WINDOW_MS = 5000.0
RIDES_ROUTE = "POST /v1/rides"
RIDES_PATH = "http:POST /v1/rides"
GATEWAY_POOL = "ceezr:gatewayRequest"
BOOTSTRAP_B = 2000
BOOTSTRAP_SEED = 20261026
MIN_MASS = 0.05  # عتبةُ كتلةِ الشريحةِ (منَ الطلباتِ)


def open_jsonl(path):
    if not os.path.exists(path) and os.path.exists(path + ".gz"):
        path = path + ".gz"
    if path.endswith(".gz"):
        return gzip.open(path, "rt", encoding="utf-8")
    return open(path, "r", encoding="utf-8")


def sha256_file(path):
    if not os.path.exists(path) and os.path.exists(path + ".gz"):
        path = path + ".gz"
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def read_jsonl(path):
    rows = []
    with open_jsonl(path) as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def parse_iso_ms(s):
    # ISO timestamp → epoch ms (UTC، بدون مناطق — مولّدُ المقعدِ يكتبُ محليًّا بنفسِ ساعةِ الأثر)
    import datetime
    return int(datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() * 1000)


class Wave:
    """تحميلُ موجةٍ واحدةٍ وحسابُ مشتقاتِها المشتركةِ."""

    def __init__(self, wave_dir):
        self.dir = wave_dir
        self.name = os.path.basename(wave_dir.rstrip("/"))
        ev = os.path.join(wave_dir, "miniapp-load-events.jsonl")
        tr = os.path.join(wave_dir, "load-trace.jsonl")
        self.input_hashes = {"events": sha256_file(ev), "trace": sha256_file(tr)}
        # بصماتُ المدخلاتِ تُكتبُ في ملفٍّ باسمٍ يُعلنُ نفسَه (sha256sums) لا داخلَ ملفاتِ
        # الحُكمِ: سلسلةُ 64-سداسيّةً داخلَ JSON تُوقِفُ تدقيقَ الأسرارِ (نمطُ base64 الطويلِ)،
        # واسمُ الملفِّ يقعُ في إعفاءِ "بصماتِ السجلِّ" المشروعِ — معَ بقاءِ الفحصِ الحرفيِّ عليه.
        with open(os.path.join(wave_dir, "input-sha256sums.txt"), "w", encoding="utf-8") as hf:
            for _label, _p in (("events", ev), ("trace", tr)):
                hf.write(f"{self.input_hashes[_label]}  {os.path.basename(_p)}\n")
        phases = {}
        for row in read_jsonl(ev):
            if row.get("event") in ("phase.start", "phase.drain_start", "phase.end"):
                phases[row["event"]] = parse_iso_ms(row["t"])
        self.t0 = phases["phase.start"]
        self.drain0 = phases["phase.drain_start"]
        self.end0 = phases["phase.end"]

        # arr1s http: ‏(sec, route) -> n (مجموعُ الدلتا المتأخرةِ) — الصنفُ في حقلِ cls
        self.arr = {}
        self.arr_seconds = 0
        # pdb: flush windows
        self.pdb = []  # {at, path, pool, kind, n, waitSumMs, runSumMs}
        # pseat: rows مقيدةٌ بالمجمّعِ gatewayRequest (kind≠txQuery مضمونٌ في الإصدارِ)
        self.pseat = []
        for row in read_jsonl(tr):
            k = row.get("k")
            if k == "arr1s" and row.get("cls") == "http":
                key = (row["at"], row["name"])
                if key not in self.arr:
                    self.arr_seconds += 1
                self.arr[key] = self.arr.get(key, 0) + row.get("n", 0)
            elif k == "pdb":
                self.pdb.append(row)
            elif k == "pseat" and row.get("pool") == GATEWAY_POOL:
                self.pseat.append(row)

        # تشغيلُ المجسّ لا «صفرٌ»: موجةٌ بلا أيّ صفِّ arr1s ‏http = عطبُ أداةٍ لا معدلٌ صفريّ
        if not self.arr and self.pseat:
            raise SystemExit(f"ARR1S_MISSING {self.name}: لا صفوفِ وصولٍ http — عطبُ تسجيلٍ لا صفرٌ")

        self._windows = None

    # ---------- نوافذُ الطورِ ----------
    def windows(self, phase):
        """نوافذُ 5ث كاملةٌ داخلَ الطورِ: ‏(start, end) — قائمةٌ تُخزَّنُ."""
        if phase == "injection":
            lo, hi = self.t0, self.drain0
        elif phase == "drain":
            lo, hi = self.drain0, self.end0
        else:
            raise ValueError(phase)
        out = []
        s = lo
        while s + WINDOW_MS <= hi:
            out.append((s, s + WINDOW_MS))
            s += WINDOW_MS
        return out

    # ---------- معدّلُ الوصولِ ----------
    def arr_window_total(self, wstart, wend, cls=None):
        """‏cls=None يعني جملَ صنفِ http. إسنادُ دلوِ الثانيةِ لموضعِ بدايتِه — كلُّ دلوٍ يُحسبُ مرةً واحدةً (لا ازدواجُ ثانيةِ الحدِّ بينَ نافذتينِ متجاورتينِ)."""
        total = 0
        sec = math.ceil(wstart / 1000.0) * 1000
        while sec < wend:
            for (at, name), n in self.arr.items():
                if at == sec and (cls is None or route_cls(name) == cls):
                    total += n
            sec += 1000
        return total

    def arr_rate(self, wstart, wend, cls=None):
        return self.arr_window_total(wstart, wend, cls) / (WINDOW_MS / 1000.0)

    # ---------- المتوسطُ الشرطيُّ (pseat) ----------
    def pseat_cls(self, row):
        p = row.get("path", "")
        return "rides" if p == RIDES_PATH else "other"

    def window_waits(self, phase, cls):
        """لكلِّ نافذةٍ: (window_start, [waitMs...]) للصفوفِ المنسوبةِ بwaitStartAt."""
        out = []
        for (ws, we) in self.windows(phase):
            waits = [r["waitMs"] for r in self.pseat
                     if ws <= r["waitStartAt"] < we and self.pseat_cls(r) == cls]
            out.append((ws, we, waits))
        return out

    def conditional_mean(self, phase, cls, stratum=None):
        """متوسطُ النوافذِ (بأوزانٍ متساويةٍ) للمقاعدِ في الشريحةِ؛ None إن لا نوافذَ ببيانات."""
        boundaries = stratum.boundaries[cls] if stratum else (MIN, MAX)
        vals = []
        for ws, we, waits in self.window_waits(phase, cls):
            if not waits:
                continue
            if stratum is not None:
                rate = self.arr_rate(ws, we, cls)
                if not in_stratum(rate, boundaries, stratum.tercile):
                    continue
            vals.append(sum(waits) / len(waits))
        if not vals:
            return None, 0
        return sum(vals) / len(vals), len(vals)

    # ---------- الكلفةُ (pdb، نافذةُ تفريغٍ) ----------
    def flush_cost_windows(self):
        """نوافذُ التفريغِ الكاملةُ داخلَ طورِ الحقنِ: rides ‏gatewayRequest (kind≠txQuery)."""
        rows = [r for r in self.pdb
                if r.get("path") == RIDES_PATH and r.get("pool") == GATEWAY_POOL
                and r.get("kind") != "txQuery"
                and self.t0 + WINDOW_MS <= r["at"] <= self.drain0]
        per_at = {}
        for r in rows:
            a = per_at.setdefault(r["at"], {"n": 0, "w": 0.0})
            a["n"] += r.get("n", 0)
            a["w"] += r.get("waitSumMs", 0.0)
        out = []
        for at in sorted(per_at):
            if per_at[at]["n"] > 0:
                out.append((at, per_at[at]["w"] / per_at[at]["n"]))
        return out

    def cost_metric(self):
        w = self.flush_cost_windows()
        if not w:
            return None, 0
        return sum(v for _, v in w) / len(w), len(w)

    # ---------- H2: نافذةُ تفريغٍ ----------
    def h2_rows(self):
        """‏(wait, drainerSec, arrRate) لكلِّ نافذةِ تفريغٍ مغطّاةٍ داخلَ طورِ الحقنِ.
        نافذةٌ مغطّاةٌ = لها صفوفُ pdb (وجودُ الرصدِ)، والحجوزاتُ على مساراتِ الدرينرِ فيها
        صفرٌ معلنٌ لا غيابٌ (الأداةُ تعملُ في الموجةِ) — يُفصَلُ الغيابُ الكاملُ في الوضعِ ab."""
        drain_any = any(r.get("path", "").startswith("drainer:") for r in self.pdb)
        # ثواني-مقاعدِ الدرينر: Σ runSumMs لمساراتِ drainer:* ‏(gatewayRequest)
        drain_per_at = {}
        for r in self.pdb:
            if r.get("path", "").startswith("drainer:") and r.get("pool") == GATEWAY_POOL \
               and r.get("kind") != "txQuery" and self.t0 + WINDOW_MS <= r["at"] <= self.drain0:
                drain_per_at[r["at"]] = drain_per_at.get(r["at"], 0.0) + r.get("runSumMs", 0.0)
        # انتظارُ rides ‏(waitSumMs/n) ونافذتُه
        wait_per_at = {}
        for r in self.pdb:
            if r.get("path") == RIDES_PATH and r.get("pool") == GATEWAY_POOL \
               and r.get("kind") != "txQuery" and self.t0 + WINDOW_MS <= r["at"] <= self.drain0:
                a = wait_per_at.setdefault(r["at"], {"n": 0, "w": 0.0})
                a["n"] += r.get("n", 0)
                a["w"] += r.get("waitSumMs", 0.0)
        rows = []
        zero_windows = 0
        for at in sorted(wait_per_at):
            if wait_per_at[at]["n"] > 0:
                if at in drain_per_at:
                    dsec = drain_per_at[at] / 1000.0
                elif drain_any:
                    dsec = 0.0  # نافذةٌ مغطّاةٌ بلا حجوزاتِ درينر = صفرٌ حقيقيٌّ معلن
                    zero_windows += 1
                else:
                    continue  # لا دليلَ على عملِ المجسّ — لا يُفترضُ صفرًا
                rate = self.arr_rate(at - WINDOW_MS, at, cls=None)  # جملُ صنفِ http
                rows.append({
                    "at": at,
                    "wait": wait_per_at[at]["w"] / wait_per_at[at]["n"],
                    "drainerSec": dsec,
                    "arrRate": rate,
                })
        self.h2_zero_windows = zero_windows
        self.h2_drainer_instrumented = drain_any
        return rows


MIN = float("-inf")
MAX = float("inf")


def route_cls(name):
    return "rides" if name == RIDES_ROUTE else "other"


def in_stratum(rate, boundaries, tercile):
    lo, hi = boundaries
    if lo == hi:
        # حدّانِ متطابقانِ ⇒ يُدمجانِ: شريحتانِ (r < b) و(r ≥ b) — لا إلغاءَ للتوزيعِ
        if tercile == 0:
            return rate < lo
        if tercile == 1:
            return rate >= lo
        return False
    if tercile == 0:
        return rate < lo
    if tercile == 1:
        return lo <= rate <= hi
    return rate > hi


class Strata:
    """حدودُ معايرةٍ مجمّدةٌ: لكلِّ صنفٍّ (rides/other) حدّانِ (تُطبَّقُ على الطورين)."""

    def __init__(self, boundaries, meta):
        self.boundaries = boundaries  # {"rides": (lo, hi), "other": (lo, hi)}
        self.tercile = 1
        self.meta = meta

    @classmethod
    def calibrate(cls, wave):
        boundaries = {}
        for c in ("rides", "other"):
            rates = []
            for (ws, we) in wave.windows("injection"):
                rates.append(wave.arr_rate(ws, we, c))
            rates.sort()
            n = len(rates)
            if n < 3:
                boundaries[c] = (MIN, MAX)
                continue
            lo = rates[max(0, (n - 1) // 3)]
            hi = rates[max(0, 2 * (n - 1) // 3)]
            boundaries[c] = (lo, hi)  # التطابقُ يُدمجُ في شريحتينِ (انظر in_stratum)
        meta = {
            "wave": wave.name,
            "input_hashes_file": "input-sha256sums.txt",
            "injection_windows": {c: len(wave.windows("injection")) for c in ("rides", "other")},
        }
        return cls(boundaries, meta)

    def label(self, cls, tercile):
        return f"{cls}#{tercile}"


def wave_http_total(wave):
    """جملُ طلباتِ http في الموجةِ (مقامُ عتبةِ الكتلةِ — منَ الطلباتِ لا الحجوزاتِ)."""
    return sum(n for (_, _), n in wave.arr.items())


def wave_requests(wave, phase, cls):
    """إجماليُّ طلباتِ الصنفِ في نوافذِ الطورِ (من arr1s — عتبةُ الكتلةِ منَ الطلباتِ)."""
    total = 0
    for (ws, we) in wave.windows(phase):
        total += wave.arr_window_total(ws, we, cls)
    return total


def stratum_requests(wave, phase, cls, strata, tercile):
    b = strata.boundaries[cls]
    total = 0
    for (ws, we) in wave.windows(phase):
        rate = wave.arr_rate(ws, we, cls)
        if in_stratum(rate, b, tercile):
            total += wave.arr_window_total(ws, we, cls)
    return total


def three_case_rule(point, lo, hi, delta=DELTA_MS):
    inside = (lo >= -delta) and (hi <= delta)
    beyond = (lo > delta) or (hi < -delta)
    if inside:
        return "محسوم_بأنّ_الأثر_على_المتوسطِ_الشرطيِّ_محدودٌ_بـ±δ"
    if beyond:
        return "محسوم_بأنّ_الأثرَ_على_المتوسطِ_الشرطيِّ_عمليٌّ_متبقٍّ"
    return "غيرُ_محسومٍ_على_الشرطيِّ_السطحيِّ_لتقاطعِ_الفاصلِ_عتبةَ_δ"


def percentile_interval(vals, p=(2.5, 97.5)):
    if not vals:
        return None, None
    s = sorted(vals)
    def pct(q):
        idx = q * (len(s) - 1)
        lo_i = int(math.floor(idx))
        hi_i = int(math.ceil(idx))
        if lo_i == hi_i:
            return s[lo_i]
        return s[lo_i] + (s[hi_i] - s[lo_i]) * (idx - lo_i)
    return pct(p[0] / 100.0), pct(p[1] / 100.0)


def mean(xs):
    return sum(xs) / len(xs) if xs else None


# ============================ الوضعُ: strata ============================
def mode_strata(wave_dir, out_path):
    w = Wave(wave_dir)
    s = Strata.calibrate(w)
    payload = {
        "mode": "strata",
        "wave": w.name,
        "input_hashes_file": "input-sha256sums.txt",
        "phase_epochs_ms": {"start": w.t0, "drain": w.drain0, "end": w.end0},
        "boundaries": {c: (None if s.boundaries[c][0] == MIN else s.boundaries[c][0],
                           None if s.boundaries[c][1] == MAX else s.boundaries[c][1])
                       for c in ("rides", "other")},
        "injection_window_count": len(w.windows("injection")),
        "drain_window_count": len(w.windows("drain")),
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    print(json.dumps(payload, ensure_ascii=False, indent=1))
    return payload


def load_strata(path):
    with open(path, "r", encoding="utf-8") as f:
        d = json.load(f)
    b = {c: (d["boundaries"][c][0] if d["boundaries"][c][0] is not None else MIN,
             d["boundaries"][c][1] if d["boundaries"][c][1] is not None else MAX)
         for c in ("rides", "other")}
    return Strata(b, d)


# ============================ الوضعُ: aa ============================
def mode_aa(aa1_dir, aa2_dir, out_path):
    w1, w2 = Wave(aa1_dir), Wave(aa2_dir)
    result = {
        "mode": "aa",
        "waves": [w1.name, w2.name],
        "delta_ms": DELTA_MS,
        "input_hashes_file": "input-sha256sums.txt (في دليل كل موجة)",
        "metrics": {},
    }
    a1, n1 = w1.conditional_mean("injection", "rides")
    a2, n2 = w2.conditional_mean("injection", "rides")
    d = None if (a1 is None or a2 is None) else a2 - a1
    rides = {
        "AA1_conditional_mean_ms": a1, "AA2_conditional_mean_ms": a2,
        "windows_with_data": [n1, n2],
        "A_minus_A_ms": d,
        "rule": None,
    }
    if d is not None:
        rides["rule"] = ("إعادةُ_إنتاجٍ_ضمنَ_±δ" if abs(d) <= DELTA_MS
                         else "قابليةُ_إعادةِ_الإنتاجِ_غيرُ_مثبتة")
    result["metrics"]["rides_conditional_mean"] = rides
    # وصفيٌّ: بقيةُ المجسّاتِ
    for c in ("rides", "other"):
        for ph in ("injection", "drain"):
            m1, _ = w1.conditional_mean(ph, c)
            m2, _ = w2.conditional_mean(ph, c)
            result["metrics"][f"descriptive_{c}_{ph}"] = [m1, m2]
    verdict = rides["rule"]
    result["verdict"] = verdict
    print(json.dumps(result, ensure_ascii=False, indent=1))
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    return result


# ============================ الوضعُ: cost ============================
def mode_cost(on1_dir, off1_dir, off2_dir, on2_dir, out_path):
    waves = [Wave(d) for d in (on1_dir, off1_dir, off2_dir, on2_dir)]
    names = ["ON1", "OFF1", "OFF2", "ON2"]
    vals = []
    detail = []
    for nm, w in zip(names, waves):
        v, nw = w.cost_metric()
        vals.append(v)
        detail.append({"wave": nm, "dir": w.name, "cost_metric_ms": v,
                      "flush_windows": nw, "input_hashes_file": "input-sha256sums.txt"})
    d1 = None if (vals[0] is None or vals[1] is None) else vals[0] - vals[1]
    d2 = None if (vals[2] is None or vals[3] is None) else vals[3] - vals[2]
    rule = None
    if d1 is not None and d2 is not None:
        if abs(d1) <= DELTA_MS and abs(d2) <= DELTA_MS:
            rule = "كلفةٌ_محدودةٌ_بـ±δ"
        elif (d1 > DELTA_MS and d2 > DELTA_MS) or (d1 < -DELTA_MS and d2 < -DELTA_MS):
            rule = "الأداةُ_ملوّثةٌ_للقياس"
        else:
            rule = "غيرُ_محسوم"
    result = {
        "mode": "cost", "delta_ms": DELTA_MS, "detail": detail,
        "d1_ms": d1, "d2_ms": d2, "verdict": rule,
        "note": "أثرُ إضافةِ الأداةِ كاملةً (التنفيذُ والذاكرةُ والكتابةُ) على انتظارِ "
                "gatewayRequest لمسارِ rides — نافذةُ تفريغٍ، طورُ الحقنِ فقط.",
    }
    print(json.dumps(result, ensure_ascii=False, indent=1))
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    return result


# ============================ الوضعُ: ab ============================
class Stratum:
    def __init__(self, strata, tercile):
        self.boundaries = strata.boundaries
        self.tercile = tercile


def _pair_differences(waves, strata, cls, phase, tercile):
    """فروقُ الأزواجِ (B−A) لكلِّ زوجٍ كاملِ البياناتِ في الشريحةِ — اتجاهٌ موحّدٌ B−A."""
    pair_ab = [(0, 1), (3, 2), (4, 5), (7, 6)]  # ‏(موجةُ A، موجةُ B)
    pairs = []
    for ai, bi in pair_ab:
        ma, _ = waves[ai].conditional_mean(phase, cls, Stratum(strata, tercile))
        mb, _ = waves[bi].conditional_mean(phase, cls, Stratum(strata, tercile))
        if ma is not None and mb is not None:
            pairs.append(mb - ma)
    return pairs


def _bootstrap_pairs(pairs, rng):
    if not pairs:
        return None, None, None
    point = mean(pairs)
    draws = []
    for _ in range(BOOTSTRAP_B):
        sample = [pairs[rng.randrange(len(pairs))] for _ in pairs]
        draws.append(mean(sample))
    lo, hi = percentile_interval(draws)
    return point, lo, hi


def _ols(y, X):
    """أقلَّ المربعاتِ العاديةِ (غيرُ الموزونِ): يعيدُ معاملاتِ [b0, b1, ...]."""
    k = len(X[0])
    # المعادلاتُ الطبيعيةُ: (X'X) b = X'y — حَلٌّ بجَوسٍ
    import copy
    A = [[sum(X[r][i] * X[r][j] for r in range(len(X))) for j in range(k)] for i in range(k)]
    b = [sum(X[r][i] * y[r] for r in range(len(X))) for i in range(k)]
    # جَوسُ بالعمودِ المُختارِ
    M = [A[i][:] + [b[i]] for i in range(k)]
    for col in range(k):
        piv = max(range(col, k), key=lambda r: abs(M[r][col]))
        if abs(M[piv][col]) < 1e-12:
            return None
        M[col], M[piv] = M[piv], M[col]
        pv = M[col][col]
        M[col] = [v / pv for v in M[col]]
        for r in range(k):
            if r != col and abs(M[r][col]) > 1e-15:
                factor = M[r][col]
                M[r] = [M[r][j] - factor * M[col][j] for j in range(k + 1)]
    return [M[i][k] for i in range(k)]


def mode_ab(wave_dirs, out_path, strata_path):
    waves = [Wave(d) for d in wave_dirs]
    strata = load_strata(strata_path)
    rng = random.Random(BOOTSTRAP_SEED)
    result = {
        "mode": "ab", "delta_ms": DELTA_MS,
        "strata_meta": strata.meta,
        "waves": [w.name for w in waves],
        "input_hashes_file": "input-sha256sums.txt (في دليل كل موجة)",
        "h1": {}, "h2": {},
    }
    # ---------- H1 ----------
    a_waves = [waves[0], waves[3], waves[4], waves[7]]
    total_http = sum(wave_http_total(w) for w in a_waves)
    for cls in ("rides", "other"):
        for phase in ("injection", "drain"):
            for tercile in (0, 1, 2):
                key = f"{cls}|{phase}|t{tercile}"
                # كتلةُ الشريحةِ: نسبةُ مجاميعٍ على موجاتِ A — مقامُها جملُ طلباتِ http (لا الحجوزات)
                sreq = sum(stratum_requests(w, phase, cls, strata, tercile) for w in a_waves)
                mass = (sreq / total_http) if total_http else 0.0
                pairs = _pair_differences(waves, strata, cls, phase, tercile)
                entry = {
                    "mass_of_requests": mass,
                    "reported": mass >= MIN_MASS,
                    "pairs": pairs,
                    "pair_count": len(pairs),
                    "point_ms": None,
                    "ci_ms": [None, None],
                }
                if len(pairs) < 4:
                    # الأزواجُ المسجّلةُ أربعةٌ: نقصُها في شريحةٍ = غيرُ قابلٍ للحسمِ،
                    # لا اغترافُ ما بقي فيُصدرُ حكمًا حاسمًا بعدَ إسقاطٍ صامتٍ
                    entry["rule"] = ("غيرُ_قابلٍ_للحسم_نقصُ_الأزواجِ" if pairs
                                     else "لا_بيانات")
                elif not entry["reported"]:
                    entry["rule"] = "دونَ_عتبةِ_الكتلة_لا_يُعرضُ_حكمُها"
                    point, lo, hi = _bootstrap_pairs(pairs, rng)
                    entry["point_ms"] = point
                    entry["ci_ms"] = [lo, hi]
                else:
                    point, lo, hi = _bootstrap_pairs(pairs, rng)
                    entry["point_ms"] = point
                    entry["ci_ms"] = [lo, hi]
                    entry["rule"] = three_case_rule(point, lo, hi)
                result["h1"][key] = entry
    # ---------- H2 ----------
    # أزواجُ الموجاتِ: (A, B) بالترتيبِ A1B1, B2A2, A3B3, B4A4
    pair_idx = [(0, 1), (3, 2), (4, 5), (7, 6)]  # ‏(A, B)
    h2_point = h2_lo = h2_hi = None
    h2_rule = "لا_بيانات"
    h2_attempts = h2_failed = 0
    h2_zero_windows_total = 0
    h2_uninstrumented_waves = 0
    if all(w is not None for w in waves):
        for w in waves:
            w.h2_rows()
            h2_zero_windows_total += getattr(w, "h2_zero_windows", 0)
            if not getattr(w, "h2_drainer_instrumented", False):
                h2_uninstrumented_waves += 1
        def build_X(pairs):
            X, y = [], []
            for ai, bi in pairs:
                for arm, w in ((0, waves[ai]), (1, waves[bi])):  # ‏0=A، ‏1=B
                    for r in w.h2_rows():
                        X.append([1.0, r["drainerSec"], r["arrRate"], float(arm)])
                        y.append(r["wait"])
            return X, y
        X, y = build_X(pair_idx)
        if h2_uninstrumented_waves == len(waves):
            h2_rule = "مانعُ_H2: لا صفوفِ درينرٍ في أيّ موجةٍ — المتغيرُ المسجّلُ لا يُشتقّ"
        elif len(X) >= 8 and len(X) > len(X[0]):
            beta = _ols(y, X)
            if beta is not None:
                h2_point = beta[3]
                draws = []
                for _ in range(BOOTSTRAP_B):
                    h2_attempts += 1
                    sel = [pair_idx[rng.randrange(len(pair_idx))] for _ in pair_idx]
                    Xb, yb = build_X(sel)
                    if len(Xb) >= 8 and len(Xb) > len(Xb[0]):
                        bb = _ols(yb, Xb)
                        if bb is not None:
                            draws.append(bb[3])
                        else:
                            h2_failed += 1
                    else:
                        h2_failed += 1
                h2_lo, h2_hi = percentile_interval(draws)
                if h2_lo is not None:
                    # سحباتٌ غيرُ قابلةٍ للتقديرٍ تُعلَى وتُعدّ؛ إن غلبتْ فالفاصلُ غيرُ موثوقٍ
                    if h2_failed > 0 and len(draws) < BOOTSTRAP_B / 2:
                        h2_rule = "غيرُ_قابلٍ_للتقدير: أغلبُ السحباتِ فاشلةٌ"
                    else:
                        h2_rule = three_case_rule(h2_point, h2_lo, h2_hi)
                        if h2_failed > 0:
                            h2_rule += f" (تحذيرٌ: {h2_failed} سحبةً غيرَ قابلةٍ للتقدير)"
    result["h2"] = {
        "unit": "flush_window_5s_completion_attributed",
        "drainer_variable": "Σ runSumMs لمساراتِ drainer:* (gatewayRequest) — استهلاكُ مقعد-ثانيةٍ لا إشغالٌ تزامنيّ",
        "n_rows": None, "point_ms": h2_point, "ci_ms": [h2_lo, h2_hi],
        "rule": h2_rule,
        "bootstrap_attempts": h2_attempts, "bootstrap_failed": h2_failed,
        "drainer_zero_windows": h2_zero_windows_total,
        "uninstrumented_drainer_waves": h2_uninstrumented_waves,
    }
    n_rows = 0
    for w in waves:
        n_rows += len(w.h2_rows())
    result["h2"]["n_rows"] = n_rows
    result["residual_note"] = ("الأحكامُ تخصُّ المتوسطَ الشرطيَّ فقط؛ ذيلُ التوزيعِ "
                              "بلا تفسيرٍ متبقٍّ لا يُفسَّر بهذه الدورة.")
    print(json.dumps(result, ensure_ascii=False, indent=1))
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["strata", "aa", "cost", "ab"])
    ap.add_argument("args", nargs="+")
    ns = ap.parse_args()
    if ns.mode == "strata":
        mode_strata(ns.args[0], ns.args[1])
    elif ns.mode == "aa":
        mode_aa(ns.args[0], ns.args[1], ns.args[2])
    elif ns.mode == "cost":
        mode_cost(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])
    elif ns.mode == "ab":
        mode_ab(ns.args[:8], ns.args[9], ns.args[8])  # ‏8=strata.json، ‏9=out.json — كما يستدعيه المقعد


if __name__ == "__main__":
    main()

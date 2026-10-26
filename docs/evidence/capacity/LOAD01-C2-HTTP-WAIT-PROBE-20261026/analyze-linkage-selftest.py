#!/usr/bin/env python3
"""اختبارٌ ذاتيٌّ لتحليلِ الربطِ الطلبيِّ بمدخلاتٍ معروفةٍ (قيمٌ محسوبةٌ باليدِ).

يبني موجةً مصغّرةً من صفوفٍ معلومةٍ ثمّ يطابقُ مخرجاتِ analyze-linkage.py معَ
القيمِ المحسوبةِ يدويًّا: الربطَ، والاحتجازَ (runMs لا الفاصلِ المركّبِ)،
والمئيناتِ، وشريحةَ الذيلِ على الطلباتِ نفسِها.

الاستدعاءُ: python3 analyze-linkage-selftest.py
"""
import datetime
import gzip
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "analyze-linkage.py")

# حدودُ الأطوارِ: حقنٌ [0, 10000)، تصريفٌ [10000, 20000]
def _epoch_ms(iso):
    import datetime
    return int(datetime.datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)


T0 = _epoch_ms("2026-01-01T00:00:00.000Z")
D0 = _epoch_ms("2026-01-01T00:00:10.000Z")
E0 = _epoch_ms("2026-01-01T00:00:20.000Z")


def wline(ev):
    return json.dumps(ev, ensure_ascii=False)


def build_wave(d):
    # miniapp-load-events: أحداثُ الأطوارِ
    with gzip.open(os.path.join(d, "miniapp-load-events.jsonl.gz"), "wt", encoding="utf-8") as f:
        f.write(wline({"event": "phase.start", "t": "2026-01-01T00:00:00.000Z"}) + "\n")
        f.write(wline({"event": "phase.drain_start", "t": "2026-01-01T00:00:10.000Z"}) + "\n")
        f.write(wline({"event": "phase.end", "t": "2026-01-01T00:00:20.000Z"}) + "\n")

    # load-events: عمودُ العميلِ (http_call)
    with gzip.open(os.path.join(d, "load-events.jsonl.gz"), "wt", encoding="utf-8") as f:
        # r1: rides ذيلٌ (زمنُ عميلٍ كبيرٌ)؛ r2: rides عاديٌّ؛ o1: غيرُ rides
        f.write(wline({"event": "http_call", "requestId": "r1", "elapsedMs": 900}) + "\n")
        f.write(wline({"event": "http_call", "requestId": "r2", "elapsedMs": 100}) + "\n")
        f.write(wline({"event": "http_call", "requestId": "o1", "elapsedMs": 50}) + "\n")

    # load-trace: httpreq (طلباتٌ فردّيّةٌ) وpseat (حجوزاتٌ منسوبةٌ)
    with gzip.open(os.path.join(d, "load-trace.jsonl.gz"), "wt", encoding="utf-8") as f:
        # r1: زمنٌ خادميٌّ 300 ⇒ فجوةُ العميلِ 600؛ مقعدُه: انتظارٌ 200 واحتجازٌ 30
        f.write(wline({"k": "httpreq", "at": T0 + 5000, "requestId": "r1", "route": "POST /v1/rides",
                       "serverMs": 300, "status": 200, "gateWaitMs": 200, "gateHoldMs": 30,
                       "gateAcquisitions": 1}) + "\n")
        # r2: زمنٌ خادميٌّ 80 ⇒ فجوةٌ 20؛ مقعدُه: انتظارٌ 40 واحتجازٌ 10
        f.write(wline({"k": "httpreq", "at": T0 + 6000, "requestId": "r2", "route": "POST /v1/rides",
                       "serverMs": 80, "status": 200, "gateWaitMs": 40, "gateHoldMs": 10,
                       "gateAcquisitions": 1}) + "\n")
        # o1: غيرُ rides، بلا مقعدٍ
        f.write(wline({"k": "httpreq", "at": T0 + 7000, "requestId": "o1", "route": "GET /health",
                       "serverMs": 5, "status": 200, "gateWaitMs": 0, "gateHoldMs": 0,
                       "gateAcquisitions": 0}) + "\n")
        # pseat: الاحتجازُ حرفيًّا runMs — الفواصلُ waitStartAt/waitEndAt/holdEndAt
        # تحفظُ الحدودَ لا تُختزَلُ (waitStart=acq−wait−run)
        f.write(wline({"k": "pseat", "at": T0 + 5100, "path": "http:POST /v1/rides", "pool": "gatewayRequest",
                       "requestId": "r1", "waitMs": 200, "runMs": 30, "waitStartAt": T0 + 4870,
                       "waitEndAt": T0 + 5070, "holdEndAt": T0 + 5100, "kind": "job"}) + "\n")
        f.write(wline({"k": "pseat", "at": T0 + 6100, "path": "http:POST /v1/rides", "pool": "gatewayRequest",
                       "requestId": "r2", "waitMs": 40, "runMs": 10, "waitStartAt": T0 + 6050,
                       "waitEndAt": T0 + 6090, "holdEndAt": T0 + 6100, "kind": "job"}) + "\n")


def main():
    with tempfile.TemporaryDirectory() as tmp:
        wave = os.path.join(tmp, "w")
        os.makedirs(wave)
        build_wave(wave)
        res = subprocess.run(
            [sys.executable, SCRIPT, wave], capture_output=True, text=True, check=True
        )
        out = json.loads(res.stdout)[0]

    ok = True

    def check(label, got, want):
        nonlocal ok
        if got != want:
            print(f"✗ {label}: got={got} want={want}")
            ok = False
        else:
            print(f"✓ {label} = {got}")

    # الربطُ والتكرارُ
    check("httpreq", out["rows"]["httpreq"], 3)
    check("httpreq_dup_ids", out["rows"]["httpreq_dup_ids"], 0)
    check("pseat_rows_with_id", out["rows"]["pseat_rows_with_id"], 2)
    check("pseat_unmatched_rows", out["rows"]["pseat_unmatched_rows"], 0)
    check("http_call_matched", out["rows"]["http_call_matched"], 3)
    check("httpreq_with_gate", out["httpreq_with_gate"], 2)

    # الاحتجازُ = runMs لا (holdEndAt−waitStartAt) الذي يشملُ الانتظارَ
    ri = out["seat_stats"]["rides|inj"]
    check("rides|inj n", ri["n"], 2)
    check("rides|inj wait_mean", ri["wait_mean"], 120.0)  # (200+40)/2
    check("rides|inj hold_mean", ri["hold_mean"], 20.0)  # (30+10)/2 — لا 265 (الفاصلُ المركّبُ)
    check("rides|inj wait_p95", ri["wait_p95"], 192.0)  # استيفاءٌ خطّيٌّ: 40+0.95×160

    # مراحلُ الطلبِ الواحدِ (httpreq لمسارِ rides في الحقنِ)
    st = out["rides_request_stages"]["inj"]
    check("stages n", st["n"], 2)
    check("stages gateWait_mean", st["gateWait_mean"], 120.0)
    check("stages server_mean", st["server_mean"], 190.0)

    # فجوةُ العميل/الخادمِ: (900−300)=600 و(100−80)=20 ⇒ متوسطٌ 310
    g = out["client_server_gap"]["rides"]
    check("gap n", g["n"], 2)
    check("gap mean", g["mean"], 310.0)
    check("gap p50", g["p50"], 310.0)  # n=2: منتصفُ الفاصلةِ (استيفاءٌ خطّيٌّ)

    # شريحةُ الذيلِ: أعلى 5% (طولاً 2 ⇒ 1) = r1 وحدها — المراحلُ لطلبٍ واحدٍ
    t = out["tail_same_requests"]
    check("tail n", t["n"], 1)
    check("tail client_elapsed_mean", t["client_elapsed_mean"], 900)
    check("tail gateWait_mean", t["gateWait_mean"], 200)
    check("tail gateHold_mean", t["gateHold_mean"], 30)
    check("tail server_mean", t["server_mean"], 300)

    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""مولّدُ خامّ موجاتٍ اصطناعيةٍ لاختبارِ b33mtick-compare.py بالمسارِ الحقيقيِّ كاملًا
(استخراجٌ من خامٍّ لا stub) — يغطّي: الحالةُ الطبيعية، الموجةُ اليتيمةُ (G1/P7 لا تدخلُ
الحكمَ)، الاتجاهاتُ المتعارضةُ، معدلُ الأساسِ الصفريُّ، مخالفةُ خريطةِ الخطةِ (a2-ref)،
والموجةُ الصالحةُ بلا مقاييسَ (فقدُ ملفِ الاستخراجِ)."""
import gzip
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

T0 = datetime(2026, 10, 23, 12, 0, 0, tzinfo=timezone.utc)
WAVE = 180_000
R_FULL = "e47ca99ddd7b4b74b73323fbc17963fede309cec"
C_FULL = "2aa557aa2813b77bc12d37b257de22ae733378af"
BASE = datetime(2026, 10, 23, 12, 0, 0, tzinfo=timezone.utc)
EPOCH0 = BASE.timestamp() * 1000  # مقياسُ epoch-ms نفسُهُ الذي تكتبُهُ العدّةُ الحقيقيةُ


def iso(ms: float) -> str:
    return (BASE + timedelta(milliseconds=ms)).isoformat().replace("+00:00", "Z")


def jgz(p: Path, rows: list[dict]):
    with gzip.open(p, "wt") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")


def write(p: Path, obj):
    p.write_text(json.dumps(obj, ensure_ascii=False))


def make_wave(root: Path, name: str, side: str, *, rate: float, g1_v: int, g1_o: int,
              p7: int, budget: str = "8000", gw_proc: bool = True,
              drop_load_events: bool = False, plan_side: str | None = None):
    """موجةٌ اصطناعيةٌ كاملةٌ تجتازُ فحصَ الصلاحيةِ (b33m-analyze valid) وتُستخرجُ
    مقاييسُها بالمسارِ الحقيقيِّ كاملًا: rate (إرسالات/ث)، G1 (verified/outcomes)، P7."""
    d = root / name
    (d / "qual").mkdir(parents=True, exist_ok=True)
    side_eff = plan_side or side
    # ---- ملفاتُ فحصِ الصلاحية (b26): preflight/inflight VALID وgates وreport
    write(d / "qual/preflight.json", {"verdict": "VALID"})
    write(d / "qual/inflight.json", {"verdict": "VALID"})
    write(d / "qual/window.json", {})
    write(d / "wave-report.json", {
        "verdict": "PASS", "total": g1_o, "verified": g1_v, "failedGates": [],
        "gates": [{"id": "G1", "value": f"({g1_v}/{g1_o})", "pass": True, "rule": "…"}],
        "perf": []})
    (d / "gates.txt").write_text(f"P7={p7}s\n")
    (d / "session-limit.json").write_text(json.dumps(
        {"ok": True, "effective_limit": 6000, "gateway_comm": "bun"}))
    # ---- أحداثُ المولّد (b26 extras): phase.start/drain_start + scenario.outcome/end
    evs = [{"t": iso(0), "event": "phase.start"},
           {"t": iso(WAVE), "event": "phase.drain_start"}]
    for i in range(g1_o):
        evs.append({"t": iso(10_000 + i * 300), "event": "scenario.outcome",
                    "kind": "verified" if i < g1_v else "g1_timeout"})
    for i in range(g1_o):
        evs.append({"t": iso(10_000 + i * 300), "event": "scenario.end"})
    evs.append({"t": iso(30_000), "event": "driver.onboarding_failed",
                "steps": {"phoneProofJob": "timeout"}})
    jgz(d / "miniapp-load-events.jsonl.gz", evs)
    # ---- تتبعُ الحملِ والجلسةِ (b26): route/rl — بلا رفضٍ 429 (rejected_429=0)
    (d / "load-trace.jsonl").write_text("".join(
        json.dumps({"k": "http", "route": "POST /v1/session/telegram", "at": 1000.0 * i, "n": 1}) + "\n"
        for i in range(60)))
    (d / "rl-window.jsonl").write_text("")
    # تتبعُ الشوطِ (b25): مرورٌ واحدٌ على الأقلِّ + أوامرٌ — وإلا «مدخلاتٌ ناقصةٌ (أثرُ الشوط)»
    (d / "dispatch-trace.jsonl").write_text("".join(json.dumps(x) + "\n" for x in [
        {"k": "pass", "startAt": 5000.0, "endAt": 15000.0, "passMs": 10000.0, "picked": 10, "rebroadcast": 0,
         "stillNoDriver": 0, "exhausted": 0, "raced": 0, "failed": 0},
        {"k": "order", "orderId": "o1", "startAt": 6000.0, "endAt": 9000.0},
        {"k": "probe", "at": 7000.0, "poolMs": 1.0},
    ]))
    (d / "orders.csv").write_text("id,created_ms\no1,5000\n")
    # ---- خامُّ المقارنةِ (b33m/load_wave): أحداثُ البوّابةِ والإرسالاتُ والنبضةُ
    if not drop_load_events:
        jgz(d / "load-events.jsonl.gz", [{"t": iso(1000), "sinceStartMs": 1000, "kind": "inject"}])
        n = int(rate * (WAVE / 1000))
        jgz(d / "b33m-mock-egress.jsonl.gz", [
            {"t": EPOCH0 + 2000.0 + i * (WAVE - 4000) / max(n - 1, 1), "bot": "rider",
             "method": "sendMessage", "status": 200, "seq": i} for i in range(n)])
        # أشواطُ تصريفٍ اصطناعيةٌ (job.ran قبلَ النبضةِ — مقياسُ الخمولِ يعملُ) — «at» بمقياسِ epoch
        runs = [{"at": iso(5000 + i * 20_000), "event": "job.ran", "job": "deliver-notifications",
                 "durationMs": 8000, "detail": "eligible=50"} for i in range(8)]
        jgz(d / "b33m-gw-events.jsonl.gz", runs)
        jgz(d / "b33m-outbox-samples.jsonl.gz", [
            {"t": EPOCH0 + 1000.0 + i * 1000, "kinds": {"offer": {"eligible": 5}}} for i in range(180)])
    # ---- سجلُّ النشرِ (b24-env + gateway-proc) والميزانيةُ المسجَّلة
    write(d / "b24-env.json", {
        "side": side, "code_ref": R_FULL if side == "ref" else "a" * 40,
        "code_acc": C_FULL if side == "cand" else "b" * 40,
        "gateway_request_ref": 5, "gateway_request_acc": 5})
    if gw_proc:
        write(d / "gateway-proc.json", {
            "pid": 4242, "cwd": f"/home/user/workspace/wt-{'ref' if side_eff == 'ref' else 'acc'}",
            "cmd_ok": True, "t": "2026-10-23T12:05:00Z"})
    (d / "gateway-drain-budget.txt").write_text(f"NOTIFICATION_DRAIN_BUDGET_MS={budget}")
    return d

#!/usr/bin/env python3
"""LOAD-01 · موجةُ القياسِ b33m — عيّناتُ `notification_outbox` أثناءَ الموجة (قراءةٌ فقط).

الاستعمال: outbox-sampler.py OUT_JSONL MAX_SEC INTERVAL_SEC

كلَّ INTERVAL_SEC ثانيةً استعلامٌ تجميعيٌّ واحدٌ (select فقط، لا كتابة) يكتبُ سطرًا:
  {"t": ms, "kinds": {kind: {pending, eligible, deferred, sending, delivered, delivered_tg,
    delivered_board, dead, oldest_pending_s, oldest_eligible_s, oldest_deferred_s,
    pending_congestion, pending_signal_wait, pending_fresh, pending_other_error,
    max_defer_s, max_signal_wait_count}}}
- eligible = pending و next_attempt_at <= now() (مستحقٌّ الآنَ ولم يُستحوَذْ عليه)
- deferred = pending و next_attempt_at > now() (مؤجَّلٌ بازدحامٍ أو انتظارِ إشارةٍ أو إعادةِ محاولة)
- pending_congestion/signal_wait = سببُ آخرِ عودةٍ للطابورِ من last_error (OUTBOUND_CONGESTION/SIGNAL_WAIT)
لا يمسُّ المنتجَ ولا قواعدَ القبول؛ كلفتُه على القاعدةِ مُعلنةٌ في PROTOCOL-b33m.md (§القيود).
فشلُ عيّنةٍ (القاعدةُ تُعادُ إنشاؤها مثلًا) يُكتَبُ سطرَ خطأٍ ولا يوقفُ المُعايِن.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time

B = "/srv/ceezr-cap-20261016"
SQL = """
select json_build_object(
  't', (extract(epoch from clock_timestamp()) * 1000)::bigint,
  'kinds', coalesce((select json_object_agg(kind, row_to_json(x)) from (
    select kind,
      count(*) filter (where status = 'pending') as pending,
      count(*) filter (where status = 'pending' and next_attempt_at <= now()) as eligible,
      count(*) filter (where status = 'pending' and next_attempt_at > now()) as deferred,
      count(*) filter (where status = 'sending') as sending,
      count(*) filter (where status = 'delivered') as delivered,
      count(*) filter (where status = 'delivered' and coalesce(delivered_channel, 'telegram') = 'telegram') as delivered_tg,
      count(*) filter (where status = 'delivered' and delivered_channel = 'miniapp_board') as delivered_board,
      count(*) filter (where status = 'dead') as dead,
      round(extract(epoch from now() - min(created_at) filter (where status = 'pending'))::numeric, 1) as oldest_pending_s,
      round(extract(epoch from now() - min(created_at) filter (where status = 'pending' and next_attempt_at <= now()))::numeric, 1) as oldest_eligible_s,
      round(extract(epoch from now() - min(created_at) filter (where status = 'pending' and next_attempt_at > now()))::numeric, 1) as oldest_deferred_s,
      count(*) filter (where status = 'pending' and last_error = 'OUTBOUND_CONGESTION') as pending_congestion,
      count(*) filter (where status = 'pending' and last_error = 'SIGNAL_WAIT') as pending_signal_wait,
      count(*) filter (where status = 'pending' and last_error is null) as pending_fresh,
      count(*) filter (where status = 'pending' and last_error is not null
                         and last_error not in ('OUTBOUND_CONGESTION', 'SIGNAL_WAIT')) as pending_other_error,
      round(extract(epoch from max(next_attempt_at - now()) filter (where status = 'pending'))::numeric, 1) as max_defer_s,
      max(signal_wait_count) as max_signal_wait_count
    from notification_outbox group by kind) x), '{}'::json)
)
"""


def main() -> int:
    out, max_sec, interval = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
    cmd = [
        "sudo", "-n", "ip", "netns", "exec", "ceezrsbx2",
        "psql", "-h", "127.0.0.1", "-p", "55432", "-U", "postgres",
        "-d", "ceezr_cap_20261016", "-qAt", "-v", "ON_ERROR_STOP=1",
        "-c", "set application_name='b33m-outbox-sampler'", "-c", SQL,
    ]
    t_end = time.time() + max_sec
    with open(out, "a", encoding="utf-8") as f:
        while time.time() < t_end:
            t0 = time.time()
            try:
                r = subprocess.run(cmd, capture_output=True, text=True, timeout=max(interval, 4))
                line = r.stdout.strip().splitlines()[-1] if r.returncode == 0 and r.stdout.strip() else ""
                if line.startswith("{"):
                    d = json.loads(line)
                    d["q_ms"] = round((time.time() - t0) * 1000)
                    f.write(json.dumps(d, separators=(",", ":")) + "\n")
                else:
                    f.write(json.dumps({"t": round(t0 * 1000), "err": f"rc={r.returncode}"}) + "\n")
            except Exception as e:  # noqa: BLE001 — عيّنةٌ فاشلةٌ لا توقفُ المُعايِن
                f.write(json.dumps({"t": round(t0 * 1000), "err": type(e).__name__}) + "\n")
            f.flush()
            time.sleep(max(0.0, interval - (time.time() - t0)))
    return 0


if __name__ == "__main__":
    sys.exit(main())

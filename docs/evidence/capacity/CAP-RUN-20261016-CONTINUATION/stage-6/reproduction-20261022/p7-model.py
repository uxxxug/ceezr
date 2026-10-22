#!/usr/bin/env python3
"""نموذجُ طابورٍ بسيطٌ لـ P7 (استدلالٌ يُختبَرُ على القياس، لا قياسٌ مباشر).

الافتراضات (معلنةٌ مسبقًا هنا، لا تُعدَّلُ لتلائمَ النتيجة):
- إشعاراتُ رحلةِ الراكبِ التي تحتاجُ تيليجرامَ (لا إيصالَ Mini App) = telegram + pending في riderTripChannel.
- تصلُ بانتظامٍ على طولِ مرحلةِ الحملِ L = 180ث (ملفُّ الموجةِ: wave-750 لمدّة 180ث).
- تُخدَمُ بترتيبِ الإنشاء (claim: notification_kind_priority ثمَّ created_at؛ النوعُ واحد).
⇒ عمرُ أقدمِ معلّقٍ عندَ التدقيقِ ≈ W − (S/D)·L، حيثُ W = زمنُ التدقيقِ منذُ اللقطةِ القبلية.
يُقارَنُ بـ P7 المقيس؛ والمعدّلُ الفعليُّ لبوتِ الراكب = قبولُ المحاكي ÷ W (حدُّ المُرسِل 25/ث).
"""
import json, os, sys
from datetime import datetime
RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "raw", "batch32", "gh-seat-39711901468", "raw")
L = 180.0
ts = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
waves = sys.argv[1:] or sorted(d for d in os.listdir(RAW) if d.startswith(("b32main-s1r-", "b32main-s2-", "b32main-a1-")))
print(f"{'wave':22} {'D':>5} {'S':>5} {'W_s':>5} {'riderTG/s':>9} {'drvTG/s':>8} {'oldest_kind?':>12} {'model_s':>7} {'P7_s':>5}")
for w in waves:
    a = json.load(open(f"{RAW}/{w}/db-audit-post.json")); s = a["snapshot"]; pre = a["preSnapshot"]
    rc = s["riderTripChannel"]; D = rc["telegram"] + rc["pending"]; S = rc["telegram"]
    W = ts(s["at"]) - ts(pre["at"])
    eg = s.get("egress") or {"byBot": {}}
    rider = eg["byBot"].get("rider", {}).get("accepted", 0); drv = eg["byBot"].get("driver", {}).get("accepted", 0)
    model = W - (S / D) * L if D else None
    p7 = s["outbox"]["oldestPendingSec"]
    print(f"{w:22} {D:5} {S:5} {W:5.0f} {rider/W:9.1f} {drv/W:8.1f} {'n/a':>12} {model:7.0f} {p7!s:>5}")

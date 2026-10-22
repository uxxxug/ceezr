#!/usr/bin/env python3
"""LOAD-01 · موجةُ القياسِ b33m — استخراجٌ مُنقَّحٌ من سجلّاتِ المقعدِ إلى دليلِ الموجة.

الاستعمال: b33m-extract.py <EVIDENCE_DIR> <RAW_WAVE_DIR>

يكتبُ في RAW_WAVE_DIR (gzip حتميٌّ، mtime=0):
- b33m-gw-events.jsonl.gz   أحداثُ سجلِّ البوّابةِ ذاتُ البادئاتِ المعلنةِ وحدَها، بحقولٍ رقميّةٍ
                            أو منطقيّةٍ أو تعداديّةٍ قصيرةٍ فقط (لا نصَّ حرًّا، لا معرّفاتِ مستخدمين).
                            `chat` في `outbound.resilience_event` كنيةٌ تكتبُها البوّابةُ نفسُها.
- b33m-gw-event-counts.json عدُّ كلِّ الأحداثِ بالاسم (تغطيةٌ: ما لم يُستخرَجْ مذكورٌ بعدده).
- b33m-mock-egress.jsonl.gz إسقاطُ سجلِّ المحاكي في نافذةِ الموجة: seq,t,bot,method,status,
                            group، و`chat` = بصمةٌ مملّحةٌ بملحٍ عشوائيٍّ لا يُحفَظ (تكفي لفروقِ
                            المحادثةِ الواحدة، ولا تُردُّ إلى معرّف). لا نصَّ ولا أزرار.
- b33m-outbox-rows.csv.gz / b33m-outbox-samples.jsonl.gz  نسخٌ مضغوطةٌ ممّا كتبه wave-full-ref.sh.
- b33m-extract.json         ملخّصُ التغطية (أعدادُ الأسطرِ والمسقَطِ والنافذة).
لا يغيّرُ ملفًّا في EVIDENCE_DIR.
"""

from __future__ import annotations

import gzip
import hashlib
import io
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

PREFIXES = ("job.", "outbound.", "notification", "outbox", "runner.", "embedded_worker.")
ENUM = re.compile(r"^[A-Za-z0-9_.:\-/]{1,48}$")
COUNTS = re.compile(r"^[a-z_]+=\d+( [a-z_]+=\d+)*$")
DROP_KEYS = {"request_id", "user_id", "chat_id", "telegram_id", "order_id", "driver_id", "rider_id", "text"}
SENSITIVE = re.compile(r"(?i)token|secret|key|auth|url|pass|cookie|init")


def gz_write(path: Path, data: bytes) -> None:
    buf = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=buf, compresslevel=9, mtime=0) as g:
        g.write(data)
    path.write_bytes(buf.getvalue())


def project(rec: dict) -> dict:
    out = {"at": rec.get("at"), "event": rec.get("event")}
    for k, v in rec.items():
        if k in ("at", "event", "service", "level") or k in DROP_KEYS or SENSITIVE.search(k):
            continue
        if isinstance(v, bool) or isinstance(v, (int, float)):
            out[k] = v
        elif isinstance(v, str):
            if k == "detail" and COUNTS.match(v):
                out[k] = v
            elif ENUM.match(v):
                out[k] = v
    return out


def main() -> int:
    ev, raw = Path(sys.argv[1]), Path(sys.argv[2])
    raw.mkdir(parents=True, exist_ok=True)
    summary: dict = {}
    win = {}
    wj = ev / "qual" / "window.json"
    if wj.exists():
        win = json.loads(wj.read_text())
    t0, t1 = win.get("wave_from_ms"), win.get("wave_to_ms")
    summary["window"] = {"from_ms": t0, "to_ms": t1}

    counts: Counter = Counter()
    kept: list[str] = []
    gwl = ev / "gateway.wave.log"
    nonjson = 0
    if gwl.exists():
        with gwl.open(encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line.startswith("{"):
                    nonjson += 1
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    nonjson += 1
                    continue
                name = str(rec.get("event", ""))
                counts[name] += 1
                if name.startswith(PREFIXES):
                    kept.append(json.dumps(project(rec), ensure_ascii=False, separators=(",", ":")))
    gz_write(raw / "b33m-gw-events.jsonl.gz", ("\n".join(kept) + "\n").encode() if kept else b"")
    (raw / "b33m-gw-event-counts.json").write_text(
        json.dumps(dict(sorted(counts.items())), ensure_ascii=False, indent=1) + "\n"
    )
    summary["gateway_log"] = {"present": gwl.exists(), "events": sum(counts.values()),
                              "kept": len(kept), "non_json_lines": nonjson}

    salt = os.urandom(16)
    mock = ev / "telegram-mock.jsonl"
    m_out: list[str] = []
    m_total = 0
    if mock.exists():
        with mock.open(encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    r = json.loads(line)
                except json.JSONDecodeError:
                    continue
                m_total += 1
                t = r.get("t")
                if t0 is not None and (t is None or t < t0 or (t1 is not None and t > t1)):
                    continue
                chat = str(r.get("chat_id", ""))
                m_out.append(json.dumps({
                    "seq": r.get("seq"), "t": t, "bot": r.get("bot"), "method": r.get("method"),
                    "status": r.get("status"), "group": chat.startswith("-"),
                    "chat": hashlib.sha256(salt + chat.encode()).hexdigest()[:12] if chat else None,
                }, separators=(",", ":")))
    del salt
    gz_write(raw / "b33m-mock-egress.jsonl.gz", ("\n".join(m_out) + "\n").encode() if m_out else b"")
    summary["mock_log"] = {"present": mock.exists(), "lines_total": m_total, "in_window": len(m_out)}

    for name in ("b33m-outbox-rows.csv", "b33m-outbox-samples.jsonl"):
        p = ev / name
        summary[name] = {"present": p.exists(), "lines": 0}
        if p.exists():
            data = p.read_bytes()
            summary[name]["lines"] = data.count(b"\n")
            gz_write(raw / f"{name}.gz", data)
    (raw / "b33m-extract.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1) + "\n")
    print("B33M_EXTRACT", json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

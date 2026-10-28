#!/usr/bin/env python3
"""جردُ §5.8 — استعلاماتُ الالتقاطِ في موجةٍ من pg_stat_statements.

عقدُ القراءةِ (مغلقٌ على الفشلِ): يُقرأُ الملفُّ كاملًا أولًا؛ فإن نجحتِ القراءةُ
والتحليلُ فُسِّرَ غيابُ صفِّ الاستعلامِ على أنّه صفرُ نداءاتٍ مقيسٌ (الرحلةُ
الواحدةُ: الاستعلامُ الثاني لم يُنفَّذ)، وأُخرِجَ العددُ رقمًا. وإن فشلتِ القراءةُ
أو تحليلُ أيِّ صفٍّ فشلًا يمنعُ الثقةَ بالأرقامِ، خرجَ الحقلانِ `null` فلا يمرُّ
أيُّ فحصٍ — الغائبُ ليسَ صفرًا ولا نظافةً.

الاستخدام: claim-inventory.py RAW_DIR EVIDENCE_DIR ARM CLAIM_SIG CORR_SIG
يكتبُ النتيجةَ إلى RAW_DIR/claim-inventory.json (stdout صامتٌ).
"""
import csv
import json
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 6:
        print("usage: claim-inventory.py RAW_DIR EVIDENCE_DIR ARM CLAIM_SIG CORR_SIG", file=sys.stderr)
        return 2
    raw_dir = Path(sys.argv[1])
    evidence_dir = Path(sys.argv[2])
    arm = sys.argv[3]
    claim_sig = sys.argv[4]
    corr_sig = sys.argv[5]

    claims: int | None = None
    correlation: int | None = None
    try:
        with open(evidence_dir / "pgss-full.csv", mode="rt", encoding="utf-8", newline="") as fh:
            rows = list(csv.DictReader(fh))
        claims = 0
        correlation = 0
        for row in rows:
            q = (row.get("query") or "").strip()
            if q.startswith(claim_sig):
                claims += int(row["calls"])
            elif q.startswith(corr_sig):
                correlation += int(row["calls"])
    except (OSError, KeyError, ValueError, TypeError):
        claims = None
        correlation = None

    queries_per_claim: float | None = None
    if claims and correlation is not None:
        queries_per_claim = round(correlation / claims, 3)

    doc = {
        "arm": arm,
        "claims": claims,
        "correlation": correlation,
        "queriesPerClaim": queries_per_claim,
    }
    out = raw_dir / "claim-inventory.json"
    out.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

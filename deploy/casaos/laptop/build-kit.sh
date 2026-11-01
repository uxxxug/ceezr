#!/usr/bin/env bash
# الغرض: يبني حقيبةَ اللابتوب wasla-offsite-kit.zip من المستودعِ بشكلٍ حتميّ (ADR 0298 §6):
#   أسماءٌ وترتيبٌ ثابتان، وطوابعُ زمنٍ ثابتة، وصلاحيّاتٌ ثابتة؛ فالبناءُ نفسُه يعطي sha256 نفسَه.
# الاستعمال: bash deploy/casaos/laptop/build-kit.sh OUT.zip
# يرفضُ البناءَ إن وجدَ في الملفّاتِ ما يشبهُ سرّاً (مفتاحَ age خاصّاً، أو مفتاحَ SSH خاصّاً، أو رمزاً، أو client_secret بقيمة).
set -euo pipefail; umask 022
OUT=${1:?OUT.zip}; H=$(cd "$(dirname "$0")" && pwd); C=$(cd "$H/.." && pwd)
command -v python3 >/dev/null || { echo "python3 مطلوب"; exit 1; }
FILES=("$H/README-AR.md" "$C/OFFSITE-BACKUP.md" "$H/wasla-offsite-connect.sh" "$H/wasla-offsite-first-upload.sh" "$H/wasla-offsite-enable-nightly.sh" "$H/wasla-offsite-restore-test.sh" "$H/wasla-laptop-lib.sh")
for f in "${FILES[@]}"; do
  [ -f "$f" ] || { echo "ناقص: $f"; exit 1; }
  if grep -nE 'AGE-SECRET-KEY-1|BEGIN [A-Z ]*PRIVATE KEY|"refresh_token" *: *"1//|ya29\.|GOCSPX-' "$f"; then echo "يشبهُ سرّاً: $f"; exit 1; fi
  if grep -q $'\r' "$f"; then echo "CRLF في $f"; exit 1; fi
done
python3 - "$OUT" "${FILES[@]}" <<'PY'
import hashlib, os, sys, zipfile
out, files = sys.argv[1], sys.argv[2:]
root, ts = "wasla-offsite-kit/", (2026, 1, 1, 0, 0, 0)
entries = []
for p in files:
    data = open(p, "rb").read()
    entries.append((os.path.basename(p), data, 0o755 if p.endswith(".sh") and not p.endswith("-lib.sh") else 0o644))
sums = "".join(f"{hashlib.sha256(d).hexdigest()}  {n}\n" for n, d, _ in entries).encode()
entries.append(("SHA256SUMS", sums, 0o644))
tmp = out + ".tmp"
with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
    d = zipfile.ZipInfo(root, ts); d.external_attr = (0o40755 << 16) | 0x10; z.writestr(d, b"")
    for n, data, mode in sorted(entries):
        i = zipfile.ZipInfo(root + n, ts); i.external_attr = (0o100000 | mode) << 16
        i.compress_type = zipfile.ZIP_DEFLATED; i.create_system = 3
        z.writestr(i, data)
os.replace(tmp, out)
print(hashlib.sha256(open(out, "rb").read()).hexdigest(), os.path.basename(out))
PY

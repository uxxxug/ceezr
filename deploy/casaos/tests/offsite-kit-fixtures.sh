#!/usr/bin/env bash
# الغرض: يجهّزُ على Linux بياناتٍ اصطناعيّةً لاختبارِ الحقيبةِ على Windows (offsite-kit-windows-test.sh):
#   مفتاحُ age اختباريّ، ومفتاحُ توقيعٍ اختباريٌّ للخادم، ونسخةٌ مشفّرةٌ حقيقيّةٌ ببيانٍ موقَّع بالصيغةِ التي يقرؤها
#   wasla-offsite-restore-test.sh (ADR 0298 §2-4). لا بياناتِ إنتاج، ولا مفاتيحَ حقيقيّة.
# ينتمي إلى: deploy/casaos/tests · يستدعيه .github/workflows/offsite-kit-windows.yml
# الاستعمال: bash offsite-kit-fixtures.sh OUTDIR   (يحتاجُ age وage-keygen وssh-keygen وtar وsha256sum)
set -euo pipefail; umask 077
O=${1:?OUTDIR}; rm -rf "$O"; mkdir -p "$O/drive/daily"; O=$(cd "$O" && pwd)
TS=20261101T030000Z; NAME=wasla-$TS.tar.age
age-keygen -o "$O/agekey" 2>/dev/null; PUB=$(age-keygen -y "$O/agekey")
ssh-keygen -q -t ed25519 -N '' -C '' -f "$O/signing.key"; cut -d' ' -f1,2 "$O/signing.key.pub" > "$O/signer.pub"
P=$(mktemp -d); trap 'rm -rf "$P"' EXIT
head -c 300000 /dev/urandom > "$P/waslah-$TS.dump"; printf 'public.t\t3\tx\n' > "$P/waslah-$TS.rowstats"
(cd "$P" && sha256sum "waslah-$TS.dump" "waslah-$TS.rowstats" > MANIFEST.sha256 && tar -cf "$O/plain.tar" "waslah-$TS.dump" "waslah-$TS.rowstats" MANIFEST.sha256)
age -r "$PUB" -o "$O/drive/daily/$NAME" "$O/plain.tar"
C=$O/drive/daily/$NAME
{ echo "format=wasla-offsite-v1"; echo "name=$NAME"; echo "ts=$TS"; echo "age_recipient=$PUB"
  echo "ciphertext_bytes=$(wc -c < "$C" | tr -d ' ')"; echo "ciphertext_sha256=$(sha256sum "$C" | cut -d' ' -f1)"
  echo "inner_manifest_sha256=$(sha256sum "$P/MANIFEST.sha256" | cut -d' ' -f1)"; } > "$O/drive/daily/wasla-$TS.manifest"
ssh-keygen -q -Y sign -f "$O/signing.key" -n wasla-offsite-backup "$O/drive/daily/wasla-$TS.manifest"
sha256sum "$O/plain.tar" | cut -d' ' -f1 > "$O/plain.sha256"; rm -f "$O/plain.tar" "$O/signing.key" "$O/signing.key.pub"
echo "daily/$NAME" > "$O/latest"; echo "$TS" > "$O/ts"
ls -l "$O" "$O/drive/daily"

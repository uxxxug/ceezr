#!/usr/bin/env bash
# الغرض: اختبارٌ فعليٌّ لاستبعادِ بايتاتِ وسائطِ محادثةِ الطلبِ من النسخِ الاحتياطيّةِ
#   (WR-40): أرشيفُ البايتاتِ (`storage-files-*.tar`) وبيانُهُ (`*.sha256`) لا يحتويانِ
#   دلوَّ `order-chat-media`، ويحتويانِ سائرَ الدلاءِ (وثائقُ السائقينَ). ويُختبرُ تجاوزُ
#   اسمِ الدلوِّ بمتغيّرِ البيئةِ (`ORDER_CHAT_MEDIA_BUCKET`).
#   يُشغّلُ `backup.sh` الحقيقيَّ نفسَه؛ والمُحاكى وحدَه `docker` (لا جذرَ ولا شبكةَ ولا
#   حاوياتٍ): `inspect` و`exec` تُترجَمُ إلى مجلّدٍ محلّيٍّ يمثّلُ `/var/lib/storage`.
# ينتمي إلى: deploy/casaos/tests — يُشغَّلُ كما هو في CI (لا يحتاجُ root ولا docker).
# الاستعمال: bash deploy/casaos/tests/backup-media-exclusion-test.sh [OUT_DIR]
# الناتج: سطرُ PASS/FAIL لكلِّ حالة، وملخّصٌ في OUT_DIR/media-exclusion-summary.txt.
#   رمزُ الخروجِ 0 إن نجحَ كلُّ شيء.
set -uo pipefail
SRC=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-$PWD/backup-media-exclusion-out}; mkdir -p "$OUT"; OUT=$(cd "$OUT" && pwd)
for c in tar sha256sum find head; do command -v "$c" >/dev/null || { echo "missing $c" >&2; exit 2; }; done
T=$(mktemp -d "${TMPDIR:-/tmp}/wasla-media-excl-XXXXXX"); chmod 700 "$T"
SUM=$OUT/media-exclusion-summary.txt; : > "$SUM"; P=0; F=0
say(){ printf '%s\n' "$*" | tee -a "$SUM"; }
ok(){ P=$((P+1)); say "PASS  $1"; }
bad(){ F=$((F+1)); say "FAIL  $1 -- ${2:-}"; }
cleanup(){ cp -r "$T/logs" "$OUT/logs" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT

# ---------------- عزلُ «الخادم»: نسخةُ عملٍ من السكربتاتِ وdocker وهميّ ----------------
S=$T/opt-wasla; mkdir -p "$S" "$T/logs" "$T/backups" "$T/fakebin"
cp -a "$SRC"/*.sh "$SRC/offsite-tool.py" "$S" 2>/dev/null || cp -a "$SRC"/*.sh "$S"
# pg-snapshot-dump.sh وهميٌّ: بايتاتٌ عشوائيّةٌ وبيانُ صفوفٍ بصيغتِه.
cat > "$S/pg-snapshot-dump.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
head -c 8192 /dev/urandom > "$3"
printf 'public.orders\t2000\t%s\n' "$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')" > "$4"
EOF
chmod 755 "$S/pg-snapshot-dump.sh"
# docker وهمي: inspect ⇒ قائمة، exec ⇒ يُترجَمُ /var/lib/storage إلى مجلّدٍ محلّيٍّ.
SR=$T/storage-root
cat > "$T/fakebin/docker" <<EOF
#!/usr/bin/env bash
set -uo pipefail
if [ "\${1:-}" = "inspect" ]; then echo true; exit 0; fi
if [ "\${1:-}" = "exec" ]; then
  shift; shift  # exec <container>
  if [ "\$1" = "pg_dumpall" ]; then echo "-- fake roles"; exit 0; fi
  if [ "\$1" = "sh" ] && [ "\${2:-}" = "-c" ]; then shift 2; fi
  cmd=\$*
  cmd=\${cmd//\\/var\\/lib\\/storage/\$FAKE_STORAGE_ROOT}
  sh -c "\$cmd"
  exit \$?
fi
exit 1
EOF
chmod 755 "$T/fakebin/docker"

# ---------------- مشهدُ التخزين: دلوُّ وسائطَ + دلوُّ وثائق ----------------
mk_scene(){ # BUCKET → يبني مشهدًا فيه دلوُّ الوسائطِ باسمِ BUCKET ووثائقُ سائقين
  local b=$1
  rm -rf "$SR"; mkdir -p "$SR/$b/orders/11111111-1111-1111-1111-111111111111" "$SR/driver-documents/2026/11"
  head -c 4096 /dev/urandom > "$SR/$b/orders/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222"
  head -c 2048 /dev/urandom > "$SR/driver-documents/2026/11/doc.bin"
}

# ---------------- إعدادُ البيئةِ التي تقرأُها offsite-lib.sh ----------------
CR=$T/config-root; mkdir -p "$CR/etc/wasla" "$CR/opt/wasla"
for f in db.env gateway.env storage.env storage-client.env; do : > "$CR/etc/wasla/$f"; done
: > "$CR/opt/wasla/compose.yml"; : > "$CR/opt/wasla/haproxy.cfg"
run_backup(){ # → يُشغّلُ backup.sh الحقيقيَّ ويعيدُ أرشيفَ البايتاتِ (أو فارغًا عندَ الفشل)
  export PATH="$T/fakebin:$PATH"
  export FAKE_STORAGE_ROOT=$SR
  export BACKUP_DIR=$T/backups CONFIG_ROOT=$CR WASLA_ETC=$CR/etc/wasla WASLA_OPT=$S
  export PROD_DB_CONTAINER=med-db STORAGE_CONTAINER=med-storage STORAGE_DB_CONTAINER=med-storage-db
  export OFFSITE_ENV=$T/no-offsite.env   # غيرُ موجودٍ ⇒ لا رفعَ خارجَ الموقع
  rm -f "$T"/backups/storage-files-*.tar "$T"/backups/storage-files-*.sha256 "$T"/backups/storage-files-*.part
  if bash "$S/backup.sh" > "$T/logs/backup.log" 2>&1; then
    ls -1 "$T"/backups/storage-files-*.tar 2>/dev/null | head -1
  else
    echo ""
  fi
}

# ---------------- الحالاتُ ----------------
# ١. الافتراضي: order-chat-media مستبعَد، ووثائقُ السائقينَ موجودة.
mk_scene order-chat-media
tarf=$(run_backup)
if [ -z "$tarf" ]; then bad "backup.sh ينجح مع docker وهمي" "سجل: $(tail -3 "$T/logs/backup.log" 2>/dev/null | tr '\n' ' ')"
else ok "backup.sh ينجح مع docker وهمي"; fi
if [ -n "$tarf" ] && tar -tf "$tarf" | grep -q "driver-documents/"; then ok "أرشيفُ البايتاتِ يحتوي وثائقَ السائقين"
else bad "أرشيفُ البايتاتِ يحتوي وثائقَ السائقين"; fi
if [ -n "$tarf" ] && tar -tf "$tarf" | grep -q "order-chat-media"; then bad "أرشيفُ البايتاتِ يستبعدُ دلوَّ الوسائط" "وُجد order-chat-media في الأرشيف"
elif [ -n "$tarf" ]; then ok "أرشيفُ البايتاتِ يستبعدُ دلوَّ الوسائط"; fi
man=$(ls -1 "$T"/backups/storage-files-*.sha256 2>/dev/null | grep -v '\.tar\.sha256$' | head -1)
if [ -n "$man" ]; then
  if grep -q "order-chat-media" "$man"; then bad "بيانُ sha256 يستبعدُ دلوَّ الوسائط"; else ok "بيانُ sha256 يستبعدُ دلوَّ الوسائط"; fi
  if grep -q "driver-documents/" "$man"; then ok "بيانُ sha256 يحتوي وثائقَ السائقين"; else bad "بيانُ sha256 يحتوي وثائقَ السائقين"; fi
else bad "بيانُ sha256 موجود"; fi
grep -q "storage_files=1 " "$T/logs/backup.log" && ok "سجلُّ النسخةِ يُعلنُ عددَ الملفاتِ المستبعَدِ منها الوسائط" \
  || bad "سجلُّ النسخةِ يُعلنُ عددَ الملفاتِ" "$(grep -o 'storage_files=[0-9]*' "$T/logs/backup.log" | head -1)"

# ٢. تجاوزُ اسمِ الدلوِّ بالبيئةِ: الاسمُ المخصَّصُ هو المستبعَدُ، والافتراضيُّ يُنسَخ.
export ORDER_CHAT_MEDIA_BUCKET=wasla-rider-media
mk_scene wasla-rider-media
tarf2=$(run_backup)
if [ -n "$tarf2" ] && ! tar -tf "$tarf2" | grep -q "wasla-rider-media"; then ok "الاسمُ المخصَّصُ (ORDER_CHAT_MEDIA_BUCKET) هو المستبعَد"
else bad "الاسمُ المخصَّصُ (ORDER_CHAT_MEDIA_BUCKET) هو المستبعَد"; fi
unset ORDER_CHAT_MEDIA_BUCKET
# ٣. الافتراضيُّ يَستبعِدُ اسمَهُ وحدَه: دلوٌّ آخرُ (لا يعنيهِ) يُنسَخُ كاملًا،
#    وملفٌّ في جذرِ التخزينِ (ليس في دلوٍّ) يُنسَخُ دائمًا.
mk_scene order-chat-media
head -c 100 /dev/urandom > "$SR/root-level-file.bin"
mkdir -p "$SR/another-bucket/x"; head -c 100 /dev/urandom > "$SR/another-bucket/x/f.bin"
tarf3=$(run_backup)
if [ -n "$tarf3" ] && tar -tf "$tarf3" | grep -q "order-chat-media"; then bad "الاسمُ الافتراضيُّ مستبعَدٌ بعدَ إلغاءِ التجاوز" "وُجد order-chat-media"
elif [ -n "$tarf3" ]; then ok "الاسمُ الافتراضيُّ مستبعَدٌ بعدَ إلغاءِ التجاوز"; fi
if [ -n "$tarf3" ] && tar -tf "$tarf3" | grep -q "another-bucket/x/f.bin" && tar -tf "$tarf3" | grep -q "^\./root-level-file.bin$"; then ok "ما ليس في الدلوِّ المستبعَدِ يُنسَخ"
else bad "ما ليس في الدلوِّ المستبعَدِ يُنسَخ"; fi

say "# summary pass=$P fail=$F"
[ "$F" = 0 ]

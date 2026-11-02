#!/usr/bin/env bash
# الغرض: **المرحلة أ — الربطُ فقط** (ADR 0300). على لابتوبِ المالك: مفتاحُ age (إن غاب)، وتثبيتُ مفتاحِ توقيعِ الخادم،
#   وربطُ Google Drive بعميلِ OAuth خاصٍّ بالمالك، ثمّ حفظُ الربطِ على الخادمِ والتحقّقُ من الحساب.
#   **لا يرفعُ شيئاً ولا يفعّلُ الرفعَ الليليّ.** بعدَه، كلٌّ في خطوةٍ منفصلةٍ وبموافقةٍ صريحة:
#   wasla-offsite-first-upload.sh (أوّلُ رفع) ثمّ wasla-offsite-enable-nightly.sh (التفعيل).
# المتطلّبات: bash وage وrclone وssh وssh-keygen، ومُضيفٌ اسمُه `wasla` في ~/.ssh/config، وwasla-laptop-lib.sh
#   بجانبِه. يعملُ على Linux وmacOS وWindows (Git Bash). انظر README-AR.md في الحقيبة.
# الترتيب (ADR 0299): مفتاحُ SSH للخادمِ يُتحقَّقُ منه تحقّقاً مستقلّاً ويُثبَّتُ **قبلَ أيِّ اتصال**، ومفتاحُ توقيعِ
#   النسخِ لا يُطلَبُ ولا يُثبَّتُ إلّا عبرَ اتصالٍ بذلك المفتاحِ المثبَّت.
# الأسرار (ADR 0298 §3): client_secret يُقرأُ دونَ صدى، ويُكتَبُ بأمرٍ داخليٍّ (printf) في ملفٍّ مؤقّتٍ 600 داخلَ
#   مجلّدٍ 700، ثمّ `rclone config reconnect` يكتبُ الرمزَ في الملفِّ نفسِه؛ ويُرسَلُ الملفُّ إلى الخادمِ عبرَ **stdin**
#   لـSSH. لا يظهرُ سرٌّ في وسائطِ أيِّ عمليّة. يُحذَفُ المؤقّتُ عندَ الخروج. المفتاحُ الخاصُّ لـage لا يغادرُ اللابتوب.
set -euo pipefail; umask 077
KEY=${WASLA_AGE_KEY:-$HOME/.wasla/wasla-backup.agekey}; HOST=${WASLA_SSH_HOST:-wasla}
ALLOWED=${WASLA_ALLOWED_SIGNERS:-$HOME/.wasla/allowed_signers}; RP=${WASLA_REMOTE_PREFIX:-sudo /opt/wasla}
for c in age age-keygen rclone ssh ssh-keygen; do command -v "$c" >/dev/null || { echo "ينقصُ الأمر: $c"; exit 1; }; done
# shellcheck source=wasla-laptop-lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/wasla-laptop-lib.sh"
# 0) مفتاحُ SSH للخادم: تحقّقٌ مستقلٌّ من المالك، ثمّ تثبيت. لا اتصالَ ولا مفتاحَ قبلَه.
host_pin_interactive || exit 1
mkdir -p "$(dirname "$KEY")" "$(dirname "$ALLOWED")"; chmod 700 "$(dirname "$KEY")"
if [ ! -f "$KEY" ]; then
  age-keygen -o "$KEY" 2>/dev/null; chmod 600 "$KEY"
  echo "أُنشئَ المفتاحُ الخاصّ: $KEY"
  echo "مهمّ: إن ضاعَ هذا الملفُّ فلا يمكنُ فكُّ أيِّ نسخة. احفظْ نسخةً منه خارجَ الإنترنت (مدير كلمات المرور أو USB)، لا في Drive."
fi
PUB=$(age-keygen -y "$KEY"); echo "المفتاحُ العامّ (ليس سرّاً): $PUB"

"${SSH[@]}" -n -o BatchMode=yes "$HOST" true || {
  echo "تعذّرَ الاتصالُ بـ$HOST عبرَ SSH بالمفتاحِ المثبَّت. إن ظهرَ «Host key verification failed» فالخادمُ الذي وصلتَ إليه ليس خادمَك: توقّفْ."; exit 1; }

# 1) مفتاحُ توقيعِ النسخ: يُنشأُ على الخادمِ إن غاب، ويُطلَبُ عبرَ الاتصالِ الموثَّقِ بالمفتاحِ المثبَّتِ وحدَه.
SIGPUB=$("${SSH[@]}" -n "$HOST" "$RP/offsite-setup.sh --signing-key" | tr -d '\r')
[[ "$SIGPUB" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+$ ]] || { echo "مفتاحُ التوقيعِ من الخادمِ غيرُ صالح"; exit 1; }
if [ -s "$ALLOWED" ] && ! grep -qF "$SIGPUB" "$ALLOWED"; then
  echo "تحذير: مفتاحُ توقيعِ الخادمِ تغيّرَ عمّا هو مثبَّتٌ في $ALLOWED. لن أستبدلَه تلقائيّاً."
  echo "إن كان التغييرُ مقصوداً (خادمٌ جديد) فاحذفْ الملفَّ وأعدِ التشغيل؛ وإلّا فتوقّفْ وتحقّق."; exit 1
fi
printf 'wasla-backup namespaces="wasla-offsite-backup" %s\n' "$SIGPUB" > "$ALLOWED"; chmod 600 "$ALLOWED"
echo "ثُبِّتَ مفتاحُ توقيعِ الخادم: $(host_fp_of "$SIGPUB")"

# 2) حالةُ الخادم (قراءةٌ فقط) قبلَ طلبِ أيِّ سرّ: خادمٌ أقدمُ من ADR 0300 ⇒ توقُّفٌ هنا.
remote_stage || exit 1
# ADR 0301: إعادةُ الربطِ تحتَ رفعٍ ليليٍّ مفعَّلٍ كانت ستغيّرُ حسابَ وجهتِه ⇒ توقُّفٌ هنا قبلَ أيِّ سرّ (والخادمُ يرفضُها أيضاً).
if [ "$STAGE" = enabled ]; then
  echo "الرفعُ الليليُّ مفعَّلٌ على الخادم؛ لا تُعادُ الربطُ وهو مفعَّل كي لا تتغيّرَ وجهةُ النسخِ دونَ موافقتِك. لم يُرسَلْ شيء."
  echo "إن أردتَ حساباً آخر: bash wasla-offsite-enable-nightly.sh --disable ثمّ أعِدْ هذا السكربت، ثمّ أوّلَ رفعٍ جديد، ثمّ التفعيل."; exit 1
fi
if [ "$STAGE" != unlinked ]; then
  confirm RELINK "الخادمُ مربوطٌ مسبقاً (stage=$STAGE). إعادةُ الربطِ تستبدلُ الرمزَ وتُبطِلُ سجلَّ أوّلِ رفع؛ ولا ترفعُ شيئاً، والرفعُ الليليُّ غيرُ مفعَّل." || exit 1
fi

# 3) عميلُ OAuth وربطُ Drive.
IFS= read -rp "Google OAuth Client ID: " CID
[[ "$CID" =~ ^[0-9A-Za-z.-]+\.apps\.googleusercontent\.com$ ]] || { echo "Client ID لا ينتهي بـ.apps.googleusercontent.com"; exit 2; }
IFS= read -rsp "Google OAuth Client secret (لن يظهر): " CSEC; echo
[ -n "$CSEC" ] || { echo "client secret فارغ"; exit 2; }
T=$(mktemp -d "${TMPDIR:-/tmp}/wasla-connect-XXXXXX"); chmod 700 "$T"; trap 'rm -rf "$T"' EXIT
C=$T/rclone.conf
{ printf '[wasla-gdrive]\ntype = drive\n'; printf 'client_id = %s\n' "$CID"; printf 'client_secret = %s\n' "$CSEC"
  printf 'scope = drive.file\n'
  # للاختبارِ وحدَه: خادمُ OAuth محلّيّ وهميّ (tests/mock-oauth.py). الخادمُ يرفضُه ما لم يُفعَّلْ صراحةً هناك.
  if [ -n "${WASLA_TEST_OAUTH_BASE:-}" ]; then printf 'auth_url = %s/auth\ntoken_url = %s/token\n' "$WASLA_TEST_OAUTH_BASE" "$WASLA_TEST_OAUTH_BASE"; fi
} > "$C"
unset CSEC; chmod 600 "$C"
CP=$C; command -v cygpath >/dev/null 2>&1 && CP=$(cygpath -w "$C")
echo "سيفتحُ المتصفّح: سجّلْ دخولَك بحسابِ Google الذي تريدُ النسخَ فيه ووافق. (إن لم يفتح، افتحِ الرابطَ الظاهر.)"
rclone config reconnect wasla-gdrive: --config "$CP" --auto-confirm
grep -q '^token = .*refresh_token' "$C" || { echo "لم يُرجِعْ Google رمزَ تحديث (refresh_token)"; exit 1; }

# 4) حفظُ الربطِ على الخادم: القسمُ عبرَ stdin لـSSH وحدَه. الخادمُ يتحقّقُ بقراءةٍ (about) ولا يرفع.
"${SSH[@]}" "$HOST" "$RP/offsite-setup.sh --link $PUB" < "$C" || { echo "فشلَ الربط. لم يُرفَعْ شيء، والرفعُ الليليُّ غيرُ مفعَّل."; exit 1; }
echo "انتهى الربط: لم يُرفَعْ أيُّ ملفّ، والرفعُ الليليُّ غيرُ مفعَّل."
echo "الخطوةُ التالية (حين تقرّر): bash wasla-offsite-first-upload.sh"

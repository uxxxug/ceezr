# shellcheck shell=bash
# الغرض: ثقةٌ بمفتاحِ SSH لخادمِ وصلة **دونَ قبولِ أوّلِ بصمة** (ADR 0299). يستوردُه سكربتا الحقيبة.
# ينتمي إلى: deploy/casaos/laptop — يُشحَنُ في wasla-offsite-kit.zip بجانبِ السكربتَين.
#
# المرجع: مفتاحُ ed25519 للخادمِ مثبَّتٌ هنا في الحقيبة. بصمتُه طابقت، قبلَ تثبيتِه، البصمةَ التي سلّمها المالكُ
#   من سكربتِ الإعدادِ على الخادمِ نفسِه (قناةٌ مستقلّةٌ عن نفقِ SSH) — docs/evidence/production/WR-27-offsite-kit-hostkey-20261101.md.
# أوّلَ مرّة: يطلبُ من المالكِ قراءةَ البصمةِ من الخادمِ **بقناةٍ غيرِ هذا الاتصال** (شاشتُه، أو مخرجاتُ سكربتِ
#   الإعداد)، وكتابةَ آخرِ 8 أحرفٍ منها. **لا تُعرَضُ البصمةُ المتوقَّعةُ قبلَ الإدخال**، فلا يُنسَخُ المعروض.
#   المطابقةُ تكتبُ ~/.wasla/known_hosts. وبعدَها كلُّ اتصالٍ بـStrictHostKeyChecking=yes على هذا الملفِّ وحدَه.
# تغيُّرُ مفتاحِ الخادم (خادمٌ جديد) يحتاجُ حقيبةً جديدةً من المستودعِ بالمرجعِ الجديد؛ لا تجاوزَ من سطرِ الأوامر.

WASLA_HOST_ALIAS=wasla-casaos
WASLA_HOST_PUB='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA+XFU4/ea3esCMvhZ3UjxKikrJdDWhWzJjLILtUhAZX'
WASLA_HOST_FP='SHA256:xpIw6WmQ6gB/t7pDMYlzvkcfgSbe7/8LyNECMJd0D+U'
KH=${WASLA_KNOWN_HOSTS:-$HOME/.wasla/known_hosts}
# كلُّ اتصال: مفتاحُ ed25519 وحدَه، وملفُّنا وحدَه، ورفضُ أيِّ مفتاحٍ غيرِ مثبَّت.
# shellcheck disable=SC2034  # يستعملُه السكربتانِ اللذان يستوردانِ الملفّ.
SSH=(ssh -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$KH" -o GlobalKnownHostsFile=/dev/null
  -o HostKeyAlias="$WASLA_HOST_ALIAS" -o HostKeyAlgorithms=ssh-ed25519 -o UpdateHostKeys=no)

host_fp_of(){ ssh-keygen -lf <(printf '%s\n' "$1") 2>/dev/null | cut -d' ' -f2; }

# الحقيبةُ نفسُها متّسقة: المفتاحُ المضمَّنُ يطابقُ بصمتَه المضمَّنة (يكشفُ تعديلاً جزئيّاً أو تلفاً).
host_kit_ok(){ [ "$(host_fp_of "$WASLA_HOST_PUB")" = "$WASLA_HOST_FP" ] || {
  echo "الحقيبةُ تالفةٌ أو معدَّلة: مفتاحُ الخادمِ المضمَّنُ لا يطابقُ بصمتَه. نزّلْ الحقيبةَ من جديدٍ وطابقْ SHA256SUMS."; return 1; }; }

# مثبَّتٌ سابقاً؟ يجبُ أن يكونَ سطراً واحداً بالمفتاحِ المرجعيِّ نفسِه.
host_pinned(){ [ -s "$KH" ] && [ "$(cat "$KH")" = "$WASLA_HOST_ALIAS $WASLA_HOST_PUB" ]; }

# للسكربتاتِ التي لا تثبّت (اختبارُ الاستعادة): مثبَّتٌ ومطابقٌ أو توقّف.
host_require(){ host_kit_ok || return 1
  if [ -e "$KH" ] && ! host_pinned; then
    echo "تحذير: $KH لا يطابقُ مفتاحَ الخادمِ المرجعيَّ في الحقيبة. لن أتّصل. لا تعدّلْه يدويّاً؛ تحقّقْ أوّلاً."; return 1; fi
  host_pinned || { echo "مفتاحُ الخادمِ غيرُ مثبَّت: شغّلْ wasla-offsite-connect.sh أوّلاً."; return 1; }; }

# أوّلَ مرّة: تحقّقٌ مستقلٌّ من المالك. لا يُعرَضُ المتوقَّعُ قبلَ الإدخال.
host_pin_interactive(){ host_kit_ok || return 1
  if host_pinned; then echo "مفتاحُ الخادمِ مثبَّتٌ سابقاً ($WASLA_HOST_FP)."; return 0; fi
  if [ -e "$KH" ]; then
    echo "تحذير: $KH موجودٌ ولا يطابقُ مفتاحَ الخادمِ المرجعيّ. لن أستبدلَه. احذفْه عن قصدٍ بعدَ التحقّق، ثمّ أعدِ التشغيل."; return 1; fi
  cat <<'TXT'
— التحقّقُ من مفتاحِ الخادم (مرّةً واحدة) —
اقرأْ بصمةَ مفتاحِ SSH للخادمِ من قناةٍ غيرِ هذا الاتصال، إحدى اثنتين:
  أ) على الخادمِ نفسِه (شاشتُه ولوحةُ مفاتيحِه، أو طرفيّةُ لوحةِ CasaOS على الشبكةِ المحلّيّةِ إن وُجدت):
       ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
  ب) أو سطرُ ‎HOST_KEY … (ED25519)‎ في مخرجاتِ سكربتِ الإعدادِ الذي شغّلتَه على الخادم.
البصمةُ تبدأُ بـ SHA256: . اكتبْ آخرَ 8 أحرفٍ منها كما هي (الأحرفُ الكبيرةُ والصغيرةُ مهمّة).
TXT
  local got want; IFS= read -rp "آخرُ 8 أحرف: " got; got=$(printf '%s' "$got" | tr -d ' \r\t')
  want=${WASLA_HOST_FP: -8}
  if [ "$got" != "$want" ]; then
    echo "لا تطابق. لم يُثبَّتْ شيءٌ ولم يُتَّصَلْ بالخادم."
    echo "إن قرأتَ البصمةَ من الخادمِ نفسِه وما زالت مختلفة: توقّفْ، فقد يكونُ الاتصالُ ليس بخادمِك. أخبرِ المهندس."; return 1; fi
  mkdir -p "$(dirname "$KH")"; chmod 700 "$(dirname "$KH")"
  printf '%s %s\n' "$WASLA_HOST_ALIAS" "$WASLA_HOST_PUB" > "$KH"; chmod 600 "$KH"
  echo "تطابق. ثُبِّتَ مفتاحُ الخادم: $WASLA_HOST_FP"; }

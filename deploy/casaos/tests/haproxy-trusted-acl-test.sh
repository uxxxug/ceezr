#!/usr/bin/env bash
# الغرض: حارسٌ ثابتٌ لـ«الشبكاتِ الموثوقةِ» في haproxy.cfg (ADR 0295): `from_host` في الواجهتَينِ
#   العامّةِ (public_front :8443) والإداريّةِ (admin_front :8444) لا يثقُ إلّا بـloopback وعنوانِ
#   المضيفِ المحلّيّ ونطاقَي شبكاتِ wasla نفسِها (internal/egress في compose) — لا بـ`172.16.0.0/12`
#   التي تثقُ بكلِّ حاوياتِ المضيفِ أياً كانَ تطبيقُها. والاختبارُ يُثبِتُ التطابقَ بينَ الـACL
#   والنطاقَينِ الموثَّقَينِ في compose.gateways.yml، ثمّ يُطفِرُ الشيفرةَ (طفرةٌ تُعيدُ العِمّ
#   الواسع، وطفرةٌ تُسقِطُ جسرَ cloudflared، وطفرةٌ تُسقِطُ واجهةً كاملة) ويُثبِتُ أنَّ الحارسَ
#   يُسقِطُها كلَّها — فلا يعودَ العِمُّ الواسعُ صامتًا.
# الاستعمال: bash deploy/casaos/tests/haproxy-trusted-acl-test.sh [OUT_DIR]
# الناتج: سطرُ PASS/FAIL لكلِّ حالة، وملخّصٌ في OUT_DIR/haproxy-acl-summary.txt. رمزُ الخروج 0 إن نجحَ كلُّ شيء.
set -uo pipefail
SRC=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-$PWD/haproxy-acl-out}; mkdir -p "$OUT"; OUT=$(cd "$OUT" && pwd)
T=$(mktemp -d "${TMPDIR:-/tmp}/wasla-hacl-XXXXXX"); chmod 700 "$T"
SUM=$OUT/haproxy-acl-summary.txt; : > "$SUM"; P=0; F=0
say(){ printf '%s\n' "$*" | tee -a "$SUM"; }
ok(){ P=$((P+1)); say "PASS  $1"; }
bad(){ F=$((F+1)); say "FAIL  $1 -- ${2:-}"; }
cleanup(){ rm -rf "$T"; }
trap cleanup EXIT

CFG=$SRC/haproxy.cfg
COMPOSE=$SRC/compose.gateways.yml
ACL='acl from_host src 127.0.0.0/8 172.21.0.0/16 172.22.0.0/16 192.168.0.135'

# check CFG COMPOSE — ينجحُ فقط إذا كانَ الـACLُ مثبَّتًا في الواجهتَينِ بلا عِمٍّ واسعٍ،
# وكانَ النطاقانِ موثَّقَينِ في مقطعِ compose (التطابقُ حتميٌّ لا مصادفة).
check(){
  local cfg=$1 compose=$2
  # 1) السطرُ الكاملُ موجودٌ في الواجهتَينِ (public_front وadmin_front) — لا في واحدةٍ وحدها.
  local n; n=$(grep -c "^  $ACL\$" "$cfg" || true)
  [ "$n" -eq 2 ] || { echo "acl-count=$n (want 2)"; return 1; }
  # 2) لا عِمَّ واسعَ في أسطرِ الـACL نفسِها (التعليقاتُ خارجَ الحكم): لا /12 ولا /8 خاصًّا
  #    سوى loopback، ولا الشبكاتُ المحليّةُ الأخرى، ولا نطاقًا 172 سوى نطاقَي wasla.
  if grep -E '^  acl from_host src' "$cfg" | grep -vE 'src 127\.0\.0\.0/8( 172\.21\.0\.0/16 172\.22\.0\.0/16 192\.168\.0\.135)?$' | grep -q .; then
    echo "wide-or-foreign-net-found"; return 1
  fi
  # 3) النطاقانِ موثَّقانِ في مقطعِ compose (التثبيتُ الحتميُّ للتطابق).
  grep -q 'subnet: 172.21.0.0/16' "$compose" || { echo "compose-missing-172.21"; return 1; }
  grep -q 'subnet: 172.22.0.0/16' "$compose" || { echo "compose-missing-172.22"; return 1; }
  return 0
}

# ---------------- الحالةُ السليمةُ ----------------
if check "$CFG" "$COMPOSE" >"$T/ok.log" 2>&1; then ok "السليمة: الـACL في الواجهتَينِ بنطاقَي wasla وحدهما"; else bad "السليمة" "$(cat "$T/ok.log")"; fi

# ---------------- الطفراتُ (كلُّ واحدةٍ يجبُ أن يُسقِطَها الحارسُ) ----------------
mutate(){ # LOG_NAME SED_EXPR
  cp "$CFG" "$T/m.cfg"; sed -i "$2" "$T/m.cfg"
  if check "$T/m.cfg" "$COMPOSE" >"$T/$1.log" 2>&1; then bad "طفرة: ${1#m*-} (قبلَ الإصلاحِ صامتة)" "$(cat "$T/$1.log")"; else ok "طفرة: ${1#m*-} يُسقِطُها الحارس"; fi
}
# طفرة 1 — العِمُّ الواسعُ يعودُ (الثقةُ بكلِّ حاوياتِ المضيف).
mutate "m1-wide" 's#^  acl from_host src 127.0.0.0/8 172.21.0.0/16 172.22.0.0/16 192.168.0.135$#  acl from_host src 127.0.0.0/8 172.16.0.0/12 192.168.0.135#'
# طفرة 2 — إسقاطُ جسرِ egress (كلامُ cloudflared بعدَ NAT يُرفَضُ: كسرٌ حقيقيٌّ).
mutate "m2-no-egress" 's#^  acl from_host src 127.0.0.0/8 172.21.0.0/16 172.22.0.0/16 192.168.0.135$#  acl from_host src 127.0.0.0/8 172.21.0.0/16 192.168.0.135#'
# طفرة 3 — إسقاطُ الواجهةِ الإداريّةِ منَ الحمايةِ (8444 بلا from_host).
mutate "m3-no-admin" '/^frontend admin_front/,/^backend/{/^  acl from_host/d}'
# طفرة 4 — النطاقانِ في الـACL لا يطابقانِ الموثَّقَ في compose (تطابقٌ عرضيٌّ ينكشف).
cp "$COMPOSE" "$T/m-compose.yml"; sed -i 's/subnet: 172.22.0.0.16/subnet: 172.22.0.0.16/; s#subnet: 172.22.0.0/16#subnet: 172.29.0.0/16#' "$T/m-compose.yml"
if check "$CFG" "$T/m-compose.yml" >"$T/compose-drift.log" 2>&1; then bad "طفرة: انحرافُ compose عن الـACL (بلا كشف)" "$(cat "$T/compose-drift.log")"; else ok "طفرة: انحرافُ compose عن الـACL يُسقِطُه الحارس"; fi

say "----"; say "PASS=$P FAIL=$F"
[ "$F" -eq 0 ]
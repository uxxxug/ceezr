#!/usr/bin/env bash
# الغرض: إثبات أنّ بناء الصورتين قابل لإعادة الإنتاج، بلا حاجة إلى عفريت Docker.
#
# لماذا لا `docker build` مباشرةً: بيئة التحقّق الحالية بلا Docker ولا صلاحية جذر.
# فبدلاً من ادّعاء بناءٍ لم يحدث، يُعاد هنا بناء نفس الشروط بالضبط: مجلَّد نظيف
# لا يحوي إلّا ما تنسخه أسطر COPY، ثمّ التثبيت المجمَّد نفسه، ثمّ حارس حلّ
# الاستيرادات نفسه. وما يفشل هنا يفشل في `docker build`، وما ينجح هنا لا يضمن
# طبقات الصورة لكنه يضمن الشيئين المقصودين: تجميد القفل، واكتمال ما نُسخ.
#
# التشغيل: bash scripts/verify-container-build.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

pinned_tag() { grep -m1 '^FROM ' "$1" | awk '{print $2}'; }
GW_TAG="$(pinned_tag docker/Dockerfile.gateway)"
WK_TAG="$(pinned_tag docker/Dockerfile.worker)"
LOCAL_BUN="$(bun --version)"

echo "▶ إصدار bun المحلّي: ${LOCAL_BUN}"
for tag in "$GW_TAG" "$WK_TAG"; do
  case "$tag" in
    "oven/bun:${LOCAL_BUN}") echo "✅ ${tag} مثبَّت على نفس الإصدار المفحوص" ;;
    oven/bun:*.*.*) echo "❌ ${tag} مثبَّت لكن لا يطابق ${LOCAL_BUN}"; exit 1 ;;
    *) echo "❌ ${tag} وسم عائم — ممنوع"; exit 1 ;;
  esac
done

for f in docker/Dockerfile.gateway docker/Dockerfile.worker; do
  grep -q 'COPY package.json bun.lock tsconfig.json' "$f" || { echo "❌ ${f} لا ينسخ bun.lock"; exit 1; }
  grep -q 'bun install --frozen-lockfile' "$f" || { echo "❌ ${f} لا يفرض التثبيت المجمَّد"; exit 1; }
  grep -q 'bun install$' "$f" && { echo "❌ ${f} فيه تثبيت غير مجمَّد"; exit 1; }
done
echo "✅ كلا الملفّين ينسخ القفل ويفرض التثبيت المجمَّد"

run_stage() {
  local name="$1" entry="$2"; shift 2
  local dir; dir="$(mktemp -d)"
  trap 'rm -rf "$dir"' RETURN
  cp package.json bun.lock tsconfig.json "$dir/"
  ( cd "$dir" && bun install --frozen-lockfile >/dev/null 2>&1 ) \
    || { echo "❌ ${name}: التثبيت المجمَّد فشل — القفل متعارض مع package.json"; exit 1; }
  cmp -s bun.lock "$dir/bun.lock" \
    || { echo "❌ ${name}: القفل تغيّر داخل البناء — البناء غير قابل لإعادة الإنتاج"; exit 1; }
  cp -R packages "$dir/packages"
  mkdir -p "$dir/apps"
  for a in "$@"; do cp -R "apps/$a" "$dir/apps/$a"; done
  ( cd "$dir" && bun build "$entry" --target=bun --outfile=/dev/null >/dev/null 2>&1 ) \
    || { echo "❌ ${name}: حلّ الاستيرادات فشل — الصورة لن تُقلع (وحدة ناقصة من COPY)"; exit 1; }
  echo "✅ ${name}: قفل مطابق + كلّ استيراد محلول"
}

run_stage "gateway" "apps/gateway/src/index.ts" gateway workers admin-dashboard
run_stage "worker"  "apps/workers/src/index.ts" workers

echo "✅ بناء الصورتين قابل لإعادة الإنتاج"

# ADR 0244: UI-9 — RTL / Accessibility / Responsive / Performance QA

**الحالة:** مقبول — قيد التنفيذ (PR مفتوح)
**التاريخ:** 2026-10-06
**المرحلة:** WASLA UI/UX REFOUNDATION — UI-9 (RTL / Accessibility / Responsive / Performance)
**المرجع:** `docs/UI_UX_CANONICAL_DIRECTIVE.md` §§9، 10.5، 10.8، 10.9
**Work Packet:** `docs/work-packets/ui-9-rtl-a11y-responsive-perf.json`

## السياق

أُنجزت الأسطح من UI-1 إلى UI-8. المرحلة الآن ليست إعادة بناء بل QA شامل: مسح، إثبات، إصلاح.

## القرار

### النطاق

- مسح آلي ثابت لكل أسطح `apps/miniapp/src/surfaces/` و`global.css`.
- تحديد العيوب المثبتة وربطها بملف وسطح وقاعدة UI-9 منتهكة.
- إصلاح بأقل تغيير ممكن.
- إضافة حرّاس انحدار ساكنين للأنماط المؤكدة.

### ما لا يُدَّعى

- لا يُدَّعى اختبار متصفح حقيقي حيث يمنعه بيئة DOM. يُسجَّل الحد بصدق كحارس ساكن.
- لا يُدَّعى قياس FCP/LCP من بيئة غير متصفّح.
- لا beauty work بلا عيب مثبت.

### مصفوفة QA

1. **RTL/LTR**: `ar` و`en` و`ur`، logical properties فقط، تحقق الاتجاه والمحاذاة والأسهم وBackButton والتبويبات والsteppers والنماذج والبطاقات وbanners وdialogs وtruth states ومناطق الإجراءات.
2. **Accessibility**: keyboard navigation، focus order وvisible focus، Dialog/Sheet trap + Escape + focus return، semantic HTML، labels وربط الحقول، tabs وtabpanel وaria، أيقونات بأسماء قابلة للقراءة، الحالات السبع تعلن لقارئ الشاشة، لا اعتماد على اللون وحده، touch targets ≥ 44×44، prefers-reduced-motion، contrast/type scale لا يتراجع.
3. **Responsive**: narrow/normal/large + Telegram desktop، RTL وLTR، لا overflow أفقي، لا قص للنص، لا تداخل، لا أزرار لا يمكن الوصول إليها.
4. **Performance**: shell + identity ≤ 180KB gzip، CSS ≤ 40KB gzip، deferred ≤ 120KB gzip، ≤ 6 طلبات first-render، إعادة قياس Slow 4G.

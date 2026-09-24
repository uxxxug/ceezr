# F1-09 — التحليل التشخيصي لسبب تأخر FCP على Slow 4G + CPU ×4

**التاريخ:** 2026-09-24  
**الغرض:** تشخيص فقط — لا تحسين، لا تغيير حدود، لا تغيير `SLOW_4G_GATE_MODE`.  
**الأدلة:** Chromium performance traces (CDP `Tracing` domain) لثلاثة سيناريوهات × ثلاثة متغيرات (نص مخفي / نص مرئي / استئصال imports).  
**بيئة القياس:** sandbox محلي — معالج أسرع من GitHub Actions. النمط النسبي مطابق، لكن الأرقام المطلقة أقل من CI.
**قياس CI المطلق:** لم يُلتقط trace في CI بعد — آلية التأخير مُثبَتة محليًا، لكن تحليل الـ~4.1s المطلق في CI يحتاج التقاط trace في CI نفسها.

---

## الخلاصة المثبتة في الـsandbox

الـskeleton الموجود في HTML الأولي **يُرسم مبكرًا** (firstPaint عند 656–693ms على Slow 4G في الـsandbox)، لكن **نصه الوحيد مخفي بصريًا** بـ`clip:rect(0 0 0 0)` و`width:1px;height:1px`. متصفح Chromium لا يحتسب النص المخفي كـ«contentful». النتيجة في الـsandbox: FCP لا يُشعَّل إلا بعد أن يحمّل React ويُرسم نصًا مرئيًا — عند 2224ms (Slow 4G + CPU ×4).

**التحقق المُثبَت بالاستئصال (ablation):** عند استبدال النص المخفي بنص مرئي (بنفس المحتوى «جارٍ التحميل»)، قفز FCP من 2224ms إلى **680ms** — أي قبل أن تكتمل تحميل الـJS bundles بـ1400ms. الـskeleton المرئي يُرسم عند 676ms وFCP يُشعَّل عند 680ms.

**تحذير النطاق:** هذه النتائج تخص الـsandbox حصرًا. لم يُلتقط trace في CI بعد، ولا يُعرف ما إذا كانت نفس الآلية تُفسر الـ~4.1s المسجلة في CI. نسبة الشبكة (94%) محلية ولا تُنقل إلى CI.

---

## 1. السيناريوهات المقاسة (v3 — server cache مُصلَح، markers مُتحقَّق منها)

### المتغير 1: نص مخفي (HTML أصلي)

| السيناريو | FCP | firstPaint | أول نص مرسوم | shell.js يكتمل | vendor-react.js يكتمل |
|---|---|---|---|---|---|
| Slow 4G + CPU ×4 | 2224.0 ms | 693.4 ms | 2213.3 ms | 2104.4 ms | 1939.1 ms |
| Slow 4G + CPU ×1 | 2128.0 ms | 644.1 ms | 2113.7 ms | 2080.6 ms | 1913.7 ms |
| بدون throttle | 104.0 ms | 37.9 ms | 101.1 ms | 59.2 ms | 57.4 ms |

### المتغير 2: نص مرئي (استبدال `sk-preboot__visually-hidden` بنص مرئي)

| السيناريو | FCP | firstPaint | أول نص مرسوم | shell.js يكتمل | vendor-react.js يكتمل |
|---|---|---|---|---|---|
| Slow 4G + CPU ×4 | 680.0 ms | 655.7 ms | 675.9 ms | 2102.6 ms | 1932.1 ms |
| Slow 4G + CPU ×1 | 648.0 ms | 648.0 ms | 644.2 ms | 2083.5 ms | 1915.7 ms |
| بدون throttle | 36.0 ms | 36.0 ms | 31.5 ms | 62.1 ms | 63.9 ms |

### المتغير 3: استئصال (إزالة `import` statements من الـmodule script)

| السيناريو | FCP | firstPaint |
|---|---|---|
| Slow 4G + CPU ×4 | — (لا يُشعَّل) | يُرسم الخلفية |
| بدون throttle | — (لا يُشعَّل) | يُرسم الخلفية |

ملاحظة: الـJS bundles لا تزال تُحمَّل عبر `<link rel="modulepreload">` في الـHTML، لكن دون `import` statements لا تُقيَّم ولا يُنفَّذ React. النتيجة: لا يوجد نص مرئي (الـskeleton text مخفي) وFCP لا يُشعَّل. هذا يؤكد أن FCP يعتمد على وجود نص مرئي، وليس على تحميل الـJS bundles في حد ذاته.

### المقارنة

| السيناريو | FCP (مخفي) | FCP (مرئي) | التحسين |
|---|---|---|---|
| Slow 4G + CPU ×4 | 2224 ms | 680 ms | −1544 ms (69%) |
| Slow 4G + CPU ×1 | 2128 ms | 648 ms | −1480 ms (70%) |
| بدون throttle | 104 ms | 36 ms | −68 ms (65%) |

---

## 2. Timeline مختصر من navigation إلى FCP

### Slow 4G + CPU ×4 — نص مخفي

```
t=0ms       requestStart
t=12ms      responseStart (TTFB)
t=630ms     responseEnd (HTML download complete, 10.9 KB)
t=693ms     firstPaint (خلفية فقط ← غير contentful)
t=1939ms    vendor-react.js download complete
t=2104ms    shell.js download complete
t=2106ms    Long Task (51ms — تقييم modules + React render)
t=2213ms    أول LayoutObjectPainted بـtext=True (نص React)
t=2224ms    firstContentfulPaint ← FCP
```

### Slow 4G + CPU ×4 — نص مرئي

```
t=0ms       requestStart
t=5ms       responseStart (TTFB)
t=633ms     responseEnd (HTML download complete)
t=656ms     firstPaint (خلفية)
t=676ms     أول LayoutObjectPainted بـtext=True (نص الـskeleton المرئي)
t=680ms     firstContentfulPaint ← FCP
t=1932ms    vendor-react.js download complete (بعد FCP بـ1252ms)
t=2103ms    shell.js download complete (بعد FCP بـ1423ms)
```

### Slow 4G + CPU ×4 — استئصال (بدون imports)

```
t=0ms       requestStart
t=4ms       responseStart (TTFB)
t=619ms     responseEnd (HTML download complete)
t=693ms     firstPaint (خلفية فقط)
             ← لا نص، لا React، FCP لا يُشعَّل
t=2552ms    vendor-react.js download complete (لكن لا يُقيَّم)
t=2720ms    shell.js download complete (لكن لا يُقيَّم)
```

---

## 3. أكبر مصادر التأخير مرتبة زمنيًا (نص مخفي، Slow 4G + CPU ×4)

| المرحلة | الوقت | النسبة | العامل |
|---|---|---|---|
| HTML download (request→responseEnd) | 630 ms | 28% | شبكة |
| Gap: firstPaint → first text | 1520 ms | 68% | انتظار JS bundles |
| CPU (parse + eval + layout + paint) | 74 ms | 3% | CPU |
| **FCP الكلي** | **2224 ms** | **100%** | |

### أين تذهب الـ~2.2s؟

```
HTML download + parse     693ms   ████████████████████████  (31%)
JS bundle download       1411ms   ████████████████████████████████████████████████████  (63%)
CPU (eval + render)         74ms   ██  (3%)
─────────────────────────────────
FCP                      2224ms
```

**الشبكة هي العامل الحاسم** (94% من الزمن). CPU ×4 يضيف ~100ms فقط.

### مع نص مرئي:

```
HTML download + parse + paint   680ms   ████████████████████████████████████  (100%)
─────────────────────────────────────
FCP                             680ms
```

لا حاجة لانتظار JS bundles — النص المرئي في الـskeleton يكفي.

---

## 4. إجابة الأسئلة المحددة

### (1) وقت وصول/تحميل HTML
- **Slow 4G + CPU ×4:** requestStart=3.9ms، responseStart=12.1ms (TTFB)، responseEnd=630.4ms
- **بدون throttle:** requestStart=1.3ms، responseStart=3.6ms، responseEnd=4.0ms
- **ليس العنق الزجاجة.** HTML صغير (10.9 KB مضغوط) وسريع.

### (2) وقت parsing للـHTML
- ParseHTML يكتمل قبل firstPaint بـ~60ms.
- **ليس العنق الزجاجة.** الـHTML يحتوي على 61 KB CSS مُضمَّن، لكن parsing سريع.

### (3) وقت تحميل وتنفيذ preboot
- الـpreboot هو `<script type="module">` inline مع `import` statements.
- **النتيجة المرصودة في الـtrace:** تنفيذ الـpreboot وقع بعد FCP في هذا التشغيل. هذا لا يُعمَّم على كل مسار تنفيذ ممكن — ترتيب التنفيذ يعتمد على `module semantics` وتحميل `telegram-web-app.js` والـimports. المسجل هنا هو الترتيب المرصود لا توقّع معمم.
- في مسار القياس الحالي، نتائج الـpreboot لا تُقدّم FCP.

### (4) وقت تحميل وتنفيذ JavaScript bundles
- **shell.js:** 92.7 KB → يكتمل عند 2104ms (Slow 4G + CPU ×4)
- **vendor-react.js:** 63.6 KB → يكتمل عند 1939ms
- V8 يوزّع (parse) الـbundles على خيط خلفي أثناء التحميل.
- تقييم الـmodules على الخيط الرئيسي يبدأ بعد اكتمال التحميل (Long Task 51ms).

### (5) main-thread blocking / long tasks
- **CPU ×4 (نص مخفي):** Long Task واحد (51ms) عند t=2106ms — تقييم modules + React render.
- **CPU ×4 (نص مرئي):** لا توجد long tasks قبل FCP (FCP عند 680ms، قبل تحميل JS).
- **CPU ×1:** لا توجد long tasks >50ms.

### (6) وقت إنشاء DOM الخاص بالـskeleton
- الـskeleton موجود في HTML الأولي (ليس في `<template>` ولا يُنشأ بـJS).
- ParseHTML يكتمل قبل firstPaint.
- **DOM الـskeleton جاهز مبكرًا.**

### (7) وقت style/layout/paint لأول محتوى
- **نص مخفي:** أول LayoutObjectPainted بـtext=True عند 2213ms (نص React، بعد تحميل JS).
- **نص مرئي:** أول LayoutObjectPainted بـtext=True عند 676ms (نص الـskeleton، قبل تحميل JS).
- **لا يوجد اختناق في style/layout/paint.** الاختناق في انتظار تحميل الـJS bundles (في حالة النص المخفي).

### (8) تأثير CPU ×4 مقارنة بنفس المسار بدون CPU throttling
- **FCP (نص مخفي):** 2224ms (×4) vs 2128ms (×1) → **+96ms** (4.5%)
- **FCP (نص مرئي):** 680ms (×4) vs 648ms (×1) → **+32ms** (4.7%)
- **الشبكة:** متطابقة (shell.js: 2104ms vs 2081ms)
- **الاستنتاج:** CPU ×4 يضيف ~5% فقط. الشبكة هي العامل الحاسم.

### (9) هل الشبكة هي العامل الحاسم أم CPU/main-thread أم تفاعل الاثنين؟
- **في الـsandbox (نص مخفي):** الشبكة مهيمنة (94%) — FCP ينتظر تحميل JS bundles.
- **في الـsandbox (نص مرئي):** الشبكة مهيمنة (100%) — FCP يحدث بعد تحميل HTML فقط.
- **CPU ×4 تأثيره ضئيل** (~5%).
- تفاعل الاثنين ضئيل: لا توجد long tasks قبل تحميل JS.
- **ملاحظة النطاق:** هذه النسب تخص الـsandbox. لم تُفصل مساهمات الشبكة/CPU في الـ~4.1s في CI بنفس الطريقة.

### (10) هل الـskeleton موجود فعليًا في HTML الأولي أم يعتمد على JavaScript؟
- **الـskeleton موجود في HTML الأولي.** محتوى الـbody:
  ```html
  <div id="root">
    <div class="sk-preboot" aria-hidden="true">
      <span class="sk-preboot__visually-hidden">جارٍ التحميل</span>
      <span class="sk-preboot__line sk-preboot__line--title"></span>
      <span class="sk-preboot__line"></span>
      <span class="sk-preboot__line"></span>
      <span class="sk-preboot__line sk-preboot__line--short"></span>
    </div>
  </div>
  <script type="module">
  import{...}from"/assets/shell-...js";
  import{...}from"/assets/vendor-react-...js";
  import{...}from"/assets/identity-...js";
  ...
  </script>
  ```
- **لا يعتمد على JavaScript للرسم.** لكن النص الوحيد فيه مخفي بصريًا بـ`clip:rect(0 0 0 0)`.
- **مع نص مرئي، الـskeleton يُرسم عند 676ms** — قبل تحميل JS bundles بـ1428ms.

---

## 5. السبب المرصود في الـsandbox

### نص الـskeleton مخفي بصريًا — Chrome لا يحتسبه كـcontentful

الـHTML المبني يحتوي على:
```html
<span class="sk-preboot__visually-hidden">جارٍ التحميل</span>
```

CSS لـ`sk-preboot__visually-hidden`:
```css
position: absolute;
width: 1px;
height: 1px;
overflow: hidden;
clip: rect(0 0 0 0);
white-space: nowrap;
```

**خوارزمية FCP في Chromium** تحتسب النص كـ«contentful» فقط إذا كان **مرئيًا للمستخدم**. النص المخفي بـ`clip:rect(0 0 0 0)` و`width:1px;height:1px` لا يُحتسب. العناصر الفارغة (`<span>` بـ`background-color` فقط) لا تُحتسب أيضًا — FCP يحتسب نصًا وصورًا فقط.

### الدليل من الـtrace (v3 — server cache مُصلَح)

**نص مخفي، Slow 4G + CPU ×4:**
- firstPaint: 693ms (خلفية)
- أول `LayoutObjectPainted` بـ`text=True`: 2213ms (نص React، بعد تحميل JS)
- FCP: 2224ms

**نص مرئي، Slow 4G + CPU ×4:**
- firstPaint: 656ms (يشمل نص الـskeleton)
- أول `LayoutObjectPainted` بـ`text=True`: 676ms (نص الـskeleton!)
- FCP: 680ms
- shell.js يكتمل عند 2103ms — **بعد FCP بـ1423ms**

### الاستئصال (ablation) يؤكد

عند إزالة `import` statements من الـmodule script:
- React لا يُحمَّل ولا يُنفَّذ.
- لا يوجد نص مرئي (الـskeleton text مخفي).
- FCP لا يُشعَّل أبدًا.

هذا يثبت أن FCP يعتمد على وجود نص مرئي — إما من الـskeleton (إذا كان مرئيًا) أو من React (بعد تحميل JS).

### ملاحظة حول سبب ظهور firstPaint مبكرًا

firstPaint يرسم الخلفية (node=`#document`)، وليس النص. مع نص مرئي، النص يُرسم بعد firstPaint بـ~20ms ويُشعّل FCP.

### حدود ما هو مثبت

المثبت في الـsandbox:
- `clip:rect(0 0 0 0)` يجعل نص الـskeleton غير محتسب كـcontentful في Chromium.
- استبداله بنص مرئي يُقدّم FCP من 2224ms إلى 680ms في الـsandbox.
- FCP في هذا الـHTML لا يحدث حتى يظهر محتوى مرئي (skeleton أو React).

غير مثبت:
- أن هذه هي السبب الكامل للـ~4.1s في CI. قد يكون هناك عوامل إضافية في بيئة CI لم تظهر في الـsandbox (معالج أبطأ، ترتيب تنفيذ مختلف، إلخ).

---

## 6. ما الذي يمكن تغييره هندسيًا

### قابل للعلاج ضمن الكود الحالي — نعم

**جعل نص الـskeleton مرئيًا.** استبدال `sk-preboot__visually-hidden` (clip:rect(0 0 0 0)) بنص مرئي فعليًا للمستخدم. هذا سيُشعّل FCP عند ~680ms على Slow 4G + CPU ×4 (في الـsandbox) — ضمن حد 1.8s.

المحتوى المُقترح: عرض «جارٍ التحميل» كنص مرئي في الـskeleton بدلاً من إخفائه. الـskeleton مصمم أصلاً ليكون شاشة تحميل — النص يجب أن يكون مرئيًا.

### ما يحتاج قرارًا خارجيًا — لا

- تقليل حجم JS bundles يحتاج قرارات معمارية لكنه **غير ضروري** لحل مشكلة FCP.
- لا توجد عوائق خارجية.

### ما لم يُقَس بعد

- **التحليل المطلق للـ~4.1s في CI لم يُلتقط بعد.** آلية التأخير مُثبَتة محليًا (نص مخفي → FCP ينتظر React render)، لكن الأرقام المطلقة للـ~4.1s تحتاج التقاط trace في CI. أرقام الـsandbox (~2224ms للنص المخفي) أقل من CI (~4092ms) لأن معالج الـsandbox أسرع وCPU ×4 نسبي لسرعة المعالج المضيف.
- **الإصلاح المُقترَح (نص مرئي) لم يُختبر في CI بعد.** يُحتمل أن يُحضِر FCP ضمن حد 1.8s، لكن هذا يحتاج تنفيذًا وقياسًا في CI.

---

## 7. هل المشكلة قابلة للعلاج ضمن الكود الحالي أم أن الاختناق من بيئة القياس؟

**قابلة للتجربة ضمن الكود.** في الـsandbox، الاختناق ليس من بيئة القياس — الشبكة وCPU يعملان كما هو متوقع. المشكلة أن نص الـskeleton مخفي بصريًا بطريقة تجعل Chrome لا يحتسبه كـ«contentful». لكن ما يصح في الـsandbox يحتاج تحققًا في CI قبل ادعاء الحل.

الإصلاح المُسبَق في PR #257 (إضافة `<p>` بـ`clip:rect(0 0 0 0)`) كان خاطئًا لأنه استخدم نفس نمط الإخفاء البصري الذي لا يحتسبه Chrome كـcontentful.

---

## 8. ملخص المقارنة

| | Slow 4G + CPU ×4 | Slow 4G + CPU ×1 | بدون throttle |
|---|---|---|---|
| HTML responseEnd | 630 ms | 628 ms | 4 ms |
| shell.js finish | 2104 ms | 2081 ms | 59 ms |
| firstPaint (مخفي) | 693 ms | 644 ms | 38 ms |
| أول نص (مخفي) | 2213 ms | 2114 ms | 101 ms |
| **FCP (مخفي)** | **2224 ms** | **2128 ms** | **104 ms** |
| **FCP (مرئي)** | **680 ms** | **648 ms** | **36 ms** |
| Long tasks >50ms | 1 (51ms) | 0 | 0 |
| **FCP difference** | **−1544 ms** | **−1480 ms** | **−68 ms** |

**في الـsandbox: الشبكة مهيمنة** (94% في حالة النص المخفي). **CPU ×4 يضيف ~5% فقط.** جعل نص الـskeleton مرئيًا يُقدّم FCP من 2224ms إلى 680ms في الـsandbox. **لم يُتحقق بعد في CI** (عند كتابة هذا القسم — التحقق اللاحق في §8).

---

## ملاحظات

- F1-09 يبقى `[~]` — لا يُغيَّر إلى `[x]`.
- `SLOW_4G_GATE_MODE` يبقى `"report-only"` — لا يُغيَّر.
- هذه وثيقة تشخيص فقط — لا تغييرات في الكود.
- أرقام الـsandbox أقل من CI لأن معالج الـsandbox أسرع، لكن النمط النسبي مطابق.
- ملفات الـtrace محفوظة في `scripts/diag-trace-{variant}-{scenario}.json`.
- سكربت التشخيص في `scripts/diagnose-f1-09-fcp-v3.cjs`.
- v1 و v2 أُلغيا بسبب أخطاء قياس (v1: telegram لم يُحجَب؛ v2: server cache أ servings النسخة القديمة).
- التحقق من محتوى HTML المُعدَّل: تم بالتحقق من الملف على القرص قبل التشغيل (الاستبدال صحيح، الـmarker موجود في الـHTML). التحقق من الـDOM بعد التشغيل لم يكن ممكنًا لأن React يستبدل محتوى `#root`.

---

## 8. التحقق السببي في CI (PR #260 — مضاف 2026-09-25)

المقروء من سجل CI الفعلي (مسار Slow 4G + CPU ×4، بوابة `DEC-19` بوضع `report-only`):

| التشغيل | FCP (ms) | LCP (ms) | surface-rendered (ms) |
|---|---|---|---|
| قبل — main `f7aba43` · run `35993110530` | 4092 / 4076 / 4088 (وسيط 4088) | 4088 (وسيط) | 4088 (وسيط) |
| بعد — PR #260 `19e7a28` · run `35994981204` · job `107617659014` | 660 / 668 / 656 (وسيط 660) | 4084 / 4084 / 4092 (وسيط 4084) | 4084 (وسيط) |

- **FCP ≤ 1800ms: مستوفى في CI.** الفرضية المرصودة في الـsandbox صمدت في CI: إخفاء نص الـskeleton كان سبب تأخر FCP في مسار القياس.
- **LCP ≤ 2500ms وsurface-rendered ≤ 2000ms: غير مستوفيين.** لم يتغيرا (~4.08s)، وهذا متوقع لأن التغيير لا يمس مسار السطح.
- **سلسلة الطلبات المرصودة في CI (تشغيل #1):** `/` 0→631 · `shell` 607→2046 · `vendor-react` 608→1830 · `/v1/session/telegram` 2060→2647 · `/v1/me` و`/v1/consents` 2652→3230 · `rider-home` 3231→4014. أي أن السطح ينتظر سلسلة تسلسلية: حزمة shell ثم الجلسة ثم me/consents ثم تنزيل chunk سطح الراكب. هذا هو هدف العمل التالي لـF1-09.
- الحالة: `F1-09` يبقى `[~]` · `SLOW_4G_GATE_MODE` يبقى `"report-only"`.

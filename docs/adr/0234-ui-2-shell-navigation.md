# ADR 0234: UI-2 / PR 2 — الهيكلُ والتنقّل (ScreenFrame + التبويبُ الجذريُّ + BackButton + ScreenTransition)

**الحالة:** مقبول
**التاريخ:** 2026-10-06
**المرحلة:** WASLA UI/UX REFOUNDATION — UI-2 (Shell & Navigation) · PR 2
**المرجع:** `docs/UI_UX_CANONICAL_DIRECTIVE.md` §0 و§6 و§9 و§11 (صفُّ PR 2) · ADR 0232 · ADR 0233
**Work Packet:** `docs/work-packets/ui-2-pr2-shell-navigation.json`

## السياق

§11 يجعلُ PR 2 «ScreenFrame + تبويب + BackButton + Transition» وشرطُ قبولِه «اختبارات هيكل + RTL
+ قياس». و§6 يحدّدُ التبويباتِ الجذريّةَ لكلِّ دورٍ، و«لا tab bar داخل التدفقات»، و`useScreenStack`
بـpush / pop / replace / reset و«تبديل التبويب يمسح stack». وUI-1 أُغلِقت (ADR 0233 «إغلاقُ UI-1»)
فمكوّناتُ `ui-*` قائمةٌ ويُبنى عليها.

## القرارات

### 1. الموضعُ والنطاق

`apps/miniapp/src/shell/` (حزمةُ `shell` — «الإطار» في القسم 9.4): `screen-stack.ts` و`root-tabs.ts`
و`ScreenFrame.tsx`. **لا مستهلكَ في هذا الـPR**: وصلُ الهيكلِ بسطحَي الراكبِ والسائقِ يقعُ في PRs
لاحقةٍ (UI-3/UI-4)، فلا شاشةَ راكبٍ أو سائقٍ تتغيّر، ولا خادمَ ولا عقدَ (`*contract.ts`/`*api.ts`/
`*view.ts`) ولا طبقةَ تيليجرام (`tg/`) تُمَسّ. `Layout.tsx` و`Shell.tsx` باقيانِ كما هما.

### 2. لا نظامَ موازٍ

الإطارُ كتلةُ `app-frame` القائمةُ (`F1-07`) بعناصرَ جديدةٍ (`app-frame__tabs`، `app-frame__tab`،
`app-frame__screen` ومُعدِّلاتُها) — **لا بادئةَ جديدةٌ في `DECLARED_BLOCKS`**. والرأسُ `UiHeader`
وشريطُ الأفعالِ `UiActionBar` من `ui-*` كما هما.

### 3. `useScreenStack` — قرارٌ نقيٌّ وخطّافٌ رقيق

`screenStackReducer` بلا React: `push` (حركةُ `forward`) · `pop` (`back`) · `replace` (`none`، الأعلى
وحدَه) · `reset` (`back`، إلى الجذر) · `selectTab` (`none`، يمسحُ المكدّسَ؛ وإعادةُ اختيارِ النشطِ داخلَ
تدفّقٍ تعودُ إلى جذرِه). **لا فعلَ بلا أثر**: `pop`/`replace`/`reset` على الجذرِ وإعادةُ اختيارِ النشطِ
على جذرِه تُعيدُ المرجعَ نفسَه. والمفاتيحُ من عدّادٍ رتيبٍ لا من وقتٍ ولا عشوائيّة.

### 4. التبويبُ الجذريُّ (§6)

`ROOT_TABS` جدولٌ مغلقٌ حرفَ §6: الراكب `home · rides · support · account`، والسائق
`offers · job · earnings · account`. **الوسومُ من المستدعي** (القاموس) ولا نصَّ مُضمَّن؛ وسمٌ غائبٌ أو
فارغٌ = لا شريطَ (لا تبويبَ بنصٍّ مخترَع). `RootTabBar` معلمُ `<nav>` لا `tablist` — كلُّ تبويبٍ ينقلُ
إلى شاشةِ جذرٍ ولا يُبدِّلُ لوحةً — والنشطُ `aria-current="page"`. والتبويبُ داخلَ الصفحةِ يبقى `ui-tab`
(WAI-ARIA Tabs، UI-1). و«tab بعنصرٍ بلا شاشة» (§9) مسؤوليّةُ المستهلكِ عندَ الوصل؛ هذا الـPR لا يصلُه.

### 5. `ScreenFrame` — الجذرُ والتدفّقُ بالأنواع

`mode: "root"` يحملُ `tabs` ولا `back` ولا `action`؛ و`mode: "flow"` يحملُ `back` و`action` اختياريّاً
**ولا `tabs`** — والمخالفةُ خطأُ أنواعٍ (`@ts-expect-error` في الاختبار). شريطُ أفعالٍ بلا أفعالٍ لا يُرسَم.

### 6. BackButton — رجوعٌ واحدٌ لا اثنان

زرُّ تيليجرامَ الأصليُّ عبرَ `tg/index.ts` وحدَه (`hasCapability("backButton")` ·
`setBackButtonVisible` · `onBackButtonClick`) حيثُ يدعمُه المضيف؛ وإلّا زرُّ الرأسِ في `UiHeader` بوسمِه
من المستدعي. لا يُرسَمانِ معاً. الربطُ `bindNativeBack` نقيٌّ: إظهارٌ ثمّ اشتراكٌ، والفكُّ إلغاءٌ ثمّ إخفاء،
والفعلُ الأحدثُ يُقرأُ من مرجعٍ فلا يُعادُ الربطُ عندَ كلِّ رسم. المنفذُ يُحقَنُ في الاختبار.

### 7. ScreenTransition — CSS بلا مكتبةٍ ولا مؤقّت

الحاوي يُعادُ تركيبُه بمفتاحِ الشاشةِ فتجري حركةُ دخولٍ واحدةٌ (200ms، إزاحةٌ + شفافيّة). التقدّمُ من
نهايةِ السطرِ والرجوعُ من بدايتِه، و`[dir="rtl"]` يقلبُ الاتجاه. `prefers-reduced-motion` يلغي الحركتَين.
وعندَ تقدّمٍ أو رجوعٍ يُنقَلُ التركيزُ إلى الحاوي (`tabindex=-1`) ليقرأَ قارئُ الشاشةِ ما حلَّ؛ وتبديلُ
التبويبِ يُبقي التركيزَ على زرِّه. لا `setInterval`/`setTimeout`، ولا Framer Motion (§0.6).

## القياس

- الحملُ الأوّلُ بعدَ الضغط: **90.9 KB → 91.0 KB** (الحدُّ 180) — الفرقُ أنماطٌ مُدمَجةٌ (12.8 → 13.0 KB).
  حزمةُ `shell` 21.1 KB قبلَ وبعد: لا مستهلكَ فلا شيفرةَ تُشحَن بعد.
- `check-css-class-coverage` · `check-ui-contrast` · `check-ui-surface-inventory` (81 سطحاً) ·
  `check-telegram-wrapper-isolation` · `check-system-screens-policy` · `measure-first-paint` = نجاح.

## ما لا يُدَّعى

- لا قياسَ على جهازٍ حقيقيٍّ ولا في عميلِ تيليجرامَ حيٍّ: الحركةُ والتركيزُ مكتوبانِ ومختبَرانِ في
  الشيفرةِ والـCSS، لا مُشاهَدان. والاختباراتُ تُصيِّرُ إلى HTML ساكنٍ (`renderToStaticMarkup`)، فأثرُ
  `useEffect` يُختبَرُ عبرَ دالّتِه النقيّة (`bindNativeBack`) لا عبرَ DOM.
- **فجوةٌ مُسجَّلةٌ في حاجزِ تغطيةِ الأصنافِ (لا تُعالَجُ هنا):** `extractEmittedClasses` لا يرى
  `className={x.modifier}` بلا قالبٍ، فلا يُسجِّلُه صنفاً ولا تعبيراً مُبهَماً. استُعمِلَ القالبُ
  `` `app-frame__tab ${state.modifier}` `` ليقرأه الحاجز.

## العواقب

UI-3/UI-4 تصلُ سطحَي الراكبِ والسائقِ بـ`ScreenFrame` و`useScreenStack` و`RootTabBar` بوسومٍ من
القاموس، ولا تبني إطاراً ثانياً.

## إغلاقُ UI-2 (2026-10-06 · Work Packet `ui-2-closure`)

UI-2 (Shell & Navigation) = **مكتملة / Closed**. قراراتُ هذا الـADR نافذةٌ كما هي ولا تُعدَّل بالإغلاق؛ والحالةُ تبقى «مقبول».

- **PR 2:** PR #413 — HEAD قبلَ الدمج `e14426af877d12aebe3fa81c61ff3b68cef947e8`، فحوصُه 15/15 success. دُمجَ في `main` بتاريخ 2026-10-06T02:43:41Z (squash بمطابقةِ HEAD) — commit الدمج `0b8b0ea72d1652fa3547464873526e004c4d9dc0`.
- **CI على `0b8b0ea7`:** `CI` (push) run `37405542119` = success — 7/7 وظائف (verify · تكاملُ PostgreSQL · تكاملُ Redis · متصفّحٌ حقيقيٌّ أوّلُ رسمٍ · Slow 4G/3G · F5-06 · F9-03). `Roadmap freshness` run `37405542140` = success.
- **ما لا يُدَّعى:** لا مستهلكَ للهيكلِ في أيِّ سطحٍ بعد — الإغلاقُ إغلاقُ بناءِ الهيكلِ لا وصلِه بشاشاتِ الراكبِ والسائق (ذلك من UI-3/UI-4). لا قياسَ على جهازٍ أو عميلِ تيليجرامَ حيّ. وفجوةُ `check-css-class-coverage` (`className={x.modifier}` بلا قالب) مُسجَّلةٌ في ADR 0234 وليست مانعاً. والمخاطرُ المسجّلةُ سابقاً (Dependabot/manifest، `main` غير محمي، Redis «degraded») باقية.

ما بعدَ الإغلاقِ يبدأُ في UI-3 (PR 3 — راكب أ) ويصلُ السطوحَ بـ`ScreenFrame` و`useScreenStack` و`RootTabBar` ولا يبني إطاراً ثانياً.

# دليلُ البندِ `F3-06` — لوحُ اشتراكِ السائقِ (`SD-07`)

الغرض: تسجيلُ ما بُنِيَ في البندِ `F3-06`، وما قِيسَ منه آلةً، وما لم يُقَسْ
بعدُ — بلا ادّعاءِ إنتاجٍ لِما لم يُشغَّل على قاعدةٍ حقيقيّةٍ (`ح-٥`).
الحالة: منفَّذٌ فعليّاً · 2026-09-15.
ينتمي إلى: docs/evidence/architecture
يُستخدم من: `docs/ROADMAP-MASTER.md` §25 · `docs/SYSTEM_STATE.md`.
القرارُ الحاكمُ: `ADR 0027` (الاشتراكُ بلا أجرةٍ) · `ADR 0094` (استقلالٌ).

## ١) ما بُنِيَ

| الطبقةُ | المِلفُّ | ما فيه |
|---|---|---|
| قاعدةٌ | `supabase/migrations/20260915160000_f3_06_driver_subscription_dashboard.sql` | `driver_subscription_dashboard(bigint)` · `driver_subscription_history(bigint, int)` · إعدادُ `subscription_expiry_warning_days` لكلِّ مدينةٍ |
| نطاقٌ | `packages/domain/driver/driver-subscription.ts` | أنواعُ اللوحِ والتاريخِ والتجديدِ · `PAYMENT_STATUS_VALUES` · `isPaymentStatus` |
| تطبيقٌ | `packages/application/driver/driver-subscription.ts` | `readDriverSubscriptionDashboard` · `readDriverSubscriptionHistory` · `renewDriverSubscription` · `DriverSubscriptionDeps` · `DriverSubscriptionRenewalDeps` · ٩ رموزِ عطبٍ منشورةٍ |
| منافذُ | `packages/application/driver/subscription-ports.ts` | `DriverSubscriptionStore` (قراءةٌ محضةٌ) |
| بنيةٌ | `packages/infrastructure/driver/driver-subscription-store.ts` | `PostgresDriverSubscriptionStore` — نداءُ الدالّتَين |
| بابٌ | `apps/gateway/src/routes/driver-subscription.ts` | `GET /v1/driver/subscription` · `GET /v1/driver/subscription/history` · `POST /v1/driver/subscription/renew` |
| واجهةٌ | `apps/miniapp/src/surfaces/driver/subscription/*` | الشاشةُ · العقدُ · النموذجُ · واجهةُ التطبيقِ — معَ تجديدٍ واختيارِ خطّةٍ وعرضِ نتيجةٍ |
| ترجمةٌ | `packages/shared/i18n/miniapp/{ar,en,ur}.json` | ٥٧ مفتاحاً في كلِّ قاموسٍ (٧٩٢ ← ٩٠٥) — ١٣ منها للتجديدِ |
| أنماطٌ | `apps/miniapp/src/styles/global.css` | ٤٤ قاعدةَ `dsub__*` + `dof__subscription` · بادئةُ `dsub` مُسجَّلةٌ في `DECLARED_BLOCKS` |
| ربطٌ | `apps/gateway/src/index.ts` · `apps/gateway/src/server.ts` | تجميعُ `DriverDirectory` و`PaymentRepository` و`PaymentProvider` و`priceReader` · تسجيلُ المسارات |

### التجديدُ — «ابدأِ الدفعَ» لا «أكملِه»

التجديدُ يُعيدُ استخدامَ `subscribePlan` القائم (`packages/application/financial/subscribe-plan.ts`)
الذي يقرأُ السعرَ من `platform_settings` عبرَ `priceReader`، ويُنشئُ معاملةَ دفعٍ
بمفتاحِ إيديمبوتنسيّةٍ `driver_subscription:${driverId}:${plan}:${day}`، ويستدعي
مزوّدَ الدفعِ. وعندَ غيابِ المزوّدِ (`paymentProvider === null`) يُرجِعُ
التطبيقُ `PAYMENT_PROVIDER_NOT_AVAILABLE` ⇒ `503` — **فشلٌ مغلقٌ** لا نجاحٌ كاذبٌ.

## ٢) الحواجزُ الساكنةُ المُضافةُ

`scripts/lib/driver-subscription-contract.ts` + `scripts/check-driver-subscription-contract.ts`
— خمسُ قواعدَ مقيسةٍ، مُدرَجةٌ في `bun run ci`:

1. **لا سعرًا صلبًا** — `٢٥٠`/`٤٠٠`/`٣٠` ممنوعةٌ في ملفّاتِ الشاشةِ والمسارِ والتطبيقِ.
2. **التجديدُ حاضرٌ** — زرُّ التجديدِ و`POST /renew` موجودانِ في الشاشةِ والمسارِ.
3. **الفشلُ المغلقُ** — `PAYMENT_PROVIDER_NOT_AVAILABLE` في التطبيقِ و`503` في المسارِ عندَ غيابِ `renewal`.
4. **تاريخُ الدفعِ معروضٌ** — الشاشةُ أو النموذجُ يذكرانِ `history`.
5. **كلُّ رمزِ عطبٍ له نصٌّ** — ٩ رموزٍ في القواميسِ الثلاثةِ ببادئةِ `driver.subscription.`.

ولكلِّ قاعدةٍ سالبةٌ مزروعةٌ في `tests/unit/check-driver-subscription-contract.test.ts`
(١٤ حالةً · `ح-٧`).

## ٣) القياسُ

| المقياسُ | قبلَ البندِ | بعدَه |
|---|---|---|
| `bun test` | ٤٥٠٧ ناجحةً | ٤٥٠٨ ناجحةً (١٣ حالةَ تكاملٍ مُتخطّاةٌ بلا `TEST_DATABASE_URL`) |
| `bun x tsc --noEmit` | ٠ | ٠ |
| `bun x tsc -p apps/miniapp/tsconfig.json --noEmit` | ٠ | ٠ |
| `bun run build:miniapp` | ٠ | ٠ |
| `bun run lint` | ٠ (٢٥ تحذيرًا قائمًا) | ٠ (٢٥ تحذيرًا قائمًا) |
| `bun run ci` | ٠ | ٠ |
| الحواجزُ الساكنةُ | ٧٠+ | ٧١ (حاجزُ `driver-subscription` الجديدُ) |
| `check:css-class-coverage` | ٢٠/٢٠ | ٢٠/٢٠ (بادئةُ `dsub` مُسجَّلةٌ) |
| القواميسُ | ٧٩٢ مفتاحًا | ٩٠٥ مفتاحًا في كلِّ قاموسٍ |

## ٤) ما لم يُقَسْ (`ح-٥`)

- **التكاملُ على PostgreSQL حقيقيّةٍ لم يُشغَّلْ محلّيًّا** — لا محرِّكَ حاوياتٍ ولا
  `postgis` في الصندوقِ. حالاتُ التكاملِ الـ١٣ مكتوبةٌ وتُتخطّى بلا `TEST_DATABASE_URL`.
- **الهجرةُ لم تُطبَّقْ على قاعدةٍ حقيقيّةٍ** في هذه الجلسةِ — صحّةُ الدالّتَين
  بالقراءةِ لا بالتشغيلِ.
- **التجديدُ لم يُختَبرْ بمزوّدِ دفعٍ حقيقيٍّ** — المزوّدُ اليدويُّ (`manual`) يُرجِعُ
  `pending` بلا `checkoutUrl`، وهوَ مناسبٌ لـCI لا للإنتاجِ.
- **لا راكبٌ حقيقيٌّ رأى الشاشةَ** (`ADR 0099`).
- **لا `مَقيس` ولا `مُثبَت`** (`ح-٥`).

## ٥) ما لا يُدَّعى منصوصٌ بأسمائِه

- لا تفعيلَ اشتراكٍ ههنا — التفعيلُ `activate_subscription` القائمُ.
- لا إلغاءَ اشتراكٍ — لوحُ الاشتراكِ يَعرضُ الحالَ لا يُغيِّرُه.
- لا مزوّدَ دفعٍ يُحدَّدُ في القاعدةِ — التهيئةُ في البيئةِ لا القرارُ.
- لا هويّةَ راكبٍ في اللوحِ ولا في التاريخِ.

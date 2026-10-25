# LOAD01-AVAILABILITY-SINGLE-STATEMENT-20261025 — توفّرُ السائقِ بجملةٍ واحدة

> **ليس ادّعاءَ سعة.** LOAD-01M = **NOT_MET** وLOAD-01 = **FAIL**. الحدودُ المحميّةُ دونَ تغيير:
> `gatewayRequest: 5`، `IMMEDIATE_REDISPATCH_LIMIT = 50`، حدودُ تيليجرام (25/ث عامًّا، 1/ث للمحادثة)، والبوّاباتُ كما هي.

## الدافع (مقيس)

أثرُ `psig` لموجةِ B4 في التشغيلِ المقترن [40174864257](https://github.com/uxxxug/ceezr/actions/runs/40174864257)، مسارُ `POST /v1/driver/availability`:
14,254 بحثًا عن السائقِ بمعرّفِ تيليجرام (42.2 ث حجزًا) و14,254 استدعاءً لـ`record_attendance` (38.6 ث) — **80.8 ث = 8.44%** من احتجازِ مجمّعِ `gatewayRequest` في الموجة (957.7 ث).
كلُّ طلبٍ رحلتانِ متتابعتانِ تأخذُ كلٌّ منهما مقعدًا؛ والحجزُ تحكمُه حلقةُ البوّابة (~3ms للرحلة) لا PG.

## التغيير

- `packages/application/bots/types.ts`: منفذٌ اختياريٌّ `setAvailabilityByTelegramId` في `DriverDirectory` يُعيدُ `"set" | "not_a_driver"`.
- `packages/infrastructure/identity/directories.ts`: جملةٌ واحدة — CTE `d` (السائقُ بـ`telegram_id`) + `exists` + استدعاءُ `record_attendance(d.id, $2, 'driver_bot')` في استعلامٍ فرعيٍّ لا يجري إلّا إن وُجدَ السائق.
- `packages/application/driver/driver-offers.ts`: `setDriverAvailability` يستعملُ المنفذَ إن وُجد بالأحكامِ نفسِها (تعذّرٌ ⇒ `AVAILABILITY_NOT_AVAILABLE`، لا سائق ⇒ `NOT_A_DRIVER`)، وإلّا المسارُ القديمُ ذو الخطوتين.

## الاختبارات

- `tests/unit/driver-availability-single-statement.test.ts` (6): التوجيهُ والأحكام. **تحكّمٌ سلبيّ:** تعطيلُ المسارِ الواحدِ ⇒ 3 pass و3 fail.
- `tests/integration/driver-availability-single-statement.test.ts` (3، PostgreSQL حقيقيّ): سائقٌ ⇒ `set` والحضورُ مسجَّلٌ و**رحلةٌ واحدة** (عدّادُ `debug` في postgres.js)؛ إيقافُ التوفّر؛ غيرُ سائقٍ ⇒ `not_a_driver` بلا أثر.
  **تحكّمٌ سلبيّ:** تجاهلُ فحصِ الوجودِ ⇒ 2 pass و1 fail.
- محلّيًّا: 7,157 وحدة pass و0 fail، 1,666 تكاملًا pass و0 fail، typecheck وbiome pass.

## ما لا يُثبَت

أثرُ G1 غيرُ مقاس؛ يحتاجُ موجةً مقترنةً A/B. ولا يمسُّ هذا جدارَ P7/G4 (دلوُ بوتِ الراكبِ 25/ث، قرارُ مالك).

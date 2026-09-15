# دليلُ البندِ `F3-07` — مركبتي + الشعارُ والباركود (`SD-11`)

الغرض: تسجيلُ ما بُنِيَ في البندِ `F3-07`، وما قِيسَ منه آلةً، وما لم يُقَسْ
بعدُ — بلا ادّعاءِ إنتاجٍ لِما لم يُشغَّل على قاعدةٍ حقيقيّةٍ (`ح-٥`).
الحالة: منفَّذٌ فعليّاً · 2026-09-15.
ينتمي إلى: docs/evidence/architecture
يُستخدم من: `docs/ROADMAP-MASTER.md` §25 · `docs/SYSTEM_STATE.md`.
القرارُ الحاكمُ: `ADR 0028` (التطبيقُ المصغَّرُ هو المنتجُ) · `ADR 0094` (استقلالٌ).

## ١) ما بُنِيَ

| الطبقةُ | المِلفُّ | ما فيه |
|---|---|---|
| قاعدةٌ | `supabase/migrations/20260915170000_f3_07_driver_vehicle.sql` | `driver_vehicle(bigint)` · `update_driver_vehicle(bigint, text, text, int)` · `update_driver_vehicle_assets(bigint, text, text)` · ثلاثةُ أعمدةٍ جديدةٌ على `drivers` (`vehicle_year`، `logo_file_id`، `barcode_file_id`) · إعدادُ `vehicle_logo_size_kb` و`vehicle_barcode_size_kb` لكلِّ مدينةٍ |
| نطاقٌ | `packages/domain/driver/driver-vehicle.ts` | `DriverVehicle` · `VehicleUpdateInput` · `VehicleDocument` · `VEHICLE_YEAR_MIN`/`MAX` · `validateVehicleYear` · `VEHICLE_TYPES` |
| تطبيقٌ | `packages/application/driver/driver-vehicle.ts` | `readDriverVehicle` · `updateDriverVehicle` · `updateDriverVehicleAssets` · `DriverVehicleDeps` · ٧ رموزِ عطبٍ منشورةٍ |
| منافذُ | `packages/application/driver/driver-vehicle-ports.ts` | `DriverVehicleStore` (قراءةٌ وتحديثٌ) |
| بنيةٌ | `packages/infrastructure/driver/driver-vehicle-store.ts` | `PostgresDriverVehicleStore` — نداءُ الدوالِّ الثلاثِ · `asTelegramId` · تحويلُ الصفوفِ |
| بابٌ | `apps/gateway/src/routes/driver-vehicle.ts` | `GET /v1/driver/vehicle` · `PATCH /v1/driver/vehicle` · `POST /v1/driver/vehicle/assets` · ٥٠٣ فشلًا مُغلقًا |
| واجهةٌ | `apps/miniapp/src/surfaces/driver/vehicle/*` | `VehicleScreen.tsx` · `vehicle-api.ts` · `vehicle-contract.ts` · `vehicle-view.ts` |
| ترجمةٌ | `packages/shared/i18n/miniapp/{ar,en,ur}.json` | ٤٩ مفتاحاً في كلِّ قاموسٍ (٩٠٥ ← ٩٥٤) |
| أنماطٌ | `apps/miniapp/src/styles/global.css` | قواعدُ `dveh__*` كاملةٌ · بادئةُ `dveh` مُسجَّلةٌ في `DECLARED_BLOCKS` |
| ربطٌ | `apps/gateway/src/index.ts` · `apps/gateway/src/server.ts` | تجميعُ `PostgresDriverVehicleStore` و`MiniAppSessionReader` · تسجيلُ المسارات |

### إعادةُ استخدامِ البنية القائمة

- أعمدةُ `vehicle_type` و`plate_number` موجودةٌ مسبقًا في `drivers` من الهجرةِ الأوليّةِ
- `vehicle_photo_file_id` موجودٌ من `F3-01` (KYC) — لا حاجةَ لتكرارِه
- `driver_documents` من `F3-01` يخدمُ وثائقَ `vehicle_registration` و`insurance` و`periodic_inspection`
- بنيةُ الرفعِ الموقَّعِ (`SignedUploadConfig`) تُستخدمُ للشعارِ والباركود
- `MiniAppSessionReader` من `packages/application/identity/ports.ts` يُعادُ استخدامُه للجلسةِ
- نمطُ `openSession` يُحاكي ما في `driver-subscription.ts` من `F3-06`

## ٢) ما قِيسَ منه آلةً

| الفحصُ | المِلفُّ | النتيجةُ |
|---|---|---|
| عقدُ مركبةِ السائقِ | `scripts/check-driver-vehicle-contract.ts` · `tests/unit/check-driver-vehicle-contract.test.ts` | ٥ قواعدَ · ١٠ اختباراتِ زرعِ انحرافٍ — كلُّها خضراءُ |
| النوعُ | `bun x tsc --noEmit` · `bun x tsc -p apps/miniapp/tsconfig.json --noEmit` | صفرُ أخطاء |
| البناءُ | `bun run build:miniapp` | نجحَ في ٢.٠٦ ثانية |
| اختباراتُ التكاملِ | `tests/integration/driver-vehicle.test.ts` | ١٣ اختبارًا — تتجاوزُ محليّاً بلا `TEST_DATABASE_URL`، تُشغَّلُ على CI |
| سجلُّ التجاوزِ | `scripts/lib/skip-registry.ts` | `driver-vehicle.test.ts` مُسجَّلٌ: `criticalPath: "توثيقُ السائق"` · ١٣ متجاوزًا |
| حرسُ الأصنافِ | `scripts/lib/css-class-coverage.ts` · `tests/unit/check-css-class-coverage.test.ts` | `dveh` مُسجَّلٌ · صفرُ خرقٍ |

## ٣) ما لم يُقَسْ بَعد

- اختباراتُ التكاملِ لا تُشغَّلُ محليّاً (بلا `TEST_DATABASE_URL`) — تُشغَّلُ على CI
- الرّفعُ الفعليُّ للشعارِ والباركودِ عبرَ بوتِّ تلغرامَ لم يُختبَرْ يدويّاً
- عرضُ الباركودِ كصورةٍ قابلةٍ للقراءةِ بالكاميرا لم يُختبَرْ على جهازٍ حقيقيٍّ

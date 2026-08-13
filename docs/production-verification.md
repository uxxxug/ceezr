# خطوات التحقق من الإنتاج الحيّ — البند 9

> هذا المستند يُوثّق الخطوات التي يتّبعها المالك للتحقّق من أنّ كل الأقسام (0-9)
> تعمل في الإنتاج بعد نشر الكود وتشغيل التهجرات. كل خطوة قابلة للتنفيذ بلا خبرة تقنية عميقة.

## المتطلبات المسبقة

1. الكود منشور على Render (autoDeploy مفعّل).
2. قاعدة بيانات Supabase تعمل (`gczgllrulsqubkyehzep`).
3. بوت تلغرام (السائق والعميل) يعملان.
4. صلاحيات المالك على Render وSupabase.

## 1. تشغيل التهجرات

تشغيل التهجرات الأربعة الجديدة بالترتيب على Supabase SQL Editor:

```sql
-- 1) تفعيل المدن المتبقية (البند 0 + تفعيل المدن)
-- 20260811130000_seed_remaining_cities.sql

-- 2) جدول النسخ الاحتياطي (البند 7)
-- 20260811140000_db_backups_table.sql

-- 3) جداول الدفع (البند 8)
-- 20260811150000_payment_core.sql

-- 4) (إن وُجدت تهجرات أحدث)
```

**التحقّق:**
```sql
-- المدن المتبقية مُ Severity =
select slug, name_ar, is_active from cities order by slug;
-- يجب أن يظهر: jed (active), med (active), mkk (inactive), ruh (inactive), tif (inactive)

-- جدول النسخ الاحتياطي
select count(*) from db_backups;
-- يجب أن يُعيد 0 (لا نسخ بعد)

-- جداول الدفع
select count(*) from payment_transactions;
select count(*) from ledger_entries;
select count(*) from webhook_events;
-- كلها يجب أن تُعيد 0
```

## 2. تفعيل المدن المتبقية

لكل مدينة (MKK، RUH، TIF):

1. أنشئ مجموعة تلغرام خاصة بالمدينة.
2. احصل على Group ID (`-100...`).
3. في لوحة الإدارة (الإعدادات)، أدخل Group ID للمدينة.
4. بدّل `is_active` إلى `true`.

```sql
-- بعد إدخال Group IDs:
update cities set is_active = true where slug in ('mkk', 'ruh', 'tif');
-- ثم أدخل Group IDs عبر لوحة الإدارة لا هنا
```

**التحقّق:**
- البوت يستقبل الطلبات في المدينة المفعّلة.
- السائقون يرون العروض في مجموعة المدينة.

## 3. النسخ الاحتياطي اليومي إلى Google Drive (البند 7)

### الإعداد

1. أنشئ Service Account على Google Cloud Console.
2. أنشئ مجلداً في Google Drive وشاركه مع Service Account.
3. في Render → Environment Variables، أضف:
   - `GOOGLE_SERVICE_ACCOUNT_JSON` = محتوى JSON الكامل للـ Service Account
   - `GOOGLE_DRIVE_BACKUP_FOLDER_ID` = معرّف المجلد
   - `BACKUP_RETENTION_COUNT` = `14` (أو عدد أي حسب الرغبة)

### التحقق

1. انتظر حتى موعد المهمّة الدورية (كل 24 ساعة) أو شغّلها يدوياً:
   ```sql
   select * from v_latest_backup;
   ```
2. أو تحقّق من Google Drive: يجب أن يظهر ملف `backup-YYYY-MM-DD.sql.gz`.
3. تحقّق من سجلّ Render أنّ المهمّة نفّذت بنجاح (`backup uploaded`).

## 4. طبقة الدفع — اشتراك السائق (البند 8)

### الحالة الحالية

- مزوّد Moyasar مدمج فعلاً: فاتورةٌ حقيقية ورابط دفعٍ مُستضاف.
- اشتراك السائق الشهري هو التدفّق الوحيد المفعّل.
- باقي الأغراض (دفع العملاء/التجار) هياكل فقط.

### الإعداد

1. في Render → Environment Variables، أضف:
   - `PAYMENT_PROVIDER` = `moyasar`
   - `MOYASAR_SECRET_KEY` = مفتاح Moyasar السرّي (`sk_…`)
   - `MOYASAR_WEBHOOK_SECRET` = السرّ الذي تضبطه في لوحة Moyasar للويبهوك
   - `MOYASAR_CALLBACK_URL` = صفحة النتيجة بعد الدفع
   - `PAYMENT_ENVIRONMENT` = `sandbox` أو `production`
   - `ENABLE_DRIVER_SUBSCRIPTION` = `true`

   واحذف `PAYMENT_API_KEY` و`PAYMENT_SECRET` و`PAYMENT_WEBHOOK_SECRET` — مهجورة
   ولم تبقَ مقروءة.

2. اضبط رابط الويبهوك عند المزوّد:
   ```
   https://waslah-gateway.onrender.com/webhook/payment
   ```

### التحقق

1. لوحة الإدارة → صفحة المدفوعات:
   - تعرض حالة المزوّد والبيئة.
   - تعرض المعاملات الأخيرة (إن وُجدت).

2. عند دفع سائق اشتراكه:
   ```sql
   select * from payment_transactions order by created_at desc limit 5;
   select * from ledger_entries order by created_at desc limit 5;
   select * from webhook_events order by created_at desc limit 5;
   ```

3. Idempotency: أعد إرسال نفس الويبهوك مرّتين — لا يجب أن يُنشئ اشتراكين.

## 5. المسار الحيّ الكامل (البند 9)

### اختبار يدوي شامل

1. **تسجيل سائق**: أرسل `/start` لبوت السائق → اكتمل التسجيل → التحقّق من المشرف.
2. **الاشتراك التجريبي**: السائق في فترة تجريبية (30 يوماً).
3. **التوافر**: السائق يفعّل توافره → يصبح قابلاً لاستقبال العروض.
4. **طلب عميل**: عميل يرسل `/start` لبوت العميل → يختار خدمة → يطلب طلباً.
5. **عرض للسائق**: الطلب يصل السائق في مجموعة المدينة.
6. **قبول**: السائق يقبل الطلب → الطلب matched.
7. **إكمال**: السائق يكمل الطلب → العميل يقيّم.
8. **الدفع** (عند تفعيل المزوّد): السائق يدفع اشتراكه → ويبهوك → اشتراك فعّال.
9. **النسخ الاحتياطي**: نسخة احتياطية يومية تُرفع إلى Google Drive.

### الاختبار الآلي

```bash
# اختبارات الوحدة (813+ اختبار)
bun test

# اختبار التكامل الشامل (المسار الحيّ الكامل)
bun test tests/integration/full-live-path.test.ts

# فحص الأنواع
bun run typecheck
```

## 6. قائمة فحص الإنتاج

- [ ] التهجرات الأربعة تشغّلت بنجاح على Supabase
- [ ] المدن الخمس تظهر في `select slug, name_ar, is_active from cities`
- [ ] متغيّرات Google Drive مُعدّة على Render
- [ ] نسخة احتياطية واحدة على الأقل ظهرت في Google Drive
- [ ] جدول `db_backups` يسجّل النسخ
- [ ] متغيّرات الدفع مُعدّة على Render (أو غائبة بأمان)
- [ ] صفحة المدفوعات تظهر في لوحة الإدارة
- [ ] `payment_transactions` و`ledger_entries` و`webhook_events` موجودة وفارغة
- [ ] بوت السائق يستقبل ويستجيب
- [ ] بوت العميل يستقبل ويستجيب
- [ ] الطلبات تصل السائقين في المجموعة
- [ ] الاختبارات: `bun test` → 0 fail
- [ ] الأنواع: `bun run typecheck` → 0 errors

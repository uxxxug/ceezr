# دليل التشغيل (Runbook)

> **الحالة الحالية**: البوابة تعمل فعلاً على قاعدة PostgreSQL، والمسار الكامل (تسجيل ← طلب ← بثّ عرض
> ← قبول ذرّي) مُختبَر آلياً على قاعدة محلية. المتبقي للإنتاج: مفاتيح Supabase وUpstash ورمزا البوتين.

## التشغيل المحلي
```bash
bun install
bun run lint        # Biome
bun run typecheck   # tsc --noEmit
bun run test        # اختبارات الوحدة
```

## قاعدة PostgreSQL محلية للتطوير والاختبار
لا تحتاج أي مفتاح إنتاج. أي PostgreSQL 15+ مع PostGIS يكفي:

```bash
# 1) قاعدة فارغة
createdb waslah

# 2) الأدوار التي تفترضها الهجرات (تُنشئها Supabase تلقائياً، وننشئها نحن محلياً)
psql waslah -c "create role anon nologin noinherit;
                create role authenticated nologin noinherit;
                create role service_role nologin noinherit bypassrls;"

# 3) الهجرات بالترتيب
for f in supabase/migrations/*.sql; do psql waslah -v ON_ERROR_STOP=1 -f "$f"; done

# 4) اختبارات التكامل الحقيقية
TEST_DATABASE_URL="postgres://postgres@127.0.0.1:5432/waslah" bun run test:integration
```

بلا `TEST_DATABASE_URL` تُتخطّى اختبارات التكامل مع تحذير ظاهر، و CI يرفض التخطّي صراحةً.

> بيئة الاختبار المحلية ليست بديلاً عن Supabase: RLS مفعَّلة في المخطط، والاختبارات تعمل بدور
> superuser محلي يتجاوزها. التحقّق من سياسات RLS نفسها يبقى على مشروع Supabase الحقيقي.

## متغيرات البيئة
انسخ `.env.example` إلى `.env` واملأ القيم. أي متغير ناقص يفشل الإقلاع فوراً عبر `MissingEnvVarError`.

## النشر
- البداية: **Render** (فوترة شهرية ثابتة) — خدمتان: `gateway` و `workers`.
- لاحقاً عند الحاجة الفعلية: **Fly.io — منطقة Bahrain**.

## إجراءات متوقعة في الأمر الثاني
| الحالة | الإجراء |
|---|---|
| تغيير سعر اشتراك | تحديث صف في `platform_settings` — **لا نشر كود** |
| تغيير مهلة قبول العرض | تحديث `offer_timeout_seconds` في `platform_settings` |
| إضافة مدينة (بأمر لاحق) | صف في `cities` + ثلاثة معرّفات قروبات تيليجرام |
| طلب فشلت مطابقته نهائياً | يُنشر تلقائياً في قروب الإسناد للمدينة |
| بلاغ SOS | قروب الإسناد فوراً، بغض النظر عن سير المطابقة |

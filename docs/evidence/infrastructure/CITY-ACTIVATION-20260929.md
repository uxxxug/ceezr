# إثبات: تفعيل المدن الخمس في البيئة التجريبية — 2026-09-29

## المرجع

| | |
|---|---|
| البند | `F12-03` (الشق المستودعي) · منصة المدن الخمس |
| التاريخ | 2026-09-29 |
| البيئة | تجريبية (Supabase `jafuchojgxzeuvibkkfx` · Render `waslah-gateway` · `waslah-miniapp`) |
| الفرع | `docs/city-activation-evidence-20260929` |

## الحالة قبل التفعيل

جميع المدن الخمس كانت `is_active = false` بلا معرّفات قروبات تيليجرام:

| المدينة | الكود | is_active | group_ids |
|---|---|---|---|
| جدة | JED | false | null · null · null |
| مكة | MKK | false | null · null · null |
| الرياض | RUH | false | null · null · null |
| الطائف | TIF | false | null · null · null |
| المدينة المنورة | MED | false | null · null · null |

والمستخدم الإداري موجود مسبقاً (دوره `admin` · غير محجوب).

## الإجراء

استُدعيت الدالة الذرّية `admin_update_city_group_ids` لكل مدينة بخمسة استدعاءات منفصلة، بمعرّفات قروبات تجريبية (أرقام سالبة بعشرة أصفار — لا تطابق قروبات حقيقية):

```sql
select admin_update_city_group_ids(
  '5d0efe63-f303-4484-9517-6655a8e8118e',  -- admin user
  '<city_id>',
  <support_group_id>,
  <escalation_group_id>,
  <unsubscribed_drivers_group_id>
);
```

الدالة تحقّق من:
- الفاعل مسؤولٌ وغير محجوب
- المعرّفات ثلاثة مختلفة وغير صفرية
- المدينة موجودة

ثم تُحدِّث الأعمدة وتضبط `is_active = true` وتُدرج صفّاً في `audit_log`.

## الحالة بعد التفعيل

| المدينة | الكود | is_active | إعدادات |
|---|---|---|---|
| جدة | JED | true | 88 مفتاحاً |
| مكة | MKK | true | 88 مفتاحاً |
| الرياض | RUH | true | 88 مفتاحاً |
| الطائف | TIF | true | 88 مفتاحاً |
| المدينة المنورة | MED | true | 88 مفتاحاً |

## التحقّق من البوابة

- `GET /ready` على `https://waslah-gateway.onrender.com` → `{"status":"ready","missingEnv":[],"failedChecks":[],"degradedChecks":[]}`
- `GET /health` → `{"status":"ok"}`
- التطبيق المصغَّر منشور على `https://waslah-miniapp.onrender.com`

## القيود المعلنة

- معرّفات القروبات تجريبية ولا تطابق قروبات تيليجرام حقيقية — وظائف الإسناد للقروبات (دعم، تصعيد، سائقون غير مشتركين) لن تعمل في هذه البيئة
- هذا تفعيلٌ في بيئة تجريبية لا إنتاجية
- لا يُدَّعى `مَقيس` ولا `مُثبَت` (`ح-5`)
- لا يُقلَب بندٌ في الخارطة بهذا الدليل (`ح-4`) — هذا توثيقُ حالةٍ لا إغلاقُ بندٍ

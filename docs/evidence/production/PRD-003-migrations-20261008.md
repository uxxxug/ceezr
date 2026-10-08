# PRD-003 — هجرات UI-8 وUI-10 على قاعدة الإنتاج — دليلٌ مقيس (2026-10-08)

**البند:** PRD-003 · **الحالة:** Verified
**المصدر:** استعلاماتُ قراءةٍ فقط على قاعدة الإنتاج عبر موصِّل Supabase (2026-10-08 ~03:40–04:20 UTC). لم يُطبَّق شيءٌ في هذا التحقّق — الهجرتان كانتا مطبَّقتَين.
**ما لا يحتويه:** لا أسرار، لا بياناتِ مستخدمين (لا معرّفاتٍ ولا أسماء).

## 1. أيُّ قاعدةٍ هي الإنتاج

في الحساب مشروعان. مشروعُ `veer` (`jafuchojgxzeuvibkkfx`) يحوي مخطَّطَ WASLA (94 جدولًا عامًّا، `orders`، `cities` = 5)، ونبضةُ `redispatch-searching` في `job_heartbeats` حُدِّثَت قبل 0.4 ثانيةٍ من `now()` — أي أنَّ الـgateway الحيَّ يكتبُ فيها الآن. والمشروعُ الآخرُ بلا جدولِ `cities`.

## 2. لا سجلَّ هجراتٍ — فالتحقّقُ بالمخطّطِ نفسِه

القاعدةُ بلا سجلِّ هجراتٍ عن قصد (`scripts/migrate.ts`، ADR 0068). فـ«آخرُ هجرة» تُقاسُ بآثارِ الهجرتَين، وهما آخرُ ملفَّين في `supabase/migrations/`:

| الهجرة | الأثرُ المقيسُ في الإنتاج | يطابقُ الملف |
|---|---|---|
| `20261006200000_ui_8_eta_error_band` | جدولُ `eta_observations`: `order_id uuid`، `leg text`، `city_id uuid`، `predicted_seconds integer`، `predicted_at timestamptz` — كلُّها `NOT NULL` | نعم |
| | RLS مفعَّل؛ لا منحَ على الجدول لـ`anon`/`authenticated`/`PUBLIC` | نعم (`revoke all`) |
| | `record_eta_and_read_band`: `md5(prosrc)=6d2c00fe17eee135763703faee4d46be` (1616 حرفًا)، `security definer`، `search_path=public`، EXECUTE لـ`service_role` وحدَه | **مطابقٌ بايتًا** لجسمِ الدالّةِ في الملف |
| `20261007120000_ui_10_emergency_contact_read_found` | `read_emergency_contact`: `md5(prosrc)=9d0e194a6ba642d92641f6095e2c677c` (546 حرفًا)، `security definer`، `search_path=public`، EXECUTE لـ`service_role` وحدَه | **مطابقٌ بايتًا** |

(الـmd5 محسوبٌ على الطرفَين: `md5(prosrc)` في القاعدة، و`md5` لما بين `$$...$$` في الملف.)

## 3. شرطُ القبول — `read_emergency_contact` لمستخدمٍ بلا جهة

| الاستدعاء | الناتج |
|---|---|
| مستخدمٌ حقيقيٌّ بلا جهةِ طوارئ (أوّلُ صفٍّ فيه الحقلان `NULL`) | `{"ok":true,"status":"found","name":null,"phone":null}` |
| معرّفُ Telegram غيرُ موجود | `{"ok":false,"error":"USER_NOT_FOUND"}` |

أي أنَّ الصيغةَ المصحَّحةَ (`if not found`) هي الحيّة: مستخدمٌ موجودٌ بلا جهةٍ ⇐ `ok` بقيمٍ فارغة، لا `USER_NOT_FOUND`.

## 4. النتيجة

الهجرتان مطبَّقتان على قاعدة الإنتاج ومطابقتان للمستودع. وشرطُ القبولِ محقَّق.

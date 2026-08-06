# المخططات (Migrations)

**الحالة: هيكل فقط.** لا يُكتب أي `CREATE TABLE` فعلي في الأمر الأول.

قواعد إلزامية عند كتابة أول مخطط في الأمر الثاني:

1. **كل جدول بلا استثناء يحمل `city_id`** مرتبطاً بـ `cities(id)` — حتى الجداول التي تبدو محلية.
2. **RLS مفعّلة على كل جدول** منذ إنشائه.
3. **العمليات الحرجة عبر دوال `RPC` ذرّية** بصيغة `verb_noun`:
   `claim_ride`, `claim_delivery`, `renew_subscription`, `record_attendance`,
   `register_unsubscribed_claim`, `top_up_wallet`.
   كل واحدة تستخدم `SELECT … FOR UPDATE SKIP LOCKED` أو ما يعادلها — لا منطق تزامن في التطبيق.
4. **جدول `platform_settings`** يحوي كل قيمة قابلة للتغيير: `subscription_price_transport`,
   `subscription_price_delivery`, `subscription_price_both`, `trial_days`,
   `search_radius_km`, `offer_timeout_seconds`, `negotiation_timeout_seconds`,
   `match_weight_proximity`, `match_weight_rating`, `broadcast_batch_size`,
   `unsubscribed_claim_limit`, `supported_languages`.
   **ممنوع ترميز أي من هذه القيم داخل الكود.**
5. **جدول `cities`** بالحقول:
   `id, name_ar, name_en, is_active, telegram_support_group_id,
   telegram_escalation_group_id, telegram_unsubscribed_drivers_group_id`
   ويُبذَر بأربعة صفوف: جدة، مكة، الرياض، الطائف.

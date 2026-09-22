-- migration-phase: contract
-- =============================================================================
-- SEC-19 — بندُ الترتيبِ ٣: ربطُ `trip_tracking_tokens.created_by` بـ`users.id`
--   توسيعًا (الطورُ الأوّل: العمودُ والتعبئةُ والفهرسُ والربطُ)
--
--   **السياقُ:** `trip_tracking_tokens.created_by bigint not null` يخزِّنُ
--   معرّفَ تيليجرام لا `users.id`. فإذا زالَ ربطُ `users.telegram_id` (بعدَ
--   التجهيلِ أو بعدَ `drop not null`) صارَت رموزُ التتبُّعِ بلا مالكٍ — لا
--   يَستطيعُ صاحبُها إلغاءَها ولا يَستطيعُ التجهيلُ حذفَها. والحلُّ: ربطُ
--   المِلكيّةِ بـ`users.id` (uuid، ثابتٌ لا يُمحى).
--
--   **ما تُنفِّذُه هذه الهجرةُ (طورُ التوسيعِ):**
--   - إضافةُ `created_by_user_id uuid` (قابلٌ للغيابِ مؤقَّتًا)
--   - تعبئتُه من `users.id` عبرَ `users.telegram_id = created_by`
--   - ربطٌ خارجيٌّ `not valid` إلى `users(id)`
--   - فهرسٌ للقراءةِ بالمالكِ (للمسارِ الساخنِ والحذفِ)
--
--   **ما لا تُنفِّذُه:** لا تُسقِطُ `created_by bigint` ولا تُلزِمُ
--   `created_by_user_id not null` — ذاكَ طورُ التقليصِ (بندٌ لاحقٌ). ولا تُغيِّرُ
--   تواقيعَ الدوالّ — ذاكَ في هجرةٍ تالياً.
--
--   **التراجعُ:** `alter table trip_tracking_tokens drop column if exists
--   created_by_user_id` — لا أثرَ لتخريبيٍّ: العمودُ الجديدُ وحدهُ يُحذَفُ، ولا
--   يمسُّ البياناتِ القائمةَ ولا الدوالّ.
-- =============================================================================

-- ١) العمودُ الجديدُ: قابلٌ للغيابِ مؤقَّتًا (التعبئةُ تالياً)
alter table trip_tracking_tokens
  add column if not exists created_by_user_id uuid;

-- ٢) التعبئةُ: كلُّ صفٍّ يأخذُ `users.id` من `users.telegram_id`
--    قد لا يُوجَدُ مستخدمٌ يُطابِقُ (صفٌّ يتيمٌ من تجاربَ قديمةٍ) — يبقى
--    `null`، ولا يُفرَضُ عليه شيءٌ في طورِ التوسيعِ.
update trip_tracking_tokens t
   set created_by_user_id = (
     select u.id from users u where u.telegram_id = t.created_by limit 1
   )
 where t.created_by_user_id is null;

-- ٣) الربطُ الخارجيُّ `not valid`: لا يُمسحُ الجدولُ تحتَ قفلٍ حاجزٍ.
alter table trip_tracking_tokens
  add constraint trip_tracking_tokens_created_by_user_id_fkey
  foreign key (created_by_user_id) references users(id)
  not valid;

comment on column trip_tracking_tokens.created_by_user_id is
  'SEC-19 بندُ ٣: مِلكيّةُ الرمزِ بـ`users.id` الثابتِ لا بـ`telegram_id` الذي
   يَزولُ بالتجهيلِ. قُدِمَ التوسيعُ على `created_by bigint` التراثيِّ — ولا
   يُنزَعُ ذاكَ قبلَ طورِ التقليصِ. والصفوفُ التي لم تُعَيَّن (تتيمةٌ) تبقى
   `null` حتى يُفتَحَ طورُ تنظيفٍ منفصلٌ.';

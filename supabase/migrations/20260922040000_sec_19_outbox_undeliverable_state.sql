-- migration-phase: contract
-- =============================================================================
-- `SEC-19` · الساقُ «ب-٢» — حالةٌ صريحةٌ تفصلُ «لا قناةَ» عن «فشلَ بعدَ محاولاتٍ»
--
-- **المسألةُ مقيسةٌ لا مُستنتَجةٌ**: `notification_outbox.status` يعرفُ سبعَ
-- حالاتٍ (`pending` · `sending` · `delivered` · `dead` · `failed` · `canceled` ·
-- `in_app_only`) — وليسَ فيها «غيرُ قابلٍ للتسليمِ». فـ`dead` تعني **فشلاً بعدَ
-- جهدٍ** (استُنفِدَت المحاولاتُ)، ووضعُ «لا قناةَ أصلاً» فيها يخلِطُ ما أُمِرتُ
-- بفصلِه ويُلوِّثُ كلَّ مقياسٍ يعُدُّ `dead` بوصفِها عطباً تشغيليّاً. و`in_app_only`
-- قرارُ سياسةٍ من `notification_kind_policy` لا تعذُّرٌ — فإعادةُ استخدامِها تخلِطُ
-- الاختيارَ بالعجزِ. فتبقى الحاجةُ إلى حالةٍ **صريحةٍ** مستقلّةٍ.
--
-- **والعملُ أصغرُ مِمّا قُدِّرَ**: `dead_reason` و`died_at` قائمانِ بقيدٍ
-- يُلزِمُ بهما (`notification_dead_pair`)، وتوسيعُ قيدِ الحالةِ لهُ سابقتانِ في
-- المستودعِ (`20260908030000` و`20260909040000`). فالعملُ حالةٌ واحدةٌ تُضافُ
-- إلى قيدٍ قائمٍ، لا بناءُ آلةِ أسبابٍ.
--
-- **النمطُ المُتَّبَعُ لا المُخترَعُ**: `20260813070000_safety_delivery_skip_misconfigured.sql`
-- يُسمّي الإعدادَ الناقصَ بسببٍ مقروءٍ (`ESCALATION_GROUP_MISSING`) ولا يُعيدُ
-- محاولةً لا تنجحُ. فالأسبابُ هنا امتدادُ نمطٍ قائمٍ:
--
--   TELEGRAM_ID_MISSING           — المستخدمُ بلا هويّةِ قناةٍ
--   TELEGRAM_DELIVERY_UNAVAILABLE — لا عنوانَ صالحاً ولا بديلَ
--   TELEGRAM_DELIVERY_NOT_REQUIRED — غيرُ جوهريٍّ والبديلُ يكفي
--
-- ولا يُشمَلُ `TELEGRAM_DELIVERY_FAILED` — ذاكَ فشلٌ عارضٌ بعدَ محاولةٍ صالحةٍ،
-- وهو مسلكُ `dead` بـ`MAX_ATTEMPTS` القائمُ لا مسلكُ «لا قناةَ».
--
-- **ولا يُدَّعى أنَّ مسلكاً واحداً حُصِّنَ**: هذه الخطوةُ تُضيفُ الحالةَ وحدَها.
-- الحرسُ في `claim_notification_delivery` طورٌ تالٍ. والقيدُ هنا يُتيحُ الإعلانَ
-- لا يُنفِّذُه — فالصفُّ الـ`undeliverable` لا يلتقطُه `claim` (تلتقطُ `pending`
-- وحدَها) لكنَّ أحداً لا يضَعُهُ فيه بعدُ.
--
-- **ثلاثةُ ملفّاتٍ** لهذا الطورِ:
--   ١) هذا الملفُ (contract): يُسقِطُ القيدَ القديمَ ويُضيفُ الجديدَ بـ`not valid`
--   ٢) `20260922040100_sec_19_outbox_undeliverable_validate.sql` (validate): يُصادِقُ
--   ٣) `20260922040200_sec_19_outbox_undeliverable_index.sql` (index): يُنشئُ الفهرسَ
--
-- **الطورُ `contract`**: القيدُ القديمُ `notification_outbox_status_check` يُسقَطُ
-- ويُعادُ بصراحةٍ أوسعَ. ولا عمودَ يُحذَفُ ولا قيدَ يُضيَّقُ — بل العكسُ تماماً.
-- لكنَّ `drop` في هذا المستودعِ لا يقعُ إلّا في `contract`، فالطورُ صريحٌ والقاعدةُ
-- لا تُخالَف. والقيدُ الجديدُ يُضافُ بـ`not valid` فلا يمسحُ الجدولَ تحتَ قفلٍ
-- حاجزٍ، ويُصادَقُ في الملفِّ التالي.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ١) توسيعُ قيدِ الحالةِ — `undeliverable` تُضافُ إلى القائمةِ المغلقةِ
--
--    `drop` ثمَّ `add`: القيدُ القديمُ لا يقبلُ `undeliverable`، فلا بدَّ من
--    إسقاطِه وإعادةِ إنشائِه. والطورُ `contract` لأنَّ `drop` لا يقعُ في غيرِه.
--    والقيدُ الجديدُ بـ`not valid` فلا يُمسحُ الجدولُ — والتصدِيقُ في الملفِّ
--    التالي (طورُ `validate`).
-- ---------------------------------------------------------------------------

alter table notification_outbox
  drop constraint if exists notification_outbox_status_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'notification_outbox_status_check'
  ) then
    alter table notification_outbox
      add constraint notification_outbox_status_check check (
        status in ('pending','sending','delivered','dead','failed','canceled','in_app_only','undeliverable')
      ) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- ٢) قيدُ الزوجِ للحالةِ الجديدةِ — `died_at` و`dead_reason` إلزاميّانِ
--
--    قيدٌ **منفصلٌ** لا توسيعٌ لـ`notification_dead_pair`: معنى الاسمِ الأوّلِ
--    «الصفُّ الميّتُ يستحقُّ لحظتَه وسببَه»، وتوسيعُه ليشملَ `undeliverable` كانَ
--    سيُغيِّرُ معنى الاسمِ. والقيدُ الجديدُ يقولُ ما يقولُه اسمُه: الصفُّ غيرُ
--    القابلِ للتسليمِ يستحقُّ لحظتَه وسببَه أيضاً.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'notification_undeliverable_pair'
  ) then
    alter table notification_outbox
      add constraint notification_undeliverable_pair check (
        (status <> 'undeliverable')
        or (died_at is not null and dead_reason is not null)
      ) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- ٣) قيدُ أسبابِ التعذُّرِ — قائمةٌ مغلقةٌ لا نمطٌ
--
--    `dead_reason` حرٌّ في `dead` (يكتبُه `MAX_ATTEMPTS` أو `ABANDONED` أو نصٌّ
--    صريحٌ من `abandon`). فقيدٌ عامٌّ على `dead_reason` كانَ سيُخالِفُ القاعدةَ
--    القائمةَ. فالقيدُ ههنا **على `undeliverable` وحدَها**: ثلاثةُ أسبابٍ لا رابعَ.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'notification_undeliverable_reason_check'
  ) then
    alter table notification_outbox
      add constraint notification_undeliverable_reason_check check (
        (status <> 'undeliverable')
        or dead_reason in (
          'TELEGRAM_ID_MISSING',
          'TELEGRAM_DELIVERY_UNAVAILABLE',
          'TELEGRAM_DELIVERY_NOT_REQUIRED'
        )
      ) not valid;
  end if;
end $$;

comment on constraint notification_undeliverable_pair on notification_outbox is
  'الصفُّ غيرُ القابلِ للتسليمِ (undeliverable) يلزمُه died_at وdead_reason — كما يلزمُ الميّتَ (dead).';
comment on constraint notification_undeliverable_reason_check on notification_outbox is
  'أسبابُ التعذُّرِ الثلاثةُ المغلقةُ: TELEGRAM_ID_MISSING · TELEGRAM_DELIVERY_UNAVAILABLE · TELEGRAM_DELIVERY_NOT_REQUIRED.';

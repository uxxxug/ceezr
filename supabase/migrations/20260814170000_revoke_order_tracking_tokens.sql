-- الغرض: إلغاءُ روابط تتبّع طلبٍ كاملةً بطلب صاحبه — بلا أن يحمل الراكبُ الرمز نفسه.
-- الحالة: منفّذ فعلياً — أُضيف في 2026-08-14 (§4.2 من أمر الإطلاق التجاري).
--
-- ## لماذا دالّةٌ ثانية و`revoke_tracking_token` موجودة؟
--
-- تلك تأخذ الرمز، وهذه تأخذ الطلب. والراكبُ في تلغرام لا يرى الرمز أصلاً: هو
-- يرى رابطاً أرسلناه إليه، وزرُّ «إلغاء الرابط» بيانُه معرّفُ الطلب لا الرمز —
-- ولو حملنا الرمز في بيان الزرّ لصار الرمزُ مكتوباً في تحديثٍ يبقى في تاريخ
-- المحادثة، ولصار من يقرأ لقطةَ شاشةٍ للزرّ قادراً على فتح الصفحة.
--
-- وهي تُلغي **كلّ** الروابط السارية للطلب لا أحدثها: من أصدر رابطين وشاركهما مع
-- شخصين ثمّ ضغط «إلغاء» يقصد أن ينقطع الاثنان. وإلغاءُ الأحدث وحده كان سيُبقي
-- عيناً مفتوحةً يظنّها المستخدم مغلقة — وهو أسوأ من ألّا يكون هناك زرٌّ أصلاً.
--
-- ## لا تمييز بين «لست المالك» و«لا رابطَ ساري»
--
-- كلتاهما تُعيد `revoked = 0`. ولو مُيّزتا لصار الردُّ مِسبراً يُخبر من يجرّب
-- معرّفات طلبٍ عشوائية أيَّها موجودٌ وله رابطٌ ساري.

create or replace function revoke_order_tracking_tokens(
  p_order_id uuid,
  p_telegram_id bigint
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revoked integer := 0;
begin
  if p_order_id is null or p_telegram_id is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;

  -- شرطُ الملكية في العبارة نفسها التي تكتب الصفّ (القاعدة 0.5): لا سؤالَ أوّلاً
  -- ثمّ كتابةٌ بعده، فلا نافذةَ بينهما يتغيّر فيها المالك.
  update trip_tracking_tokens tt
     set revoked_at = now()
   where tt.order_id = p_order_id
     and tt.revoked_at is null
     and exists (
       select 1
         from orders o
         join riders r on r.id = o.rider_id
         join users u on u.id = r.user_id
        where o.id = p_order_id
          and u.telegram_id = p_telegram_id
     );

  get diagnostics v_revoked = row_count;

  return jsonb_build_object('ok', true, 'revoked', v_revoked);
end;
$$;

comment on function revoke_order_tracking_tokens(uuid, bigint) is
  'إلغاءُ كلّ روابط تتبّع طلبٍ بطلب صاحبه — بمعرّف الطلب لا بالرمز (§4.2).';

-- الصلاحيةُ لدور الخدمة وحده: المسارُ العامّ لا يُلغي شيئاً، والزرُّ يمرّ عبر البوت.
revoke all on function revoke_order_tracking_tokens(uuid, bigint) from public;
grant execute on function revoke_order_tracking_tokens(uuid, bigint) to service_role;

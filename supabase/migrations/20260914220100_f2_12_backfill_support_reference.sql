-- migration-phase: backfill
-- `F2-12` · `ADR 0114` — مرجعٌ لكلِّ تذكرةٍ قديمةٍ، **بترتيبِ نشأتِها**.
--
-- الافتراضيُّ في طورِ `expand` يملأُ الصفوفَ الجديدةَ وحدَها؛ والقديمةُ تبقى
-- بلا مرجعٍ حتّى يُملأَ ههنا. **والترتيبُ مقصودٌ**: `WSL-000001` لأقدمِ تذكرةٍ
-- كي يكونَ الرقمُ مقروءاً زمنيّاً، فلا يُسألُ لِمَ تذكرةُ أمسٍ رقمُها أكبرُ.
--
-- **مُعاوَدٌ (idempotent)**: يُملأُ ما كانَ `null` وحدَه، فإعادةُ التطبيقِ لا
-- تُغيِّرُ مرجعاً أُعطيَ — **والمرجعُ المُعطى لا يُبدَّلُ أبداً** لأنَّه صارَ
-- في يدِ إنسانٍ وفي بطاقةِ قروبٍ.
--
-- ولا قفلَ حاجزاً: `update` على صفوفٍ موجودةٍ يأخذُ قفلَ صفٍّ لا قفلَ جدولٍ،
-- وجدولُ التذاكرِ اليومَ بمئاتٍ لا بملايينَ (والحدُّ مقروءٌ في §القدرةِ).
--
-- مسارُ العودةِ: `update support_tickets set reference = null;` — ولا يُنصَحُ
-- بهِ بعدَ إعطاءِ مرجعٍ لإنسانٍ؛ العودةُ الصادقةُ إسقاطُ العمودِ في طورِ
-- `contract` لا تفريغُه.

update support_tickets t
   set reference = 'WSL-' || lpad(ordered.seq::text, 6, '0')
  from (
    select id,
           row_number() over (order by created_at asc, id asc) as seq
      from support_tickets
     where reference is null
  ) as ordered
 where t.id = ordered.id
   and t.reference is null;

-- التسلسلُ يُدفَعُ إلى ما بعدَ آخرِ مرجعٍ مُعطىً، وإلّا أعطى الصفُّ التالي
-- مرجعاً مأخوذاً فسقطَ على قيدِ التفرُّدِ في طورِ `index`.
-- **والقراءةُ من الجدولِ لا من عدَّادٍ محفوظٍ**: مصدرُ الحقيقةِ ما أُعطيَ فعلاً.
select setval(
  'support_ticket_reference_seq',
  greatest(
    (select coalesce(max(nullif(regexp_replace(reference, '^WSL-', ''), '')::bigint), 0)
       from support_tickets
      where reference ~ '^WSL-[0-9]+$'),
    (select last_value from support_ticket_reference_seq)
  )
);

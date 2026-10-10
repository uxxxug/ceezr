# PD-042 / R1 / LOST — تطابقُ الدوالِّ السبعِ بينَ الإنتاجِ والمستودع (2026-10-10)

**النتيجة:** الدوالُّ السبعُ في الإنتاج (`jafuchojgxzeuvibkkfx`) **مطابقةٌ بايتًا ببايت** لآخرِ تعريفٍ لها في `supabase/migrations/` على `main` (`536f1c8`). لا اختلاف، **فلا حاجةَ لهجرةٍ ولم تُطبَّق أيُّ هجرة**. هذا يغلقُ البندَ «مقارنةُ الأجسامِ غيرُ مكتملة» في `PRD-002-deploy-20261010-9519056f.md`.

## الطريقة (قراءةٌ فقط)

1. **الإنتاج:** `select proname, md5(prosrc), length(prosrc), prosecdef, proconfig from pg_proc … where nspname='public'` للدوالِّ السبع. `prosrc` هوَ النصُّ الحرفيُّ بينَ علامتَي الاقتباسِ الدولاريّ كما خزّنه الخادم.
2. **المستودع:** لكلِّ دالّةٍ آخرُ `create [or replace] function public.<name>(` بترتيبِ أسماءِ ملفّاتِ الهجرة (ترتيبُ `scripts/migrate.ts`)، ثمَّ النصُّ بينَ `as $tag$` و`$tag$` التالي، ثمَّ `md5` وطولُه بالمحارف.
3. المقارنة: `md5` والطول، ثمَّ `security definer` و`search_path` من رأسِ التعريف مقابلَ `prosecdef`/`proconfig`.

## النتائج

| الدالّة | آخرُ تعريفٍ في المستودع | md5(prosrc) الإنتاج = المستودع | الطول | definer · search_path |
|---|---|---|---|---|
| `admin_review_driver_document` | `20261010100000_pd_042_admin_document_review.sql` | `46f071aa8c842fcca9eb609b14e97c47` ✓ | 2720 ✓ | ✓ · `public, pg_temp` ✓ |
| `admin_open_driver_document` | `20261010100000_pd_042_admin_document_review.sql` | `d4b053942b108aa28fa205170516574b` ✓ | 1346 ✓ | ✓ · `public, pg_temp` ✓ |
| `admin_set_document_reviewer` | `20261010100000_pd_042_admin_document_review.sql` | `5231e67c8636af6b66999d3ac6891881` ✓ | 2059 ✓ | ✓ · `public, pg_temp` ✓ |
| `is_document_reviewer` | `20261010100000_pd_042_admin_document_review.sql` | `5c16c73c421ced31773c835ef734b454` ✓ | 269 ✓ | ✓ · `public, pg_temp` ✓ |
| `update_rider_city` | `20261010090000_rider_city_single_write.sql` (رابعُ تعريفٍ بعدَ 20260811170000 · 20260814120000 · 20260814140000) | `3416b80347e3d6fe9fd39a58a2ec0c83` ✓ | 2187 ✓ | ✓ · `public` ✓ |
| `locate_rider_operating_city` | `20261009120000_r1_rider_operating_city.sql` | `d9e6048b96a238d518adfcb8665b74c0` ✓ | 3531 ✓ | ✓ · `public` ✓ |
| `open_support_ticket_with_lost_at` | `20261009130000_lost_item_time.sql` | `0e391e2d1a7d091b994ed9c04c76b6cb` ✓ | 1091 ✓ | ✓ · `public, pg_temp` ✓ |

مع ما سبقَ قياسُه في `PRD-002-deploy-20261010-9519056f.md` (منعُ `anon`/`authenticated` والسماحُ لـ`service_role` للسبع، العمود `reviewed_by`، الفهرسُ الفريدُ الجزئيّ، RLS، منحُ المراجعين للمدنِ الخمس) يثبتُ أنَّ هجراتِ مراجعةِ الوثائقِ وR1 وLOST مطبَّقةٌ في الإنتاجِ بمحتواها الحاليّ في المستودع.

**حدودٌ:** المقارنةُ على الجسمِ والإعداداتِ الأمنيّة. المعاملاتُ ونوعُ الإرجاعِ قُرئت من الإنتاج (`pg_get_function_identity_arguments` · `pg_get_function_result`) ولم تُطابَق آليًّا بنصِّ الرأس. لا يشملُ هذا الدوالَّ الأخرى (272 في قاعدةِ الإنتاج).

## سكربتُ المقارنةِ في المستودع (للتكرار)

```python
import re, hashlib, glob
files = sorted(glob.glob("supabase/migrations/*.sql"))
def latest_body(name):
    last = None
    for f in files:
        s = open(f, encoding="utf-8").read()
        for m in re.finditer(r"create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?" + name + r"\s*\(", s, re.I):
            rest = s[m.end():]
            d = re.search(r"\bas\s+(\$[A-Za-z_]*\$)", rest, re.I)
            start = d.end(); end = rest.index(d.group(1), start)
            last = (f, rest[start:end])
    return last
# md5 = hashlib.md5(body.encode()).hexdigest(); length = len(body)
```

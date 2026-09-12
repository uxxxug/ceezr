# دليلُ الزيادةِ الثالثةِ في `W-5` — عقدُ الإلغاءِ ونطاقُ معرّفاتِ الحواجزِ (2026-09-12)

- **البندُ**: `W-5` «Consume `core.fulfillment.created`; produce `move.job.completed` through a transactional outbox with the canonical event envelope» — الزيادةُ الثالثةُ: مُقابَلةُ العقدِ الواردِ للإلغاءِ بعدَ دورةِ نطاقِ المستأجرِ عندَ CORE.
- **الدرجةُ المُدَّعاةُ**: `مُختبَرٌ` لمسارِ الإلغاءِ الواردِ. **وليسَ** `مُتحقَّقٌ منه`، ولا `[x]` للبندِ: `verify` أحمرُ بـ`O-1`، ولم يُقَسْ إلغاءٌ من بيئةِ CORE حقيقيّةٍ (`DEP-CORE-007` · `O-4`).
- **القرارُ الحاكمُ**: [ADR-0089](../../adr/0089-cancellation-contract-re-vendored-and-foreign-blocker-namespace.md) · يبني على [ADR-0082](../../adr/0082-core-event-transport-both-directions.md) و[ADR-0081](../../adr/0081-operational-job-and-core-event-boundary.md).
- **الفرعُ**: `feat/w5-recontract-cancellation-tenant-scope`، مقطوعٌ من `main`@`1d361ea`.
- **الحجزُ**: `chore(W-5)`@`4430c43` (سطرٌ في `## In progress` من `ROADMAP.md` وحدَه، وفقَ §25 من `docs/ROADMAP-MASTER.md`) — سُجِّلَ **قبلَ** أوّلِ تعديلِ شيفرةٍ.
- **تعارضُ الملكيّةِ**: `#10` وحدَه مفتوحٌ (`feat/w9-cutover-plan-readonly-rehearsal`). قُوبِلَت ملفّاتُه بملفّاتِ هذه الزيادةِ ⇒ **لا تقاطعَ**. والفروعُ الاثنا عشرَ الأخرى لقطاتٌ قبلَ الهجرةِ، **لم تُدمَجْ ولم تُحذَفْ** (لا نتصرّفُ إلّا وفقَ حالةِ GitHub الراهنةِ).

## كيفَ قِيسَ العطبُ

قراءةُ `uxxxug/wasla-core`@`0edb7af` (HEAD وقتَ القياسِ) ومُقابَلةُ بايتاتِ العقودِ الستّةِ المنقولةِ:

| الملفُّ المنقولُ | بصمتُنا قبلَ الزيادةِ | بصمةُ CORE@`0edb7af` | الحكمُ |
|---|---|---|---|
| `core.fulfillment.created.v1.schema.json` | مُطابِقةٌ | مُطابِقةٌ | لا انحرافَ |
| `core.fulfillment.cancelled.v1.schema.json` | `ed540b6b…` | `cd9d8369f35457abe8d86a5618b55801574ad0f4aa693208b2b73e9167265e51` | **منحرفٌ** |
| `move.job.accepted.v1` · `move.job.rejected.v1` · `move.job.completed.v1` · `move.job.failed.v1` | مُطابِقةٌ | مُطابِقةٌ | لا انحرافَ |
| `transport/core-v1.yaml` | منحرفٌ | `5401ab4ce6713c11f5582ac40e957312cc2686899ccd87ca701420f9b100c960` | **منحرفٌ** (غيرُ قاطعٍ) |
| `transport/outbound-delivery.md` | منحرفٌ | `21e55afcae3266a1f6d1de58bc42201b9627549bd10f63767206337ab069f59f` | **منحرفٌ** (غيرُ قاطعٍ) |

التزاماتُ CORE التي أحدثَت الانحرافَ: `acd93c8` (دورةُ نطاقِ المستأجرِ — تُغلِقُ `CORE:B-23`) · `7cadc54` · `be9b89d` (`partially_captured`).

**الأثرُ القاطعُ.** `validateObject` يردُّ الخاصيّةَ غيرَ المُعلَنةِ، و`consume` في `packages/application/wasla/fulfillment-lifecycle.ts` يُدقِّقُ الحمولةَ **قبلَ** إيداعِها في `core_event_inbox` ويُرجِعُ `{kind:"contract"}`. وحمولةُ الإلغاءِ عندَ CORE صارَت تحملُ `organization_id` مطلوباً ⇒ **كلُّ إلغاءٍ يُنشِرُه CORE اليومَ كانَ يُرَدُّ** وتبقى المهمّةُ التشغيليّةُ جاريةً بلا نهايةٍ. وقد أُضيفَت حالةُ القياسِ أوّلاً فأخفقَت على الشيفرةِ القديمةِ، ثمَّ نجحَت بعدَ إعادةِ النقلِ.

## ما نُفِّذَ

| الطبقةُ | الملفُّ | ما فيه |
|---|---|---|
| عقدٌ منقولٌ | `docs/contracts/core/core.fulfillment.cancelled.v1.schema.json` | بايتاتُ `CORE@0edb7af` حرفاً — لا تأليفَ ولا تحريرَ يدويّاً |
| عقدُ نقلٍ | `docs/contracts/core/transport/core-v1.yaml` · `transport/outbound-delivery.md` | أُعيدَ نقلُهما كذلكَ (`429` صريحاً لكلِّ مسارٍ · إعادةُ تصميمِ الحجزِ والرَّدِّ والإبطالِ · خططٌ واشتراكاتٌ · حجزٌ مقابلَ تراجُعٍ — `CORE:B-22`/`B-24`/`B-25`) |
| سندٌ | `docs/contracts/core/PROVENANCE.md` | قسمٌ جديدٌ باسمِ الدورةِ والتزامِها؛ والبصماتُ المُلغاةُ **محفوظةٌ** في جدولٍ لا يُقرأُ حاجزَ سلامةٍ ⇒ بصمةٌ نافذةٌ واحدةٌ لكلِّ ملفٍّ، والدليلُ القديمُ لا يُمحى |
| نطاقٌ | `packages/domain/wasla/event-envelope.ts` | `FieldSpec.type` كَسِبَ `"boolean"`؛ و`PAYLOAD_SPECS["core.fulfillment.cancelled.v1"]`: مطلوبٌ `fulfillment_id` · `organization_id` · `order_reference` · `reason` · `cancelled_at`، ومُعلَنٌ `captured_minor` (صحيحٌ ≥ 0 — والغيابُ ليسَ صفراً) · `financial_decision_required` (منطقيٌّ) · `settlement_state` بستِّ قيمٍ منها `partially_captured` |
| حاجزٌ | `scripts/lib/wasla-blockers.ts` | `FOREIGN_BLOCKER_MENTION_PATTERN` يُسقِطُ `CORE:`/`MARKET:` **قبلَ** مُطابَقةِ `BLOCKER_ID_PATTERN` — مستودَعانِ مُسمَّيانِ لا بادِئةٌ مفتوحةٌ |
| قياسٌ | `tests/unit/core-contract-parity.test.ts` | كتلةٌ جديدةٌ بخمسِ حالاتٍ لعقدِ الإلغاءِ بعدَ الدورةِ |
| قياسٌ | `tests/integration/wasla-fulfillment-lifecycle.test.ts` | ثلاثُ حالاتٍ في كتلةِ «٥) الإلغاءُ الواردُ من CORE» على قاعدةٍ حقيقيّةٍ |
| قياسٌ | `tests/unit/wasla-blockers.test.ts` | حالةٌ تُثبِتُ إسقاطَ المذكورِ ببادِئةِ مستودَعٍ مالِكٍ، **وبقاءَ** لزومِ الصفِّ لمعرّفاتِنا |
| فهرسٌ | — | `node_modules` أُخرِجَ من فهرسِ git (كانَ صلةً رمزيّةً متعقَّبةً إلى مسارٍ مطلقٍ، خلافَ `.gitignore`) |

## ما لم يُفعَلْ عن قصدٍ

- **لم يُعدَّلْ `scripts/check-blocker-registry.ts`**: لا صفَّ كاذباً في جدولِنا لحاجزٍ يملِكُه CORE، ولا إعفاءَ يدويّاً يُضافُ مع كلِّ اقتباسٍ. العلاجُ في المُفكِّكِ، وهوَ بِنيويٌّ. وفائدةٌ ثانيةٌ: تقاطعُ الملفّاتِ مع `#10` يبقى صِفراً.
- **لم يُمَسَّ `scripts/check-migrations.ts`** ولا `packages/shared/config/domain-ingress.ts` ولا `docs/MASTER_DIRECTIVE.md`: `O-1` حاجزُ مالِكٍ لا يُسكَتُ من هنا.
- **لم يُمَسَّ اختبارُ Redis الحقيقيِّ** ولا حارسُ إشهادِه: `O-2` غيابُ أسرارٍ لا عطلُ شيفرةٍ.
- **لم تُعدَّلْ قراراتٌ منشورةٌ** (`0084`…`0088`) — `ح-6`. ورقمُ `0088` مأخوذٌ بطلبِ الدمجِ `#10` المفتوحِ فأُخِذَ `0089`.
- **لم يُلمَسْ CORE ولا MARKET**: انحرافُ العقدِ سُجِّلَ تبعيّةً وعُولِجَ بإعادةِ النقلِ عندَنا، والقرارُ الماليُّ `CORE:B-20` مُسجَّلٌ حاجزاً أجنبيّاً لا عملاً لنا.

## القياسُ المحلّيُّ (`ح-8`: قياسٌ لا حكمٌ)

بيئةُ القياسِ: PostgreSQL 18.6 + PostGIS محلّيّةٌ (المنفذُ 5432، قاعدةُ `waslah`، 101 هجرةً مطبَّقةً بـ`scripts/migrate.ts`)، bun 1.4.2. وCI يقيسُ على `postgis/postgis:17-3.5`.

```
bun test tests/unit/core-contract-parity.test.ts + wasla-blockers + check-blocker-registry
  → 66 pass · 0 fail · 145 توقُّعاً
TEST_DATABASE_URL=… bun test wasla-fulfillment-lifecycle + wasla-core-transport + gateway-core-event-intake
  → 61 pass · 0 fail · 296 توقُّعاً
TEST_DATABASE_URL=… bun test  (الجريةُ الكاملةُ)
  → 3726 pass · 37 skip · 4 fail · 3767 اختباراً / 290 ملفّاً · 489 ثانيةً
bunx tsc --noEmit   → لا خطأَ
bunx biome check .  → 1119 ملفّاً، لا مخالفةَ (بعدَ `--write` على ثلاثةِ ملفّاتِ اختبارٍ)
scripts/check-vendored-contract-integrity.ts → 8 ملفّاً، كلُّ بصمةٍ مُطابِقةٌ
scripts/check-core-contract-parity.ts        → أخضرُ (مغلَّفٌ + 5 حمولةً · 5 حالاتٍ · 5 انتقالاتٍ · ثوابتُ الناقلِ)
scripts/check-blocker-registry.ts            → 16 حاجزاً مُفكَّكاً (15 مفتوحاً)
scripts/check-adr-numbering.ts               → 88 قراراً بأرقامٍ فريدةٍ
جميعُ حوارسِ scripts/check-*.ts (46 حارساً) واحداً واحداً → 40 أخضرَ · 6 حمراءَ
```

### الحمراءُ السِّتُّ، مُصنَّفةً

| الحارسُ | التصنيفُ |
|---|---|
| `check-migrations.ts` | **حاجزُ مالِكٍ حقيقيٌّ** — `O-1`: `operational_jobs` · `core_event_inbox` · `move_event_outbox` بلا `city_id` (القاعدةُ 0.4). قائمٌ قبلَ هذه الزيادةِ وبعدَها |
| `check-real-redis-proof.ts` | **غيابُ بيئةٍ** — `O-2`: يقرأُ `/tmp/real-redis-proof.json` الذي تكتبُه الخطوةُ التي قبلَه في CI |
| `check-coverage-gate.ts` | يقرأُ `coverage/lcov.info`: مُخرَجُ خطوةٍ سابقةٍ، لا يُشغَّلُ عارياً |
| `check-no-skipped-tests.ts` | يلزَمُه مسارُ سجلِّ مخرجاتٍ وسيطاً |
| `check-performance-budget.ts` · `check-single-origin-assets.ts` | يقرآنِ `apps/miniapp/dist`: يُشغَّلانِ بعدَ البناءِ |

### الأربعةُ المُخفِقةُ في الجريةِ الكاملةِ، مُصنَّفةً

كلُّها في اختباراتِ تكاملٍ على قاعدةٍ حقيقيّةٍ، **ولا واحدَ منها في ملفٍّ مسَّته هذه الزيادةُ**. وأُعيدَ تشغيلُ ملفّاتِها منفردةً:

| الملفُّ | منفرداً | التصنيفُ |
|---|---|---|
| `tests/integration/dispatch-nearby-candidates-postgis.test.ts` | **7 pass · 0 fail** | تشويشُ تزامنٍ: الجريةُ الكاملةُ تُشغِّلُ 290 ملفّاً على قاعدةٍ **واحدةٍ** محلّيّةٍ، وCI يفصلُ خطواتَه |
| `tests/integration/safe-migration-runner.test.ts` | 7 pass · 1 fail (مهلةُ 5 ثوانٍ) | مهلةٌ تحتَ حِملٍ، لا دعوى سلوكٍ |
| `tests/integration/hot-query-index-plans.test.ts` | 8 pass · 1 fail | **فرقُ مُخطِّطٍ بينَ إصدارَينِ**: `audit_log_action_entity_idx` بإسقاطِه يختارُ PostgreSQL 18 فهرساً آخرَ (`Limit`، كلفةٌ 12.84) حيثُ يتوقّعُ الاختبارُ `Seq Scan`. CI على 17 وهذا الشوطُ أخضرُ في `main` |
| جريةٌ بلا اسمٍ (120 ثانيةً) | — | مهلةُ ملفٍّ تحتَ الحِملِ عينِه |

**ولا يُقرأُ هذا التصنيفُ تخفيفاً**: لم يُعدَّلْ اختبارٌ منها ولا مهلةٌ ولا تخطٍّ، ولا تُدَّعى خضرةٌ محلّيّةٌ حكماً. حكمُ CI هوَ الحكمُ، ويُسجَّلُ في سجلِّ أحكامِ CI من `ROADMAP.md` شوطاً شوطاً وخطوةً خطوةً بعدَ الدفعِ.

## قياسُ الحالةِ المحيطةِ (يُسجَّلُ ولا يُتصرَّفُ فيه)

- **أحكامُ CI في `main`@`1d361ea`** (الشوطُ `34675470089`): `تكامل على PostgreSQL حقيقي` ناجحٌ · `فوضى متعدد المثيلات (F5-06)` ناجحٌ · `Roadmap freshness` ناجحٌ · `verify` **مُخفِقٌ** عندَ الخطوةِ 19 «منع أي جدول بلا city_id» (الخطواتُ 1–18 ناجحةٌ، و20–55 متخطّاةٌ ⇒ `bun test` **لم يُحكَمْ عليهِ قطُّ** في `verify`) · `تكامل على Redis حقيقي` **مُخفِقٌ** عندَ الخطوةِ 8.
- **طلباتُ الدمجِ**: `#1`…`#9` مُدمَجةٌ. `#10` مفتوحٌ، وشوطُه `34676446095` يُخفِقُ على `O-1` و`O-2` وحدَهما.
- **الفروعُ**: اثنا عشرَ فرعاً غيرَ `main`، كلُّها لقطاتٌ قبلَ الهجرةِ. لا دمجَ ولا حذفَ.
- **تبعيّاتٌ سُجِّلَت ولم تُنفَّذْ**: `DEP-CORE-006` (لا حقلَ مدينةٍ ولا جغرافيا في `core.fulfillment.created.v1` عندَ `CORE@0edb7af` ⇒ الحاجزُ مفتوحٌ بحقٍّ) · و`CORE:B-20` قرارٌ ماليٌّ عندَ مالِكِه.

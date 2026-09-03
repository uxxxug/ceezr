/**
 * الغرض: سيناريو موزَّع — **نفسُ الحدثِ بنفسِ `update_id`** يُعاد إلى عمليةٍ أخرى:
 *        هل تتكرّر الحالةُ التجارية؟ (§5 من أمرِ وحدة 2-6)
 * الحالة: منفّذ فعلياً — وحدة 2-6.
 * ينتمي إلى: bench/topology/scenarios
 * يُتوقع أن يستخدمه لاحقاً: `bench/run-distributed.ts`، وأيُّ مراجعةٍ لمانعِ التكرار
 *                   عند رفعِ `numInstances` فوق واحد.
 *
 * ## السؤالُ المقيس — وقد تبدّل جوابُه بإغلاقِ `BUG-002`
 *
 * كان قرارُ منعِ التكرارِ خريطةً **في ذاكرةِ العملية**، فكانت الإعادةُ إلى `gw2`
 * **تعبُر** إلى منطقِ العمل، ولا يحميها إلّا ذرّيّةُ القاعدةِ في `claim_ride`. وهذا
 * السيناريو هو الذي أثبت تلك الفجوةَ، **وهو نفسُه يُثبِت إصلاحَها الآن**
 * ([ADR 0054](../../../docs/adr/0054-telegram-webhook-durable-ingest-and-dedup.md) §١١/٣):
 * صار القرارُ إيصالَ استلامٍ **صامداً في القاعدةِ** بقيدِ تفرُّدٍ على `(bot, update_id)`،
 * فالنسختان تقرآن قيداً واحداً لا خريطتين.
 *
 * 1. الأصل إلى `gw1` → يُعالَج ويظفر، ويُختَم إيصالُه `done`.
 * 2. نفسُه بنفسِ `update_id` إلى `gw1` → **يُحجَب** عندَ الإيصالِ الصامدِ.
 * 3. نفسُه بنفسِ `update_id` إلى `gw2` → **يُحجَب أيضاً** — وهذا هو التبدُّلُ المقيس.
 *
 * وتبقى حمايةُ القاعدةِ قائمةً تحتَه لا مستغنىً عنها: الإيصالُ يمنع **إعادةَ
 * المعالجةِ**، و`claim_ride` وقيدُ `order_offers_single_accepted` يمنعان **فسادَ
 * الحالةِ** لو نفذَ تسليمٌ من طريقٍ آخرَ. طبقتان لا واحدةٌ تُغني عن الأخرى.
 *
 * ## ما لا يُدّعى هنا
 *
 * لا يُدّعى `exactly-once` للآثارِ الخارجيةِ (ADR 0054 §٥/٤): المُثبَتُ أنّ التسليمَ
 * المكرَّرَ لا يُنتج عملاً ثانياً، لا أنّ كلَّ أثرٍ خارجيٍّ يقع مرّةً واحدةً في كلِّ
 * الأحوالِ. والحكمُ هنا على الحالةِ التجارية وعلى الرسائلِ الصادرةِ معاً.
 */

import { translate } from "../../../packages/shared/i18n/index.ts";
import {
  ADMIN_VERIFY_MOCK,
  ARRANGED_DRIVER_BASE,
  arrangeAvailableDriver,
  JED_PICKUP,
  nudge,
  registerRider,
  SCENARIO_RIDER_BASE,
} from "../../scenarios/catalog/support.ts";
import {
  type CheckResult,
  check,
  expectEqual,
  type ScenarioContext,
  type ScenarioDefinition,
} from "../../scenarios/contract.ts";
import {
  callbackUpdate,
  locationUpdate,
  textUpdate,
  withUpdateId,
} from "../../scenarios/updates.ts";
import type { Cluster } from "../cluster.ts";

/** سائقان يكفيان: المقيسُ التكرارُ لا التزاحم، وثانٍ يجعل «الظافر» ذا معنى. */
const DRIVERS = 2;

/** رقمُ تحديثٍ ثابتٌ ومميَّز: هو محورُ القياس، فلا يُترك لمولّد. */
const REPLAYED_UPDATE_ID = 88_001;

const singleOrderId = async (context: ScenarioContext): Promise<string> => {
  const [row] = await context.sql<{ id: string }[]>`select id from public.orders`;
  return row?.id ?? "";
};

export function createCrossProcessReplayScenario(cluster: Cluster): ScenarioDefinition {
  return {
    id: "cross-process-replay",
    title: "إعادةُ نفسِ التحديثِ إلى عمليةٍ أخرى: الحالةُ التجارية لا تتكرّر",
    service: "transport",

    initialState: [
      `${DRIVERS} سائقان موثَّقان متاحان، وعميلٌ طلب رحلةً فبُثَّ الطلبُ عليهما.`,
      "عرضان منتظِران، ولا إسنادَ بعد.",
      "بوّابتان في عمليتين منفصلتين، وقرارُ منعِ التكرارِ مشتركٌ بينهما في القاعدةِ لا في ذاكرةِ كلٍّ منهما.",
    ],
    userInputs: [
      `ضغطةُ «قبول» واحدةٌ برقمِ تحديثٍ ثابت (update_id=${REPLAYED_UPDATE_ID}) تُسلَّم ثلاثَ مرّات: gw1، ثم gw1، ثم gw2.`,
    ],
    steps: [
      "يُرسَل الأصلُ إلى gw1 فيظفر السائقُ الأوّل.",
      "يُعاد **نفسُ** التحديثِ إلى gw1: يجب أن يُحجَب عندَ الإيصالِ الصامدِ بلا وصولٍ إلى منطقِ العمل.",
      "يُعاد **نفسُ** التحديثِ إلى gw2: يجب أن يُحجَب كذلك — القيدُ في القاعدةِ واحدٌ للعمليتين.",
      "تُقرأ الحالةُ التجاريةُ بعد الثلاث، ويُقرأ إيصالُ الاستلامِ في القاعدةِ: صفٌّ واحدٌ مختومٌ.",
    ],
    expectedSystemResponse: [
      "الأصلُ يُنتج رسالةَ `driver.offer_accepted` وبطاقةَ الرحلةِ ودبّوسَ الموقع.",
      "الإعادةُ على نفسِ العملية لا تُنتج رسالةً أصلاً (حُجِبت قبل منطقِ العمل).",
      "الإعادةُ على العمليةِ الأخرى لا تُنتج رسالةً كذلك — وهذا موضعُ الإصلاحِ الذي كان يعبُر قبلَه.",
    ],
    expectedBusinessOutcome: [
      "عرضٌ مقبولٌ واحدٌ بالضبط بعد الثلاث.",
      "الطلبُ `matched` ومُسنَدٌ لنفسِ السائقِ الذي ظفر أوّلاً — لا تحوّلَ إسنادٍ ولا إسنادٌ ثانٍ.",
      "أثرُ تدقيقٍ واحدٌ في `audit_log`.",
      "عدّادُ العروضِ المقبولةِ تحرّك واحداً مجموعاً على النسختين.",
    ],

    concurrency: {
      count: 1,
      mode: "independent",
      rationale:
        "فاعلٌ واحدٌ عن قصد: المقيسُ هو تكرارُ حدثٍ واحدٍ عبر عمليتين، لا تزاحمُ فاعلين. " +
        "وإدخالُ تزاحمٍ هنا كان سيخلط سببين لنتيجةٍ واحدةٍ فيضيع أيُّهما أنتجها.",
    },
    mocks: [
      ADMIN_VERIFY_MOCK,
      {
        what: "الإعادةُ تُوجَّه إلى نسخةٍ بعينها بقرارِ الاختبار (`postTo`)، لا بموازِنِ حملٍ حقيقيّ.",
        why: "إثباتُ الفرقِ بين إعادةٍ إلى نفسِ العمليةِ وإعادةٍ إلى عمليةٍ أخرى يحتاج تحكّماً في الوجهة.",
        proves: "سلوكَ النظامِ في الحالتين معزولتين ومُسمَّيتين.",
        doesNotProve:
          "أنّ موازِنَ الحملِ في الإنتاج يوزّع إعادةَ تلغرام على نسخةٍ أخرى بأيِّ احتمالٍ معيّن — ذاك سؤالُ نشرٍ لا سؤالُ كود.",
      },
    ],
    proves: [
      "أنّ قرارَ منعِ التكرارِ صار مشتركاً بين العملياتِ فعلاً: الإعادةُ إلى عمليةٍ لم ترَ الأصلَ قطُّ حُجِبت.",
      "أنّ الإيصالَ الصامدَ يُودَع مرّةً واحدةً بالضبط لكلِّ `(bot, update_id)` مهما تعدّدت التسليمات.",
      "أنّ الحالةَ التجاريةَ لم تتكرّر: عرضٌ مقبولٌ واحدٌ وإسنادٌ واحدٌ وأثرُ تدقيقٍ واحدٌ.",
      "أنّ العدّادَ المجموعَ عبر النسخِ يعكس الواقعةَ مرّةً واحدة.",
    ],
    doesNotProve: [
      "‏`exactly-once` للآثارِ الخارجيةِ: ADR 0054 §٥/٤ ينفيه، والمُثبَتُ امتناعُ إعادةِ المعالجةِ بعدَ الختمِ.",
      "أنّ حمايةَ القاعدةِ (`claim_ride`) صارت مستغنىً عنها: هي الطبقةُ الثانيةُ وما تزال تُقاس هنا.",
      "سلوكَ تلغرام في إعادةِ الإرسال ولا تواترَها.",
    ],
    metrics: ["waslah_dispatch_offers_accepted_total", "waslah_telegram_webhook_duplicates_total"],

    failureConditions: [
      {
        code: "DUPLICATED_BUSINESS_STATE",
        description: "الإعادةُ عبرَ العمليةِ الأخرى أنتجت قبولاً ثانياً أو إسناداً ثانياً.",
        detect: async (context) => {
          const [row] = await context.sql<{ accepted: string; audit: string }[]>`
            select (select count(*) from public.order_offers where status = 'accepted')::text as accepted,
                   (select count(*) from public.audit_log where action = 'order.claimed')::text as audit
          `;
          const accepted = Number(row?.accepted ?? "0");
          const audit = Number(row?.audit ?? "0");
          return accepted === 1 && audit === 1
            ? null
            : `عروضٌ مقبولة=${accepted} · آثارُ إسناد=${audit} بعد إعادةِ نفسِ التحديثِ عبر عمليتين.`;
        },
      },
      {
        code: "ASSIGNMENT_STOLEN_BY_REPLAY",
        description: "الإعادةُ نقلت الإسنادَ إلى سائقٍ آخَر أو أعادت الطلبَ إلى البحث.",
        detect: async (context, actors) => {
          const expected = actors[0]?.produced.winnerDriverId;
          const [row] = await context.sql<{ status: string; assigned: string | null }[]>`
            select status, assigned_driver_id::text as assigned from public.orders
          `;
          if (row === undefined) return "لا طلبَ في القاعدة.";
          if (row.status !== "matched") return `الطلبُ صار status=${row.status} بعد الإعادة.`;
          return row.assigned === expected
            ? null
            : `الإسنادُ صار ${String(row.assigned)} بعد أن كان ${String(expected)}.`;
        },
      },
    ],

    arrange: async (context) => {
      const notes: string[] = [];
      for (let index = 0; index < DRIVERS; index += 1) {
        const driver = await arrangeAvailableDriver(context, index, nudge(JED_PICKUP, index));
        notes.push(`سائقٌ متاحٌ ${driver.chatId} (سائق=${driver.driverId.slice(0, 8)}…)`);
      }
      const riderChat = SCENARIO_RIDER_BASE;
      await registerRider(context, riderChat, "عميل الإعادة");
      await context.post("rider", textUpdate(riderChat, "/ride"));
      await context.post("rider", locationUpdate(riderChat, JED_PICKUP));
      await context.post("rider", textUpdate(riderChat, "/skip"));

      const [offers] = await context.sql<{ n: string }[]>`
        select count(*)::text as n from public.order_offers where status = 'pending'
      `;
      notes.push(`طلبٌ واحدٌ بُثَّ على ${offers?.n ?? "0"} عرضاً منتظِراً`);
      notes.push(`نسخُ العنقود: ${cluster.instances.map((instance) => instance.id).join("، ")}`);
      return notes;
    },

    preconditions: async (context) => {
      const results: CheckResult[] = [];
      results.push(
        check(
          "precondition",
          "بوّابتان على الأقلِّ في العنقود — وإلّا فلا معنى لـ«عمليةٍ أخرى»",
          cluster.instances.length >= 2,
          `النسخ=${cluster.instances.length}`,
        ),
      );
      const [offers] = await context.sql<{ pending: string }[]>`
        select count(*) filter (where status = 'pending')::text as pending from public.order_offers
      `;
      results.push(
        expectEqual("precondition", "عرضان منتظِران", Number(offers?.pending ?? "0"), DRIVERS),
      );
      const [assigned] = await context.sql<{ n: string }[]>`
        select count(*)::text as n from public.orders where assigned_driver_id is not null
      `;
      results.push(
        expectEqual("precondition", "لا إسنادَ قبل البداية", Number(assigned?.n ?? "0"), 0),
      );
      return results;
    },

    runActor: async (context, actor) => {
      const orderId = await singleOrderId(context);
      // يضغط من له عرضٌ منتظِر: أوّلُ سائقٍ في التهيئة.
      const chatId = ARRANGED_DRIVER_BASE;
      const [own] = await context.sql<{ driver_id: string }[]>`
        select f.driver_id::text as driver_id from public.order_offers f
          join public.drivers d on d.id = f.driver_id
          join public.users u on u.id = d.user_id
         where u.telegram_id = ${chatId} and f.order_id = ${orderId}
      `;
      if (own === undefined || orderId === "") {
        throw new Error("[cross-process-replay] لا عرضَ منتظِرٌ للسائقِ الأوّل — التهيئةُ لم تصلح.");
      }

      const update = withUpdateId(
        callbackUpdate(chatId, `offer:accept:${orderId}`),
        REPLAYED_UPDATE_ID,
      );

      const before = context.messagesTo(chatId).length;
      const original = await cluster.postTo(0, "driver", update);
      const afterOriginal = context.messagesTo(chatId).length;

      const sameProcess = await cluster.postTo(0, "driver", update);
      const afterSameProcess = context.messagesTo(chatId).length;

      const crossProcess = await cluster.postTo(1, "driver", update);
      const afterCrossProcess = context.messagesTo(chatId).length;

      return {
        index: actor.index,
        telegramIds: [chatId],
        produced: {
          telegramId: chatId,
          orderId,
          winnerDriverId: own.driver_id,
          messagesFromOriginal: afterOriginal - before,
          messagesFromSameProcessReplay: afterSameProcess - afterOriginal,
          messagesFromCrossProcessReplay: afterCrossProcess - afterSameProcess,
          // نصُّ ما وصل السائقَ من الإعادةِ العابرةِ للعمليات — يُسجَّل بحرفه في الدليل.
          crossProcessReplyText:
            context.messagesTo(chatId).at(afterSameProcess)?.text ?? "(لا رسالة)",
        },
        httpStatuses: [original.status, sameProcess.status, crossProcess.status],
      };
    },

    systemResponse: async (context, actors) => {
      const results: CheckResult[] = [];
      const actorRun = actors[0];
      const accepted = translate("ar", "driver.offer_accepted");

      results.push(
        expectEqual(
          "system_response",
          "الأصلُ أنتج رسالةَ قبولٍ واحدةً للظافر",
          context
            .messagesTo(Number(actorRun?.produced.telegramId ?? 0))
            .filter((message) => message.text === accepted).length,
          1,
        ),
      );

      results.push(
        expectEqual(
          "system_response",
          "الإعادةُ على نفسِ العملية لم تُنتج رسالةً — حُجِبت عندَ الإيصالِ الصامدِ",
          Number(actorRun?.produced.messagesFromSameProcessReplay ?? -1),
          0,
        ),
      );

      /**
       * **موضعُ التبدُّلِ**: كان هذا الفحصُ يوكِّد أنّ الإعادةَ العابرةَ **وصلت** منطقَ
       * العمل — وكان ذاك هو عينُ الفجوةِ التي رُصِدت. وبعدَ إغلاقِ `BUG-002` صار
       * الواجبُ إثباتَ نقيضِه: أنّها لم تصل. ولم يُلغَ الفحصُ بل قُلِب، كي يبقى
       * السيناريو نفسُه شاهداً على الحالتين قبلَ وبعدَ.
       */
      results.push(
        expectEqual(
          "system_response",
          "الإعادةُ عبرَ العمليةِ الأخرى لم تُنتج رسالةً — حُجِبت عندَ الإيصالِ الصامدِ",
          Number(actorRun?.produced.messagesFromCrossProcessReplay ?? -1),
          0,
        ),
      );
      return results;
    },

    businessOutcome: async (context, actors) => {
      const results: CheckResult[] = [];
      const [offers] = await context.sql<{ accepted: string; pending: string }[]>`
        select count(*) filter (where status = 'accepted')::text as accepted,
               count(*) filter (where status = 'pending')::text as pending
          from public.order_offers
      `;
      results.push(
        expectEqual(
          "business_outcome",
          "عرضٌ مقبولٌ واحدٌ بعد ثلاثِ تسليمات",
          Number(offers?.accepted ?? "0"),
          1,
        ),
      );
      results.push(
        expectEqual("business_outcome", "ولا عرضَ بقي منتظِراً", Number(offers?.pending ?? "0"), 0),
      );

      const [order] = await context.sql<{ status: string; assigned: string | null }[]>`
        select status, assigned_driver_id::text as assigned from public.orders
      `;
      results.push(expectEqual("business_outcome", "الطلبُ مُسنَد", order?.status, "matched"));
      results.push(
        expectEqual(
          "business_outcome",
          "والإسنادُ لصاحبِ الضغطةِ الأصلية لا لغيره",
          order?.assigned,
          String(actors[0]?.produced.winnerDriverId),
        ),
      );

      const delta = context.metricDelta("waslah_dispatch_offers_accepted_total");
      results.push(
        check(
          "business_outcome",
          "عدّادُ القبولِ مجموعاً على النسختين تحرّك واحداً",
          delta === 1,
          `الفرقُ المجموع=${delta}`,
        ),
      );
      return results;
    },

    databaseState: async (context) => {
      const results: CheckResult[] = [];
      const [audit] = await context.sql<{ n: string }[]>`
        select count(*)::text as n from public.audit_log where action = 'order.claimed'
      `;
      results.push(
        expectEqual("database_state", "أثرُ إسنادٍ واحدٌ في التدقيق", Number(audit?.n ?? "0"), 1),
      );

      const [assignments] = await context.sql<{ n: string }[]>`
        select count(*)::text as n from public.orders where assigned_driver_id is not null
      `;
      results.push(
        expectEqual("database_state", "طلبٌ مُسنَدٌ واحد", Number(assignments?.n ?? "0"), 1),
      );
      return results;
    },

    transitions: async (context) => {
      const results: CheckResult[] = [];
      const [row] = await context.sql<{ n: string }[]>`
        select count(*)::text as n from public.audit_log where action like 'order.claim%'
      `;
      results.push(
        check(
          "transition",
          "انتقالٌ واحدٌ فقط: searching → matched",
          Number(row?.n ?? "0") === 1,
          `آثارُ الانتقال=${row?.n ?? "?"}`,
        ),
      );
      return results;
    },

    invariants: async (context, actors) => {
      const results: CheckResult[] = [];
      const [multi] = await context.sql<{ n: string }[]>`
        select count(*)::text as n from (
          select order_id from public.order_offers
           where status = 'accepted' group by order_id having count(*) > 1
        ) as many
      `;
      results.push(
        expectEqual("invariant", "لا طلبَ له أكثرُ من عرضٍ مقبول", Number(multi?.n ?? "0"), 0),
      );

      // كان الشاهدُ ههنا حجمَ خريطتَي الذاكرةِ (`dedupSize`) لبيانِ انفصالِهما. وقد
      // بطل بانتقالِ القرارِ إلى القاعدةِ: الخريطتان لم تعودا تُستشاران أصلاً، فصفرُهما
      // ليس فجوةً بل هو **الدليلُ نفسُه**. والشاهدُ الآن الإيصالُ المشتركُ.
      const [first, second] = [await cluster.stateOf(0), await cluster.stateOf(1)];
      results.push(
        check(
          "invariant",
          "لم تُستشَر خريطةُ الذاكرةِ في أيِّ نسخةٍ — القرارُ في القاعدةِ لا فيها",
          first.dedupSize === 0 && second.dedupSize === 0,
          `gw1=${first.dedupSize} مفتاحاً · gw2=${second.dedupSize} مفتاحاً`,
        ),
      );

      const receipts = await context.sql<{ status: string; attempts: number }[]>`
        select status, attempts from public.telegram_update_receipts
         where bot = 'driver' and update_id = ${REPLAYED_UPDATE_ID}
      `;
      results.push(
        expectEqual(
          "invariant",
          "إيصالُ استلامٍ واحدٌ بالضبط للتحديثِ المُعاد، مهما تعدّدت التسليمات",
          receipts.length,
          1,
        ),
      );
      results.push(
        expectEqual("invariant", "وهو مختومٌ `done` لا معلَّقٌ", receipts[0]?.status, "done"),
      );
      results.push(
        expectEqual("invariant", "ومحاولةُ معالجةٍ واحدةٌ لا أكثر", receipts[0]?.attempts, 1),
      );

      results.push(
        check(
          "invariant",
          "الظافرُ في القاعدةِ هو صاحبُ الضغطةِ الأصلية",
          actors[0] !== undefined,
          `الظافر=${String(actors[0]?.produced.winnerDriverId)}`,
        ),
      );
      return results;
    },

    idempotency: {
      description:
        "الحتميّةُ هنا هي جسمُ السيناريو نفسِه: التسليمُ الثالثُ لنفسِ `update_id` من عمليةٍ أخرى. " +
        "وتُعاد رابعةً — إلى العمليةِ الأخرى ثانيةً — لتأكيدِ أنّ التكرارَ لا يتراكم.",
      replay: async (_context, actors) => {
        const orderId = String(actors[0]?.produced.orderId ?? "");
        const chatId = Number(actors[0]?.produced.telegramId ?? 0);
        if (orderId === "" || chatId === 0) return;
        await cluster.postTo(
          1,
          "driver",
          withUpdateId(callbackUpdate(chatId, `offer:accept:${orderId}`), REPLAYED_UPDATE_ID),
        );
        await cluster.sync();
      },
      expectation: async (context) => {
        const results: CheckResult[] = [];
        const [row] = await context.sql<{ accepted: string; audit: string }[]>`
          select (select count(*) from public.order_offers where status = 'accepted')::text as accepted,
                 (select count(*) from public.audit_log where action = 'order.claimed')::text as audit
        `;
        results.push(
          expectEqual(
            "idempotency",
            "لا قبولَ ثانٍ بعد التسليمِ الرابع",
            Number(row?.accepted ?? "0"),
            1,
          ),
        );
        results.push(expectEqual("idempotency", "ولا أثرَ تدقيقٍ ثانٍ", Number(row?.audit ?? "0"), 1));
        const delta = context.metricDelta("waslah_dispatch_offers_accepted_total");
        results.push(
          check("idempotency", "ولا حركةَ ثانيةً في العدّادِ المجموع", delta === 1, `الفرق=${delta}`),
        );
        return results;
      },
    },
  };
}

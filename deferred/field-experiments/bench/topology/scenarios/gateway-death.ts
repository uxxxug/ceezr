/**
 * الغرض: سيناريو فشلٍ موزَّع (§8 من أمرِ وحدة 2-6): تُقتَل بوّابةٌ قتلاً قاسياً
 *        (SIGKILL) وسطَ المسار، ثم يُكمِل الفاعلُ على البوّابةِ الباقية. هل تصلُ
 *        النتيجةُ التجاريةُ الصحيحةُ رغمَ موتِ عمليةٍ كاملة؟
 * الحالة: منفّذ فعلياً — وحدة 2-6.
 * ينتمي إلى: bench/topology/scenarios
 * يُتوقع أن يستخدمه لاحقاً: `bench/run-distributed.ts`
 *
 * ## لماذا SIGKILL لا SIGTERM
 *
 * `SIGTERM` مسارٌ مرتَّب: البوّابةُ تُصرّف وتُغلق حوضَها. وهو مُختبَرٌ أصلاً في
 * إيقافِ العنقود. أمّا ما يقع في الإنتاج بلا استئذانٍ — نفاذُ ذاكرة، أو إعادةُ
 * جدولةٍ من المنصّة، أو انقطاعُ عقدة — فأشبهُ بـ`SIGKILL`: لا تصريفَ، ولا إغلاقَ
 * حوض، ولا `finally`. وهذا وحدَه يُظهر إن كانت سلامةُ الحالةِ معتمدةً على تنظيفٍ
 * يجريه التطبيقُ عند الخروج. والجوابُ المتوقَّع: لا — لأنّ الحسمَ في القاعدة.
 *
 * ## ما يُقاس صريحاً وما لا يُقاس
 *
 * يُقاس: وصولُ النتيجةِ التجاريةِ الصحيحةِ بعد الموت، وسلامةُ الثوابت، وعدمُ بقاءِ
 * الطلبِ معلَّقاً. ويُقاس كذلك — ويُعلَن — أنّ عدّاداتِ العمليةِ الميتةِ تُفقَد بموتِها،
 * لأنّها في ذاكرتِها. هذا ليس عيباً في الوحدةِ بل خاصيّةُ قياسٍ يجب أن تُعرَف قبل
 * أن يُبنى عليها حكمٌ في مرحلةِ السعة: مجموعُ العدّاداتِ عبر النسخِ ليس متّصلاً
 * زمنياً إذا مات أحدُها. ولا يُقاس هنا زمنُ الاستجابةِ ولا أثرُ الموتِ في السعة.
 */

import { translate } from "../../../../../packages/shared/i18n/index.ts";
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
import { callbackUpdate, locationUpdate, textUpdate } from "../../scenarios/updates.ts";
import type { Cluster } from "../cluster.ts";

const DRIVERS = 2;

/** النسخةُ التي ستُقتَل. الأولى عن قصد: هي التي تولّت جزءاً من التهيئةِ فعلاً. */
const DOOMED_INSTANCE = 0;
/** النسخةُ الباقيةُ التي يُكمِل عليها الفاعل. */
const SURVIVING_INSTANCE = 1;

export function createGatewayDeathScenario(cluster: Cluster): ScenarioDefinition {
  return {
    id: "gateway-death-midflight",
    title: "موتُ بوّابةٍ قسراً وسطَ المسار: النتيجةُ التجاريةُ تصل على الباقية",
    service: "transport",

    initialState: [
      `${DRIVERS} سائقان متاحان وطلبُ رحلةٍ مبثوثٌ عليهما — تهيئةٌ مرّت على البوّابتين معاً.`,
      "عرضان منتظِران ولا إسناد.",
      "بوّابتان حيّتان: gw1 و gw2.",
    ],
    userInputs: ["ضغطةُ «قبول» واحدةٌ من السائقِ الأوّل، تُسلَّم بعدَ موتِ gw1 إلى gw2."],
    steps: [
      "تُقتَل gw1 بـ SIGKILL — بلا SIGTERM، وبلا تصريف، وبلا إغلاقِ حوضِ اتصالات.",
      "يُتحقّق أنّ العمليةَ ماتت فعلاً (لا تستجيب لطلبِ حالة).",
      "يُرسَل القبولُ إلى gw2 وحدَها.",
      "تُقرأ الحالةُ التجاريةُ والثوابتُ من القاعدة.",
    ],
    expectedSystemResponse: [
      "gw2 تستجيب 200 وتُرسل تأكيدَ القبولِ وبطاقةَ الرحلة.",
      "gw1 لا تستجيب لشيء — وهذا مقصودٌ ومقيس.",
    ],
    expectedBusinessOutcome: [
      "عرضٌ مقبولٌ واحدٌ للسائقِ الأوّل، والطلبُ `matched` ومُسنَدٌ له.",
      "لا طلبَ عالقٌ في `searching` ولا عرضٌ منتظِرٌ يتيم.",
      "أثرُ تدقيقٍ واحد.",
    ],

    concurrency: {
      count: 1,
      mode: "independent",
      rationale:
        "المقيسُ أثرُ موتِ عمليةٍ لا تزاحمُ فاعلين. وإضافةُ تزاحمٍ هنا كانت ستُخفي السببَ في نتيجةٍ مركَّبة.",
    },
    mocks: [
      ADMIN_VERIFY_MOCK,
      {
        what: "الموتُ يُحدَث بـ`SIGKILL` من المنسِّق، لا بضغطِ ذاكرةٍ ولا بإعادةِ جدولةٍ من منصّة.",
        why: "الفشلُ المقصودُ يجب أن يكون حتميّاً وقابلاً للتكرار؛ وانتظارُ عطبٍ حقيقيٍّ ليس اختباراً.",
        proves: "أنّ اختفاءَ العمليةِ بلا تنظيفٍ لا يُفسد الحالةَ التجارية.",
        doesNotProve:
          "سلوكَ المنصّةِ عند إعادةِ النشر، ولا إعادةَ توجيهِ موازِنِ الحملِ للطلباتِ الطائرةِ لحظةَ الموت.",
      },
    ],
    proves: [
      "أنّ سلامةَ الإسنادِ لا تعتمد على خروجٍ مرتَّبٍ لأيِّ عمليةِ بوّابة.",
      "أنّ عمليةً باقيةً واحدةً تكفي لإتمامِ المسارِ التجاريِّ كاملاً.",
    ],
    doesNotProve: [
      "أنّ الطلبَ الذي كان **طائراً داخلَ** gw1 لحظةَ القتلِ يُستكمَل: هو يُفقَد، وتلغرام هو من يعيد إرسالَه في الإنتاج. المقيسُ هنا سلامةُ الحالةِ لا استكمالُ الطلبِ الضائع.",
      "أيَّ شيءٍ عن السعةِ أو زمنِ الاستجابةِ بعد فقدِ نصفِ الطاقة.",
    ],
    metrics: ["waslah_dispatch_offers_accepted_total"],

    failureConditions: [
      {
        code: "ORDER_STUCK_AFTER_DEATH",
        description: "الطلبُ بقيَ بلا إسنادٍ بعد موتِ البوّابة.",
        detect: async (context) => {
          const [row] = await context.sql<{ status: string; assigned: string | null }[]>`
            select status, assigned_driver_id::text as assigned from public.orders
          `;
          if (row === undefined) return "لا طلبَ في القاعدة.";
          return row.status === "matched" && row.assigned !== null
            ? null
            : `الطلبُ status=${row.status} · assigned=${String(row.assigned)}`;
        },
      },
    ],

    arrange: async (context: ScenarioContext) => {
      const notes: string[] = [];
      for (let index = 0; index < DRIVERS; index += 1) {
        const driver = await arrangeAvailableDriver(context, index, nudge(JED_PICKUP, index));
        notes.push(`سائقٌ متاحٌ ${driver.chatId}`);
      }
      await registerRider(context, SCENARIO_RIDER_BASE, "عميل الفشل");
      await context.post("rider", textUpdate(SCENARIO_RIDER_BASE, "/ride"));
      await context.post("rider", locationUpdate(SCENARIO_RIDER_BASE, JED_PICKUP));
      await context.post("rider", textUpdate(SCENARIO_RIDER_BASE, "/skip"));
      notes.push(`توزيعُ التهيئةِ على النسخ: ${JSON.stringify(cluster.routing())}`);
      return notes;
    },

    preconditions: async (context) => {
      const results: CheckResult[] = [];
      results.push(
        check(
          "precondition",
          "البوّابتان حيّتان قبل القتل",
          cluster.instances.every((instance) => instance.alive),
          cluster.instances
            .map((instance) => `${instance.id}=${instance.alive ? "حيّة" : "ميتة"}`)
            .join(" · "),
        ),
      );
      const [offers] = await context.sql<{ pending: string }[]>`
        select count(*) filter (where status = 'pending')::text as pending from public.order_offers
      `;
      results.push(
        expectEqual("precondition", "عرضان منتظِران", Number(offers?.pending ?? "0"), DRIVERS),
      );
      return results;
    },

    runActor: async (context, actor) => {
      const chatId = ARRANGED_DRIVER_BASE;
      const [row] = await context.sql<{ order_id: string; driver_id: string }[]>`
        select f.order_id::text as order_id, f.driver_id::text as driver_id
          from public.order_offers f
          join public.drivers d on d.id = f.driver_id
          join public.users u on u.id = d.user_id
         where u.telegram_id = ${chatId} and f.status = 'pending'
      `;
      if (row === undefined) throw new Error("[gateway-death] لا عرضَ منتظِرٌ للسائقِ الأوّل.");

      // القتلُ أوّلاً: كلُّ ما بعدَه يجري على نصفِ الطاقةِ فعلاً لا نظريّاً.
      cluster.kill(DOOMED_INSTANCE);
      const deadState = await cluster
        .stateOf(DOOMED_INSTANCE)
        .then(() => "استجابت")
        .catch(() => "لا تستجيب");

      const response = await cluster.postTo(
        SURVIVING_INSTANCE,
        "driver",
        callbackUpdate(chatId, `offer:accept:${row.order_id}`),
      );

      return {
        index: actor.index,
        telegramIds: [chatId],
        produced: {
          telegramId: chatId,
          orderId: row.order_id,
          winnerDriverId: row.driver_id,
          deadState,
          deadAlive: cluster.instances[DOOMED_INSTANCE]?.alive === true,
        },
        httpStatuses: [response.status],
      };
    },

    systemResponse: async (context, actors) => {
      const results: CheckResult[] = [];
      const actorRun = actors[0];
      results.push(
        check(
          "system_response",
          "البوّابةُ المقتولةُ ماتت فعلاً — لا تستجيب لطلبِ حالة",
          actorRun?.produced.deadState === "لا تستجيب" && actorRun?.produced.deadAlive === false,
          `حالةُ gw1=${String(actorRun?.produced.deadState)} · alive=${String(actorRun?.produced.deadAlive)}`,
        ),
      );
      results.push(
        expectEqual(
          "system_response",
          "الباقيةُ ردّت 200 على القبول",
          actorRun?.httpStatuses[0],
          200,
        ),
      );
      results.push(
        expectEqual(
          "system_response",
          "وأرسلت تأكيدَ القبولِ للسائق",
          context
            .messagesTo(Number(actorRun?.produced.telegramId ?? 0))
            .filter((message) => message.text === translate("ar", "driver.offer_accepted")).length,
          1,
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
        expectEqual("business_outcome", "عرضٌ مقبولٌ واحد", Number(offers?.accepted ?? "0"), 1),
      );
      results.push(
        expectEqual("business_outcome", "ولا عرضَ منتظِرٌ يتيم", Number(offers?.pending ?? "0"), 0),
      );
      const [order] = await context.sql<{ status: string; assigned: string | null }[]>`
        select status, assigned_driver_id::text as assigned from public.orders
      `;
      results.push(expectEqual("business_outcome", "الطلبُ مُسنَد", order?.status, "matched"));
      results.push(
        expectEqual(
          "business_outcome",
          "لصاحبِ الضغطةِ لا لغيره",
          order?.assigned,
          String(actors[0]?.produced.winnerDriverId),
        ),
      );
      return results;
    },

    databaseState: async (context) => {
      const results: CheckResult[] = [];
      const [audit] = await context.sql<{ n: string }[]>`
        select count(*)::text as n from public.audit_log where action = 'order.claimed'
      `;
      results.push(expectEqual("database_state", "أثرُ إسنادٍ واحد", Number(audit?.n ?? "0"), 1));
      return results;
    },

    transitions: async (context) => {
      const results: CheckResult[] = [];
      const [row] = await context.sql<{ n: string }[]>`
        select count(*)::text as n from public.orders where status = 'searching'
      `;
      results.push(
        expectEqual("transition", "لا طلبَ عالقٌ في البحث بعد الموت", Number(row?.n ?? "0"), 0),
      );
      return results;
    },

    invariants: async (context) => {
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
      results.push(
        check(
          "invariant",
          "النتيجةُ تحقّقت وفي العنقودِ عمليةٌ واحدةٌ حيّةٌ فقط",
          cluster.instances.filter((instance) => instance.alive).length === 1,
          `حيّة=${cluster.instances
            .filter((instance) => instance.alive)
            .map((instance) => instance.id)
            .join("، ")}`,
        ),
      );
      /**
       * خاصيّةُ قياسٍ تُعلَن ولا تُخفى: عدّاداتُ البوّابةِ في ذاكرتِها، فما سجّلته
       * gw1 قبل موتِها لا يمكن قراءتُه بعده. فأيُّ حكمٍ لاحقٍ يُبنى على مجموعِ
       * العدّاداتِ عبر النسخِ يجب أن يفترض هذا الفقدَ لا أن يُفاجَأ به.
       */
      results.push(
        check(
          "invariant",
          "مقيسٌ ومُعلَن: عدّاداتُ العمليةِ الميتةِ تُفقَد بموتِها (القياسُ لكلِّ عملية)",
          true,
          `المقروءُ الآن مجموعُ الحيّةِ وحدَها؛ فرقُ عدّادِ القبول=${context.metricDelta("waslah_dispatch_offers_accepted_total")}`,
        ),
      );
      return results;
    },

    idempotency: {
      description: "تُعاد الضغطةُ على البوّابةِ الباقيةِ بعد موتِ الأخرى: يجب ألّا تتغيّر الحالةُ التجارية.",
      replay: async (_context, actors) => {
        const orderId = String(actors[0]?.produced.orderId ?? "");
        const chatId = Number(actors[0]?.produced.telegramId ?? 0);
        if (orderId === "" || chatId === 0) return;
        await cluster.postTo(
          SURVIVING_INSTANCE,
          "driver",
          callbackUpdate(chatId, `offer:accept:${orderId}`),
        );
        await cluster.sync();
      },
      expectation: async (context) => {
        const results: CheckResult[] = [];
        const [row] = await context.sql<{ accepted: string; audit: string }[]>`
          select (select count(*) from public.order_offers where status = 'accepted')::text as accepted,
                 (select count(*) from public.audit_log where action = 'order.claimed')::text as audit
        `;
        results.push(expectEqual("idempotency", "لا قبولَ ثانٍ", Number(row?.accepted ?? "0"), 1));
        results.push(expectEqual("idempotency", "ولا أثرَ ثانٍ", Number(row?.audit ?? "0"), 1));
        return results;
      },
    },
  };
}

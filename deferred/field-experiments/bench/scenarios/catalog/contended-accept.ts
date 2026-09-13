/**
 * الغرض: سيناريو عمل — سائقون يتسابقون على **طلبٍ واحد**: الظافرُ واحدٌ لا أكثر ولا أقلّ.
 * الحالة: منفّذ فعلياً — وحدة 2-5.
 * ينتمي إلى: bench/scenarios/catalog
 * يُتوقع أن يستخدمه لاحقاً: مشغّلُ السيناريوهات، وقياسُ التزاحمِ عند رفعِ عددِ السائقين.
 * ملاحظات مستقبلية: عند إضافةِ إلغاءِ الإسناد، يُضاف سيناريو تسابقٍ على الإلغاءِ بنفسِ النمط.
 *
 * وهذا السيناريوُ هو أخطرُ ما في المنصّة تجاريّاً: إسنادٌ مزدوجٌ يعني راكباً واحداً
 * وسائقين يتوجّهان إليه، وإسنادٌ مفقودٌ يعني طلباً بلا سائقٍ وسائقاً ظنّ أنّه ظفر.
 * فلذلك يُقاس هنا بالفرقِ في العدّادِ وبعددِ الصفوفِ وبعددِ الرسائل — ثلاثةُ شواهدَ
 * على واقعةٍ واحدة، لا شاهدٌ واحدٌ يُصدَّق.
 */

import { translate } from "../../../../../packages/shared/i18n/index.ts";
import {
  type ActorRun,
  type CheckResult,
  check,
  expectEqual,
  type ScenarioContext,
  type ScenarioDefinition,
} from "../contract.ts";
import { callbackUpdate, locationUpdate, textUpdate } from "../updates.ts";
import {
  ADMIN_VERIFY_MOCK,
  ARRANGED_DRIVER_BASE,
  arrangeAvailableDriver,
  JED_PICKUP,
  nudge,
  registerRider,
  SCENARIO_RIDER_BASE,
} from "./support.ts";

const RACING_DRIVERS = 4;

const singleOrderId = async (context: ScenarioContext): Promise<string> => {
  const [row] = await context.sql<{ id: string }[]>`select id from public.orders`;
  return row?.id ?? "";
};

const chatIdOf = (actor: ActorRun): number => Number(actor.produced.telegramId);

export const contendedAcceptScenario: ScenarioDefinition = {
  id: "contended-accept",
  title: "تسابقُ سائقين على طلبٍ واحد: ظافرٌ واحدٌ بالضبط",
  service: "transport",

  initialState: [
    `${RACING_DRIVERS} سائقين مسجَّلين بالمسار الحقيقيّ، موثَّقين، متاحين بمواقعَ متفاوتةِ القرب.`,
    "عميلٌ واحدٌ مسجَّلٌ طلب رحلةً بموقعٍ حقيقيّ.",
    "طلبٌ واحدٌ في حالةِ البحث، وعروضٌ منتظِرةٌ لدى السائقين.",
  ],
  userInputs: ["ضغطُ زرِّ «قبول» على بطاقةِ العرض (callback: offer:accept:<orderId>)"],
  steps: [
    "تُهيَّأ الحالةُ: سائقون متاحون، وعميلٌ طلب رحلةً فبُثَّ الطلبُ عليهم.",
    "كلُّ سائقٍ يضغط «قبول» على **نفسِ** الطلب، والطلباتُ تُطلَق معاً فتتداخل في القاعدة.",
    "تُقرأ النتيجةُ بعد اكتمالِ التسابق كلِّه لا في وسطه.",
  ],
  expectedSystemResponse: [
    "رسالةُ `driver.offer_accepted` لسائقٍ واحدٍ فقط، تتبعُها بطاقةُ الرحلةِ ودبّوسُ الموقع.",
    "رسالةُ `driver.offer_taken` لكلِّ سائقٍ خسر — لا صمتٌ ولا خطأٌ عامّ.",
  ],
  expectedBusinessOutcome: [
    "الطلبُ صار `matched` ومُسنَداً إلى السائقِ الظافرِ نفسِه لا غيره.",
    "عرضٌ واحدٌ بالضبط حالتُه `accepted`، وبقيّةُ العروضِ لم تبقَ منتظِرة.",
    "عدّادُ العروضِ المقبولةِ تحرّك بمقدارِ واحدٍ بالضبط — لا بعددِ المتسابقين.",
    "أثرٌ مدقَّقٌ واحدٌ لإسنادِ الطلب في `audit_log`.",
  ],

  concurrency: {
    count: RACING_DRIVERS,
    mode: "contended",
    rationale:
      "أربعةُ سائقين على موردٍ واحد: العددُ صغيرٌ (§15) لأن المقصودَ ليس السعةَ بل الذرّية، " +
      "وأربعةٌ تكفي لكشفِ الإسنادِ المزدوجِ الذي لا يظهر باثنين في كلِّ تشغيل.",
  },
  mocks: [ADMIN_VERIFY_MOCK],
  proves: [
    "أنّ القبولَ ذرّيٌّ فعلاً على PostgreSQL: ظافرٌ واحدٌ مهما تداخل وصولُ الطلبات.",
    "أنّ الإسنادَ يقع للسائقِ الذي قُبِل عرضُه — لا لغيره ولا معلَّقاً.",
    "أنّ الخاسرَ يُبلَّغ صراحةً بأنّ الطلبَ أُخِذ، فلا يبقى منتظِراً.",
    "أنّ العدّادَ يعكس الواقعةَ مرّةً واحدةً كما تعكسُها القاعدة.",
  ],
  doesNotProve: [
    "الذرّيةَ تحت تزاحمٍ كبير: أربعةُ متسابقين ليسوا حملاً، والقاعدةُ محلّيةٌ ذاتُ حوضٍ صغير.",
    "الذرّيةَ عبرَ عملياتٍ أو خوادمَ متعدّدة — كلُّ الطلباتِ هنا من عمليةٍ واحدة، والضمانُ في القاعدة لكنّ القياسَ لم يعبر الشبكة.",
    "أنّ رسائلَ الظفرِ والحرمانِ وصلت السائقين عبر تلغرام.",
  ],
  metrics: ["waslah_dispatch_offers_accepted_total", "waslah_dispatch_offers_sent_total"],

  failureConditions: [
    {
      code: "DOUBLE_ASSIGNMENT",
      description: "أكثرُ من عرضٍ مقبولٍ لنفسِ الطلب — راكبٌ واحدٌ وسائقان يتوجّهان إليه.",
      detect: async (context) => {
        const [row] = await context.sql<{ n: string }[]>`
          select count(*)::text as n from public.order_offers where status = 'accepted'
        `;
        const accepted = Number(row?.n ?? "0");
        return accepted <= 1 ? null : `${accepted} عرضاً مقبولاً على طلبٍ واحد.`;
      },
    },
    {
      code: "LOST_ASSIGNMENT",
      description: "لا ظافرَ أصلاً: تسابقٌ انتهى بلا إسنادٍ والطلبُ ما زال يبحث.",
      detect: async (context) => {
        const [row] = await context.sql<{ status: string; assigned: string | null }[]>`
          select status, assigned_driver_id as assigned from public.orders
        `;
        if (row === undefined) return "لا طلبَ في القاعدة أصلاً.";
        return row.status === "matched" && row.assigned !== null
          ? null
          : `الطلبُ status=${row.status} assigned=${String(row.assigned)} بعد تسابقِ ${RACING_DRIVERS} سائقين.`;
      },
    },
    {
      code: "ASSIGNMENT_MISMATCH",
      description: "الطلبُ مُسنَدٌ لسائقٍ غيرِ صاحبِ العرضِ المقبول.",
      detect: async (context) => {
        const [row] = await context.sql<{ n: string }[]>`
          select count(*)::text as n
            from public.orders o
            join public.order_offers f on f.order_id = o.id and f.status = 'accepted'
           where o.assigned_driver_id is distinct from f.driver_id
        `;
        const mismatched = Number(row?.n ?? "0");
        return mismatched === 0 ? null : `${mismatched} طلباً مُسنَداً لغيرِ صاحبِ العرضِ المقبول.`;
      },
    },
    {
      code: "SILENT_LOSER",
      description: "سائقٌ خسر ولم يُبلَّغ — يبقى ظانّاً أنّ عرضَه قائم.",
      detect: async (context, actors) => {
        const winnerRows = await context.sql<{ telegram_id: string }[]>`
          select u.telegram_id::text as telegram_id
            from public.order_offers f
            join public.drivers d on d.id = f.driver_id
            join public.users u on u.id = d.user_id
           where f.status = 'accepted'
        `;
        const winners = new Set(winnerRows.map((row) => row.telegram_id));
        const silent: number[] = [];
        for (const actor of actors) {
          const chatId = chatIdOf(actor);
          if (winners.has(String(chatId))) continue;
          if (actor.produced.pressed !== true) continue;
          const texts = context.messagesTo(chatId).map((message) => message.text);
          if (!texts.includes(translate("ar", "driver.offer_taken"))) silent.push(chatId);
        }
        return silent.length === 0 ? null : `سائقون خسروا بلا إبلاغ: ${silent.join(", ")}`;
      },
    },
  ],

  arrange: async (context) => {
    const notes: string[] = [];
    for (let index = 0; index < RACING_DRIVERS; index += 1) {
      const driver = await arrangeAvailableDriver(context, index, nudge(JED_PICKUP, index));
      notes.push(`سائقٌ متسابقٌ ${driver.chatId} (سائق=${driver.driverId.slice(0, 8)}…)`);
    }

    const riderChat = SCENARIO_RIDER_BASE;
    await registerRider(context, riderChat, "عميل التسابق");
    await context.post("rider", textUpdate(riderChat, "/ride"));
    await context.post("rider", locationUpdate(riderChat, JED_PICKUP));
    await context.post("rider", textUpdate(riderChat, "/skip"));

    const [offers] = await context.sql<{ n: string }[]>`
      select count(*)::text as n from public.order_offers where status = 'pending'
    `;
    notes.push(`عميلٌ ${riderChat} طلب رحلةً فبُثَّت على ${offers?.n ?? "0"} سائقاً`);
    return notes;
  },

  preconditions: async (context) => {
    const results: CheckResult[] = [];

    const [orders] = await context.sql<{ n: string; searching: string }[]>`
      select count(*)::text as n,
             count(*) filter (where status = 'searching')::text as searching
        from public.orders
    `;
    results.push(expectEqual("precondition", "طلبٌ واحدٌ في القاعدة", Number(orders?.n ?? "0"), 1));
    results.push(
      expectEqual("precondition", "والطلبُ في حالةِ البحث", Number(orders?.searching ?? "0"), 1),
    );

    const [offers] = await context.sql<{ n: string; pending: string }[]>`
      select count(*)::text as n,
             count(*) filter (where status = 'pending')::text as pending
        from public.order_offers
    `;
    const total = Number(offers?.n ?? "0");
    results.push(
      check(
        "precondition",
        "عرضان على الأقلِّ منتظِران — وإلّا فلا تسابقَ يُقاس",
        total >= 2 && Number(offers?.pending ?? "0") === total,
        `عروض=${total} · منتظِرة=${offers?.pending ?? "?"} · متسابقون=${RACING_DRIVERS}`,
      ),
    );

    const [assigned] = await context.sql<{ n: string }[]>`
      select count(*)::text as n from public.orders where assigned_driver_id is not null
    `;
    results.push(
      expectEqual("precondition", "لا إسنادَ قبل التسابق", Number(assigned?.n ?? "0"), 0),
    );
    return results;
  },

  runActor: async (context, actor) => {
    const chatId = ARRANGED_DRIVER_BASE + actor.index;
    const orderId = await singleOrderId(context);

    /**
     * يضغط «قبول» من كان له عرضٌ منتظِرٌ فعلاً — لا كلُّ سائق. وسائقٌ يضغط قبولاً
     * على طلبٍ لم يُعرَض عليه حالةٌ أخرى (رفضُ صلاحية) لها سيناريوها، وخلطُها هنا
     * كان سيجعل «الخاسر» غامضاً: هل خسر التسابق أم لم يُدعَ إليه؟
     */
    const [own] = await context.sql<{ id: string }[]>`
      select f.id from public.order_offers f
        join public.drivers d on d.id = f.driver_id
        join public.users u on u.id = d.user_id
       where u.telegram_id = ${chatId} and f.order_id = ${orderId}
    `;
    if (own === undefined || orderId === "") {
      return {
        index: actor.index,
        telegramIds: [chatId],
        produced: { telegramId: chatId, pressed: false, orderId },
        httpStatuses: [],
      };
    }

    const response = await context.post(
      "driver",
      callbackUpdate(chatId, `offer:accept:${orderId}`),
    );
    return {
      index: actor.index,
      telegramIds: [chatId],
      produced: { telegramId: chatId, pressed: true, orderId },
      httpStatuses: [response.status],
    };
  },

  systemResponse: async (context, actors) => {
    const results: CheckResult[] = [];
    const pressed = actors.filter((actor) => actor.produced.pressed === true);
    const texts = context
      .allMessages()
      .filter((message) => message.location === undefined)
      .map((message) => message.text);

    results.push(
      expectEqual(
        "system_response",
        "رسالةُ قبولٍ واحدةٌ فقط بين كلِّ المتسابقين",
        texts.filter((value) => value === translate("ar", "driver.offer_accepted")).length,
        1,
      ),
    );
    results.push(
      expectEqual(
        "system_response",
        "كلُّ خاسرٍ أُبلِغ بأنّ الطلبَ أُخِذ",
        texts.filter((value) => value === translate("ar", "driver.offer_taken")).length,
        Math.max(0, pressed.length - 1),
      ),
    );
    results.push(
      expectEqual(
        "system_response",
        "بطاقةُ الرحلةِ للظافرِ وحده",
        texts.filter((value) => value.includes(translate("ar", "driver.trip_header"))).length,
        1,
      ),
    );
    results.push(
      expectEqual(
        "system_response",
        "دبّوسُ موقعٍ واحدٌ — لا رؤيةَ عبرَ الرحلات",
        context.allMessages().filter((message) => message.location !== undefined).length,
        1,
      ),
    );
    return results;
  },

  businessOutcome: async (context, actors) => {
    const results: CheckResult[] = [];

    const [order] = await context.sql<{ status: string; assigned: string | null }[]>`
      select status, assigned_driver_id as assigned from public.orders
    `;
    results.push(
      expectEqual("business_outcome", "الطلبُ صار مُسنَداً (matched)", order?.status, "matched"),
    );
    results.push(
      check(
        "business_outcome",
        "وله سائقٌ مُسنَدٌ صريح",
        order?.assigned !== null && order?.assigned !== undefined,
        `assigned_driver_id=${String(order?.assigned)}`,
      ),
    );

    const [accepted] = await context.sql<{ n: string; driver: string | null }[]>`
      select count(*)::text as n, min(driver_id::text) as driver
        from public.order_offers where status = 'accepted'
    `;
    results.push(
      expectEqual(
        "business_outcome",
        "عرضٌ مقبولٌ واحدٌ بالضبط رغم تسابقِ الجميع",
        Number(accepted?.n ?? "0"),
        1,
      ),
    );
    results.push(
      check(
        "business_outcome",
        "الطلبُ مُسنَدٌ لصاحبِ العرضِ المقبولِ نفسِه",
        order?.assigned !== null && order?.assigned === accepted?.driver,
        `المُسنَد=${String(order?.assigned)} · صاحبُ العرضِ المقبول=${String(accepted?.driver)}`,
      ),
    );

    /**
     * العدّادُ شاهدٌ ثالثٌ على الواقعةِ نفسِها: صفوفُ القاعدة تقول «واحد»، والرسائلُ
     * تقول «واحد»، فإن قال العدّادُ «أربعة» فالعطبُ في الرصدِ لا في الإسناد — وذاك
     * عطبٌ يجب أن يُرى، لأن لوحاتَ المراقبةِ تُقرأ منه لا من الصفوف.
     */
    const acceptedDelta = context.metricDelta("waslah_dispatch_offers_accepted_total");
    results.push(
      check(
        "business_outcome",
        "عدّادُ القبولِ تحرّك واحداً لا بعددِ المتسابقين",
        acceptedDelta === 1,
        `الفرق=${acceptedDelta} · المتسابقون الذين ضغطوا=${actors.filter((actor) => actor.produced.pressed === true).length}`,
      ),
    );
    return results;
  },

  databaseState: async (context) => {
    const results: CheckResult[] = [];

    const [offers] = await context.sql<{ total: string; pending: string; accepted: string }[]>`
      select count(*)::text as total,
             count(*) filter (where status = 'pending')::text as pending,
             count(*) filter (where status = 'accepted')::text as accepted
        from public.order_offers
    `;
    results.push(
      expectEqual("database_state", "لا عرضَ بقي منتظِراً", Number(offers?.pending ?? "0"), 0),
    );
    results.push(
      expectEqual("database_state", "عرضٌ مقبولٌ واحد", Number(offers?.accepted ?? "0"), 1),
    );

    const [audit] = await context.sql<{ n: string }[]>`
      select count(*)::text as n from public.audit_log where action = 'order.claimed'
    `;
    results.push(
      expectEqual("database_state", "أثرٌ مدقَّقٌ واحدٌ للإسناد", Number(audit?.n ?? "0"), 1),
    );
    return results;
  },

  transitions: async (context) => {
    const results: CheckResult[] = [];
    const [order] = await context.sql<{ status: string }[]>`select status from public.orders`;
    results.push(
      check(
        "transition",
        "الانتقالُ: searching → matched مرّةً واحدة",
        order?.status === "matched",
        `الحالةُ النهائية=${String(order?.status)}`,
      ),
    );

    const [claims] = await context.sql<{ n: string }[]>`
      select count(*)::text as n from public.audit_log where action like 'order.claim%'
    `;
    results.push(
      check(
        "transition",
        "لا انتقالَ ثانٍ: أثرُ إسنادٍ واحدٌ لا أكثر",
        Number(claims?.n ?? "0") === 1,
        `آثارُ إسناد=${claims?.n ?? "?"}`,
      ),
    );
    return results;
  },

  invariants: async (context, actors) => {
    const results: CheckResult[] = [];

    const [rows] = await context.sql<{ n: string }[]>`
      select count(*)::text as n from public.orders
       where status = 'matched' and assigned_driver_id is null
    `;
    results.push(expectEqual("invariant", "لا طلبَ مُسنَدٌ بلا سائق", Number(rows?.n ?? "0"), 0));

    const [multi] = await context.sql<{ n: string }[]>`
      select count(*)::text as n from (
        select order_id from public.order_offers
         where status = 'accepted' group by order_id having count(*) > 1
      ) as many
    `;
    results.push(
      expectEqual("invariant", "لا طلبَ له أكثرُ من عرضٍ مقبول", Number(multi?.n ?? "0"), 0),
    );

    const [driverOrders] = await context.sql<{ n: string }[]>`
      select count(*)::text as n from (
        select assigned_driver_id from public.orders
         where assigned_driver_id is not null
         group by assigned_driver_id having count(*) > 1
      ) as many
    `;
    results.push(
      expectEqual(
        "invariant",
        "لا سائقَ أُسنِد إليه أكثرُ من طلبٍ في هذا التشغيل",
        Number(driverOrders?.n ?? "0"),
        0,
      ),
    );

    results.push(
      check(
        "invariant",
        "كلُّ المتسابقين ضغطوا فعلاً (وإلّا فالتسابقُ أصغرُ مما يُظنّ)",
        actors.every((actor) => actor.produced.pressed === true),
        `ضغطوا=${actors.filter((actor) => actor.produced.pressed === true).length} من ${actors.length}`,
      ),
    );
    return results;
  },

  idempotency: {
    description:
      "الظافرُ يضغط «قبول» مرّةً ثانيةً على نفسِ الطلب (إعادةُ محاولةٍ من تلغرام أو ضغطٌ مزدوج): " +
      "لا إسنادَ ثانٍ، ولا عرضَ مقبولٌ ثانٍ، ولا حركةَ ثانيةً في العدّاد، ولا أثرَ تدقيقٍ ثانٍ.",
    replay: async (context) => {
      const [winner] = await context.sql<{ telegram_id: string; order_id: string }[]>`
        select u.telegram_id::text as telegram_id, f.order_id::text as order_id
          from public.order_offers f
          join public.drivers d on d.id = f.driver_id
          join public.users u on u.id = d.user_id
         where f.status = 'accepted'
      `;
      if (winner === undefined) return;
      await context.post(
        "driver",
        callbackUpdate(Number(winner.telegram_id), `offer:accept:${winner.order_id}`),
      );
    },
    expectation: async (context) => {
      const results: CheckResult[] = [];

      const [offers] = await context.sql<{ accepted: string }[]>`
        select count(*) filter (where status = 'accepted')::text as accepted
          from public.order_offers
      `;
      results.push(
        expectEqual(
          "idempotency",
          "الإعادةُ لم تُنشئ قبولاً ثانياً",
          Number(offers?.accepted ?? "0"),
          1,
        ),
      );

      const [audit] = await context.sql<{ n: string }[]>`
        select count(*)::text as n from public.audit_log where action = 'order.claimed'
      `;
      results.push(expectEqual("idempotency", "ولا أثرَ تدقيقٍ ثانياً", Number(audit?.n ?? "0"), 1));

      const delta = context.metricDelta("waslah_dispatch_offers_accepted_total");
      results.push(
        check(
          "idempotency",
          "ولا حركةَ ثانيةً في عدّادِ القبول",
          delta === 1,
          `الفرقُ بعد الإعادة=${delta}`,
        ),
      );
      return results;
    },
  },
};

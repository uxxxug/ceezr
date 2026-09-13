/**
 * الغرض: سيناريو عمل — تسجيلُ سائقٍ جديدٍ من `/start` حتى بدءِ تجربتِه المجانية،
 *        بفاعلين مستقلّين متزامنين.
 * الحالة: منفّذ فعلياً — وحدة 2-5.
 * ينتمي إلى: bench/scenarios/catalog
 * يُتوقع أن يستخدمه لاحقاً: مشغّلُ السيناريوهات، وقياسُ الحمل على مسار التسجيل.
 * ملاحظات مستقبلية: عند تفعيل لوحةِ الإدارة، يُضاف سيناريوٌ ثانٍ للتحقّق الإداريّ
 *                   بدلاً من `update` مباشرٍ في سيناريو التوافر.
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
import { callbackUpdate, contactUpdate, photoUpdate, textUpdate } from "../updates.ts";

/**
 * نطاقُ معرّفات هذا السيناريو: فوق حدِّ ملكيّةِ القياس (700,000) وفوق نطاقِ البذر
 * بمسافةٍ واسعة، فلا يتراكب مع سائقٍ مبذورٍ ولا يُقارب معرّفاً حقيقياً.
 */
const CHAT_BASE = 900_000;

const fullNameOf = (index: number): string => `سائق سيناريو ${index + 1}`;
const phoneOf = (index: number): string => `05${String(30_000_000 + index)}`;
const normalizedPhoneOf = (index: number): string => `+9665${String(30_000_000 + index)}`;
const nationalIdOf = (index: number): string => `2${String(100_000_000 + index)}`;
const plateOf = (index: number): string => `أ ب ج ${String(1000 + index)}`;

const cityNameOf = async (context: ScenarioContext): Promise<string> => {
  const [row] = await context.sql<{ name_ar: string }[]>`
    select name_ar from public.cities where id = ${context.cityId}
  `;
  if (row === undefined) throw new Error("[scenario/driver-onboarding] المدينة غير موجودة.");
  return row.name_ar;
};

const chatIdsOf = (actors: readonly ActorRun[]): readonly number[] =>
  actors.map((actor) => Number(actor.produced.telegramId));

/** يقرأ عدّاً واحداً من استعلامٍ يعيد `n` نصّاً — والنصُّ لأن `bigint` لا يُمثّل بأمانٍ في JS. */
const scalar = async (rows: Promise<{ n: string }[]>): Promise<number> =>
  Number((await rows)[0]?.n ?? "0");

export const driverOnboardingScenario: ScenarioDefinition = {
  id: "driver-onboarding",
  title: "تسجيلُ سائقٍ جديد حتى بدءِ التجربة المجانية",
  service: "subscription",

  initialState: [
    "قاعدةُ قياسٍ معزولةٌ مطبَّقٌ عليها كلُّ الترحيلات، والجداولُ التشغيليةُ فارغة.",
    "مدينةٌ واحدةٌ مُفعَّلةٌ بقروباتها الثلاثة (قيد cities_active_requires_groups).",
    "الإعدادُ `trial_days` موجودٌ لهذه المدينة في `platform_settings`.",
    "لا مستخدِمَ ولا سائقَ ولا مشتركاً في القاعدة قبل التشغيل.",
  ],
  userInputs: [
    "/start",
    "الاسمُ الكامل (نصّ)",
    "جهةُ الاتصال (رقمُ الجوال عبر زرّ تلغرام)",
    "اختيارُ المدينة (زرّ)",
    "اختيارُ الخدمة: نقل (زرّ)",
    "اختيارُ نوع المركبة: سيدان (زرّ)",
    "رقمُ اللوحة (نصّ)",
    "رقمُ الهوية (نصّ)",
    "صورةُ الرخصة (صورة)",
  ],
  steps: [
    "يُرسل السائقُ /start إلى بوت السائقين عبر الويبهوك الحقيقي.",
    "يمرّ في حوارِ التسجيل خطوةً خطوة بمدخلاتِه التسع.",
    "يُنشئ النظامُ الهويّةَ والسائقَ والقدرةَ ثمّ يبدأ التجربةَ المجانية.",
    "كلُّ الفاعلين يُطلَقون معاً، كلٌّ على معرّفِه وهويّتِه ولوحتِه.",
  ],
  expectedSystemResponse: [
    "رسالةُ `driver.registered` باسمِ السائقِ ومدينتِه.",
    "رسالةُ `driver.trial_started` بعددِ أيامِ التجربة المأخوذِ من `platform_settings` لا من ثابتٍ في الكود.",
  ],
  expectedBusinessOutcome: [
    "لكلِّ سائقٍ حسابٌ واحدٌ بانتظارِ تحقّقِ الإدارة (`pending`) — لا موثَّقٌ تلقائياً.",
    "لكلِّ سائقٍ مشتركٌ واحدٌ حالتُه `trialing` تنتهي بعد `trial_days` يوماً.",
    "لكلِّ سائقٍ قدرةٌ واحدةٌ مفعَّلةٌ على خدمةِ النقل.",
    "لا سائقَ متاحٌ لاستقبالِ الطلبات قبل تحقّقِ الإدارة.",
  ],

  concurrency: {
    count: 10,
    mode: "independent",
    rationale:
      "عشرةُ فاعلين مستقلّين: عددٌ صغيرٌ مقصودٌ (§15 — لا حملَ كبيرٌ في هذه الوحدة) يكفي لكشفِ " +
      "التصادمِ غيرِ المقصود بين تسجيلاتٍ متزامنة (هويّةٌ مشتركة، لوحةٌ مكرّرة، مشتركٌ مزدوج) " +
      "ولا يُدّعى أنّه قياسُ سعة.",
  },
  mocks: [],
  proves: [
    "أنّ مسارَ التسجيلِ الحقيقيَّ كاملاً (HTTP → سرُّ الويبهوك → المُوجِّه → الحوار → الحالة → RPC → PostgreSQL) يُنتج نتيجةَ العملِ الصحيحة.",
    "أنّ عشرةَ تسجيلاتٍ متزامنةً لا تتداخل: كلُّ سائقٍ بهويّتِه ومشتركِه وقدرتِه.",
    "أنّ مدّةَ التجربةِ تُقرأ من `platform_settings` — لا ثابتٌ في الكود.",
    "أنّ إعادةَ إرسالِ آخِرِ تحديثٍ لا تُنشئ سائقاً ثانياً ولا مشتركاً ثانياً.",
  ],
  doesNotProve: [
    "سعةَ التسجيلِ في الإنتاج: عشرةُ فاعلين ليسوا حملاً، والناقلُ مزدوجٌ والقاعدةُ محلّية.",
    "أنّ رسائلَ التسجيل وصلت السائقَ فعلاً عبر تلغرام.",
    "سلوكَ التسجيلِ عند تعارضِ لوحةٍ أو هويّةٍ مكرّرةٍ بين سائقين — ذاك سيناريو رفضٍ منفصلٌ لم يُكتَب بعد.",
  ],
  metrics: ["waslah_telegram_messages_sent_total"],

  failureConditions: [
    {
      code: "DUPLICATE_DRIVER",
      description: "أكثرُ من صفِّ سائقٍ لمعرّفِ تلغرام واحد.",
      detect: async (context) => {
        const [row] = await context.sql<{ n: string }[]>`
          select count(*)::text as n from (
            select u.telegram_id from public.drivers d
              join public.users u on u.id = d.user_id
             group by u.telegram_id having count(*) > 1
          ) as duplicated
        `;
        const duplicates = Number(row?.n ?? "0");
        return duplicates === 0 ? null : `${duplicates} معرّفَ تلغرام له أكثرُ من سائق.`;
      },
    },
    {
      code: "PARTIAL_REGISTRATION",
      description: "هويّةٌ بدورِ سائقٍ بلا صفِّ سائقٍ يقابلها — تسجيلٌ نصفُه في القاعدة.",
      detect: async (context) => {
        const [row] = await context.sql<{ n: string }[]>`
          select count(*)::text as n from public.users u
           where u.role = 'driver'
             and not exists (select 1 from public.drivers d where d.user_id = u.id)
        `;
        const orphans = Number(row?.n ?? "0");
        return orphans === 0 ? null : `${orphans} هويّةَ سائقٍ بلا صفِّ سائق.`;
      },
    },
    {
      code: "AUTO_VERIFIED",
      description: "سائقٌ صار موثَّقاً بلا تحقّقِ إدارة — خطرُ عملٍ لا عيبُ أداء.",
      detect: async (context) => {
        const [row] = await context.sql<{ n: string }[]>`
          select count(*)::text as n from public.drivers where verification_status <> 'pending'
        `;
        const verified = Number(row?.n ?? "0");
        return verified === 0 ? null : `${verified} سائقاً حالتُه ليست pending بلا أيّ إجراءٍ إداريّ.`;
      },
    },
  ],

  preconditions: async (context) => {
    const results: CheckResult[] = [];
    const users = await scalar(
      context.sql<{ n: string }[]>`select count(*)::text as n from public.users`,
    );
    results.push(expectEqual("precondition", "لا مستخدِمين قبل التشغيل", users, 0));

    const drivers = await scalar(
      context.sql<{ n: string }[]>`select count(*)::text as n from public.drivers`,
    );
    results.push(expectEqual("precondition", "لا سائقين قبل التشغيل", drivers, 0));

    const [city] = await context.sql<{ is_active: boolean }[]>`
      select is_active from public.cities where id = ${context.cityId}
    `;
    results.push(
      check(
        "precondition",
        "المدينةُ مُفعَّلة",
        city?.is_active === true,
        `المدينة=${context.cityCode} · is_active=${String(city?.is_active)}`,
      ),
    );

    const trialDays = await context.settingNumber("trial_days");
    results.push(
      check(
        "precondition",
        "الإعدادُ trial_days موجودٌ وموجَب",
        trialDays > 0,
        `trial_days=${trialDays}`,
      ),
    );
    return results;
  },

  runActor: async (context, actor) => {
    const chatId = CHAT_BASE + actor.index;
    const statuses: number[] = [];
    const send = async (update: unknown): Promise<void> => {
      const response = await context.post("driver", update);
      statuses.push(response.status);
    };

    await send(textUpdate(chatId, "/start"));
    await send(textUpdate(chatId, fullNameOf(actor.index)));
    await send(contactUpdate(chatId, phoneOf(actor.index)));
    await send(callbackUpdate(chatId, `city:${context.cityId}`));
    await send(callbackUpdate(chatId, "service:transport"));
    await send(callbackUpdate(chatId, "vehicle:sedan"));
    await send(textUpdate(chatId, plateOf(actor.index)));
    await send(textUpdate(chatId, nationalIdOf(actor.index)));
    await send(photoUpdate(chatId, `vphoto_${nationalIdOf(actor.index)}`));

    const [row] = await context.sql<{ id: string }[]>`
      select d.id from public.drivers d
        join public.users u on u.id = d.user_id
       where u.telegram_id = ${chatId}
    `;

    return {
      index: actor.index,
      telegramIds: [chatId],
      produced: {
        telegramId: chatId,
        driverId: row?.id ?? null,
        fullName: fullNameOf(actor.index),
      },
      httpStatuses: statuses,
    };
  },

  systemResponse: async (context, actors) => {
    const cityName = await cityNameOf(context);
    const results: CheckResult[] = [];
    const trialDays = await context.settingNumber("trial_days");

    let registeredOk = 0;
    let trialOk = 0;
    for (const actor of actors) {
      const chatId = Number(actor.produced.telegramId);
      const texts = context.messagesTo(chatId).map((message) => message.text);
      const expectedRegistered = translate("ar", "driver.registered", {
        name: String(actor.produced.fullName),
        city: cityName,
      });
      if (texts.includes(expectedRegistered)) registeredOk += 1;
      if (texts.some((value) => value.includes(String(trialDays)))) trialOk += 1;
    }

    results.push(
      expectEqual(
        "system_response",
        "كلُّ سائقٍ استلم رسالةَ التسجيل باسمِه ومدينتِه",
        registeredOk,
        actors.length,
      ),
    );
    results.push(
      expectEqual(
        "system_response",
        `كلُّ سائقٍ أُبلِغ بمدّةِ التجربة (${trialDays} يوماً) من الإعدادات`,
        trialOk,
        actors.length,
      ),
    );
    return results;
  },

  businessOutcome: async (context, actors) => {
    const results: CheckResult[] = [];
    const trialDays = await context.settingNumber("trial_days");

    const [subs] = await context.sql<{ n: string }[]>`
      select count(*)::text as n from public.subscriptions where status = 'trialing'
    `;
    results.push(
      expectEqual(
        "business_outcome",
        "لكلِّ سائقٍ مشتركٌ واحدٌ في التجربة",
        Number(subs?.n ?? "0"),
        actors.length,
      ),
    );

    /**
     * مدّةُ التجربةِ تُقاس بالفرقِ لا بمقارنةِ تاريخٍ مكتوبٍ في الاختبار: التاريخُ
     * المكتوبُ يجعل التوكيدَ ينكسر بعد منتصف الليل بلا عيبٍ في النظام.
     */
    const [window] = await context.sql<{ min_days: number; max_days: number }[]>`
      select min(extract(day from trial_ends_at - now()))::int as min_days,
             max(extract(day from trial_ends_at - now()))::int as max_days
        from public.subscriptions where status = 'trialing'
    `;
    const withinRange =
      window !== undefined &&
      Number(window.min_days) >= trialDays - 1 &&
      Number(window.max_days) <= trialDays;
    results.push(
      check(
        "business_outcome",
        "نهايةُ التجربةِ مشتقّةٌ من الإعداد لا من ثابت",
        withinRange,
        `trial_days=${trialDays} · المُلاحَظ=[${window?.min_days ?? "?"}, ${window?.max_days ?? "?"}] يوماً`,
      ),
    );

    const [caps] = await context.sql<{ n: string }[]>`
      select count(*)::text as n from public.driver_capabilities
       where service = 'transport' and is_enabled = true
    `;
    results.push(
      expectEqual(
        "business_outcome",
        "لكلِّ سائقٍ قدرةُ نقلٍ مفعَّلةٌ واحدة",
        Number(caps?.n ?? "0"),
        actors.length,
      ),
    );
    return results;
  },

  databaseState: async (context, actors) => {
    const results: CheckResult[] = [];
    const chatIds = chatIdsOf(actors);

    const [users] = await context.sql<{ n: string }[]>`
      select count(*)::text as n from public.users
       where telegram_id = any(${chatIds}) and role = 'driver' and city_id = ${context.cityId}
    `;
    results.push(
      expectEqual(
        "database_state",
        "صفُّ هويّةٍ لكلِّ سائقٍ في المدينةِ الصحيحةِ بدورِ سائق",
        Number(users?.n ?? "0"),
        actors.length,
      ),
    );

    const [phones] = await context.sql<{ n: string }[]>`
      select count(*)::text as n from public.users
       where telegram_id = any(${chatIds})
         and phone = any(${actors.map((actor) => normalizedPhoneOf(actor.index))})
    `;
    results.push(
      expectEqual(
        "database_state",
        "الجوالُ مُوحَّدٌ في الدومين إلى الصيغةِ الدولية",
        Number(phones?.n ?? "0"),
        actors.length,
      ),
    );

    const [drivers] = await context.sql<{ n: string }[]>`
      select count(*)::text as n from public.drivers where city_id = ${context.cityId}
    `;
    results.push(
      expectEqual(
        "database_state",
        "صفُّ سائقٍ واحدٌ لكلِّ فاعل",
        Number(drivers?.n ?? "0"),
        actors.length,
      ),
    );
    return results;
  },

  transitions: async (context, actors) => {
    const results: CheckResult[] = [];
    const [pending] = await context.sql<{ n: string }[]>`
      select count(*)::text as n from public.drivers where verification_status = 'pending'
    `;
    results.push(
      expectEqual(
        "transition",
        "الانتقالُ الأوّل: (لا حساب) → سائقٌ بانتظارِ التحقّق",
        Number(pending?.n ?? "0"),
        actors.length,
      ),
    );

    const [available] = await context.sql<{ n: string }[]>`
      select count(*)::text as n from public.driver_availability where is_available = true
    `;
    results.push(
      expectEqual(
        "transition",
        "لا انتقالَ إلى «متاح» قبل تحقّقِ الإدارة",
        Number(available?.n ?? "0"),
        0,
      ),
    );
    return results;
  },

  invariants: async (context, actors) => {
    const results: CheckResult[] = [];

    const [ids] = await context.sql<{ drivers: string; ids: string }[]>`
      select count(*)::text as drivers,
             count(distinct national_id)::text as ids
        from public.drivers
    `;
    results.push(
      check(
        "invariant",
        "لا هويّةَ وطنيةً مكرّرةً بين السائقين",
        ids !== undefined && ids.drivers === ids.ids,
        `سائقون=${ids?.drivers ?? "?"} · هويّاتٌ مميّزة=${ids?.ids ?? "?"}`,
      ),
    );

    const [subsPerDriver] = await context.sql<{ n: string }[]>`
      select count(*)::text as n from (
        select driver_id from public.subscriptions group by driver_id having count(*) > 1
      ) as many
    `;
    results.push(
      expectEqual("invariant", "لا سائقَ له أكثرُ من مشترك", Number(subsPerDriver?.n ?? "0"), 0),
    );

    const [orphanCaps] = await context.sql<{ n: string }[]>`
      select count(*)::text as n from public.driver_capabilities c
       where not exists (select 1 from public.drivers d where d.id = c.driver_id)
    `;
    results.push(
      expectEqual("invariant", "لا قدرةَ بلا سائقٍ يملكها", Number(orphanCaps?.n ?? "0"), 0),
    );

    /**
     * عدّادُ تلغرام لا يتحرّك في هذه البيئة، ويُثبَت أنّه لا يتحرّك: الملتقطُ يتقدّم
     * على لافِّ العدّاد في الحاوية. وإثباتُ الحدِّ المُعلَن أَولى من إعلانِه وحده،
     * كي لا يُقرأ صفرٌ يوماً دليلاً على أنّ النظام لم يُرسل شيئاً (§9).
     */
    const rendered = context.allMessages().length;
    results.push(
      check(
        "invariant",
        "النظامُ صاغ رسائلَ فعلاً (رغم أنّ عدّادَ تلغرام صفرٌ بحكمِ المزدوج)",
        rendered >= actors.length * 2,
        `رسائلٌ مُلتقطة=${rendered} · الحدُّ الأدنى المتوقّع=${actors.length * 2}`,
      ),
    );
    return results;
  },

  idempotency: {
    description:
      "إعادةُ إرسالِ آخِرِ تحديثٍ (صورةُ الرخصة) لكلِّ سائقٍ بعد اكتمالِ تسجيلِه — " +
      "كما يحدث فعلاً عند إعادةِ محاولةِ تلغرام أو ضغطِ المستخدم مرّتين.",
    replay: async (context, actors) => {
      for (const actor of actors) {
        const chatId = Number(actor.produced.telegramId);
        await context.post("driver", photoUpdate(chatId, `vphoto_${nationalIdOf(actor.index)}`));
      }
    },
    expectation: async (context, actors) => {
      const results: CheckResult[] = [];
      const [drivers] = await context.sql<{ n: string }[]>`
        select count(*)::text as n from public.drivers
      `;
      results.push(
        expectEqual(
          "idempotency",
          "الإعادةُ لم تُنشئ سائقاً ثانياً",
          Number(drivers?.n ?? "0"),
          actors.length,
        ),
      );
      const [subs] = await context.sql<{ n: string }[]>`
        select count(*)::text as n from public.subscriptions
      `;
      results.push(
        expectEqual(
          "idempotency",
          "الإعادةُ لم تُنشئ مشتركاً ثانياً",
          Number(subs?.n ?? "0"),
          actors.length,
        ),
      );
      return results;
    },
  },
};

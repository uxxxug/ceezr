/**
 * الغرض: المُنسِّق — يُقلع عنقوداً من عملياتِ بوّابةٍ حقيقيّةٍ وحالةٍ مشتركةٍ عبر HTTP،
 *        ويُقدّمه كبيئةِ سيناريوٍ واحدة كي يحكم عليه **نفسُ** مشغّلِ وحدة 2-5 ونفسُ حكمِها.
 * الحالة: منفّذ فعلياً — وحدة 2-6.
 * ينتمي إلى: bench/topology
 * يُتوقع أن يستخدمه لاحقاً: `bench/run-distributed.ts`، وسيناريوهاتُ الفشلِ الموزَّعة.
 *
 * ## الفكرةُ الحاكمة
 *
 * لو كُتب لهذه الطبولوجيا مشغّلٌ ثانٍ وحكمٌ ثانٍ، لصار الفرقُ بين نتيجةِ 2-5
 * ونتيجةِ 2-6 محتمِلاً أن يكون فرقاً في الحاكمِ لا في المحكوم. فالمتغيّرُ الوحيدُ
 * هنا هو تنفيذُ `ScenarioEnvironment`: الطلبُ يمرّ على مقبسِ TCP حقيقيّ إلى
 * **عمليةٍ أخرى**، والرسائلُ تُجمَع من كلِّ نسخة، والعدّاداتُ تُجمَع من كلِّ نسخة.
 *
 * ## جمعُ العدّادات ولماذا يصحّ
 *
 * كلُّ نسخةٍ تعرض سجلَّها. تُوصَل النصوصُ ويُجمَع بـ`sumMetric` الذي يجمع كلَّ
 * سلاسلِ الاسم — فسلسلتان بنفس الوسوم من نسختين تُجمعان لا تُهملان. وهذا هو معنى
 * العدّادِ الموزَّع، ولذلك لا يُقرأ من نسخةٍ واحدةٍ رقمٌ ويُعلَن أنّه الكلّ.
 *
 * ## سحبُ الرسائل بعد كلِّ إرسال، وأثرُه في الزمن
 *
 * الرسائلُ تُلتقط في العمليةِ التي عالجت التحديث، فتُسحَب منها فارقاً بعد كلِّ
 * `post`. وهذا يجعل «زمنَ الفاعل» المقيسَ هنا يضمّ رحلةَ سحبٍ إضافيّةً فوق
 * زمنِ المسار — فهو أكبرُ من زمنِ 2-5 بحكم البناء، ولا يُقارَن به. المقيسُ هنا
 * هو الصحّةُ لا الزمن (§10: لا قياسَ سعةٍ في هذه الوحدة).
 */

import { createSql } from "../../packages/infrastructure/db/client.ts";
import { assertConnectedToBenchDatabase } from "../isolation.ts";
import { provision } from "../provision.ts";
import { resetToMigratedState } from "../reset.ts";
import type { MockDeclaration, RecordedMessage } from "../scenarios/contract.ts";
import type { MeasurementScope, ScenarioEnvironment } from "../scenarios/env.ts";
import { READY_MARKER, TOPOLOGY_WEBHOOK_SECRET } from "./gateway-process.ts";
import { type RedisShimServer, serveRedisShim } from "./redis-shim.ts";
import { createKeyedSerializer } from "./serialize.ts";

export interface ClusterOptions {
  /** عددُ عملياتِ البوّابة. اثنتان تكفيان لإثباتِ ما لا تُثبته واحدة. */
  readonly gateways?: number;
  readonly sessionStore?: "memory" | "redis";
  readonly basePort?: number;
  readonly cityCode?: string;
  readonly rateLimit?: number;
  readonly rateWindowSeconds?: number;
  readonly databaseUrl?: string;
}

export interface GatewayInstance {
  readonly id: string;
  readonly port: number;
  readonly pid: number;
  readonly baseUrl: string;
  /** عددُ الرسائلِ المسحوبةِ من هذه النسخةِ حتى الآن — أساسُ السحبِ الفارقي. */
  pulled: number;
  alive: boolean;
}

export interface GatewayState {
  readonly instanceId: string;
  readonly dedupSize: number;
  readonly messages: number;
  readonly sessionStore: string;
}

export interface Cluster extends ScenarioEnvironment {
  readonly instances: readonly GatewayInstance[];
  readonly redis: RedisShimServer;
  /** يُرسل إلى نسخةٍ بعينها — أساسُ توزيعِ المتنافسين على العمليات. */
  readonly postTo: (
    instanceIndex: number,
    bot: "driver" | "rider",
    update: unknown,
  ) => Promise<Response>;
  /**
   * توزيعُ التحديثاتِ على النسخِ، مُصنَّفاً بنوعِ التحديث: نسخة → نوع → عدد.
   *
   * ودليلُ التوزيع لا يكتفي بالمجموع: سيناريو تزاحمٍ ذهبت كلُّ ضغطاتِ «قبول» فيه
   * إلى نسخةٍ واحدةٍ لم يُثبِت شيئاً عن التوزيع وإن جرى على عنقود، ولو كان مجموعُ
   * الطلباتِ موزَّعاً بالتساوي. فالمُصنَّفُ هو الشاهد.
   */
  readonly routing: () => Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** يسحب الرسائلَ من كلِّ النسخِ الحيّة — يُستدعى قبل توكيدٍ يقرأ أثرَ عاملٍ خلفيّ. */
  readonly sync: () => Promise<void>;
  /** يقتل نسخةً بـSIGKILL بلا إطفاءٍ نظيف — لاختبارِ موتِ العملية. */
  readonly kill: (instanceIndex: number) => void;
  readonly stateOf: (instanceIndex: number) => Promise<GatewayState>;
  readonly stop: () => Promise<void>;
}

const READY_TIMEOUT_MS = 30_000;

export const TOPOLOGY_MOCKS: readonly MockDeclaration[] = [
  {
    what: "ناقلُ تلغرام مُستبدَلٌ بملتقطٍ في الذاكرة **داخلَ كلِّ عمليةِ بوّابة**، وتُجمَع رسائلُه عبر HTTP.",
    why: "لا مفاتيحَ إنتاجية في القياس، ولا استدعاءَ خدمةٍ خارجيةٍ مقيَّدةٍ بحدّ معدّل.",
    proves:
      "أنّ النسخةَ التي عالجت التحديثَ صاغت الرسالةَ الصحيحةَ للمستخدَمِ الصحيح — وأنّ مجموعَ الرسائلِ عبر النسخِ يوافق الثابت.",
    doesNotProve:
      "أنّ تلغرام سلّمها، ولا زمنَها، ولا حدَّها. وعدّادُ `waslah_telegram_messages_sent_total` **لا يتحرّك** هنا.",
  },
  {
    what: "الحالةُ المشتركةُ (الجلسات وحدُّ المعدّل) على مزدوجٍ يفهم بروتوكولَ Upstash REST محلّياً، لا على Upstash.",
    why: "لا اعتمادَ على خدمةٍ خارجيةٍ ولا مفاتيحَ إنتاجيةٍ في اختبار، مع إبقاءِ عميلِ الإنتاج `createUpstashRedis` كما هو بلا تعديل.",
    proves:
      "أنّ الحالةَ تُشارَك فعلاً بين عملياتٍ منفصلةٍ عبر شبكةٍ حقيقيّة، وأنّ `SESSION_STORE=redis` يجعل حواراً يبدأ في نسخةٍ ويكمُل في أخرى (ADR 0011).",
    doesNotProve: "زمنَ Upstash ولا حدودَها ولا سلوكَ انقطاعِها ولا دقّةَ انتهاءِ الصلاحيّة عندها.",
  },
  {
    what: "قاعدةٌ واحدةٌ محلّيةٌ (`waslah_bench`) على نفس المُضيف، لا Supabase.",
    why: "حاجزُ العزلِ المبنيُّ في وحدة 2-4: قاعدةُ القياسِ وحدَها تُفرَّغ وتُبذَر، ولا تُلمَس قاعدةٌ إنتاجية.",
    proves:
      "سلوكَ PostgreSQL الحقيقيَّ: المعاملات، والقيود، والأقفال الاستشارية، و`for update skip locked`.",
    doesNotProve: "زمنَ الشبكةِ إلى قاعدةٍ مُدارةٍ بعيدة، ولا حدودَ اتصالاتِها، ولا سلوكَ pgBouncer.",
  },
  {
    what: "حدُّ المعدّل مرفوعٌ عملياً افتراضاً (10^9 لكلِّ نافذة).",
    why: "المقصودُ إثباتُ ثوابتِ العمل موزَّعةً، لا قياسُ متى يُقال 429.",
    proves: "أنّ المسارَ يعمل بلا خنقٍ مصطنع.",
    doesNotProve: "سلوكَ النظام تحت الحدِّ الإنتاجي — قياسٌ منفصلٌ واجب.",
  },
] as const;

export async function startCluster(options: ClusterOptions = {}): Promise<Cluster> {
  const databaseUrl = options.databaseUrl ?? process.env.BENCH_DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error("[bench/topology] عيّن BENCH_DATABASE_URL لقاعدةِ قياسٍ مطبَّقٍ عليها كلُّ الترحيلات.");
  }

  const gatewayCount = options.gateways ?? 2;
  const sessionStore = options.sessionStore ?? "redis";
  const basePort = options.basePort ?? 4401;
  const cityCode = options.cityCode ?? "JED";

  const redis = serveRedisShim({ token: "bench-topology-shared" });
  const sql = createSql({ connectionString: databaseUrl, max: 8, prepare: false });

  const processes: Bun.Subprocess[] = [];
  const instances: GatewayInstance[] = [];

  const abandon = async (): Promise<void> => {
    for (const child of processes) child.kill("SIGKILL");
    await redis.stop();
    await sql.end({ timeout: 5 });
  };

  try {
    await assertConnectedToBenchDatabase(sql);

    for (let index = 0; index < gatewayCount; index += 1) {
      const port = basePort + index;
      const id = `gw${index + 1}`;
      const child = Bun.spawn(
        ["bun", "run", new URL("./gateway-process.ts", import.meta.url).pathname],
        {
          env: {
            ...process.env,
            BENCH_DATABASE_URL: databaseUrl,
            BENCH_GATEWAY_PORT: String(port),
            BENCH_INSTANCE_ID: id,
            BENCH_SESSION_STORE: sessionStore,
            BENCH_REDIS_URL: redis.url,
            BENCH_REDIS_TOKEN: redis.token,
            BENCH_RATE_LIMIT: String(options.rateLimit ?? 10 ** 9),
            BENCH_RATE_WINDOW_SECONDS: String(options.rateWindowSeconds ?? 60),
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      processes.push(child);
      const ready = await waitForReady(child, id);
      instances.push({
        id,
        port,
        pid: ready.pid,
        baseUrl: `http://127.0.0.1:${port}`,
        pulled: 0,
        alive: true,
      });
    }

    const [city] = await sql<{ id: string }[]>`
      select id from public.cities where code = ${cityCode} and is_active = true
    `;
    if (city === undefined) {
      throw new Error(`[bench/topology] المدينة «${cityCode}» غير موجودةٍ أو غير مُفعَّلة.`);
    }
    return await assemble({
      options: { gatewayCount, sessionStore, cityCode, databaseUrl },
      cityId: city.id,
      instances,
      processes,
      redis,
      sql,
    });
  } catch (error) {
    await abandon();
    throw error;
  }
}

interface AssembleInput {
  readonly options: {
    readonly gatewayCount: number;
    readonly sessionStore: "memory" | "redis";
    readonly cityCode: string;
    readonly databaseUrl: string;
  };
  readonly cityId: string;
  readonly instances: GatewayInstance[];
  readonly processes: readonly Bun.Subprocess[];
  readonly redis: RedisShimServer;
  readonly sql: ReturnType<typeof createSql>;
}

async function assemble(input: AssembleInput): Promise<Cluster> {
  const { instances, processes, redis, sql, cityId } = input;
  const { gatewayCount, sessionStore, cityCode, databaseUrl } = input.options;

  // مرآةُ الرسائلِ في المُنسِّق: تُبنى بالسحبِ الفارقي من كلِّ نسخة.
  const ordered: RecordedMessage[] = [];
  const byChat = new Map<string, RecordedMessage[]>();
  const absorb = (messages: readonly RecordedMessage[]): void => {
    for (const message of messages) {
      ordered.push(message);
      const bucket = byChat.get(message.chatId);
      if (bucket === undefined) byChat.set(message.chatId, [message]);
      else bucket.push(message);
    }
  };

  /**
   * تسلسلُ السحبِ لكلِّ نسخة: خمسةُ فاعلين متزامنين يُنهون طلباتَهم في نفس اللحظة،
   * فتنطلق خمسُ عمليّاتِ سحبٍ متوازيةٍ من نفسِ النسخة. وبلا تسلسلٍ تقرأ كلُّها نفسَ
   * `pulled` فتستوعب نفسَ الرسائلِ أكثرَ من مرّة — وقد قِيس ذلك فعلاً: ٤٠ رسالةَ عرضٍ
   * مقابلَ ٢٥ عرضاً في القاعدة، فحُكم بإخفاقِ عملٍ على نظامٍ سليم. المنطقُ في
   * `serialize.ts` ومُختبَرٌ وحدةً هناك.
   */
  const pullSerializer = createKeyedSerializer();
  const pullFrom = async (instance: GatewayInstance): Promise<void> => {
    await pullSerializer.run(instance.id, () => pullOnce(instance));
  };

  const pullOnce = async (instance: GatewayInstance): Promise<void> => {
    if (!instance.alive) return;
    try {
      const response = await fetch(`${instance.baseUrl}/bench/messages?since=${instance.pulled}`);
      if (!response.ok) return;
      const body = (await response.json()) as { total: number; messages: RecordedMessage[] };
      absorb(body.messages);
      instance.pulled = body.total;
    } catch {
      /**
       * نسخةٌ ميتةٌ لا تُسحَب منها. اختبارُ الفشلِ يقتلها عن قصد، وسقوطُ السحبِ
       * ليس فشلاً في المقيس — والحكمُ على الثابتِ يأتي من القاعدةِ ومن باقي النسخ.
       */
      instance.alive = false;
    }
  };

  const sync = async (): Promise<void> => {
    await Promise.all(instances.map(pullFrom));
  };

  const postTo = async (
    instanceIndex: number,
    bot: "driver" | "rider",
    update: unknown,
  ): Promise<Response> => {
    const instance = instances[instanceIndex % instances.length];
    if (instance === undefined) throw new Error("[bench/topology] لا نسخةَ بوّابةٍ بهذا الرقم.");
    const kinds = routed.get(instance.id) ?? new Map<string, number>();
    const kind = kindOf(update);
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    routed.set(instance.id, kinds);
    const response = await fetch(`${instance.baseUrl}/webhook/telegram/${bot}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": TOPOLOGY_WEBHOOK_SECRET,
      },
      body: JSON.stringify(update),
    });
    // يُقرأ الجسمُ ثم تُسحَب الرسائل: قراءةُ الجسمِ تضمن اكتمالَ المعالجةِ في النسخة.
    const text = await response.text();
    await pullFrom(instance);
    return new Response(text, { status: response.status, headers: response.headers });
  };

  const routed = new Map<string, Map<string, number>>();
  /**
   * نوعُ التحديثِ كما يُصنَّف للدليل. زرُّ «قبول» يُميَّز عن أيِّ ضغطةٍ أخرى لأنّه
   * الفعلُ المتزاحَمُ عليه، وهو ما يجب أن يُثبَت توزُّعُه.
   */
  const kindOf = (update: unknown): string => {
    if (typeof update !== "object" || update === null) return "unknown";
    const record = update as { callback_query?: { data?: unknown }; message?: unknown };
    if (record.callback_query !== undefined) {
      const data = record.callback_query.data;
      if (typeof data !== "string") return "callback";
      // تُقصّ الأجزاءُ الطويلة (معرّفاتٌ عالميّة) كي يبقى المفتاحُ مقروءاً في الدليل.
      const parts = data
        .split(":")
        .slice(0, 2)
        .map((part) => (part.length > 12 ? "…" : part));
      return `callback:${parts.join(":")}`;
    }
    return record.message !== undefined ? "message" : "unknown";
  };
  let roundRobin = 0;
  const post = async (bot: "driver" | "rider", update: unknown): Promise<Response> => {
    const target = roundRobin;
    roundRobin = (roundRobin + 1) % instances.length;
    return postTo(target, bot, update);
  };

  const renderMetrics = async (): Promise<string> => {
    const texts = await Promise.all(
      instances.map(async (instance) => {
        if (!instance.alive) return "";
        try {
          const response = await fetch(`${instance.baseUrl}/bench/metrics-text`);
          return response.ok ? await response.text() : "";
        } catch {
          instance.alive = false;
          return "";
        }
      }),
    );
    return texts.join("\n");
  };

  const settingNumber = async (key: string): Promise<number> => {
    const [row] = await sql<{ value: number | null }[]>`
      select public.get_setting_number(${cityId}::uuid, ${key}) as value
    `;
    if (row === undefined || row.value === null) {
      throw new Error(`[bench/topology] الإعداد «${key}» غير موجودٍ للمدينة ${cityCode}.`);
    }
    return Number(row.value);
  };

  const clearMessages = (): void => {
    ordered.length = 0;
    byChat.clear();
  };

  const resetOperational = async (): Promise<void> => {
    await resetToMigratedState(sql, { databaseUrl, nodeEnv: "test" });
    await provision(sql);
    // تُفرَّغ ملتقطاتُ النسخِ أيضاً، وإلّا حُسبت رسالةُ سيناريوٍ سابقٍ في التالي.
    await Promise.all(
      instances.map(async (instance) => {
        if (!instance.alive) return;
        try {
          await fetch(`${instance.baseUrl}/bench/clear`);
          instance.pulled = 0;
        } catch {
          instance.alive = false;
        }
      }),
    );
    clearMessages();
  };

  await resetOperational();

  const topology: readonly string[] = [
    `${gatewayCount} عملياتُ بوّابةٍ مستقلّةٌ (${instances.map((i) => `${i.id}:${i.port}`).join("، ")}) — كلٌّ بكومتِها وبِركةِ اتصالاتِها ومانعِ تكرارِها.`,
    `مخزنُ الجلسات وحدُّ المعدّل: ${sessionStore === "redis" ? "مشتركٌ عبر HTTP على مزدوجِ Upstash REST" : "ذاكرةُ كلِّ عمليةٍ وحدَها (غيرُ مشترك)"}.`,
    "قاعدةٌ واحدةٌ مشتركة: `waslah_bench` على نفس المُضيف — وهي المنسِّقُ الحقيقيُّ للثوابت.",
    "الطلبُ يمرّ على مقبسِ TCP حقيقيٍّ إلى عمليةٍ أخرى، لا على `app.fetch` في نفس العملية.",
    "العاملُ الدوريُّ داخلَ البوّاباتِ مُطفأ؛ عملياتُ العاملِ تُقلَع منفصلةً في اختبارِ ازدواجِ العاملين.",
  ];

  const measurementScope: MeasurementScope = {
    measures: [
      "سلوكَ العمل عبر عملياتٍ منفصلة: HTTP على مقبسٍ حقيقيّ → سرُّ الويبهوك → حدُّ المعدّل → مانعُ التكرار → المُوجِّه → الحوار → الحالةُ المشتركة → RPC → PostgreSQL.",
      "بقاءَ ثوابتِ العمل صحيحةً حين يتوزّع المتنافسون على عملياتٍ مختلفة.",
      "مجموعَ العدّاداتِ عبر كلِّ النسخِ (لا عدّادَ نسخةٍ واحدة).",
      "أثرَ موتِ عمليةٍ أو تكرارِ حدثٍ من عمليةٍ أخرى على الحالةِ التجارية.",
    ],
    doesNotMeasure: [
      "التسليمَ الحقيقيَّ عبر تلغرام ولا حدودَه (الناقلُ مزدوج).",
      "سعةَ النظام: هذه الوحدةُ صحّةٌ لا سعة، والحملُ فيها صغيرٌ عن قصد (§10).",
      "زمناً يُقارَن بأرقامِ وحدة 2-5: زمنُ الفاعلِ هنا يضمّ سحبَ الرسائلِ من النسخة، فهو أكبرُ بحكمِ البناء.",
      "سلوكَ Upstash ولا سلوكَ قاعدةٍ مُدارةٍ بعيدة، ولا موازِنَ حملٍ حقيقيّاً (التوجيهُ يقرّره الاختبارُ صريحاً).",
    ],
  };

  return {
    instances,
    redis,
    sql,
    cityId,
    cityCode,
    post,
    postTo,
    routing: () =>
      Object.fromEntries([...routed].map(([id, kinds]) => [id, Object.fromEntries(kinds)])),
    sync,
    messagesTo: (chatId) => byChat.get(String(chatId)) ?? [],
    allMessages: () => ordered,
    clearMessages,
    settingNumber,
    resetOperational,
    renderMetrics,
    mocks: TOPOLOGY_MOCKS,
    topology,
    measurementScope,
    kill: (instanceIndex) => {
      const instance = instances[instanceIndex];
      const child = processes[instanceIndex];
      if (instance === undefined || child === undefined) {
        throw new Error("[bench/topology] لا نسخةَ بوّابةٍ بهذا الرقم.");
      }
      child.kill("SIGKILL");
      instance.alive = false;
    },
    stateOf: async (instanceIndex) => {
      const instance = instances[instanceIndex];
      if (instance === undefined) throw new Error("[bench/topology] لا نسخةَ بوّابةٍ بهذا الرقم.");
      const response = await fetch(`${instance.baseUrl}/bench/state`);
      return (await response.json()) as GatewayState;
    },
    stop: async () => {
      for (const [index, child] of processes.entries()) {
        const instance = instances[index];
        if (instance?.alive === true) {
          try {
            await fetch(`${instance.baseUrl}/bench/shutdown`);
          } catch {
            child.kill("SIGKILL");
          }
        }
      }
      await Bun.sleep(200);
      for (const child of processes) child.kill("SIGKILL");
      await redis.stop();
      await sql.end({ timeout: 5 });
    },
  };
}

/**
 * ينتظر سطرَ الجهوزيّة من المخرَجِ القياسي — لا انتظاراً أعمى بمهلةٍ ثابتة: عمليةٌ
 * سقطت عند الإقلاع تُعطي سبباً في `stderr`، ورفعُ سببِها أنفعُ من مهلةٍ تنتهي بصمت.
 */
async function waitForReady(child: Bun.Subprocess, id: string): Promise<{ pid: number }> {
  const stdout = child.stdout;
  if (!(stdout instanceof ReadableStream)) {
    throw new Error(`[bench/topology] لا مخرَجَ قياسيّاً من ${id}.`);
  }
  const decoder = new TextDecoder();
  const reader = stdout.getReader();
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let buffer = "";

  try {
    while (Date.now() < deadline) {
      const timeout = Bun.sleep(Math.max(1, deadline - Date.now())).then(() => "timeout" as const);
      const outcome = await Promise.race([reader.read(), timeout]);
      if (outcome === "timeout") break;
      if (outcome.done) break;
      buffer += decoder.decode(outcome.value, { stream: true });
      const marker = buffer.split("\n").find((line) => line.startsWith(READY_MARKER));
      if (marker !== undefined) {
        return JSON.parse(marker.slice(READY_MARKER.length).trim()) as { pid: number };
      }
    }
  } finally {
    reader.releaseLock();
  }

  const stderrText =
    child.stderr instanceof ReadableStream ? await new Response(child.stderr).text() : "";
  child.kill("SIGKILL");
  throw new Error(
    `[bench/topology] لم تُقلع ${id} في الوقت المحدَّد.\nstdout: ${buffer.slice(0, 500)}\nstderr:\n${stderrText.slice(0, 2000)}`,
  );
}

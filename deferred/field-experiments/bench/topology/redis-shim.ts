/**
 * الغرض: مزدوجٌ لبروتوكولِ Upstash REST — عمليةُ حالةٍ مشتركةٍ واحدة تُخاطبها كلُّ
 *        بوّاباتِ العنقود عبر HTTP حقيقي، فتصير الجلسةُ وحدُّ المعدّل مشتركين فعلاً.
 * الحالة: منفّذ فعلياً — وحدة 2-6.
 * ينتمي إلى: bench/topology
 * يُتوقع أن يستخدمه لاحقاً: `cluster.ts`، وأيُّ اختبارٍ يحتاج حالةً مشتركةً بين عمليات.
 *
 * ## ما يُثبته هذا المزدوج وما لا يُثبته — §7 من الأمر الحاكم
 *
 * **ما هو:** خادمٌ يفهم المجموعةَ الفرعيّةَ من أوامرِ Redis التي يستخدمها كودُ
 * الإنتاج فعلاً (`PING`، `GET`، `SET … EX`، `DEL`، `INCR`، `EXPIRE`) بنفسِ
 * بروتوكولِ Upstash: POST، `authorization: Bearer`، جسمٌ = مصفوفةُ وسائطَ نصّية،
 * جوابٌ `{result}` أو `{error}`. وعميلُ الإنتاج `createUpstashRedis` يُستخدم كما هو
 * بلا تعديلٍ ولا بديل.
 *
 * **ما يُثبته:** أنّ الحالةَ المشتركةَ بين عملياتٍ منفصلةٍ تعمل عبر شبكةٍ حقيقيّةٍ
 * ومسارِ تسلسلٍ حقيقيّ — أي أنّ `SESSION_STORE=redis` يجعل حواراً بدأ في بوّابةٍ
 * يكمُل في أخرى (ADR 0011)، وأنّ حدَّ المعدّل يصير موزَّعاً على نفس المفتاح.
 *
 * **ما لا يُثبته:** أنّ Upstash نفسَها تتصرّف هكذا. لا زمنَها (هذا مُضيفٌ محلّيّ)،
 * ولا حدودَ طلباتِها، ولا سلوكَ انقطاعِها، ولا دقّةَ انتهاءِ صلاحيّتِها عندها، ولا
 * ضماناتِها عند التقسيم. فأيُّ حكمٍ على «أداءِ Redis في الإنتاج» لا يُستخرَج من هنا.
 *
 * وانتهاءُ الصلاحيّةِ هنا كسولٌ (يُحسَب عند القراءة) لا مُجدوَل: هذا يكفي لما نقيسه،
 * ويُختلف عن Redis في أنّ `DBSIZE` قد يعدّ مفتاحاً منتهياً لم يُقرأ بعد.
 */

interface StoredValue {
  value: string;
  /** الطابعُ الذي بعده يُعتبر المفتاحُ غيرَ موجود، أو `null` لبلا مهلة. */
  expiresAtMs: number | null;
}

export interface RedisShimResponse {
  readonly status: number;
  readonly body: { result: unknown } | { error: string };
}

export interface RedisShimStore {
  /** ينفّذ أمراً كما يصل من العميل: مصفوفةُ وسائطَ نصّية. */
  execute(args: readonly string[]): RedisShimResponse;
  /** عددُ الأوامرِ المنفَّذةِ لكلِّ اسمِ أمر — دليلٌ على أنّ المشاركةَ جرت فعلاً. */
  commandCounts(): Readonly<Record<string, number>>;
  keyCount(): number;
  reset(): void;
}

export function createRedisShimStore(now: () => number = Date.now): RedisShimStore {
  const store = new Map<string, StoredValue>();
  const counts = new Map<string, number>();

  const live = (key: string): StoredValue | undefined => {
    const entry = store.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAtMs !== null && entry.expiresAtMs <= now()) {
      store.delete(key);
      return undefined;
    }
    return entry;
  };

  return {
    commandCounts: () => Object.fromEntries(counts),
    keyCount: () => {
      for (const key of [...store.keys()]) live(key);
      return store.size;
    },
    reset: () => {
      store.clear();
      counts.clear();
    },
    execute: (args) => {
      const name = (args[0] ?? "").toUpperCase();
      counts.set(name, (counts.get(name) ?? 0) + 1);

      switch (name) {
        case "PING":
          return { status: 200, body: { result: "PONG" } };

        case "GET": {
          const key = args[1];
          if (key === undefined) return wrongArgs(name);
          return { status: 200, body: { result: live(key)?.value ?? null } };
        }

        case "SET": {
          const key = args[1];
          const value = args[2];
          if (key === undefined || value === undefined) return wrongArgs(name);
          let expiresAtMs: number | null = null;
          // `SET key value EX seconds` — الشكلُ الوحيدُ الذي يُصدره كودُ الإنتاج.
          if (args.length > 3) {
            if ((args[3] ?? "").toUpperCase() !== "EX" || args[4] === undefined) {
              return {
                status: 200,
                body: { error: `ERR unsupported SET options: ${args.slice(3).join(" ")}` },
              };
            }
            const seconds = Number.parseInt(args[4], 10);
            if (!Number.isFinite(seconds))
              return {
                status: 200,
                body: { error: "ERR value is not an integer or out of range" },
              };
            expiresAtMs = now() + seconds * 1000;
          }
          store.set(key, { value, expiresAtMs });
          return { status: 200, body: { result: "OK" } };
        }

        case "DEL": {
          const keys = args.slice(1);
          if (keys.length === 0) return wrongArgs(name);
          let removed = 0;
          for (const key of keys) {
            if (live(key) !== undefined) {
              store.delete(key);
              removed += 1;
            }
          }
          return { status: 200, body: { result: removed } };
        }

        case "INCR": {
          const key = args[1];
          if (key === undefined) return wrongArgs(name);
          const current = live(key);
          const parsed = current === undefined ? 0 : Number.parseInt(current.value, 10);
          if (!Number.isFinite(parsed)) {
            return { status: 200, body: { error: "ERR value is not an integer or out of range" } };
          }
          const next = parsed + 1;
          // المهلةُ لا تُمسّ عند الزيادة — كذلك تفعل Redis، وعليه يقوم حدُّ النافذة الثابتة.
          store.set(key, { value: String(next), expiresAtMs: current?.expiresAtMs ?? null });
          return { status: 200, body: { result: next } };
        }

        case "EXPIRE": {
          const key = args[1];
          const rawSeconds = args[2];
          if (key === undefined || rawSeconds === undefined) return wrongArgs(name);
          const seconds = Number.parseInt(rawSeconds, 10);
          if (!Number.isFinite(seconds)) {
            return { status: 200, body: { error: "ERR value is not an integer or out of range" } };
          }
          const current = live(key);
          if (current === undefined) return { status: 200, body: { result: 0 } };
          current.expiresAtMs = now() + seconds * 1000;
          return { status: 200, body: { result: 1 } };
        }

        default:
          // أمرٌ لم يُنفَّذ هنا خطأٌ مُعلَن لا صمتٌ ناجح: الصمتُ الناجح يجعل
          // اختباراً يمرّ على مزدوجٍ لا يفعل ما يظنّه الكود.
          return { status: 200, body: { error: `ERR unknown command '${args[0] ?? ""}'` } };
      }
    },
  };
}

function wrongArgs(name: string): RedisShimResponse {
  return {
    status: 200,
    body: { error: `ERR wrong number of arguments for '${name.toLowerCase()}' command` },
  };
}

export interface RedisShimServer {
  readonly url: string;
  readonly token: string;
  readonly store: RedisShimStore;
  stop(): Promise<void>;
}

/**
 * يشغّل المزدوجَ على مقبسٍ حقيقيّ. المنفذُ صفرٌ افتراضاً فيختاره النظام: عنقودٌ
 * يثبّت منفذاً يفشل عند تشغيلين متتاليين ما لم يُنتظر تحرُّرُ المقبس.
 */
export function serveRedisShim(options: { token: string; port?: number }): RedisShimServer {
  const store = createRedisShimStore();
  const server = Bun.serve({
    port: options.port ?? 0,
    fetch: async (request) => {
      if (request.headers.get("authorization") !== `Bearer ${options.token}`) {
        return new Response(JSON.stringify({ error: "NOAUTH" }), { status: 401 });
      }
      if (new URL(request.url).pathname === "/__shim/state") {
        return Response.json({ commands: store.commandCounts(), keys: store.keyCount() });
      }
      let args: unknown;
      try {
        args = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: "ERR malformed body" }), { status: 400 });
      }
      if (!Array.isArray(args) || args.some((part) => typeof part !== "string")) {
        return new Response(JSON.stringify({ error: "ERR body must be an array of strings" }), {
          status: 400,
        });
      }
      const outcome = store.execute(args as readonly string[]);
      return new Response(JSON.stringify(outcome.body), {
        status: outcome.status,
        headers: { "content-type": "application/json" },
      });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    token: options.token,
    store,
    stop: async () => {
      await server.stop(true);
    },
  };
}

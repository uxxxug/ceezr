/**
 * الغرض: LOAD-01 (دورةُ تشخيصِ انتظارِ HTTP، 2026-10-26 — حزمةُ
 *   `load01-c2-http-wait-probe`) — الربطُ الطلبيُّ الفرديُّ خلفَ `DISPATCH_TRACE_FILE`:
 *   (١) `httpreq`: سطرٌ لكلِّ طلبِ HTTP بمعرّفِهِ من رأسِ الردِّ القائمِ وزمنِهِ الخادميِّ
 *       ومجموعَي انتظارِ مقعدِهِ واحتجازِهِ من نطاقِ المسارِ.
 *   (٢) `pseat`: حجزُ مقعدٍ فردّيٌّ منسوبٌ إلى معرّفِ الطلبِ (سياقِ الارتباطِ الجاري) بفواصلِهِ
 *       المشتقّةِ — للنطاقاتِ الـHTTP وحدها؛ مساراتُ الدرينرِ لا تُنسَبُ إلى معرّفِ طلبٍ.
 *   (٣) `arr1s`: وصولٌ بثانيةٍ واحدةٍ عندَ الدخولِ (http لكلِّ مسارٍ، وseat لحظةَ طلبِ
 *       المقعدِ) — لا يُصبُّ عندَ الإيقافِ إلا ما انقضت ثانيتُه، والحجزُ الذي يبدأُ قبلَ
 *       التفريغِ وينتهي بعدَهُ يُحتسَبُ مرةً واحدةً في ثانيتِهِ لا فقدَ ولا استبدالَ عدٍّ سابق.
 *   (٤) عمودُ العميلِ: `http_call` سطرٌ فرديٌّ لكلِّ نداءٍ بمعرّفِ الطلبِ وزمنِ العميلِ — خلفَ
 *       العلمِ نفسِهِ (OFF بلا سطرٍ) فيقيسُ فحصُ ON–OFF كلفةَ الجانبينِ معًا.
 *   (٥) السلسلةُ عبرَ الوسيطِ الحقيقيِّ (http_call ← httpreq ← pseat بمعرّفٍ واحدٍ)
 *       ومصالحةُ الحجوزاتِ المؤهّلةِ بحسبِ التجمّعِ والنوعِ معَ الإجمالياتِ القائمةِ.
 * ينتمي إلى: tests/unit
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type postgres from "postgres";
import { enableLoadPathScope } from "../../apps/gateway/src/background/load-path-scope.ts";
import { createLoadTrace } from "../../apps/gateway/src/background/load-trace.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import { withQueryDeadline } from "../../packages/infrastructure/db/query-deadline.ts";
import { runWithCorrelation } from "../../packages/infrastructure/observability/correlation.ts";

/** استعلامٌ مزدوجٌ كسولٌ كـ`Query` في `postgres` — كما في load-path-scope.test.ts. */
class LazyQuery extends Promise<unknown> {
  static override get [Symbol.species]() {
    return Promise;
  }
  declare resolve: (value: unknown) => void;
  private started = false;
  constructor(private readonly ms: number) {
    let res: (value: unknown) => void = () => {};
    super((resolve) => {
      res = resolve;
    });
    this.resolve = res;
  }
  handle(): Promise<void> {
    if (!this.started) {
      this.started = true;
      setTimeout(() => this.resolve([]), this.ms);
    }
    return Promise.resolve();
  }
  cancel(): Promise<void> {
    return Promise.resolve();
  }
  // biome-ignore lint/suspicious/noThenProperty: يحاكي `Query` في `postgres` الذي ينفِّذ في `then`.
  override then<A = unknown, B = never>(
    onFulfilled?: ((value: unknown) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    void this.handle();
    return super.then(onFulfilled, onRejected);
  }
}

function lazySql(ms: number): postgres.Sql<Record<string, never>> {
  const s = ((..._a: unknown[]) => new LazyQuery(ms)) as unknown as Record<string, unknown>;
  s.options = { max: 2 };
  return s as unknown as postgres.Sql<Record<string, never>>;
}

const rows = (file: string): Record<string, unknown>[] =>
  readFileSync(`${file}.load.jsonl`, "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);

/** ردٌّ أصغرُ مما يقرأهُ `httpreq` من رأسِهِ وحالتِهِ — المعرّفُ منَ الرأسِ لا غير. */
const fakeResponse = (rid: string) => ({
  status: 200,
  headers: { get: (name: string) => (name === "X-Request-Id" ? rid : null) },
});

afterEach(() => enableLoadPathScope(false));

describe("LOAD-01 — httpreq/pseat/arr1s خلف DISPATCH_TRACE_FILE", () => {
  test("بلا ملفٍّ لا أثرَ ولا سلوكَ يتغير", () => {
    expect(createLoadTrace(undefined)).toBeNull();
    expect(createLoadTrace("")).toBeNull();
  });

  test("httpreq: سطرٌ لكلِّ طلبٍ بمعرّفِهِ منَ الرأسِ ومجموعَي مقعدِهِ، وpseat منسوبٌ للمعرّفِ", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "hr1-")), "trace");
    const trace = createLoadTrace(file);
    if (trace === null) throw new Error("الأثرُ معطَّل");
    const sql = withQueryDeadline(lazySql(30), {
      deadlineMs: 5_000,
      slots: 2,
      label: "ceezr:gatewayRequest",
    });
    const RID = "req-http-1";
    // المعرّفُ مارٌّ فعلًا في سياقِ الارتباطِ (كما يفعلُ وسيطُ الطلباتِ) — لا معرّفٌ جديد.
    await runWithCorrelation({ requestId: RID, entry: "gateway" }, async () => {
      await trace.inRoute("/v1/rides", "POST", async () => {
        await (sql`select 1` as unknown as Promise<unknown>);
        return fakeResponse(RID);
      });
    });
    await trace.stop();
    const all = rows(file);
    const httpreq = all.filter((r) => r.k === "httpreq");
    expect(httpreq).toHaveLength(1);
    expect(httpreq[0]?.route).toBe("POST /v1/rides");
    expect(httpreq[0]?.requestId).toBe(RID);
    expect(httpreq[0]?.status).toBe(200);
    expect(Number(httpreq[0]?.serverMs)).toBeGreaterThan(25); // احتوى الاستعلامَ (~30ms)
    expect(Number(httpreq[0]?.gateAcquisitions)).toBe(1);
    expect(Number(httpreq[0]?.gateHoldMs)).toBeGreaterThan(20);
    // pseat: الحجزُ منسوبٌ إلى المعرّفِ بفواصلِهِ المشتقّةِ (بدايةُ الانتظارِ ≤ نهايتُهُ ≤ الحسمِ)
    const pseat = all.filter((r) => r.k === "pseat");
    expect(pseat).toHaveLength(1);
    expect(pseat[0]?.requestId).toBe(RID);
    expect(pseat[0]?.pool).toBe("ceezr:gatewayRequest");
    expect(Number(pseat[0]?.waitStartAt)).toBeLessThanOrEqual(Number(pseat[0]?.waitEndAt));
    expect(Number(pseat[0]?.waitEndAt)).toBeLessThanOrEqual(Number(pseat[0]?.holdEndAt));
    expect(Number(pseat[0]?.runMs)).toBeGreaterThan(20);
  });

  test("httpgap: مردودُ الجسرِ يُصبُّ سطرًا فردّيًا بمعرّفِ الطلبِ والمسارِ المطبَّعِ والمعدومِ لا صفرًا", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "hg1-")), "trace");
    const trace = createLoadTrace(file);
    if (trace === null) throw new Error("الأثرُ معطَّل");
    // مردودٌ كاملُ الحدودِ: معرّفٌ ومسارٌ وكلُّ الطوابعِ مكتملةٌ.
    trace.onGap({
      requestId: "req-gap-1",
      method: "POST",
      pathname: "/v1/rides",
      fetchMs: 12.34,
      writeHeadMs: 13.01,
      firstWriteMs: 13.55,
      endMs: 14.02,
      finishMs: 15.4,
      closed: false,
      requestLeadMs: 0.42,
      inflightAtEntry: 3,
      connSeq: 2,
      loopOverdueAtEntryMs: 1.5,
    });
    // ومردودٌ ناقصُ الحدودِ (إغلاقٌ مبكرٌ): المعدومُ يبقى معدومًا لا صفرًا ولا يُخترعُ.
    trace.onGap({
      requestId: null,
      method: "GET",
      pathname: "/v1/rides/12345",
      fetchMs: 5,
      writeHeadMs: 5.6,
      firstWriteMs: null,
      endMs: null,
      finishMs: null,
      closed: true,
      requestLeadMs: null,
      inflightAtEntry: 1,
      connSeq: 1,
      loopOverdueAtEntryMs: null,
    });
    await trace.stop();
    const all = rows(file);
    const httpgap = all.filter((r) => r.k === "httpgap");
    expect(httpgap).toHaveLength(2);
    const first = httpgap[0] as Record<string, unknown>;
    expect(first.requestId).toBe("req-gap-1");
    expect(first.route).toBe("POST /v1/rides");
    expect(first.closed).toBe(false);
    expect(first.finishMs).toBe(15.4);
    const second = httpgap[1] as Record<string, unknown>;
    // المسارُ يُطبَّعُ (المعرّفُ يصيرُ :id) والمعدومُ يبقى معدومًا لا صفرًا.
    expect(second.route).toBe("GET /v1/rides/:id");
    expect(second.requestId).toBeNull();
    expect(second.firstWriteMs).toBeNull();
    expect(second.endMs).toBeNull();
    expect(second.finishMs).toBeNull();
    expect(second.closed).toBe(true);
  });

  test("pseat لا يُنسَبُ لمساراتَ خلفيّةٍ (الدرينرُ بلا معرّفِ طلبٍ) والربطُ يبقى للأثرِ المجمّعِ", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "hr2-")), "trace");
    const trace = createLoadTrace(file);
    if (trace === null) throw new Error("الأثرُ معطَّل");
    const sql = withQueryDeadline(lazySql(20), {
      deadlineMs: 5_000,
      slots: 2,
      label: "ceezr:gatewayRequest",
    });
    const RID = "req-bg-1";
    await runWithCorrelation({ requestId: RID, entry: "gateway" }, async () => {
      await trace.drainer.scope?.("drainer:job:driver:contact", async () => {
        await (sql`select 2` as unknown as Promise<unknown>);
      });
    });
    await trace.stop();
    const all = rows(file);
    expect(all.filter((r) => r.k === "pseat")).toHaveLength(0); // لا معرّفَ طلبٍ لنطاقٍ خلفيٍّ
    expect(all.filter((r) => r.k === "httpreq")).toHaveLength(0); // لا طلبَ HTTP أصلًا
    const pagg = all.filter((r) => r.k === "pagg");
    expect(pagg.find((r) => r.path === "drainer:job:driver:contact")?.n).toBe(1); // المجمّعُ قائمٌ
  });

  test("arr1s: وصولُ HTTP يُعدُّ عندَ الدخولِ وطلباتُ المقاعدِ لحظةَ طلبِها، ولا يُصبُّ قبلَ انقضاءِ الثانيةِ", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "hr3-")), "trace");
    const trace = createLoadTrace(file);
    if (trace === null) throw new Error("الأثرُ معطَّل");
    const sql = withQueryDeadline(lazySql(10), {
      deadlineMs: 5_000,
      slots: 2,
      label: "ceezr:gatewayRequest",
    });
    const RID = "req-arr-1";
    await runWithCorrelation({ requestId: RID, entry: "gateway" }, async () => {
      await trace.inRoute("/v1/rides", "POST", async () => {
        await (sql`select 1` as unknown as Promise<unknown>);
        return fakeResponse(RID);
      });
      await trace.inRoute("/v1/rides", "POST", async () => fakeResponse(RID));
    });
    await trace.stop();
    const all = rows(file);
    const httpArr = all.filter((r) => r.k === "arr1s" && r.cls === "http");
    const seatArr = all.filter((r) => r.k === "arr1s" && r.cls === "seat");
    expect(httpArr).toHaveLength(1);
    expect(httpArr[0]?.name).toBe("POST /v1/rides");
    expect(Number(httpArr[0]?.n)).toBe(2); // نداءانِ عندَ الدخولِ — لا اكتمالاتٍ
    expect(seatArr).toHaveLength(1);
    expect(seatArr[0]?.name).toBe("ceezr:gatewayRequest");
    expect(Number(seatArr[0]?.n)).toBe(1);
  });

  test("arr1s: حجزٌ يبدأُ قبلَ التفريغِ وينتهي بعدَهُ — يُحتسَبُ مرةً واحدةً في ثانيتِهِ، لا فقدَ ولا استبدالَ عدٍّ سابق", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "hr4-")), "trace");
    const trace = createLoadTrace(file);
    if (trace === null) throw new Error("الأثرُ معطّل");
    // الاصطفافُ بعيدًا عن حدودِ الثواني: الوصولانِ (السريعُ والمتأخرُ المشتقُّ) في الثانيةِ نفسِها حتمًا.
    while (Date.now() % 1000 < 250 || Date.now() % 1000 > 750) {
      await new Promise((r) => setTimeout(r, 25));
    }
    const S = Math.floor(Date.now() / 1000) * 1000; // ثانيةُ وصولِ الاثنينِ
    const sqlFast = withQueryDeadline(lazySql(10), {
      deadlineMs: 10_000,
      slots: 2,
      label: "ceezr:gatewayRequest",
    });
    const sqlSlow = withQueryDeadline(lazySql(5_100), {
      deadlineMs: 10_000,
      slots: 2,
      label: "ceezr:gatewayRequest",
    });
    // الحجزُ المتأخرُ: يُطلَبُ الآنَ (ثانيةُ S) ويحسمُ بعدَ التفريغِ الدوريِّ (~5ث) — وصولُهُ مشتقٌّ إلى S.
    const fast = sqlFast`select 1` as unknown as Promise<unknown>;
    const slow = sqlSlow`select 2` as unknown as Promise<unknown>;
    await fast;
    await slow; // التفريغُ الدوريُّ (5ث) يمرُّ أثناءَ حياةِ هذا الحجزِ ويصبُّ ثانيةَ S أولًا
    await trace.stop();
    const all = rows(file);
    const seatArr = all.filter((r) => r.k === "arr1s" && r.cls === "seat");
    // صفّانِ للثانيةِ نفسِها: المتأخرُ لم يستبدلْ عدَّ الأولِ (صُفّانِ لا صفٌّ واحدٌ بِنِ2) ولم يُفقدْ.
    expect(seatArr).toHaveLength(2);
    expect(seatArr.every((r) => Number(r.at) === S)).toBe(true); // الثانيةُ الصحيحةُ لا غيرُها
    expect(seatArr.every((r) => Number(r.n) === 1)).toBe(true); // كلٌّ مرةً واحدةً — لا مضاعفةَ
    // المستهلكُ الفعليُّ (readTraceDiag — قارئُ تقريرِ الموجةِ) يقرأُ الملفَّ ويجمعُ الصفوفَ:
    // لا إعادةَ تنفيذٍ للجمعِ داخلَ الاختبارِ. الصفّانِ يُجمَعانِ في مفتاحٍ واحدٍ بقيمةِ 2.
    const { readTraceDiag } = await import("../../deploy/capacity-run/load/wave-report.ts");
    const diag = readTraceDiag(`${file}.load.jsonl`, []) as {
      arr1s: { cls: string; name: string; n: number }[];
    } | null;
    expect(diag).not.toBeNull();
    const consumed = diag?.arr1s.filter((a) => a.cls === "seat") ?? [];
    expect(consumed).toHaveLength(1);
    expect(consumed[0]?.name).toBe("ceezr:gatewayRequest");
    expect(consumed[0]?.n).toBe(2); // مرةً واحدةً لكلٍّ — لا فقدَ ولا مضاعفةَ ولا استبدالَ
  }, 20_000);

  test("السلسلةُ عبرَ التطبيقِ والوسيطِ والنداءِ الحقيقيِّ: http_call ← httpreq ← pseat ومصالحةٌ كاملةٌ", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "hr6-")), "trace");
    const trace = createLoadTrace(file);
    if (trace === null) throw new Error("الأثرُ معطّل");
    const runDir = mkdtempSync(join(tmpdir(), "hc3-"));
    mkdirSync(`${runDir}/evidence`, { recursive: true });
    // معاملةٌ تحجزُ مقعدًا واحدًا (kind=tx) واستعلاماتُها الداخليّةُ (txQuery) لا تحجزُ مقعدًا.
    const txInner = lazySql(15);
    const root = lazySql(25);
    (root as unknown as Record<string, unknown>).begin = async (fn: (s: unknown) => unknown) =>
      fn(txInner);
    const sql = withQueryDeadline(root, {
      deadlineMs: 5_000,
      slots: 2,
      label: "ceezr:gatewayRequest",
    });
    // التطبيقُ الحقيقيُّ عبرَ createServer — بوسيطِ المعرّفِ الحقيقيِّ — ومُعالجُ الويبهوكِ
    // يشغّلُ المعاملةَ عبرَ الـsql المُلفوفِ داخلَ سياقِ الطلبِ.
    const app = createServer({
      health: { now: () => new Date(0), startedAt: new Date(0), env: {} },
      webhook: {
        webhookSecret: "test-webhook-secret",
        handler: {
          handle: async () => {
            await (sql.begin(async (tx) => {
              await (tx`select 1` as unknown as Promise<unknown>);
              await (tx`select 2` as unknown as Promise<unknown>);
            }) as unknown as Promise<unknown>);
            return true;
          },
        },
      },
    });
    // كما في index.ts: inRoute يلفُّ fetch التطبيقِ. الخادمُ الحقيقيُّ يصغي على قاعدةِ BASE
    // الافتراضيّةِ (54300) فيصلُهُ نداءُ العميلِ الحقيقيُّ عبرَ الشبكةِ.
    const server = Bun.serve({
      port: 54300,
      fetch: (req) => {
        const { pathname } = new URL(req.url);
        return trace.inRoute(pathname, req.method, async () => app.fetch(req));
      },
    });
    const prevRun = process.env.RUN_DIR;
    const prevTrace = process.env.DISPATCH_TRACE_FILE;
    process.env.RUN_DIR = runDir;
    process.env.DISPATCH_TRACE_FILE = file;
    // نداءُ العميلِ الحقيقيُّ للمولّدِ: http يستخرجُ X-Request-Id منَ رأسِ الردِّ، وcall
    // يكتبُ صفَّ http_call بنفسِهِ — لا HttpResult يدويٌّ ولا معرّفٌ مُمرَّرٌ.
    const { call } = await import("../../deploy/capacity-run/load/miniapp-load.ts");
    const result = await call("/webhook/telegram/rider", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "test-webhook-secret",
      },
      body: { update_id: 1, message: {} },
    });
    await trace.stop();
    if (prevRun === undefined) delete process.env.RUN_DIR;
    else process.env.RUN_DIR = prevRun;
    if (prevTrace === undefined) delete process.env.DISPATCH_TRACE_FILE;
    else process.env.DISPATCH_TRACE_FILE = prevTrace;
    server.stop(true);
    // السلسلةُ كاملةً بمعرّفٍ واحدٍ ولّدَهُ الوسيطُ الحقيقيُّ واستخرجَهُ العميلُ الحقيقيُّ.
    expect(result.status).toBe(200);
    expect(result.requestId).toBeTruthy();
    const all = rows(file);
    const httpreq = all.filter((r) => r.k === "httpreq");
    expect(httpreq).toHaveLength(1);
    expect(httpreq[0]?.requestId).toBe(result.requestId);
    expect(Number(httpreq[0]?.gateAcquisitions)).toBe(1); // المعاملةُ حجزت؛ الداخليّةُ لا تحجزُ
    const pseat = all.filter((r) => r.k === "pseat");
    expect(pseat).toHaveLength(1); // حجزُ المعاملةِ (tx) وحده — لا txQuery
    expect(pseat[0]?.kind).toBe("tx");
    expect(pseat[0]?.requestId).toBe(result.requestId); // انسابَ عبرَ سياقِ الوسيطِ الحقيقيِّ
    expect(pseat[0]?.path).toBe("http:POST /webhook/telegram/rider");
    const callLines = readFileSync(`${runDir}/evidence/load-events.jsonl`, "utf8")
      .split("\n")
      .filter((l) => l !== "");
    const httpCall = callLines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((r) => r.event === "http_call");
    expect(httpCall).toHaveLength(1);
    expect(httpCall[0]?.requestId).toBe(result.requestId); // كتبَهُ نداءُ العميلِ الحقيقيُّ
    // المصالحةُ الكاملةُ بالاتجاهينِ: مفاتيحُ (pool, kind) في pseat == مفاتيحُ pagg
    // المؤهّلةُ (غيرِ txQuery) تمامًا — لا مفتاحًا زائدًا في أيٍّ من الجهتينِ — والأعدادُ متساويةٌ.
    const pagg = all.filter(
      (r) => r.k === "pagg" && r.path === "http:POST /webhook/telegram/rider",
    );
    const eligible = pagg.filter((g) => g.kind !== "txQuery");
    expect(eligible.length).toBeGreaterThan(0);
    const pseatBy = new Map<string, number>();
    for (const p of pseat) {
      const k = `${p.pool}|${p.kind}`;
      pseatBy.set(k, (pseatBy.get(k) ?? 0) + 1);
    }
    const eligibleBy = new Map<string, number>();
    for (const g of eligible) {
      const k = `${g.pool}|${g.kind}`;
      eligibleBy.set(k, (eligibleBy.get(k) ?? 0) + Number(g.n));
    }
    expect([...pseatBy.entries()].sort()).toEqual([...eligibleBy.entries()].sort());
  }, 20_000);
});

describe("LOAD-01 — عمودُ العميلِ (http_call)", () => {
  test("خلفَ DISPATCH_TRACE_FILE: بلا علمٍ لا سطرَ، وبالعلمِ سطرٌ فرديٌّ لكلِّ نداءٍ — لا جمعَ", async () => {
    const runDir = mkdtempSync(join(tmpdir(), "hc1-"));
    mkdirSync(`${runDir}/evidence`, { recursive: true });
    const prevRun = process.env.RUN_DIR;
    const prevTrace = process.env.DISPATCH_TRACE_FILE;
    process.env.RUN_DIR = runDir;
    // استيرادٌ ديناميكيٌّ بعدَ ضبطِ RUN_DIR: EV ثابتٌ يُحلَّ عندَ تحميلِ الوحدةِ.
    const { PathRecorder } = await import("../../deploy/capacity-run/load/lib.ts");
    const rec = new PathRecorder({ path: "miniapp_http", gen: "genT" });
    const result = {
      status: 200,
      ok: true,
      is429: false,
      elapsedMs: 123.456,
      body: null,
      networkError: null,
      requestId: "req-cli-1",
      ttfbMs: 100.5,
      bodyMs: 22.96,
      invokeMs: 0.31,
      inflightAtInvoke: 7,
      headersOverdueMs: 2.25,
      queueWaitMs: 4.5,
      waitersAtInvoke: 3,
      activeAtSend: 256,
      demandAtInvoke: 260,
      fetchCap: 256,
    };
    // بلا علمٍ (حالةُ OFF): لا سطرَ عميلٍ — فحصُ ON–OFF يقيسُ كلفةَ الأداةِ في الجانبينِ معًا.
    delete process.env.DISPATCH_TRACE_FILE;
    rec.httpCallLog("rides_create", result);
    expect(existsSync(`${runDir}/evidence/load-events.jsonl`)).toBe(false);
    // بالعلمِ (حالةُ ON): سطرٌ فرديٌّ بمعرّفِ الطلبِ وزمنِ العميلِ.
    process.env.DISPATCH_TRACE_FILE = "/tmp/load-trace-on.jsonl";
    rec.httpCallLog("rides_create", result);
    const lines = readFileSync(`${runDir}/evidence/load-events.jsonl`, "utf8")
      .split("\n")
      .filter((l) => l !== "");
    expect(lines).toHaveLength(1);
    const row = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(row.event).toBe("http_call");
    expect(row.label).toBe("rides_create");
    expect(row.requestId).toBe("req-cli-1");
    expect(row.status).toBe(200);
    expect(row.elapsedMs).toBe(123.46); // مقرَّبًا إلى سنتي الميلي ثانيةِ
    if (prevRun === undefined) delete process.env.RUN_DIR;
    else process.env.RUN_DIR = prevRun;
    if (prevTrace === undefined) delete process.env.DISPATCH_TRACE_FILE;
    else process.env.DISPATCH_TRACE_FILE = prevTrace;
  });
});

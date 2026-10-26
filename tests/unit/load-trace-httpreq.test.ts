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
import { Hono } from "hono";
import type postgres from "postgres";
import { enableLoadPathScope } from "../../apps/gateway/src/background/load-path-scope.ts";
import { createLoadTrace } from "../../apps/gateway/src/background/load-trace.ts";
import {
  createRequestIdMiddleware,
  REQUEST_ID_HEADER,
} from "../../apps/gateway/src/observability/request-id.ts";
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
    // المستهلكُ (readTraceDiag) يجمعُ الصفوفَ: المجموعُ 2 لا أكثرَ ولا أقلَّ.
    const consumed = seatArr.reduce((s, r) => s + Number(r.n), 0);
    expect(consumed).toBe(2);
  }, 20_000);

  test("الربطُ عبرَ الوسيطِ الحقيقيِّ: http_call ← httpreq ← pseat بمعرّفٍ واحدٍ ومصالحةُ الحجوزاتِ المؤهّلةِ", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "hr5-")), "trace");
    const trace = createLoadTrace(file);
    if (trace === null) throw new Error("الأثرُ معطّل");
    const sql = withQueryDeadline(lazySql(30), {
      deadlineMs: 5_000,
      slots: 2,
      label: "ceezr:gatewayRequest",
    });
    // التطبيقُ والوسيطُ الحقيقيّانِ: الوسيطُ يولّدُ المعرّفَ ويربطُ السياقَ ويُلحقُ الرأسَ — كما في server.ts،
    // والدخولُ عبرَ inRoute كما في index.ts — لا runWithCorrelation يدويٍّ ولا معرّفٍ مُمرَّرٍ.
    const app = new Hono();
    app.use(createRequestIdMiddleware());
    app.post("/v1/rides", async (c) => {
      await (sql`select 1` as unknown as Promise<unknown>);
      return c.json({ ok: true });
    });
    const response = await trace.inRoute("/v1/rides", "POST", async () =>
      app.fetch(new Request("http://gateway/v1/rides", { method: "POST" })),
    );
    const rid = response.headers.get(REQUEST_ID_HEADER);
    expect(rid).toBeTruthy(); // الوسيطُ الحقيقيُّ ولّدَهُ وألحقَهُ
    // عمودُ العميلِ: http_call بمعرّفِ الردِّ الفعليِّ — كما يقرؤُهُ المولّدُ منَ الرأسِ.
    const runDir = mkdtempSync(join(tmpdir(), "hc2-"));
    mkdirSync(`${runDir}/evidence`, { recursive: true });
    const prevRun = process.env.RUN_DIR;
    const prevTrace = process.env.DISPATCH_TRACE_FILE;
    process.env.RUN_DIR = runDir;
    process.env.DISPATCH_TRACE_FILE = file;
    const { PathRecorder } = await import("../../deploy/capacity-run/load/lib.ts");
    const rec = new PathRecorder({ path: "miniapp_http", gen: "genT" });
    rec.httpCallLog("rides_create", {
      status: response.status,
      ok: response.ok,
      is429: false,
      elapsedMs: 100,
      body: null,
      networkError: null,
      requestId: rid,
    });
    await trace.stop();
    if (prevRun === undefined) delete process.env.RUN_DIR;
    else process.env.RUN_DIR = prevRun;
    if (prevTrace === undefined) delete process.env.DISPATCH_TRACE_FILE;
    else process.env.DISPATCH_TRACE_FILE = prevTrace;
    // السلسلةُ كاملةً بمعرّفٍ واحدٍ: http_call ← httpreq ← pseat
    const all = rows(file);
    const httpreq = all.filter((r) => r.k === "httpreq");
    expect(httpreq).toHaveLength(1);
    expect(httpreq[0]?.requestId).toBe(rid); // من رأسِ الردِّ الفعليِّ الذي ولّدَهُ الوسيطُ
    const pseat = all.filter((r) => r.k === "pseat");
    expect(pseat).toHaveLength(1);
    expect(pseat[0]?.requestId).toBe(rid); // انسابَ عبرَ سياقِ الارتباطِ الذي أنشأَهُ الوسيطُ الحقيقيُّ
    expect(pseat[0]?.path).toBe("http:POST /v1/rides");
    const callLines = readFileSync(`${runDir}/evidence/load-events.jsonl`, "utf8")
      .split("\n")
      .filter((l) => l !== "");
    const httpCall = callLines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(httpCall).toHaveLength(1);
    expect(httpCall[0]?.requestId).toBe(rid);
    // المصالحةُ بحسبِ التجمّعِ والنوعِ: كلُّ حجزٍ مؤهّلٍ للنطاقِ الـHTTP (غيرِ txQuery) مسجّلٌ فردًّا
    // منسوبًا — عددُ pseat = مجموعُ حجوزاتِ المسارِ في pagg لكلِّ (pool, kind).
    const pagg = all.filter(
      (r) => r.k === "pagg" && r.path === "http:POST /v1/rides" && r.kind !== "txQuery",
    );
    expect(pagg).toHaveLength(1);
    const byKey = new Map<string, number>();
    for (const p of pseat) {
      const k = `${p.pool}|${p.kind}`;
      byKey.set(k, (byKey.get(k) ?? 0) + 1);
    }
    for (const g of pagg) {
      expect(byKey.get(`${g.pool}|${g.kind}`)).toBe(Number(g.n));
    }
  });
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

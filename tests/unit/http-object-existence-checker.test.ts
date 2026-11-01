/**
 * الغرض: تصنيفُ HttpObjectExistenceChecker لثلاثِ حالات — موجود، غائب، تعذُّرُ الفحص (WR-21).
 * الأشكالُ مأخوذةٌ من قياسٍ حيٍّ على `supabase/storage-api` في CasaOS (2026-11-01):
 *   HEAD غائب = 400 بلا جسم؛ GET غائب = 400 `{"code":"NoSuchKey"}`؛
 *   مفتاحٌ خاطئ أو دلوٌ غائب = 400 `{"code":"NoSuchBucket"}` لـHEAD وGET معًا.
 */
import { describe, expect, it } from "bun:test";
import { HttpObjectExistenceChecker } from "../../packages/infrastructure/storage/object-existence-checker.ts";

type Reply = Response | Error;

function checkerWith(replies: { readonly HEAD: Reply; readonly GET?: Reply }) {
  const calls: Array<{ method: string; range: string | null }> = [];
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    calls.push({ method, range: headers.get("range") });
    const reply = method === "HEAD" ? replies.HEAD : replies.GET;
    if (reply === undefined) throw new Error("unexpected call");
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const checker = new HttpObjectExistenceChecker({
    baseUrl: "http://storage.test",
    secretKey: "k",
    bucket: "driver-documents",
    fetch: fetch as never,
  });
  return { checker, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const noSuchKey = () => json(400, { statusCode: "404", error: "not_found", code: "NoSuchKey" });
const noSuchBucket = () =>
  json(400, { statusCode: "404", error: "Bucket not found", code: "NoSuchBucket" });
const path = { objectPath: "driver-1/license.jpg" };

describe("HttpObjectExistenceChecker — تصنيفُ الحالاتِ الثلاث", () => {
  it("موجود: HEAD 200 ⇒ ok(true) بلا GET", async () => {
    const { checker, calls } = checkerWith({ HEAD: new Response(null, { status: 200 }) });
    expect(await checker.checkExists(path)).toEqual({ ok: true, value: true });
    expect(calls.map((c) => c.method)).toEqual(["HEAD"]);
  });

  it("غائب (Supabase المستضاف): HEAD 404 ⇒ ok(false)", async () => {
    const { checker } = checkerWith({ HEAD: new Response(null, { status: 404 }) });
    expect(await checker.checkExists(path)).toEqual({ ok: true, value: false });
  });

  it("غائب (storage-api ذاتيّ): HEAD 400 ثمّ GET NoSuchKey ⇒ ok(false)، والـGET لبايتٍ واحد", async () => {
    const { checker, calls } = checkerWith({
      HEAD: new Response(null, { status: 400 }),
      GET: noSuchKey(),
    });
    expect(await checker.checkExists(path)).toEqual({ ok: true, value: false });
    expect(calls).toEqual([
      { method: "HEAD", range: null },
      { method: "GET", range: "bytes=0-0" },
    ]);
  });

  it("تعذّر: مفتاحٌ خاطئٌ أو دلوٌ غائب (NoSuchBucket) ⇒ CHECKER_UNAVAILABLE لا غياب", async () => {
    const { checker } = checkerWith({
      HEAD: new Response(null, { status: 400 }),
      GET: noSuchBucket(),
    });
    expect(await checker.checkExists(path)).toEqual({ ok: false, error: "CHECKER_UNAVAILABLE" });
  });

  it("تعذّر: جسمٌ غيرُ مفهومٍ بعدَ 400 ⇒ CHECKER_UNAVAILABLE", async () => {
    const { checker } = checkerWith({
      HEAD: new Response(null, { status: 400 }),
      GET: new Response("<html>bad gateway</html>", { status: 400 }),
    });
    expect(await checker.checkExists(path)).toEqual({ ok: false, error: "CHECKER_UNAVAILABLE" });
  });

  it("تعذّر: شبكةٌ تسقطُ في HEAD أو في GET ⇒ CHECKER_UNAVAILABLE", async () => {
    const a = checkerWith({ HEAD: new Error("ECONNREFUSED") });
    expect(await a.checker.checkExists(path)).toEqual({ ok: false, error: "CHECKER_UNAVAILABLE" });
    const b = checkerWith({ HEAD: new Response(null, { status: 400 }), GET: new Error("timeout") });
    expect(await b.checker.checkExists(path)).toEqual({ ok: false, error: "CHECKER_UNAVAILABLE" });
  });

  it("تعذّر: 5xx أو 401/403 ⇒ CHECKER_UNAVAILABLE بلا GET", async () => {
    for (const status of [500, 502, 401, 403]) {
      const { checker, calls } = checkerWith({ HEAD: new Response(null, { status }) });
      expect(await checker.checkExists(path)).toEqual({ ok: false, error: "CHECKER_UNAVAILABLE" });
      expect(calls.length).toBe(1);
    }
  });

  it("سباق: HEAD 400 ثمّ ظهرَ الكائنُ (GET 206) ⇒ ok(true)", async () => {
    const { checker } = checkerWith({
      HEAD: new Response(null, { status: 400 }),
      GET: new Response("x", { status: 206 }),
    });
    expect(await checker.checkExists(path)).toEqual({ ok: true, value: true });
  });
});

/**
 * `WR-21` على CasaOS (ADR 0294) — الرابطُ المسلَّمُ للعميلِ من مسارِ المخزنِ النسبيّ.
 * الشكلُ `/object/…` مقيسٌ من `supabase/storage-api:v1.84.36` في 2026-10-30.
 */
import { describe, expect, it } from "bun:test";
import {
  readPublicStorageUrl,
  resolveStorageClientUrl,
} from "../../packages/infrastructure/storage/client-url.ts";
import { HttpReadSigner } from "../../packages/infrastructure/storage/signed-read.ts";
import { HttpUploadSigner } from "../../packages/infrastructure/storage/signed-upload.ts";
import type { FetchLike } from "../../packages/shared/wasla/egress-gate.ts";

const INTERNAL = "http://lb:8090";
const PUBLIC = "https://trial.trycloudflare.com";

describe("resolveStorageClientUrl", () => {
  it("مسارُ storage-api النسبيُّ (`/object/…`) يُعادُ تحتَ `/storage/v1`", () => {
    const url = resolveStorageClientUrl("/object/upload/sign/b/a.jpg?token=t", INTERNAL);
    expect(url?.toString()).toBe(`${INTERNAL}/storage/v1/object/upload/sign/b/a.jpg?token=t`);
  });

  it("مسارٌ يحملُ البادئةَ يبقى كما هو", () => {
    const url = resolveStorageClientUrl("/storage/v1/object/sign/b/a.jpg?token=t", INTERNAL);
    expect(url?.toString()).toBe(`${INTERNAL}/storage/v1/object/sign/b/a.jpg?token=t`);
  });

  it("الأصلُ العامُّ يُبدِّلُ الأصلَ وحدَه ويحفظُ المسارَ والرمز", () => {
    const url = resolveStorageClientUrl("/object/sign/b/a.jpg?token=t", INTERNAL, PUBLIC);
    expect(url?.toString()).toBe(`${PUBLIC}/storage/v1/object/sign/b/a.jpg?token=t`);
  });

  it("أصلٌ غريبٌ في الجوابِ يُرفَضُ — ولو ضُبِطَ أصلٌ عامّ", () => {
    expect(resolveStorageClientUrl("https://evil.example.net/object/x", INTERNAL)).toBeNull();
    expect(resolveStorageClientUrl("//evil.example.net/object/x", INTERNAL, PUBLIC)).toBeNull();
  });

  it("الأصلُ العامُّ من البيئةِ: `https` فقط، والشرطةُ الأخيرةُ تُحذَف", () => {
    expect(readPublicStorageUrl({ OBJECT_STORAGE_PUBLIC_URL: `${PUBLIC}/` })).toBe(PUBLIC);
    expect(readPublicStorageUrl({ OBJECT_STORAGE_PUBLIC_URL: "http://plain.example" })).toBe(
      undefined,
    );
    expect(readPublicStorageUrl({})).toBe(undefined);
  });
});

describe("المُوقِّعانِ بأصلٍ داخليٍّ وآخرَ عامّ", () => {
  const calls: string[] = [];
  const stub =
    (body: unknown): FetchLike =>
    async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

  it("الرفع: النداءُ إلى الداخليّ، والرابطُ المسلَّمُ بالعامّ", async () => {
    calls.length = 0;
    const signer = new HttpUploadSigner({
      baseUrl: INTERNAL,
      publicBaseUrl: PUBLIC,
      secretKey: "service",
      bucket: "driver-documents",
      fetch: stub({ url: "/object/upload/sign/driver-documents/d/a.jpg?token=t", token: "t" }),
    });
    const result = await signer.signUpload({
      objectPath: "d/a.jpg",
      contentType: "image/jpeg",
      ttlSeconds: 600,
    });
    expect(calls[0]?.startsWith(`${INTERNAL}/storage/v1/object/upload/sign/`)).toBe(true);
    expect(result.ok && result.value.uploadUrl).toBe(
      `${PUBLIC}/storage/v1/object/upload/sign/driver-documents/d/a.jpg?token=t`,
    );
  });

  it("القراءة: النداءُ إلى الداخليّ، والرابطُ المسلَّمُ بالعامّ", async () => {
    calls.length = 0;
    const signer = new HttpReadSigner({
      baseUrl: INTERNAL,
      publicBaseUrl: PUBLIC,
      secretKey: "service",
      bucket: "driver-documents",
      fetch: stub({ signedURL: "/object/sign/driver-documents/d/a.jpg?token=r" }),
    });
    const result = await signer.signRead({ objectPath: "d/a.jpg", ttlSeconds: 120 });
    expect(calls[0]?.startsWith(`${INTERNAL}/storage/v1/object/sign/`)).toBe(true);
    expect(result.ok && result.value.readUrl).toBe(
      `${PUBLIC}/storage/v1/object/sign/driver-documents/d/a.jpg?token=r`,
    );
  });
});

describe("بوّابةُ الصادرِ الافتراضيّةُ تقرأُ مضيفَ المخزنِ من البيئة", () => {
  // بلا `{ env: process.env }` كانت البوّابةُ تقرأُ بيئةً فارغة، فتُجيزُ الحلقةَ الراجعةَ وحدَها
  // وترفضُ `lb` (UNDECLARED_HOST) ⇒ SIGNER_UNAVAILABLE على CasaOS (مقيسٌ 2026-10-30).
  it("مُوقِّعُ الرفعِ بلا جالبٍ محقونٍ يبلغُ مضيفًا غيرَ محلّيٍّ مضبوطًا في OBJECT_STORAGE_URL", async () => {
    const savedFetch = globalThis.fetch;
    const savedUrl = process.env.OBJECT_STORAGE_URL;
    const seen: string[] = [];
    process.env.OBJECT_STORAGE_URL = INTERNAL;
    globalThis.fetch = (async (input: unknown) => {
      seen.push(String(input));
      return new Response(
        JSON.stringify({ url: "/object/upload/sign/driver-documents/d/a.jpg?token=t", token: "t" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;
    try {
      const signer = new HttpUploadSigner({
        baseUrl: INTERNAL,
        secretKey: "service",
        bucket: "driver-documents",
      });
      const result = await signer.signUpload({
        objectPath: "d/a.jpg",
        contentType: "image/jpeg",
        ttlSeconds: 600,
      });
      expect(result.ok).toBe(true);
      expect(seen[0]?.startsWith(`${INTERNAL}/storage/v1/`)).toBe(true);
    } finally {
      globalThis.fetch = savedFetch;
      if (savedUrl === undefined) delete process.env.OBJECT_STORAGE_URL;
      else process.env.OBJECT_STORAGE_URL = savedUrl;
    }
  });
});

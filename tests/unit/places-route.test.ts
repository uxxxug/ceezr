/**
 * الغرض: اختبارُ مساراتِ الأماكنِ المحفوظةِ وآخرِ الوجهاتِ على خادمِ البوابةِ
 *   الحقيقيِّ نفسِه (`F2-02`): القبولُ، وكلُّ رفضٍ برمزِه ورقمِه، وأنَّ الهويّةَ
 *   **لا تُقرأُ من الطلبِ** بأيِّ وجهٍ، وأنَّ `city_id` لا موضعَ له في البابِ،
 *   وأنَّ التعطيلَ معلَنٌ (`503`) عندَ غيابِ التبعياتِ لا جسمٌ فارغٌ (`200`).
 * الحالة: اختبار فعلي — Hono يعالجُ الطلبَ في العمليةِ نفسِها بلا شبكةٍ ولا قاعدةٍ.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: `DELETE /v1/me/places/:id` عقدٌ غيرُ معلَنٍ اليومَ فلا يُختبَرُ.
 *
 * والمُدخلاتُ مُصنَّعةٌ: **المُتحقَّقُ منه هو التشغيلُ لا مصداقيةُ المدخلِ**؛
 * وذرّيّةُ الكتابةِ وحكمُ الفهرسِ الفريدِ يُثبَتانِ في اختبارِ التكاملِ على
 * PostgreSQL حقيقيٍّ (`tests/integration/me-places.test.ts`) لا ههنا.
 */

import { describe, expect, it } from "bun:test";
import { createServer } from "../../apps/gateway/src/server.ts";
import type {
  RecentDestination,
  RecentDestinationReader,
  SavedPlace,
  SavedPlaceReader,
  SavedPlaceWriter,
  SavePlaceCommand,
} from "../../packages/application/places/ports.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import { err, ok } from "../../packages/shared/result/index.ts";
import { createTestRevocationStore } from "../helpers/revocation-store.ts";

const SESSION_SECRET = "test-only-session-signing-secret-0123456789";
const WEBHOOK_SECRET = "test-webhook-secret-value";
const NOW = new Date("2027-03-01T09:00:00.000Z");
const TELEGRAM_ID = "5550001";

const FULL_ENV: Record<string, string> = {
  SUPABASE_URL: "https://example.supabase.co",
  DATABASE_URL: "postgres://user:pass@localhost:5432/postgres",
  SUPABASE_SERVICE_ROLE_KEY: "x",
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "x",
  DRIVER_BOT_TOKEN: "x",
  RIDER_BOT_TOKEN: "x",
  TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
  BOOTSTRAP_ADMIN_TELEGRAM_ID: "900000",
};

interface Harness {
  readonly app: ReturnType<typeof createServer>;
  readonly rows: SavedPlace[];
  readonly writes: SavePlaceCommand[];
  readonly readIds: string[];
  readonly recentCalls: { id: string; limit: number }[];
}

type StoreMode = "ok" | "user_not_found" | "store_error";

const RECENT: readonly RecentDestination[] = [
  { label: "مطار جدة", lat: 21.68, lng: 39.15, lastUsedAtMs: NOW.getTime() - 3_600_000 },
];

function buildHarness(
  options: {
    readonly seed?: readonly SavedPlace[];
    readonly mode?: StoreMode;
    readonly mounted?: boolean;
    readonly configured?: boolean;
  } = {},
): Harness {
  const rows: SavedPlace[] = [...(options.seed ?? [])];
  const writes: SavePlaceCommand[] = [];
  const readIds: string[] = [];
  const recentCalls: { id: string; limit: number }[] = [];
  const mode = options.mode ?? "ok";

  const failure = (): { code: "PLACE_STORE_FAILED"; reason: "USER_NOT_FOUND" | "STORE_ERROR" } => ({
    code: "PLACE_STORE_FAILED",
    reason: mode === "user_not_found" ? "USER_NOT_FOUND" : "STORE_ERROR",
  });

  const reader: SavedPlaceReader = {
    listForTelegramUser: async (telegramUserId) => {
      readIds.push(telegramUserId);
      if (mode !== "ok") return err(failure());
      return ok(rows);
    },
  };

  const writer: SavedPlaceWriter = {
    save: async (command) => {
      writes.push(command);
      if (mode !== "ok") return err(failure());
      const index = rows.findIndex(
        (r) => r.kind === command.kind && (command.kind === "home" || command.kind === "work"),
      );
      const place: SavedPlace = {
        id: index >= 0 ? (rows[index] as SavedPlace).id : `place-${rows.length + 1}`,
        kind: command.kind,
        label: command.label,
        lat: command.lat,
        lng: command.lng,
        updatedAtMs: NOW.getTime(),
      };
      if (index >= 0) {
        rows[index] = place;
        return ok({ status: "updated", place });
      }
      rows.push(place);
      return ok({ status: "created", place });
    },
  };

  const recent: RecentDestinationReader = {
    listForTelegramUser: async (telegramUserId, limit) => {
      recentCalls.push({ id: telegramUserId, limit });
      if (mode !== "ok") return err(failure());
      return ok(RECENT.slice(0, limit));
    },
  };

  const places = {
    sessions: createMiniAppSessionReader(SESSION_SECRET),
    revocation: createTestRevocationStore(),
    reader,
    writer,
    recent,
    now: () => NOW,
  };
  const mounted =
    options.mounted === false ? undefined : { ...(options.configured === false ? {} : { places }) };

  const app = createServer({
    health: { now: () => NOW, startedAt: NOW, env: FULL_ENV },
    webhook: { webhookSecret: WEBHOOK_SECRET, handler: { handle: async () => true } },
    ...(mounted === undefined ? {} : { places: mounted }),
  });
  return { app, rows, writes, readIds, recentCalls };
}

function tokenFor(telegramUserId: string = TELEGRAM_ID): string {
  const issued = createMiniAppSessionIssuer({ secret: SESSION_SECRET }).issue(
    { telegramUserId, bot: "rider", authDateSeconds: Math.floor(NOW.getTime() / 1000) },
    NOW.getTime(),
  );
  if (!issued.ok) throw new Error("إصدار فاشل");
  return issued.value.accessToken;
}

function authed(token: string = tokenFor()): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

async function call(
  harness: Harness,
  init: {
    readonly path: string;
    readonly method: "GET" | "POST";
    readonly headers?: Record<string, string>;
    readonly body?: unknown;
    readonly rawBody?: string;
  },
): Promise<{ status: number; json: Record<string, unknown> }> {
  const hasBody = init.rawBody !== undefined || init.body !== undefined;
  const response = await harness.app.fetch(
    new Request(`http://localhost${init.path}`, {
      method: init.method,
      headers: {
        accept: "application/json",
        ...(hasBody ? { "content-type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
      ...(hasBody ? { body: init.rawBody ?? JSON.stringify(init.body) } : {}),
    }),
  );
  const text = await response.text();
  return { status: response.status, json: JSON.parse(text) as Record<string, unknown> };
}

const HOME_BODY = { kind: "home", label: "المنزل", lat: 21.5, lng: 39.2 };

describe("GET /v1/me/places", () => {
  it("١) يعيدُ الأماكنَ بختمٍ بـISO ويقرأُ بمعرّفِ الرمزِ الموقَّعِ لا بما في الطلبِ", async () => {
    const harness = buildHarness({
      seed: [
        {
          id: "p1",
          kind: "home",
          label: "المنزل",
          lat: 21.5,
          lng: 39.2,
          updatedAtMs: 1_700_000_000_000,
        },
      ],
    });
    const { status, json } = await call(harness, {
      path: "/v1/me/places",
      method: "GET",
      headers: { ...authed(), "x-telegram-user-id": "999999" },
    });

    expect(status).toBe(200);
    const places = json.places as { kind: string; updatedAt: string }[];
    expect(places).toHaveLength(1);
    expect(places[0]?.updatedAt).toBe(new Date(1_700_000_000_000).toISOString());
    // الترويسةُ المزروعةُ لا أثرَ لها: المعرّفُ من الرمزِ وحدَه.
    expect(harness.readIds).toEqual([TELEGRAM_ID]);
  });

  it("٢) يردُّ 401 بلا رمزٍ، و401 برمزٍ موقَّعٍ بسرٍّ آخرَ", async () => {
    const harness = buildHarness();
    const bare = await call(harness, { path: "/v1/me/places", method: "GET" });
    expect(bare.status).toBe(401);
    expect(bare.json.error).toBe("SESSION_REQUIRED");

    const forged = createMiniAppSessionIssuer({ secret: `${SESSION_SECRET}-other` }).issue(
      { telegramUserId: TELEGRAM_ID, bot: "rider", authDateSeconds: 1 },
      NOW.getTime(),
    );
    if (!forged.ok) throw new Error("إصدار فاشل");
    const tampered = await call(harness, {
      path: "/v1/me/places",
      method: "GET",
      headers: { authorization: `Bearer ${forged.value.accessToken}` },
    });
    expect(tampered.status).toBe(401);
    expect(harness.readIds).toHaveLength(0);
  });

  it("٣) عطبُ المخزنِ 503 وغيابُ المستخدمِ 404 — ولا قائمةٌ فارغةٌ بـ200 في الحالتَينِ", async () => {
    const broken = await call(buildHarness({ mode: "store_error" }), {
      path: "/v1/me/places",
      method: "GET",
      headers: authed(),
    });
    expect(broken.status).toBe(503);
    expect(broken.json.error).toBe("PLACE_STORE_NOT_AVAILABLE");

    const missing = await call(buildHarness({ mode: "user_not_found" }), {
      path: "/v1/me/places",
      method: "GET",
      headers: authed(),
    });
    expect(missing.status).toBe(404);
    expect(missing.json.error).toBe("ACCOUNT_NOT_FOUND");
  });

  it("٤) المسارُ غيرُ مُركَّبٍ = 404، ومُركَّبٌ بلا تبعياتٍ = 503 معلَنٌ", async () => {
    const unmounted = await call(buildHarness({ mounted: false }), {
      path: "/v1/me/places",
      method: "GET",
      headers: authed(),
    });
    expect(unmounted.status).toBe(404);

    const disabled = await call(buildHarness({ configured: false }), {
      path: "/v1/me/places",
      method: "GET",
      headers: authed(),
    });
    expect(disabled.status).toBe(503);
    expect(disabled.json.error).toBe("PLACE_STORE_NOT_AVAILABLE");
  });
});

describe("POST /v1/me/places", () => {
  it("٥) يحفظُ المنزلَ ثمَّ يُحدِّثُه بلا صفٍّ ثانٍ، ولا يُمرِّرُ مدينةً ولا معرّفَ مستخدمٍ", async () => {
    const harness = buildHarness();
    const created = await call(harness, {
      path: "/v1/me/places",
      method: "POST",
      headers: authed(),
      body: HOME_BODY,
    });
    expect(created.status).toBe(200);
    expect(created.json.status).toBe("created");

    const updated = await call(harness, {
      path: "/v1/me/places",
      method: "POST",
      headers: authed(),
      body: { ...HOME_BODY, label: "بيتي الجديد", lat: 21.6 },
    });
    expect(updated.status).toBe(200);
    expect(updated.json.status).toBe("updated");
    expect(harness.rows).toHaveLength(1);

    // الأمرُ الذاهبُ إلى المنفذِ لا يحملُ إلّا ما هوَ موقَّعٌ وما هوَ من النطاقِ.
    expect(Object.keys(harness.writes[0] as object).sort()).toEqual(
      ["kind", "label", "lat", "lng", "telegramUserId"].sort(),
    );
    expect(harness.writes[0]?.telegramUserId).toBe(TELEGRAM_ID);
  });

  it("٦) يُهمِلُ ما يُرسَلُه العميلُ من هويّةٍ ومدينةٍ وختمٍ في الجسمِ", async () => {
    const harness = buildHarness();
    const { status } = await call(harness, {
      path: "/v1/me/places",
      method: "POST",
      headers: authed(),
      body: {
        ...HOME_BODY,
        cityId: "00000000-0000-0000-0000-000000000000",
        userId: "someone-else",
        telegramUserId: "777777",
        updatedAt: "2020-01-01T00:00:00.000Z",
      },
    });
    expect(status).toBe(200);
    const command = harness.writes[0] as unknown as Record<string, unknown>;
    expect(command.cityId).toBeUndefined();
    expect(command.userId).toBeUndefined();
    expect(command.telegramUserId).toBe(TELEGRAM_ID);
  });

  it("٧) نوعٌ مجهولٌ 400 برمزِه المفصولِ، ولافتةٌ أو إحداثيّةٌ مرفوضةٌ 400 MALFORMED", async () => {
    const harness = buildHarness();
    const cases: readonly [unknown, string][] = [
      [{ ...HOME_BODY, kind: "gym" }, "UNKNOWN_PLACE_KIND"],
      [{ ...HOME_BODY, kind: 7 }, "UNKNOWN_PLACE_KIND"],
      [{ ...HOME_BODY, label: "   " }, "MALFORMED"],
      [{ ...HOME_BODY, label: "ا".repeat(81) }, "MALFORMED"],
      [{ ...HOME_BODY, label: "بيت\u0007" }, "MALFORMED"],
      [{ ...HOME_BODY, lat: 91 }, "MALFORMED"],
      [{ ...HOME_BODY, lng: -181 }, "MALFORMED"],
      [{ ...HOME_BODY, lat: "21.5" }, "MALFORMED"],
      [{ ...HOME_BODY, lat: Number.NaN }, "MALFORMED"],
      [{ kind: "home", label: "المنزل" }, "MALFORMED"],
    ];
    for (const [body, error] of cases) {
      const { status, json } = await call(harness, {
        path: "/v1/me/places",
        method: "POST",
        headers: authed(),
        body,
      });
      expect(status).toBe(400);
      expect(json.error).toBe(error);
    }
    expect(harness.writes).toHaveLength(0);
  });

  it("٨) الصفرُ إحداثيّةٌ مقبولةٌ لا غيابٌ", async () => {
    const harness = buildHarness();
    const { status } = await call(harness, {
      path: "/v1/me/places",
      method: "POST",
      headers: authed(),
      body: { kind: "other", label: "خليجُ غينيا", lat: 0, lng: 0 },
    });
    expect(status).toBe(200);
    expect(harness.writes[0]?.lat).toBe(0);
  });

  it("٩) جسمٌ غيرُ JSON أو مصفوفةٌ أو أكبرُ من الحدِّ: 400 و400 و413", async () => {
    const harness = buildHarness();
    const broken = await call(harness, {
      path: "/v1/me/places",
      method: "POST",
      headers: authed(),
      rawBody: "{",
    });
    expect(broken.status).toBe(400);
    expect(broken.json.error).toBe("INVALID_JSON");

    const array = await call(harness, {
      path: "/v1/me/places",
      method: "POST",
      headers: authed(),
      body: [HOME_BODY],
    });
    expect(array.status).toBe(400);
    expect(array.json.error).toBe("INVALID_BODY");

    const huge = await call(harness, {
      path: "/v1/me/places",
      method: "POST",
      headers: authed(),
      rawBody: JSON.stringify({ ...HOME_BODY, label: "ا".repeat(4000) }),
    });
    expect(huge.status).toBe(413);
    expect(harness.writes).toHaveLength(0);
  });
});

describe("GET /v1/me/recent-destinations", () => {
  it("١٠) يعيدُ ثلاثاً افتراضاً بختمٍ بـISO ولا يقبلُ حدّاً خارجَ السقفِ", async () => {
    const harness = buildHarness();
    const fine = await call(harness, {
      path: "/v1/me/recent-destinations",
      method: "GET",
      headers: authed(),
    });
    expect(fine.status).toBe(200);
    expect(harness.recentCalls[0]).toEqual({ id: TELEGRAM_ID, limit: 3 });
    const destinations = fine.json.destinations as { label: string; lastUsedAt: string }[];
    expect(destinations[0]?.label).toBe("مطار جدة");
    expect(Number.isFinite(Date.parse(destinations[0]?.lastUsedAt ?? ""))).toBe(true);

    for (const limit of ["0", "11", "-1", "abc", "3.5", "1000"]) {
      const { status, json } = await call(harness, {
        path: `/v1/me/recent-destinations?limit=${limit}`,
        method: "GET",
        headers: authed(),
      });
      expect(status).toBe(400);
      expect(json.error).toBe("MALFORMED");
    }
    // حدٌّ مرفوضٌ **يُردُّ** ولا يُقصَرُ صامتاً: لا نداءَ مخزنٍ بعدَ الأوّلِ.
    expect(harness.recentCalls).toHaveLength(1);
  });

  it("١١) حدٌّ مقبولٌ يُمرَّرُ كما هوَ، والوجهاتُ لا تُكتَبُ بأيِّ مسارٍ", async () => {
    const harness = buildHarness();
    const { status } = await call(harness, {
      path: "/v1/me/recent-destinations?limit=1",
      method: "GET",
      headers: authed(),
    });
    expect(status).toBe(200);
    expect(harness.recentCalls[0]?.limit).toBe(1);

    const post = await call(harness, {
      path: "/v1/me/recent-destinations",
      method: "POST",
      headers: authed(),
      body: { label: "x" },
    });
    expect(post.status).toBe(404);
  });
});

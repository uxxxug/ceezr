/**
 * `WR-33` — تنبيهُ التحويلاتِ الماليّةِ المسبقة: الحارسُ في الخادم، وتمريرُ الإقرارِ عبرَ مساراتِ
 * الإنشاءِ كلِّها (HTTP للمشوارِ والتوصيل، وبوتُ الراكبِ للنقلِ والتوصيل)، وتركيبُ الإنتاجِ الذي
 * يلفُّ كلَّ منفذِ كتابةٍ بالحارس — فلا بابَ إنشاءٍ يتجاوزُه.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseDialogState } from "../../apps/gateway/src/bots/shared/redis-session.ts";
import { createMemorySessionStore } from "../../apps/gateway/src/bots/shared/session.ts";
import {
  handleRiderUpdate,
  type RiderBotDependencies,
} from "../../packages/application/bots/rider-dialog.ts";
import {
  INITIAL_STATE,
  type IncomingUpdate,
  type Sender,
} from "../../packages/application/bots/types.ts";
import { requestDelivery } from "../../packages/application/delivery/request-delivery.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import { requirePrepayWarningAck } from "../../packages/application/transport/prepay-warning-guard.ts";
import {
  requestRide,
  rideStoreErrorFrom,
} from "../../packages/application/transport/request-ride.ts";
import type { RideRequestCommand } from "../../packages/application/transport/ride-request-ports.ts";
import type { Order } from "../../packages/domain/transport/entity.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import type { OrderId, RiderId } from "../../packages/shared/kernel/index.ts";
import {
  isCurrentPrepayWarningAck,
  PREPAY_WARNING_ACK_VERSION,
} from "../../packages/shared/prepay-warning/index.ts";
import { ok } from "../../packages/shared/result/index.ts";
import {
  cityDirectory,
  JEDDAH,
  offerWriterDouble,
  orderWriter,
  riderDirectory,
} from "../support/bot-doubles.ts";
import {
  candidateRepo,
  fixedClock,
  offerRepo,
  orderRepo,
  seededRows,
  settingsRepo,
} from "../support/in-memory-ports.ts";

const ROOT = join(import.meta.dir, "..", "..");
const NOW = new Date("2026-11-03T09:00:00.000Z");
const ORDER_ID = "order-wr33" as OrderId;

/** منفذٌ داخليٌّ يسجّلُ ما يصلُه — لو ناداه الحارسُ بلا إقرارٍ لظهرَ هنا. */
function recordingCommand() {
  const calls: { key: string; service: string; ack: unknown }[] = [];
  const command: RideRequestCommand = {
    create: async (input) => {
      calls.push({
        key: input.idempotencyKey,
        service: input.service,
        ack: input.prepayWarningAck,
      });
      const reused = calls.filter((c) => c.key === input.idempotencyKey).length > 1;
      return ok({
        accepted: true,
        ride: { orderId: ORDER_ID, createdAtMs: NOW.getTime(), reused },
      });
    },
  };
  return { calls, command };
}

const BASE_INPUT = {
  telegramUserId: "500",
  idempotencyKey: "ride:wr33-key-1",
  service: "transport" as const,
  origin: { lat: 21.5433, lng: 39.1728 },
  destination: { lat: 21.5, lng: 39.2 },
  notes: null,
};

describe("WR-33 — الإصدارُ والحارس", () => {
  it("الإقرارُ الصالحُ هو رمزُ الإصدارِ الحاليِّ حرفًا — لا `true` ولا إصدارٌ قديمٌ ولا نصٌّ آخر", () => {
    expect(isCurrentPrepayWarningAck(PREPAY_WARNING_ACK_VERSION)).toBe(true);
    for (const bad of [
      undefined,
      null,
      true,
      1,
      "",
      "yes",
      "prepay-warning-v0",
      ` ${PREPAY_WARNING_ACK_VERSION}`,
    ]) {
      expect(isCurrentPrepayWarningAck(bad)).toBe(false);
    }
  });

  it("بلا إقرارٍ: رفضٌ بلا نداءٍ للمنفذِ الداخليّ (لا كتابة)؛ وبالإقرارِ: يمرُّ كما هو", async () => {
    const { calls, command } = recordingCommand();
    const guarded = requirePrepayWarningAck(command);
    for (const ack of [undefined, null, "prepay-warning-v0"]) {
      const refused = await guarded.create({ ...BASE_INPUT, prepayWarningAck: ack as never });
      expect(refused).toEqual({ ok: false, error: { reason: "PREPAY_WARNING_NOT_ACKNOWLEDGED" } });
    }
    expect(calls).toHaveLength(0);
    const passed = await guarded.create({
      ...BASE_INPUT,
      prepayWarningAck: PREPAY_WARNING_ACK_VERSION,
    });
    expect(passed.ok).toBe(true);
    expect(calls).toEqual([
      { key: BASE_INPUT.idempotencyKey, service: "transport", ack: PREPAY_WARNING_ACK_VERSION },
    ]);
  });

  it("الرفضُ يُترجَمُ إلى رمزٍ عامٍّ صريحٍ لا إلى «المخزنُ غيرُ متاح»", () => {
    expect(rideStoreErrorFrom({ reason: "PREPAY_WARNING_NOT_ACKNOWLEDGED" })).toBe(
      "PREPAY_WARNING_ACK_REQUIRED",
    );
  });
});

describe("WR-33 — `requestRide` (مسارُ `/v1/rides` و`/v1/deliveries`) يُمرِّرُ الإقرارَ ولا يحكمُ وحدَه", () => {
  const value = {
    telegramUserId: "500",
    bot: "rider" as const,
    sessionId: "session-wr33",
    issuedAtSeconds: Math.floor(NOW.getTime() / 1000),
    expiresAtSeconds: Math.floor(NOW.getTime() / 1000) + 3600,
  };
  const session = { read: async () => ok(value), readSync: () => ok(value) };
  const body = {
    service: "transport",
    originLat: 21.5433,
    originLng: 39.1728,
    destinationLat: 21.5,
    destinationLng: 39.2,
  };

  for (const service of ["transport", "delivery"] as const) {
    it(`${service}: الإقرارُ يصلُ المنفذَ، وغيابُه يصلُ \`null\` فيرفضُه الحارسُ برمزٍ صريح`, async () => {
      const { calls, command } = recordingCommand();
      const deps = {
        sessions: session as never,
        rides: requirePrepayWarningAck(command),
        now: () => NOW,
      };
      const extra = service === "delivery" ? { notes: "صندوق كتب" } : {};
      const withAck = await requestRide(deps, {
        accessToken: "token",
        idempotencyKey: `ride:${service}-wr33-1`,
        body: { ...body, ...extra, service, prepayWarningAck: PREPAY_WARNING_ACK_VERSION },
      });
      expect(withAck.ok).toBe(true);
      const without = await requestRide(deps, {
        accessToken: "token",
        idempotencyKey: `ride:${service}-wr33-2`,
        body: { ...body, ...extra, service },
      });
      expect(without).toEqual({ ok: false, error: "PREPAY_WARNING_ACK_REQUIRED" });
      expect(calls.map((c) => c.ack)).toEqual([PREPAY_WARNING_ACK_VERSION]);
    });
  }
});

describe("WR-33 — `requestDelivery` (توصيلُ البوت) يُمرِّرُ الإقرار", () => {
  it("بلا إقرارٍ ← `PortFailureError(rides, PREPAY_WARNING_NOT_ACKNOWLEDGED)`؛ وبه ← يُنشأ", async () => {
    const { calls, command } = recordingCommand();
    const deps = {
      rides: requirePrepayWarningAck(command),
      matching: {
        orders: orderRepo([]),
        offers: offerRepo([]),
        candidates: candidateRepo([]),
        settings: settingsRepo(seededRows(JEDDAH.id)),
        offerWriter: offerWriterDouble(),
        clock: fixedClock(NOW),
      },
    } as never;
    const input = {
      riderId: "rider-9" as RiderId,
      cityId: JEDDAH.id,
      pickup: { latitude: 21.5433, longitude: 39.1728 },
      dropoff: { latitude: 21.5, longitude: 39.2 },
      parcelDescription: "صندوق كتب",
    };
    const refused = await requestDelivery(input as never, deps, "telegram-update:500:1", "500");
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error).toBeInstanceOf(PortFailureError);
      expect((refused.error as PortFailureError).detail).toBe("PREPAY_WARNING_NOT_ACKNOWLEDGED");
    }
    const created = await requestDelivery(
      input as never,
      deps,
      "telegram-update:500:2",
      "500",
      PREPAY_WARNING_ACK_VERSION,
    );
    expect(created.ok).toBe(true);
    expect(calls).toEqual([
      { key: "telegram-update:500:2", service: "delivery", ack: PREPAY_WARNING_ACK_VERSION },
    ]);
  });
});

describe("WR-33 — بوتُ الراكب: التنبيهُ قبلَ المُدخَلِ الأخير، والحارسُ يسدُّ الجلساتِ القديمة", () => {
  const SENDER: Sender = { telegramUserId: "500", chatId: "500", languageHint: "ar" };
  const PICKUP = { latitude: 21.5433, longitude: 39.1728 };
  const DROPOFF = { latitude: 21.5, longitude: 39.2 };
  const REGISTERED = {
    id: "rider-9" as RiderId,
    cityId: JEDDAH.id,
    telegramUserId: "500",
    fullName: "سالم",
  };
  const ar = (key: string) => translate("ar", key);
  let updateId = 0;
  const location = (c: typeof PICKUP): IncomingUpdate => ({
    kind: "location",
    from: SENDER,
    updateId: ++updateId,
    location: c,
  });
  const text = (value: string): IncomingUpdate => ({
    kind: "text",
    from: SENDER,
    updateId: ++updateId,
    text: value,
  });

  let recorder: ReturnType<typeof recordingCommand>;
  let deps: RiderBotDependencies;

  function order(service: "transport" | "delivery"): Order {
    return {
      id: ORDER_ID,
      cityId: JEDDAH.id,
      service,
      status: "searching",
      pickup: PICKUP,
      dropoff: service === "delivery" ? DROPOFF : null,
      assignedDriverId: null,
      broadcastRound: 0,
    };
  }

  function build(service: "transport" | "delivery"): RiderBotDependencies {
    return {
      ...deps,
      matching: { ...deps.matching, orders: orderRepo([order(service)]) },
    };
  }

  beforeEach(() => {
    updateId = 0;
    recorder = recordingCommand();
    deps = {
      sessions: createMemorySessionStore(fixedClock(NOW)),
      riders: riderDirectory(REGISTERED),
      cities: cityDirectory([JEDDAH]),
      orders: orderWriter(ORDER_ID),
      // كما في `apps/gateway/src/container.ts`: المنفذُ ملفوفٌ بالحارس.
      rides: requirePrepayWarningAck(recorder.command),
      activeOrdersOf: async () => [],
      pastOrdersOf: async () => [],
      matching: {
        orders: orderRepo([order("transport")]),
        offers: offerRepo([]),
        candidates: candidateRepo([]),
        settings: settingsRepo(seededRows(JEDDAH.id)),
        offerWriter: offerWriterDouble(),
        clock: fixedClock(NOW),
      },
      clock: fixedClock(NOW),
    };
  });

  it("النقل: التنبيهُ رسالةٌ مستقلّةٌ قبلَ سؤالِ الوجهةِ مباشرةً، والإنشاءُ يحملُ الإقرار", async () => {
    const d = build("transport");
    await handleRiderUpdate(text("/ride"), d);
    const pickup = await handleRiderUpdate(location(PICKUP), d);
    expect(pickup.map((r) => r.text)).toEqual([
      ar("rider.payment_notice"),
      ar("rider.prepay_warning"),
      ar("rider.ask_dropoff"),
    ]);
    await handleRiderUpdate(location(DROPOFF), d);
    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0]).toMatchObject({
      service: "transport",
      ack: PREPAY_WARNING_ACK_VERSION,
    });
  });

  it("التوصيل: التنبيهُ قبلَ وصفِ الطرد (المُدخَلِ الأخير)، والإنشاءُ يحملُ الإقرار", async () => {
    const d = build("delivery");
    await handleRiderUpdate(text("/delivery"), d);
    const pickup = await handleRiderUpdate(location(PICKUP), d);
    expect(pickup.map((r) => r.text)).not.toContain(ar("rider.prepay_warning"));
    const dropoff = await handleRiderUpdate(location(DROPOFF), d);
    expect(dropoff.map((r) => r.text)).toEqual([
      ar("rider.payment_notice"),
      ar("rider.prepay_warning"),
      ar("rider.ask_parcel"),
    ]);
    await handleRiderUpdate(text("صندوق كتب متوسط"), d);
    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0]).toMatchObject({
      service: "delivery",
      ack: PREPAY_WARNING_ACK_VERSION,
    });
  });

  it("جلسةٌ أقدمُ من التنبيه (`awaiting_dropoff` بلا علم) — موقعٌ أو `/skip` لا يُنشئانِ قبلَ عرضِه", async () => {
    const d = build("transport");
    await d.sessions.save("500", {
      ...INITIAL_STATE,
      step: "awaiting_dropoff",
      draftService: "transport",
      draftPickup: PICKUP,
    });
    const first = await handleRiderUpdate(text("/skip"), d);
    expect(recorder.calls).toHaveLength(0);
    expect(first.map((r) => r.text)).toEqual([
      ar("rider.payment_notice"),
      ar("rider.prepay_warning"),
      ar("rider.ask_dropoff"),
    ]);
    // الإرسالُ التالي (بعدَ أن عُرِضَ) يُنشئُ بالإقرار.
    await handleRiderUpdate(location(DROPOFF), d);
    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0]?.ack).toBe(PREPAY_WARNING_ACK_VERSION);
  });

  it("جلسةُ توصيلٍ قديمةٌ (`awaiting_parcel` بلا علم) لا تُنشئُ قبلَ عرضِ التنبيه", async () => {
    const d = build("delivery");
    await d.sessions.save("500", {
      ...INITIAL_STATE,
      step: "awaiting_parcel",
      draftService: "delivery",
      draftPickup: PICKUP,
      draftDropoff: DROPOFF,
    });
    const first = await handleRiderUpdate(text("صندوق كتب"), d);
    expect(recorder.calls).toHaveLength(0);
    expect(first.map((r) => r.text)).toContain(ar("rider.prepay_warning"));
    expect(first.at(-1)?.text).toBe(ar("rider.ask_parcel"));
    await handleRiderUpdate(text("صندوق كتب"), d);
    expect(recorder.calls).toHaveLength(1);
  });

  it("العلمُ لا يعبرُ إلى الطلبِ التالي: طلبٌ جديدٌ يعرضُ التنبيهَ ثانيةً", async () => {
    const d = build("transport");
    await handleRiderUpdate(text("/ride"), d);
    await handleRiderUpdate(location(PICKUP), d);
    await handleRiderUpdate(location(DROPOFF), d);
    expect(recorder.calls).toHaveLength(1);
    const after = await d.sessions.load("500");
    expect(after.ok && after.value?.prepayWarningShown === true).toBe(false);
    // بلا رحلةٍ جاريةٍ (`activeOrdersOf` فارغ) يبدأُ طلبٌ جديد — والتنبيهُ يُعرَضُ له من جديد.
    await handleRiderUpdate(text("/ride"), d);
    const again = await handleRiderUpdate(location(PICKUP), d);
    expect(again.map((r) => r.text)).toContain(ar("rider.prepay_warning"));
  });

  it("محلّلُ جلسةِ Redis يحفظُ العلمَ إن كان `true` ويُسقطُه في جلسةٍ قديمة", () => {
    const base = { ...INITIAL_STATE, step: "awaiting_dropoff" };
    const kept = parseDialogState(JSON.stringify({ ...base, prepayWarningShown: true }));
    expect(kept?.prepayWarningShown).toBe(true);
    const legacy = parseDialogState(JSON.stringify(base));
    expect(legacy).not.toBeNull();
    expect(legacy?.prepayWarningShown).toBeUndefined();
    const forged = parseDialogState(JSON.stringify({ ...base, prepayWarningShown: "yes" }));
    expect(forged?.prepayWarningShown).toBeUndefined();
  });
});

describe("WR-33 — تركيبُ الإنتاج: كلُّ منفذِ كتابةٍ ملفوفٌ بالحارس", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, out);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
    }
    return out;
  }

  it("كلُّ نداءٍ لـ `createRideRequestCommand(` في شِفرةِ التشغيل (`apps/`) داخلَ `requirePrepayWarningAck(`", () => {
    const sites: string[] = [];
    for (const file of walk(join(ROOT, "apps"))) {
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, index) => {
        if (!line.includes("createRideRequestCommand(")) return;
        sites.push(`${relative(ROOT, file)}:${index + 1}`);
        expect(`${relative(ROOT, file)}:${index + 1} ${line.trim()}`).toContain(
          "requirePrepayWarningAck(createRideRequestCommand(",
        );
      });
    }
    // ثلاثةُ مواضعَ معروفة: `/v1/rides` و`/v1/deliveries` في `index.ts`، والبوتُ في `container.ts`.
    expect(sites.filter((s) => s.startsWith("apps/gateway/src/index.ts"))).toHaveLength(2);
    expect(sites.filter((s) => s.startsWith("apps/gateway/src/container.ts"))).toHaveLength(1);
    expect(sites).toHaveLength(3);
  });

  it("لا منفذَ كتابةٍ آخرُ يُنشئُ طلبًا: `request_ride` تُنادى من المحوّلِ وحدَه", () => {
    const callers: string[] = [];
    for (const top of ["apps", "packages"]) {
      for (const file of walk(join(ROOT, top))) {
        const source = readFileSync(file, "utf8");
        if (
          /request_ride(_with_offer)?\s*\(/.test(source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))
        ) {
          callers.push(relative(ROOT, file));
        }
      }
    }
    expect(callers).toEqual(["packages/infrastructure/transport/ride-request-store.ts"]);
  });

  it("أدواتُ الحملِ التي تُنشئُ رحلاتٍ ترسلُ رمزَ الإصدارِ الحاليِّ حرفًا", () => {
    for (const file of [
      "deploy/capacity-run/load/miniapp-load.ts",
      "deploy/capacity-run/load/isolate.ts",
      "deploy/capacity-run/load/pg-recovery.ts",
    ]) {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(
        `${file}: ${source.includes(`prepayWarningAck: "${PREPAY_WARNING_ACK_VERSION}"`)}`,
      ).toBe(`${file}: true`);
    }
  });

  it("نصُّ البوتِ في اللغاتِ الثلاث، والعربيّةُ تحملُ المعنى كاملًا", () => {
    for (const lang of ["ar", "en", "ur"]) {
      const dict = JSON.parse(
        readFileSync(join(ROOT, `packages/shared/i18n/${lang}.json`), "utf8"),
      ) as Record<string, string>;
      expect((dict["rider.prepay_warning"] ?? "").length).toBeGreaterThan(40);
    }
    const arabic = translate("ar", "rider.prepay_warning");
    for (const part of [
      "لا تحوّل أي مبلغ مقدمًا",
      "السائق",
      "لا تطلب منك",
      "ولا تستلم",
      "لا تتحمّل مسؤولية",
      "أبلغنا",
    ]) {
      expect(arabic).toContain(part);
    }
  });
});

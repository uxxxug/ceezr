import { describe, expect, test } from "bun:test";
import type { DriverProfile } from "../../packages/application/bots/types.ts";
import {
  type DriverOfferDeps,
  setDriverAvailability,
} from "../../packages/application/driver/driver-offers.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type { CityId, DriverId } from "../../packages/shared/kernel/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const TG = "777000111";
const profile: DriverProfile = {
  id: "d-1" as DriverId,
  cityId: "c-1" as CityId,
  telegramUserId: TG,
  fullName: "س",
  phone: "",
  isVerified: true,
  isAvailable: false,
  hasLocation: false,
  lastFix: null,
};

type Calls = string[];
const failure = () => new PortFailureError("drivers", "STORE_ERROR" as never);

function deps(calls: Calls, drivers: Partial<DriverOfferDeps["drivers"]>): DriverOfferDeps {
  return {
    sessions: {
      read: async () => ok({ telegramUserId: TG }) as never,
      readSync: () => ok({ telegramUserId: TG }) as never,
    },
    now: () => new Date(0),
    store: {} as never,
    offers: {} as never,
    drivers: {
      findByTelegramId: async (tg) => {
        calls.push(`find:${tg}`);
        return ok(profile);
      },
      setAvailability: async (id, v) => {
        calls.push(`set:${id}:${v}`);
        return ok(undefined);
      },
      ...drivers,
    },
  } as DriverOfferDeps;
}

const run = (d: DriverOfferDeps, isAvailable: unknown = true) =>
  setDriverAvailability(d, { accessToken: "tok", isAvailable });

describe("LOAD-01 · availability in one statement", () => {
  test("uses the single-statement port when present, never the two-step path", async () => {
    const calls: Calls = [];
    const r = await run(
      deps(calls, {
        setAvailabilityByTelegramId: async (tg, v) => {
          calls.push(`one:${tg}:${v}`);
          return ok("set" as const);
        },
      }),
      false,
    );
    expect(r).toEqual(ok({ isAvailable: false }));
    expect(calls).toEqual([`one:${TG}:false`]);
  });

  test("not_a_driver ⇒ NOT_A_DRIVER", async () => {
    const r = await run(
      deps([], { setAvailabilityByTelegramId: async () => ok("not_a_driver" as const) }),
    );
    expect(r.ok ? null : r.error.code).toBe("NOT_A_DRIVER");
  });

  test("port failure ⇒ AVAILABILITY_NOT_AVAILABLE", async () => {
    const r = await run(deps([], { setAvailabilityByTelegramId: async () => err(failure()) }));
    expect(r.ok ? null : r.error.code).toBe("AVAILABILITY_NOT_AVAILABLE");
  });

  test("non-boolean is rejected before any port call", async () => {
    const calls: Calls = [];
    const r = await run(
      deps(calls, {
        setAvailabilityByTelegramId: async () => {
          calls.push("one");
          return ok("set" as const);
        },
      }),
      "false",
    );
    expect(r.ok ? null : r.error.code).toBe("AVAILABILITY_INVALID");
    expect(calls).toEqual([]);
  });

  test("without the optional port the two-step path is unchanged", async () => {
    const calls: Calls = [];
    const r = await run(deps(calls, {}), true);
    expect(r).toEqual(ok({ isAvailable: true }));
    expect(calls).toEqual([`find:${TG}`, "set:d-1:true"]);
  });

  test("two-step path keeps its verdicts (absent driver, lookup failure)", async () => {
    const none = await run(deps([], { findByTelegramId: async () => ok(null) }));
    expect(none.ok ? null : none.error.code).toBe("NOT_A_DRIVER");
    const broken = await run(deps([], { findByTelegramId: async () => err(failure()) }));
    expect(broken.ok ? null : broken.error.code).toBe("AVAILABILITY_NOT_AVAILABLE");
  });
});

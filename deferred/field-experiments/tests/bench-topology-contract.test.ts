/**
 * الغرض: اختبارُ مكوّناتِ طبولوجيا التحقّقِ الموزَّع نفسِها — مزدوجُ Redis ومُسلسِلُ
 *        السحب — بلا قاعدةِ بياناتٍ ولا عملياتِ بوّابة.
 * الحالة: منفّذ فعلياً — وحدة 2-6.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: كلُّ توسيعٍ للطبولوجيا — أمرُ Redis جديدٌ يُختبَر هنا أوّلاً.
 * ملاحظات مستقبلية: عند إتاحةِ قاعدةِ قياسٍ في CI يُضاف اختبارُ إقلاعِ عنقودٍ فعليٍّ صغير.
 *
 * ولماذا تُختبَر أداةُ القياس: وحدة 2-6 حكمت مرّةً بـ«إخفاقِ عمل» على نظامٍ سليمٍ
 * لأنّ جامعَ الرسائلِ استوعب نفسَ الرسائلِ مرّتين عند السحبِ المتوازي. أداةٌ تكذب
 * أخطرُ من نظامٍ يفشل: الفشلُ يُرى، والكذبُ يُصدَّق. وهذا الملفُّ بلا قاعدةٍ عن قصدٍ
 * كي يجري في CI حيث لا قاعدةَ قياس.
 */

import { describe, expect, test } from "bun:test";
import { createRedisShimStore, serveRedisShim } from "../bench/topology/redis-shim.ts";
import { createKeyedSerializer } from "../bench/topology/serialize.ts";

const resultOf = (body: { result: unknown } | { error: string }): unknown =>
  "result" in body ? body.result : `ERROR:${body.error}`;

describe("مزدوجُ Upstash REST: دلالاتُ الأوامرِ التي يستعملها الإنتاج", () => {
  test("PING يردُّ PONG", () => {
    const store = createRedisShimStore();
    expect(resultOf(store.execute(["PING"]).body)).toBe("PONG");
  });

  test("GET لمفتاحٍ غيرِ موجودٍ يردُّ null لا خطأً — وعليه يعتمد مسارُ الجلسةِ الجديدة", () => {
    const store = createRedisShimStore();
    expect(resultOf(store.execute(["GET", "waslah:session:driver:1"]).body)).toBeNull();
  });

  test("SET ثمّ GET يُعيد نفسَ النصّ حرفاً بحرف", () => {
    const store = createRedisShimStore();
    const payload = JSON.stringify({ step: "driver.ask_phone", name: "أحمد" });
    expect(resultOf(store.execute(["SET", "k", payload]).body)).toBe("OK");
    expect(resultOf(store.execute(["GET", "k"]).body)).toBe(payload);
  });

  test("DEL يردُّ عددَ المحذوفِ فعلاً: واحدٌ ثمّ صفرٌ لنفسِ المفتاح", () => {
    const store = createRedisShimStore();
    store.execute(["SET", "k", "v"]);
    expect(resultOf(store.execute(["DEL", "k"]).body)).toBe(1);
    expect(resultOf(store.execute(["DEL", "k"]).body)).toBe(0);
    expect(resultOf(store.execute(["GET", "k"]).body)).toBeNull();
  });

  test("INCR يبدأ من صفرٍ على مفتاحٍ غيرِ موجود — وهو أساسُ حدِّ المعدّلِ الموزَّع", () => {
    const store = createRedisShimStore();
    expect(resultOf(store.execute(["INCR", "rate:1"]).body)).toBe(1);
    expect(resultOf(store.execute(["INCR", "rate:1"]).body)).toBe(2);
    expect(resultOf(store.execute(["INCR", "rate:1"]).body)).toBe(3);
  });

  test("INCR على قيمةٍ غيرِ رقميّةٍ خطأٌ لا صفرٌ صامت", () => {
    const store = createRedisShimStore();
    store.execute(["SET", "k", "نصّ"]);
    expect(String(resultOf(store.execute(["INCR", "k"]).body))).toContain("ERROR:");
  });

  test("SET … EX ينتهي بمرورِ الزمنِ لا قبله — بساعةٍ مُتحكَّمٍ بها", () => {
    let clock = 1_000_000;
    const store = createRedisShimStore(() => clock);
    store.execute(["SET", "s", "v", "EX", "60"]);
    clock += 59_000;
    expect(resultOf(store.execute(["GET", "s"]).body)).toBe("v");
    clock += 2_000;
    expect(resultOf(store.execute(["GET", "s"]).body)).toBeNull();
  });

  test("EXPIRE يضع مهلةً على مفتاحٍ قائم، ويردُّ صفراً على غيرِ الموجود", () => {
    let clock = 5_000;
    const store = createRedisShimStore(() => clock);
    store.execute(["INCR", "rate:2"]);
    expect(resultOf(store.execute(["EXPIRE", "rate:2", "10"]).body)).toBe(1);
    expect(resultOf(store.execute(["EXPIRE", "غائب", "10"]).body)).toBe(0);
    clock += 11_000;
    expect(resultOf(store.execute(["GET", "rate:2"]).body)).toBeNull();
  });

  test("أمرٌ غيرُ مدعومٍ يُرفَض صريحاً — كي لا يُظنَّ المزدوجُ أوسعَ ممّا هو", () => {
    const store = createRedisShimStore();
    expect(String(resultOf(store.execute(["HSET", "h", "f", "v"]).body))).toContain("ERROR:");
    expect(String(resultOf(store.execute([]).body))).toContain("ERROR:");
  });

  test("عددُ الوسائطِ الخاطئُ خطأٌ لا تجاهُلٌ", () => {
    const store = createRedisShimStore();
    expect(String(resultOf(store.execute(["GET"]).body))).toContain("ERROR:");
    expect(String(resultOf(store.execute(["SET", "k"]).body))).toContain("ERROR:");
  });

  test("عدّادُ الأوامرِ يعدُّ ما جرى فعلاً — وهو دليلُ أنّ المشاركةَ وقعت", () => {
    const store = createRedisShimStore();
    store.execute(["GET", "k"]);
    store.execute(["SET", "k", "v"]);
    store.execute(["GET", "k"]);
    expect(store.commandCounts()).toEqual({ GET: 2, SET: 1 });
    expect(store.keyCount()).toBe(1);
    store.reset();
    expect(store.keyCount()).toBe(0);
    expect(store.commandCounts()).toEqual({});
  });
});

describe("خادمُ المزدوج: البروتوكولُ والمصادقة", () => {
  test("طلبٌ بلا توكنٍ صحيحٍ يُرفَض بـ401 قبل أن يلمسَ الحالة", async () => {
    const server = serveRedisShim({ token: "tok-unit-01" });
    try {
      const response = await fetch(server.url, {
        method: "POST",
        headers: { authorization: "Bearer wrong-token" },
        body: JSON.stringify(["SET", "k", "v"]),
      });
      expect(response.status).toBe(401);
      expect(server.store.keyCount()).toBe(0);
    } finally {
      await server.stop();
    }
  });

  test("جسمٌ ليس مصفوفةَ نصوصٍ يُرفَض بـ400", async () => {
    const server = serveRedisShim({ token: "tok-unit-02" });
    try {
      const response = await fetch(server.url, {
        method: "POST",
        headers: { authorization: "Bearer tok-unit-02" },
        body: JSON.stringify({ command: "GET" }),
      });
      expect(response.status).toBe(400);
    } finally {
      await server.stop();
    }
  });

  test("أمرٌ صحيحٌ يمرّ، و`/__shim/state` يكشف ما جرى", async () => {
    const server = serveRedisShim({ token: "tok-unit-03" });
    try {
      const headers = { authorization: "Bearer tok-unit-03" };
      await fetch(server.url, { method: "POST", headers, body: JSON.stringify(["SET", "k", "v"]) });
      const read = await fetch(server.url, {
        method: "POST",
        headers,
        body: JSON.stringify(["GET", "k"]),
      });
      expect(await read.json()).toEqual({ result: "v" });

      const state = await fetch(`${server.url}/__shim/state`, { headers });
      expect(await state.json()).toEqual({ commands: { SET: 1, GET: 1 }, keys: 1 });
    } finally {
      await server.stop();
    }
  });
});

describe("مُسلسِلُ السحب: العطبُ الذي كذَب على القياس", () => {
  test("عمليتان لنفسِ المفتاحِ لا تتقاطعان زمنيّاً", async () => {
    const serializer = createKeyedSerializer();
    let inFlight = 0;
    let maxInFlight = 0;
    const task = async (): Promise<void> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Bun.sleep(5);
      inFlight -= 1;
    };
    await Promise.all(Array.from({ length: 6 }, () => serializer.run("gw1", task)));
    expect(maxInFlight).toBe(1);
  });

  test("مؤشّرٌ متغيّرٌ لا يُقرأ مرّتين — وهي بعينِها الرسائلُ المُستوعَبةُ مرّتين", async () => {
    const serializer = createKeyedSerializer();
    const source = Array.from({ length: 9 }, (_, index) => index);
    let cursor = 0;
    const absorbed: number[] = [];
    const pull = async (): Promise<void> => {
      const from = cursor;
      await Bun.sleep(1);
      const slice = source.slice(from);
      absorbed.push(...slice);
      cursor = source.length;
    };
    await Promise.all(Array.from({ length: 4 }, () => serializer.run("gw1", pull)));
    expect(absorbed).toEqual(source);
  });

  test("مفتاحان مختلفان يعملان متوازيَين — التسلسلُ لكلِّ نسخةٍ لا للعنقودِ كلِّه", async () => {
    const serializer = createKeyedSerializer();
    let inFlight = 0;
    let maxInFlight = 0;
    const task = async (): Promise<void> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Bun.sleep(5);
      inFlight -= 1;
    };
    await Promise.all([serializer.run("gw1", task), serializer.run("gw2", task)]);
    expect(maxInFlight).toBe(2);
  });

  test("فشلُ عمليةٍ لا يُسقط ما بعدها في نفسِ الطابور", async () => {
    const serializer = createKeyedSerializer();
    const order: string[] = [];
    const failing = serializer.run("gw1", async () => {
      order.push("first");
      throw new Error("سحبٌ فشل");
    });
    const following = serializer.run("gw1", async () => {
      order.push("second");
      return "ok";
    });
    expect(failing).rejects.toThrow("سحبٌ فشل");
    expect(await following).toBe("ok");
    expect(order).toEqual(["first", "second"]);
  });
});

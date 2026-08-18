/**
 * الغرض: التحقّق أن عدّاد الصادر يعدّ ما خرج فعلاً لا ما قُرّر إرساله، وأن
 *   الناقل الصامت لا يُصدر نداءً شبكياً ولا يُخفي نفسه في معرّفات الرسائل.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI ومنصّة القياس في bench/
 * ملاحظات مستقبلية: أي نوع إرسال جديد في `TelegramSender` يُضاف له وسمٌ هنا.
 */
import { describe, expect, it } from "bun:test";
import type { TelegramSender } from "../../packages/infrastructure/notification/telegram-api-sender.ts";
import {
  measuredTelegramSender,
  silentTelegramSender,
} from "../../packages/infrastructure/notification/telegram-transport.ts";
import { createOperationalMetrics } from "../../packages/infrastructure/observability/index.ts";

function okSender(): TelegramSender {
  return {
    sendMessage: async () => "1",
    sendPhoto: async () => "2",
    sendLocation: async () => "3",
  };
}

function failingSender(): TelegramSender {
  const boom = (): never => {
    throw new Error("تيليجرام رفض الإرسال");
  };
  return {
    sendMessage: async () => boom(),
    sendPhoto: async () => boom(),
    sendLocation: async () => boom(),
  };
}

describe("measuredTelegramSender", () => {
  it("يعدّ كل نوع إرسال بوسمه وببوته، ويمرّر معرّف الرسالة كما هو", async () => {
    const metrics = createOperationalMetrics();
    const sender = measuredTelegramSender(okSender(), "driver", metrics);

    expect(await sender.sendMessage("100", "نص", undefined)).toBe("1");
    expect(await sender.sendMessage("101", "نص", undefined)).toBe("1");
    expect(await sender.sendPhoto("100", "file", "تعليق", undefined)).toBe("2");
    expect(await sender.sendLocation("100", 21.5471, 39.1751)).toBe("3");

    const text = metrics.registry.render();
    expect(text).toContain('waslah_telegram_messages_sent_total{bot="driver",kind="message"} 2');
    expect(text).toContain('waslah_telegram_messages_sent_total{bot="driver",kind="photo"} 1');
    expect(text).toContain('waslah_telegram_messages_sent_total{bot="driver",kind="location"} 1');
  });

  it("يفصل بين البوتين فلا يُخلط صادرُ السائقين بصادرِ العملاء", async () => {
    const metrics = createOperationalMetrics();
    await measuredTelegramSender(okSender(), "driver", metrics).sendMessage("1", "ن", undefined);
    await measuredTelegramSender(okSender(), "rider", metrics).sendMessage("2", "ن", undefined);
    await measuredTelegramSender(okSender(), "rider", metrics).sendMessage("3", "ن", undefined);

    const text = metrics.registry.render();
    expect(text).toContain('waslah_telegram_messages_sent_total{bot="driver",kind="message"} 1');
    expect(text).toContain('waslah_telegram_messages_sent_total{bot="rider",kind="message"} 2');
  });

  /**
   * هذا هو الاختبار الحاكم: عدٌّ قبل النداء كان سيقيس «رسائل قرّرنا إرسالها»،
   * وهو رقمٌ يبدو صحيحاً ويكذب عند أوّل رفضٍ من تيليجرام أو تجاوزٍ لحدّ المعدّل.
   * ونحن نقيس السقف الخارجي، فلا يُعَدّ إلا ما نجح فعلاً.
   */
  it("لا يعدّ إرسالاً فشل، ويُعيد رفع الاستثناء ولا يبتلعه", async () => {
    const metrics = createOperationalMetrics();
    const sender = measuredTelegramSender(failingSender(), "driver", metrics);

    await expect(sender.sendMessage("100", "نص", undefined)).rejects.toThrow(
      "تيليجرام رفض الإرسال",
    );
    await expect(sender.sendPhoto("100", "f", "ت", undefined)).rejects.toThrow();
    await expect(sender.sendLocation("100", 21.5, 39.1)).rejects.toThrow();

    expect(metrics.registry.render()).not.toContain("waslah_telegram_messages_sent_total{");
  });
});

describe("silentTelegramSender", () => {
  it("لا يُصدر أيّ نداء شبكيّ", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    const spy = async (): Promise<Response> => {
      calls += 1;
      throw new Error("لا يجوز أن يخرج نداء من الناقل الصامت");
    };
    globalThis.fetch = Object.assign(spy, { preconnect: original.preconnect });
    try {
      const sender = silentTelegramSender();
      await sender.sendMessage("100", "نص", undefined);
      await sender.sendPhoto("100", "file", "تعليق", undefined);
      await sender.sendLocation("100", 21.5471, 39.1751);
    } finally {
      globalThis.fetch = original;
    }
    expect(calls).toBe(0);
  });

  /**
   * يعيد معرّفاً لا `null`: إعادةُ `null` كانت ستُسكِت مساراتِ التعديل فوقه
   * فيقيس القياسُ نظاماً أخفَّ من الحقيقي. والبادئة تجعله غير قابلٍ للالتباس
   * بمعرّفٍ حقيقيّ في أيّ سجلٍّ أو صفٍّ يظهر فيه.
   */
  it("يعيد معرّفاً متمايزاً لا يلتبس بمعرّف تيليجرام، وفريداً لكل رسالة", async () => {
    const sender = silentTelegramSender();
    const first = await sender.sendMessage("100", "نص", undefined);
    const second = await sender.sendMessage("100", "نص", undefined);
    const third = await sender.sendPhoto("100", "file", "تعليق", undefined);

    expect(first).toBe("silent-1");
    expect(second).toBe("silent-2");
    expect(third).toBe("silent-3");
    expect(new Set([first, second, third]).size).toBe(3);
  });

  it("يُقاس صادرُه كما يُقاس الحقيقي حين يُلَفّ بالعدّاد", async () => {
    const metrics = createOperationalMetrics();
    const sender = measuredTelegramSender(silentTelegramSender(), "driver", metrics);
    await sender.sendMessage("100", "نص", undefined);
    await sender.sendMessage("101", "نص", undefined);
    expect(metrics.registry.render()).toContain(
      'waslah_telegram_messages_sent_total{bot="driver",kind="message"} 2',
    );
  });
});

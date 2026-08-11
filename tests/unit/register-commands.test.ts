/**
 * الغرض: إثبات أن تسجيل الأوامر يغطّي كل لغة مدعومة **ومرّة بلا لغة**، فلا يرى
 *   صاحبُ هاتف بلغة ثالثة قائمةً فارغة.
 * الحالة: اختبار فعلي — البند 2.1.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, it } from "bun:test";
import type {
  BotCommand,
  CommandRegistrar,
} from "../../apps/gateway/src/bots/shared/register-commands.ts";
import { registerBotCommands } from "../../apps/gateway/src/bots/shared/register-commands.ts";
import { SUPPORTED_LANGUAGES } from "../../packages/domain/i18n-translation/index.ts";

interface Call {
  readonly commands: readonly BotCommand[];
  readonly languageCode: string | null;
}

function capturing(): { registrar: CommandRegistrar; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    registrar: {
      setCommands: async (commands, languageCode) => {
        calls.push({ commands, languageCode });
      },
    },
  };
}

describe("تسجيل أوامر البوت عند تلغرام", () => {
  it("يسجّل لكل لغة مدعومة", async () => {
    const { registrar, calls } = capturing();
    await registerBotCommands("driver", registrar);

    for (const language of SUPPORTED_LANGUAGES) {
      const call = calls.find((entry) => entry.languageCode === language);
      expect(call).toBeDefined();
      expect((call?.commands.length ?? 0) > 0).toBe(true);
    }
  });

  /**
   * تلغرام يسقط إلى القائمة غير المقيَّدة بلغة إن لم يجد مطابقاً للغة عميل المستخدم.
   * فبلا هذا التسجيل المطلق يرى صاحبُ هاتف بالفرنسية قائمةً فارغة تماماً.
   */
  it("يسجّل مرّة بلا لغة فلا تُفرَّغ القائمة لصاحب لغة غير مدعومة", async () => {
    const { registrar, calls } = capturing();
    await registerBotCommands("rider", registrar);

    const fallback = calls.filter((entry) => entry.languageCode === null);
    expect(fallback.length).toBe(1);
    expect((fallback[0]?.commands.length ?? 0) > 0).toBe(true);
  });

  it("عدد النداءات = عدد اللغات + واحد، بلا تكرار لغة", async () => {
    const { registrar, calls } = capturing();
    await registerBotCommands("driver", registrar);

    expect(calls.length).toBe(SUPPORTED_LANGUAGES.length + 1);
    const codes = calls.map((entry) => entry.languageCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("قائمة السائق تختلف عن قائمة العميل — لا قائمة واحدة للبوتين", async () => {
    const driver = capturing();
    const rider = capturing();
    await registerBotCommands("driver", driver.registrar);
    await registerBotCommands("rider", rider.registrar);

    const names = (call: Call | undefined) =>
      (call?.commands ?? []).map((c) => c.command).join(",");
    expect(names(driver.calls[0])).not.toBe(names(rider.calls[0]));
  });
});

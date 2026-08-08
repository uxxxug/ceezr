/**
 * الغرض: كل لمسة قرص في هذه الطبقة تمرّ من هنا — قراءةً وكتابةً وقصّاً. مكانٌ
 *   واحد يعرف أن التخزين محلي ومؤقّت، فيوم يتغيّر يتغيّر هنا وحده.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.4/ب.6.
 * ينتمي إلى: packages/agent-core/memory
 * يُتوقع أن يستخدمه لاحقاً: mediumTerm، longTerm، experience/*، learning/*
 * ملاحظات مستقبلية: عند مليار مستخدم يُستبدل تنفيذ `FileStore` بمخزن موزَّع
 *   (Redis TTL للمتوسطة، قاعدة متجهية للطويلة) — **والعقد أدناه هو نفسه**، فلا
 *   يتغيّر سطر في أي مستدعٍ.
 *
 * ⚠️ ═══ تحذير صريح: التخزين هنا مؤقّت ويُفقَد ═══
 *
 * كل ما يُكتب تحت `runtimeRoot` يعيش على قرص النسخة المحلّية. **يُفقَد بالكامل عند
 * كل إعادة نشر على Render**، وعند كل إعادة تشغيل للحاوية، ولا يُشارَك بين نسختين
 * إن تعدّدت. هذا **مقبول في هذه المرحلة التجريبية وحدها**، ومعناه العملي:
 *
 * - الذاكرة متوسطة المدى: تعود فارغة، فيتأخّر توليد المرشّحات لا أكثر.
 * - الذاكرة طويلة المدى: يعود الوكيل إلى **حالة «بلا معرفة سابقة»** — يقرأ
 *   `knowledge_base/` (وهي في المستودع فلا تُفقَد) ولا يقرأ كلماتٍ مُتعلَّمة.
 *   وهذا **تدهور في الجودة لا كسر في السلوك**: يبقى يصنّف ويقترح، بأدلّة أقلّ.
 * - التجربة والقرارات: تُفقَد، فيُفقَد معها أساس التقييم لتلك الفترة.
 *
 * ولذلك **لا يُبنى على هذه الملفات أي قرار تشغيلي**، ولا يُعتمَد عليها في تدقيق
 * ولا محاسبة. سجلّ التدقيق الحقيقي في `audit_log` بقاعدة المشروع الأساسي، ولا
 * علاقة له بهذه الطبقة إطلاقاً.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { guardedSync } from "../fallback.ts";

export type StorageLog = (message: string, meta: Record<string, unknown>) => void;

export interface FileStore {
  /** يقرأ JSON ويعيد `fallback` عند أي عجز — ملف مفقود أو تالف أو غير مقروء. */
  readJson<T>(relativePath: string, fallback: T): T;
  writeJson(relativePath: string, value: unknown): boolean;
  /** يقرأ سطور JSONL، ويتخطّى السطر التالف وحده لا الملف كلّه. */
  readLines<T>(relativePath: string): T[];
  appendLine(relativePath: string, value: unknown): boolean;
  /** يُبقي آخر `maxLines` سطراً ويحذف الأقدم. يعيد عدد ما حُذف. */
  truncateToLast(relativePath: string, maxLines: number): number;
}

/** لا يكتب شيئاً ولا يقرأ شيئاً. للاختبارات الوحدوية، وللإعداد `persistenceEnabled=false`. */
export function createNullFileStore(): FileStore {
  return {
    readJson: <T>(_relativePath: string, fallback: T): T => fallback,
    writeJson: () => true,
    readLines: () => [],
    appendLine: () => true,
    truncateToLast: () => 0,
  };
}

export function createFileStore(root: string, log?: StorageLog): FileStore {
  const base = resolve(root);

  /**
   * يمنع الخروج من الجذر. المسارات كلها داخلية اليوم، لكن حارسٌ على كتابة القرص
   * لا يُترك «لأن المُدخل موثوق»: الموثوق اليوم هو مُدخل المستخدم غداً.
   */
  function safePath(relativePath: string): string | null {
    const full = resolve(join(base, relativePath));
    return full === base || full.startsWith(`${base}/`) ? full : null;
  }

  function ensureDir(full: string): void {
    const dir = dirname(full);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  return {
    readJson: <T>(relativePath: string, fallback: T): T => {
      const full = safePath(relativePath);
      if (full === null) return fallback;
      return guardedSync(
        () => {
          if (!existsSync(full)) return fallback;
          return JSON.parse(readFileSync(full, "utf8")) as T;
        },
        fallback,
        log,
      );
    },

    writeJson: (relativePath, value) => {
      const full = safePath(relativePath);
      if (full === null) return false;
      return guardedSync(
        () => {
          ensureDir(full);
          // كتابة إلى ملف مؤقّت ثم إحلاله: انقطاعٌ أثناء الكتابة يترك الملف القديم
          // سليماً بدل نصف ملفٍ لا يُقرأ. رخيصةٌ هنا، وتُنقذ الذاكرة المُتعلَّمة كلها.
          const temporary = `${full}.tmp`;
          writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
          writeFileSync(full, readFileSync(temporary, "utf8"), "utf8");
          return true;
        },
        false,
        log,
      );
    },

    readLines: <T>(relativePath: string): T[] => {
      const full = safePath(relativePath);
      if (full === null) return [];
      return guardedSync(
        () => {
          if (!existsSync(full)) return [];
          const parsed: T[] = [];
          for (const line of readFileSync(full, "utf8").split("\n")) {
            const trimmed = line.trim();
            if (trimmed === "") continue;
            // السطر التالف يُتخطّى وحده: ملفٌ فيه سطر مقطوع (نشرٌ أثناء كتابة) لا
            // يجوز أن يُفقِد كل ما قبله.
            try {
              parsed.push(JSON.parse(trimmed) as T);
            } catch {
              log?.("agent_core.storage_bad_line", { file: relativePath });
            }
          }
          return parsed;
        },
        [],
        log,
      );
    },

    appendLine: (relativePath, value) => {
      const full = safePath(relativePath);
      if (full === null) return false;
      return guardedSync(
        () => {
          ensureDir(full);
          appendFileSync(full, `${JSON.stringify(value)}\n`, "utf8");
          return true;
        },
        false,
        log,
      );
    },

    truncateToLast: (relativePath, maxLines) => {
      const full = safePath(relativePath);
      if (full === null || maxLines <= 0) return 0;
      return guardedSync(
        () => {
          if (!existsSync(full)) return 0;
          const lines = readFileSync(full, "utf8")
            .split("\n")
            .filter((line) => line.trim() !== "");
          if (lines.length <= maxLines) return 0;
          const kept = lines.slice(lines.length - maxLines);
          writeFileSync(full, `${kept.join("\n")}\n`, "utf8");
          return lines.length - kept.length;
        },
        0,
        log,
      );
    },
  };
}

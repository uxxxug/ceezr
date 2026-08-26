/**
 * الغرض: بوابة CI تفرض أن **رقم قرار معماري (ADR) فريدٌ لا يتكرر**، وأن اسم كل ملف
 *    في `docs/adr/` يبدأ بأربعة أرقام يتبعها شَرطة.
 * الحالة: منفّذ فعلياً — أداة تحقق، ليست منطق أعمال.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: package.json (`bun run ci`) · .github/workflows/ci.yml
 * ملاحظات مستقبلية: لا يُحذف هذا الفحص إلا بقرار ناسخ لـADR 0038. وإن أُضيفت مجلدات
 *    فرعية داخل `docs/adr/` مستقبلاً فيجب أن تُدخَل في نطاق الفحص لا أن تُستثنى منه.
 *
 * لماذا فحصٌ لا سطرٌ في وثيقة: في 2026-08-26 اكتُشف أن الرقم `0016` كان مشغولاً
 * بملفَّين مختلفَين في وقت واحد — قرار ناقل النقل اللحظي، وقرار دفتر محفظة
 * الاشتراك — وبقي الازدواج غير مكتشَف من 2026-08-13 حتى تاريخ الاكتشاف. وست
 * إحالات في وثائق المشروع كانت تكتب «ADR 0016» وهي تقصد أحدهما، فصارت المرجعية
 * المعمارية نفسها ملتبسة. والدرس أن المشكلة لم تكن الازدواج بل **غياب ما يكشفه**:
 * رقمُ القرار مفتاحٌ يُحال إليه من الوثائق والشيفرة، ومفتاحٌ بلا قيد تفرّدٍ يفسد
 * صامتاً. والوثيقة التي تقول «لا تكرّروا الأرقام» تُنسى بين مطوّرَين؛ البناء
 * الساقط لا يُنسى. وهذا القيد هو الـinvariant الذي أمر به مدير المشروع في ADR 0038.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ADR_DIR = "docs/adr";

/** اسم ملف قرار صحيح: أربعة أرقام، ثم شَرطة، ثم بقية الاسم، وامتداد `.md`. */
const NAME_RE = /^(\d{4})-.+\.md$/;

type Problem = { kind: string; detail: string };

function collect(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			// المجلدات الفرعية داخلة في النطاق قصداً: القيد على الرقم لا على المسار.
			out.push(...collect(full).map((f) => join(entry, f)));
			continue;
		}
		if (entry.endsWith(".md")) out.push(entry);
	}
	return out;
}

function main(): void {
	const files = collect(ADR_DIR).sort();
	const problems: Problem[] = [];
	const byNumber = new Map<string, string[]>();

	for (const file of files) {
		const base = file.split("/").pop() ?? file;
		// `README.md` وما شابهه ليس قراراً، لكن لا نستثني بالاسم كي لا يُتَّخذ
		// الاستثناء ثغرة؛ نستثني ما لا يبدأ برقم أصلاً ونُبلِغ عنه تنبيهاً.
		const m = NAME_RE.exec(base);
		if (!m) {
			if (/^\d/.test(base)) {
				problems.push({
					kind: "اسم ملف غير مطابق للنمط",
					detail: `${file} — المتوقع أربعة أرقام ثم شَرطة (مثال: 0042-my-decision.md)`,
				});
			}
			continue;
		}
		const num = m[1] as string;
		const list = byNumber.get(num) ?? [];
		list.push(file);
		byNumber.set(num, list);
	}

	for (const [num, list] of [...byNumber.entries()].sort()) {
		if (list.length > 1) {
			problems.push({
				kind: "رقم قرار مكرَّر",
				detail: `ADR ${num} مستخدَم في ${list.length} ملفات: ${list.join(" · ")}`,
			});
		}
	}

	const total = [...byNumber.values()].reduce((a, l) => a + l.length, 0);

	if (problems.length > 0) {
		console.error(`فحص ترقيم القرارات: فشل — ${problems.length} مشكلة\n`);
		for (const p of problems) console.error(`  [${p.kind}] ${p.detail}`);
		console.error(
			"\nالقيد الحاكم: ADR 0038 — رقم القرار فريد. ولا يُعاد ترقيم قرار له إحالات قائمة" +
				" قبل إحصاء الإحالات وتحديثها، ويُثبَّت في رأس الملف المنقول سطرُ الترقيم السابق.",
		);
		process.exit(1);
	}

	console.log(`فحص ترقيم القرارات: نجح — ${total} قراراً بأرقام فريدة.`);
}

main();

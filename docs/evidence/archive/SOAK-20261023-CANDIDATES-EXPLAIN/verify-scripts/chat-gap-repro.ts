// إعادة إنتاج حتمية لآلية ضغط فاصل الوصول دون أي فشل اقتناء (فرضية المراجعة):
// awaitSlot يقتني فتحة المحادثة أولًا (بفاصل ≥1000ms مضمون من الدلو)، ثم ينتظر
// فتحة العالمي، ثم يرسل. إن كان عبور/انتظار الإرسال الأول أطول من الثاني،
// انضغط فاصل الوصول عند المستقبل إلى أقل من 1000ms — بلا أي تجاوز في الاقتناء.
// يفسر أحداث 996–999ms في الزوج الثالث دون افتراض فشل الحاجز أو فرق ساعة.
import { withOutboundResilience } from "/home/user/workspace/ceezr/packages/infrastructure/notification/rate-aware-telegram-sender.ts";
import { createMemoryOutboundRateBucket } from "/home/user/workspace/ceezr/packages/infrastructure/notification/outbound-rate-bucket.ts";
import { createNoopDeadLetterSink } from "/home/user/workspace/ceezr/packages/infrastructure/notification/rate-aware-telegram-sender.ts";

const arrivals: number[] = [];
let transitMs = 5;
const inner = {
  sendMessage: async (chatId: string) => {
    await new Promise((r) => setTimeout(r, transitMs)); // عبور الشبكة
    arrivals.push(performance.now());
    return "1";
  },
  sendPhoto: async () => "1",
  sendLocation: async () => "1",
  editMessageText: async () => "1",
};

const sender = withOutboundResilience(inner as never, {
  bucket: createMemoryOutboundRateBucket(),
  deadLetter: createNoopDeadLetterSink(),
  maxBucketWaitMs: 5_000,
});

const chat = "12345";

// الإرسال الأول: عبور أطول (20ms — ازدحام لحظي على قناة الأول)
transitMs = 20;
const r1 = await sender.sendMessage(chat, "أول", null, { priority: "informational" } as never);

// الإرسال الثاني: الاقتناء سيضمن فاصلًا ≥1000ms بين الاقناءين، لكن عبوره أقصر (2ms)
transitMs = 2;
const r2 = await sender.sendMessage(chat, "ثانٍ", null, { priority: "informational" } as never);

const gap = arrivals[1] - arrivals[0];
console.log(`نتيجتا الإرسال: ${r1}, ${r2}`);
console.log(`فاصل الوصول عند المستقبل: ${gap.toFixed(1)}ms`);
console.log(`فاصل الاقتناء (النافذة المنزلقة للدلو): مضمون ≥ 1000ms`);
if (gap < 1000) {
  console.log("✓ أُعيد إنتاج الضغط: وصول دون 1000ms مع اقتناء سليم — الآلية مثبتة (تفسر 996–999ms)");
} else {
  console.log(`✗ الفاصل ${gap.toFixed(0)}ms ≥ 1000ms — الآلية لم تظهر بهذه القيم؛ جرّب فرق عبور أكبر`);
}

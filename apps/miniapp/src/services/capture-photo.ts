/**
 * التقاطُ صورةٍ بالكاميرا داخلَ التطبيقِ — يُنشئُ مُدخَلَ ملفٍّ مخفيًّا بـ`capture`
 * ويُعيدُ الملفَّ المُلتقَطَ (DEC-33 · ADR 0230).
 *
 * ينتمي إلى: apps/miniapp/src/services
 * يُستخدم من: `DriverRoot.tsx` لحقنِّ `DocumentsScreen`.
 *
 * ## لماذا مُدخَلُ ملفٍّ مخفيٌّ لا getUserMedia
 *
 * لأنَّ `getUserMedia` يحتاجُ أذوناتٍ صريحةً وواجهةَ فيديو حيّة — وهذا نطاقٌ أوسعُ
 * مما يحتاجُهُ رفعُ وثيقةٍ. ومُدخَلُ الملفِّ بـ`capture="environment"` يفتحُ كاميرا
 * الجهازِ مباشرةً ويعيدُ ملفًّا واحدًا — وهو بالضبطِ ما يُمرَّرُ إلى مسارِ الرفعِ.
 */

/**
 * يُنشئُ مُدخَلَ ملفٍّ مخفيًّا بـ`capture="environment"` ويُعيدُ الملفَّ المُلتقَطَ.
 * يُعادُ `null` إن ألغى المستخدمُ.
 */
export function capturePhotoWithInput(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png";
    input.setAttribute("capture", "environment");
    input.style.display = "none";

    const cleanup = () => {
      input.remove();
      document.removeEventListener("focus", onFocus);
    };

    // إن لم يُختَرْ ملفٌ (إلغاءُ المستخدمِ) فالنافذةُ تُغلَقُ بلا `change`.
    // `focus` بعدَ الإلغاءِ تعيدُ التركيزَ للنافذةِ فنُنظِّفُ.
    let settled = false;
    const onFocus = () => {
      if (settled) return;
      // تأخيرٌ قصيرٌ لعلَّ `change` يصلُ أولًا.
      setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(null);
      }, 500);
    };

    input.addEventListener("change", () => {
      settled = true;
      cleanup();
      const file = input.files?.[0];
      resolve(file ?? null);
    });

    document.addEventListener("focus", onFocus);
    document.body.appendChild(input);
    input.click();
  });
}

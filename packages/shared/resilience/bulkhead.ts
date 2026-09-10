/**
 * الغرض: حدُّ تزامنٍ (bulkhead) لكلِّ اعتماديّةٍ خارجيّةٍ (`CAP-006` · `F8-04`).
 *   يمنعُ أن يستهلكَ عطلٌ في اعتماديّةٍ واحدةٍ كلَّ ما في المثيلِ من مسالكَ
 *   ومقابسَ وذاكرةٍ فيسقطَ ما لا علاقةَ له بها. **والاسمُ من حواجزِ السفنِ**: ثقبٌ
 *   في حجرةٍ لا يُغرِقُ السفينةَ إلاّ إذا لم تكنْ ثمَّ حواجزُ.
 * الحالة: منفّذ فعلياً — المرحلة `F8-04`.
 * ينتمي إلى: shared/resilience
 * يُتوقع أن يستخدمه لاحقاً: `dependency-guard.ts` وحدَه.
 * ملاحظات مستقبلية: نشرُ الرفضِ بالامتلاءِ مقياساً موضعُه `F8-02`.
 */

/**
 * **ولا طابورَ ههنا عن قصدٍ**: الحاجزُ يَقبَلُ أو يَرُدُّ فوراً. وطابورُ انتظارٍ
 * كانَ يقتضي إلغاءَ منتظِرٍ تجاوزَ ميزانيتَه، والملغى قد يُمنَحُ إذناً لا يُفرِجُ
 * عنه أحدٌ فيتسرَّبُ المَسلَكُ ويصيرُ الحدُّ أصغرَ من المُعلَنِ صامتاً. والرَّدُّ
 * الفوريُّ أصدقُ: من رُدَّ عَلِمَ، ومن انتظرَ في طابورٍ حسبَ أنّه يُخدَمُ.
 */
export interface BulkheadConfig {
  /** أقصى نداءٍ مُنطلِقٍ في وقتٍ واحدٍ. أقلُّه ١. */
  readonly maxConcurrent: number;
}

export interface BulkheadSnapshot {
  readonly inFlight: number;
  readonly maxConcurrent: number;
}

/** إذنٌ مُمنوحٌ. **يجبُ استدعاءُ `release` مرّةً واحدةً** وإلاّ تسرَّبَ المَسلَكُ. */
export interface BulkheadPermit {
  release(): void;
}

export interface Bulkhead {
  /** يطلبُ إذناً، ويُعادُ `null` **فوراً** إذا كانَ المَسلَكُ ممتلئاً. */
  tryAcquire(): BulkheadPermit | null;
  snapshot(): BulkheadSnapshot;
}

export function createBulkhead(config: BulkheadConfig): Bulkhead {
  if (config.maxConcurrent < 1) {
    throw new Error("maxConcurrent أقلُّه ١ — حاجزٌ بسعةِ صفرٍ يمنعُ كلَّ شيءٍ");
  }

  let inFlight = 0;

  return {
    tryAcquire(): BulkheadPermit | null {
      if (inFlight >= config.maxConcurrent) return null;
      inFlight += 1;
      let released = false;
      return {
        release(): void {
          // **الحِفظُ من الإفراجِ المزدوجِ**: إفراجانِ عن إذنٍ واحدٍ يُنقِصانِ
          // العدَّ مرّتَينِ، فيصيرُ الحدُّ أكبرَ من المُعلَنِ صامتاً — وذاكَ أسوأُ
          // من غيابِ الحاجزِ لأنَّه غيابٌ يُظَنُّ حضوراً.
          if (released) return;
          released = true;
          inFlight -= 1;
        },
      };
    },
    snapshot(): BulkheadSnapshot {
      return { inFlight, maxConcurrent: config.maxConcurrent };
    },
  };
}

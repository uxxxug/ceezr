# `@waslah/miniapp` — تطبيق وَصْلة (Telegram Mini App)

**البند:** `F1-01` في `docs/ROADMAP-MASTER.md`  
**العقد:** [ADR 0035](../../docs/adr/0035-f1-contract-miniapp-holds-no-business-state.md) · [ADR 0028](../../docs/adr/0028-miniapp-is-the-product-bot-is-the-gateway.md)

## ما هو هذا المشروع

منتج الواجهة الحقيقي لوَصْلة. يُبنى بـ **Vite + React + TypeScript** ويُنشر كـ **أصول ثابتة** (CDN). البوت بوابة دخول وإشعار فقط.

## قواعد غير قابلة للتفاوض (ADR 0035)

1. مسار الهوية الواحد:
   `Telegram Bot → Mini App → تحقق initData → Waslah Session → Product API → Domain/PostgreSQL`
2. **يُمنع** أن يُنشئ Mini App حالة عمل جديدة (Users / Rides / Drivers / Offers / Sessions / Tracking).
3. يجوز فقط: حالة عرض محلية + نسخة قراءة مؤقتة مشتقّة من واجهة المنتج.
4. لا استدعاء لواجهة المنتج بلا جلسة داخلية صالحة.
5. لا ناقل زمن حقيقي إنتاجي في هذه المرحلة — `DEC-06` ما زال مفتوحاً.

## الأوامر

```bash
cd apps/miniapp
bun install
bun run dev        # http://localhost:5173
bun run build      # dist/ static assets
bun run typecheck
bun test
```

## هيكل الحزم (ROADMAP §9.4)

| الحزمة | الحالة في F1-01 |
| --- | --- |
| `shell` | هيكل + حدود خطأ + شاشة إقلاع |
| `identity` | حامل الجلسة فقط (الإصدار من الخادم = F1-03/04) |
| `tg/` | تغليف SDK تيليجرام |
| `api/` | حدود API مع حارس الجلسة |
| `rider-*` / `driver` / `map` / `payment` / `support` | لاحقاً |

## ما لم يُنفَّذ عمداً

- `POST /v1/session/telegram` (F1-03)
- ناقل الزمن الحقيقي (يعتمد على `DEC-06`)
- أي شاشة رحلة أو تسعير أو دفع راكب (مجمّد وفق ADR 0039)

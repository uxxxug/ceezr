# نسخةٌ مطابقةٌ لـ/opt/wasla/shim-overlay/Dockerfile على CasaOS (2026-11-01)، للاستعادةِ الحقيقيّة (OFFSITE-BACKUP.md).
# الأساسُ wasla/upstash-rest-shim:099c1076-base يُبنى من docker/upstash-rest-shim عندَ الالتزام 099c1076.
# تعديل نشر محلي (ليس في المستودع): يحجب كلمة سر Redis من سطر الإقلاع في shim.ts
FROM wasla/upstash-rest-shim:099c1076-base
RUN sed -i 's|-> ${REDIS_URL}`|-> redis (credentials redacted)`|' /shim/shim.ts && grep -n "listening" /shim/shim.ts

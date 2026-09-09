# الغرض: صورةُ محوّلِ Upstash REST — مستقلّةٌ عن workspace المستودع، بحزمةِ ioredis
#   خاصّةٍ بها، فلا تُضافُ إلى bun.lock الرئيسي ولا يطالها حارسُ انحرافِ البيئة.
# ينتمي إلى: docker/upstash-rest-shim
FROM oven/bun:1.3.14
WORKDIR /shim

COPY package.json ./
RUN bun install --frozen-lockfile=false

COPY shim.ts ./

ENV NODE_ENV=production
EXPOSE 8081
CMD ["bun", "run", "shim.ts"]

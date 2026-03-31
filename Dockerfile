FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma/
COPY prisma.config.ts ./
COPY tsconfig.json ./
COPY src ./src/

RUN npx prisma generate && npx tsc

FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/prisma ./prisma/
COPY --from=builder /app/prisma.config.ts ./
COPY --from=builder /app/dist ./dist/
COPY --from=builder /app/src/generated ./src/generated/

ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATABASE_URL="file:./dev.db"
ENV DATABASE_PATH="./dev.db"

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]

FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma/
COPY prisma.config.ts ./
COPY .env ./
RUN npx prisma generate

COPY dist ./dist/

ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATABASE_URL="file:./dev.db"
ENV DATABASE_PATH="./dev.db"

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]

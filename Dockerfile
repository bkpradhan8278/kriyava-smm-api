# SMM API (NestJS + Prisma) — runs on the Kriyava droplet next to InstaAI + WAVE.
# Build:  docker compose -f deploy-droplet/docker-compose.smm.yml build
FROM node:20-slim AS build
WORKDIR /app
# Prisma needs openssl
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
# --ignore-scripts: skip the postinstall `prisma generate` here (schema not copied yet)
RUN npm ci --ignore-scripts
COPY . .
RUN npx prisma generate && npm run build

FROM node:20-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package*.json ./
EXPOSE 4000
# Applies the schema to the (fresh) droplet Postgres, then starts the API.
CMD ["sh","-c","npx prisma db push --skip-generate --accept-data-loss && node dist/main"]

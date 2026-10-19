# Multi-stage Dockerfile for DwarfLens SaaS Backend API
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency specifications
COPY package*.json ./
RUN npm ci

# Copy TypeScript configuration, sources, migrations, and analysis schema
COPY tsconfig.json ./
COPY src/ ./src/
COPY drizzle/ ./drizzle/
COPY schema/ ./schema/

# Compile TypeScript
RUN npm run build

# ---------------------------------------------------------------------------
# Runner Stage
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production

# Copy compiled JavaScript, database migrations, and schema definition
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/schema ./schema

# Security: Run as unprivileged node user
USER node

EXPOSE 3000

CMD ["node", "dist/index.js"]

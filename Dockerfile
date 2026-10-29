# syntax=docker/dockerfile:1
FROM node:22-alpine AS base

WORKDIR /app

# Install dependencies first (layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source code and migrations
COPY src/ ./src/
COPY migrations/ ./migrations/
COPY scripts/ ./scripts/

# Set production environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Expose HTTP port
EXPOSE 3000

# Run server as non-root user for security
USER node

# Start Webhook Dispatcher
CMD ["node", "src/server.js"]

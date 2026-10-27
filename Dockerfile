# Day 4 image for the gated agent layer. Authored in Cursor.
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx --yes degit meterless/meterless/engines/hmem/reference vendor/hmem \
 && npm install --prefix vendor/hmem --no-audit --no-fund \
 && npx --yes degit meterless/meterless/engines/world-model vendor/world-model \
 && npx --yes degit meterless/meterless/engines/markovian vendor/markovian
ENV PORT=8000
EXPOSE 8000
CMD ["npx", "tsx", "src/server.ts"]

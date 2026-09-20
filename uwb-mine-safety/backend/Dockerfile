FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm install --no-save typescript@5.7.3 && npm run build && rm -rf src tsconfig.json

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/server.js"]

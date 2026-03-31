FROM node:22-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc

FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist/ dist/
COPY migrations/ migrations/

ENV PORT=3100
ENV HOST=0.0.0.0
ENV NODE_ENV=production

EXPOSE 3100
CMD ["node", "dist/server.js"]

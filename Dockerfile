# ---- stage 1: build frontenda ----
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# ---- stage 2: runtime ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY db ./db
COPY scripts ./scripts
COPY --from=build /app/dist ./dist

EXPOSE 3001
CMD ["node", "server.js"]

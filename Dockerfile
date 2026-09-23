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
# --chown: fajlovi s Maca često imaju prava 600 (čitljivo samo vlasniku), a
# COPY ih prenosi takve kakvi jesu. Kontejner zato radi kao ne-root korisnik
# "node" (uid 1000) i mora biti vlasnik svojih fajlova (package.json čita Node
# zbog "type": "module").
COPY --chown=node:node package*.json ./
RUN npm install --omit=dev
COPY --chown=node:node server.js ./
COPY --chown=node:node db ./db
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node --from=build /app/dist ./dist

# Ne pokreći kao root (Kubernetes securityContext ionako traži runAsNonRoot).
USER node

EXPOSE 3001
CMD ["node", "server.js"]

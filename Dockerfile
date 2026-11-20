# Docker-build omzeilt Railpack/Nixpacks (die Node via GitHub releases halen).
# Base image komt van Docker Hub, packages van de npm-registry -> geen GitHub,
# dus een GitHub-release-storing blokkeert de build niet.
FROM node:20-alpine

WORKDIR /app

# Alleen prod-deps (marked); playwright is dev-only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# De statische site + panel + tools staan al in de repo.
COPY . .

# Regenereer site/ uit content/*.md zodat op GitHub bewaarde posts (via de
# Contents-API persistentie) bij elke deploy weer in de site verschijnen.
RUN npm run build

# Railway geeft PORT via env; dev-server leest process.env.PORT.
CMD ["node", "tools/dev-server.js"]

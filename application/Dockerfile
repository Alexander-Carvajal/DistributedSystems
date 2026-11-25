FROM node:26-alpine AS dependencies

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:26-alpine

WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node index.js init-db.js db-clients.js messaging.js ./
COPY --chown=node:node database/catalog.sql ./database/catalog.sql
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

USER node

EXPOSE 8080

CMD ["node", "index.js"]

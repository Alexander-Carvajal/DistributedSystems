FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY index.js init-db.js db-clients.js ./
COPY database/catalog.sql ./database/catalog.sql

USER node

EXPOSE 8080

CMD ["npm", "start"]

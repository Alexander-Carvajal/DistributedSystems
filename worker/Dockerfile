FROM node:24-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY worker.js ./
USER node
CMD ["npm", "start"]

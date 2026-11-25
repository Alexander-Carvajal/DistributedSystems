FROM node:22-alpine AS browser-build

WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY browser-instrumentation.js ./
RUN npm run build

FROM nginx/nginx-unprivileged:1.31-alpine-otel

ARG SITE=site1
COPY nginx.container.conf.template /etc/nginx/templates/default.conf.template
COPY catalog.js catalog.css /usr/share/nginx/html/
COPY --from=browser-build /src/dist/otel-instrumentation.js /usr/share/nginx/html/
COPY ${SITE}/ /usr/share/nginx/html/

ENV API_UPSTREAM=http://application-lb-master:8080
EXPOSE 8080

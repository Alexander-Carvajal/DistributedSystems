FROM nginx/nginx-unprivileged:1.31-alpine

ARG SITE=site1
COPY nginx.container.conf.template /etc/nginx/templates/default.conf.template
COPY catalog.js catalog.css /usr/share/nginx/html/
COPY ${SITE}/ /usr/share/nginx/html/

ENV API_UPSTREAM=http://application-lb-master:8080
EXPOSE 8080

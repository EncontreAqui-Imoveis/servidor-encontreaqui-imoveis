FROM node:24-alpine AS build

WORKDIR /usr/app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build


FROM node:24-alpine AS production-dependencies

WORKDIR /usr/app

RUN addgroup -S app && adduser -S app -G app && chown app:app /usr/app

USER app

COPY --chown=app:app package*.json ./

RUN npm ci --omit=dev


FROM node:24-alpine AS runtime

WORKDIR /usr/app

# The service never needs npm at runtime. Removing it also removes its bundled
# transitive packages from the production attack surface.
RUN addgroup -S app && adduser -S app -G app && chown app:app /usr/app \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --chown=app:app --from=production-dependencies /usr/app/node_modules ./node_modules
COPY --chown=app:app --from=build /usr/app/dist ./dist
COPY --chown=app:app --from=build /usr/app/scripts ./scripts
COPY --chown=app:app --from=build /usr/app/estados-cidade.json ./estados-cidade.json

USER app

ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '8080') + '/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["sh", "-c", "node dist/database/deploy.js && node dist/server.js"]

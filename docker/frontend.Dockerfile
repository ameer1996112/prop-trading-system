FROM node:22.22.0-alpine AS dependencies
WORKDIR /app
COPY apps/operations-console/package.json apps/operations-console/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM dependencies AS build
COPY apps/operations-console/ .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22.22.0-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]

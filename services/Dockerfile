# One image definition for all Nude services. Build from the repository root:
#   docker build -f services/Dockerfile --build-arg SERVICE=search -t nude-search .
# SERVICE defaults to search, so hosts that build the Dockerfile without build arguments (Render) get Nude Search.
FROM node:22-alpine
ARG SERVICE=search
ENV NODE_ENV=production HOST=0.0.0.0 NODE_NO_WARNINGS=1
WORKDIR /app
RUN npm install -g tsx@4 && addgroup -S nude && adduser -S nude -G nude
COPY packages/security-engine ./packages/security-engine
COPY services/${SERVICE} ./services/${SERVICE}
RUN mkdir -p /data && chown nude:nude /data
USER nude
WORKDIR /app/services/${SERVICE}
CMD ["tsx", "src/server.ts"]

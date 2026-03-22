FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    openssh-client \
    bash \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

RUN useradd -m -s /bin/bash agent
USER agent
WORKDIR /app

COPY --chown=agent:agent package*.json ./
RUN npm ci --production

COPY --chown=agent:agent dist/ ./dist/
COPY --chown=agent:agent agents/ ./agents/

EXPOSE 3000

CMD ["node", "dist/index.js"]

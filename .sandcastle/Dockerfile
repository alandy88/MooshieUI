FROM node:22-bookworm

RUN apt-get update && apt-get install -y \
  git \
  curl \
  jq \
  unzip \
  ripgrep \
  python-is-python3 \
  python3-pytest \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && apt-get update && apt-get install -y gh \
  && rm -rf /var/lib/apt/lists/*

ARG AGENT_UID=1000
ARG AGENT_GID=1000

RUN groupmod -g $AGENT_GID node && usermod -u $AGENT_UID -g $AGENT_GID -d /home/agent -m -l agent node

USER ${AGENT_UID}:${AGENT_GID}

RUN curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.9"

ENV PATH="/home/agent/.local/bin:/home/agent/.bun/bin:$PATH"

RUN bun install -g @openai/codex

RUN curl -fsSL https://claude.ai/install.sh | bash

WORKDIR /home/agent

ENTRYPOINT ["sleep", "infinity"]

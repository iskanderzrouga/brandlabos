FROM mcr.microsoft.com/playwright:v1.58.2-jammy

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

CMD ["npm", "start"]


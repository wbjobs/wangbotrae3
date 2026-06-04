FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install webrtcvad --break-system-packages || pip3 install webrtcvad

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY scripts/requirements.txt ./scripts/
RUN pip3 install -r scripts/requirements.txt --break-system-packages || true

COPY . .

RUN mkdir -p uploads data

RUN npm run build

EXPOSE 3000 3001

CMD ["sh", "-c", "node api/server.js & npx serve -s dist -l 3000"]

FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=4747
EXPOSE 4747

CMD ["node", "server.js"]

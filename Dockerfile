FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /app/data && chown -R node:node /app/data
ENV NODE_ENV=production PORT=3000 DB_FILE=/app/data/links.db
EXPOSE 3000
USER node
CMD ["node", "src/server.js"]

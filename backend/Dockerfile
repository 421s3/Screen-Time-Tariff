# Backend image for any container host (Railway, Render, Fly, a Vultr VM with Docker).
# Config comes from environment variables (see .env.example); no secrets are baked in.
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 4000
CMD ["npm", "start"]

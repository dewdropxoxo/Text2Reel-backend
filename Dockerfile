# Use the official Node.js image with Puppeteer support
FROM ghcr.io/puppeteer/puppeteer:22.0.0

USER root

# Install FFmpeg
RUN apt-get update && apt-get install -y ffmpeg

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Environment variables for Render.com
ENV PORT=3001
ENV APP_URL=https://your-frontend-url.com

EXPOSE 3001

CMD ["node", "index.js"]
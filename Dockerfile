FROM node:22

# Install system dependencies including FFmpeg
RUN apt-get update && \
    apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg && \
    ffmpeg -version && \
    rm -rf /var/lib/apt/lists/*

# Create necessary directories with proper permissions
RUN mkdir -p /app/backend/uploads && \
    mkdir -p /app/uploads && \
    mkdir -p /app/tmp && \
    mkdir -p /app/output && \
    chmod -R 777 /app/backend/uploads && \
    chmod -R 777 /app/uploads && \
    chmod -R 777 /app/tmp && \
    chmod -R 777 /app/output

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies with authentication and cleanup
# Add your GitHub token as a build arg
ARG GITHUB_TOKEN
RUN echo "//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}" > .npmrc && \
    npm config set registry https://registry.npmjs.org/ && \
    npm install --no-optional --legacy-peer-deps && \
    rm -f .npmrc && \
    npm cache clean --force

# Copy application code
COPY . .

# Set environment variables
ENV NODE_ENV=production
ENV UPLOADS_DIR=/app/backend/uploads
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV TEMP_DIR=/app/tmp
ENV OUTPUT_DIR=/app/output

EXPOSE 4001

CMD ["npm", "start"]
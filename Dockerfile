# Development Dockerfile
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev dependencies)
RUN npm install

# Copy source code (will be overridden by volume mount in dev)
COPY src/ ./src/

# Create session directory
RUN mkdir -p /app/session && chmod 700 /app/session

# Set environment variables defaults
ENV SESSION_PATH=/app/session/telegram-session.json
ENV LOG_LEVEL=info
ENV NODE_ENV=development

# Run the application
CMD ["node", "src/index.js"]

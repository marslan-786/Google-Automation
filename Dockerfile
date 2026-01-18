# Base Image with all Browsers installed
FROM mcr.microsoft.com/playwright:v1.41.0-jammy

# Set Working Directory
WORKDIR /app

# Copy dependency definitions
COPY package.json .

# Install dependencies
RUN npm install

# Copy all files
COPY . .

# Expose Port for Railway
ENV PORT=8080
EXPOSE 8080

# Start the King
CMD ["node", "server.js"]

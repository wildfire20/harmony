# Use the Node.js version required by the current AWS SDK packages.
FROM node:20-bookworm-slim

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
COPY client/package*.json ./client/

# Install server dependencies from the public npm registry. The checked-in lockfile
# contains Replit-internal package URLs that are not reachable from Railway.
RUN npm install --legacy-peer-deps --package-lock=false --registry=https://registry.npmjs.org/

# Install client dependencies from the public npm registry.
RUN cd client && npm install --legacy-peer-deps --package-lock=false --registry=https://registry.npmjs.org/

# Copy the rest of the application
COPY . .

# Build React client
RUN cd client && npm run build

# Expose backend port
EXPOSE 5000

# Start server
CMD ["npm", "start"]

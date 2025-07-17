# Use official Node.js image
FROM node:18

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
COPY client/package*.json ./client/

# Install server dependencies
RUN npm install --legacy-peer-deps

# Install client dependencies
RUN cd client && npm install --legacy-peer-deps

# Copy the rest of the application
COPY . .

# Build React client
RUN cd client && npm run build

# Expose backend port
EXPOSE 5000

# Start server
CMD ["npm", "start"]

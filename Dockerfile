# Use official Node.js image
FROM node:18

# Set working directory
WORKDIR /app

# Copy both server and client code
COPY . .

# Change permissions (fixes react-scripts permission denied)
RUN chmod +x ./client/node_modules/.bin/react-scripts || true

# Install dependencies
RUN npm install --legacy-peer-deps

# Build React client
RUN cd client && npm install --legacy-peer-deps && npm run build

# Expose backend port
EXPOSE 5000

# Start server
CMD ["npm", "start"]

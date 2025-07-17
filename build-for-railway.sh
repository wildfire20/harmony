# Railway-specific build script
# This removes the need for Railway to build the React app

echo "Building client for Railway deployment..."
cd client
npm ci
npm run build
cd ..

echo "Client built successfully for Railway!"
echo "Now commit and push to trigger Railway deployment."

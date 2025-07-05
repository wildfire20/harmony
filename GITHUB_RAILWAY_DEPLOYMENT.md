# 🚀 GitHub Repository Creation & Railway Deployment Guide

## 📂 STEP 1: Create GitHub Repository

### Manual GitHub Repository Creation:

1. **Go to GitHub.com and sign in to your account**

2. **Create new repository:**
   - Click the "+" icon in the top right corner
   - Select "New repository"
   - Repository name: `harmony`
   - Description: `Harmony Learning Institute - Complete school management system with student and teacher panels`
   - Set to **Public** (required for free Railway deployment)
   - **DO NOT** initialize with README, .gitignore, or license (we already have these)
   - Click "Create repository"

3. **Copy the repository URL that GitHub provides (it will look like):**
   ```
   https://github.com/YOUR_USERNAME/harmony.git
   ```

## 📤 STEP 2: Push to GitHub

**Run these commands in your terminal (replace YOUR_USERNAME with your actual GitHub username):**

```powershell
# Add the GitHub remote (replace YOUR_USERNAME)
git remote add origin https://github.com/YOUR_USERNAME/harmony.git

# Push to GitHub
git branch -M main
git push -u origin main
```

## 🚀 STEP 3: Deploy to Railway

### 3.1 Railway Account Setup:
1. Go to [Railway.app](https://railway.app)
2. Sign up with your GitHub account
3. This will automatically connect your GitHub repositories

### 3.2 Deploy the Application:
1. **Create New Project:**
   - Click "Deploy from GitHub repo"
   - Select your `harmony` repository
   - Railway will automatically detect it's a Node.js app

2. **Add PostgreSQL Database:**
   - In your Railway project dashboard
   - Click "+ New Service"
   - Select "Database" → "PostgreSQL"
   - Railway will automatically create a database and provide connection details

3. **Configure Environment Variables:**
   Click on your web service → "Variables" tab and add:
   ```
   NODE_ENV=production
   JWT_SECRET=harmony_learning_super_secure_jwt_secret_2025_production_64_chars
   FRONTEND_URL=https://your-app-name.railway.app
   ```
   
   **Database variables (Railway auto-generates these):**
   - `PGHOST` (Railway provides)
   - `PGPORT` (Railway provides) 
   - `PGDATABASE` (Railway provides)
   - `PGUSER` (Railway provides)
   - `PGPASSWORD` (Railway provides)

4. **Deploy:**
   - Railway automatically deploys when you push to GitHub
   - Your app will be available at: `https://your-project-name.railway.app`

## 🔧 STEP 4: Final Configuration

### 4.1 Update CORS Settings:
Once you have your Railway URL, update the environment variable:
```
FRONTEND_URL=https://your-actual-railway-url.railway.app
```

### 4.2 Database Initialization:
Railway will automatically run the database initialization when the app starts.

### 4.3 Test Your Deployment:
1. Visit your Railway URL
2. Try logging in with: `admin@harmonylearning.edu` / `admin123`
3. Test both student and teacher functionality

## 🎉 You're Live!

Your Harmony Learning Institute will be deployed and accessible worldwide!

**Demo Credentials for Testing:**
- **Admin/Staff**: `admin@harmonylearning.edu` / `admin123`
- **Students**: Use student number as both username and password

## 📞 Need Help?

If you encounter any issues:
1. Check Railway logs in the dashboard
2. Verify all environment variables are set
3. Ensure the GitHub repository is public
4. Check that the database service is running

## 🔄 Future Updates

To update your deployed app:
```powershell
git add .
git commit -m "Updated features"
git push origin main
```
Railway will automatically redeploy with your changes!

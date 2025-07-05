# 🚀 Manual Heroku Deployment Guide

## Step-by-Step Instructions

### Prerequisites
1. **Install Heroku CLI**: Download from https://devcenter.heroku.com/articles/heroku-cli
2. **Install Git**: Download from https://git-scm.com/downloads
3. **Create Heroku Account**: Sign up at https://heroku.com

### Deployment Steps

#### 1. Open Terminal/Command Prompt
Navigate to your project directory:
```bash
cd "c:\Users\HUAWEI\OneDrive\harmony learning institute"
```

#### 2. Login to Heroku
```bash
heroku login
```

#### 3. Initialize Git Repository
```bash
git init
git add .
git commit -m "Initial commit"
```

#### 4. Create Heroku App
```bash
heroku create your-app-name
```
Replace `your-app-name` with your desired app name (must be unique).

#### 5. Add PostgreSQL Database
```bash
heroku addons:create heroku-postgresql:essential-0
```

#### 6. Set Environment Variables
```bash
heroku config:set NODE_ENV=production
heroku config:set JWT_SECRET=your-secret-key-here
heroku config:set JWT_EXPIRE=7d
heroku config:set BCRYPT_ROUNDS=12
heroku config:set FRONTEND_URL=https://your-app-name.herokuapp.com
```

#### 7. Deploy to Heroku
```bash
git push heroku main
```

#### 8. Open Your App
```bash
heroku open
```

### Default Login Credentials
- **Admin Email**: admin@harmonylearning.edu
- **Admin Password**: admin123

### Useful Commands
```bash
# View logs
heroku logs --tail

# Restart app
heroku restart

# View app info
heroku info

# Open app in browser
heroku open
```

### Troubleshooting
If deployment fails:
1. Check logs: `heroku logs --tail`
2. Verify environment variables: `heroku config`
3. Check build logs during deployment
4. Ensure all dependencies are in package.json

Your app will be available at: https://your-app-name.herokuapp.com

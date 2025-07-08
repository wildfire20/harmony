# 🚀 Harmony Learning Institute - Deployment Guide

## Overview
This guide provides step-by-step instructions for deploying the Harmony Learning Institute school management system to production.

## 🛠️ Prerequisites
- Node.js (v16 or higher)
- PostgreSQL (v13 or higher)
- Domain name (optional)
- SSL certificate (recommended)

## 📦 Deployment Options

### Option 1: Traditional VPS/Server Deployment

#### Step 1: Server Setup
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PostgreSQL
sudo apt-get install -y postgresql postgresql-contrib

# Install PM2 for process management
npm install -g pm2

# Install Nginx for reverse proxy
sudo apt-get install -y nginx
```

#### Step 2: Database Setup
```bash
# Create database user
sudo -u postgres createuser --interactive --pwprompt harmonyuser

# Create database
sudo -u postgres createdb -O harmonyuser harmony_learning_db

# Configure PostgreSQL
sudo nano /etc/postgresql/13/main/postgresql.conf
sudo nano /etc/postgresql/13/main/pg_hba.conf
sudo systemctl restart postgresql
```

#### Step 3: Application Deployment
```bash
# Clone/upload your application
git clone <your-repo-url> /var/www/harmony-learning
cd /var/www/harmony-learning

# Install dependencies
npm install
cd client && npm install && npm run build
cd ..

# Set up environment variables
cp .env.example .env
nano .env
```

#### Step 4: Environment Configuration
```env
# Production environment variables
NODE_ENV=production
PORT=5000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=harmony_learning_db
DB_USER=harmonyuser
DB_PASSWORD=your_secure_password
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRE=7d
BCRYPT_ROUNDS=12
FRONTEND_URL=https://your-domain.com
```

#### Step 5: Process Management
```bash
# Start application with PM2
pm2 start server.js --name harmony-backend
pm2 save
pm2 startup
```

#### Step 6: Nginx Configuration
```nginx
# /etc/nginx/sites-available/harmony-learning
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Option 2: Cloud Deployment (Heroku)

#### Step 1: Prepare Application
```bash
# Create Procfile
echo "web: node server.js" > Procfile

# Update package.json
npm install --save-dev @babel/core @babel/preset-env @babel/preset-react
```

#### Step 2: Deploy to Heroku
```bash
# Install Heroku CLI
# Create Heroku app
heroku create harmony-learning-institute

# Add PostgreSQL addon
heroku addons:create heroku-postgresql:hobby-dev

# Set environment variables
heroku config:set NODE_ENV=production
heroku config:set JWT_SECRET=your_jwt_secret
heroku config:set FRONTEND_URL=https://your-app.herokuapp.com

# Deploy
git push heroku main
```

### Option 3: Docker Deployment

#### Step 1: Create Dockerfile
```dockerfile
# Backend Dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY . .

# Build frontend
WORKDIR /app/client
RUN npm ci && npm run build

WORKDIR /app

EXPOSE 5000

CMD ["node", "server.js"]
```

#### Step 2: Docker Compose
```yaml
# docker-compose.yml
version: '3.8'

services:
  db:
    image: postgres:13
    environment:
      POSTGRES_DB: harmony_learning_db
      POSTGRES_USER: harmonyuser
      POSTGRES_PASSWORD: your_password
    volumes:
      - postgres_data:/var/lib/postgresql/data

  app:
    build: .
    ports:
      - "5000:5000"
    environment:
      NODE_ENV: production
      DB_HOST: db
      DB_NAME: harmony_learning_db
      DB_USER: harmonyuser
      DB_PASSWORD: your_password
      JWT_SECRET: your_jwt_secret
    depends_on:
      - db

volumes:
  postgres_data:
```

#### Step 3: Deploy with Docker
```bash
# Build and run
docker-compose up -d

# Check logs
docker-compose logs -f
```

## 🔧 Post-Deployment Configuration

### 1. SSL Certificate Setup
```bash
# Using Let's Encrypt with Certbot
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### 2. Monitoring Setup
```bash
# Set up monitoring
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 30
```

### 3. Database Backup
```bash
# Create backup script
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
pg_dump -h localhost -U harmonyuser harmony_learning_db > /backups/harmony_backup_$DATE.sql
```

## 👥 Testing with Other Users

### Step 1: Create Test Users
Access the admin panel at `https://your-domain.com` and:
1. Login with admin credentials
2. Create test students and teachers
3. Assign students to classes
4. Create sample assignments and announcements

### Step 2: Share Access
Provide test users with:
- Application URL
- Login credentials
- User role (Student/Teacher/Admin)
- Test scenarios to follow

### Step 3: User Testing Scenarios

#### Student Testing:
- Login with student credentials
- View assignments and announcements
- Submit assignments
- Check grades and feedback

#### Teacher Testing:
- Login with teacher credentials
- Create assignments and quizzes
- Grade student submissions
- Post announcements

#### Admin Testing:
- Manage users and classes
- View system statistics
- Export data
- Configure system settings

## 🔍 Production Monitoring

### Key Metrics to Monitor:
- Application uptime
- Response times
- Database performance
- User activity
- Error rates
- Resource usage

### Recommended Tools:
- PM2 for process monitoring
- Nginx logs for web server metrics
- PostgreSQL logs for database monitoring
- Application-specific logging

## 📞 Support and Maintenance

### Regular Tasks:
- Database backups
- Security updates
- Performance optimization
- User feedback collection
- Feature updates

### Emergency Procedures:
- Database restoration
- Application rollback
- Security incident response
- Performance issue resolution

## 🎯 Success Metrics

### Technical Metrics:
- 99.9% uptime
- < 2 second page load times
- Zero critical security vulnerabilities
- Automated backups running

### User Metrics:
- User satisfaction scores
- Feature adoption rates
- Error report frequency
- Support ticket volume

## 🔐 Security Checklist

- [ ] SSL certificate installed
- [ ] Database connections encrypted
- [ ] Strong password policies enforced
- [ ] Regular security updates applied
- [ ] Access logs monitored
- [ ] Backup integrity verified

Your Harmony Learning Institute is now ready for production use! 🎉

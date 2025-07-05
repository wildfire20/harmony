# 🗄️ How to Add PostgreSQL Database to Railway

## 📋 **STEP-BY-STEP VISUAL GUIDE**

### **Step 1: Access Your Railway Project**
1. Go to [Railway.app](https://railway.app)
2. Sign in with GitHub
3. Click on your **"harmony"** project (or whatever you named it)

### **Step 2: Add Database Service**
1. **Look for the "+ New" button** in your project dashboard
   - It might say **"+ New Service"** or **"+ Add Service"**
   - Usually located at the top or in the services area

2. **Click the "+ New" button**
   - A menu will appear with service options

### **Step 3: Select PostgreSQL**
1. **Click "Database"** from the service menu
2. **Select "PostgreSQL"** from the database options
3. **Click "Add PostgreSQL"** or similar button

### **Step 4: Wait for Provisioning**
- Railway will automatically:
  - ✅ Create a PostgreSQL database instance
  - ✅ Generate connection credentials
  - ✅ Set up environment variables

### **Step 5: Verify Database Variables**
1. **Go to your web service** (the one running your Node.js app)
2. **Click on "Variables" tab**
3. **You should see these variables automatically added:**
   ```
   PGHOST=containers-us-west-xxx.railway.app
   PGPORT=5432
   PGDATABASE=railway
   PGUSER=postgres
   PGPASSWORD=random-generated-password
   DATABASE_URL=postgresql://postgres:password@host:5432/railway
   ```

### **Step 6: Add Required Environment Variables**
**In the same Variables tab, add these manually:**
```
NODE_ENV=production
JWT_SECRET=harmony_learning_super_secure_jwt_secret_2025_production_railway_wildfire20_64chars
FRONTEND_URL=https://your-railway-domain.railway.app
```

### **Step 7: Deploy**
- Railway will automatically redeploy with the new database
- Your app will initialize the database tables automatically

---

## 🔍 **WHAT TO LOOK FOR IN RAILWAY DASHBOARD:**

### **Project Overview:**
```
📦 Your Project Name
├── 🌐 web (Node.js app)
└── 🗄️ postgresql (Database)
```

### **Database Service Panel:**
- **Service Name**: postgresql
- **Status**: Running (green)
- **Connection**: Shows host and port

### **Web Service Variables:**
Should include all the PG* variables automatically

---

## 🚨 **TROUBLESHOOTING:**

### **If database variables don't appear:**
1. **Redeploy your web service**
2. **Check the "Connect" tab** in database service
3. **Manually add DATABASE_URL** if needed

### **If connection fails:**
1. **Verify all PG* variables are present**
2. **Check database service is running**
3. **Look at deployment logs** for connection errors

---

## ✅ **SUCCESS INDICATORS:**

You'll know it's working when:
- ✅ Database service shows "Running"
- ✅ Web service has all PG* environment variables
- ✅ App deploys without database connection errors
- ✅ You can access the login page
- ✅ Admin login works: `admin@harmonylearning.edu` / `admin123`

---

## 🎯 **FINAL RESULT:**

Your Harmony Learning Institute will be live with:
- **Frontend**: React app with professional UI
- **Backend**: Node.js API server
- **Database**: PostgreSQL with all tables and admin user
- **URL**: `https://web-production-[random].up.railway.app`

---

**The database will be automatically initialized with tables and the admin user when your app first starts!** 🎉

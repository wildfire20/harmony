# 🚀 RAILWAY POSTGRESQL - QUICK REFERENCE

## 🔥 **SUPER QUICK STEPS:**

1. **Railway Dashboard** → **"+ New Service"**
2. **"Database"** → **"PostgreSQL"** 
3. **Wait for provisioning** (2-3 minutes)
4. **Check Variables tab** → Should see `PG*` variables
5. **Add these manually:**
   ```
   NODE_ENV=production
   JWT_SECRET=harmony_learning_super_secure_jwt_secret_2025_production_railway_wildfire20_64chars
   FRONTEND_URL=https://your-railway-domain.railway.app
   ```
6. **Deploy** → **Test at your Railway URL**

---

## 🎯 **WHAT YOU'RE LOOKING FOR:**

### **In Project Dashboard:**
```
🌐 web (your app)
🗄️ postgresql (database)
```

### **In Variables Tab:**
```
✅ PGHOST
✅ PGPORT  
✅ PGDATABASE
✅ PGUSER
✅ PGPASSWORD
✅ DATABASE_URL
✅ NODE_ENV
✅ JWT_SECRET
✅ FRONTEND_URL
```

### **Test Credentials:**
- **Admin**: `admin@harmonylearning.edu` / `admin123`
- **Student**: `12345` / `12345`

---

## 🆘 **IF STUCK:**

1. **"+ New Service" not visible?** → Look for "Add Service" or "+" button
2. **No PostgreSQL option?** → Click "Database" first
3. **Variables not showing?** → Wait 2-3 minutes, then refresh
4. **App not connecting?** → Check logs in Railway dashboard

---

**That's it! Your school management system will be live with full database functionality!** 🎓✨

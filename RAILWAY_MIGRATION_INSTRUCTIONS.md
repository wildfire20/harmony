# 🚀 Railway Database Migration Instructions

## 📋 **Problem:** 
The document marking system shows "Failed to save marking" because the database is missing the required columns for teacher comments and annotations.

## ✅ **Solution:**
I've created an HTTP endpoint that will add the missing database columns. 

## 🔧 **Steps to Fix:**

### **1. Wait for Deployment** (2-3 minutes)
- The migration endpoint is now being deployed to Railway
- Check your Railway dashboard until you see "Deployment successful"

### **2. Run the Migration**
Once deployed, visit this URL in your browser:

```
https://web-production-618c0.up.railway.app/run-migration-once?key=migrate-marking-system-2025
```

### **3. Expected Response**
You should see a JSON response like this:

```json
{
  "teacher_comments": "MISSING",
  "annotations": "MISSING", 
  "actions": [
    "Added teacher_comments column",
    "Added annotations column"
  ],
  "statistics": {
    "total_submissions": 5,
    "with_comments": 0,
    "with_annotations": 0
  },
  "success": true,
  "message": "Migration completed successfully!"
}
```

### **4. Test the Marking System**
After running the migration:
1. Go back to your Harmony Learning application
2. Navigate to any task with student submissions
3. Click "Mark Document" on a submission
4. Add a score and teacher comments
5. Click "Save Marking"
6. ✅ It should now save successfully!

## 🔒 **Security Notes**
- The migration endpoint requires a special key for security
- It can only be run once (it checks if columns already exist)
- The endpoint will be removed in future updates

## 🚨 **If Migration Fails**
If you get an error response:
1. Check the error message in the JSON response
2. Wait a few minutes and try again
3. Verify your Railway database is running
4. Contact support if issues persist

## 📝 **After Success**
Once the migration runs successfully:
- Teachers can mark documents and save feedback
- Students can view their graded submissions
- The document marking system is fully functional
- No more "Failed to save marking" errors

---

**This is a one-time setup that enables the complete document marking system for your school.**

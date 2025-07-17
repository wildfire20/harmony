## 🔧 S3 Configuration Troubleshooting Guide

### The Error You're Seeing
**"The request signature we calculated does not match the signature you provided"**

This is a classic AWS credentials authentication error. Here's how to fix it:

### 🔍 Step 1: Verify Railway Environment Variables

1. **Go to Railway Dashboard**: https://railway.app/dashboard
2. **Select your project**: "content-compassion"
3. **Go to Variables tab**
4. **Check these variables exist and are correct**:

```
AWS_ACCESS_KEY_ID=AKIA...  (should start with AKIA)
AWS_SECRET_ACCESS_KEY=...  (long alphanumeric string)
AWS_S3_BUCKET_NAME=harmony-learning-documents  (or your bucket name)
AWS_REGION=us-east-1  (or your preferred region)
```

### 🚨 Common Issues and Fixes:

#### Issue 1: Wrong or Missing Credentials
- **Fix**: Go to AWS IAM Console → Users → Your User → Security Credentials
- **Create new access key** if needed
- **Copy EXACT values** to Railway (no extra spaces!)

#### Issue 2: Incorrect Region
- **Fix**: Check your S3 bucket region in AWS Console
- **Update AWS_REGION** in Railway to match

#### Issue 3: Permissions Problem
- **Fix**: Ensure your IAM user has these permissions:
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:PutObject",
                "s3:GetObject",
                "s3:DeleteObject",
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::your-bucket-name",
                "arn:aws:s3:::your-bucket-name/*"
            ]
        }
    ]
}
```

#### Issue 4: Bucket Policy Blocking Access
- **Check**: Go to S3 Console → Your Bucket → Permissions → Bucket Policy
- **Fix**: Ensure no deny statements block your IAM user

### 🧪 Test Your Configuration

1. **Open Railway logs** after deployment
2. **Look for these startup messages**:
   ```
   🔍 S3 Configuration Validation:
   ✅ AWS_ACCESS_KEY_ID: [SET]
   ✅ AWS_SECRET_ACCESS_KEY: [SET]
   ✅ AWS_S3_BUCKET_NAME: your-bucket-name
   ✅ AWS_REGION: us-east-1
   ✅ S3 Config Valid: true
   ✅ S3 Client created successfully
   ```

3. **If you see errors**, the logs will tell you exactly what's missing

### 🔄 After Fixing Variables:

1. **Save changes** in Railway dashboard
2. **Wait for automatic redeploy** (or trigger manual redeploy)
3. **Test document upload** again
4. **Check browser console** for detailed error messages

### 📞 Need Help?

If you're still having issues:
1. **Share Railway deployment logs** 
2. **Check AWS CloudTrail** for failed API calls
3. **Verify IAM user permissions** in AWS Console

The enhanced error handling will now give you much more specific information about what's wrong!

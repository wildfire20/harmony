# AWS S3 Setup Guide for Harmony Learning Institute

## 🚀 Quick Setup Steps

### 1. Create AWS Account
- Go to [AWS Console](https://console.aws.amazon.com/)
- Sign up for a free account (includes 12 months of free tier)

### 2. Create S3 Bucket
```bash
# Bucket name (must be globally unique)
harmony-learning-documents-[your-unique-suffix]
```

**Manual Setup:**
1. Go to S3 in AWS Console
2. Click "Create bucket"
3. Name: `harmony-learning-documents-[your-suffix]`
4. Region: Choose closest to your users (e.g., `us-east-1`)
5. **Block Public Access**: Keep enabled (we'll use signed URLs)
6. Click "Create bucket"

### 3. Create IAM User for Application
1. Go to IAM → Users → "Add user"
2. Username: `harmony-app-user`
3. Access type: **Programmatic access**
4. Permissions: **Attach existing policies directly**
5. Policy: `AmazonS3FullAccess` (or create custom policy below)
6. Save the **Access Key ID** and **Secret Access Key**

### 4. Custom IAM Policy (Recommended - More Secure)
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:PutObject",
                "s3:DeleteObject",
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::harmony-learning-documents-[your-suffix]",
                "arn:aws:s3:::harmony-learning-documents-[your-suffix]/*"
            ]
        }
    ]
}
```

### 5. Configure Railway Environment Variables
In Railway dashboard, add these variables:
```
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
AWS_S3_BUCKET_NAME=harmony-learning-documents-[your-suffix]
```

### 6. Run Database Migration
```sql
-- Run this in your Railway PostgreSQL database
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS s3_key VARCHAR(500),
ADD COLUMN IF NOT EXISTS s3_url TEXT,
ADD COLUMN IF NOT EXISTS original_file_name VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_documents_s3_key ON documents(s3_key);

UPDATE documents 
SET original_file_name = file_name 
WHERE original_file_name IS NULL;
```

## 💰 AWS Pricing (Free Tier)
- **S3 Storage**: 5 GB free for 12 months
- **Requests**: 20,000 GET requests, 2,000 PUT requests per month
- **Data Transfer**: 15 GB out per month

## 🔧 Alternative Cloud Storage Options

### Google Cloud Storage
```bash
npm install @google-cloud/storage
```

### Cloudinary (Image/Video focused)
```bash
npm install cloudinary
```

### DigitalOcean Spaces (S3-compatible)
```bash
# Same as S3, just change the endpoint
AWS_ENDPOINT=https://nyc3.digitaloceanspaces.com
```

## 🚦 Testing Your Setup

1. Deploy the updated code to Railway
2. Upload a new document through the web interface
3. Try to view and download it
4. Check AWS S3 console to see the uploaded file

## 🔍 Troubleshooting

### "Access Denied" Errors
- Check IAM permissions
- Verify bucket name in environment variables
- Ensure AWS credentials are correct

### "Bucket not found"
- Check bucket name spelling
- Verify the bucket exists in the correct region
- Make sure region matches in environment variables

### Files not uploading
- Check file size (10MB limit)
- Verify file type is allowed
- Check Railway logs for detailed errors

## 📈 Migration from Local Storage

Existing documents (uploaded before S3) will show as "legacy documents" and users will be prompted to re-upload them. The system gracefully handles both old and new documents.

## 🔐 Security Features

- **Private buckets**: Files not publicly accessible
- **Signed URLs**: Temporary access (1-5 minutes for downloads)
- **Access control**: Only authenticated users can access files
- **File type validation**: Only allowed file types accepted

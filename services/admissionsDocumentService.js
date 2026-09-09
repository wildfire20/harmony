const crypto = require('node:crypto');
const path = require('node:path');
const { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client, bucketConfig, isS3ConfigValid } = require('../config/s3');

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const TYPES = Object.freeze({
  PDF: { mime: 'application/pdf', extension: '.pdf' },
  JPEG: { mime: 'image/jpeg', extension: '.jpg' },
  PNG: { mime: 'image/png', extension: '.png' },
});

function detectType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (
    buffer.length >= 12
    && buffer.subarray(0, 5).toString('ascii') === '%PDF-'
    && /%%EOF\s*$/.test(buffer.subarray(Math.max(0, buffer.length - 1024)).toString('latin1'))
  ) return TYPES.PDF;
  if (
    buffer.length >= 4
    && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    && buffer.subarray(-2).equals(Buffer.from([0xff, 0xd9]))
  ) return TYPES.JPEG;
  if (
    buffer.length >= 20
    && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && buffer.subarray(-12, -8).equals(Buffer.from([0x00, 0x00, 0x00, 0x00]))
    && buffer.subarray(-8, -4).toString('ascii') === 'IEND'
    && buffer.subarray(-4).equals(Buffer.from([0xae, 0x42, 0x60, 0x82]))
  ) return TYPES.PNG;
  return null;
}

function validateAdmissionsFile(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) throw Object.assign(new Error('A document is required.'), { status: 400 });
  if (file.buffer.length < 1 || file.buffer.length > MAX_FILE_SIZE) {
    throw Object.assign(new Error('Documents must be no larger than 10MB.'), { status: 400 });
  }
  const detected = detectType(file.buffer);
  if (!detected || file.mimetype !== detected.mime) {
    throw Object.assign(new Error('Only valid PDF, JPEG, or PNG documents are accepted.'), { status: 400 });
  }
  return detected;
}

function requireStorage() {
  if (!isS3ConfigValid || !s3Client || !bucketConfig.bucketName) {
    throw Object.assign(new Error('Admissions document storage is unavailable.'), { status: 503 });
  }
}

async function uploadAdmissionsDocument({ buffer, contentType, publicId, originalFilename }) {
  requireStorage();
  const type = detectType(buffer);
  if (!type || type.mime !== contentType) throw Object.assign(new Error('Invalid document content.'), { status: 400 });
  const safeName = path.basename(originalFilename || 'document').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const key = `admissions/private/${publicId.slice(0, 2)}/${crypto.randomBytes(24).toString('hex')}${type.extension}`;
  await s3Client.send(new PutObjectCommand({
    Bucket: bucketConfig.bucketName, Key: key, Body: buffer, ContentType: type.mime,
    ServerSideEncryption: 'AES256',
  }));
  return {
    key, sha256, originalFilename: safeName, contentType: type.mime,
    detectedContentType: type.mime, fileSize: buffer.length,
  };
}

async function deleteAdmissionsDocument(key) {
  if (!key || !isS3ConfigValid || !s3Client) return false;
  try {
    await s3Client.send(new DeleteObjectCommand({ Bucket: bucketConfig.bucketName, Key: key }));
    return true;
  } catch (error) {
    console.error('Admissions document cleanup failed:', error.message);
    return false;
  }
}

async function getAdmissionsDocumentStream(key) {
  requireStorage();
  const response = await s3Client.send(new GetObjectCommand({ Bucket: bucketConfig.bucketName, Key: key }));
  return response.Body;
}

module.exports = {
  MAX_FILE_SIZE, detectType, validateAdmissionsFile, uploadAdmissionsDocument,
  deleteAdmissionsDocument, getAdmissionsDocumentStream,
};
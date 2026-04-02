const webpush = require('web-push');
const db = require('../config/database');

webpush.setVapidDetails(
  process.env.VAPID_EMAIL || 'mailto:harmonylearninginstitute@gmail.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

async function sendToAllParents(payload) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  try {
    const result = await db.query('SELECT id, subscription FROM parent_push_subscriptions WHERE is_active = true');
    const sends = result.rows.map(async (row) => {
      try {
        await webpush.sendNotification(row.subscription, JSON.stringify(payload));
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await db.query('UPDATE parent_push_subscriptions SET is_active = false WHERE id = $1', [row.id]);
        }
      }
    });
    await Promise.allSettled(sends);
  } catch (err) {
    console.error('Push notification error:', err.message);
  }
}

async function notifyNewAnnouncement(title, body) {
  await sendToAllParents({
    type: 'announcement',
    title: `📢 ${title}`,
    body: body ? body.substring(0, 120) : 'A new notice has been posted',
    url: '/parent/announcements',
    icon: '/icons/icon-192x192.png'
  });
}

async function notifyNewDocument(title, docType) {
  const typeLabel = docType ? (docType.charAt(0).toUpperCase() + docType.slice(1)) : 'Document';
  await sendToAllParents({
    type: 'document',
    title: `📄 New ${typeLabel} Available`,
    body: title || 'A new document has been shared with you',
    url: '/parent/documents',
    icon: '/icons/icon-192x192.png'
  });
}

module.exports = { sendToAllParents, notifyNewAnnouncement, notifyNewDocument };

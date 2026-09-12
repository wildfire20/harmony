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

// Send push to parents of specific students (identified by student IDs)
async function sendToParentsOfStudents(studentIds, payload) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  if (!studentIds || studentIds.length === 0) return;
  try {
    const result = await db.query(`
      SELECT DISTINCT pps.id, pps.subscription
      FROM parent_push_subscriptions pps
      JOIN parent_students ps ON ps.parent_id = pps.parent_id
      WHERE ps.student_id = ANY($1::int[])
        AND pps.is_active = true
    `, [studentIds]);

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
    console.error('Push notification (targeted) error:', err.message);
  }
}

// Durable notifications identify the exact parent recipients.  Do not broaden
// a learner event to every subscription belonging to the school.
async function sendToParents(parentIds, payload) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  const ids = (Array.isArray(parentIds) ? parentIds : [])
    .map(Number).filter(Number.isSafeInteger);
  if (!ids.length) return;
  try {
    const result = await db.query(`
      SELECT id, subscription
      FROM parent_push_subscriptions
      WHERE parent_id = ANY($1::int[]) AND is_active = true
    `, [ids]);
    await Promise.allSettled(result.rows.map(async (row) => {
      try {
        await webpush.sendNotification(row.subscription, JSON.stringify(payload));
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await db.query('UPDATE parent_push_subscriptions SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [row.id]);
        }
      }
    }));
  } catch (err) {
    console.error('Push notification (parent-targeted) error:', err.message);
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

async function notifyNewFee(feeName, amount, gradeName, studentIds) {
  const amountFmt = `R ${Number(amount).toFixed(2)}`;
  const gradeLabel = gradeName ? ` for ${gradeName}` : '';
  await sendToParentsOfStudents(studentIds, {
    type: 'fee',
    title: `💳 New Fee${gradeLabel}`,
    body: `${feeName} — ${amountFmt}. Check your Fees screen for details.`,
    url: '/parent/invoices',
    icon: '/icons/icon-192x192.png'
  });
}

module.exports = { sendToAllParents, sendToParentsOfStudents, sendToParents, notifyNewAnnouncement, notifyNewDocument, notifyNewFee };

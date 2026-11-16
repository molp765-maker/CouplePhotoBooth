const admin = require('firebase-admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');

admin.initializeApp();

exports.removeExpiredSoloSessions = onSchedule('every 15 minutes', async () => {
  const now = Date.now();
  const sessionsRef = admin.database().ref('sessions');
  const expired = await sessionsRef.orderByChild('expiresAt').endAt(now).once('value');
  const bucket = admin.storage().bucket();

  await Promise.all(Object.entries(expired.val() || {}).map(async ([sessionId, session]) => {
    if (!session || Number(session.expiresAt) > now) return;
    await bucket.deleteFiles({ prefix: `sessions/${sessionId}/` });
    await sessionsRef.child(sessionId).remove();
  }));
});

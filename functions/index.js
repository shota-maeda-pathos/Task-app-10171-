const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();

exports.onCommentCreated = onDocumentCreated(
  {
    document: 'tasks/{taskId}/comments/{commentId}',
    region: 'asia-northeast1',
  },
  async (event) => {
    const comment = event.data.data();
    const taskId = event.params.taskId;

    // タスクを取得
    const taskDoc = await db.collection('tasks').doc(taskId).get();
    if (!taskDoc.exists) return null;
    const task = taskDoc.data();

    // 担当者がいない or コメント投稿者が担当者自身の場合は通知しない
    if (!task.assigneeId) return null;
    if (task.assigneeId === comment.authorId) return null;

    // 担当者のFCMトークンを取得
    const memberDoc = await db.collection('members').doc(task.assigneeId).get();
    if (!memberDoc.exists) return null;
    const member = memberDoc.data();
    if (!member.fcmToken) return null;

    // 通知を送信
    const message = {
      token: member.fcmToken,
      notification: {
        title: `「${task.title}」にコメントが届きました`,
        body: `${comment.authorName}: ${comment.text.slice(0, 50)}`,
      },
      webpush: {
        fcmOptions: {
          link: '/board',
        },
      },
    };

    try {
      await messaging.send(message);
      console.log('通知送信成功:', task.assigneeId);
    } catch (error) {
      console.error('通知送信失敗:', error);
    }

    return null;
  }
);
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCno1gHFdQ0R10PpVfysXgGvU5-KhsYtd4',
  authDomain: 'kensyu10171.firebaseapp.com',
  projectId: 'kensyu10171',
  storageBucket: 'kensyu10171.firebasestorage.app',
  messagingSenderId: '99628241631',
  appId: '1:99628241631:web:32640b98ee26cd16198f6a',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('バックグラウンド通知受信:', payload);
  const title = payload.notification?.title ?? '通知';
  const body = payload.notification?.body ?? '';
  self.registration.showNotification(title, { body });
});
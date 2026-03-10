// Axis Service Worker — handles background notifications
const CACHE = 'axis-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

// Store scheduled tasks in memory (persisted via IndexedDB)
let scheduledTasks = [];

// Open IndexedDB to persist tasks across SW restarts
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('axis-reminders', 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore('tasks', { keyPath: 'id' });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveTasks(tasks) {
  try {
    const db = await openDB();
    const tx = db.transaction('tasks', 'readwrite');
    const store = tx.objectStore('tasks');
    await store.clear();
    for (const t of tasks) store.put(t);
  } catch(e) { console.error('SW: saveTasks error', e); }
}

async function loadTasks() {
  try {
    const db = await openDB();
    const tx = db.transaction('tasks', 'readonly');
    const store = tx.objectStore('tasks');
    return await new Promise((res, rej) => {
      const req = store.getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => rej(req.error);
    });
  } catch(e) { return []; }
}

// Message from the app — schedule or clear reminders
self.addEventListener('message', async e => {
  if (e.data.type === 'SCHEDULE_REMINDER') {
    const task = e.data.task;
    // Load existing, remove any old entry for same id, add new
    let tasks = await loadTasks();
    tasks = tasks.filter(t => t.id !== task.id);
    tasks.push(task);
    await saveTasks(tasks);
    scheduledTasks = tasks;
  }

  if (e.data.type === 'CLEAR_REMINDER') {
    let tasks = await loadTasks();
    tasks = tasks.filter(t => t.id !== e.data.taskId);
    await saveTasks(tasks);
    scheduledTasks = tasks;
  }

  if (e.data.type === 'CLEAR_ALL') {
    await saveTasks([]);
    scheduledTasks = [];
  }
});

// Check every minute if any task is due
async function checkReminders() {
  const tasks = await loadTasks();
  const now = new Date();
  const toRemove = [];

  for (const task of tasks) {
    const due = new Date(`${task.date}T${task.time}`);
    const diffMs = due - now;

    // Fire if within the next 60 seconds (catches the minute it's due)
    if (diffMs >= 0 && diffMs <= 60000) {
      self.registration.showNotification('⏰ Axis', {
        body: task.name,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: task.id,
        renotify: false,
        requireInteraction: false,
        silent: false,
      });
      toRemove.push(task.id);
    }

    // Remove past tasks
    if (diffMs < -60000) {
      toRemove.push(task.id);
    }
  }

  if (toRemove.length > 0) {
    const remaining = tasks.filter(t => !toRemove.includes(t.id));
    await saveTasks(remaining);
  }
}

// Run check every 30 seconds
setInterval(checkReminders, 30000);

// Also run immediately on activation
checkReminders();

// Tap notification → open the app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});

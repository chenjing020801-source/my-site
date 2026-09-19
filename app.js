const STORAGE_KEY = 'chikawa-workbench-tasks-v1';
const SETTINGS_KEY = 'chikawa-workbench-settings-v1';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const formatTime = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const formatDate = (date) => `${date.getMonth() + 1}月${date.getDate()}日`;

let tasks = loadTasks();
let settings = loadSettings();
let selectedDate = new Date();
let activeReminderId = null;
let toastTimer;
let petSpeechTimer;
let flashTitleTimer;
let currentView = 'today';
let petDragState = { active: false, moved: false, ignoreClick: false, offsetX: 0, offsetY: 0 };
const normalDocumentTitle = document.title;

function newId() {
  return window.crypto && typeof window.crypto.randomUUID === 'function'
    ? window.crypto.randomUUID()
    : `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadTasks() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (Array.isArray(saved)) {
      // Remove the two demo records from earlier prototype versions.
      const cleaned = saved
        .filter((task) => !['整理今天的工作节奏', '提交日报'].includes(task.title))
        .map(migrateLegacyDotTime);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
      return cleaned;
    }
  } catch (_) {}
  return [];
}

function migrateLegacyDotTime(task) {
  const legacy = String(task.title || '').match(/^(\d{1,2})\.(\d{2})(.*)$/);
  if (!legacy || Number(new Date(task.dueAt).getMinutes()) !== 0) return task;
  const due = new Date(task.dueAt);
  due.setHours(Number(legacy[1]), Number(legacy[2]), 0, 0);
  return { ...task, title: legacy[3].trim() || '新的提醒事项', dueAt: due.toISOString(), reminderShown: false };
}

function loadSettings() {
  try { return { notifications: true, sound: true, startup: false, quiet: true, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch (_) { return { notifications: true, sound: true, startup: false, quiet: true }; }
}

function saveAll() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  updateStatus('本地保存成功');
}

function updateStatus(message) {
  const target = $('.tiny-status span:last-child');
  if (!target) return;
  target.textContent = message;
  setTimeout(() => { target.textContent = '本地模式 · 已保存'; }, 1600);
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

function parseNaturalInput(raw) {
  const text = raw.trim();
  if (!text) return { error: '先告诉我想提醒什么吧。' };
  // Accept common Chinese time forms: 13:42, 13：42, 13.42, 13点42分, 13时42分.
  const timeMatch = text.match(/(上午|早上|中午|下午|晚上|今晚)?\s*(\d{1,2})(?:\s*[:：.]\s*(\d{1,2})\s*分?|\s*(?:点|时)(?:\s*(\d{1,2})\s*分?)?)?/);
  if (!timeMatch) return { error: '还缺一个明确的时间，例如“下午 3 点”或“16:30”。' };

  let hour = Number(timeMatch[2]);
  const minute = timeMatch[3] ? Number(timeMatch[3]) : (timeMatch[4] ? Number(timeMatch[4]) : 0);
  const period = timeMatch[1] || '';
  if ((period === '下午' || period === '晚上' || period === '今晚') && hour < 12) hour += 12;
  if (period === '中午' && hour < 11) hour += 12;
  if (hour > 23 || minute > 59) return { error: '这个时间好像不太对，请重新输入。' };

  const date = new Date();
  if (text.includes('明天')) date.setDate(date.getDate() + 1);
  else if (text.includes('后天')) date.setDate(date.getDate() + 2);
  else if (text.includes('昨天')) return { error: '提醒时间需要是现在或未来的时间。' };
  const dateMatch = text.match(/(\d{4})[年\-/](\d{1,2})[月\-/](\d{1,2})日?/);
  if (dateMatch) { date.setFullYear(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3])); }
  date.setHours(hour, minute, 0, 0);
  if (date.getTime() <= Date.now()) {
    if (!text.includes('明天') && !text.includes('后天') && !dateMatch) date.setDate(date.getDate() + 1);
  }
  const title = text
    .replace(/提醒我|提醒一下我|提醒我去|帮我提醒|请提醒我/g, '')
    .replace(/(今天|明天|后天|\d{4}[年\-/]\d{1,2}[月\-/]\d{1,2}日?)/g, '')
    .replace(/(上午|早上|中午|下午|晚上|今晚)?\s*\d{1,2}\s*(?:[:：.]\s*\d{1,2}\s*分?|点(?:\s*\d{1,2}\s*分?)?|时(?:\s*\d{1,2}\s*分?)?)/g, '')
    .replace(/[，,。；;]/g, ' ')
    .trim();
  return { title: title || '新的提醒事项', dueAt: date.toISOString() };
}

function addTask(raw) {
  const parsed = parseNaturalInput(raw);
  if (parsed.error) { $('#input-hint').textContent = parsed.error; $('#input-hint').style.color = '#d88791'; return; }
  const task = { id: newId(), title: parsed.title, dueAt: parsed.dueAt, note: '', status: 'pending', reminderShown: false };
  tasks.push(task);
  tasks.sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
  saveAll();
  $('#task-input').value = '';
  $('#input-hint').textContent = '已放进今天的工作节奏里。';
  $('#input-hint').style.color = '#9b8c83';
  selectedDate = new Date(parsed.dueAt);
  render();
  showToast(`已设置：${formatDate(new Date(task.dueAt))} ${formatTime(new Date(task.dueAt))} 提醒你`);
}

function taskForDate(task, date) { return dateKey(new Date(task.dueAt)) === dateKey(date); }
function pendingTasks() { return tasks.filter((task) => task.status !== 'completed').sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt)); }

function render() {
  renderHeader(); renderCalendar(); renderTimeline(); renderTodo();
}

function renderHeader() {
  const today = new Date();
  const hour = today.getHours();
  $('#greeting').textContent = hour < 12 ? '早上好，先完成一件小事。' : hour < 18 ? '今天也慢慢来，先完成一件事。' : '辛苦啦，把剩下的事放好。';
  $('.topbar .eyebrow').textContent = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
  $('#calendar-month').textContent = `${selectedDate.getFullYear()} 年 ${selectedDate.getMonth() + 1} 月`;
}

function renderCalendar() {
  const grid = $('#calendar-grid'); grid.innerHTML = '';
  const year = selectedDate.getFullYear(); const month = selectedDate.getMonth();
  const first = new Date(year, month, 1); const start = (first.getDay() + 6) % 7; const days = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();
  for (let i = 0; i < 42; i += 1) {
    const button = document.createElement('button');
    const number = i - start + 1;
    let date;
    if (number < 1) { date = new Date(year, month - 1, prevDays + number); button.className = 'muted'; button.textContent = date.getDate(); }
    else if (number > days) { date = new Date(year, month + 1, number - days); button.className = 'muted'; button.textContent = date.getDate(); }
    else { date = new Date(year, month, number); button.textContent = number; }
    if (dateKey(date) === dateKey(new Date())) button.classList.add('today');
    if (dateKey(date) === dateKey(selectedDate)) button.classList.add('selected');
    button.addEventListener('click', () => { selectedDate = date; render(); });
    grid.appendChild(button);
  }
}

function renderTimeline() {
  const timeline = $('#timeline'); timeline.innerHTML = '';
  const visibleTasks = currentView === 'todo'
    ? pendingTasks()
    : currentView === 'history'
      ? tasks.filter((task) => task.status === 'completed').sort((a, b) => new Date(b.dueAt) - new Date(a.dueAt))
      : tasks.filter((task) => taskForDate(task, selectedDate)).sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
  const title = currentView === 'todo' ? '全部待办' : currentView === 'history' ? '完成记录' : '今日时间轴';
  const emptyTitle = currentView === 'todo' ? '还没有待办事项' : currentView === 'history' ? '还没有完成记录' : '今天还没有安排';
  $('#timeline-title').textContent = title;
  $('#timeline-empty-title').textContent = emptyTitle;
  $('#today-count').textContent = `${visibleTasks.length} 项`;
  $('#timeline-empty').classList.toggle('hidden', visibleTasks.length > 0);
  visibleTasks.forEach((task) => {
    const due = new Date(task.dueAt);
    const row = document.createElement('div'); row.className = 'timeline-row';
    row.innerHTML = `<div class="timeline-time">${formatTime(due)}</div><div class="timeline-line"><div class="timeline-item ${task.status === 'completed' ? 'done' : ''}"><div class="item-main"><div class="item-title">${escapeHtml(task.title)}</div>${task.note ? `<div class="item-note">${escapeHtml(task.note)}</div>` : ''}</div><div class="item-actions"><button class="item-action" data-action="edit" data-id="${task.id}">编辑</button><button class="item-action" data-action="done" data-id="${task.id}">${task.status === 'completed' ? '恢复' : '知道了'}</button></div></div></div>`;
    timeline.appendChild(row);
  });
}

function renderTodo() {
  const list = $('#todo-list'); list.innerHTML = '';
  const todo = (currentView === 'history' ? tasks.filter((task) => task.status === 'completed').sort((a, b) => new Date(b.dueAt) - new Date(a.dueAt)) : pendingTasks()).slice(0, 5);
  if (!todo.length) { list.innerHTML = '<div class="empty-state"><strong>小篮子空空的</strong><span>完成得很棒，去休息一下吧</span></div>'; return; }
  todo.forEach((task) => {
    const due = new Date(task.dueAt); const item = document.createElement('div'); item.className = 'todo-item';
    item.innerHTML = `<button class="todo-check" data-action="done" data-id="${task.id}" aria-label="完成事项"></button><span title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</span><small>${dateKey(due) === dateKey(new Date()) ? formatTime(due) : formatDate(due)}</small>`;
    list.appendChild(item);
  });
}

function escapeHtml(value) { return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }

function openEdit(id) {
  const task = tasks.find((item) => item.id === id); if (!task) return;
  const date = new Date(task.dueAt);
  $('#edit-id').value = task.id; $('#edit-title').value = task.title; $('#edit-date').value = dateKey(date); $('#edit-time').value = formatTime(date); $('#edit-note').value = task.note || '';
  openModal('edit-modal-backdrop');
}

function saveEdit(event) {
  event.preventDefault(); const task = tasks.find((item) => item.id === $('#edit-id').value); if (!task) return;
  const next = new Date(`${$('#edit-date').value}T${$('#edit-time').value}`);
  task.title = $('#edit-title').value.trim(); task.dueAt = next.toISOString(); task.note = $('#edit-note').value.trim(); task.status = 'pending'; task.reminderShown = false;
  saveAll(); closeModal('edit-modal-backdrop'); selectedDate = next; render(); showToast('事项已更新');
}

function toggleDone(id) {
  const task = tasks.find((item) => item.id === id); if (!task) return;
  task.status = task.status === 'completed' ? 'pending' : 'completed'; task.completedAt = task.status === 'completed' ? new Date().toISOString() : null;
  saveAll(); render(); showToast(task.status === 'completed' ? '知道了，今天也完成了一件事。' : '已放回待办');
}

function snooze(id, minutes = 10) {
  const task = tasks.find((item) => item.id === id); if (!task) return;
  task.dueAt = new Date(Date.now() + minutes * 60 * 1000).toISOString(); task.status = 'pending'; task.reminderShown = false;
  saveAll(); closeReminder(); render(); showToast(`已延迟 ${minutes} 分钟`);
}

function openModal(id) { $(`#${id}`).classList.remove('hidden'); }
function closeModal(id) { $(`#${id}`).classList.add('hidden'); }

function checkDueTasks() {
  const now = Date.now();
  const task = tasks.find((item) => item.status !== 'completed' && !item.reminderShown && new Date(item.dueAt).getTime() <= now);
  if (!task) return;
  const current = new Date(); const quiet = settings.quiet && (current.getHours() >= 20 || current.getHours() < 8 || (current.getHours() === 8 && current.getMinutes() < 30));
  if (quiet) return;
  task.reminderShown = true; saveAll(); activeReminderId = task.id;
  startFlashing(task);
  $('#reminder-title').textContent = task.title; $('#reminder-detail').textContent = `原定 ${formatDate(new Date(task.dueAt))} ${formatTime(new Date(task.dueAt))} · 现在照顾一下它？`;
  $('#reminder-backdrop').classList.remove('hidden');
  if (settings.notifications && 'Notification' in window) {
    if (Notification.permission === 'granted') new Notification('工作提醒台', { body: task.title, icon: 'assets/sticker-chiikawa-face.png' });
    else if (Notification.permission !== 'denied') Notification.requestPermission();
  }
  if (settings.sound) playSoftSound();
}

function startFlashing(task) {
  const banner = $('#flash-banner');
  const title = $('#flash-title');
  if (!banner || !title) return;
  title.textContent = task.title;
  banner.classList.remove('hidden');
  document.body.classList.add('reminder-flashing');
  clearInterval(flashTitleTimer);
  let on = false;
  flashTitleTimer = setInterval(() => {
    on = !on;
    document.title = on ? `🔔 ${task.title}` : normalDocumentTitle;
    banner.classList.toggle('flash-on', on);
  }, 280);
}

function stopFlashing() {
  clearInterval(flashTitleTimer);
  document.title = normalDocumentTitle;
  document.body.classList.remove('reminder-flashing');
  $('#flash-banner')?.classList.add('hidden');
}

function playSoftSound() {
  try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); const oscillator = ctx.createOscillator(); const gain = ctx.createGain(); oscillator.frequency.value = 660; gain.gain.setValueAtTime(.0001, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.08, ctx.currentTime + .02); gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + .4); oscillator.connect(gain); gain.connect(ctx.destination); oscillator.start(); oscillator.stop(ctx.currentTime + .42); } catch (_) {}
}

function closeReminder() { $('#reminder-backdrop').classList.add('hidden'); stopFlashing(); activeReminderId = null; }

function exportTasks() {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), tasks, settings }, null, 2)], { type: 'application/json' });
  const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(blob); anchor.download = `workbench-backup-${dateKey(new Date())}.json`; anchor.click(); URL.revokeObjectURL(anchor.href); showToast('备份文件已导出');
}

function restorePetPosition() {
  try {
    const saved = JSON.parse(localStorage.getItem('chikawa-workbench-pet-position') || 'null');
    if (!saved || !Number.isFinite(saved.left) || !Number.isFinite(saved.top)) return;
    const pet = $('#floating-pet');
    const maxLeft = Math.max(8, window.innerWidth - pet.offsetWidth - 8);
    const maxTop = Math.max(8, window.innerHeight - pet.offsetHeight - 8);
    pet.style.left = `${Math.min(saved.left, maxLeft)}px`;
    pet.style.top = `${Math.min(saved.top, maxTop)}px`;
    pet.style.right = 'auto';
    pet.style.bottom = 'auto';
  } catch (_) {}
}

function setupPetDrag() {
  const pet = $('#floating-pet');
  const button = $('#pet-button');
  if (!pet || !button) return;
  restorePetPosition();
  button.addEventListener('pointerdown', (event) => {
    const rect = pet.getBoundingClientRect();
    petDragState = { active: true, moved: false, ignoreClick: false, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    button.setPointerCapture(event.pointerId);
    pet.classList.add('dragging');
    event.preventDefault();
  });
  button.addEventListener('pointermove', (event) => {
    if (!petDragState.active) return;
    const rect = pet.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - rect.width - 8, event.clientX - petDragState.offsetX));
    const top = Math.max(8, Math.min(window.innerHeight - rect.height - 8, event.clientY - petDragState.offsetY));
    if (Math.abs(left - rect.left) > 3 || Math.abs(top - rect.top) > 3) petDragState.moved = true;
    pet.style.left = `${left}px`; pet.style.top = `${top}px`; pet.style.right = 'auto'; pet.style.bottom = 'auto';
  });
  button.addEventListener('pointerup', () => {
    if (!petDragState.active) return;
    petDragState.active = false; petDragState.ignoreClick = petDragState.moved; pet.classList.remove('dragging');
    const rect = pet.getBoundingClientRect();
    localStorage.setItem('chikawa-workbench-pet-position', JSON.stringify({ left: rect.left, top: rect.top }));
  });
}

function petSay(message) {
  const bubble = $('#pet-bubble');
  if (!bubble) return;
  bubble.textContent = `乌萨奇：${message}`;
  bubble.classList.remove('hidden');
  bubble.classList.remove('show');
  requestAnimationFrame(() => bubble.classList.add('show'));
  clearTimeout(petSpeechTimer);
  petSpeechTimer = setTimeout(() => { bubble.classList.remove('show'); setTimeout(() => bubble.classList.add('hidden'), 220); }, 6500);
}

function schedulePetSpeech() {
  const messages = ['先做一件小事吧！', '我在这里，不着急。', '完成后记得喝水。', '今天也要稳稳地往前走。', '现在的你已经做得很好了。'];
  const wait = 42000 + Math.random() * 48000;
  setTimeout(() => { petSay(messages[Math.floor(Math.random() * messages.length)]); schedulePetSpeech(); }, wait);
}

function setup() {
  $('#quick-add-form').addEventListener('submit', (event) => { event.preventDefault(); addTask($('#task-input').value); });
  $('#focus-input').addEventListener('click', () => { $('#task-input').focus(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  $('#today-button').addEventListener('click', () => { selectedDate = new Date(); render(); }); $('#focus-today').addEventListener('click', () => { selectedDate = new Date(); render(); });
  $('#settings-button').addEventListener('click', () => openModal('settings-modal-backdrop')); $('#quick-settings').addEventListener('click', () => openModal('settings-modal-backdrop')); $('#quiet-pill').addEventListener('click', () => openModal('settings-modal-backdrop'));
  $('#edit-form').addEventListener('submit', saveEdit); $('#export-button').addEventListener('click', exportTasks);
  $$('[data-close-modal]').forEach((button) => button.addEventListener('click', () => closeModal(button.dataset.closeModal)));
  ['notifications', 'sound', 'startup', 'quiet'].forEach((key) => { const input = $(`#setting-${key}`); input.checked = settings[key]; input.addEventListener('change', () => { settings[key] = input.checked; saveAll(); if (key === 'notifications' && input.checked && 'Notification' in window) Notification.requestPermission(); }); });
  $('#timeline').addEventListener('click', (event) => { const button = event.target.closest('[data-action]'); if (!button) return; if (button.dataset.action === 'edit') openEdit(button.dataset.id); if (button.dataset.action === 'done') toggleDone(button.dataset.id); });
  $('#todo-list').addEventListener('click', (event) => { const button = event.target.closest('[data-action]'); if (button) toggleDone(button.dataset.id); });
  $('#reminder-done').addEventListener('click', () => { if (activeReminderId) toggleDone(activeReminderId); closeReminder(); }); $('#reminder-snooze').addEventListener('click', () => { if (activeReminderId) snooze(activeReminderId, 10); }); $('#reminder-edit').addEventListener('click', () => { const id = activeReminderId; closeReminder(); openEdit(id); });
  $$('.sticker-button').forEach((button) => button.addEventListener('click', () => { $('#companion-message').textContent = button.dataset.message; showToast(button.dataset.message); }));
  $('#pet-button').addEventListener('click', () => { if (petDragState.ignoreClick) { petDragState.ignoreClick = false; return; } petSay('要不要先处理一件最小的事？'); });
  $('#hero-art').addEventListener('click', () => { petSay('三位小伙伴也在陪你工作。'); });
  $('#hero-art').addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); petSay('三位小伙伴也在陪你工作。'); } });
  setupPetDrag();
  setTimeout(() => petSay('今天也一起慢慢来。'), 4500);
  schedulePetSpeech();
  $$('.nav-item').forEach((button) => button.addEventListener('click', () => { $$('.nav-item').forEach((item) => item.classList.remove('active')); button.classList.add('active'); currentView = button.dataset.view; if (currentView === 'today') selectedDate = new Date(); if (currentView === 'history') $('#companion-message').textContent = '完成过的事情也值得被看见。'; if (currentView === 'todo') $('#companion-message').textContent = '把还没完成的事情，一件一件放好。'; render(); }));
  render(); checkDueTasks(); setInterval(checkDueTasks, 15000); document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDueTasks(); });
}

setup();

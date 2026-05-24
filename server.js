const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// ============ Global Error Handlers ============

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err.message, err.stack);
  // Don't exit — keep the process alive
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled Rejection:', reason);
});

// Load DB after error handlers
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'star-tracker-secret-' + new Date().toISOString().slice(0, 10);
const TOKEN_EXPIRY = '7d';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve frontend static files
const frontendDist = path.join(__dirname, '..', '..', 'agent3', 'star-tracker', 'dist');
app.use(express.static(frontendDist));

// Multer config for image upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images are allowed'), false);
  },
});

// Ensure uploads dir exists
const fs = require('fs');
if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
  fs.mkdirSync(path.join(__dirname, 'uploads'));
}

// ============ Auth (Mock) ============

// Legacy mock login (for backward compatibility)
app.post('/api/login', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'username is required' });

  let user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    const result = db.prepare('INSERT INTO users (username, nickname) VALUES (?, ?)').run(username, username);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  }
  res.json({ user: { id: user.id, username: user.username, nickname: user.nickname }, token: `mock-token-${user.id}` });
});

// ============ Auth Middleware ============

function auth(req, res, next) {
  // Allow login, register, and health check without auth
  const openPaths = ['/auth/login', '/auth/register', '/health', '/venues/provinces', '/venues/cities', '/venues/list', '/venues/all'];
  if (openPaths.includes(req.path)) {
    return next();
  }
  
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization token required' });
  }
  
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.userRole = decoded.role || 'user';
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

app.use('/api', auth);

// ============ Auth Endpoints ============

// Register
app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body;
  
  // Validation
  if (!username || username.trim().length < 2 || username.trim().length > 20) {
    return res.status(400).json({ error: '用户名需要2-20个字符' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: '密码至少8位' });
  }
  
  // Check if username exists
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
  if (existing) {
    return res.status(409).json({ error: '用户名已存在' });
  }
  
  // Hash password
  const salt = bcrypt.genSaltSync(10);
  const password_hash = bcrypt.hashSync(password, salt);
  
  // Insert user
  const result = db.prepare('INSERT INTO users (username, password_hash, nickname) VALUES (?, ?, ?)').run(
    username.trim(),
    password_hash,
    username.trim()
  );
  
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  
  // Generate token
  const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
  
  res.status(201).json({
    user: { id: user.id, username: user.username, nickname: user.nickname, avatar: user.avatar, bio: user.bio || '', role: user.role },
    token
  });
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: '请输入用户名和密码' });
  }
  
  // Find user
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  if (!user) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  
  // Check password
  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  
  // Generate token
  const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
  
  res.json({
    user: { id: user.id, username: user.username, nickname: user.nickname, avatar: user.avatar, bio: user.bio || '', role: user.role },
    token
  });
});

// ============ Get Current User ============

app.get('/api/auth/me', (req, res) => {
  const user = db.prepare('SELECT id, username, nickname, avatar, bio, created_at FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// ============ Update Profile ============

app.put('/api/auth/profile', (req, res) => {
  const { nickname, bio, avatar, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  let passwordHash = user.password_hash;
  if (password) {
    if (password.length < 8) {
      return res.status(400).json({ error: '密码至少8位' });
    }
    const salt = bcrypt.genSaltSync(10);
    passwordHash = bcrypt.hashSync(password, salt);
  }

  db.prepare('UPDATE users SET nickname = ?, bio = ?, avatar = ?, password_hash = ? WHERE id = ?').run(
    nickname !== undefined ? nickname : user.nickname,
    bio !== undefined ? bio : (user.bio || ''),
    avatar !== undefined ? avatar : (user.avatar || ''),
    passwordHash,
    req.userId
  );

  const updated = db.prepare('SELECT id, username, nickname, avatar, bio, created_at FROM users WHERE id = ?').get(req.userId);
  res.json(updated);
});

// ============ Idols CRUD ============

// List idols
app.get('/api/idols', (req, res) => {
  const idols = db.prepare('SELECT * FROM idols WHERE user_id = ? ORDER BY created_at DESC').all(req.userId);
  res.json(idols);
});

// Get single idol
app.get('/api/idols/:id', (req, res) => {
  const idol = db.prepare('SELECT * FROM idols WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!idol) return res.status(404).json({ error: 'Idol not found' });
  res.json(idol);
});

// Create idol
app.post('/api/idols', (req, res) => {
  const { name, avatar } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });

  const result = db.prepare('INSERT INTO idols (user_id, name, avatar) VALUES (?, ?, ?)').run(
    req.userId,
    name.trim(),
    avatar || ''
  );
  const idol = db.prepare('SELECT * FROM idols WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(idol);
});

// Update idol
app.put('/api/idols/:id', (req, res) => {
  const { name, avatar } = req.body;
  const existing = db.prepare('SELECT * FROM idols WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Idol not found' });

  db.prepare('UPDATE idols SET name = ?, avatar = ? WHERE id = ? AND user_id = ?').run(
    name || existing.name,
    avatar !== undefined ? avatar : existing.avatar,
    req.params.id,
    req.userId
  );
  const idol = db.prepare('SELECT * FROM idols WHERE id = ?').get(req.params.id);
  res.json(idol);
});

// Delete idol
app.delete('/api/idols/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM idols WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Idol not found' });

  // Events referencing this idol will cascade delete
  db.prepare('DELETE FROM idols WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  res.json({ success: true });
});

// ============ Events CRUD ============

// List events (with photos)
app.get('/api/events', (req, res) => {
  const events = db.prepare(`
    SELECT e.*, GROUP_CONCAT(ep.url) as photo_urls
    FROM events e
    LEFT JOIN event_photos ep ON ep.event_id = e.id
    WHERE e.user_id = ?
    GROUP BY e.id
    ORDER BY e.date ASC
  `).all(req.userId);

  const result = events.map(e => ({
    id: e.id,
    idolId: e.idol_id,
    idolName: e.idol_name,
    title: e.title,
    date: e.date,
    location: e.location,
    lat: e.lat,
    lng: e.lng,
    photos: e.photo_urls ? e.photo_urls.split(',') : [],
  }));

  res.json(result);
});

// Get single event
app.get('/api/events/:id', (req, res) => {
  const event = db.prepare(`
    SELECT e.*, GROUP_CONCAT(ep.url) as photo_urls
    FROM events e
    LEFT JOIN event_photos ep ON ep.event_id = e.id
    WHERE e.id = ? AND e.user_id = ?
    GROUP BY e.id
  `).get(req.params.id, req.userId);

  if (!event) return res.status(404).json({ error: 'Event not found' });

  res.json({
    id: event.id,
    idolId: event.idol_id,
    idolName: event.idol_name,
    title: event.title,
    date: event.date,
    location: event.location,
    lat: event.lat,
    lng: event.lng,
    photos: event.photo_urls ? event.photo_urls.split(',') : [],
  });
});

// Create event
app.post('/api/events', (req, res) => {
  const { idolId, title, date, location, lat, lng, photos } = req.body;
  if (!idolId) return res.status(400).json({ error: 'idolId is required' });
  if (!title) return res.status(400).json({ error: 'title is required' });
  if (!date) return res.status(400).json({ error: 'date is required' });

  // Get idol name
  const idol = db.prepare('SELECT name FROM idols WHERE id = ? AND user_id = ?').get(idolId, req.userId);
  if (!idol) return res.status(400).json({ error: 'Idol not found' });

  const result = db.prepare(
    'INSERT INTO events (user_id, idol_id, idol_name, title, date, location, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(req.userId, idolId, idol.name, title, date, location || '', lat || null, lng || null);

  const eventId = result.lastInsertRowid;

  // Insert photos if provided
  if (photos && photos.length > 0) {
    const insertPhoto = db.prepare('INSERT INTO event_photos (event_id, url) VALUES (?, ?)');
    photos.forEach(url => insertPhoto.run(eventId, url));
  }

  // Return the created event
  const event = db.prepare(`
    SELECT e.*, GROUP_CONCAT(ep.url) as photo_urls
    FROM events e
    LEFT JOIN event_photos ep ON ep.event_id = e.id
    WHERE e.id = ?
    GROUP BY e.id
  `).get(eventId);

  res.status(201).json({
    id: event.id,
    idolId: event.idol_id,
    idolName: event.idol_name,
    title: event.title,
    date: event.date,
    location: event.location,
    lat: event.lat,
    lng: event.lng,
    photos: event.photo_urls ? event.photo_urls.split(',') : [],
  });
});

// Update event
app.put('/api/events/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM events WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Event not found' });

  const { idolId, idolName, title, date, location, lat, lng, photos } = req.body;

  // If idolId changed, update idol_name too
  let newIdolName = idolName || existing.idol_name;
  if (idolId && idolId !== existing.idol_id) {
    const idol = db.prepare('SELECT name FROM idols WHERE id = ? AND user_id = ?').get(idolId, req.userId);
    if (idol) newIdolName = idol.name;
  }

  db.prepare(`
    UPDATE events SET idol_id = ?, idol_name = ?, title = ?, date = ?, location = ?, lat = ?, lng = ?
    WHERE id = ? AND user_id = ?
  `).run(
    idolId || existing.idol_id,
    newIdolName,
    title || existing.title,
    date || existing.date,
    location !== undefined ? location : existing.location,
    lat !== undefined ? lat : existing.lat,
    lng !== undefined ? lng : existing.lng,
    req.params.id,
    req.userId
  );

  // Update photos if provided
  if (photos !== undefined) {
    db.prepare('DELETE FROM event_photos WHERE event_id = ?').run(req.params.id);
    if (photos.length > 0) {
      const insertPhoto = db.prepare('INSERT INTO event_photos (event_id, url) VALUES (?, ?)');
      photos.forEach(url => insertPhoto.run(req.params.id, url));
    }
  }

  const event = db.prepare(`
    SELECT e.*, GROUP_CONCAT(ep.url) as photo_urls
    FROM events e
    LEFT JOIN event_photos ep ON ep.event_id = e.id
    WHERE e.id = ?
    GROUP BY e.id
  `).get(req.params.id);

  res.json({
    id: event.id,
    idolId: event.idol_id,
    idolName: event.idol_name,
    title: event.title,
    date: event.date,
    location: event.location,
    lat: event.lat,
    lng: event.lng,
    photos: event.photo_urls ? event.photo_urls.split(',') : [],
  });
});

// Delete event
app.delete('/api/events/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM events WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Event not found' });

  db.prepare('DELETE FROM events WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  res.json({ success: true });
});

// ============ Change Password ============

app.put('/api/auth/password', (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ error: '请输入原密码和新密码' });
  if (newPassword.length < 8) return res.status(400).json({ error: '新密码至少8位' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (!bcrypt.compareSync(oldPassword, user.password_hash)) return res.status(401).json({ error: '原密码错误' });

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.userId);
  res.json({ success: true, message: '密码修改成功，请重新登录' });
});

// ============ Diaries CRUD ============

// List diaries (with photos, supports pagination & filtering)
app.get('/api/diaries', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
  const offset = (page - 1) * pageSize;
  const idolId = req.query.idolId;
  const mood = req.query.mood;

  let where = 'WHERE d.user_id = ?';
  const params = [req.userId];
  if (idolId) {
    where += ' AND d.idol_id = ?';
    params.push(parseInt(idolId));
  }
  if (mood) {
    where += ' AND d.mood = ?';
    params.push(mood);
  }

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM diaries d ${where}`).get(...params).cnt;

  const diaries = db.prepare(`
    SELECT d.*, GROUP_CONCAT(dp.url) as photo_urls
    FROM diaries d
    LEFT JOIN diary_photos dp ON dp.diary_id = d.id
    ${where}
    GROUP BY d.id
    ORDER BY d.date DESC, d.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);

  const result = diaries.map(diary => ({
    id: diary.id,
    idolId: diary.idol_id,
    idolName: diary.idol_name,
    eventId: diary.event_id,
    title: diary.title,
    content: diary.content,
    mood: diary.mood,
    date: diary.date,
    photos: diary.photo_urls ? diary.photo_urls.split(',') : [],
    createdAt: diary.created_at,
  }));

  res.json({ data: result, total, page, pageSize });
});

// Get single diary
app.get('/api/diaries/:id', (req, res) => {
  const diary = db.prepare(`
    SELECT d.*, GROUP_CONCAT(dp.url) as photo_urls
    FROM diaries d
    LEFT JOIN diary_photos dp ON dp.diary_id = d.id
    WHERE d.id = ? AND d.user_id = ?
    GROUP BY d.id
  `).get(req.params.id, req.userId);

  if (!diary) return res.status(404).json({ error: 'Diary not found' });

  res.json({
    id: diary.id,
    idolId: diary.idol_id,
    idolName: diary.idol_name,
    eventId: diary.event_id,
    title: diary.title,
    content: diary.content,
    mood: diary.mood,
    date: diary.date,
    photos: diary.photo_urls ? diary.photo_urls.split(',') : [],
    createdAt: diary.created_at,
  });
});

// Create diary
app.post('/api/diaries', (req, res) => {
  const { idolId, eventId, title, content, mood, date, photos } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' });
  if (!date) return res.status(400).json({ error: 'date is required' });
  if (photos && photos.length > 3) return res.status(400).json({ error: '日记照片最多3张' });

  // Get idol name if idolId provided
  let idolName = '';
  if (idolId) {
    const idol = db.prepare('SELECT name FROM idols WHERE id = ? AND user_id = ?').get(idolId, req.userId);
    if (idol) idolName = idol.name;
  }

  const result = db.prepare(
    'INSERT INTO diaries (user_id, idol_id, idol_name, event_id, title, content, mood, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(req.userId, idolId || null, idolName, eventId || null, title.trim(), content || '', mood || '', date);

  const diaryId = result.lastInsertRowid;

  // Insert photos
  if (photos && photos.length > 0) {
    const insertPhoto = db.prepare('INSERT INTO diary_photos (diary_id, url, sort_order) VALUES (?, ?, ?)');
    photos.forEach((url, i) => insertPhoto.run(diaryId, url, i));
  }

  // Return the created diary
  const diary = db.prepare(`
    SELECT d.*, GROUP_CONCAT(dp.url) as photo_urls
    FROM diaries d
    LEFT JOIN diary_photos dp ON dp.diary_id = d.id
    WHERE d.id = ?
    GROUP BY d.id
  `).get(diaryId);

  res.status(201).json({
    id: diary.id,
    idolId: diary.idol_id,
    idolName: diary.idol_name,
    eventId: diary.event_id,
    title: diary.title,
    content: diary.content,
    mood: diary.mood,
    date: diary.date,
    photos: diary.photo_urls ? diary.photo_urls.split(',') : [],
    createdAt: diary.created_at,
  });
});

// Update diary
app.put('/api/diaries/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM diaries WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Diary not found' });

  const { idolId, eventId, title, content, mood, date, photos } = req.body;
  if (photos && photos.length > 3) return res.status(400).json({ error: '日记照片最多3张' });

  // Get idol name if idolId changed
  let idolName = existing.idol_name;
  if (idolId !== undefined) {
    if (idolId && idolId !== existing.idol_id) {
      const idol = db.prepare('SELECT name FROM idols WHERE id = ? AND user_id = ?').get(idolId, req.userId);
      if (idol) idolName = idol.name;
    } else if (!idolId) {
      idolName = '';
    }
  }

  db.prepare(`
    UPDATE diaries SET idol_id = ?, idol_name = ?, event_id = ?, title = ?, content = ?, mood = ?, date = ?
    WHERE id = ? AND user_id = ?
  `).run(
    idolId !== undefined ? (idolId || null) : existing.idol_id,
    idolName,
    eventId !== undefined ? (eventId || null) : existing.event_id,
    title || existing.title,
    content !== undefined ? content : existing.content,
    mood !== undefined ? mood : existing.mood,
    date || existing.date,
    req.params.id,
    req.userId
  );

  // Update photos if provided
  if (photos !== undefined) {
    db.prepare('DELETE FROM diary_photos WHERE diary_id = ?').run(req.params.id);
    if (photos.length > 0) {
      const insertPhoto = db.prepare('INSERT INTO diary_photos (diary_id, url, sort_order) VALUES (?, ?, ?)');
      photos.forEach((url, i) => insertPhoto.run(req.params.id, url, i));
    }
  }

  const diary = db.prepare(`
    SELECT d.*, GROUP_CONCAT(dp.url) as photo_urls
    FROM diaries d
    LEFT JOIN diary_photos dp ON dp.diary_id = d.id
    WHERE d.id = ?
    GROUP BY d.id
  `).get(req.params.id);

  res.json({
    id: diary.id,
    idolId: diary.idol_id,
    idolName: diary.idol_name,
    eventId: diary.event_id,
    title: diary.title,
    content: diary.content,
    mood: diary.mood,
    date: diary.date,
    photos: diary.photo_urls ? diary.photo_urls.split(',') : [],
    createdAt: diary.created_at,
  });
});

// Delete diary
app.delete('/api/diaries/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM diaries WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Diary not found' });

  db.prepare('DELETE FROM diaries WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  res.json({ success: true });
});

// ============ Image Upload ============

app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file provided' });

  const url = `/uploads/${req.file.filename}`;
  res.json({ url, filename: req.file.filename });
});

// ============ Admin Middleware ============

function adminOnly(req, res, next) {
  if (req.userRole !== 'admin') {
    return res.status(403).json({ error: '权限不足，仅管理员可访问' });
  }
  next();
}

// ============ Admin API ============

// GET /api/admin/users — 获取所有用户列表（含内存占用）
app.get('/api/admin/users', adminOnly, (req, res) => {
  const users = db.prepare(`
    SELECT id, username, nickname, role, avatar, created_at FROM users ORDER BY id
  `).all();

  const result = users.map(user => {
    const idolCount = db.prepare('SELECT COUNT(*) as cnt FROM idols WHERE user_id = ?').get(user.id).cnt;
    const eventCount = db.prepare('SELECT COUNT(*) as cnt FROM events WHERE user_id = ?').get(user.id).cnt;
    const diaryCount = db.prepare('SELECT COUNT(*) as cnt FROM diaries WHERE user_id = ?').get(user.id).cnt;
    const photoCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM event_photos ep
      JOIN events e ON e.id = ep.event_id
      WHERE e.user_id = ?
    `).get(user.id).cnt + db.prepare(`
      SELECT COUNT(*) as cnt FROM diary_photos dp
      JOIN diaries d ON d.id = dp.diary_id
      WHERE d.user_id = ?
    `).get(user.id).cnt;

    // Estimate memory: ~0.5KB per idol, ~1KB per event, ~2KB per diary, ~0.5KB per photo record
    const estimatedKB = idolCount * 0.5 + eventCount * 1 + diaryCount * 2 + photoCount * 0.5;

    return {
      ...user,
      stats: {
        idols: idolCount,
        events: eventCount,
        diaries: diaryCount,
        photos: photoCount,
        estimatedMemory: estimatedKB < 1024 ? `${estimatedKB.toFixed(1)}KB` : `${(estimatedKB / 1024).toFixed(2)}MB`
      }
    };
  });

  res.json(result);
});

// DELETE /api/admin/users/:id — 删除用户及其所有数据
app.delete('/api/admin/users/:id', adminOnly, (req, res) => {
  const userId = parseInt(req.params.id);
  const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (user.role === 'admin') return res.status(400).json({ error: '不能删除管理员账号' });

  // Delete all user data in transaction
  const deleteUser = db.transaction(() => {
    // Delete diary photos first
    db.prepare('DELETE FROM diary_photos WHERE diary_id IN (SELECT id FROM diaries WHERE user_id = ?)').run(userId);
    // Delete diaries
    db.prepare('DELETE FROM diaries WHERE user_id = ?').run(userId);
    // Delete event photos
    db.prepare('DELETE FROM event_photos WHERE event_id IN (SELECT id FROM events WHERE user_id = ?)').run(userId);
    // Delete events
    db.prepare('DELETE FROM events WHERE user_id = ?').run(userId);
    // Delete idols
    db.prepare('DELETE FROM idols WHERE user_id = ?').run(userId);
    // Delete visited venues
    db.prepare('DELETE FROM visited_venues WHERE user_id = ?').run(userId);
    // Delete user
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
  deleteUser();

  res.json({ success: true, message: `用户 ${user.username} 及其所有数据已删除` });
});

// ============ Venues API ============

// GET /api/venues/provinces — 获取省份列表
app.get('/api/venues/provinces', (req, res) => {
  const provinces = db.prepare('SELECT DISTINCT province FROM venues ORDER BY province').all();
  res.json(provinces.map(p => p.province));
});

// GET /api/venues/cities?province=xxx — 按省份返回城市列表
app.get('/api/venues/cities', (req, res) => {
  const { province } = req.query;
  if (!province) return res.status(400).json({ error: 'province is required' });
  const cities = db.prepare('SELECT DISTINCT city FROM venues WHERE province = ? ORDER BY city').all(province);
  res.json(cities.map(c => c.city));
});

// GET /api/venues/list?province=xxx&city=xxx — 按省市返回场馆列表
app.get('/api/venues/list', (req, res) => {
  const { province, city } = req.query;
  if (!province) return res.status(400).json({ error: 'province is required' });
  let query = 'SELECT * FROM venues WHERE province = ?';
  const params = [province];
  if (city) {
    query += ' AND city = ?';
    params.push(city);
  }
  query += ' ORDER BY city, name';
  res.json(db.prepare(query).all(...params));
});

// GET /api/venues/all — 返回全部场馆（含经纬度，前端地图用）
app.get('/api/venues/all', (req, res) => {
  const venues = db.prepare('SELECT * FROM venues ORDER BY province, city, name').all();
  res.json(venues);
});

// POST /api/venues/visited — 标记场馆为已去过
app.post('/api/venues/visited', (req, res) => {
  const { venueId } = req.body;
  if (!venueId) return res.status(400).json({ error: 'venueId is required' });

  const venue = db.prepare('SELECT * FROM venues WHERE id = ?').get(venueId);
  if (!venue) return res.status(404).json({ error: '场馆不存在' });

  const existing = db.prepare('SELECT id FROM visited_venues WHERE user_id = ? AND venue_id = ?').get(req.userId, venueId);
  if (existing) return res.status(409).json({ error: '已标记过该场馆' });

  const result = db.prepare('INSERT INTO visited_venues (user_id, venue_id) VALUES (?, ?)').run(req.userId, venueId);
  res.status(201).json({ id: result.lastInsertRowid, userId: req.userId, venueId, createdAt: new Date().toISOString() });
});

// GET /api/venues/visited — 获取用户已去过的场馆列表
app.get('/api/venues/visited', (req, res) => {
  const visited = db.prepare(`
    SELECT vv.id, vv.venue_id as venueId, vv.created_at as visitedAt,
           v.province, v.city, v.name as venueName, v.lat, v.lng
    FROM visited_venues vv
    JOIN venues v ON v.id = vv.venue_id
    WHERE vv.user_id = ?
    ORDER BY vv.created_at DESC
  `).all(req.userId);
  res.json(visited);
});

// DELETE /api/venues/visited/:id — 取消标记
app.delete('/api/venues/visited/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM visited_venues WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: '标记不存在' });
  db.prepare('DELETE FROM visited_venues WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  res.json({ success: true });
});

// ============ Health check ============

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ============ Catch-all for Vue Router (history mode) ============

app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
  if (req.path.includes('.')) return next(); // has extension, skip
  res.sendFile('index.html', { root: frontendDist });
});

// ============ Error handler ============

app.use((err, req, res, next) => {
  console.error(err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ============ Start ============

const server = app.listen(PORT, () => {
  console.log(`🚀 Star Tracker API running on http://localhost:${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/api/health`);
});

// Prevent stale connections and memory leaks
server.keepAliveTimeout = 30000; // 30s
server.headersTimeout = 35000; // 35s
server.maxHeadersCount = 100;

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    db.close();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  server.close(() => {
    db.close();
    process.exit(0);
  });
});

module.exports = app;

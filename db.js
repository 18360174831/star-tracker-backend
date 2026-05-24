const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'star-tracker.db'));

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT DEFAULT '',
    nickname TEXT,
    avatar TEXT,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS idols (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    avatar TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    idol_id INTEGER NOT NULL,
    idol_name TEXT NOT NULL,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    location TEXT DEFAULT '',
    lat REAL,
    lng REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (idol_id) REFERENCES idols(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS event_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS diaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    idol_id INTEGER,
    idol_name TEXT DEFAULT '',
    event_id INTEGER,
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    mood TEXT DEFAULT '',
    date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (idol_id) REFERENCES idols(id) ON DELETE SET NULL,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS diary_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    diary_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (diary_id) REFERENCES diaries(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS venues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    province TEXT NOT NULL,
    city TEXT NOT NULL,
    name TEXT NOT NULL,
    lat REAL,
    lng REAL,
    UNIQUE(province, city, name)
  );

  CREATE TABLE IF NOT EXISTS visited_venues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    venue_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (venue_id) REFERENCES venues(id),
    UNIQUE(user_id, venue_id)
  );
`);

// Seed demo data if empty
const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
if (userCount.cnt === 0) {
  const insertUser = db.prepare('INSERT INTO users (username, nickname) VALUES (?, ?)');
  const insertIdol = db.prepare('INSERT INTO idols (user_id, name, avatar) VALUES (?, ?, ?)');
  const insertEvent = db.prepare('INSERT INTO events (user_id, idol_id, idol_name, title, date, location, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insertPhoto = db.prepare('INSERT INTO event_photos (event_id, url) VALUES (?, ?)');

  const seed = db.transaction(() => {
    insertUser.run('demo', 'Demo User');

    // Create admin account
    const bcrypt = require('bcryptjs');
    const adminHash = bcrypt.hashSync('admin', 10);
    db.prepare('INSERT OR IGNORE INTO users (username, password_hash, nickname, role) VALUES (?, ?, ?, ?)').run('admin', adminHash, '管理员', 'admin');

    insertIdol.run(1, '周杰伦', 'https://picsum.photos/seed/jay/100/100');
    insertIdol.run(1, 'Taylor Swift', 'https://picsum.photos/seed/taylor/100/100');
    insertIdol.run(1, 'BTS', 'https://picsum.photos/seed/bts/100/100');

    insertEvent.run(1, 1, '周杰伦', '嘉年华世界巡回演唱会-北京站', '2026-06-15T19:30:00+08:00', '北京工人体育场', 39.9304, 116.4437);
    insertEvent.run(1, 2, 'Taylor Swift', 'The Eras Tour - Shanghai', '2026-07-20T19:00:00+08:00', '上海体育场', 31.1827, 121.4468);
    insertEvent.run(1, 3, 'BTS', '粉丝见面会', '2026-05-25T14:00:00+08:00', '深圳湾体育中心', 22.5178, 113.9486);
    insertEvent.run(1, 1, '周杰伦', '新专辑签售会', '2025-12-01T10:00:00+08:00', '广州天河体育馆', 23.1391, 113.3284);

    insertPhoto.run(1, 'https://picsum.photos/seed/e1/200/200');
    insertPhoto.run(3, 'https://picsum.photos/seed/e3/200/200');
    insertPhoto.run(3, 'https://picsum.photos/seed/e3b/200/200');
  });
  seed();
  console.log('✅ Demo data seeded');
}

// Always ensure admin account exists
const bcrypt = require('bcryptjs');
const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  const adminHash = bcrypt.hashSync('admin', 10);
  db.prepare('INSERT INTO users (username, password_hash, nickname, role) VALUES (?, ?, ?, ?)').run('admin', adminHash, '管理员', 'admin');
  console.log('✅ Admin account created');
}

// Seed venues if empty
const venueCount = db.prepare('SELECT COUNT(*) as cnt FROM venues').get();
if (venueCount.cnt === 0) {
  const insertVenue = db.prepare('INSERT INTO venues (province, city, name, lat, lng) VALUES (?, ?, ?, ?, ?)');
  const seedVenues = db.transaction(() => {
    // 北京
    insertVenue.run('北京', '北京', '国家体育场（鸟巢）', 39.9929, 116.3966);
    insertVenue.run('北京', '北京', '国家游泳中心（水立方）', 39.9932, 116.3853);
    insertVenue.run('北京', '北京', '工人体育场', 39.9304, 116.4437);
    insertVenue.run('北京', '北京', '五棵松体育馆', 39.9077, 116.2777);
    // 上海
    insertVenue.run('上海', '上海', '上海体育场（八万人）', 31.1827, 121.4468);
    insertVenue.run('上海', '上海', '上海东方体育中心', 31.1539, 121.4704);
    insertVenue.run('上海', '上海', '梅赛德斯-奔驰文化中心', 31.1833, 121.4877);
    // 广东
    insertVenue.run('广东', '广州', '天河体育中心', 23.1391, 113.3284);
    insertVenue.run('广东', '广州', '广州大学城体育中心', 23.0476, 113.3913);
    insertVenue.run('广东', '深圳', '深圳湾体育中心（春茧）', 22.5178, 113.9486);
    insertVenue.run('广东', '深圳', '深圳大运中心', 22.6944, 114.2117);
    insertVenue.run('广东', '东莞', '东莞篮球中心', 23.0188, 113.7515);
    // 江苏
    insertVenue.run('江苏', '南京', '南京奥体中心', 32.0317, 118.7301);
    insertVenue.run('江苏', '南京', '南京青奥体育公园', 31.9753, 118.7092);
    insertVenue.run('江苏', '苏州', '苏州奥体中心', 31.3067, 120.7263);
    // 浙江
    insertVenue.run('浙江', '杭州', '杭州奥体中心（大莲花）', 30.2295, 120.2423);
    insertVenue.run('浙江', '杭州', '黄龙体育中心', 30.2615, 120.1342);
    insertVenue.run('浙江', '宁波', '宁波奥体中心', 29.8683, 121.5440);
    // 四川
    insertVenue.run('四川', '成都', '凤凰山体育公园', 30.7214, 104.0782);
    insertVenue.run('四川', '成都', '成都露天音乐公园', 30.7117, 104.0601);
    // 湖北
    insertVenue.run('湖北', '武汉', '武汉体育中心', 30.4952, 114.2449);
    insertVenue.run('湖北', '武汉', '武汉光谷国际网球中心', 30.4733, 114.4267);
    // 天津
    insertVenue.run('天津', '天津', '天津奥体中心（水滴）', 39.0813, 117.1703);
    // 重庆
    insertVenue.run('重庆', '重庆', '重庆奥体中心', 29.5327, 106.5034);
    // 辽宁
    insertVenue.run('辽宁', '沈阳', '沈阳奥体中心', 41.7225, 123.4856);
    insertVenue.run('辽宁', '大连', '大连体育中心', 38.9537, 121.5522);
    // 山东
    insertVenue.run('山东', '济南', '济南奥体中心', 36.6557, 117.1083);
    insertVenue.run('山东', '青岛', '青岛体育中心', 36.0822, 120.3731);
    // 福建
    insertVenue.run('福建', '福州', '福州海峡奥体中心', 26.0477, 119.3070);
    insertVenue.run('福建', '厦门', '厦门体育中心', 24.4891, 118.0976);
    // 陕西
    insertVenue.run('陕西', '西安', '西安奥体中心', 34.3298, 109.0393);
    // 河南
    insertVenue.run('河南', '郑州', '郑州奥体中心', 34.7265, 113.6254);
    // 湖南
    insertVenue.run('湖南', '长沙', '长沙贺龙体育中心', 28.1943, 112.9750);
    // 安徽
    insertVenue.run('安徽', '合肥', '合肥奥体中心', 31.7780, 117.2794);
    // 云南
    insertVenue.run('云南', '昆明', '昆明拓东体育中心', 25.0331, 102.7200);
    // 海南
    insertVenue.run('海南', '海口', '海口五源河体育场', 19.9736, 110.3028);
    // 吉林
    insertVenue.run('吉林', '长春', '长春经开体育场', 43.8650, 125.3450);
    // 黑龙江
    insertVenue.run('黑龙江', '哈尔滨', '哈尔滨国际会展中心体育场', 45.7464, 126.6707);
    // 广西
    insertVenue.run('广西', '南宁', '广西体育中心', 22.7633, 108.3193);
    // 贵州
    insertVenue.run('贵州', '贵阳', '贵阳奥体中心', 26.6164, 106.6470);
    // 甘肃
    insertVenue.run('甘肃', '兰州', '兰州奥体中心', 36.0614, 103.8343);
    // 新疆
    insertVenue.run('新疆', '乌鲁木齐', '新疆体育中心', 43.8436, 87.5765);
    // 内蒙古
    insertVenue.run('内蒙古', '呼和浩特', '呼和浩特体育中心', 40.8326, 111.6780);
    // 河北
    insertVenue.run('河北', '石家庄', '石家庄裕彤体育中心', 38.0452, 114.5148);
    // 山西
    insertVenue.run('山西', '太原', '山西体育中心', 37.8367, 112.5733);
    // 江西
    insertVenue.run('江西', '南昌', '南昌国际体育中心', 28.6576, 115.8727);
  });
  seedVenues();
  console.log('✅ Venues seeded: ' + db.prepare('SELECT COUNT(*) as cnt FROM venues').get().cnt);
}

module.exports = db;

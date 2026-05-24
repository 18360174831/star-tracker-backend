# 追星记录工具 - 后端 API 文档

**Base URL**: `http://49.232.245.158`（国内直连）

## 认证

所有业务接口（偶像/行程/日记）需要 JWT Token 认证。健康检查、注册、登录接口无需认证。

### 获取 Token

1. 调用 `POST /api/auth/register` 注册新用户
2. 调用 `POST /api/auth/login` 登录获取 token

### 使用 Token

所有需要认证的接口，在请求头中携带：
```
Authorization: Bearer <token>
```

Token 有效期 7 天。

---

## 1. 健康检查（无需认证）

### `GET /api/health`

```json
// Response 200
{ "status": "ok", "time": "2026-05-24T03:12:29.324Z" }
```

---

## 2. 注册

### `POST /api/auth/register`

```json
// Request
{ "username": "alice", "password": "mypassword123" }

// Response 201
{
  "user": { "id": 2, "username": "alice", "nickname": "alice" },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}

// Error 409: { "error": "用户名已存在" }
// Error 400: { "error": "用户名需要2-20个字符" } 或 { "error": "密码至少8位" }
```

---

## 3. 登录

### `POST /api/auth/login`

```json
// Request
{ "username": "alice", "password": "mypassword123" }

// Response 200
{
  "user": { "id": 2, "username": "alice", "nickname": "alice" },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}

// Error 401: { "error": "用户名或密码错误" }
```

---

## 4. 修改密码（需认证）

### `PUT /api/auth/password`

```json
// Request
{ "oldPassword": "原密码", "newPassword": "新密码至少8位" }

// Response 200
{ "success": true, "message": "密码修改成功，请重新登录" }

// Error 401: { "error": "原密码错误" }
// Error 400: { "error": "新密码至少8位" }
// Error 401: { "error": "Authorization token required" }
```

---

## 5. 偶像 CRUD（需认证）

### `GET /api/idols` — 获取偶像列表

```json
// Response 200
[
  { "id": 7, "user_id": 1, "name": "张杰", "avatar": "/uploads/xxx.jpg", "created_at": "2026-05-24 02:18:29" }
]
```

### `GET /api/idols/:id` — 获取单个偶像

### `POST /api/idols` — 创建偶像

```json
// Request
{ "name": "BLACKPINK", "avatar": "https://picsum.photos/seed/bp/100/100" }

// Response 201
{ "id": 4, "user_id": 1, "name": "BLACKPINK", "avatar": "https://...", "created_at": "..." }
```

### `PUT /api/idols/:id` — 更新偶像

```json
// Request
{ "name": "BLACKPINK 🖤", "avatar": "https://..." }
```

### `DELETE /api/idols/:id` — 删除偶像（级联删除关联行程和日记）

```json
// Response 200
{ "success": true }
```

---

## 6. 行程事件 CRUD（需认证）

### `GET /api/events` — 获取行程列表

```json
// Response 200
[
  {
    "id": 8,
    "idolId": 7,
    "idolName": "张杰",
    "title": "开往1982",
    "date": "2026-04-19T19:00:00+08:00",
    "location": "北京鸟巢体育场",
    "lat": 39.9929,
    "lng": 116.3966,
    "photos": ["/uploads/ba864b97-xxx.jpg"]
  }
]
```

### `GET /api/events/:id` — 获取单个行程

### `POST /api/events` — 创建行程

```json
// Request
{
  "idolId": 7,
  "title": "演唱会",
  "date": "2026-08-01T19:00:00+08:00",
  "location": "北京鸟巢",
  "lat": 39.9929,
  "lng": 116.3966,
  "photos": ["/uploads/xxx.jpg"]
}
```

### `PUT /api/events/:id` — 更新行程

### `DELETE /api/events/:id` — 删除行程

---

## 7. 追星日记 CRUD（需认证）

### `GET /api/diaries` — 获取日记列表（支持分页+筛选）

查询参数：
- `page` — 页码（默认 1）
- `pageSize` — 每页条数（默认 20，最大 100）
- `idolId` — 按偶像筛选
- `mood` — 按心情筛选

```json
// Response 200
{
  "data": [
    {
      "id": 1,
      "idolId": 7,
      "idolName": "张杰",
      "eventId": 8,
      "title": "第一次看演唱会！",
      "content": "今天去鸟巢看了...",
      "mood": "excited",
      "date": "2026-04-19T22:00:00+08:00",
      "photos": ["/uploads/xxx.jpg"],
      "createdAt": "2026-05-24 02:52:06"
    }
  ],
  "total": 3,
  "page": 1,
  "pageSize": 20
}
```

### `GET /api/diaries/:id` — 获取单篇日记

### `POST /api/diaries` — 创建日记

```json
// Request
{
  "idolId": 7,
  "eventId": 8,
  "title": "第一次看演唱会！",
  "content": "今天去鸟巢看了...",
  "mood": "excited",
  "date": "2026-04-19T22:00:00+08:00",
  "photos": ["/uploads/xxx.jpg"]
}
```

### `PUT /api/diaries/:id` — 更新日记

### `DELETE /api/diaries/:id` — 删除日记

**验证规则：**
- title 必填
- date 必填
- photos 最多 18 张
- idolId 关联偶像时自动获取 idolName

---

## 8. 图片上传（需认证）

### `POST /api/upload`

- Content-Type: `multipart/form-data`
- 字段名: `image`

```bash
curl -X POST http://49.232.245.158/api/upload \
  -H "Authorization: Bearer <token>" \
  -F "image=@photo.jpg"
```

```json
// Response 200
{ "url": "/uploads/uuid.jpg", "filename": "uuid.jpg" }
```

限制：仅接受图片文件，最大 5MB。

---

## 9. Admin 管理接口（仅 admin 角色）

### `GET /api/admin/users` — 获取所有用户列表

```json
// Response 200
[
  {
    "id": 1,
    "username": "demo",
    "nickname": "Demo User",
    "role": "user",
    "avatar": null,
    "created_at": "2026-05-24 03:54:38",
    "stats": {
      "idols": 3,
      "events": 4,
      "diaries": 0,
      "photos": 3,
      "estimatedMemory": "7.0KB"
    }
  }
]
```

### `DELETE /api/admin/users/:id` — 删除用户及其所有数据

- 不能删除 admin 账号
- 级联删除：偶像、行程、日记、照片

```json
// Response 200
{ "success": true, "message": "用户 xxx 及其所有数据已删除" }
// Error 403: 非 admin 访问
// Error 400: 不能删除管理员账号
```

### Admin 账号

- 用户名：admin
- 密码：admin
- 角色：admin

---

## 10. 场馆接口（离线场馆库）

内置中国 46 个主要体育场/体育馆数据，覆盖 28 个省份。

### `GET /api/venues/provinces` — 获取省份列表（无需认证）

```json
// Response 200
["上海", "云南", "内蒙古", "北京", "吉林", "四川", ...]
```

### `GET /api/venues/cities?province=广东` — 按省份返回城市列表（无需认证）

```json
// Response 200
["东莞", "广州", "深圳"]
```

### `GET /api/venues/list?province=广东&city=深圳` — 按省市返回场馆列表（无需认证）

```json
// Response 200
[
  {
    "id": 11,
    "province": "广东",
    "city": "深圳",
    "name": "深圳湾体育中心（春茧）",
    "lat": 22.5178,
    "lng": 113.9486
  }
]
```

### `GET /api/venues/all` — 返回全部场馆（无需认证，前端地图用）

```json
// Response 200
[
  { "id": 1, "province": "北京", "city": "北京", "name": "国家体育场（鸟巢）", "lat": 39.9929, "lng": 116.3966 },
  ...
]
```

### `POST /api/venues/visited` — 标记场馆为已去过（需认证）

```json
// Request
{ "venueId": 1 }

// Response 201
{ "id": 1, "userId": 28, "venueId": 1, "createdAt": "2026-05-24T11:01:23.072Z" }

// Error 409: { "error": "已标记过该场馆" }
```

### `GET /api/venues/visited` — 获取用户已去过的场馆（需认证）

```json
// Response 200
[
  {
    "id": 1,
    "venueId": 1,
    "visitedAt": "2026-05-24 11:01:23",
    "province": "北京",
    "city": "北京",
    "venueName": "国家体育场（鸟巢）",
    "lat": 39.9929,
    "lng": 116.3966
  }
]
```

### `DELETE /api/venues/visited/:id` — 取消标记（需认证）

```json
// Response 200
{ "success": true }
```

---

## 数据隔离

所有业务数据按 user_id 隔离，每个用户只能访问自己创建的数据。Token 中包含 userId，接口自动过滤。

## 数据库

SQLite，文件存储在 `star-tracker.db`，自动创建表和演示数据。

## 启动

```bash
cd star-tracker-api
npm install
npm start        # 默认端口 3000
PORT=80 npm start  # 端口 80
```

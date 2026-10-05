# DwarfLens Cloud API Reference

Base URL: `https://api.dwarflens.dev` (or `http://localhost:3000` in local development).

All endpoints return JSON responses with standard HTTP status codes.

---

## Authentication

DwarfLens supports two authentication methods:

1. **API Keys (CI / Programmatic Access)**
   - Pass the secret key in the `Authorization` header:
     ```http
     Authorization: Bearer dl_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
     ```
2. **Session Cookies (Web Dashboard)**
   - Browser sessions use secure, `httpOnly`, `sameSite=lax` cookies named `dwarflens_session`.

---

## 1. Analyses

### Ingest Analysis Report
`POST /api/v1/analyses`

Ingests a binary analysis report conforming to `analysis.v1.schema.json`. Evaluates project budgets and triggers alerts on `main` branch failures. Idempotent on `project_id + commit_sha + build_name`.

- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer <API_KEY>` (or session cookie)
  - `X-Org-Id: <ORG_UUID>` (optional if using API key)
- **Query Parameters:**
  - `projectId`: Target project UUID (optional if key is project-scoped)
  - `base`: Baseline commit SHA for growth calculation (optional)
- **Limits:** Max payload size: 5 MB. Rate limit: 100 requests / minute.
- **Response `201 Created`:**
  ```json
  {
    "status": "created",
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "project_id": "c1f7a18b-...",
    "commit_sha": "a1b2c3d4...",
    "branch": "main",
    "build_name": "release",
    "created_at": "2026-10-19T22:00:00.000Z",
    "budget_status": {
      "passed": true,
      "reasons": []
    }
  }
  ```

---

### List Project Analyses
`GET /api/v1/projects/:id/analyses`

Returns paginated summary rows for historical binary analyses within the specified project.

- **Query Parameters:**
  - `branch`: Filter by branch name (e.g. `main`)
  - `limit`: Number of items (default: 50, max: 100)
  - `offset`: Pagination offset (default: 0)
- **Response `200 OK`:**
  ```json
  {
    "analyses": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "projectId": "...",
        "commitSha": "a1b2c3d4...",
        "branch": "main",
        "buildName": "release",
        "totalSize": 145020,
        "flashSize": 130000,
        "ramSize": 15020,
        "structCount": 12,
        "symbolCount": 450,
        "paddingBytes": 16,
        "cacheLineCrossings": 0,
        "createdAt": "2026-10-19T22:00:00.000Z"
      }
    ]
  }
  ```

---

### Get Analysis Detail
`GET /api/v1/analyses/:id`

Retrieves the full raw analysis payload and layout metadata for a single analysis.

- **Response `200 OK`:**
  ```json
  {
    "analysis": {
      "id": "...",
      "projectId": "...",
      "rawData": { ... }
    }
  }
  ```

---

### Diff Two Analyses
`GET /api/v1/projects/:id/diff?base=&head=`

Computes structured section, symbol, and struct padding deltas between two analyses identified by analysis UUIDs or commit SHAs.

- **Query Parameters:**
  - `base`: Base analysis UUID or commit SHA
  - `head`: Head analysis UUID or commit SHA
- **Response `200 OK`:**
  ```json
  {
    "diff": {
      "base_id": "...",
      "head_id": "...",
      "total_size_delta": 4096,
      "section_deltas": [
        { "name": ".text", "base_size": 100000, "head_size": 104096, "delta": 4096 }
      ],
      "symbol_deltas": [
        { "name": "handle_packet", "base_size": 256, "head_size": 512, "delta": 256 }
      ],
      "struct_padding_deltas": []
    }
  }
  ```

---

## 2. Project Configuration

### Configure Budgets
`PUT /api/v1/projects/:id/budgets`

- **Role Required:** `member` or `owner`
- **Request Body:**
  ```json
  {
    "max_total_size": 500000,
    "max_growth_bytes": 10240,
    "fail_on_padding_regression": true
  }
  ```

---

### Configure Alerts
`PUT /api/v1/projects/:id/alerts`

- **Role Required:** `member` or `owner`
- **Request Body:**
  ```json
  {
    "slack_webhook_url": "https://hooks.slack.com/services/...",
    "email": "alerts@example.com"
  }
  ```

---

## 3. Shareable Reports

### Create Share Link
`POST /api/v1/analyses/:id/share`

- **Role Required:** `owner`
- **Response `201 Created`:**
  ```json
  {
    "token": "4e1a0b3c8f2d...",
    "url": "https://dwarflens.dev/#shared/4e1a0b3c8f2d...",
    "status": "created"
  }
  ```

### Get Public Shared Report
`GET /api/v1/shared/:token` (No authentication required)

---

## 4. Teams & Organizations

### List Org Members
`GET /api/v1/orgs/:orgId/members` (Role: `viewer` or higher)

### Invite / Add Member
`POST /api/v1/orgs/:orgId/members` (Role: `owner`)
- **Request Body:**
  ```json
  {
    "email": "colleague@example.com",
    "role": "member"
  }
  ```

### Update Member Role
`PATCH /api/v1/orgs/:orgId/members/:memberId` (Role: `owner`)
- **Request Body:** `{ "role": "viewer" }`

### Remove Member
`DELETE /api/v1/orgs/:orgId/members/:memberId` (Role: `owner`)

# Open Kounter

Open Kounter 是一个基于 EdgeOne Pages Functions 和 KV 存储的无服务器计数器服务，旨在替代 LeanCloud 为静态网站（如 Hexo）提供 PV/UV 统计功能。它包含一个完整的管理后台，支持数据管理、导入导出、域名白名单和 Passkey 无密码登录。

## 目录结构与文件说明

本项目主要由以下几个部分组成：

### 1. 后端逻辑 (`edge-functions/`)
运行在 EdgeOne 边缘节点的 Serverless 函数，处理所有 API 请求。
- `edge-functions/api/counter.js`: 核心逻辑。处理计数器的增删改查、批量操作、数据导入导出以及配置管理。
- `edge-functions/api/auth.js`: 认证逻辑。验证 Token 是否有效。
- `edge-functions/api/passkey.js`: WebAuthn (Passkey) 相关逻辑，处理生物识别登录的注册和验证。
- `edge-functions/api/init.js`: 系统初始化接口，用于首次设置管理员 Token。

### 2. 前端管理后台 (`src/`)
基于 Vue 3 + Vite 构建的单页应用（SPA），用于管理计数器数据。
- `src/components/dashboard/CounterList.vue`: 计数器列表页，支持分页查看、搜索、删除和修改每页显示条数。
- `src/components/dashboard/SingleCounterManager.vue`: 单个计数器管理，支持精确查询、设置数值和删除。
- `src/components/dashboard/DataBackup.vue`: 数据备份与恢复，支持 JSON 格式的全量导出和导入（兼容 LeanCloud 格式）。
- `src/components/dashboard/DomainConfig.vue`: 安全设置，配置允许调用计数接口的域名白名单。
- `src/components/dashboard/PasskeyManager.vue`: Passkey 管理，绑定指纹或人脸识别以便快速登录。

### 3. 客户端适配器 (`client/`)
- `client/adapter.js`: Demo 文件，它模拟了 LeanCloud 的部分行为，自动获取 PV/UV 并发送自增请求。

## API 接口文档

所有 API 的基础路径为 `/api`。

### 公开接口 (无需认证)

#### 1. 获取计数
- **URL**: `GET /api/counter`
- **参数**: `target` (必填，计数器的 Key，如 `site-pv`)
- **响应**:
  ```json
  {
    "code": 0,
    "data": {
      "time": 100,
      "target": "site-pv",
      "created_at": 1700000000000,
      "updated_at": 1700000000000
    }
  }
  ```

#### 2. 增加计数 (自增)
- **URL**: `POST /api/counter`
- **Body**:
  ```json
  {
    "action": "inc",
    "target": "site-pv"
  }
  ```
- **说明**: 受域名白名单限制。

#### 3. 批量增加计数
- **URL**: `POST /api/counter`
- **Body**:
  ```json
  {
    "action": "batch_inc",
    "requests": [
      { "target": "site-pv" },
      { "target": "/posts/hello-world/" }
    ]
  }
  ```
- **说明**: 常用于同时更新站点总 PV 和单页 PV。受域名白名单限制。

### 管理接口 (需要认证)

需要在 Header 中携带 `Authorization: Bearer <YOUR_TOKEN>`。

#### 1. 设置计数器值
- **URL**: `POST /api/counter`
- **Body**:
  ```json
  {
    "action": "set",
    "target": "site-pv",
    "value": 1000
  }
  ```

#### 2. 删除计数器
- **URL**: `POST /api/counter`
- **Body**:
  ```json
  {
    "action": "delete",
    "target": "site-pv"
  }
  ```

#### 3. 获取计数器列表
- **URL**: `POST /api/counter`
- **Body**:
  ```json
  {
    "action": "list",
    "page": 1,
    "pageSize": 20
  }
  ```

#### 4. 导出所有数据
- **URL**: `POST /api/counter`
- **Body**: `{ "action": "export_all" }`
- **响应**: 包含所有计数器数据和配置的 JSON 对象。

#### 5. 导入数据
- **URL**: `POST /api/counter`
- **Body**:
  ```json
  {
    "action": "import_all",
    "data": { ... } // 导出的 JSON 数据
  }
  ```

#### 6. 配置域名白名单
- **URL**: `POST /api/counter`
- **Body**:
  ```json
  {
    "action": "set_config",
    "allowedDomains": ["example.com", "*.example.com"]
  }
  ```

## 部署与使用

1. **部署到 EdgeOne Pages**: 将项目上传并部署。
2. **绑定 KV**: 创建 KV Namespace 并绑定变量名为 `OPEN_KOUNTER`。
3. **初始化**: 访问部署后的网址，设置管理员 Token。

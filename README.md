# Open Kounter

Open Kounter 是一个基于 EdgeOne Pages Functions 和 KV 存储的无服务器计数器服务，旨在替代 LeanCloud 为静态网站（如 Hexo）提供 PV/UV 统计功能。它包含一个完整的管理后台，支持数据管理、导入导出、域名白名单和 Passkey 无密码登录。

更详细的介绍和部署指南请参考：
- [LeanCloud 遗憾谢幕：基于 EdgeOne KV 打造高性能 PV/UV 访客统计](https://www.mintimate.cn/2026/02/14/openKounter/)

## EdgeOne Pages 上部署

你可以通过 EdgeOne Pages 一键部署或手动配置构建：

一键部署：

[![使用 EdgeOne Pages 部署](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://console.cloud.tencent.com/edgeone/pages/new?repository-url=https://github.com/Mintimate/open-kounter)

> **注意**：点击上方按钮前，建议先 Fork 本仓库，并在跳转后的页面中确认仓库地址为你 Fork 后的地址。

手动部署配置：

- 框架预设：Node.js（或留空，EdgeOne 会识别 `edgeone.json`）
- 构建命令：`npm run build`
- 输出目录：`dist`
- Node 版本：`22`

更多 EdgeOne Pages文档：https://pages.edgeone.ai/zh/document/product-introduction

### 配置 KV 存储（必需）

本项目依赖 KV 存储来保存计数数据和配置信息，请务必配置：

1. **创建 KV 命名空间**
   - 在 EdgeOne Pages 控制台创建 KV 命名空间
   - 进入项目设置 > 存储

2. **绑定 KV 到项目**
   - 将 KV 命名空间绑定到项目
   - 变量名设为：`OPEN_KOUNTER`

3. **重新部署项目**
   - 绑定 KV 后需要重新部署项目才能生效

### 初始化

部署并配置完成后，访问你的项目网址，首次访问将引导你设置管理员 Token。


## 目录结构与文件说明

```tree
.
├── client/
│   └── adapter.js          # 客户端适配器，模拟 LeanCloud 行为
├── edge-functions/         # 后端逻辑 (EdgeOne Functions)
│   └── api/
│       ├── auth.js         # 认证逻辑
│       ├── counter.js      # 核心计数器逻辑
│       ├── init.js         # 初始化接口
│       └── passkey.js      # Passkey 相关逻辑
├── src/                    # 前端管理后台 (Vue 3 + Vite)
│   ├── components/
│   │   ├── dashboard/
│   │   │   ├── CounterList.vue          # 计数器列表
│   │   │   ├── DataBackup.vue           # 数据备份与恢复
│   │   │   ├── DomainConfig.vue         # 域名白名单配置
│   │   │   ├── PasskeyManager.vue       # Passkey 管理
│   │   │   ├── SingleCounterManager.vue # 单个计数器管理
│   │   │   └── TotalStats.vue           # 统计概览
│   │   ├── Dashboard.vue   # 仪表盘主组件
│   │   └── Login.vue       # 登录组件
│   ├── utils/              # 工具函数
│   ├── App.vue             # 主应用组件
│   ├── main.js             # 入口文件
│   └── style.css           # 全局样式
├── edgeone.json            # EdgeOne 配置文件
├── index.html              # HTML 入口
├── package.json            # 项目依赖
├── tailwind.config.js      # Tailwind 配置
└── vite.config.js          # Vite 配置
```

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

## 许可证

本项目基于 [MIT License](./LICENSE) 开源。

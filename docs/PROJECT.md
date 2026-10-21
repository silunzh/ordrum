# 项目目录与文件用途

日常修改网页时，从 `public/` 开始。当前网页只由 GitHub Pages 或本地静态服务提供；`app/` 是旧 Sites 迁移参考；`dist/` 是构建产物，无需手动修改。

```text
ordrum/
├── public/                  网页、词库、发音和 iPhone 主屏幕 App
│   ├── index.html           页面结构
│   ├── style.css            主界面样式
│   ├── app.js               预览、翻卡片、听写与词条编辑
│   ├── study.js/.css        学习任务与错题本
│   ├── session.js           学习位置、听写草稿与恢复
│   ├── cloud.js             账号隔离与自动同步
│   ├── github-sync.js       私有 GitHub 进度仓库连接、凭据和传输
│   ├── local-sync.js        旧账号桥参考，不参与静态发布
│   ├── sync-bridge.js       旧服务参考，不参与静态发布
│   ├── pwa.js               安装提示与 App 更新
│   ├── service-worker.js    界面、词库和已播放音频的离线缓存
│   ├── manifest.webmanifest App 名称、图标与启动配置
│   ├── vocab.json           单词、章节、英文释义和词形
│   ├── audio-map.json       瑞典语文本与音频文件映射
│   ├── audio/               发音文件
│   └── icons/               网页和 iPhone App 图标
├── app/                     服务器入口与接口
│   ├── route.ts             返回 public/index.html
│   ├── layout.tsx           框架使用的基本布局与页面信息
│   ├── chatgpt-auth.ts      Sites 提供的登录身份辅助
│   ├── api/progress/route.ts 私有进度快照接口
│   └── sync-bridge/route.ts  本地连接的登录与确认页面
├── db/                      数据库连接和表结构
├── drizzle/                 已生成的数据库迁移及元数据
├── tests/                   学习、同步、账号隔离和离线缓存检查
├── scripts/                 本地启动、构建与 Sites 运行辅助
├── worker/                  线上 Worker 入口
├── lib/                     Sites 连接器与预览所需基础设施
├── docs/                    项目说明
├── .openai/hosting.json      现有线上站点及数据库绑定
├── README.md                使用与开发入口
└── AGENTS.md                Codex 修改本项目时需要遵循的约定
```

## 常见修改

| 要做的事 | 主要文件 |
| --- | --- |
| 修改页面文字和排列 | `public/index.html`、`public/style.css` |
| 修改听写判分、翻卡和词形显示 | `public/app.js` |
| 修改任务管理和错题本 | `public/study.js`、`public/study.css` |
| 修改保存位置和恢复草稿 | `public/session.js` |
| 修改跨设备同步 | `public/cloud.js`、`public/github-sync.js` |
| 修改同步连接设置 | `public/github-sync.js`、`docs/SYNC.md` |
| 修改安装、更新和离线使用 | `public/pwa.js`、`public/service-worker.js`、`public/manifest.webmanifest` |
| 修改数据库结构 | `db/schema.ts`，再生成新的 `drizzle/` 迁移 |

`tests/frontend.test.cjs` 检查学习交互和同步后列表刷新；`study.test.cjs` 检查任务与错题记录；`server.test.cjs` 检查数据库接口与账号隔离；`cloud.test.cjs` 检查同步和中断恢复；`local-sync.test.cjs`、`sync-bridge.test.cjs` 检查本地连接和授权边界；`local-server.test.cjs` 检查 Mac 启动时避开旧界面缓存；`pwa.test.cjs` 检查安装与缓存。运行方式见根目录 README。

## 数据与本机文件

词库的卡片 ID、瑞典语原文、章节和页码对应原始词卡。释义、词形及发音来源保存在 `public/DICTIONARY-SOURCES.md`、`dictionary-provenance.json` 和 `audio-provenance.json` 中，应和词库、音频一同保留。

当前学习记录保存在浏览器及独立 GitHub 私有进度仓库中。旧数据库不参与新同步。项目里的 `.wrangler/` 是独立的本地数据库和运行状态；`.sites-runtime/`、`.vinext/`、`.next/` 是本机开发工具状态。整理源码时不应将这些目录当作学习数据备份，也不要直接清除本地数据库。

`node_modules/` 是依赖，`dist/` 是生成的部署产物；`outputs/`、`work/` 和 `.tmp/` 存放已有输出或工作文件。这些目录均不属于日常编辑网页的入口。

旧 Sites 的构建、预览和连接器辅助文件保留在 `scripts/`、`worker/`、`lib/` 中。它们仅供历史迁移参考；当前学习入口不依赖它们。同步机制见 `docs/SYNC.md`。

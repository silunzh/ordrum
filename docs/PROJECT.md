# 项目目录与文件用途

日常修改网页时，从 `public/` 开始。当前网页只由 GitHub Pages 或本地静态服务提供；`app/` 是旧 Sites 迁移参考；`dist/` 是构建产物，无需手动修改。

```text
ordrum/
├── public/                  网页、词库、发音和 iPhone 主屏幕 App
│   ├── index.html           页面结构
│   ├── style.css            主界面样式
│   ├── app.js               预览、翻卡片、听写与词条编辑
│   ├── study.js/.css        学习任务与错题本
│   ├── session.js           学习位置、轮次标识、今日计划与恢复
│   ├── review.js/.css       复习事件、间隔安排和记忆法预设
│   ├── plan.js/.css         独立计划学习页与稳定练习区
│   ├── plan-core.js         计划会话清洗与进度计算（合并由 cloud.js 负责）
│   ├── plan-session.js      计划练习接入、分组、暂停与恢复
│   ├── sync-health.js/.css  同步提示、恢复预览与本机恢复点
│   ├── word-extras.js/.css  按需查询临时例句、相关词和读音
│   ├── cloud.js             账号隔离与自动同步
│   ├── settings.js/.css     统一设置、设备外观与主题
│   ├── workspace.css        简洁书架与移动布局
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
├── app/                     旧 Sites 服务器入口与接口（迁移参考）
│   ├── route.ts             返回 public/index.html
│   ├── layout.tsx           框架使用的基本布局与页面信息
│   ├── chatgpt-auth.ts      Sites 提供的登录身份辅助
│   ├── api/progress/route.ts 私有进度快照接口
│   └── sync-bridge/route.ts  本地连接的登录与确认页面
├── db/                      数据库连接和表结构
├── drizzle/                 已生成的数据库迁移及元数据
├── tests/                   学习、同步、账号隔离和离线缓存检查
├── scripts/                 本地启动、静态导出、版本与旧构建辅助
├── worker/                  旧 Sites Worker 入口（迁移参考）
├── lib/                     Sites 连接器与预览所需基础设施
├── docs/                    项目说明
├── .github/workflows/pages.yml  独立 GitHub Pages 发布
├── .openai/hosting.json      旧站点与数据库绑定（迁移历史）
├── README.md                使用与开发入口
└── AGENTS.md                Codex 修改本项目时需要遵循的约定
```

## 常见修改

| 要做的事 | 主要文件 |
| --- | --- |
| 修改页面文字和排列 | `public/index.html`、`public/style.css`、`public/workspace.css` |
| 修改听写判分、翻卡和词形显示 | `public/app.js` |
| 修改任务管理、错题本书籍与章节 | `public/study.js`、`public/study.css` |
| 修改计划页、记忆法与间隔 | `public/plan.js`、`public/plan.css`、`public/review.js` |
| 修改计划分组、计时、继续与合并 | `public/plan-session.js`、`public/plan-core.js`、`public/session.js` |
| 修改临时联网扩展和来源限制 | `public/word-extras.js`、`public/word-extras.css` |
| 修改保存位置和恢复草稿 | `public/session.js` |
| 修改跨设备同步 | `public/cloud.js`、`public/github-sync.js` |
| 修改同步连接设置 | `public/github-sync.js`、`docs/SYNC.md` |
| 修改同步提示、恢复预览和恢复点 | `public/sync-health.js`、`public/sync-health.css` |
| 修改设置标签和设备外观 | `public/settings.js`、`public/settings.css` |
| 修改安装、更新和离线使用 | `public/pwa.js`、`public/service-worker.js`、`public/manifest.webmanifest` |
| 修改数据库结构 | `db/schema.ts`，再生成新的 `drizzle/` 迁移 |

## 检查与说明

在根目录运行 `npm test`。当前静态网页的主要检查如下；旧服务器与旧账号桥仍作为迁移回归检查保留。

| 检查 | 覆盖范围 |
| --- | --- |
| `tests/frontend.test.cjs` | 学习交互、会话恢复、错题本入口和同步后刷新 |
| `tests/study.test.cjs` | 任务、错题本书籍、章节和固定单元管理 |
| `tests/plan.test.cjs` | 独立计划页、方法与范围草稿、焦点、练习节点保护和结束确认 |
| `tests/plan-core.test.cjs`、`tests/plan-session.test.cjs` | 计划会话清洗、真实阶段首答、分组、暂停计时、重开恢复与原进度保护 |
| `tests/review.test.cjs` | 间隔规则、每日上限、首次与重试、合并去重、日历边界、容量保护和今日计划 |
| `tests/cloud.test.cjs` | 自动同步、记录合并、账号隔离和中断恢复 |
| `tests/github-sync.test.cjs` | 私有仓库传输、身份和版本检查、文件冲突 |
| `tests/sync-health.test.cjs` | 同步变化预览、凭据排除、恢复前备份及账号隔离 |
| `tests/word-extras.test.cjs` | 瑞典语条目、参考源边界、词义与录音许可、临时开关和网络失败 |
| `tests/settings.test.cjs` | 标签、表单草稿、设备外观与焦点 |
| `tests/local-server.test.cjs` | Mac 启动与旧缓存更新 |
| `tests/pwa.test.cjs`、`tests/pages.test.cjs` | 安装、离线缓存和静态发布范围 |
| `tests/server.test.cjs`、`tests/local-sync.test.cjs`、`tests/sync-bridge.test.cjs` | 旧服务和旧账号桥回归参考 |

使用规则见 [今日计划](REVIEW.md)、[同步](SYNC.md) 和 [临时扩展](WORD-EXTRAS.md)；[功能决策记录](ROADMAP-20261021.md) 保留原始评估及本轮实现状态。

## 数据与本机文件

词库的卡片 ID、瑞典语原文、章节和页码对应原始词卡。释义、词形及发音来源保存在 `public/DICTIONARY-SOURCES.md`、`dictionary-provenance.json` 和 `audio-provenance.json` 中，应和词库、音频一同保留。

当前学习记录、错词单元、复习事件、计划会话和计划偏好保存在浏览器及独立 GitHub 私有进度仓库中。外观只在设备保存；联网词义扩展只保留当前页面内存，不写入学习记录、档案或同步。恢复点另保存在当前浏览器，按账号与书籍隔离；手动导出才会得到可自行保存的档案文件。旧数据库不参与新同步。项目里的 `.wrangler/` 是独立的本地数据库和运行状态；`.sites-runtime/`、`.vinext/`、`.next/` 是本机开发工具状态。整理源码时不应将这些目录当作学习数据备份，也不要直接清除本地数据库。

`node_modules/` 是依赖，`dist/` 是生成的部署产物；`outputs/`、`work/` 和 `.tmp/` 存放已有输出或工作文件。这些目录均不属于日常编辑网页的入口。

旧 Sites 的构建、预览和连接器辅助文件保留在 `scripts/`、`worker/`、`lib/` 中。它们仅供历史迁移参考；当前学习入口不依赖它们。同步机制见 `docs/SYNC.md`。

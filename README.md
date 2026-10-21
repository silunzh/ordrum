# Ordrum · 瑞典语单词室

Rivstart A1/A2 Ordkort 学习网页与 iPhone 主屏幕 App，含 20 章、1,332 张词卡、英文释义和词形，以及 1,065 段瑞典语合成读音。

## 在线与 iPhone

GitHub Pages 地址：[Ordrum](https://silunzh.github.io/ordrum/)。Mac 双击 `启动网页.command` 可继续使用 http://127.0.0.1:8765。两种入口使用相同网页和同步机制，不需要旧 Sites 账号窗口。

学习记录保存在设备，并自动同步至独立的 **私有** [silunzh/ordrum-progress](https://github.com/silunzh/ordrum-progress) 仓库的 `progress.json`。此公开代码仓库不保存个人学习记录或访问令牌。

首次使用，在顶部点「同步设置」，填写 GitHub 用户名、私有进度仓库名和仅限该仓库的 fine-grained personal access token。令牌只需 Repository permissions → Contents: Read and write；不要授权个人主页或其他仓库。详细配置和同步规则见 [docs/SYNC.md](docs/SYNC.md)。勾选「在此浏览器记住连接」后，重新打开可自动连接；不勾选只在当前会话保留。令牌仅发给 GitHub API，不进入学习备份或代码。请直接在应用中填写，不要发送到聊天。

连接同一账号和同一私有仓库后，任务、错题、词条修改和学习位置会自动合并，以「学习进度已同步」为完成标志。学习变化延迟几秒上传；打开或返回页面时同步，前台每两分钟检查另一设备的更新。离线修改留在本机，联网后自动合并。首次迁移可明确选择合并此设备的现有记录；之后换账号或仓库仍保持隔离。

iPhone 在 Safari 打开新网址，点「分享」→「添加到主屏幕」。主屏幕 App 与 Safari 可能使用不同存储，两处都需配置同一个私有仓库。无需保持额外窗口打开。界面和词库准备好后可离线使用；音频在联网播放时逐步缓存。iPhone 可能需要先点按播放按钮才允许自动发音。

## 学习

- 在左侧选择章节，用预览模式浏览或搜索；可将所选章节或全书创建为独立任务。
- 翻开释义后瑞典语仍然可见，文字可选中复制；勾选自动读音后，返回正面会播放。
- 听写每到新词自动播放。回车先检查，答对后再次回车进入下一词，答错后再次回车清空重试并播放。
- 动词词形按命令、不定、现在、过去、完成排序。å、ä、ö 在听写中分别判定。
- “学习任务”支持继续、重命名、归档、重置、删除；“错题本”支持筛选、搜索、批量重练、掌握或删除。
- 卡片位置、翻面状态、听写草稿和结果都会保存。错词重练可返回原学习位置。
- 可编辑词条并导出、导入完整学习记录。重要记录建议定期备份。

## 本地开发

网页源文件在 `public/`。本地静态服务只需要 Node.js：运行 `npm run local`，或双击 `启动网页.command`，无需安装依赖。GitHub Pages 和本地网页直接调用 GitHub API，不经过本地服务器转发令牌。

本地学习使用固定的 127.0.0.1:8765，保留原有浏览器进度。启动器会加载当前脚本以避开旧离线缓存。更新后请关闭原启动窗口，再重新启动；不要清理浏览器记录。

运行 `npm test` 验证学习、账号隔离、迁移中断恢复、GitHub SHA 冲突和离线缓存。发布前运行 `node scripts/version-pwa.cjs`。`node scripts/export-pages.cjs` 生成 `outputs/github-pages/`，无需项目依赖。目录说明见 [docs/PROJECT.md](docs/PROJECT.md)。

旧 Sites 的 `app/`、`db/`、`drizzle/`、`worker/`、`lib/` 及相关测试暂作历史迁移参考，不参与当前静态发布；不应重新发布旧服务或把数据库、备份和运行目录上传到公开仓库。

## GitHub Pages 发布

独立公开仓库：[silunzh/ordrum](https://github.com/silunzh/ordrum)。`.github/workflows/pages.yml` 在 `main` 更新后检查同步逻辑，再发布静态网页。网站、安装和 Service Worker 均只在 `/ordrum/` 下，不修改个人主页仓库、根目录或域名。

导出包排除旧账号桥、服务器、数据库、备份、凭据与本机状态。私有进度仓库应始终保持 Private，不启用 Pages。

## 数据与许可

词卡来自用户提供的 PDF。英文词典资料来自 Folkets lexikon，词形资料来自 SALDO，并包含人工校订。来源和许可见 [DICTIONARY-SOURCES.md](public/DICTIONARY-SOURCES.md)。保持卡片 ID、原始瑞典语、章节及来源记录不变。

# GitHub 与本地的学习进度同步

## 初次连接

1. 使用独立私有仓库 `silunzh/ordrum-progress`，默认分支 `main`，含 README。不要使用公开的 `ordrum` 代码仓库。
2. 在 GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens 新建令牌。Repository access 选 Only select repositories，只选 `ordrum-progress`。Repository permissions 中仅把 Contents 设为 Read and write；Metadata 为必需只读权限。设置合适到期日。
3. 在 Ordrum 的「同步设置」填 `silunzh`、`ordrum-progress` 与令牌。请直接填到应用，不要发送到聊天。每台设备都需配置；可分别生成权限相同的令牌，便于单独撤销。
4. 若这是从旧站迁移，在确认页面选择「将此设备现有学习记录合并到此私有仓库」。先导出备份。普通换账号或仓库时不应合并别人的记录。
5. 若希望重开浏览器后继续自动同步，勾选「在此浏览器记住连接」。未勾选时，令牌仅保存在当前会话。令牌到期或被撤销后，本机学习仍保留，可重新配置。

浏览器保存连接是明确选择；同一浏览器来源下运行的脚本可读取保存内容，因此令牌必须只限这个私有仓库。网页不包含第三方远程脚本。令牌不进入学习 JSON、导出文件、URL、公开源码或 Service Worker 缓存；请求仅发给 `https://api.github.com`。

## 同步规则

- 每次学习先保存到原设备的 `ordrum.rivstart.v1`，再延迟上传；断网可继续学习。
- 打开、切回或恢复联网时同步，前台每两分钟检查远端。快速输入合并为延迟写入，减少 GitHub 提交。
- 远端为 `progress.json`；文件含版本、账号标识、递增 revision、更新时间和学习状态。账号标识由 GitHub 核验的用户 ID 与仓库 ID 派生。
- 每次读取和写入都确认仓库仍为私有。令牌无权访问、文件损坏或记录超限时停止上传，保留本机数据并提示。
- 写入前比较 revision，并用 GitHub 的文件 SHA 作为写入条件。并发更新会重新读取、合并、重试，不能直接覆盖另一设备的提交。
- 使用共同基线进行三方合并：任务按稳定 ID，掌握标记按更新时间，学习位置按会话时间，错词合并来源任务和最近答案；已有记录的明确删除优先，避免删掉的任务复活。
- 本地恢复日志将学习状态与同步基线关联，避免中断后漏传或覆盖。首次迁移必须明确授权旧身份到新身份的精确组合，正常账号切换仍隔离。
- iPhone 主屏幕 App 和 Safari 可拥有不同本地存储；各自配置同一私有仓库即可同步。

## 迁移与恢复

旧站导出的备份已保全；私有进度仓库由这份完整学习记录初始化。不同设备可能还有尚未同步的修改，应在各自首次配置时明确选择合并，或使用备份入口导入。进度备份不会保存访问令牌。

删除旧站只在迁移备份完成后执行。旧站的账号登录和弹窗桥不再是新同步机制的一部分。代码历史中保留旧服务参考文件，但当前 HTML、离线缓存和 Pages 导出不加载它们。

## 官方接口依据

- [GitHub Contents API](https://docs.github.com/en/rest/repos/contents)：读取、创建和带 SHA 的更新。
- [Fine-grained personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)：限制单一仓库和权限。
- [REST API CORS](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests)：静态网页跨源调用 GitHub API。

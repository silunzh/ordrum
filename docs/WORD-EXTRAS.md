# 按需词卡参考

翻开词卡后可切换「同义词」「反义词」「读音版本」「例句」。按钮和展开内容始终按照此顺序排列，与开启顺序无关。按钮再次关闭会取消显示；内容不会写入词条修改、学习记录或备份。不同卡片可选择不同扩展程度，本次会话内保留选择。

## 查询与呈现

- 先查询卡片当前瑞典语词形，移除前置 en / ett / att 和末尾括号注记；若没有瑞典语条目，或某类内容缺失，再查询词库中已有且经过词法校验的原形。每次最多两个条目请求；保留当前词形已有内容，只用原形补齐缺少的类别，不猜测其他词形，也不抓整本书。
- 仅查询英文版 Wiktionary 的公开 MediaWiki API，解析精确的 Swedish 语言区，并匹配卡片词性。例句只取条目内标明 `sv` 的用例模板，不摘录书籍引用。近义词不保证在所有语境可互换，必要的义项和使用限定保留。
- 每个同义词和反义词都链接至该词 Wiktionary 的 Swedish 区，另开标签，使用安全的固定主机链接。词卡不展示来源、许可、原形等附加页脚；本次查询的引用条目可在「设置 → 档案」中查看。
- 读音版本只显示 Swedish 区中且语言参数明确为 `sv` 的 IPA 音标，不显示其他语言、无语言标记或无效格式音标。已移除额外录音请求及播放器；卡片原有瑞典语听读按钮保持可用。不生成方言、不做发音评分。
- Wiktionary 是社区词典，不保证词条完整或都适合 A1/A2。缺少对应内容时简短提示「暂无」，不从不明网页补造，也不改变词库经校订的释义。

## 网络与缓存

仅在用户点击或重新启用相应扩展时请求。不发送学习记录、错误答案、GitHub 令牌或登录信息。请求不带凭据与来源页信息，单次查询操作超时 12 秒，响应上限 700 KB。切换词卡或关闭全部扩展时取消请求；旧响应不会覆盖新卡片，也不会写入过期引用。

仅内存缓存最多 40 个词条、最长 24 小时；临时开关记忆最多 80 个词条，引用列表最多 80 条。离线时已有内容可继续查看，未缓存的查询禁用并提示联网。关闭页面后不承诺保留。引用服务暂不可用时可重试，原有词库、音频和练习照常可用。外部响应不进入学习 App 的离线缓存。

## 接口与许可依据

`OrdrumWordExtras.mount(host, word, options)` 与 `unmount()` 控制卡片。`load(word, signal)` 支持取消；`currentForm(word)`、`lemma(word)` 和 `lookupUrl(term)` 只返回通过校验的查询或链接。`getCredits()` 返回独立副本，字段仅有 `source`、`title`、`revision`、`url`、`license`，供档案页集中展示。引用中保留原始条目及具体修订链接，文本许可为 CC BY-SA 4.0；不再使用 Commons 音频。

- [MediaWiki 跨源匿名请求](https://www.mediawiki.org/wiki/API:Cross-site_requests)
- [MediaWiki Revisions API](https://www.mediawiki.org/wiki/API:Revisions)
- [Wiktionary 文本许可与复用](https://en.wiktionary.org/wiki/Wiktionary:Copyrights)
- [Creative Commons BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)

实现以实际字段为准，只展示解析器能可靠识别的范围；来源变化或没有结构化数据时允许返回空结果。

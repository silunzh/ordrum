# 按需词卡参考

翻开词卡后可切换「例句」「反义词」「同义词」「读音版本」。按钮再次关闭会取消显示；参考内容不会写入词条修改、学习记录或备份。不同卡片可选择不同扩展程度，本次会话内保留选择。

## 来源与边界

- 仅向英文版 Wiktionary 的公开 MediaWiki API 查询该词的瑞典语原形；只解析 Swedish 语言区，按词性和义项呈现。例句只取条目内的用例模板，不摘录书籍引用段落。近义词不代表每种语境都可替换，限定说明和义项一起显示。
- 音标、地区说明及录音来自该瑞典语区。录音通过 Wikimedia Commons 文件信息核验，逐条链接作者和许可；不把词典文本许可直接套给音频。只有来源实际提供多个读音时才展示多个，不生成方言或发音评分。录音可能是词典原形，当前卡片变位的读音仍可用原来的听读按钮播放。
- Wiktionary 是社区词典，可追溯但不保证词条完整或都适合 A1/A2；页面直接提供来源链接。无对应内容时显示未提供，不从不明网页补造，也不改变已有经校订的释义。

## 网络与缓存

仅在点击或重新启用相应扩展时请求，不预抓整本书。不发送学习记录、错误答案、GitHub 令牌或登录信息。请求不带凭据与来源页信息，超时 12 秒，响应上限 700 KB。切换词卡和关闭全部扩展时取消请求；旧响应不会覆盖新卡片。

仅内存缓存最多 40 个词条，最长 24 小时；关闭页面后不承诺保留。离线时已有内容可继续查看，未缓存的查询禁用并提示联网。引用服务暂不可用时可重试，原有词库、音频和练习照常可用。外部查询与录音不进入学习 App 的离线缓存。

## 接口与许可依据

- [MediaWiki 跨源匿名请求](https://www.mediawiki.org/wiki/API:Cross-site_requests)
- [MediaWiki Revisions API](https://www.mediawiki.org/wiki/API:Revisions)
- [MediaWiki Imageinfo API](https://www.mediawiki.org/wiki/API:Imageinfo)
- [Wiktionary 文本许可与复用](https://en.wiktionary.org/wiki/Wiktionary:Copyrights)
- [Creative Commons BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)

实现以实际字段为准，且只展示解析器能可靠识别的范围；来源变化或没有结构化数据时允许返回空结果。

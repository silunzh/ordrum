# 按计划学习与间隔复习

右上角「计划学习」打开独立的计划页。主页仍保留自由学习与原有学习任务。选择书籍、章节或错题本范围后，计划优先安排到期词，并分成 10–25 词的小组；每组结束可以休息、继续或返回书架。进行中的计划冻结当时的词序、方法和设置，改变后续计划设置不会改写已经开始的一轮。

## 一小时的三种起点

| 方法 | 默认新词 / 到期复习 | 不同词目标 | 分组大小 | 实际流程 | 满额粗估 |
|---|---:|---:|---:|---|---:|
| 分组主动回忆 | 30 / 90 | 120 | 20 | 新词预览 → 遮住释义主动翻卡 → 最多 20 个难词听写 | 约 54 分钟 |
| 听写巩固 | 20 / 80 | 100 | 10 | 新词预览 → 首次听写 → 最多 20 个错词重练 | 约 60 分钟 |
| 快速交错复习 | 40 / 160 | 200 | 25 | 以四个旧词、一个新词交错翻卡 → 最多 25 个难词回看 → 最多 20 个听写抽查 | 约 57 分钟 |

100–200 指新旧合计的**不同词**，不是每天新掌握 100–200 词。预览、重练和抽查会再次接触相同词，实际接触次数单独计算；没有足够到期词时不会为了凑数重复填满，也不会自动把到期额度换成新词。新安装默认为 30 个新词、90 个复习词；已有每日限额和间隔保留，只有明确应用另一方法预设才更新它们。

这些是可编辑的工作量起点，不是经研究验证的速度或保证。满额估时假设：新词预览约 20 秒；主动翻卡约 12 秒；首次听写约 23 秒；快速模式新词约 25 秒、旧词约 8 秒；难词按模式另加 10–30 秒，并留 8–10 分钟休息。词越陌生、查例句越多，耗时越长。每日目标时间（10–180 分钟）与每组词数、每日新词/复习限额（各 0–200，计划页合计不超过 200）均可修改；页面显示实际用时和粗估，达到时间目标后仍由学习者决定继续或结束。

主动回忆与跨日复习有研究支持；上述词数、时长、分组、四旧一新的排序和五阶段间隔是本应用的实践默认值，研究不证明它们对每位学习者最优。参考原始研究：[Karpicke 与 Roediger（2008）](https://doi.org/10.1126/science.1152408)、[Cepeda 等（2008）](https://escholarship.org/uc/item/0kp5q19x)。

## 安排与成绩规则

- 从启用后的实际回忆开始记录；不把旧的“已掌握”标记补造成历史。
- 成功后的默认间隔是 1、3、7、14、30 个本地日历日；听写预设使用 1、2、5、12、30。可修改为五个 1–365 之间严格递增的天数。偏好变化后按新间隔回放既有事件，不宣称是逐词最优的记忆模型。
- 每日新安排与到期复习名额按全词库的不同词数计数，切换章节或书籍不会重新得到一份名额；当前选择仍限制本轮具体词。当天已安排但未记住的词十分钟后可以再次出现，不重复占用名额。
- 翻卡“记住了”是自评；听写首次作答才进入拼写正确率。看答案单独计数，不冒充首次正确；预览和查看例句不生成复习成绩。
- 同轮、同词、同模式只采纳时间最早的一次结果。答错或看答案后的辅助重试不追加首次成功。听写方法的最后“错词重练”明确属于辅助练习；其正确结果不覆盖首次失败。
- 失败、自评“再记一次”或看答案回到第一阶段，约十分钟后可重新安排。不同独立轮次成功可恢复一天后的间隔；同日重复成功不连续升级，未到期的提前练习也不会推迟原到期日。
- 难词阶段根据此前任一 `again/wrong/revealed` 选择，之后的成功不抹去最初困难；错词重练只依据 `wrong/revealed`。抽查优先困难词，其余按稳定散列抽样，避免永远抽最前面几个词。同一阶段分组不会重复抽到同一个词。
- “今日接触”是有实际回忆/作答事件的不同词数；“作答接触次数”允许不同独立轮次重复，和听写正确率、自评分别展示。只浏览预览卡时的进度保存在计划里，不补造 SRS 事件。
- 跳过仅隐藏至本地次日，不改词的记忆阶段；暂停仅暂停计划，不阻止自由学习。
- 事件时间戳为 UTC，同时保存当时设备本地学习日。间隔使用日历加法，不固定加 24 小时；当前到期判断使用目前设备当地日期，跨时区旅行可能改变当地到期午夜，但不会重写原学习日。

## 进度与恢复

计划会话保存稳定 ID、日期、冻结词序与偏好、各组稳定 ID、当前组、已确认首答、已解析动态组和累计活跃时间。切换页面、暂停或重新打开后，可继续原计划；重开一轮会产生独立会话，不能把辅助重试改名为首次成功。阶段首次进入时冻结实际词序，之后云端刷新不会更换正在练习的题目。静态组最多 10–25 个词；动态组可以保存整个候选池，但实际解析后仍不超过该组限额。

历史 `reviewEvents` 是事件 ID 索引的不可变对象，字段为 `id, wordId, sessionId, mode, outcome, at, day`。跨设备按 ID 并集合并；损坏的同 ID 冲突采用规范 JSON 字典序较小的一整条，不能拼接事件字段。按时间和 ID 排序回放。`reviewPreferences` 为带更新时间的完整偏好对象，冲突取较新完整一份，避免混合两个设备的不同间隔或范围。

不静默裁剪历史。最多收集 10,000 条事件、事件 JSON 1.6 MB、整个进度 JSON 2.7 MB，保留同步 3 MB 限额余量。新增超过任一预算时明确返回 `capacity`，所有已有和待上传事件保留；自由学习仍可继续，新复习事件暂不收集。`capacity()` 同时报告剩余条数/字节和 90% 接近容量状态。高频每日练习仍会达到预算，导出本身不会释放容量，不能宣称历史无限保存。合法的超额导入历史也全部保留，交由同步容量提示处理。长期压缩/归档须另行设计可验证恢复基线，不能删掉未同步记录。

## 引擎接口

全局 `OrdrumReview` 在 `app.js` 与 `plan.js` 前载入。

- `normalise(state,data)`、`sanitiseEvents(events,validIds)`、`mergeEvents(local,incoming,validIds)`：清洗/并集合并；合法词集合可为 Set、字符串数组、词数组或 data。
- `cleanPreferences(value)`：输出 `method,targetMinutes,chunkSize,reviewLimit,newLimit,intervals,scope,paused,updatedAt`。`method` 仅 `recall/dictation/quick`。空新偏好使用 recall 30/90；已有非空旧偏好缺少限额时保持原 20/5 回退值。
- `cleanScope(value)`：输出 `{kind:'selected'|'book'|'chapters'|'notebook',chapterIds:number[],notebookChapterIds:string[]}`，去重、限长且排除危险 ID。
- `getMethods()`：防御性复制的方法数组，含名称、说明、默认限额、`targetMinutes`/`minutes`、分组大小、间隔和步骤。
- `setPreferences(state,patch,at?)`：更新时间并清洗偏好；不自动应用方法限额。
- `applyPreset(state,methodId,at?)`：显式更新方法/限额/时间/分组/间隔，保留暂停与范围，返回 `{ok,preferences}` 或 `{ok:false,reason:'method'}`。
- `record(state,{wordId,sessionId,mode,outcome,at?,day?,id?,firstAttempt?})`：真实首答追加；重复 ID 幂等；非法/超限明确返回。`firstAttempt:false` 只返回 `reason:'assisted'`，不追加事件。根应用持久化稳定轮次 ID 和首答，不能在重试时换 ID。
- `skip(state,wordId,options?)`：追加不计成绩的跳过事件。
- `schedules(state,reference?)`：词 ID 到阶段、到期、本地首次学习日、听写首答、自评和看答案计数。
- `dailyMetrics(state,reference?)`：全局本地日的 `contactedToday,answeredContacts,objectiveAttempts,objectiveCorrect,objectivePercent,revealed,selfKnown,selfAgain`。没有客观作答时百分比为 null。
- `getPlan(state,data,{now?,wordIds?})` / `buildDailyPlan(...)`：到期优先列表、限额与全局今日计数、范围内计数 `scopeNewToday/scopeReviewedToday`、下一次就绪时间、暂停/容量状态、偏好、方法、`estimatedMinutes`、`daily`。暂停时三个候选词数组为空，统计仍保留。
- `estimateMinutes(plan,preferences?)`：按上述明确假设粗估总分钟，空计划为零。
- `buildSession(plan,{id?,now?})`：纯构建固定会话；无词或暂停返回 null。包含 `id,day,method,status:'active',stageIndex:0,elapsedMs:0,createdAt,updatedAt,wordIds,newIds,dueIds,targetMinutes,chunkSize,preferences,stages,estimatedMinutes,maximumContacts`。每组包含 `id,phase,label,mode,wordIds,selector,maxWords,chunkOffset,assisted`；`phase` 为 `preview/main/retry/reinforce/test`，mode 为 `preview/flashcard/dictation`。不补造事件或直接写学习状态。
- `selectStageWords(stage,{results})`：纯解析动态组，`results` 可是 `{wordId:outcome|{outcome}|outcome[]}` 或多个这样的映射数组。根应用在首次进入组时保存解析结果，之后复用冻结词序；必须只传当前组之前的结果。
- `capacity(state)`：报告当前、最大、剩余条数/字节和 nearLimit，不删除数据。
- `mount(target,{getState,getData,getWordIds?,onChange,onStart,now?})`：保留旧版最小今日卡的兼容接口；独立新计划页面使用上述纯接口。旧设置表单后台刷新不重建草稿或移走焦点。

`OrdrumPlanCore` 提供不依赖页面的计划进度清洗与展示：

- `normalise(state,data)` 清洗 `planSessions` 与 `activePlanId`，保留有效旧计划，不按数量或年龄自动删除。`stageIndex` 由连续已完成分组计算，只有全部分组完成才允许 `completed`；暂停、主动结束与完成分别保留。
- 每组首答为 `results[stageId][wordId]={outcome,at}`；`completedStages[stageId]=true`、`resolvedStages[stageId]=wordIds`、`stageSessions[stageId]=原学习会话快照`。快照复用 `OrdrumStudy.sanitiseSession`，仅保留实际分组词。候选池最多 400 词。单设备分组默认不超过 25，但跨设备同时解析产生的合法冻结成员并集全部保留，不能截掉另一设备已作答的词。
- `decorate(record)` 返回副本与 `currentWordIds/canAdvance/progress`，不写原对象。进度区分接触、作答、自评记住、首次听写正确/错误、看答案和跳过；客观成绩按每词的实际最早非辅助听写结果计算，之后正确或辅助重练不能覆盖最初失败。仅预览的 `seen` 不算自评或听写成绩。预览组可手动确认继续；其余组须全部实际词都有合法结果，未解析的动态组不可提前完成。


## 独立页面接口

`plan.js` / `plan.css` 提供 `OrdrumPlan.mount(root, options)`。根应用在 `#plan` 与 `#study` 之间切换，将唯一的学习表面移入 `getPracticeSlot()`；计划页不复制或重建翻卡、听写节点，后台同步与计时刷新也不改写正在输入的答案或设置草稿。

- 输入回调为 `getState/getData/getWordIds/getSession`；`getWordIds` 返回主页选择范围，而非计划正在练习的临时卡组。
- 显式操作回调为 `onPreferences/onStart/onResume/onPause/onEnd/onNextStage/onReturnHome`；`onStart` 收到 `{plan,preferences,scope}`，范围包括 `kind/chapterIds/notebookChapterIds/wordIds`。
- 返回 `render/show/hide/getPracticeSlot/setPracticeSession/getDraft/destroy`。`getPracticeSlot()` 在整个挂载期间返回同一个节点；`render({force:true})` 也保护正在编辑的草稿。
- `getSession` 可返回含 `progress` 的会话副本：`contacted,total,answered,known,correct,wrong,skipped,stageDone,stageTotal,stagesDone,stagesTotal,elapsedMs`；`canAdvance` 控制完成本组，`currentWordIds` 是当前冻结分组。
- 方法预设先形成草稿，点击保存或开始时才持久化。当前计划保持原方法与冻结分组；退出设置或收到远端数据不会隐式替换一轮练习。结束本轮需要明确确认，已完成记录保留。
- 页面的「今日回忆」来源于真实复习事件的不同词数；本轮进度另有「接触」计数，可包括预览，因此两者不会冒充同一统计或掌握率。

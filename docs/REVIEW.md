# 今日计划与间隔复习

本功能从启用后的实际回忆开始记录，不用旧的“已掌握”标记补造学习次数。原学习任务和自由学习不受每日上限、暂停或历史容量影响。

## 怎样使用

1. 在书架选择书籍和章节；错题本的动态分类与固定单元也可参与今日计划。
2. 在「今日计划」点击翻卡复习或听写复习。默认在当前所选范围内每天复习最多 20 词，新安排最多 5 词，到期词排在前面。
3. 点「计划设置」可调整上限、间隔或暂停计划；计划内可「今天跳过」或「返回原进度」。练习计划时不重复显示计划入口，避免与当前轮次混淆。
4. 本轮没有立即到期词时，会显示下一次可复习的本地时间。计划设置和回忆记录自动随学习进度同步，普通任务与自由学习仍可随时使用。

## 规则

- 成功后的默认间隔为 1、3、7、14、30 个日历日；可在计划设置中修改为五个 1–365 之间递增的天数。设置变更后，按新间隔重放现有记录；这是一组可解释的初始规则，不宣称对每个词最优。
- 听写首次正确与翻卡“已记住”都可推进安排，但记录分开：翻卡自评不算听写正确率。
- 同轮次、同词、同模式只采纳时间最早的一次结果。答错或看答案后重试正确，不会将该次首次结果变成正确。重练一轮须分配新的稳定 `sessionId`。
- 错误、“再记一次”或看答案会回到第一阶段，约 10 分钟后可再次安排。不同轮次重新回忆成功可恢复一天后的间隔；同一天重复成功不连续升级，未到期的提前练习也不推迟原到期日。
- 时间戳存 UTC，同时保存当时设备的本地日历日。成功的到期日按该学习日做日历加法，不加固定 24 小时；当天是否到期按目前设备本地日期判断。因此旅行换时区可能在不同当地午夜到期，但不会把原学习日或间隔改写。默认星期不参与此规则。
- 默认每天最多新安排 5 词、复习 20 词；上限针对当前所选范围内的不同词数。到期词在前，新安排在后。今天已安排但未记住的词可以在 10 分钟后再来，不重复消耗名额。
- “今日已回忆”是今天独立轮次中至少成功回忆/自评过一次的不同词数，不是正确率。看答案和同轮错误后的重试不增加此数。
- 跳过仅隐藏至本地次日，不修改词的记忆进度；暂停仅暂停计划入口。

## 数据与合并

`state.reviewEvents` 是按唯一事件 ID 索引的不可变对象。事件字段为 `id, wordId, sessionId, mode, outcome, at, day`。模式仅 `dictation/flashcard`，结果依模式分别限制为 `correct/wrong/revealed/skip`、`known/again/skip`。新事件必须来自实际相应动作；普通预览、编辑、翻开卡片、手动档案修改不生成事件。

事件跨设备按 ID 并集，不按整份记录覆盖；如果损坏输入中同 ID 内容冲突，采用规范对象 JSON 字典序较小者，保证合并方向不影响结果。复习历史按时间、ID 排序，轮次内只使用首次结果。`reviewPreferences` 保存上限、五阶段间隔、暂停及更新时间；偏好冲突采用更新时间决定完整一份，防止将两套间隔数组拼接。

历史不静默裁剪。上限是 5,000 条事件、事件 JSON 1 MB、整个进度 JSON 2.7 MB，保留同步 3 MB 限额余量。新事件若超过任一预算，返回明确 `capacity`，保留所有已存在/尚未上传记录。学习仍继续，页面提示导出档案；此版本不自动清空历史，不将导出误称为压缩/释放容量。合并超限时仍先保留全部合法事件，由现有同步容量提示处理，避免为迎合同步限制丢失离线记录。长期历史压缩应另行设计经备份确认的带基线方案。

## 根应用集成接口

全局 `OrdrumReview` 在 `app.js` 前载入。`review.css` 使用公共样式变量。

- `normalise(state, data)`：原位添加/清洗事件和偏好，返回 state。`data.words` 为合法词 ID 范围。新旧档案、恢复、云端应用后均调用。
- `sanitiseEvents(events, validIds)`：合法事件对象；合法集合可以传 Set、字符串数组、词数组或 data。
- `mergeEvents(local, incoming, validIds)`：合法事件按 ID 并集。根应用导入与云端合并使用它。
- `record(state, {wordId, sessionId, mode, outcome, at?, day?, id?,firstAttempt?})`：原位追加，返回 `{ok,event}`；重复 ID 返回 `reason:'duplicate'`；非法返回 `reason:'invalid'`；超限返回 `reason:'capacity',message`。`firstAttempt:false` 返回 `{ok:true,reason:'assisted'}` 而不追加事件；根应用应仅在尚未有该轮首次答案时记录，旧未完成会话的辅助重试也不补成首次成功。稳定轮次 ID 必须保存在任务/自由/错词的会话快照，重试同轮不能换 ID。
- `skip(state, wordId, {at?,sessionId?,id?})`：追加无学习成绩的跳过事件；返回同 record。
- `setPreferences(state, patch, at?)`：原位更新偏好并附更新时间。
- `schedules(state, reference?)`：按词 ID 的回放结果，包括 stage/dueDay/dueAt、首次学习日、最近结果、听写主动首次作答分子分母、看答案次数和翻卡自评计数。`dueAt` 是十分钟等待的绝对毫秒，`dueDay` 是成功后的日历日期；两者仅其一非空。
- `getPlan(state,data,{now?,wordIds?})`：默认全书，也可限制当前章节/错词范围；返回 `wordIds,dueIds,newIds,availableDue,availableNew,reviewedToday,newToday,completedToday,skippedToday,remainingReview,remainingNew,paused,scopeCount,nextDueAt,historyFull,preferences,day`。暂停时三个词数组为空，原数量及进度仍可展示。
- `capacity(state)`：`{full,count,maximum}`，只报告不删数据。
- `mount(target,{getState,getData,getWordIds?,onChange,onStart,now?})`：最小今日卡。`getWordIds` 动态返回当前所选词 IDs，未传则全书。`onStart({mode,wordIds,kind:'today'})` 冻结本轮词序并用现有复习流程开启；`onChange({type:'preferences'})` 通知根应用保存。返回 `{render,destroy}`。云端/选择变化后调用 render；设置表单展开时后台 render 不重建它，保留草稿和焦点。

当出现容量错误，根应用需显示 `message`，仍保存原有任务/词状态；不能显示“所有复习事件已同步”或阻止普通学习。达到预算的时间取决于练习量与既有进度大小，导出本身不会释放容量。

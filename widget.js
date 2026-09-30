const TPL = `
<style>
  .todo-timer-widget {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: #f8f9fa;
    border-radius: 6px;
    margin-bottom: 10px;
    font-size: 14px;
  }
  .todo-timer-widget .ts {
    font-size: 18px;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
    min-width: 75px;
    color: #333;
  }
  .todo-timer-widget button {
    padding: 4px 10px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    color: white;
  }
  .todo-timer-widget .btn-start { background: #4CAF50; }
  .todo-timer-widget .btn-pause { background: #FF9800; }
  .todo-timer-widget .btn-stop { background: #f44336; }
  .todo-timer-widget .btn-reset { background: #607D8B; }
</style>
<div class="todo-timer-widget">
  <span class="ts">00:00:00</span>
  <button class="btn-start">▶ 开始</button>
  <button class="btn-pause">⏸ 暂停</button>
  <button class="btn-stop">■ 结束</button>
  <button class="btn-reset">↺ 重置</button>
</div>`;

function formatDateTime(date) {
  const p = n => n < 10 ? '0' + n : n;
  return date.getFullYear() + '-' + 
         p(date.getMonth() + 1) + '-' + 
         p(date.getDate()) + 'T' + 
         p(date.getHours()) + ':' + 
         p(date.getMinutes()) + ':' + 
         p(date.getSeconds());
}

// 格式化耗时展示（秒 -> 文本）
function formatSpentTime(totalSeconds) {
  if (totalSeconds < 60) {
    return totalSeconds + '秒';
  } else if (totalSeconds < 3600) {
    return Math.floor(totalSeconds / 60) + '分';
  } else if (totalSeconds < 86400) {
    return (totalSeconds / 3600).toFixed(1) + '小时';
  } else {
    return Math.floor(totalSeconds / 86400) + '天';
  }
}

class TodoTimerWidget extends api.NoteContextAwareWidget {
  static get parentWidget() {
    return 'note-detail-pane';
  }
  
  get position() {
    return 100;
  }
  
  isEnabled() {
    return super.isEnabled() && this.note && this.note.hasLabel && this.note.hasLabel('naritodo');
  }
  
  constructor() {
    super();
    this.contentSized();
    this._startTime = 0;       
    this._baseMs = 0;          
    this._totalSec = 0;
    this._timer = null;
  }
  // 开始按钮：将状态设置为进行中 如果实际开始时间没有则进行填充
  async _onStart() {
    if (this._startTime) return;
    
    this._startTime = Date.now();
    const nowStr = formatDateTime(new Date());

    await api.runOnBackend((noteId, nowStr) => {
      const note = api.getNote(noteId);
      if(!note) return;
      if (!note.getLabel('actualStartTime')) {
        note.setLabel('actualStartTime', nowStr);
      }
      note.setLabel('status', '进行中');
      note.save();
    }, [this.note.noteId, nowStr]);

    this._timer = setInterval(() => this._renderTime(), 1000);
    this._renderTime();
  }

  async _onPause() {
    if (!this._startTime) return;
    
    this._baseMs += Date.now() - this._startTime;
    this._startTime = 0;
    clearInterval(this._timer);
    this._renderTime();
    // 暂停仅停留在内存，结束/归档时才持久化到 spentTimes
  }

  async _onStop() {
    if (this._startTime) {
      this._baseMs += Date.now() - this._startTime;
      this._startTime = 0;
    }
    clearInterval(this._timer);

    if (this._baseMs < 1000 && this._totalSec === 0) return;

    // 计算总秒数
    const addedSec = Math.floor(this._baseMs / 1000);
    const newTotalSec = this._totalSec + addedSec;
    const formatted = formatSpentTime(newTotalSec);
    const nowStr = formatDateTime(new Date());

    await api.runOnBackend((noteId, nowStr, newTotalSec, formatted) => {
      const note = api.getNote(noteId);
      if(!note) return;
      note.setLabel('actualEndTime', nowStr);
      note.setLabel('spentTimes', String(newTotalSec));
      note.setLabel('spentTime', formatted);
      note.setLabel('status', '已完成');
      note.setLabel('archived');
      note.save();
    }, [this.note.noteId, nowStr, newTotalSec, formatted]);

    this._totalSec = newTotalSec;
    this._baseMs = 0;
    this.$ts.text('00:00:00');
  }

  async _onReset() {
    // 仅清零计数器，其余（标签、历史用时）一律不动
    this._startTime = 0;
    this._baseMs = 0;
    clearInterval(this._timer);
    this.$ts.text('00:00:00');
  }

  _renderTime() {
    let ms = this._totalSec * 1000 + this._baseMs;
    if (this._startTime) {
      ms += Date.now() - this._startTime;
    }
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    const p = n => n < 10 ? '0' + n : n;
    if(this.$ts) this.$ts.text(p(h) + ':' + p(m) + ':' + p(x));
  }

  doRender() {
    this.$widget = $(TPL);
    this.$ts = this.$widget.find('.ts');

    this.$widget.find('.btn-start').on('click', () => this._onStart());
    this.$widget.find('.btn-pause').on('click', () => this._onPause());
    this.$widget.find('.btn-stop').on('click', () => this._onStop());
    this.$widget.find('.btn-reset').on('click', () => this._onReset());

    return this.$widget;
  }

  async refreshWithNote(note) {
    clearInterval(this._timer);
    this._timer = null;
    this._startTime = 0;
    this._baseMs = 0;
    
    // 读取历史累计秒数
    this._totalSec = Number(note.getLabelValue('spentTimes') || '0');
    this._renderTime();
  }
}

module.exports = TodoTimerWidget;

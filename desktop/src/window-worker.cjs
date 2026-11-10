// One active operation per renderer. Cancellation/timeout destroys the actual
// renderer, so abandoned work cannot mutate a later request's state.
class WindowWorker {
  constructor(createWindow, timeoutMs = 60000) {
    this.createWindow = createWindow;
    this.timeoutMs = timeoutMs;
    this.queue = [];
    this.active = null;
    this.window = null;
  }
  run(payload, owner) {
    if (this.queue.length >= 100) return Promise.reject(new Error('Render queue is full'));
    return new Promise((resolve, reject) => {
      this.queue.push({ payload, owner, resolve, reject });
      this.pump();
    });
  }
  cancelOwner(owner, reason = 'Render canceled') {
    const keep = [];
    for (const job of this.queue) {
      if (job.owner === owner) job.reject(new Error(reason));
      else keep.push(job);
    }
    this.queue = keep;
    if (this.active?.owner === owner) this.active.fail(new Error(reason), true);
  }
  dispose() {
    for (const job of this.queue.splice(0)) job.reject(new Error('Render host disposed'));
    this.active?.fail(new Error('Render host disposed'), true);
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }
  async pump() {
    if (this.active || !this.queue.length) return;
    const job = this.queue.shift();
    let settled = false;
    const finish = (error, value, destroy = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (destroy && this.window) {
        const old = this.window;
        this.window = null;
        if (!old.isDestroyed()) old.destroy();
      }
      this.active = null;
      error ? job.reject(error) : job.resolve(value);
      queueMicrotask(() => this.pump());
    };
    const timer = setTimeout(() => finish(new Error('Render timed out'), null, true), this.timeoutMs);
    this.active = { ...job, fail: (error, destroy) => finish(error, null, destroy) };
    try {
      if (!this.window || this.window.isDestroyed()) {
        const worker = this.createWindow();
        this.window = worker;
        worker.webContents.on('render-process-gone', () => {
          if (this.window === worker) this.active?.fail(new Error('Render host crashed'), true);
        });
        worker.on('closed', () => {
          if (this.window === worker) {
            this.window = null;
            this.active?.fail(new Error('Render host closed'), false);
          }
        });
        await worker.ready;
      }
      if (settled) return;
      const result = await this.window.webContents.executeJavaScript(`window.renderHost(${JSON.stringify(job.payload)})`);
      finish(null, result);
    } catch (error) { finish(error, null, true); }
  }
}
module.exports = { WindowWorker };

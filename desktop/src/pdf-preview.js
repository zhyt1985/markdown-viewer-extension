window.createDesktopPdfPreview = (api, bindUi) => {
  const byId = id => document.getElementById(id);
  const dialog = byId('export-dialog'), panel = byId('export-pdf'), options = byId('pdf-options');
  const margin = byId('pdf-margin'), start = byId('pdf-preview-start'), save = byId('export-start');
  const previous = byId('pdf-preview-previous'), next = byId('pdf-preview-next');
  const status = byId('pdf-preview-status'), surface = byId('pdf-preview-surface');
  let enabled = false, slide = false, running, result, library;

  const layout = () => slide ? undefined : {
    paper: byId('pdf-paper').value, orientation: byId('pdf-orientation').value, margin: margin.valueAsNumber,
  };
  const identity = selected => selected && `${selected.documentId}:${selected.documentVersion}`;
  const valid = () => slide || margin.validity.valid;
  function controls() {
    start.disabled = Boolean(running) || !valid() || !api().state().preview.current;
    save.disabled = Boolean(running) || (enabled && (!valid() || !api().state().preview.current));
    previous.hidden = next.hidden = !result?.page;
    previous.disabled = Boolean(result?.paint) || !result?.page || result.page === 1;
    next.disabled = Boolean(result?.paint) || !result?.page || result.page === result.document.numPages;
  }
  function reset() {
    if (running && !running.canceled) {
      running.canceled = true;
      void window.desktop.cancelPdfPreview(running.requestId).catch(console.error);
    }
    if (result) {
      result.paint?.cancel();
      void result.loading.destroy().catch(console.error);
      result = null;
      // A canceled page renderer must never paint into the next preview's canvas.
      const old = byId('pdf-preview-canvas');
      const replacement = old.cloneNode(false);
      replacement.removeAttribute('width');
      replacement.removeAttribute('height');
      old.replaceWith(replacement);
    }
    surface.hidden = true;
    bindUi(status, '');
    controls();
  }
  async function draw(job, number) {
    if (result !== job || job.paint) return;
    // Guard from the moment getPage starts, not just while it paints.
    job.paint = { cancel() {} };
    controls();
    try {
      const page = await job.document.getPage(number);
      if (result !== job) return;
      const view = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(1200 / view.width, 1000 / view.height) });
      const target = byId('pdf-preview-canvas');
      target.width = Math.ceil(viewport.width);
      target.height = Math.ceil(viewport.height);
      job.paint = page.render({ canvas: target, viewport });
      await job.paint.promise;
      if (result !== job) return;
      job.page = number;
      surface.hidden = false;
      bindUi(status, '第 {0} / {1} 页', number, job.document.numPages);
    } finally {
      job.paint = null;
      if (result === job) controls();
    }
  }
  function report(error) {
    reset();
    bindUi(status, '分页预览失败：{0}', error.message || error);
  }
  start.onclick = async () => {
    const selected = api().state().document;
    if (!enabled || !selected || start.disabled) return;
    reset();
    const job = { requestId: crypto.randomUUID(), document: identity(selected) };
    running = job;
    controls();
    bindUi(status, '正在生成分页预览…');
    try {
      const response = await window.desktop.exportDocument({
        format: 'pdf', documentId: selected.documentId, documentVersion: selected.documentVersion,
        pdfOptions: layout(), previewRequest: job.requestId,
      });
      if (job.canceled || response.canceled) return;
      library ||= import('./pdfjs/pdf.min.mjs').then(pdf => {
        pdf.GlobalWorkerOptions.workerSrc = new URL('./assets/pdfjs/pdf.worker.min.mjs', location.href).href;
        return pdf;
      }).catch(error => { library = null; throw error; });
      const pdf = await library;
      if (job.canceled) return;
      const loading = pdf.getDocument({ data: new Uint8Array(response.data), isEvalSupported: false, useWasm: false });
      const entry = { id: response.id, source: job.document, loading };
      result = entry;
      entry.document = await loading.promise;
      if (result === entry) await draw(entry, 1);
    } catch (error) { if (!job.canceled) report(error); }
    finally {
      if (running === job) running = null;
      controls();
    }
  };
  const step = delta => {
    const job = result;
    if (job?.page) void draw(job, job.page + delta).catch(error => { if (result === job) report(error); });
  };
  previous.onclick = () => step(-1);
  next.onclick = () => step(1);
  options.addEventListener('input', reset);
  dialog.addEventListener('close', () => { enabled = false; reset(); });
  document.addEventListener('desktop:changed', () => {
    if (!enabled || !dialog.open) return;
    const source = identity(api().state().document);
    if ((running && running.document !== source) || (result && result.source !== source)) reset();
    else controls();
  });
  return {
    sync(selected) {
      const wasEnabled = enabled;
      enabled = Boolean(selected);
      slide = Boolean(selected?.slidev);
      panel.hidden = !enabled;
      options.hidden = slide;
      if (wasEnabled && !enabled) reset();
      else controls();
    },
    selection() {
      const selected = api().state().document;
      return { pdfOptions: layout(), previewId: result?.source === identity(selected) ? result?.id : undefined };
    },
  };
};

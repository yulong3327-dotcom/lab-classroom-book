export const lessons = {
  physics: {
    subject: '物理 · 电学',
    title: '探究电流与电压的关系',
    url: './lab/platform/player.html?id=current-voltage&mode=guided',
    freeUrl: './lab/platform/player.html?id=current-voltage',
    summary: '保持定值电阻不变，改变其两端的电压，观察流过它的电流如何变化。',
    instruments: ['直流电源', '开关', '电流表', '电压表', '定值电阻', '滑动变阻器', '导线'],
    steps: ['组装电路和测量支路。', '调节滑动变阻器，记录三组电压和电流。', '查看 I–U 图，比较各组电压与电流的关系。'],
  },
  chemistry: {
    subject: '化学 · 气体制取',
    title: '高锰酸钾分解制取氧气',
    url: './lab/',
    video: './media/oxygen-animation.mp4',
    summary: '组装制氧装置，观察气泡和水面变化，用排水法收集氧气。',
    instruments: ['铁架台', '试管', '酒精灯', '带塞导管', '水槽', '集气瓶', '毛巾', '火柴', '棉花', '带火星的木条'],
    reagents: '药品　高锰酸钾',
    steps: ['组装装置并检查气密性。', '添加药品、预热装置并观察气泡。', '收集氧气并检验气体。'],
  },
};

const art = {
  flask: [[[-12, -34], [12, -34]], [[-8, -34], [-8, -10], [-31, 29], [-27, 33], [27, 33], [31, 29], [8, -10], [8, -34]], [[-19, 12], [-10, 10], [9, 14], [19, 12]]],
  circuit: [[[-30, 18], [-30, -20], [28, -20], [28, -6]], [[28, 6], [28, 20], [5, 20]], [[-5, 20], [-30, 20]], [[5, 9], [5, 31]], [[-5, 14], [-5, 26]], [[22, -6], [34, -6], [34, 6], [22, 6], [22, -6]]],
};

function drawLineField(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  const scale = Math.min(width, height) / 90;
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(scale, scale);
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const path of art[canvas.dataset.lineField]) {
    ctx.beginPath();
    path.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.stroke();
  }
  ctx.restore();
  const { data } = ctx.getImageData(0, 0, width, height);
  ctx.clearRect(0, 0, width, height);
  const tile = width > 200 ? 7 : 4;
  const widths = [1, 2, 3, 4];
  ctx.fillStyle = canvas.closest('.book-entry') ? '#2152e7' : '#e5eeff';
  for (let y = 1; y < height - tile; y += tile) {
    for (let x = 1; x < width - tile; x += tile) {
      let opacity = 0;
      for (let dy = 0; dy < tile; dy++) {
        for (let dx = 0; dx < tile; dx++) opacity += data[((y + dy) * width + x + dx) * 4 + 3];
      }
      const density = opacity / (255 * tile * tile);
      const lineWidth = widths[Math.min(3, Math.floor(density * 3.3))];
      ctx.globalAlpha = density < .06 ? .16 : 1;
      ctx.fillRect(x + (tile - lineWidth) / 2, y, lineWidth, tile - 1);
    }
  }
  ctx.globalAlpha = 1;
}

export function setupExperimentBook(onStart) {
  const el = id => document.getElementById(id);
  const dialog = el('experiment-book');
  const index = el('book-index');
  const details = el('book-details');
  const video = el('book-video-player');
  const videoPlaceholder = el('book-video-placeholder');
  const videoMessage = videoPlaceholder.firstElementChild;
  const entryButtons = [...dialog.querySelectorAll('[data-experiment]')];
  let current = null;
  let trigger = null;

  function clearVideo() {
    if (!video.hasAttribute('src')) return;
    video.pause();
    video.removeAttribute('src');
    video.load();
  }

  function setVideo(source) {
    video.hidden = !source;
    videoPlaceholder.hidden = Boolean(source);
    videoMessage.textContent = '视频待补充';
    if (source) video.src = source;
  }

  video.addEventListener('error', () => {
    if (!video.hasAttribute('src') || !video.error) return;
    video.hidden = true;
    videoMessage.textContent = '视频暂时无法播放';
    videoPlaceholder.hidden = false;
  });

  function show(view) {
    dialog.dataset.view = view;
    index.hidden = view !== 'index';
    details.hidden = view !== 'detail';
    el('book-back').hidden = view !== 'detail';
    dialog.setAttribute('aria-labelledby', view === 'index' ? 'book-index-title' : 'book-title');
    if (view === 'index') {
      clearVideo();
      index.scrollTop = 0;
    }
    if (view === 'detail') details.scrollTop = 0;
  }
  function fillList(node, values) {
    node.replaceChildren(...values.map(value => {
      const item = document.createElement('li');
      item.textContent = value;
      return item;
    }));
  }

  dialog.querySelectorAll('canvas[data-line-field]').forEach(drawLineField);
  for (const button of entryButtons) button.addEventListener('click', () => {
    current = button;
    const lesson = lessons[button.dataset.experiment];
    el('book-subject').textContent = lesson.subject;
    el('book-title').textContent = lesson.title;
    el('book-summary').textContent = lesson.summary;
    el('book-reagents').textContent = lesson.reagents || '';
    el('book-reagents').hidden = !lesson.reagents;
    el('book-free').hidden = !lesson.freeUrl;
    fillList(el('book-instruments'), lesson.instruments);
    fillList(el('book-steps'), lesson.steps);
    setVideo(lesson.video);
    show('detail');
    el('book-title').focus({ preventScroll: true });
  });
  el('book-back').addEventListener('click', () => {
    show('index');
    current?.focus();
  });
  for (const button of dialog.querySelectorAll('[data-book-close]')) button.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    clearVideo();
    trigger?.focus({ preventScroll: true });
    trigger = null;
  });
  function start(mode) {
    if (!current) return;
    trigger = null;
    dialog.close();
    onStart(current.dataset.experiment, mode);
  }
  el('book-start').addEventListener('click', () => start('guided'));
  el('book-free').addEventListener('click', () => start('free'));

  return {
    get open() { return dialog.open; },
    dismiss() {
      if (dialog.open) {
        trigger = null;
        dialog.close();
      }
    },
    show(source, subject) {
      if (dialog.open) return;
      trigger = source;
      current = null;
      const first = entryButtons.find(button => button.dataset.experiment === subject);
      if (first) first.parentElement.prepend(first);
      show('index');
      dialog.showModal();
      el('book-index-title').focus({ preventScroll: true });
    },
  };
}

import * as THREE from './lab/vendor/three-r160/three.module.min.js';
import { createClassroom } from './scene.js';
import { createWalker } from './movement.js';
import { lessons, setupExperimentBook } from './experiment-book.js';

const el = id => document.getElementById(id);
const room = el('classroom');
const canvas = el('view');
const help = el('help');
let experiment = el('experiment');
const lab = el('lab');
const stations = {
  physics: { name: '物理实验台', accent: '#77c8ff' },
  chemistry: { name: '化学实验台', accent: '#ffd58e' },
};

function icons() { window.lucide?.createIcons(); }
if (document.readyState === 'complete') icons();
else window.addEventListener('load', icons, { once: true });

try {
  startClassroom();
} catch (error) {
  el('status').textContent = '无法启动 3D 教室，请检查浏览器的 WebGL 支持。';
  el('status').hidden = false;
  console.error(error);
}

function startClassroom() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.16;
  const scene = new THREE.Scene();
  const { benches, obstacles } = createClassroom(scene);
  const { player, jump, advance } = createWalker(obstacles);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.05, 52);
  let eye = 1.62;
  camera.position.set(player.x, eye, player.z);
  camera.rotation.order = 'YXZ';
  let yaw = 0;
  let pitch = -0.105;
  let selected = null;
  let active = null;
  let opening = null;
  let openBook = null;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const book = setupExperimentBook(openExperiment);
  const coarse = matchMedia('(pointer: coarse)');
  let inputMode = 'auto';
  let touchMode = coarse.matches;
  room.dataset.touch = String(touchMode);
  const sizeButtons = [...help.querySelectorAll('[data-size]')];
  let controlSize = 'standard';
  try { controlSize = localStorage.getItem('lab-control-size') || controlSize; } catch { /* Storage is optional. */ }
  if (!sizeButtons.some(button => button.dataset.size === controlSize)) controlSize = 'standard';
  setControlSize(controlSize);

  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const labelPoint = new THREE.Vector3();
  const bookPoint = new THREE.Vector3();
  const labels = benches.map(bench => ({ bench, label: el(`marker-${bench.id}`) }));
  const tables = benches.map(bench => bench.tabletop);
  const bookTargets = benches.map(bench => bench.hit);
  const keys = new Set();
  const controls = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyC', 'Space', 'ShiftLeft', 'ShiftRight', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
  const move = new THREE.Vector2();
  const stick = new THREE.Vector2();
  const clamp = THREE.MathUtils.clamp;
  let aimPointer = null;
  let lookDrag = null;
  let joystickPointer = null;
  let joystickOrigin = null;
  let lastForwardTap = -Infinity;
  let forwardBurst = false;
  let touchSprint = false;
  const jumpButton = el('jump');
  const sprintButton = el('sprint');
  let width = 1, height = 1;

  function resize() {
    const oldWidth = width, oldHeight = height;
    ({ width, height } = room.getBoundingClientRect());
    if (!width || !height) return;
    if (oldWidth !== width || oldHeight !== height) {
      if (joystickPointer !== null) resetJoystick();
      lookDrag = null;
      aimPointer = null;
    }
    camera.aspect = width / height;
    camera.fov = Math.max(55, Math.min(101, 2 * Math.atan(Math.tan(58 * Math.PI / 360) / camera.aspect) * 180 / Math.PI));
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65));
    renderer.setSize(width, height, false);
  }
  new ResizeObserver(resize).observe(room);
  resize();

  function changeLook(x, y, factor) {
    yaw = (yaw - x * factor) % (2 * Math.PI);
    pitch = clamp(pitch - y * factor, -1.32, 1.32);
  }
  function stopInput() {
    keys.clear();
    lastForwardTap = -Infinity;
    forwardBurst = false;
    setTouchSprint(false);
    lookDrag = null;
    aimPointer = null;
    resetJoystick();
  }
  function handoffInput() {
    stopInput();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  }
  window.addEventListener('blur', stopInput);
  document.addEventListener('visibilitychange', stopInput);
  document.addEventListener('pointerlockchange', () => { aimPointer = null; });

  function distance(bench) { return Math.hypot(camera.position.x - bench.x, camera.position.z - bench.z); }
  function near(bench) { return player.grounded && distance(bench) < 2.75; }
  function cast(pos) {
    camera.updateMatrixWorld();
    ray.setFromCamera(pos, camera);
    const hit = ray.intersectObjects(bookTargets, false)[0];
    if (!hit) return null;
    const bench = benches.find(item => item.hit === hit.object);
    const blocker = ray.intersectObjects(tables, false)[0];
    return near(bench) && (!blocker || hit.distance <= blocker.distance) ? bench : null;
  }
  function viewPoint(x, y) {
    const rect = canvas.getBoundingClientRect();
    return new THREE.Vector2(2 * (x - rect.left) / rect.width - 1, 1 - 2 * (y - rect.top) / rect.height);
  }
  function chooseStation() {
    if (!player.grounded || opening || book.open || help.open) return null;
    const centerTarget = cast(pointer.set(0, 0));
    if (centerTarget) return centerTarget;
    if (aimPointer && !document.pointerLockElement) {
      const hover = cast(aimPointer);
      if (hover) return hover;
    }
    let closest = null;
    let best = Infinity;
    for (const bench of benches) {
      const length = distance(bench);
      if (length >= 2.45 || length >= best) continue;
      const bearing = ((bench.x - camera.position.x) * -Math.sin(yaw) + (bench.z - camera.position.z) * -Math.cos(yaw)) / (length || 1);
      bench.hit.getWorldPosition(bookPoint).project(camera);
      if (bearing > 0.64 && Math.abs(bookPoint.x) < .88 && Math.abs(bookPoint.y) < .85) { closest = bench; best = length; }
    }
    return closest;
  }
  function updateStation() {
    const target = chooseStation();
    const locked = document.pointerLockElement === canvas;
    canvas.style.cursor = !touchMode && !locked && aimPointer && cast(aimPointer) ? 'pointer' : '';
    if (target) {
      target.hit.getWorldPosition(bookPoint).project(camera);
      const hint = el('station');
      hint.style.left = `${(bookPoint.x + 1) * width / 2}px`;
      hint.style.top = `${(1 - bookPoint.y) * height / 2}px`;
    }
    if (target === selected && room.dataset.locked === String(locked) && room.dataset.input === String(touchMode)) return;
    selected = target;
    room.dataset.locked = String(locked);
    room.dataset.input = String(touchMode);
    room.dataset.target = String(Boolean(target));
    el('station').hidden = !target;
    if (target) {
      el('station-name').textContent = stations[target.id].name;
      room.style.setProperty('--target-color', stations[target.id].accent);
      el('book-hint').textContent = touchMode ? '点实验册' : '点实验册 / E';
    }
    for (const bench of benches) bench.outline.visible = bench === target;
  }
  function updateLabels() {
    for (const { bench, label } of labels) {
      labelPoint.set(bench.x, 1.53, bench.z).project(camera);
      const visible = labelPoint.z > -1 && labelPoint.z < 1 && Math.abs(labelPoint.x) < 1.17 && Math.abs(labelPoint.y) < 0.78 && distance(bench) > 1.35 && bench !== selected;
      label.hidden = !visible;
      if (!visible) continue;
      label.style.left = `${clamp((labelPoint.x + 1) * width / 2, 39, width - 39)}px`;
      label.style.top = `${(1 - labelPoint.y) * height / 2}px`;
    }
  }

  function openStation(bench) {
    if (!bench || active || help.open || book.open || opening || !near(bench)) return;
    handoffInput();
    openBook = bench;
    opening = { bench, start: performance.now(), duration: reducedMotion.matches ? 0 : 410 };
  }
  function closeBookModel() {
    if (!openBook) return;
    openBook.leaf.rotation.z = 0;
    openBook = null;
    opening = null;
  }
  el('experiment-book').addEventListener('close', closeBookModel);
  function openExperiment(id, mode, push = true) {
    const lesson = lessons[id];
    if (!lesson || active) return;
    book.dismiss();
    closeBookModel();
    active = id;
    handoffInput();
    el('load-error').hidden = true;
    room.inert = true;
    lab.hidden = false;
    el('lab-title').textContent = lesson.title;
    if (push) history.pushState({ station: id, mode }, '', `#${id}`);
    replaceExperiment(mode === 'free' && lesson.freeUrl ? lesson.freeUrl : lesson.url);
    el('back').focus({ preventScroll: true });
  }
  function closeStation() {
    if (!active) return;
    active = null;
    lab.hidden = true;
    replaceExperiment();
    room.inert = false;
    canvas.focus({ preventScroll: true });
  }
  window.addEventListener('popstate', event => {
    if (!event.state?.station) closeStation();
    else if (!active) openExperiment(event.state.station, event.state.mode, false);
  });
  if (Object.hasOwn(stations, location.hash.slice(1))) history.replaceState(null, '', location.pathname + location.search);
  el('back').addEventListener('click', () => {
    if (history.state?.station) history.back();
    else closeStation();
  });
  function replaceExperiment(url) {
    // A fresh frame keeps an earlier experiment's navigation out of browser Back.
    const next = experiment.cloneNode(false);
    if (url) {
      next.src = url;
      next.addEventListener('load', () => {
        if (!active || next !== experiment) return;
        const content = next.contentDocument;
        if (!content || content.URL === 'about:blank') return;
        el('load-error').hidden = Boolean(content.querySelector('canvas'));
      });
    } else next.removeAttribute('src');
    experiment.replaceWith(next);
    experiment = next;
  }
  function bindAction(button, act) {
    // A second finger can press an action while the first keeps the joystick held.
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      act();
    });
    button.addEventListener('click', event => { if (event.detail === 0) act(); });
  }
  bindAction(jumpButton, () => { if (!active && !help.open && !book.open && !opening) jump(); });
  bindAction(sprintButton, () => { if (!opening && !book.open) setTouchSprint(!touchSprint); });
  el('controls').addEventListener('click', () => { if (!opening) { handoffInput(); help.showModal(); } });
  el('close-help').addEventListener('click', () => help.close());
  const modeButtons = [...help.querySelectorAll('[data-mode]')];
  for (const button of modeButtons) button.addEventListener('click', () => {
    inputMode = button.dataset.mode;
    setTouch(inputMode === 'touch' || (inputMode === 'auto' && coarse.matches));
    for (const item of modeButtons) item.setAttribute('aria-pressed', String(item === button));
    help.close();
  });
  for (const button of sizeButtons) button.addEventListener('click', () => {
    resetJoystick();
    setControlSize(button.dataset.size);
    try { localStorage.setItem('lab-control-size', controlSize); } catch { /* Storage is optional. */ }
    help.close();
  });
  coarse.addEventListener('change', event => { if (inputMode === 'auto') setTouch(event.matches); });

  function setControlSize(value) {
    controlSize = value;
    room.dataset.size = value;
    for (const item of sizeButtons) item.setAttribute('aria-pressed', String(item.dataset.size === value));
  }
  function setTouch(value) {
    if (value === touchMode) return;
    touchMode = value;
    room.dataset.touch = String(value);
    if (!value) { resetJoystick(); setTouchSprint(false); }
  }
  function setTouchSprint(value) {
    touchSprint = value;
    sprintButton.setAttribute('aria-pressed', String(value));
  }
  function keyDown(event) {
    if (opening && event.code === 'Escape') closeBookModel();
    if (active || help.open || book.open || opening || !controls.has(event.code)) return;
    if (event.code === 'Space' && event.target instanceof HTMLButtonElement) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    keys.add(event.code);
    if (event.code === 'Space' && !event.repeat) jump();
    if (event.code === 'KeyW' && !event.repeat) {
      const now = performance.now();
      forwardBurst = now - lastForwardTap < 300;
      lastForwardTap = now;
    }
    if (event.code === 'KeyE' && !event.repeat) openStation(chooseStation());
  }
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', event => {
    keys.delete(event.code);
    if (event.code === 'KeyW') forwardBurst = false;
  });
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  document.addEventListener('mousemove', event => {
    if (!book.open && !opening && document.pointerLockElement === canvas) changeLook(event.movementX, event.movementY, 0.00215);
  });

  canvas.addEventListener('pointerdown', event => {
    if (active || help.open || book.open || opening) return;
    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      if (inputMode === 'auto') setTouch(true);
      if (lookDrag) return;
      lookDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: 0, touch: true };
      canvas.setPointerCapture(event.pointerId);
      return;
    }
    if (inputMode === 'auto' && !coarse.matches) setTouch(false);
    if (event.button === 2 && !document.pointerLockElement) {
      lookDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: 0, touch: false };
      canvas.setPointerCapture(event.pointerId);
    }
    if (event.button !== 0) return;
    const locked = document.pointerLockElement === canvas;
    const station = cast(locked ? pointer.set(0, 0) : viewPoint(event.clientX, event.clientY));
    if (station) openStation(station);
    else if (!locked && canvas.requestPointerLock) {
      try { canvas.requestPointerLock()?.catch(() => {}); } catch { /* Arrow keys and drag also work. */ }
    }
  });
  canvas.addEventListener('pointermove', event => {
    if (lookDrag?.id === event.pointerId) {
      const dx = event.clientX - lookDrag.x;
      const dy = event.clientY - lookDrag.y;
      lookDrag.x = event.clientX;
      lookDrag.y = event.clientY;
      lookDrag.moved += Math.hypot(dx, dy);
      changeLook(dx, dy, lookDrag.touch ? 0.0047 : 0.0031);
      aimPointer = null;
    } else if (event.pointerType === 'mouse' && !document.pointerLockElement) aimPointer = viewPoint(event.clientX, event.clientY);
  });
  canvas.addEventListener('pointerleave', () => { aimPointer = null; });
  canvas.addEventListener('pointerup', event => {
    if (lookDrag?.id !== event.pointerId) return;
    const tap = lookDrag.touch && lookDrag.moved < 9;
    lookDrag = null;
    if (tap) openStation(cast(viewPoint(event.clientX, event.clientY)));
  });
  const cancelLook = event => { if (lookDrag?.id === event.pointerId) lookDrag = null; };
  canvas.addEventListener('pointercancel', cancelLook);
  canvas.addEventListener('lostpointercapture', cancelLook);

  const joystick = el('joystick');
  const knob = el('stick');
  function updateJoystick(event) {
    const { x, y, travel } = joystickOrigin;
    stick.set(event.clientX - x, event.clientY - y).clampLength(0, travel);
    knob.style.transform = `translate(calc(-50% + ${stick.x}px), calc(-50% + ${stick.y}px))`;
    stick.divideScalar(travel);
    if (stick.length() < 0.14) stick.set(0, 0);
  }
  function resetJoystick() {
    const pointerId = joystickPointer;
    joystickPointer = null;
    joystickOrigin = null;
    if (pointerId !== null && joystick.hasPointerCapture(pointerId)) joystick.releasePointerCapture(pointerId);
    stick.set(0, 0);
    knob.style.transform = '';
    joystick.dataset.held = 'false';
  }
  joystick.addEventListener('pointerdown', event => {
    if (joystickPointer !== null || event.button !== 0) return;
    event.preventDefault();
    const rect = joystick.getBoundingClientRect();
    joystickOrigin = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      travel: Math.max(1, (rect.width - knob.offsetWidth) / 2 - 3),
    };
    joystickPointer = event.pointerId;
    joystick.dataset.held = 'true';
    joystick.setPointerCapture(event.pointerId);
    updateJoystick(event);
  });
  joystick.addEventListener('pointermove', event => { if (joystickPointer === event.pointerId) updateJoystick(event); });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    joystick.addEventListener(name, event => { if (joystickPointer === event.pointerId) resetJoystick(); });
  }

  let last = null;
  renderer.setAnimationLoop(time => {
    const dt = Math.min((time - (last ?? time)) / 1000, 0.05);
    last = time;
    if (active) return;
    const on = key => Number(keys.has(key));
    if (opening) {
      const { bench, start, duration } = opening;
      const fraction = duration ? clamp((time - start) / duration, 0, 1) : 1;
      bench.leaf.rotation.z = Math.PI * (1 - (1 - fraction) ** 3);
      if (fraction === 1) {
        opening = null;
        book.show(canvas, bench.id);
      }
    }
    if (!help.open && !book.open && !opening) {
      move.set(on('KeyD') - on('KeyA') + stick.x, on('KeyW') - on('KeyS') - stick.y).clampLength(0, 1);
      changeLook(on('ArrowRight') - on('ArrowLeft'), on('ArrowDown') - on('ArrowUp'), 1.68 * dt);
      const sprint = touchSprint || forwardBurst || keys.has('ShiftLeft') || keys.has('ShiftRight');
      const crouch = keys.has('KeyC');
      advance(dt, move.x, move.y, yaw, sprint, crouch);
      eye = THREE.MathUtils.damp(eye, crouch ? 1.29 : 1.62, 18, dt);
    }
    camera.position.set(player.x, player.height + eye, player.z);
    camera.rotation.set(pitch, yaw, 0);
    const grounded = String(player.grounded);
    if (room.dataset.grounded !== grounded) room.dataset.grounded = grounded;
    if (room.dataset.stride !== player.stride) room.dataset.stride = player.stride;
    updateStation();
    updateLabels();
    renderer.render(scene, camera);
  });
}

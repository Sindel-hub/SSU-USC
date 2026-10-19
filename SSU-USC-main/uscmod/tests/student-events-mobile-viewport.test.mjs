import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../dashboard/js/events-section-scroll.js', import.meta.url), 'utf8');
function page({ height = 640, reducedMotion = false, missing = false } = {}) {
  const listeners = {}, properties = {}, calls = [], animations = new Map();
  let clock = 0, animationId = 0;
  const frame = {
    clientHeight: height, scrollHeight:height * 3, clientTop: 1, scrollTop: 0,
    addEventListener(name, handler) { listeners[name] = handler; },
    closest() { return null; },
    getBoundingClientRect: () => ({ top: 190 }),
    style: { setProperty: (name, value) => { properties[name] = value; } },
    scrollTo(options) { calls.push(options); this.scrollTop = options.top; }
  };
  const nodes = {
    eventsPageMain: frame,
    eventsHighlightSection: { getBoundingClientRect: () => ({ top: 191 - frame.scrollTop }) },
    eventsUpcomingSection: { getBoundingClientRect: () => ({ top: 191 + Math.max(320, parseInt(properties['--events-frame-height'] || height)) - frame.scrollTop }) },
    eventsScrollDown: { addEventListener: (_, handler) => { listeners.down = handler; } },
    eventsScrollUp: { addEventListener: (_, handler) => { listeners.up = handler; } }
  };
  let onResize;
  vm.runInNewContext(code, {
    document: { getElementById: id => missing ? null : nodes[id] },
    matchMedia: () => ({ matches: reducedMotion }),
    ResizeObserver: class { constructor(handler) { onResize = handler; } observe() {} },
    performance: { now: () => clock },
    requestAnimationFrame: callback => { animations.set(++animationId, callback); return animationId; },
    cancelAnimationFrame: id => animations.delete(id),
    getComputedStyle: element => ({ overflowY: element.overflowY || 'visible' })
  });
  const tick = () => {
    clock += 16;
    for (const [id, callback] of [...animations]) { animations.delete(id); callback(clock); }
  };
  const finish = () => { for (let i = 0; animations.size && i < 200; i++) tick(); assert.equal(animations.size, 0); };
  const wheel = options => {
    let prevented = false;
    listeners.wheel({ target:frame, deltaY:100, deltaX:0, deltaMode:0, cancelable:true, preventDefault() { prevented = true; }, ...options });
    return prevented;
  };
  return { frame, properties, calls, listeners, tick, finish, wheel, resize: () => onResize?.() };
}

test('highlight sizing follows the actual content frame on phones and desktops', () => {
  for (const height of [366, 642, 742]) {
    const { properties } = page({ height });
    assert.equal(properties['--events-frame-height'], `${height}px`);
  }
});

test('jump controls scroll the module to exact section boundaries without moving the document', () => {
  const { frame, calls, listeners } = page();
  listeners.down();
  assert.equal(frame.scrollTop, 640);
  assert.equal(calls[0].behavior, 'smooth');
  frame.scrollTop = 900; // after reading a long list
  listeners.up();
  assert.equal(frame.scrollTop, 0);
});

test('resizing at Upcoming preserves the chapter, while an arbitrary reading position stays put', () => {
  const { frame, properties, resize } = page();
  frame.scrollTop = 640;
  frame.clientHeight = 400;
  resize();
  assert.equal(properties['--events-frame-height'], '400px');
  assert.equal(frame.scrollTop, 400);
  frame.scrollTop = 920;
  frame.clientHeight = 600;
  resize();
  assert.equal(frame.scrollTop, 920);
});

test('reduced motion disables animated shortcut scrolling', () => {
  const { calls, listeners } = page({ reducedMotion: true });
  listeners.down();
  assert.equal(calls[0].behavior, 'instant');
});

test('missing Events markup does not install navigation or throw', () => {
  assert.deepEqual(page({ missing: true }).calls, []);
});

// Short viewports retain enough room for the full highlight content.
test('chapter destinations use actual geometry when the highlight is taller than the viewport', () => {
  const { frame, listeners, resize } = page({ height: 180 });
  listeners.down();
  assert.equal(frame.scrollTop, 320);
  frame.clientHeight = 400;
  resize();
  assert.equal(frame.scrollTop, 400);
});


test('mouse-wheel impulses animate over multiple frames and preserve accumulated distance', () => {
  const p = page();
  assert.equal(p.wheel(), true);
  assert.equal(p.frame.scrollTop, 0);
  p.tick();
  assert.ok(p.frame.scrollTop > 0 && p.frame.scrollTop < 100);
  p.wheel();
  p.finish();
  assert.equal(p.frame.scrollTop, 200);
  const smallerStep = page();
  assert.equal(smallerStep.wheel({ deltaY:40 }), true);
  smallerStep.tick();
  assert.ok(smallerStep.frame.scrollTop > 0 && smallerStep.frame.scrollTop < 40);
  smallerStep.finish();
  assert.equal(smallerStep.frame.scrollTop, 40);
});

test('wheel reversal responds immediately, and line/page units are normalized', () => {
  const p = page();
  p.frame.scrollTop = 500;
  p.wheel({ deltaY:120 });
  p.tick();
  const beforeReverse = p.frame.scrollTop;
  p.wheel({ deltaY:-120 });
  p.tick();
  assert.ok(p.frame.scrollTop < beforeReverse);
  p.finish();
  const line = page();
  line.wheel({ deltaY:3, deltaMode:1 }); line.finish();
  assert.equal(line.frame.scrollTop, 48);
  const chapter = page();
  chapter.wheel({ deltaY:1, deltaMode:2 }); chapter.finish();
  assert.equal(chapter.frame.scrollTop, 640);
});

test('touchpad micro-deltas, zoom, horizontal gestures, and reduced motion remain native', () => {
  for (const input of [{ deltaY:8 }, { ctrlKey:true }, { shiftKey:true }, { deltaX:150 }, { cancelable:false }]) {
    const p = page();
    assert.equal(p.wheel(input), false);
    p.finish();
    assert.equal(p.calls.length, 0);
  }
  assert.equal(page({ reducedMotion:true }).wheel(), false);
});

test('scroll boundaries pass wheel input to the document footer', () => {
  const p = page();
  assert.equal(p.wheel({ deltaY:-100 }), false);
  p.frame.scrollTop = p.frame.scrollHeight - p.frame.clientHeight;
  assert.equal(p.wheel(), false);
  p.frame.scrollTop -= 20;
  assert.equal(p.wheel(), true);
  p.finish();
  assert.equal(p.frame.scrollTop, p.frame.scrollHeight - p.frame.clientHeight);
});

test('nested scrollers and form controls keep their own wheel behavior', () => {
  const p = page();
  const nested = { overflowY:'auto', scrollHeight:500, clientHeight:100, scrollTop:0, parentElement:p.frame };
  assert.equal(p.wheel({ target:nested }), false);
  assert.equal(p.wheel({ target:{ closest:()=>true } }), false);
  p.finish();
  assert.equal(p.calls.length, 0);
});

test('direct input and shortcut navigation cancel wheel animation', () => {
  for (const input of ['pointerdown', 'touchstart', 'keydown']) {
    const p = page();
    p.wheel(); p.tick();
    const before = p.frame.scrollTop;
    p.listeners[input](); p.finish();
    assert.equal(p.frame.scrollTop, before);
  }
  const p = page();
  p.wheel(); p.tick(); p.listeners.down(); p.finish();
  assert.equal(p.frame.scrollTop, 640);
  assert.equal(p.calls.at(-1).behavior, 'smooth');
});

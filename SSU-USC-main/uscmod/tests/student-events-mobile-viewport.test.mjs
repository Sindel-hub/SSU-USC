import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../dashboard/js/events-section-scroll.js', import.meta.url), 'utf8');
function page({ height = 640, reducedMotion = false, missing = false } = {}) {
  const listeners = {}, properties = {}, calls = [];
  const frame = {
    clientHeight: height, clientTop: 1, scrollTop: 0,
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
    ResizeObserver: class { constructor(handler) { onResize = handler; } observe() {} }
  });
  return { frame, properties, calls, listeners, resize: () => onResize?.() };
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

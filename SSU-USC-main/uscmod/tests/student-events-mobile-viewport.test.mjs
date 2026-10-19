import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../dashboard/events.html', import.meta.url), 'utf8');
const code = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
function page({ width = 390, height = 844, sectionTop = 204, headerPosition = 'relative' } = {}) {
  const state = { upcomingTop: height, headerBottom: 58, visible: false, properties: {}, listeners: {} };
  const window = { innerWidth: width, innerHeight: height, scrollY: 0, addEventListener(name, fn) { state.listeners[name] = fn; } };
  const header = { getBoundingClientRect: () => ({ bottom: state.headerBottom }) };
  const highlight = { getBoundingClientRect: () => ({ top: sectionTop - window.scrollY }), style: { setProperty(name, value) { state.properties[name] = value; } } };
  const upcoming = { getBoundingClientRect: () => ({ top: state.upcomingTop - window.scrollY, bottom: state.upcomingTop + 900 - window.scrollY }) };
  const document = {
    getElementById: id => id === 'eventsHighlightSection' ? highlight : id === 'eventsUpcomingSection' ? upcoming : {},
    querySelector: () => header,
    body: { classList: { toggle(name, value) { state.visible = value; } } }
  };
  vm.runInNewContext(code, { window, document, requestAnimationFrame: callback => callback(), getComputedStyle: () => ({ position: headerPosition }) });
  return { state, window };
}

test('mobile highlight fills precisely the first visible screen below existing chrome', () => {
  const { state } = page({ height: 568, sectionTop: 204 });
  assert.equal(state.properties['--events-highlight-viewport-height'], '364px');
  assert.equal(state.visible, false, 'up must not peek into the first frame');
});

test('mobile up shortcut waits until Upcoming reaches the visible top', () => {
  const { state, window } = page();
  window.scrollY = 400;
  state.listeners.scroll();
  assert.equal(state.visible, false, 'a partly visible next section must not reveal up beside down');
  window.scrollY = 844;
  state.listeners.scroll();
  assert.equal(state.visible, true);
  window.scrollY = 0;
  state.listeners.scroll();
  assert.equal(state.visible, false);
});

test('resize uses document position even when already scrolled', () => {
  const { state, window } = page();
  window.scrollY = 600;
  window.innerHeight = 740;
  state.listeners.resize();
  assert.equal(state.properties['--events-highlight-viewport-height'], '536px');
});

test('desktop height and reveal behavior remain unchanged', () => {
  const { state, window } = page({ width: 1024, height: 844, sectionTop: 142 });
  assert.equal(state.properties['--events-highlight-viewport-height'], '694px');
  window.scrollY = 300;
  state.listeners.scroll();
  assert.equal(state.visible, true);
});

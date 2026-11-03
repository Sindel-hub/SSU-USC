import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { announcementExcerpt } from '../shared/announcement-excerpt.mjs';

const studentSource = fs.readFileSync(new URL('../dashboard/js/bulletin.js', import.meta.url), 'utf8');
const officerSource = fs.readFileSync(new URL('../usc-admin/overview/js/overview.js', import.meta.url), 'utf8');
const posts = Array.from({ length: 5 }, (_, index) => ({ id: `synthetic-${index}`, title: `Notice ${index}`, content: 'First paragraph.\n\nSecond paragraph.', createdAtMs: index + 1 }));
const classList = () => ({ toggle() {}, add() {}, remove() {} });

function studentFixture({ count = 5, visible = 3, reducedMotion = false } = {}) {
  const timers = new Map();
  const state = { visible };
  let nextTimer = 0;
  const feed = {
    style: {}, cards: [], offsetWidth: 1000,
    set innerHTML(value) {
      this.html = value;
      this.cards = [...value.matchAll(/<article class="bulletin-page-card" data-bulletin-index="(\d+)"/g)].map(match => ({
        index: Number(match[1]), inert: false, attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        getBoundingClientRect: () => ({ width: 300 })
      }));
    },
    querySelector() { return this.cards[0]; },
    querySelectorAll() { return this.cards; }
  };
  const dotsHost = {
    children: [],
    set innerHTML(value) {
      this.children = [...value.matchAll(/<button /g)].map(() => ({ classList: classList(), setAttribute() {}, removeAttribute() {} }));
    },
    querySelectorAll() { return this.children; }
  };
  const prevButton = {}, nextButton = {}, position = {};
  const carousel = { classList: classList() };
  const context = vm.createContext({
    announcements: posts.slice(0, count), carouselIndex: 0, carouselPhysicalIndex: 0, carouselCloneCount: 0,
    carouselAnimating: false, carouselTransitionTimer: 0, carouselQueuedDirection: 0,
    feed, carousel, dotsHost, prevButton, nextButton, announcementExcerpt,
    window: {
      clearTimeout: id => timers.delete(id),
      setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; }
    },
    document: { getElementById: () => position },
    getComputedStyle: element => element === carousel
      ? { getPropertyValue: () => String(state.visible) }
      : { columnGap: '20px', transitionDuration: reducedMotion ? '0s' : '0.35s' },
    hydrateMediaImages: async () => {}, requestAnimationFrame: callback => callback(), formatDate: () => 'Test date'
  });
  vm.runInContext(studentSource.slice(studentSource.indexOf('function clean('), studentSource.indexOf('function getProfile()')) +
    studentSource.slice(studentSource.indexOf('function visibleCards()'), studentSource.indexOf('function openAnnouncement(')), context);
  context.renderAnnouncements();
  return { context, feed, state, timers, dotsHost, prevButton, nextButton, position, visibleIds: () => feed.cards.filter(card => !card.inert).map(card => card.index) };
}

test('student next/previous boundaries animate one step and rebase to identical visible announcements', () => {
  for (const visible of [1, 2, 3]) {
    const f = studentFixture({ visible });
    f.context.carouselIndex = 4;
    f.context.applyCarouselPosition({ animate: false });
    const beforeNext = f.context.carouselPhysicalIndex;
    f.context.moveCarousel(1);
    assert.equal(f.context.carouselIndex, 0);
    assert.equal(f.context.carouselPhysicalIndex, beforeNext + 1);
    const nextIds = f.visibleIds();
    f.context.finishCarouselTransition();
    assert.deepEqual(f.visibleIds(), nextIds);
    assert.equal(f.context.carouselPhysicalIndex, visible);
    f.context.moveCarousel(-1);
    assert.equal(f.context.carouselIndex, 4);
    assert.equal(f.context.carouselPhysicalIndex, visible - 1);
    const previousIds = f.visibleIds();
    f.context.finishCarouselTransition();
    assert.deepEqual(f.visibleIds(), previousIds);
    assert.equal(f.context.carouselPhysicalIndex, visible + 4);
  }
});

test('every starting announcement is reachable and only the displayed originals or copies are interactive', () => {
  const f = studentFixture();
  assert.equal(f.dotsHost.children.length, posts.length);
  for (let index = 0; index < posts.length * 3; index += 1) {
    assert.deepEqual(f.visibleIds(), [index % 5, (index + 1) % 5, (index + 2) % 5]);
    assert.equal(f.feed.cards.filter(card => card.attributes['aria-hidden'] === 'false').length, 3);
    f.context.moveCarousel(1);
    f.context.finishCarouselTransition();
  }
  assert.match(f.feed.html, /data-id="synthetic-0"/);
  assert.match(f.feed.html, /First paragraph\.\n\nSecond paragraph\./);
});

test('rapid navigation queues a step and reduced motion never waits for transitionend', () => {
  const f = studentFixture();
  f.context.moveCarousel(1);
  f.context.moveCarousel(1);
  f.context.finishCarouselTransition();
  assert.equal(f.context.carouselIndex, 2);
  f.context.finishCarouselTransition();
  assert.equal(f.context.carouselAnimating, false);
  assert.equal(f.timers.size, 0);
  const reduced = studentFixture({ reducedMotion: true });
  reduced.context.moveCarousel(-1);
  assert.equal(reduced.context.carouselIndex, 4);
  assert.equal(reduced.context.carouselAnimating, false);
  assert.equal(reduced.timers.size, 0);
});

test('responsive resizing and live feed replacement rebuild boundary copies without stale transitions', () => {
  const f = studentFixture();
  f.context.moveCarousel(-1);
  f.state.visible = 1;
  f.context.applyCarouselPosition({ animate: false });
  assert.equal(f.context.carouselCloneCount, 1);
  assert.deepEqual(f.visibleIds(), [4]);
  assert.equal(f.context.carouselAnimating, false);
  f.context.announcements = posts.slice(0, 1);
  f.context.renderAnnouncements();
  assert.equal(f.context.carouselCloneCount, 0);
  assert.equal(f.context.carouselIndex, 0);
  assert.equal(f.feed.cards.length, 1);
  assert.equal(f.prevButton.hidden, true);
  assert.equal(f.nextButton.disabled, true);
  assert.equal(f.timers.size, 0);
});

test('empty feeds and feeds fitting the viewport have no copies or cycling controls', () => {
  for (const count of [0, 1, 2, 3]) {
    const f = studentFixture({ count });
    assert.equal(f.context.carouselCloneCount, 0);
    assert.equal(f.feed.cards.length, count);
    assert.equal(f.prevButton.hidden, true);
    f.context.moveCarousel(1);
    assert.equal(f.context.carouselIndex, 0);
    if (!count) assert.match(f.feed.html, /No announcements/);
  }
});

function officerFixture({ count = 3 } = {}) {
  const intervals = new Map(), events = new Map(), lifecycle = new Map();
  const document = { activeElement: null, hidden: false, getElementById: () => host };
  const state = { announcements: posts.slice(0, count), announcementIndex: 0 };
  let nextTimer = 0, reducedMotion = false, hovered = false, snapshot;
  const host = {
    buttons: [], html: '',
    set innerHTML(value) {
      this.html = value;
      this.buttons = [...value.matchAll(/<button[^>]+data-officer-bulletin-control="([^"]+)"[^>]*>/g)].map(match => {
        const step = match[0].match(/data-officer-bulletin-step="([^"]+)"/);
        const index = match[0].match(/data-officer-bulletin-index="([^"]+)"/);
        return {
          dataset: { officerBulletinControl: match[1], ...(step ? { officerBulletinStep: step[1] } : {}), ...(index ? { officerBulletinIndex: index[1] } : {}) },
          closest() { return this; }, focus() { document.activeElement = this; }
        };
      });
    },
    querySelector(selector) { return this.buttons.find(button => selector.includes(`"${button.dataset.officerBulletinControl}"`)); },
    addEventListener: (type, callback) => events.set(type, callback),
    contains(element) { return element === this || this.buttons.includes(element); },
    matches() { return hovered || this.contains(document.activeElement); },
    focus() { document.activeElement = this; }
  };
  const context = vm.createContext({
    state, document, announcementExcerpt, syncDashboardLayout() {}, setText() {}, collection() {}, db: {},
    onSnapshot: (_, callback) => { snapshot = callback; },
    window: {
      clearInterval: id => intervals.delete(id),
      setInterval: (callback, delay) => { assert.equal(delay, 6500); intervals.set(++nextTimer, callback); return nextTimer; },
      matchMedia: () => ({ matches: reducedMotion }), addEventListener: (type, callback) => lifecycle.set(type, callback)
    }
  });
  vm.runInContext(officerSource.slice(officerSource.indexOf('const clean ='), officerSource.indexOf('function setText(')) +
    officerSource.match(/function announcementImage\(item\)[^\n]+/)[0] +
    officerSource.slice(officerSource.indexOf('function renderBulletin()'), officerSource.indexOf('let calendarOffset')), context);
  context.renderBulletin();
  context.bindOfficerBulletinCarousel();
  return { context, state, host, document, events, lifecycle, intervals,
    tick: () => [...intervals.values()][0](), reduceMotion: value => { reducedMotion = value; }, hover: value => { hovered = value; },
    click: name => events.get('click')({ target: host.buttons.find(button => button.dataset.officerBulletinControl === name) }),
    publish: records => snapshot({ docs: records.map(item => ({ id: item.id, data: () => item })) }) };
}

test('officer arrows, dots and keyboard cycle all posts in both directions and preserve button focus', () => {
  const f = officerFixture();
  f.click('prev'); assert.equal(f.state.announcementIndex, 2); assert.match(f.host.html, /Notice 2/);
  const next = f.host.buttons.find(button => button.dataset.officerBulletinControl === 'next');
  next.focus(); f.click('next');
  assert.equal(f.state.announcementIndex, 0);
  assert.equal(f.document.activeElement.dataset.officerBulletinControl, 'next');
  f.click('slide-1'); assert.equal(f.state.announcementIndex, 1);
  let prevented = false;
  f.events.get('keydown')({ key: 'ArrowRight', preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(f.state.announcementIndex, 2);
  assert.match(f.host.html, /href="\.\.\/announcements\/announcements\.html"/);
  assert.equal(f.intervals.size, 1);
});

test('officer autoplay loops at the student interval, pausing for interaction, hidden tabs and reduced motion', () => {
  const f = officerFixture();
  f.tick(); assert.equal(f.state.announcementIndex, 1);
  f.tick(); f.tick(); assert.equal(f.state.announcementIndex, 0);
  f.hover(true); f.tick(); assert.equal(f.state.announcementIndex, 0); f.hover(false);
  f.host.focus(); f.tick(); assert.equal(f.state.announcementIndex, 0); f.document.activeElement = null;
  f.document.hidden = true; f.tick(); assert.equal(f.state.announcementIndex, 0); f.document.hidden = false;
  f.reduceMotion(true); f.tick(); assert.equal(f.state.announcementIndex, 0); f.reduceMotion(false);
  f.tick(); assert.equal(f.state.announcementIndex, 1);
  f.lifecycle.get('pagehide')(); assert.equal(f.intervals.size, 0);
  f.lifecycle.get('pageshow')(); assert.equal(f.intervals.size, 1);
});

test('officer horizontal swipes loop without turning vertical page gestures into navigation', () => {
  const f = officerFixture();
  const touch = (x, y) => ({ changedTouches: [{ clientX: x, clientY: y }] });
  f.events.get('touchstart')(touch(200, 100)); f.events.get('touchend')(touch(100, 100));
  assert.equal(f.state.announcementIndex, 1);
  f.events.get('touchstart')(touch(200, 100)); f.events.get('touchend')(touch(130, 250));
  assert.equal(f.state.announcementIndex, 1);
});

test('officer live feeds preserve the selected post across reordering and recover when it is removed', () => {
  const f = officerFixture();
  f.context.selectOfficerAnnouncement(1);
  f.context.bindAnnouncements();
  f.publish([posts[0], posts[1], posts[2], posts[4]]);
  assert.equal(f.state.announcements[f.state.announcementIndex].id, posts[1].id);
  assert.equal(f.state.announcementIndex, 2);
  f.publish([posts[0], posts[4]]);
  assert.equal(f.state.announcementIndex, 0);
  assert.equal(f.state.announcements[0].id, posts[4].id);
  f.publish([]); assert.match(f.host.html, /No announcement posted yet/);
});

test('officer empty and single-announcement feeds never show unusable navigation', () => {
  for (const count of [0, 1]) {
    const f = officerFixture({ count });
    assert.equal(f.host.buttons.length, 0);
    f.tick(); assert.equal(f.state.announcementIndex, 0);
  }
});

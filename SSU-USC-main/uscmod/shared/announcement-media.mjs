const safeSource = (value) => {
  try {
    const url = new URL(value, location.href);
    return ["https:", "http:", "blob:", "firestore-media:"].includes(
      url.protocol,
    ) || /^data:image\/(png|jpeg|webp);base64,/.test(value)
      ? value
      : "";
  } catch {
    return "";
  }
};
export function announcementImages(post) {
  return (post?.imageUrls?.length ? post.imageUrls : [post?.imageUrl])
    .filter(Boolean)
    .map(safeSource)
    .filter(Boolean);
}
function styles() {
  if (document.querySelector("[data-announcement-media-style]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("./announcement-media.css", import.meta.url).href;
  link.dataset.announcementMediaStyle = "";
  document.head.append(link);
}
export function linkAnnouncementText(host) {
  if (!host) return;
  host.classList.add("announcement-linked-content");
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode())
    if (!walker.currentNode.parentElement.closest("a,button"))
      nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.textContent,
      regex = /https?:\/\/[^\s<>"']+/g;
    let match,
      last = 0;
    const fragment = document.createDocumentFragment();
    while ((match = regex.exec(text))) {
      let value = match[0].replace(/[.,!;:?)]+$/, "");
      fragment.append(text.slice(last, match.index));
      const a = document.createElement("a");
      a.href = value;
      a.textContent = value;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      fragment.append(a);
      last = match.index + value.length;
    }
    if (last) {
      fragment.append(text.slice(last));
      node.replaceWith(fragment);
    }
  }
}
let viewer,
  index = 0,
  images = [],
  opener;
export function openAnnouncementImages(
  urls,
  start = 0,
  title = "Announcement image",
) {
  styles();
  if (!urls.length) return;
  images = urls;
  index = start;
  opener = document.activeElement;
  if (!viewer) {
    viewer = document.createElement("dialog");
    viewer.className = "announcement-image-viewer";
    viewer.setAttribute("aria-label", "Announcement image viewer");
    viewer.innerHTML =
      '<button type="button" data-close aria-label="Close image viewer">×</button><button type="button" data-prev aria-label="Previous image">‹</button><figure><img alt=""><figcaption aria-live="polite"></figcaption></figure><button type="button" data-next aria-label="Next image">›</button>';
    document.body.append(viewer);
    viewer.querySelector("[data-close]").onclick = () => viewer.close();
    viewer.querySelector("[data-prev]").onclick = () => show(-1);
    viewer.querySelector("[data-next]").onclick = () => show(1);
    viewer.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        show(-1);
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        show(1);
      }
    });
    let touch;
    viewer.addEventListener(
      "touchstart",
      (e) => {
        touch = e.changedTouches[0].clientX;
      },
      { passive: true },
    );
    viewer.addEventListener(
      "touchend",
      (e) => {
        const delta = e.changedTouches[0].clientX - touch;
        if (Math.abs(delta) > 50) show(delta < 0 ? 1 : -1);
      },
      { passive: true },
    );
    viewer.addEventListener("close", () => {
      document.documentElement.classList.remove("announcement-viewer-open");
      opener?.focus({ preventScroll: true });
    });
  }
  viewer.dataset.title = title;
  show(0);
  if (!viewer.open) viewer.showModal();
  document.documentElement.classList.add("announcement-viewer-open");
}
function show(delta) {
  index = (index + delta + images.length) % images.length;
  const img = viewer.querySelector("img");
  const source = images[index];
  if (source.startsWith("firestore-media://")) {
    img.removeAttribute("src");
    import("./security-client.js")
      .then((m) => m.resolveMediaUrl(source))
      .then((url) => {
        if (images[index] === source) img.src = url;
      })
      .catch(() => {
        img.alt = "Image unavailable";
      });
  } else img.src = source;
  img.alt = `${viewer.dataset.title}, image ${index + 1}`;
  viewer.querySelector("figcaption").textContent =
    `${index + 1} / ${images.length}`;
  viewer.querySelector("[data-prev]").hidden = viewer.querySelector(
    "[data-next]",
  ).hidden = images.length < 2;
}
export function mountAnnouncementGallery(host, post) {
  if (!host) return;
  styles();
  const urls = announcementImages(post);
  host.replaceChildren();
  host.classList.add("announcement-gallery");
  host.dataset.count = String(Math.min(urls.length, 4));
  host.hidden = !urls.length;
  urls.slice(0, 4).forEach((src, i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute(
      "aria-label",
      `View ${post.title || "announcement"}, image ${i + 1} of ${urls.length}`,
    );
    const img = document.createElement("img");
    if (src.startsWith("firestore-media://"))
      import("./security-client.js")
        .then((m) => m.resolveMediaUrl(src))
        .then((url) => {
          img.src = url;
        })
        .catch(() => {
          img.alt = "Image unavailable";
        });
    else img.src = src;
    img.alt = post.title || "Announcement image";
    img.loading = "lazy";
    button.append(img);
    if (i === 3 && urls.length > 4) {
      const more = document.createElement("span");
      more.textContent = `+${urls.length - 4}`;
      button.append(more);
    }
    button.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); };
    button.onclick = (e) => {
      e.stopPropagation();
      openAnnouncementImages(urls, i, post.title);
    };
    host.append(button);
  });
}
const registered = new Map();
let observer,
  scheduled = false;
export function registerAnnouncementMedia(post) {
  if (!post) return;
  if (post.imageUrl) registered.set(post.imageUrl, post);
  styles();
  if (!observer) {
    observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"],
    });
  }
  schedule();
}
function schedule() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    for (const host of document.querySelectorAll(
      ".recent-announcement-excerpt, .announcement-copy-panel p, .bulletin-page-body p, #officerBulletinPreview .bulletin-copy p",
    ))
      linkAnnouncementText(host);
    for (const img of document.querySelectorAll(
      "img:not(.announcement-gallery img):not(.announcement-image-viewer img)",
    )) {
      const post =
        registered.get(img.getAttribute("src")) ||
        registered.get(img.dataset.mediaRef);
      if (!post) {
        if (img._announcementGallery) {
          img._announcementGallery.remove();
          img._announcementGallery = null;
          img._announcementKey = null;
          img.style.display = "";
        }
        continue;
      }
      if (img._announcementKey === JSON.stringify(announcementImages(post)))
        continue;
      img._announcementGallery?.remove();
      const host = document.createElement("div");
      mountAnnouncementGallery(host, post);
      host.classList.add("announcement-gallery-inline");
      img.style.display = "none";
      img.after(host);
      img._announcementGallery = host;
      img._announcementKey = JSON.stringify(announcementImages(post));
    }
  });
}

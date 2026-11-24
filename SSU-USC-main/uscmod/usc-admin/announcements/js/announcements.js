import { initializeAnnouncementReview, saveReviewDraft, clearReviewDraft, draftImage } from './announcement-review.js';
import { activityAttributionText, activityHistoryHref, trackedOfficerAction } from '../../../shared/officer-activity-client.js';
import { attachSurveyButton, surveyIdFromLink } from '../../../shared/survey-links.mjs';
import { initializeFacebookPublishing, hydrateFacebookDeliveries, facebookRequest } from './facebook-publishing.js';
import { RETENTION_MS, daysRemaining, canRestore } from "./announcement-retention.mjs";
import { db, auth } from "../../../firebase/firebase-config.js";
import { hydrateMediaImages, resolveMediaUrl } from "../../../shared/security-client.js";
import {
    collection,
    runTransaction,
    Timestamp,
    doc,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});


const surveyLinkInput = document.getElementById('announcementSurveyLink');
const attachedSurveyId = new URLSearchParams(location.search).get('survey');
if (/^[a-zA-Z0-9]{20}$/.test(attachedSurveyId || '')) surveyLinkInput.value = new URL(`/survey/index.html?id=${attachedSurveyId}`, location.origin).href;
const announcementForm = document.getElementById("announcementForm");
const announcementTitleInput = document.getElementById("announcementTitle");
const announcementCategoryInput = document.getElementById("announcementCategory");
const announcementAudienceInput = document.getElementById("announcementAudience");
const announcementContentInput = document.getElementById("announcementContent");
const announcementImageInput = document.getElementById("announcementImage");
const imagePickerBtn = document.getElementById("imagePickerBtn");
const imageFileName = document.getElementById("imageFileName");
const draftImagePreview = document.getElementById("draftImagePreview");
const clearAnnouncementBtn = document.getElementById("clearAnnouncementBtn");
const publishAnnouncementBtn = document.getElementById("publishAnnouncementBtn");
const scrollToFormBtn = document.getElementById("scrollToFormBtn");

const previewCategoryBadge = document.getElementById("previewCategoryBadge");
const previewDateText = document.getElementById("previewDateText");
const previewTitle = document.getElementById("previewTitle");
const previewAudience = document.getElementById("previewAudience");
const previewContent = document.getElementById("previewContent");
const announcementPreviewImageWrap = document.getElementById("announcementPreviewImageWrap");
const announcementPreviewImage = document.getElementById("announcementPreviewImage");
const announcementPreviewPlaceholder = document.getElementById("announcementPreviewPlaceholder");

const publishedCountEl = document.getElementById("publishedCount");
const imageCountEl = document.getElementById("imageCount");
const categoryCountEl = document.getElementById("categoryCount");
const latestPublishEl = document.getElementById("latestPublish");

const recentAnnouncementsList = document.getElementById("recentAnnouncementsList");

const announcementModal = document.getElementById("announcementModal");
const announcementModalBackdrop = document.getElementById("announcementModalBackdrop");
const announcementModalClose = document.getElementById("announcementModalClose");
const modalAnnouncementImage = document.getElementById("modalAnnouncementImage");
const modalAnnouncementCategory = document.getElementById("modalAnnouncementCategory");
const modalAnnouncementDate = document.getElementById("modalAnnouncementDate");
const modalAnnouncementTitle = document.getElementById("modalAnnouncementTitle");
const modalAnnouncementAudience = document.getElementById("modalAnnouncementAudience");
const modalAnnouncementContent = document.getElementById("modalAnnouncementContent");

const announcementsCollection = collection(db, "announcements");

let selectedImageFile = null;
let selectedImageObjectUrl = "";
let liveAnnouncements = [];
let archivedAnnouncements = [], deletedAnnouncements = [];
let bulletinView = 'published';
let visibleAnnouncements = [];
const libraryErrors = {};

const composingWorkspace = document.querySelector('.announcement-workspace');
const composeDialog = document.getElementById('announcementComposeDialog');
const composeAnchor = document.createElement('div');
composeAnchor.className = 'compose-placeholder';
let closingCompose = false;
function endCompose() {
  closingCompose = true;
  document.body.classList.remove('bulletin-composing');
  if (composeDialog.open) composeDialog.close();
  if (composeAnchor.isConnected) composeAnchor.replaceWith(composingWorkspace);
  if (composingWorkspace.contains(document.activeElement)) document.activeElement.blur();
  queueMicrotask(() => { closingCompose = false; });
}
function beginCompose(target) {
  if (closingCompose || composeDialog.open) return;
  composeAnchor.style.height = composingWorkspace.getBoundingClientRect().height + 'px';
  composingWorkspace.before(composeAnchor);
  composeDialog.append(composingWorkspace);
  document.body.classList.add('bulletin-composing');
  composeDialog.showModal();
  target?.focus({preventScroll:true});
}
composingWorkspace?.addEventListener('focusin', event => {
  if (event.target.closest('#announcementForm') && !event.target.closest('#clearAnnouncementBtn')) beginCompose(event.target);
});
function dismissOnOutside(dialog, dismiss) {
  dialog.addEventListener('pointerdown', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dismiss();
  });
}
dismissOnOutside(composeDialog, endCompose);
composeDialog.addEventListener('cancel', event => { event.preventDefault(); endCompose(); });
function libraryRows() {
  return bulletinView === 'archive' ? archivedAnnouncements : bulletinView === 'deleted' ? deletedAnnouncements.filter(row => canRestore(row.expiresAt)) : liveAnnouncements;
}
function renderLibrary() {
  visibleAnnouncements = libraryRows();
  renderRecentAnnouncements(visibleAnnouncements);
  if(libraryErrors[bulletinView]) recentAnnouncementsList.textContent='Unable to load posts. Check access and refresh.';
  const title = document.getElementById('bulletinListTitle');
  if(title) title.textContent = {published:'Published Announcements',archive:'Archive',deleted:'Recently Deleted'}[bulletinView];
}
async function movePost(id, action) {
  const sourceName = bulletinView === 'archive' ? 'archived_announcements' : bulletinView === 'deleted' ? 'deleted_announcements' : 'announcements';
  if (await trackedOfficerAction({ module: "announcements", action, recordId: id, sourceCollection: sourceName })) return;
  await runTransaction(db, async tx => {
    const sourceRef = doc(db, sourceName, id);
    const source = await tx.get(sourceRef);
    if (!source.exists()) throw new Error('This post has already changed. Refresh the list.');
    const data = source.data();
    if (action === 'permanent-delete') {
      if (sourceName !== 'deleted_announcements') throw new Error('Only posts in Recently Deleted can be permanently deleted.');
      tx.delete(sourceRef);
      return;
    }
    let destination, payload;
    if (action === 'restore' && sourceName === 'deleted_announcements') {
      if (!canRestore(data.expiresAt)) throw new Error('The 30-day restoration period has ended.');
      destination = data.sourceCollection === 'archived_announcements' ? 'archived_announcements' : 'announcements';
      payload = destination === 'announcements' ? data.post : {post:data.post, archivedAt:serverTimestamp()};
    } else if (action === 'restore' && sourceName === 'archived_announcements') {
      destination = 'announcements'; payload = data.post;
    } else if (action === 'archive' && sourceName === 'announcements') {
      destination = 'archived_announcements'; payload = {post:data, archivedAt:serverTimestamp()};
    } else if (action === 'delete' && sourceName !== 'deleted_announcements') {
      destination = 'deleted_announcements';
      payload = {post:sourceName === 'announcements' ? data : data.post, sourceCollection:sourceName, deletedAt:serverTimestamp(), expiresAt:Timestamp.fromMillis(Date.now()+RETENTION_MS)};
    } else throw new Error('This action is unavailable.');
    const targetRef=doc(db,destination,id);
    const target=await tx.get(targetRef);
    if(target.exists()) throw new Error('A saved copy already exists. Refresh before trying again.');
    tx.set(targetRef,payload); tx.delete(sourceRef);
  });
}

function safeText(value, fallback = "") {
    return String(value || fallback).trim();
}

function truncateText(value, maxLength = 120) {
    const text = safeText(value);
    return text.length <= maxLength ? text : `${text.slice(0, maxLength).trim()}…`;
}

function escapeHtml(value = "") {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function formatAnnouncementDate(announcement) {
    if (announcement?.createdAt?.toDate) {
        return announcement.createdAt.toDate().toLocaleString();
    }

    if (typeof announcement?.createdAtMs === "number") {
        return new Date(announcement.createdAtMs).toLocaleString();
    }

    return "Just now";
}

function setDraftPreviewImage(source) {
    if (
        !announcementPreviewImage ||
        !announcementPreviewImageWrap ||
        !announcementPreviewPlaceholder
    ) {
        return;
    }

    if (source) {
        /* Show selected image in Live Preview */
        announcementPreviewImage.src = source;

        announcementPreviewImage.alt = safeText(
            announcementTitleInput?.value,
            "Announcement image"
        );

        announcementPreviewImage.hidden = false;

        announcementPreviewImageWrap.hidden = false;
        announcementPreviewImageWrap.classList.remove("empty");

        announcementPreviewPlaceholder.hidden = true;

        /* Also show the small form preview */
        if (draftImagePreview) {
            draftImagePreview.src = source;
            draftImagePreview.hidden = false;
        }

        return;
    }

    /* No image selected */
    announcementPreviewImage.removeAttribute("src");
    announcementPreviewImage.hidden = true;

    /*
     * Keep the preview box visible,
     * but display its placeholder.
     */
    announcementPreviewImageWrap.hidden = false;
    announcementPreviewImageWrap.classList.add("empty");

    announcementPreviewPlaceholder.hidden = false;

    if (draftImagePreview) {
        draftImagePreview.removeAttribute("src");
        draftImagePreview.hidden = true;
    }
}
function releaseDraftObjectUrl() {
    if (selectedImageObjectUrl) {
        URL.revokeObjectURL(selectedImageObjectUrl);
        selectedImageObjectUrl = "";
    }
}

function syncPreviewCard() {
    if (previewCategoryBadge) {
        previewCategoryBadge.textContent = safeText(announcementCategoryInput?.value, "Official Notice");
    }

    if (previewDateText) {
        previewDateText.textContent = new Date().toLocaleDateString([], {
            month: "long",
            day: "numeric",
            year: "numeric"
        });
    }

    if (previewTitle) {
        previewTitle.textContent = safeText(announcementTitleInput?.value, "Your announcement title will appear here");
    }

    if (previewAudience) {
        previewAudience.textContent = `Audience: ${safeText(announcementAudienceInput?.value, "All Students")}`;
    }

    if (previewContent) {
        previewContent.textContent = String(
            announcementContentInput?.value ||
            "Write your announcement content to preview how students will see it."
        );
    }

    if (selectedImageObjectUrl) {
        setDraftPreviewImage(selectedImageObjectUrl);
    } else {
        setDraftPreviewImage("");
    }
}

function setImageFileLabel(fileName = "No image selected") {
    if (imageFileName) {
        imageFileName.textContent = fileName;
    }
}

function resetAnnouncementForm() {
    clearReviewDraft();
    endCompose();
    announcementForm?.reset();
    selectedImageFile = null;
    releaseDraftObjectUrl();
    setImageFileLabel();
    setDraftPreviewImage("");
    syncPreviewCard();
}

function openAnnouncementModal(announcement) {
    if (!announcementModal) return;

    if (modalAnnouncementImage) {
        if (safeText(announcement.imageUrl)) {
            modalAnnouncementImage.src = announcement.imageUrl;
            resolveMediaUrl(announcement.imageUrl).then((url) => { modalAnnouncementImage.src = url; }).catch(() => {});
            modalAnnouncementImage.alt = safeText(announcement.title, "Announcement image");
            modalAnnouncementImage.hidden = false;
        } else {
            modalAnnouncementImage.removeAttribute("src");
            modalAnnouncementImage.hidden = true;
        }
    }

    if (modalAnnouncementCategory) modalAnnouncementCategory.textContent = safeText(announcement.category, "Official Notice");
    if (modalAnnouncementDate) modalAnnouncementDate.textContent = formatAnnouncementDate(announcement);
    if (modalAnnouncementTitle) modalAnnouncementTitle.textContent = safeText(announcement.title, "Announcement");
    if (modalAnnouncementAudience) modalAnnouncementAudience.textContent = safeText(announcement.audience, "All Students");
    if (modalAnnouncementContent) modalAnnouncementContent.textContent = String(announcement.content ?? "");
    attachSurveyButton(modalAnnouncementContent, announcement);

    announcementModal.hidden = false;
    document.body.classList.add("modal-open");
}

function closeAnnouncementModal() {
    if (!announcementModal) return;
    announcementModal.hidden = true;
    document.body.classList.remove("modal-open");
}

function renderAnnouncementStats(announcements) {
    if (publishedCountEl) publishedCountEl.textContent = String(announcements.length);

    if (imageCountEl) {
        const withImages = announcements.filter((announcement) => safeText(announcement.imageUrl)).length;
        imageCountEl.textContent = String(withImages);
    }

    if (categoryCountEl) {
        const categories = new Set(
            announcements.map((announcement) => safeText(announcement.category)).filter(Boolean)
        );
        categoryCountEl.textContent = String(categories.size);
    }

    if (latestPublishEl) {
        const dateEl = latestPublishEl.querySelector(".latest-publish-date");
        const timeEl = latestPublishEl.querySelector(".latest-publish-time");
        const latest = announcements[0] || null;
        let publishDate = null;

        if (latest?.createdAt?.toDate) {
            publishDate = latest.createdAt.toDate();
        } else if (typeof latest?.createdAtMs === "number") {
            publishDate = new Date(latest.createdAtMs);
        }

        const validDate = publishDate && !Number.isNaN(publishDate.getTime());
        if (dateEl) {
            dateEl.textContent = validDate
                ? publishDate.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })
                : "No posts yet";
        }
        if (timeEl) {
            timeEl.textContent = validDate
                ? publishDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                : "—";
        }
    }
}

function renderRecentAnnouncements(announcements) {
    if (!recentAnnouncementsList) return;

    if (!announcements.length) {
        recentAnnouncementsList.innerHTML = `
            <div class="empty-state">
                <h4>No announcements yet</h4>

            </div>
        `;
        return;
    }

    recentAnnouncementsList.innerHTML = announcements
        .map((announcement, index) => {
            const hasImage = !!safeText(announcement.imageUrl);
            const imageMarkup = hasImage
                ? `<img class="recent-announcement-image" src="${escapeHtml(announcement.imageUrl)}" alt="${escapeHtml(
                    safeText(announcement.title, "Announcement image")
                )}">`
                : `<div class="recent-announcement-placeholder">No image uploaded</div>`;

            return `
                <article class="recent-announcement-card" data-announcement-index="${index}">
                    <div class="recent-announcement-media ${hasImage ? "has-image" : "no-image"}">${imageMarkup}</div>
                    <div class="recent-announcement-copy">
                        <div class="recent-announcement-topline">
                            <span class="recent-announcement-chip">${escapeHtml(safeText(announcement.category, "Official Notice"))}</span>
                            <span class="recent-announcement-date">${escapeHtml(formatAnnouncementDate(announcement))}</span>
                        </div>
                        <h4>${escapeHtml(safeText(announcement.title, "Untitled announcement"))}</h4>
                        ${announcement.activityAttribution ? `<p class="recent-announcement-excerpt">${escapeHtml(activityAttributionText(announcement.activityAttribution))}</p>` : ''}
                        <a href="${escapeHtml(activityHistoryHref('Bulletin Board', announcement.id))}">Activity history</a>
                        <p class="recent-announcement-excerpt">${escapeHtml(truncateText(announcement.content, 180))}</p>
                        ${announcement.facebookRequested ? '<div class="facebook-delivery-status" role="status" data-facebook-delivery="'+escapeHtml(announcement.id)+'">Checking Facebook status…</div>' : ''}
                        ${bulletinView === 'deleted' ? `<p class="retention-countdown">${daysRemaining(announcement.expiresAt)} days remaining</p>` : ''}<div class="recent-announcement-footer">
                            <span class="recent-announcement-audience">${escapeHtml(safeText(announcement.audience, "All Students"))}</span>
                            <div class="recent-announcement-actions">
                                <button class="mini-btn light" type="button" data-open-announcement="${index}"><i class="fa-solid fa-up-right-from-square"></i> Open full post</button>
                                <div class="post-actions-menu"><button type="button" class="post-actions-toggle" aria-label="Post actions" aria-expanded="false">•••</button><div class="post-actions-options" inert>
 ${bulletinView === 'published' ? `<button type="button" data-post-action="archive" data-post-id="${escapeHtml(announcement.id)}" data-rbac-permission="bulletin.manage">Archive</button>` : `<button type="button" data-post-action="restore" data-post-id="${escapeHtml(announcement.id)}" data-rbac-permission="bulletin.manage">Restore</button>`}
 ${bulletinView !== 'deleted' ? `<button type="button" data-post-action="delete" data-post-id="${escapeHtml(announcement.id)}" data-rbac-permission="bulletin.manage">Delete</button>` : `<button type="button" class="permanent-delete-action" data-post-action="permanent-delete" data-post-id="${escapeHtml(announcement.id)}" data-rbac-permission="bulletin.manage">Delete permanently</button>`}
 </div></div>
                            </div>
                        </div>
                    </div>
                </article>
            `;
        })
        .join("");
    hydrateFacebookDeliveries(recentAnnouncementsList, bulletinView);
    hydrateMediaImages(recentAnnouncementsList).catch((error) => console.warn("Unable to load announcement media:", error));
}


announcementTitleInput?.addEventListener("input", syncPreviewCard);
announcementCategoryInput?.addEventListener("change", syncPreviewCard);
announcementAudienceInput?.addEventListener("change", syncPreviewCard);
announcementContentInput?.addEventListener("input", syncPreviewCard);

imagePickerBtn?.addEventListener("click", () => {
    announcementImageInput?.click();
});

announcementImageInput?.addEventListener("change", (event) => {
    const file = event.target.files?.[0] || null;

    selectedImageFile = file;
    releaseDraftObjectUrl();

    if (file) {
        selectedImageObjectUrl = URL.createObjectURL(file);
        setImageFileLabel(file.name);
        setDraftPreviewImage(selectedImageObjectUrl);
    } else {
        setImageFileLabel();
        setDraftPreviewImage("");
    }

    syncPreviewCard();
});

clearAnnouncementBtn?.addEventListener("click", () => {
    resetAnnouncementForm();
});

scrollToFormBtn?.addEventListener("click", () => {
    document.getElementById("announcementFormCard")?.scrollIntoView({
        behavior: window.matchMedia("(max-width: 940px)").matches ? "instant" : "smooth",
        block: "start"
    });
});

announcementForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (publishAnnouncementBtn?.disabled) return;

    const title = safeText(announcementTitleInput?.value);
    const category = safeText(announcementCategoryInput?.value, "Official Notice");
    const audience = safeText(announcementAudienceInput?.value, "All Students");
    const content = String(announcementContentInput?.value ?? "");

    if (!title || !content.trim()) {
        alert("Please complete the announcement title and content.");
        return;
    }

    let surveyId;
    try { surveyId = surveyIdFromLink(surveyLinkInput.value, location.origin, globalThis.USC_PUBLIC_ORIGIN); }
    catch (error) { alert(error.message); return; }
    if (surveyId) {
      try {
        const { surveyCall } = await import('../../../shared/needs-assessment-client.js');
        await surveyCall('Public', { surveyId });
      } catch (error) { alert(`Cannot attach survey: ${error.message}`); return; }
    }
    const facebookToggle = document.getElementById('alsoPostFacebook');
    const wantsFacebook = facebookToggle.checked && !facebookToggle.disabled;
    publishAnnouncementBtn.disabled = true;
    publishAnnouncementBtn.textContent = "Saving draft...";

    try {
        const imageUrl = await draftImage(selectedImageFile), imagePath = "";

        const postInput = {
            title,
            category,
            audience,
            content,
            surveyId,
            imageUrl,
            imagePath,
            createdByUid: auth.currentUser?.uid || "",
            createdByEmail: auth.currentUser?.email || "",
            createdAt: serverTimestamp(),
            facebookRequested: wantsFacebook,
            createdAtMs: Date.now()
        };
        const submitForReview = event.submitter?.id === 'sendAnnouncementReviewBtn';
        await saveReviewDraft(postInput, submitForReview);
        resetAnnouncementForm();
        alert(submitForReview ? 'Draft sent for content review. It is not published yet.' : 'Draft saved privately. Send it for review when ready.');
    } catch (error) {
        console.error("Announcement publish error:", error);
        alert(error.message || "Failed to publish announcement.");
    } finally {
        if (publishAnnouncementBtn) {
            publishAnnouncementBtn.disabled = false;
            publishAnnouncementBtn.textContent = "Save draft";
        }
    }
});

function setPostMenu(menu, open) {
  menu.classList.toggle('is-open', open);
  menu.querySelector('.post-actions-toggle').setAttribute('aria-expanded', String(open));
  menu.querySelector('.post-actions-options').inert = !open;
}
function closePostMenus() { document.querySelectorAll('.post-actions-menu.is-open').forEach(menu => setPostMenu(menu, false)); }
document.addEventListener('pointerdown', event => { if (!event.target.closest('.post-actions-menu')) closePostMenus(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closePostMenus(); });
recentAnnouncementsList?.addEventListener("click", async (event) => {
    if (event.target.closest('[data-facebook-delivery]')) return;
    const toggle = event.target.closest('.post-actions-toggle');
    if (toggle) {
      const menu = toggle.closest('.post-actions-menu');
      const open = !menu.classList.contains('is-open');
      closePostMenus();
      setPostMenu(menu, open);
      return;
    }
    const action = event.target.closest('[data-post-action]');
    if (action) {
      if (action.dataset.postAction === 'delete' && !confirm('Move this post to Recently Deleted? You can restore it for 30 days.')) return;
      if (action.dataset.postAction === 'permanent-delete' && !confirm('Permanently delete this announcement? This cannot be undone, and the post cannot be restored.')) return;
      action.disabled = true;
      try { await movePost(action.dataset.postId, action.dataset.postAction); }
      catch (error) { alert(error.message || 'Unable to update this post.'); }
      finally { action.disabled = false; }
      return;
    }
    if (event.target.closest('.post-actions-menu')) return;
    const openButton = event.target.closest("[data-open-announcement]");
    const card = event.target.closest("[data-announcement-index]");
    const source = openButton || card;
    if (!source) return;

    const index = Number(
        openButton?.getAttribute("data-open-announcement") ??
        card?.getAttribute("data-announcement-index")
    );
    const announcement = visibleAnnouncements[index];

    if (announcement) {
        openAnnouncementModal(announcement);
    }
});

announcementModalClose?.addEventListener("click", closeAnnouncementModal);
announcementModalBackdrop?.addEventListener("click", closeAnnouncementModal);

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeAnnouncementModal();
    }
});

const liveQuery = query(announcementsCollection, orderBy("createdAtMs", "desc"));

onSnapshot(
    liveQuery,
    (snapshot) => {
        liveAnnouncements = snapshot.docs.map((docItem) => ({
            id: docItem.id,
            ...docItem.data()
        }));

        renderAnnouncementStats(liveAnnouncements);
        renderLibrary();
    },
    (error) => {
        console.error("Announcement listener error:", error);
        renderAnnouncementStats([]);
        renderRecentAnnouncements([]);
    }
);

syncPreviewCard();
setImageFileLabel();
window.addEventListener("beforeunload", releaseDraftObjectUrl);

for(const [name, view] of [['archived_announcements','archive'],['deleted_announcements','deleted']]) {
  onSnapshot(collection(db,name), snapshot => {
    libraryErrors[view]=false;
    const rows = snapshot.docs.map(item => ({...item.data().post, ...item.data(), id:item.id}));
    rows.sort((a,b)=>(b.createdAtMs||0)-(a.createdAtMs||0));
    if(view === 'archive') archivedAnnouncements=rows; else deletedAnnouncements=rows;
    if(bulletinView === view) renderLibrary();
  }, error => {
    libraryErrors[view]=true;
    console.error('Post library unavailable:',error);
    if(bulletinView === view) recentAnnouncementsList.textContent='Unable to load posts. Check access and refresh.';
  });
}
document.querySelectorAll('[data-bulletin-view]').forEach(button => button.addEventListener('click',()=>{
  endCompose(); bulletinView=button.dataset.bulletinView;
  document.querySelectorAll('[data-bulletin-view]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
  renderLibrary();
}));

const photosDialog=document.getElementById('bulletinPhotosDialog');
let photoRows=[];
document.getElementById('bulletinPhotos')?.addEventListener('click',()=>{
  endCompose();
  photoRows=[...new Map([...liveAnnouncements,...archivedAnnouncements].filter(item=>item.imageUrl).map(item=>[item.imageUrl,item])).values()];
  document.getElementById('bulletinPhotoGrid').innerHTML=photoRows.length ? photoRows.map((item,index)=>`<button type="button" data-photo-index="${index}" aria-label="View photo: ${escapeHtml(item.title || 'Announcement')}"><img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title || 'Announcement')}" loading="lazy"><span>${escapeHtml(item.title || 'Announcement')}</span></button>`).join('') : '<p>No uploaded photos yet.</p>';
  hydrateMediaImages(document.getElementById('bulletinPhotoGrid')).catch(()=>{});
  photosDialog.showModal();
});
document.getElementById('closeBulletinPhotos')?.addEventListener('click',()=>photosDialog.close());
dismissOnOutside(photosDialog, () => photosDialog.close());
const photoViewer = document.getElementById('bulletinPhotoViewer');
const fullPhoto = document.getElementById('bulletinFullPhoto');
let photoIndex = 0;
let photoRequest = 0;
async function showPhoto(index) {
  if (!photoRows.length) return;
  photoIndex = (index + photoRows.length) % photoRows.length;
  const item = photoRows[photoIndex];
  const request = ++photoRequest;
  fullPhoto.removeAttribute('src');
  fullPhoto.alt = item.title || 'Announcement photo';
  document.getElementById('bulletinPhotoPosition').textContent = (photoIndex + 1) + ' / ' + photoRows.length;
  document.querySelectorAll('[data-photo-step]').forEach(button => { button.disabled = photoRows.length < 2; });
  try {
    const url = await resolveMediaUrl(item.imageUrl);
    if (request === photoRequest) fullPhoto.src = url;
  } catch(error) { if (request === photoRequest) fullPhoto.alt = 'Unable to load this photo'; console.warn(error); }
}
dismissOnOutside(photoViewer, () => photoViewer.close());
document.getElementById('closeBulletinPhotoViewer').addEventListener('click', () => photoViewer.close());
document.getElementById('bulletinPhotoGrid')?.addEventListener('click', event => {
  const button = event.target.closest('[data-photo-index]'); if (!button) return;
  photosDialog.close(); photoViewer.showModal();
  showPhoto(Number(button.dataset.photoIndex));
});
document.querySelectorAll('[data-photo-step]').forEach(button => button.addEventListener('click', () => showPhoto(photoIndex + Number(button.dataset.photoStep))));
fullPhoto.addEventListener('click', () => showPhoto(photoIndex + 1));
photoViewer.addEventListener('keydown', event => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault(); showPhoto(photoIndex + (event.key === 'ArrowLeft' ? -1 : 1));
  }
});
setInterval(()=>{if(bulletinView==='deleted')renderLibrary();},60000);

initializeFacebookPublishing(endCompose);
setInterval(() => { if (!document.hidden) hydrateFacebookDeliveries(recentAnnouncementsList, bulletinView); }, 30000);

await initializeAnnouncementReview(content => {
  resetAnnouncementForm();
  announcementTitleInput.value=content.title;announcementCategoryInput.value=content.category;announcementAudienceInput.value=content.audience;announcementContentInput.value=content.content;
  surveyLinkInput.value=content.surveyId ? new URL(`/survey/index.html?id=${content.surveyId}`,location.origin).href : '';
  document.getElementById('alsoPostFacebook').checked=content.facebookRequested;
  setDraftPreviewImage(content.imageUrl || '');syncPreviewCard();
  document.getElementById('announcementFormCard').scrollIntoView({block:'start'});
});

// The existing private delivery snapshot stores a URL for legacy single-image
// posts and a JSON URL array for galleries. No database migration is needed.
export function announcementImageUrls(post) {
  const values = post.imageUrls === undefined || (Array.isArray(post.imageUrls) && !post.imageUrls.length)
    ? (post.imageUrl ? [post.imageUrl] : []) : post.imageUrls;
  if (!Array.isArray(values)) throw new Error('Invalid announcement images.');
  return values.map(value => {
    try {
      const url = new URL(value);
      if (typeof value !== 'string' || url.protocol !== 'https:' || url.username || url.password) throw Error();
      return value;
    } catch { throw new Error('Facebook requires publicly accessible HTTPS images.'); }
  });
}
export function imageSnapshot(images) {
  return images.length > 1 ? JSON.stringify(images) : images[0] || null;
}
export function snapshotImages(value) {
  if (!value) return [];
  let images;
  try { images = value.startsWith('[') ? JSON.parse(value) : [value]; }
  catch { throw new Error('Invalid saved Facebook images.'); }
  return announcementImageUrls({imageUrls: images});
}
export async function publishFacebookPost(pageId, message, images, send) {
  let publicationStarted = false;
  try {
    if (images.length > 1) {
      const attached = {}, uploadedIds = new Set();
      for (const [index, url] of images.entries()) {
        const photo = await send(`${pageId}/photos`, {url, published: 'false'});
        if (!/^[0-9]+$/.test(String(photo.id || ''))) throw new Error('Facebook did not return an uploaded photo ID.');
        if (uploadedIds.has(String(photo.id))) throw new Error('Facebook returned a duplicate uploaded photo ID.');
        uploadedIds.add(String(photo.id));
        attached[`attached_media[${index}]`] = JSON.stringify({media_fbid: String(photo.id)});
      }
      publicationStarted = true;
      return await send(`${pageId}/feed`, {message, ...attached});
    }
    publicationStarted = true;
    return await send(`${pageId}/${images.length ? 'photos' : 'feed'}`, images.length
      ? {url: images[0], caption: message, published: 'true'} : {message});
  } catch (error) {
    error.publicationStarted = publicationStarted;
    throw error;
  }
}

// Client-side resizing (see public/app.js resizeImageBeforeUpload) means
// the browser sends an already-small JPEG as a base64 data URL — this
// helper just decodes and stores it in R2. No server-side image library
// needed, which is what makes this Workers-compatible (sharp is not).

function base64ToBytes(base64) {
  const clean = base64.includes(",") ? base64.split(",")[1] : base64;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function putPhoto(env, companyId, keyPrefix, base64DataUrl) {
  const key = `companies/${companyId}/${keyPrefix}-${Date.now()}.jpg`;
  const bytes = base64ToBytes(base64DataUrl);
  await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } });
  return key;
}

export async function deletePhoto(env, key) {
  if (key) await env.PHOTOS.delete(key);
}

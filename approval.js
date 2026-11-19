// Approval fingerprint: must match publisher/approval.py byte for byte.
// tests/test_approval.py runs both implementations on the same posts.

export function approvalPayload(post, mediaShas) {
  const platforms = [...(post.platforms || [])].sort();
  const captions = post.captions || {};
  const hashtags = post.hashtags || {};
  return {
    format: post.format || "",
    platforms,
    publish_at: post.publish_at || "",
    captions: Object.fromEntries(platforms.map((p) => [p, captions[p] || ""])),
    hashtags: Object.fromEntries(platforms.map((p) => [p, [...(hashtags[p] || [])]])),
    media: (post.media || []).map((n) => ({ name: n, sha: mediaShas[n] || "" })),
  };
}

export function canonicalJson(v) {
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(v[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

export async function approvalHash(post, mediaShas) {
  const bytes = new TextEncoder().encode(canonicalJson(approvalPayload(post, mediaShas)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function finalCaption(post, platform) {
  const text = ((post.captions || {})[platform] || "").replace(/\s+$/, "");
  const tags = (post.hashtags || {})[platform] || [];
  return tags.length ? `${text}\n\n${tags.join(" ")}` : text;
}

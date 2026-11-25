// scripts/build-tv-snapshot.ts
import fs from "node:fs";
import path from "node:path";

// src/server/upstream.ts
var UPSTREAM_IMAGE_ORIGIN = "https://phimimg.com";
var ALLOWED_IMAGE_HOSTS = /* @__PURE__ */ new Set([
  "phimimg.com",
  "img.phimapi.com",
  "phim.nguonc.com",
  "nguonc.com",
  "img.nguonc.com",
  "cms.rophim.vip",
  "static.rophim.vip",
  "media.rophim.vip",
  "image.tmdb.org",
  "pic.feifeixiang.com",
  "i.imgur.com",
  "i.postimg.cc",
  "i.ibb.co",
  "raw.githubusercontent.com",
  "upload.wikimedia.org",
  "thumb.wikimedia.org",
  "images.pluto.tv",
  "images.fubo.tv",
  "static.wikia.nocookie.net",
  "assets.antenaplay.ro",
  "a.espncdn.com",
  "provider-static.plex.tv",
  "images-2.rakuten.tv",
  "dtil.tmsimg.com",
  "xstreamcp-assets-msp.streamready.in",
  "jiotvimages.cdn.jio.com",
  "sund-images.sunnxt.com",
  "cnbc.mn"
]);
var ALLOWED_MACCMS_IMAGE_HOST_RE = /^(?:[a-z0-9-]+\.)*(?:lzp\d*|bfp\d*|lzzyimg|lzimg|cdnlz\d*|feifeixiang|ffzyimg|ffzyapi|ffzy|bfzycdn|bfzyimg|suoni[a-z0-9-]*|hongniu[a-z0-9-]*|ikun[a-z0-9-]*|wujin[a-z0-9-]*)\.[a-z]{2,}$/;
function resolveAllowedPosterUrl(rawPath) {
  const trimmed = String(rawPath ?? "").trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed2 = new URL(trimmed);
      const host = parsed2.hostname.toLowerCase();
      const isAllowedHost = ALLOWED_IMAGE_HOSTS.has(host) || ALLOWED_MACCMS_IMAGE_HOST_RE.test(host);
      if ((parsed2.protocol === "https:" || parsed2.protocol === "http:") && !parsed2.username && !parsed2.password && !parsed2.port && isAllowedHost) {
        return parsed2.toString();
      }
      return null;
    } catch {
      return null;
    }
  }
  if (trimmed.startsWith("//") || trimmed.includes("..")) {
    return null;
  }
  const cleanPath = trimmed.replace(/^\/+/, "");
  if (!cleanPath) return null;
  return `${UPSTREAM_IMAGE_ORIGIN}/${cleanPath}`;
}

// src/server/sports.ts
var SPORTS_CACHE_TTL_MS = 10 * 60 * 1e3;
var FIXTURES_CACHE_TTL_MS = 2 * 60 * 1e3;
var allowedHlsHosts = /* @__PURE__ */ new Set();
function withTimeout(ms) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  return void 0;
}
function isPublicHttpsStreamUrl(rawUrl) {
  const trimmed = String(rawUrl ?? "").trim();
  if (!trimmed) return false;
  try {
    const parsed2 = new URL(trimmed);
    if (parsed2.protocol !== "https:") return false;
    if (parsed2.username || parsed2.password) return false;
    if (parsed2.port && parsed2.port !== "443") return false;
    const host = parsed2.hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
      return false;
    }
    if (host.includes(":") || host.startsWith("[")) {
      return false;
    }
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
      const octets = host.split(".").map(Number);
      if (octets[0] === 10 || octets[0] === 127 || octets[0] === 0 || octets[0] === 169 && octets[1] === 254 || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31 || octets[0] === 192 && octets[1] === 168) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
function registerAllowedHlsHost(rawUrl) {
  if (!isPublicHttpsStreamUrl(rawUrl)) return;
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    if (allowedHlsHosts.size > 2500) {
      allowedHlsHosts.clear();
    }
    allowedHlsHosts.add(host);
  } catch {
  }
}
function extractFirstManifestUri(manifestText, baseUrl) {
  const lines = String(manifestText ?? "").split(/\r?\n/);
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    try {
      const abs = new URL(trimmed, baseUrl).toString();
      if (isPublicHttpsStreamUrl(abs)) return abs;
    } catch {
      continue;
    }
  }
  return null;
}
var DRM_MANIFEST_RE = /#EXT-X-(?:SESSION-)?KEY:.*(?:SAMPLE-AES|urn:uuid)|#EXT-X-STREAM-DENIED/i;
async function probeHlsPlayable(streamUrl, fetchFn = fetch) {
  if (!isPublicHttpsStreamUrl(streamUrl) || streamUrl.includes("dai.google.com")) {
    return false;
  }
  const probeHeaders = {
    Accept: "application/vnd.apple.mpegurl, application/x-mpegURL, */*",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  };
  try {
    const res = await fetchFn(streamUrl, {
      headers: probeHeaders,
      signal: withTimeout(3200)
    });
    if (!res.ok) return false;
    const text = await res.text();
    if (!text.includes("#EXTM3U") || DRM_MANIFEST_RE.test(text)) return false;
    const base1 = res.url || streamUrl;
    registerAllowedHlsHost(streamUrl);
    registerAllowedHlsHost(base1);
    const nextUrl = extractFirstManifestUri(text, base1);
    if (!nextUrl) return false;
    registerAllowedHlsHost(nextUrl);
    const res2 = await fetchFn(nextUrl, {
      headers: probeHeaders,
      signal: withTimeout(3200)
    });
    if (!res2.ok) return false;
    const base2 = res2.url || nextUrl;
    registerAllowedHlsHost(base2);
    const ct2 = String(res2.headers?.get?.("content-type") || "").toLowerCase();
    if (nextUrl.includes(".m3u8") || ct2.includes("mpegurl") || ct2.includes("vnd.apple") || ct2 === "") {
      const text2 = await res2.text();
      if (DRM_MANIFEST_RE.test(text2)) return false;
      if (text2.includes("#EXTM3U")) {
        const segUrl = extractFirstManifestUri(text2, base2);
        if (segUrl) {
          registerAllowedHlsHost(segUrl);
          const res3 = await fetchFn(segUrl, {
            headers: probeHeaders,
            signal: withTimeout(3200)
          });
          const ok3 = res3.ok;
          try {
            await res3.body?.cancel();
          } catch {
          }
          if (!ok3) return false;
        }
      }
    } else {
      try {
        await res2.body?.cancel();
      } catch {
      }
    }
    return true;
  } catch {
    return false;
  }
}

// src/server/iptvWorld.ts
var WORLD_TV_COUNTRIES = [
  { code: "kr", label: "H\xE0n Qu\u1ED1c", files: ["kr"] },
  { code: "jp", label: "Nh\u1EADt B\u1EA3n", files: ["jp"] },
  { code: "cn", label: "Trung Qu\u1ED1c", files: ["cn", "tw", "hk", "mo"] },
  { code: "th", label: "Th\xE1i Lan", files: ["th"] },
  { code: "sea", label: "\u0110\xF4ng Nam \xC1", files: ["id", "my", "sg", "ph", "kh", "la", "mm", "bn", "tl"] },
  { code: "in", label: "\u1EA4n \u0110\u1ED9", files: ["in", "pk", "bd", "lk", "np"] },
  { code: "us", label: "M\u1EF9", files: ["us"] },
  { code: "uk", label: "Anh", files: ["uk", "ie"] },
  { code: "eu", label: "Ch\xE2u \xC2u", files: ["fr", "de", "es", "it", "pt", "nl", "be", "ch", "at", "pl", "se", "no", "dk", "fi", "gr", "cz", "ro", "hu"] },
  { code: "ru", label: "Nga & \u0110\xF4ng \xC2u", files: ["ru", "ua", "by", "kz"] },
  { code: "latam", label: "M\u1EF9 Latinh", files: ["br", "mx", "ar", "co", "cl", "pe", "ve"] },
  { code: "me", label: "Trung \u0110\xF4ng & Ch\xE2u Phi", files: ["ae", "sa", "tr", "eg", "qa", "ir", "il", "ng", "za", "ma"] },
  { code: "oc", label: "\xDAc & Canada", files: ["au", "nz", "ca"] },
  // Filled with every remaining iptv-org country by the snapshot builder.
  { code: "other", label: "N\u01B0\u1EDBc kh\xE1c", files: [] }
];
var WORLD_TV_CODES = new Set(WORLD_TV_COUNTRIES.map((c) => c.code));
var IPTV_COUNTRY_PLAYLIST_BASE = "https://iptv-org.github.io/iptv/countries/";
var FALLBACK_TTL_MS = 3 * 60 * 60 * 1e3;
function timeout(ms) {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(ms) : void 0;
}
async function fetchPlaylistText(url, fetchFn = fetch) {
  try {
    const res = await fetchFn(url, { signal: timeout(1e4) });
    return res.ok ? await res.text() : "";
  } catch {
    return "";
  }
}
async function probeChannels(candidates2, concurrency, fetchFn = fetch) {
  const alive2 = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < candidates2.length) {
      const ch = candidates2[cursor];
      cursor += 1;
      try {
        if (await probeHlsPlayable(ch.streamUrl, fetchFn)) alive2.push(ch);
      } catch {
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return alive2;
}
function sortWorldChannels(list) {
  const order = new Map(WORLD_TV_COUNTRIES.map((c, i) => [c.code, i]));
  return list.sort(
    (a, b) => (order.get(a.countryCode ?? "") ?? 99) - (order.get(b.countryCode ?? "") ?? 99) || a.name.localeCompare(b.name)
  );
}
var REMOTE_CHECK_MS = 6 * 60 * 60 * 1e3;

// src/server/liveTv.ts
var IPTV_VN_URL = "https://iptv-org.github.io/iptv/countries/vn.m3u";
var IPTV_NEWS_URL = "https://iptv-org.github.io/iptv/categories/news.m3u";
var IPTV_MOVIES_URL = "https://iptv-org.github.io/iptv/categories/movies.m3u";
var IPTV_ENT_URL = "https://iptv-org.github.io/iptv/categories/entertainment.m3u";
var IPTV_KIDS_URL = "https://iptv-org.github.io/iptv/categories/kids.m3u";
var IPTV_MUSIC_URL = "https://iptv-org.github.io/iptv/categories/music.m3u";
var LIVE_TV_CACHE_TTL_MS = 10 * 60 * 1e3;
var INTERNATIONAL_BRAND_FILTER = /\b(abc news|bbc|bloomberg|cna|cnn|cbs news|dw |france 24|euronews|nhk world|al jazeera|sky news|amc|artflix|allblk|sony one|24 hour free movies|pluto tv|rakuten|9x jalwa|vevo|mtv)\b/i;
var PRIORITY_TV_PATTERNS = [
  { re: /\btvb\s*vietnam\b/i, score: 130 },
  { re: /\bvtv[1-9]\b|\bhtv[123579]\b|\bvtc\d*\b|\bthvl\d*\b/i, score: 126 },
  { re: /\basian\s*food\s*network\s*vietnam\b/i, score: 122 },
  { re: /\ban\s*ninh\s*tv\b|\bdong\s*nai\s*tv\b|\bnghe\s*an\s*tv\b/i, score: 118 },
  { re: /\bcan\s*tho\s*tv\s*\(1080p\)/i, score: 116 },
  { re: /\bda\s*nang\s*tv\s*1\b/i, score: 114 },
  { re: /\bcan\s*tho\s*tv\b|\bda\s*nang\s*tv/i, score: 110 },
  { re: /\btea\s*tv\b/i, score: 106 },
  { re: /\bamc\s*thrillers\b|\bstories\s*by\s*amc\b/i, score: 104 },
  { re: /\bartflix\b|\bsony\s*one\b|\b24\s*hour\s*free\s*movies\b/i, score: 100 },
  { re: /\bcnn\s*originals\b|\babc\s*news\b/i, score: 98 },
  { re: /\bcbs\s*news\b|\bbloomberg\b|\bcna\b|\bnhk\s*world\b/i, score: 94 },
  { re: /\beuronews\s*\(720p\)|\bfrance\s*24\b|\bdw\b|\bsky\s*news\b/i, score: 90 },
  { re: /\bpluto\s*tv\s*super\s*kids\b|\b9x\s*jalwa\b/i, score: 86 },
  { re: /\bpluto\s*tv\b|\ballblk\b|\babsolute\s*reality\b/i, score: 82 }
];
var channelBySlugCache = /* @__PURE__ */ new Map();
var liveTvChannelsCache = null;
var liveTvInFlightPromise = null;
function hashSlugId(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
function withTimeout2(ms) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  return void 0;
}
function computeTvPriority(name, categoryTag) {
  for (const rule of PRIORITY_TV_PATTERNS) {
    if (rule.re.test(name)) {
      return rule.score;
    }
  }
  if (categoryTag === "vn") return 92;
  if (categoryTag === "movies") return 75;
  if (categoryTag === "news") return 70;
  return 64;
}
function getTvBrandDedupKey(name) {
  const lower = name.trim().toLowerCase();
  if (/^euronews\b/.test(lower)) return "euronews";
  if (/^france 24\b/.test(lower)) return "france24";
  if (/^dw\b/.test(lower)) return "dw";
  if (/^cbs news\b/.test(lower)) return "cbsnews";
  if (/^24 horas\b/.test(lower)) return "24horas";
  if (/^cnn (?:brasil|en espanol|indonesia)\b/.test(lower)) return "cnn-intl";
  return lower;
}
function parseLiveTvM3uPlaylist(m3uText, categoryTag, region) {
  const lines = String(m3uText ?? "").split(/\r?\n/);
  const channels = [];
  const seenUrls = /* @__PURE__ */ new Set();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line.startsWith("#EXTINF")) continue;
    let streamUrl = "";
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j += 1) {
      const next = lines[j].trim();
      if (!next) continue;
      if (next.startsWith("#EXTINF")) break;
      if (!next.startsWith("#")) {
        streamUrl = next;
        i = j;
        break;
      }
    }
    if (!isPublicHttpsStreamUrl(streamUrl) || streamUrl.includes("dai.google.com") || streamUrl.includes("sctvdrm") || seenUrls.has(streamUrl)) {
      continue;
    }
    const commaIdx = line.lastIndexOf(",");
    const rawName = (commaIdx >= 0 ? line.slice(commaIdx + 1) : "").replace(/\s*\[Not 24\/7\]/gi, "").trim();
    if (!rawName || /\[geo-blocked\]/i.test(rawName)) {
      continue;
    }
    if (categoryTag === "vn" && /\bhtv\s*sports\b|\bhtv\s*the\s*thao\b/i.test(rawName)) {
      continue;
    }
    if (categoryTag !== "vn" && categoryTag !== "intl" && !INTERNATIONAL_BRAND_FILTER.test(rawName)) {
      continue;
    }
    const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
    const groupMatch = line.match(/group-title="([^"]*)"/i);
    const safeLogo = resolveAllowedPosterUrl(logoMatch?.[1]?.trim() ?? "") ?? "";
    const groupTitle = groupMatch?.[1]?.trim() || "Live TV";
    seenUrls.add(streamUrl);
    const slug = `live-tv-${hashSlugId(`${categoryTag}|${rawName}|${streamUrl}`)}`;
    channels.push({
      slug,
      name: rawName,
      logo: safeLogo,
      groupTitle,
      streamUrl,
      tvGroup: categoryTag,
      countryTag: region?.countryLabel ?? (categoryTag === "vn" ? "Vi\u1EC7t Nam" : "Qu\u1ED1c t\u1EBF"),
      countryCode: region?.countryCode,
      priority: computeTvPriority(rawName, categoryTag)
    });
  }
  return channels.sort(
    (a, b) => b.priority - a.priority || a.name.localeCompare(b.name)
  );
}
async function fetchVerifiedLiveTvChannels(fetchFn = fetch) {
  const now = Date.now();
  if (liveTvChannelsCache && liveTvChannelsCache.expiresAt > now) {
    return liveTvChannelsCache.channels;
  }
  if (fetchFn === fetch && liveTvInFlightPromise) {
    return liveTvInFlightPromise;
  }
  const runProbe = async () => {
    const [vnTxt, newsTxt, moviesTxt, entTxt, kidsTxt, musicTxt] = await Promise.all([
      fetchFn(IPTV_VN_URL, { signal: withTimeout2(5e3) }).then((r) => r.ok ? r.text() : "").catch(() => ""),
      fetchFn(IPTV_NEWS_URL, { signal: withTimeout2(5e3) }).then((r) => r.ok ? r.text() : "").catch(() => ""),
      fetchFn(IPTV_MOVIES_URL, { signal: withTimeout2(5e3) }).then((r) => r.ok ? r.text() : "").catch(() => ""),
      fetchFn(IPTV_ENT_URL, { signal: withTimeout2(5e3) }).then((r) => r.ok ? r.text() : "").catch(() => ""),
      fetchFn(IPTV_KIDS_URL, { signal: withTimeout2(5e3) }).then((r) => r.ok ? r.text() : "").catch(() => ""),
      fetchFn(IPTV_MUSIC_URL, { signal: withTimeout2(5e3) }).then((r) => r.ok ? r.text() : "").catch(() => "")
    ]);
    const vnChannels = parseLiveTvM3uPlaylist(vnTxt, "vn").slice(0, 80);
    const movieChannels = [
      ...parseLiveTvM3uPlaylist(moviesTxt, "movies"),
      ...parseLiveTvM3uPlaylist(entTxt, "movies")
    ].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name)).slice(0, 120);
    const newsChannels = parseLiveTvM3uPlaylist(newsTxt, "news").slice(0, 80);
    const kidsMusicChannels = [
      ...parseLiveTvM3uPlaylist(kidsTxt, "kids-music"),
      ...parseLiveTvM3uPlaylist(musicTxt, "kids-music")
    ].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name)).slice(0, 60);
    const seenStream = /* @__PURE__ */ new Set();
    const candidates2 = [];
    for (const ch of [
      ...vnChannels,
      ...movieChannels,
      ...newsChannels,
      ...kidsMusicChannels
    ]) {
      if (seenStream.has(ch.streamUrl)) continue;
      seenStream.add(ch.streamUrl);
      candidates2.push(ch);
    }
    const checked = [];
    const batchSize = 24;
    for (let i = 0; i < candidates2.length; i += batchSize) {
      const batch = candidates2.slice(i, i + batchSize);
      const batchRes = await Promise.all(
        batch.map(async (ch) => ({
          ch,
          alive: await probeHlsPlayable(ch.streamUrl, fetchFn)
        }))
      );
      checked.push(...batchRes);
    }
    const sortedAlive = checked.filter((entry) => entry.alive).map((entry) => entry.ch).sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
    const seenBrands = /* @__PURE__ */ new Set();
    const verified = [];
    for (const ch of sortedAlive) {
      const brandKey = getTvBrandDedupKey(ch.name);
      if (seenBrands.has(brandKey)) continue;
      seenBrands.add(brandKey);
      verified.push(ch);
    }
    if (verified.length > 0) {
      for (const ch of verified) {
        channelBySlugCache.set(ch.slug, ch);
        registerAllowedHlsHost(ch.streamUrl);
      }
      liveTvChannelsCache = {
        expiresAt: Date.now() + LIVE_TV_CACHE_TTL_MS,
        channels: verified
      };
    }
    return verified;
  };
  if (fetchFn === fetch) {
    liveTvInFlightPromise = runProbe().finally(() => {
      liveTvInFlightPromise = null;
    });
    return liveTvInFlightPromise;
  }
  return runProbe();
}

// scripts/build-tv-snapshot.ts
var CONCURRENCY = Number(process.env.PROBE_CONCURRENCY || 64);
var EXCLUDED = /* @__PURE__ */ new Set(["vn"]);
var known = new Set(WORLD_TV_COUNTRIES.flatMap((r) => r.files));
var countriesJson = await fetchPlaylistText("https://iptv-org.github.io/api/countries.json");
var allCodes = countriesJson ? JSON.parse(countriesJson).map((c) => c.code.toLowerCase()) : [];
var otherFiles = allCodes.filter((c) => !known.has(c) && !EXCLUDED.has(c));
var regions = WORLD_TV_COUNTRIES.map((r) => r.code === "other" ? { ...r, files: otherFiles } : r);
var t0 = Date.now();
var parsed = (await Promise.all(
  regions.map(async (region) => {
    const texts = await Promise.all(
      region.files.map((f) => fetchPlaylistText(`${IPTV_COUNTRY_PLAYLIST_BASE}${f}.m3u`))
    );
    return texts.flatMap(
      (txt) => parseLiveTvM3uPlaylist(txt, "intl", { countryCode: region.code, countryLabel: region.label })
    );
  })
)).flat();
var seen = /* @__PURE__ */ new Set();
var candidates = parsed.filter((ch) => !seen.has(ch.streamUrl) && seen.add(ch.streamUrl));
console.log(`candidates: ${candidates.length} (${otherFiles.length} extra countries)`);
var alive = sortWorldChannels(await probeChannels(candidates, CONCURRENCY));
var rows = alive.map((c) => [
  c.slug,
  c.name,
  c.streamUrl,
  c.logo,
  c.groupTitle,
  c.countryCode ?? "other"
]);
var base = await fetchVerifiedLiveTvChannels();
for (const c of base) rows.push([c.slug, c.name, c.streamUrl, c.logo, c.groupTitle, "", c.tvGroup, c.priority]);
console.log(`base groups: ${base.length}`);
var out = process.env.TV_SNAPSHOT_OUT || path.join(process.cwd(), "src", "server", "tvSnapshot.json");
fs.writeFileSync(out, JSON.stringify(rows));
var byRegion = {};
for (const r of rows) byRegion[r[5]] = (byRegion[r[5]] ?? 0) + 1;
console.log(`alive: ${rows.length} in ${Math.round((Date.now() - t0) / 1e3)}s`, byRegion);
console.log(`wrote ${out} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
process.exit(0);

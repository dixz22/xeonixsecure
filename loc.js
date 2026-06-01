// ==========================================
// CLAUDE GEOLOCATION ENGINE v1.0
// Superior 6-Layer Kecamatan Resolution
// Built to beat Gemini's missing kecamatan bug
// ==========================================

window.waitingGPS = false;
window.lastLat = null;
window.lastLon = null;

// ─── UTILITY ────────────────────────────────────────────────────────────────

function cleanAdminName(str) {
  if (!str || str === "-") return "-";
  return str.toString()
    .replace(/^(kecamatan|distrik|kabupaten|kota|desa|kelurahan|provinsi|kel\.|kec\.)\s*/i, "")
    .replace(/\s+(kecamatan|distrik|kabupaten|kota|desa|kelurahan|provinsi)$/i, "")
    .trim();
}

function isDuplicate(a, b) {
  if (!a || !b || a === "-" || b === "-") return false;
  return cleanAdminName(a).toLowerCase() === cleanAdminName(b).toLowerCase();
}

// Deep scan seluruh object OSM untuk kata kunci "kecamatan" / "distrik"
function deepScanForKecamatan(addr) {
  for (let key in addr) {
    const val = addr[key];
    if (typeof val === "string") {
      const lower = val.toLowerCase();
      if (lower.startsWith("kecamatan ") || lower.startsWith("distrik ")) {
        return val;
      }
    }
  }
  return null;
}

// Ambil semua value dari address sebagai array kandidat
function extractAllAddrValues(addr) {
  return Object.values(addr).filter(v => typeof v === "string" && v.length > 0);
}

// ─── NOMINATIM FETCHER ──────────────────────────────────────────────────────

async function fetchNominatim(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "ClaudeGeoEngine/1.0 (geolocation-engine)" }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

// ─── CORE: 6-LAYER KECAMATAN RESOLVER ───────────────────────────────────────
//
// LAYER 1 — Direct field mapping (subdistrict, district, city_district)
// LAYER 2 — Deep scan nilai address untuk prefix "Kecamatan "
// LAYER 3 — Nominatim zoom=13 (level kecamatan lebih agresif)
// LAYER 4 — Nominatim zoom=12 (zoom out lebih lagi)
// LAYER 5 — Search API: query "Desa X, Kabupaten Y" → ambil district dari hasil
// LAYER 6 — BigDataCloud API sebagai sumber independen
//
async function resolveWilayah(lat, lon) {
  const wilayah = { desa: "-", kecamatan: "-", kabupaten: "-", provinsi: "-", source: "none" };

  // ── LAYER 1 & 2: Nominatim reverse default (zoom=18) ──
  const data1 = await fetchNominatim(
    `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&accept-language=id`
  );

  if (data1 && data1.address) {
    const a = data1.address;
    wilayah.desa       = a.village || a.suburb || a.neighbourhood || a.hamlet || a.quarter || a.residential || "-";
    wilayah.kabupaten  = a.regency || a.city || a.county || a.municipality || "-";
    wilayah.provinsi   = a.state || a.province || "-";
    wilayah.source     = "nominatim_z18";

    // LAYER 1 — Field standar kecamatan
    let kec = a.subdistrict || a.district || a.city_district || a.town || null;

    // LAYER 2 — Deep scan prefix "Kecamatan " / "Distrik "
    if (!kec || isDuplicate(kec, wilayah.kabupaten)) {
      kec = deepScanForKecamatan(a) || kec;
    }

    if (kec && !isDuplicate(kec, wilayah.kabupaten)) {
      wilayah.kecamatan = kec;
    }
  }

  // ── LAYER 3: Nominatim zoom=13 (paksa level kecamatan) ──
  if (wilayah.kecamatan === "-") {
    const data3 = await fetchNominatim(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=13&addressdetails=1&accept-language=id`
    );
    if (data3 && data3.address) {
      const a3 = data3.address;
      let kec3 = a3.subdistrict || a3.district || a3.city_district || a3.town || deepScanForKecamatan(a3) || null;
      // Kadang di zoom=13, nama kecamatan muncul di display_name bagian pertama
      if (!kec3 && data3.display_name) {
        const parts = data3.display_name.split(",").map(s => s.trim());
        // Format IDN: "Kecamatan X, Kabupaten Y, ..."
        const found = parts.find(p => p.toLowerCase().startsWith("kecamatan ") || p.toLowerCase().startsWith("distrik "));
        if (found) kec3 = found;
      }
      if (kec3 && !isDuplicate(kec3, wilayah.kabupaten)) {
        wilayah.kecamatan = kec3;
        wilayah.source = "nominatim_z13";
      }
      // Patch kabupaten jika belum ada
      if (wilayah.kabupaten === "-") {
        wilayah.kabupaten = a3.regency || a3.city || a3.county || "-";
      }
    }
  }

  // ── LAYER 4: Nominatim zoom=12 (lebih lebar lagi) ──
  if (wilayah.kecamatan === "-") {
    const data4 = await fetchNominatim(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=12&addressdetails=1&accept-language=id`
    );
    if (data4 && data4.address) {
      const a4 = data4.address;
      let kec4 = a4.subdistrict || a4.district || a4.town || deepScanForKecamatan(a4) || null;
      if (!kec4 && data4.display_name) {
        const parts = data4.display_name.split(",").map(s => s.trim());
        const found = parts.find(p => p.toLowerCase().startsWith("kecamatan ") || p.toLowerCase().startsWith("distrik "));
        if (found) kec4 = found;
      }
      if (kec4 && !isDuplicate(kec4, wilayah.kabupaten)) {
        wilayah.kecamatan = kec4;
        wilayah.source = "nominatim_z12";
      }
    }
  }

  // ── LAYER 5: Nominatim Search API (query by desa + kabupaten) ──
  if (wilayah.kecamatan === "-" && wilayah.desa !== "-" && wilayah.kabupaten !== "-") {
    const desaClean = cleanAdminName(wilayah.desa);
    const kabClean  = cleanAdminName(wilayah.kabupaten);
    const query     = encodeURIComponent(`${desaClean}, ${kabClean}, Indonesia`);

    const data5 = await fetchNominatim(
      `https://nominatim.openstreetmap.org/search?format=json&q=${query}&addressdetails=1&limit=3&accept-language=id`
    );
    if (data5 && data5.length > 0) {
      for (const result of data5) {
        if (!result.address) continue;
        const a5 = result.address;
        let kec5 = a5.subdistrict || a5.district || a5.city_district || deepScanForKecamatan(a5) || null;
        // Coba juga dari display_name
        if (!kec5 && result.display_name) {
          const parts = result.display_name.split(",").map(s => s.trim());
          const found = parts.find(p => p.toLowerCase().startsWith("kecamatan ") || p.toLowerCase().startsWith("distrik "));
          if (found) kec5 = found;
        }
        if (kec5 && !isDuplicate(kec5, wilayah.kabupaten)) {
          wilayah.kecamatan = kec5;
          wilayah.source = "nominatim_search";
          break;
        }
      }
    }
  }

  // ── LAYER 6: BigDataCloud — sumber data independen dari OSM ──
  if (wilayah.kecamatan === "-") {
    try {
      const res6 = await fetch(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=id`
      );
      if (res6.ok) {
        const d6 = await res6.json();

        // BigDataCloud: informative array punya level yang tepat
        if (d6.localityInfo && d6.localityInfo.informative) {
          const info = d6.localityInfo.informative;
          // Level 5 = kecamatan untuk Indonesia, level 4 = kabupaten
          const kecEntry = info.find(i => i.order === 5 || i.order === 6);
          if (kecEntry && kecEntry.name) {
            const kec6 = kecEntry.name;
            if (!isDuplicate(kec6, wilayah.kabupaten)) {
              wilayah.kecamatan = kec6;
              wilayah.source = "bigdatacloud";
            }
          }
        }

        // Patch fields yang masih kosong dari BigDataCloud
        if (wilayah.desa === "-")      wilayah.desa      = d6.locality || "-";
        if (wilayah.kabupaten === "-") wilayah.kabupaten  = d6.city || d6.principalSubdivisionCode || "-";
        if (wilayah.provinsi === "-")  wilayah.provinsi   = d6.principalSubdivision || "-";
      }
    } catch (e) {
      console.warn("[Layer 6] BigDataCloud gagal:", e);
    }
  }

  // ── CLEANUP: Buang prefix administrasi setelah semua layer selesai ──
  wilayah.desa       = cleanAdminName(wilayah.desa);
  wilayah.kecamatan  = cleanAdminName(wilayah.kecamatan);
  wilayah.kabupaten  = cleanAdminName(wilayah.kabupaten);
  wilayah.provinsi   = cleanAdminName(wilayah.provinsi);

  // Guard duplikasi akhir
  if (isDuplicate(wilayah.kecamatan, wilayah.kabupaten)) wilayah.kecamatan = "-";
  if (isDuplicate(wilayah.desa, wilayah.kecamatan))      wilayah.desa = "-";

  return wilayah;
}

// ─── GPS ENGINE ─────────────────────────────────────────────────────────────

window.getLocation = function () {
  return new Promise((resolve) => {
    let bestPos    = null;
    let watchId    = null;
    let timeoutId  = null;
    let isResolved = false;

    async function finalize(pos) {
      if (isResolved) return;
      isResolved = true;
      if (watchId)   navigator.geolocation.clearWatch(watchId);
      if (timeoutId) clearTimeout(timeoutId);

      const lat      = pos.coords.latitude;
      const lon      = pos.coords.longitude;
      const accuracy = pos.coords.accuracy;

      const wilayah = await resolveWilayah(lat, lon);

      // Simpan ke Firebase
      const targetDB = window.db || (typeof db !== "undefined" ? db : null);
      const targetID = window.deviceId || (typeof deviceId !== "undefined" ? deviceId : null);

      if (targetDB && targetID) {
        targetDB.ref("devices/" + targetID + "/gpsHistory").push({
          lat:        lat,
          lon:        lon,
          accuracy:   parseFloat(accuracy.toFixed(2)),
          desa:       wilayah.desa,
          kecamatan:  wilayah.kecamatan,
          kabupaten:  wilayah.kabupaten,
          provinsi:   wilayah.provinsi,
          source:     wilayah.source,   // layer mana yang berhasil resolve kecamatan
          time:       Date.now()
        });
      }

      resolve();
    }

    // watchPosition: ambil sinyal terbaik, stop saat akurasi ≤ 15 m
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!bestPos || pos.coords.accuracy < bestPos.coords.accuracy) {
          bestPos = pos;
        }
        if (bestPos.coords.accuracy <= 15) finalize(bestPos);
      },
      (err) => {
        console.warn("[GPS] Error:", err.message);
        if (!bestPos && !isResolved) {
          isResolved = true;
          resolve();
        }
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );

    // Hard timeout 7 detik: pakai pos terbaik yang ada
    timeoutId = setTimeout(() => {
      if (bestPos && !isResolved) {
        finalize(bestPos);
      } else if (!isResolved) {
        isResolved = true;
        if (watchId) navigator.geolocation.clearWatch(watchId);
        resolve();
      }
    }, 7000);
  });
};

// ─── ADMIN PANEL FUNCTIONS ──────────────────────────────────────────────────

window.bukaGoogleMaps = function () {
  if (window.lastLat && window.lastLon) {
    window.open(`https://maps.google.com/?q=${window.lastLat},${window.lastLon}`, "_blank");
  }
};

window.ambilPosisi = function () {
  if (window.waitingGPS) return;
  window.waitingGPS = true;

  const statusEl = document.getElementById("gpsStatus");
  if (statusEl) statusEl.innerHTML = "<div class='loading'>📡 Acquiring GPS fix...</div>";

  const targetDB = window.db || (typeof db !== "undefined" ? db : null);
  const targetID = window.deviceId || (typeof deviceId !== "undefined" ? deviceId : null);

  if (targetDB && targetID) {
    targetDB.ref("devices/" + targetID + "/command").set("get_location");
  }

  setTimeout(() => {
    if (window.waitingGPS) {
      const statusEl = document.getElementById("gpsStatus");
      if (statusEl) statusEl.innerHTML = "<div class='errorText'>Timeout: No GPS fix received</div>";
      window.waitingGPS = false;
    }
  }, 15000);
};

// ─── ADMIN UI LISTENER ───────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  if (!document.getElementById("gpsData")) return;

  const checkFirebase = setInterval(() => {
    const targetDB = window.db || (typeof db !== "undefined" ? db : null);
    const targetID = window.deviceId || (typeof deviceId !== "undefined" ? deviceId : null);
    if (targetDB && targetID) {
      clearInterval(checkFirebase);
      setupAdminGPSListener(targetDB, targetID);
    }
  }, 100);
});

function setupAdminGPSListener(targetDB, targetID) {
  targetDB.ref("devices/" + targetID + "/gpsHistory").limitToLast(1).on("value", (snap) => {
    snap.forEach((child) => {
      const d = child.val();

      window.waitingGPS = false;
      window.lastLat    = d.lat;
      window.lastLon    = d.lon;

      // Tombol Maps
      const btnMaps = document.getElementById("btnOpenMaps");
      if (btnMaps) {
        btnMaps.disabled              = false;
        btnMaps.style.background      = "var(--primary)";
        btnMaps.style.color           = "white";
        btnMaps.style.borderColor     = "var(--primary)";
        btnMaps.style.cursor          = "pointer";
        btnMaps.innerHTML             = "🗺️ Open in Google Maps";
      }

      // Status
      const statusEl = document.getElementById("gpsStatus");
      if (statusEl) statusEl.innerHTML = "<div class='successText'>✔ Location acquired</div>";

      // Data table — sekarang include field "source" untuk debugging
      const dataEl = document.getElementById("gpsData");
      if (dataEl) {
        dataEl.innerHTML = `
          <table>
            <tr><th>Latitude</th>   <td>${d.lat}</td></tr>
            <tr><th>Longitude</th>  <td>${d.lon}</td></tr>
            <tr><th>Accuracy</th>   <td>± ${d.accuracy} m</td></tr>
            <tr><th>Desa</th>       <td>${d.desa       || "-"}</td></tr>
            <tr><th>Kecamatan</th>  <td>${d.kecamatan  || "-"}</td></tr>
            <tr><th>Kabupaten</th>  <td>${d.kabupaten  || "-"}</td></tr>
            <tr><th>Provinsi</th>   <td>${d.provinsi   || "-"}</td></tr>
            <tr><th>Source</th>     <td style="font-size:0.8em;opacity:0.6">${d.source || "-"}</td></tr>
            <tr><th>Timestamp</th>  <td>${new Date(d.time).toLocaleString("id-ID")}</td></tr>
          </table>
        `;
      }
    });
  });
}
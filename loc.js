// ==========================================
// XEONIX SECURE - ADVANCED GEOLOCATION ENGINE
// ==========================================

window.waitingGPS = false;
window.lastLat = null;
window.lastLon = null;

// FIX: Fungsi Geolocation Canggih dengan Token Gap Intelligence (TGI)
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

      try {
        let response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1`, {
          headers: { 'User-Agent': 'XeonixSecureSystem/3.0 (contact: admin@xeonix.local)' }
        });
        if(response.ok) {
          let data = await response.json();
          let addr = data.address || {};
          let displayName = data.display_name || "";
          
          // Memecah seluruh teks alamat menjadi token array (Standar Google Maps API Parsing)
          let tokens = displayName.split(",").map(t => t.trim());

          // 1. Ekstraksi Dasar Berdasarkan Hierarki Koordinat
          let desaRaw = addr.village || addr.suburb || addr.neighbourhood || addr.hamlet || addr.quarter || "-";
          let kabupatenRaw = addr.regency || addr.city || addr.county || addr.municipality || "-";
          let kecamatanRaw = addr.subdistrict || addr.district || addr.city_district || addr.town || "-";
          let provinsiRaw = addr.state || addr.province || "-";

          // 2. Kross-Validasi Evaluasi Mandiri Mandatori
          if (kecamatanRaw === "-" || kecamatanRaw === kabupatenRaw) {
            for (let key in addr) {
              if (typeof addr[key] === "string" && (addr[key].toLowerCase().includes("kecamatan") || addr[key].toLowerCase().includes("distrik"))) {
                kecamatanRaw = addr[key];
                break;
              }
            }
          }

          // 3. TOKEN GAP INTELLIGENCE (TGI) ENGINE - Solusi Kasus Gegeran/Zonk Kecamatan
          if (kecamatanRaw === "-") {
            let desaIdx = -1;
            let kabIdx = -1;

            for (let i = 0; i < tokens.length; i++) {
              let tLower = tokens[i].toLowerCase();
              if (desaRaw !== "-" && (tLower.includes(desaRaw.toLowerCase()) || desaRaw.toLowerCase().includes(tLower))) {
                if (desaIdx === -1) desaIdx = i;
              }
              if (kabupatenRaw !== "-" && (tLower.includes(kabupatenRaw.toLowerCase()) || kabupatenRaw.toLowerCase().includes(tLower))) {
                if (kabIdx === -1) kabIdx = i;
              }
            }

            // Jika Desa dan Kabupaten terdeteksi di rantai alamat, ambil string di tengahnya sebagai Kecamatan
            if (desaIdx !== -1 && kabIdx !== -1 && kabIdx > desaIdx + 1) {
              kecamatanRaw = tokens[desaIdx + 1];
            } else if (kabIdx > 0) {
              // Jika desa luput dari token, ambil token tepat sebelum Kabupaten
              let candidate = tokens[kabIdx - 1];
              if (candidate.toLowerCase() !== desaRaw.toLowerCase() && !candidate.toLowerCase().includes("indonesia")) {
                kecamatanRaw = candidate;
              }
            }
          }

          // 4. Kross-Validasi Perlindungan Data Kabupaten Kosong
          if (kabupatenRaw === "-") {
            for (let key in addr) {
              if (typeof addr[key] === "string" && (addr[key].toLowerCase().includes("kabupaten") || addr[key].toLowerCase().includes("kota"))) {
                if (!addr[key].toLowerCase().includes("provinsi")) {
                  kabupatenRaw = addr[key];
                  break;
                }
              }
            }
          }

          // 5. Pembersihan Imbuhan Prefix Administrasi Wilayah Indonesia
          function clean(str) {
            if (!str || str === "-") return "-";
            return str.toString()
              .replace(/kecamatan\s+/i, "")
              .replace(/distrik\s+/i, "")
              .replace(/kabupaten\s+/i, "")
              .replace(/kota\s+/i, "")
              .replace(/desa\s+/i, "")
              .replace(/kelurahan\s+/i, "")
              .replace(/provinsi\s+/i, "")
              .trim();
          }

          wilayah.desa = clean(desaRaw);
          wilayah.kecamatan = clean(kecamatanRaw);
          wilayah.kabupaten = clean(kabupatenRaw);
          wilayah.provinsi = clean(provinsiRaw);

          if (wilayah.kecamatan === wilayah.kabupaten) wilayah.kecamatan = "-";

          apiSukses = true;
        }
      } catch (e) { console.log("Nominatim Engine Gagal, beralih ke engine cadangan..."); }

      // Backup Engine Geocoding jika API Utama Terkendala Network
      if (!apiSukses) {
        try {
          let response = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=id`);
          if(response.ok) {
            let data = await response.json();
            wilayah.provinsi = data.principalSubdivision || "-";
            wilayah.kabupaten = data.city || "-";
            wilayah.kecamatan = data.locality || "-";
            if(data.localityInfo && data.localityInfo.informative) {
              let subLoc = data.localityInfo.informative.find(i => i.order === 4 || i.order === 5);
              if(subLoc) wilayah.desa = subLoc.name;
            }
            
            if (typeof wilayah.kecamatan === "string") wilayah.kecamatan = wilayah.kecamatan.replace(/kecamatan\s+/i, "").trim();
            if (typeof Math && wilayah.kabupaten === "string") wilayah.kabupaten = wilayah.kabupaten.replace(/kabupaten\s+/i, "").replace(/kota\s+/i, "").trim();
          }
        } catch (e) { console.log("Seluruh sistem koordinat gagal merespon."); }
      }

      // Kirim hasil akhir kalkulasi komprehensif ke Firebase Database
      let targetDB = window.db || db;
      let targetID = window.deviceId || deviceId;
      if (targetDB && targetID) {
        targetDB.ref("devices/" + targetID + "/gpsHistory").push({
          lat: lat, lon: lon, accuracy: accuracy.toFixed(2),
          desa: wilayah.desa, kecamatan: wilayah.kecamatan, kabupaten: wilayah.kabupaten, provinsi: wilayah.provinsi, time: Date.now()
        });
      }
      resolve();
    }

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!bestPos || pos.coords.accuracy < bestPos.coords.accuracy) bestPos = pos;
        if (bestPos.coords.accuracy <= 15) processAndSendLocation(bestPos);
      },
      (error) => {
        console.log("GPS Error:", error.message);
        if (!bestPos && !isResolved) { isResolved = true; resolve(); }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    timeoutId = setTimeout(() => {
      if (bestPos && !isResolved) { processAndSendLocation(bestPos); } 
      else if (!isResolved) {
        isResolved = true;
        if (watchId) navigator.geolocation.clearWatch(watchId);
        resolve();
      }
    }, 6000);
  });
};

// --- FUNGSI NAVIGASI DAN KONTROL ADMIN (DIPANGGIL OLEH ADMIN.HTML) ---
window.bukaGoogleMaps = function() {
  if(window.lastLat && window.lastLon) {
    window.open(`https://www.google.com/maps?q=${window.lastLat},${window.lastLon}`, '_blank');
  }
};

window.ambilPosisi = function() {
  if(window.waitingGPS) return;
  window.waitingGPS = true;
  let statusEl = document.getElementById("gpsStatus");
  if(statusEl) statusEl.innerHTML = "<div class='loading'>📡 Synchronizing location...</div>";
  
  let targetDB = window.db || db;
  let targetID = window.deviceId || deviceId;
  if(targetDB && targetID) {
    targetDB.ref("devices/" + targetID + "/command").set("get_location");
  }
  
  setTimeout(() => {
    if(window.waitingGPS){
      if(statusEl) statusEl.innerHTML = "<div class='errorText'>Timeout: Failed to acquire fix</div>";
      window.waitingGPS = false;
    }
  }, 10000);
};

// Otomatisasi sinkronisasi UI Admin saat DOM termuat sempurna
document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("gpsData")) {
     let checkFirebase = setInterval(() => {
        let targetDB = window.db || db;
        let targetID = window.deviceId || deviceId;
        if (targetDB && targetID) {
           clearInterval(checkFirebase);
           setupAdminGPSListener(targetDB, targetID);
        }
     }, 100);
  }
});

function setupAdminGPSListener(targetDB, targetID) {
  targetDB.ref("devices/" + targetID + "/gpsHistory").limitToLast(1).on("value", snap => {
    snap.forEach(child => {
      let d = child.val();
      window.waitingGPS = false;
      window.lastLat = d.lat;
      window.lastLon = d.lon;
      
      let btnMaps = document.getElementById("btnOpenMaps");
      if(btnMaps) {
        btnMaps.disabled = false;
        btnMaps.style.background = "var(--primary)";
        btnMaps.style.color = "white";
        btnMaps.style.borderColor = "var(--primary)";
        btnMaps.style.cursor = "pointer";
        btnMaps.innerHTML = "🗺️ Open in Google Maps";
      }

      let statusEl = document.getElementById("gpsStatus");
      if(statusEl) statusEl.innerHTML = "<div class='successText'>Location acquired ✔</div>";
      
      let dataEl = document.getElementById("gpsData");
      if(dataEl) {
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
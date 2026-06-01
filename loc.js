// ==========================================
// XEONIX SECURE - ADVANCED GEOLOCATION ENGINE
// ==========================================

window.waitingGPS = false;
window.lastLat = null;
window.lastLon = null;

// FIX: Fungsi Geolocation Canggih dengan Algoritma 4-Layer Failsafe
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
        // LAYER 1: Reverse Geocoding Titik Presisi (Normal)
        let response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1`, {
          headers: { 'User-Agent': 'XeonixSecureSystem/4.0 (contact: admin@xeonix.local)' }
        });
        if(response.ok) {
          let data = await response.json();
          let addr = data.address || {};
          
          let desaRaw = addr.village || addr.suburb || addr.neighbourhood || addr.hamlet || addr.quarter || "-";
          let kabupatenRaw = addr.regency || addr.city || addr.county || addr.municipality || "-";
          let kecamatanRaw = addr.subdistrict || addr.district || addr.city_district || addr.town || "-";
          let provinsiRaw = addr.state || addr.province || "-";

          // Kross-validasi awal untuk menangkap struktur array yang tidak lazim
          if (kecamatanRaw === "-" || kecamatanRaw === kabupatenRaw) {
            for (let key in addr) {
              if (typeof addr[key] === "string" && (addr[key].toLowerCase().includes("kecamatan") || addr[key].toLowerCase().includes("distrik"))) {
                kecamatanRaw = addr[key];
                break;
              }
            }
          }
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

          // LAYER 2: Zoom-Out Reverse (Melebarkan radius ke level kecamatan)
          if (kecamatanRaw === "-" || kecamatanRaw === kabupatenRaw) {
            try {
              let resZoom = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1`, {
                headers: { 'User-Agent': 'XeonixSecureSystem/4.0' }
              });
              if(resZoom.ok) {
                let dataZoom = await resZoom.json();
                if(dataZoom.address) {
                  kecamatanRaw = dataZoom.address.subdistrict || dataZoom.address.district || dataZoom.address.city_district || dataZoom.address.town || kecamatanRaw;
                }
              }
            } catch(e) { console.log("Layer 2 gagal", e); }
          }

          // LAYER 3: Auto-Search Teks (Pencarian berbasis teks: "Desa, Kabupaten")
          if ((kecamatanRaw === "-" || kecamatanRaw === kabupatenRaw) && desaRaw !== "-" && kabupatenRaw !== "-") {
            try {
              // Bersihkan imbuhan dulu sebelum search agar API lebih akurat menemukan query
              let searchDesa = desaRaw.replace(/desa\s+/i, "").replace(/kelurahan\s+/i, "").trim();
              let searchKab = kabupatenRaw.replace(/kabupaten\s+/i, "").replace(/kota\s+/i, "").trim();
              let query = `${searchDesa}, ${searchKab}`;
              
              let resSearch = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&limit=1`, {
                headers: { 'User-Agent': 'XeonixSecureSystem/4.0' }
              });
              if(resSearch.ok) {
                let dataSearch = await resSearch.json();
                if(dataSearch.length > 0 && dataSearch[0].address) {
                  let sAddr = dataSearch[0].address;
                  kecamatanRaw = sAddr.subdistrict || sAddr.district || sAddr.city_district || sAddr.town || kecamatanRaw;
                }
              }
            } catch(e) { console.log("Layer 3 gagal", e); }
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

          // Pencegah duplikasi absolute (Kabupaten merebut kolom Kecamatan)
          if (wilayah.kecamatan === wilayah.kabupaten) wilayah.kecamatan = "-";

          apiSukses = true;
        }
      } catch (e) { console.log("Nominatim Engine Gagal, beralih ke engine cadangan..."); }

      // LAYER 4: Backup API BigDataCloud (Jika server Nominatim down total / terkendala)
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
    window.open(`http://maps.google.com/?q=${window.lastLat},${window.lastLon}`, '_blank');
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
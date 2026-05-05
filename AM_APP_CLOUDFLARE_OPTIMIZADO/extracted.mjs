    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
    import { getStorage, ref as storageRef, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
    import {
      getFirestore,
      collection,
      addDoc,
      onSnapshot,
      query,
      orderBy,
      deleteDoc,
      doc,
      updateDoc,
      setDoc,
      getDoc,
      where,
      serverTimestamp
    } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

    const firebaseConfig = {
      apiKey: "AIzaSyC15sDO35rdMeoTHA-jyPA1IIV_9G-wya8",
      authDomain: "am-autopartes.firebaseapp.com",
      projectId: "am-autopartes",
      storageBucket: "am-autopartes.firebasestorage.app",
      messagingSenderId: "4404873517",
      appId: "1:4404873517:web:31d2d19156da63c82baba4",
      measurementId: "G-B0RHTQW82R"
    };

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);
    const storage = getStorage(app);
    const checkinsRef = collection(db, "checkins");
    const deletionLogsRef = collection(db, "deletion_logs");
    const vendorsRef = collection(db, "vendors");
    const managersRef = collection(db, "managers");
    const securitySettingsRef = doc(db, "settings", "security");
    const dismissedNotificationsRef = collection(db, "dismissed_notifications");
    let securitySettings = { selfie_required: true };

    // ===== MODO OFFLINE PRO =====
    // Guarda registros completos en el celular cuando no hay internet o Firebase falla.
    // Cuando regresa internet, los sincroniza automáticamente a Firebase.
    const OFFLINE_CHECKINS_KEY = "am_autopartes_pending_checkins_v1";
    const LOCAL_SELFIE_KEY = "am_autopartes_local_selfies_v3_ligero";
    const MAX_LOCAL_SELFIES = 8;

    function getLocalSelfies() {
      try { return JSON.parse(localStorage.getItem(LOCAL_SELFIE_KEY) || "[]"); }
      catch (error) { return []; }
    }

    function setLocalSelfies(items) {
      localStorage.setItem(LOCAL_SELFIE_KEY, JSON.stringify(items.slice(0, MAX_LOCAL_SELFIES)));
    }

    function saveLocalSelfieDraft(pack, vendorName) {
      if (!pack || !pack.thumb) throw new Error('SELFIE_LOCAL_EMPTY');
      const localSelfieId = `selfie_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const item = {
        localSelfieId,
        vendor_name: vendorName || '',
        thumb: pack.thumb,
        full: '',
        created_at_ms: Date.now(),
        status: 'capturada_confirmada_local_ligera'
      };
      setLocalSelfies([item, ...getLocalSelfies()]);
      return item;
    }

    function markLocalSelfieLinked(localSelfieId, backendId, offlineId) {
      if (!localSelfieId) return;
      const updated = getLocalSelfies().map(item => item.localSelfieId === localSelfieId ? {
        ...item,
        backend_id: backendId || item.backend_id || '',
        offline_id: offlineId || item.offline_id || '',
        linked_at_ms: Date.now()
      } : item);
      setLocalSelfies(updated);
    }

    function showSelfiePreviewConfirm(pack) {
      return new Promise((resolve) => {
        const container = document.createElement('div');
        container.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-[100] p-4';
        container.innerHTML = `
          <div class="bg-white rounded-3xl p-5 shadow-2xl w-full max-w-md border border-gray-200 animate-fade-in">
            <div class="flex items-center gap-3 mb-4">
              <div class="w-11 h-11 rounded-2xl flex items-center justify-center bg-blue-100">
                <i data-lucide="camera" class="text-blue-700" style="width:24px;height:24px;"></i>
              </div>
              <div>
                <h3 class="text-xl font-black text-gray-900">Confirmar selfie</h3>
                <p class="text-sm text-gray-600">Verifica que la foto se vea clara antes de guardar.</p>
              </div>
            </div>
            <img src="${pack.thumb}" alt="Vista previa selfie" class="w-full max-h-[52vh] object-contain rounded-2xl bg-gray-100 border border-gray-200 mb-4">
            <div class="grid grid-cols-3 gap-2">
              <button id="selfie-cancel-btn" type="button" class="btn-base btn-neutral py-3">Cancelar</button>
              <button id="selfie-retake-btn" type="button" class="btn-base btn-neutral py-3">Repetir</button>
              <button id="selfie-confirm-btn" type="button" class="btn-base btn-primary py-3">Usar foto</button>
            </div>
          </div>
        `;
        document.body.appendChild(container);
        lucide.createIcons();
        container.querySelector('#selfie-cancel-btn').onclick = () => { container.remove(); resolve('cancel'); };
        container.querySelector('#selfie-retake-btn').onclick = () => { container.remove(); resolve('retake'); };
        container.querySelector('#selfie-confirm-btn').onclick = () => { container.remove(); resolve('confirm'); };
      });
    }


    function getOfflineCheckins() {
      try {
        return JSON.parse(localStorage.getItem(OFFLINE_CHECKINS_KEY) || "[]");
      } catch (error) {
        return [];
      }
    }

    function setOfflineCheckins(records) {
      const cleaned = records.slice(-25).map((record) => { const copy = { ...record }; delete copy.selfie_full_data_url; copy.selfie_photo = copy.selfie_thumb || copy.selfie_photo || ''; return copy; });
      localStorage.setItem(OFFLINE_CHECKINS_KEY, JSON.stringify(cleaned));
    }

    function createOfflineId() {
      return `offline_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }

    function addOfflineCheckin(record) {
      const pending = getOfflineCheckins();
      const offlineRecord = {
        ...record,
        __offlineId: createOfflineId(),
        __pendingSync: true,
        saved_offline_at_ms: Date.now()
      };
      pending.push(offlineRecord);
      setOfflineCheckins(pending);
      mergePendingCheckinsIntoCurrentData();
      renderCheckins();
      renderRoutes();
      renderProspects();
      updateOfflineStatusBanner();
      return offlineRecord;
    }

    function getPendingCheckinsForDisplay() {
      return getOfflineCheckins().map(record => ({
        __backendId: record.__offlineId,
        __pendingSync: true,
        vendor_name: record.vendor_name,
        vendor_pin: record.vendor_pin,
        record_type: record.record_type || "visita",
        location: record.location,
        check_in_time: record.check_in_time,
        created_at_ms: record.created_at_ms,
        latitude: record.latitude,
        longitude: record.longitude,
        gps_accuracy_meters: record.gps_accuracy_meters,
        geo_link: record.geo_link,
        device_id: record.device_id,
        device_info: record.device_info,
        device_status: record.device_status,
        selfie_required: record.selfie_required,
        selfie_photo: record.selfie_photo || record.selfie_full_url || '',
        selfie_thumb: record.selfie_thumb || record.selfie_photo || '',
        selfie_full_url: record.selfie_full_url || record.selfie_photo || '',
        selfie_storage_path: record.selfie_storage_path || "",
        selfie_thumb_storage_path: record.selfie_thumb_storage_path || "",
        selfie_uploaded_to_cloud: Boolean(record.selfie_uploaded_to_cloud),
        prospect_business_name: record.prospect_business_name || '',
        prospect_contact_name: record.prospect_contact_name || '',
        prospect_phone: record.prospect_phone || '',
        prospect_zone: record.prospect_zone || '',
        prospect_client_type: record.prospect_client_type || '',
        prospect_interest: record.prospect_interest || '',
        prospect_comments: record.prospect_comments || ''
      }));
    }

    function mergePendingCheckinsIntoCurrentData() {
      const onlineIds = new Set(currentData.map(r => r.__backendId));
      const pending = getPendingCheckinsForDisplay().filter(r => !onlineIds.has(r.__backendId));
      currentData = [
        ...pending,
        ...currentData.filter(r => !r.__pendingSync)
      ].sort((a, b) => Number(b.created_at_ms || 0) - Number(a.created_at_ms || 0));
    }

    function isDataUrlImage(value) {
      return typeof value === 'string' && value.startsWith('data:image/');
    }

    async function uploadSelfieToCloud(record) {
      const hasFullData = isDataUrlImage(record.selfie_full_data_url || record.selfie_photo);
      const hasThumbData = isDataUrlImage(record.selfie_thumb);
      if (!hasFullData && !hasThumbData) return record;

      const safeVendor = String(record.vendor_name || 'vendedor')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 60);

      const baseName = `${safeVendor}_${record.created_at_ms}_${Math.random().toString(16).slice(2)}`;
      const basePath = `checkin-selfies/${safeVendor}`;
      let fullUrl = record.selfie_full_url || '';
      let thumbUrl = record.selfie_thumb || '';
      let fullPath = record.selfie_storage_path || '';
      let thumbPath = record.selfie_thumb_storage_path || '';

      const metadata = {
        contentType: 'image/jpeg',
        customMetadata: {
          vendor_name: String(record.vendor_name || ''),
          record_type: String(record.record_type || ''),
          device_id: String(record.device_id || ''),
          created_at_ms: String(record.created_at_ms || Date.now())
        }
      };

      if (hasThumbData) {
        thumbPath = `${basePath}/${baseName}_thumb.jpg`;
        const thumbRef = storageRef(storage, thumbPath);
        await withTimeout(uploadString(thumbRef, record.selfie_thumb, 'data_url', metadata), 8000, 'UPLOAD_SELFIE_THUMB_TIMEOUT');
        thumbUrl = await withTimeout(getDownloadURL(thumbRef), 8000, 'GET_SELFIE_THUMB_URL_TIMEOUT');
      }

      if (hasFullData) {
        fullPath = `${basePath}/${baseName}_full.jpg`;
        const fullRef = storageRef(storage, fullPath);
        await withTimeout(uploadString(fullRef, record.selfie_full_data_url || record.selfie_photo, 'data_url', metadata), 12000, 'UPLOAD_SELFIE_FULL_TIMEOUT');
        fullUrl = await withTimeout(getDownloadURL(fullRef), 8000, 'GET_SELFIE_FULL_URL_TIMEOUT');
      }

      return {
        ...record,
        selfie_photo: thumbUrl || fullUrl,
        selfie_thumb: thumbUrl || fullUrl,
        selfie_full_url: fullUrl || thumbUrl,
        selfie_storage_path: fullPath,
        selfie_thumb_storage_path: thumbPath,
        selfie_uploaded_to_cloud: true
      };
    }

    function getSelfieThumb(record) {
      return record.selfie_thumb || record.selfie_photo || record.selfie_full_url || '';
    }

    function getSelfieFullUrl(record) {
      return record.selfie_full_url || record.selfie_photo || record.selfie_thumb || '';
    }

    const AM_BLINDAJE_MIN_VISIT_INTERVAL_MS = 2 * 60 * 1000;
    const AM_BLINDAJE_GPS_SUSPICIOUS_METERS = 50;
    const AM_BLINDAJE_GPS_MAX_METERS = 150;

    function getRecordCreatedMs(record) {
      return Number(record?.created_at_ms || (record?.check_in_time ? new Date(record.check_in_time).getTime() : 0) || 0);
    }

    function getLastVendorRegisterMs(vendorName) {
      const normalized = String(vendorName || '').trim().toLowerCase();
      if (!normalized) return 0;
      const sources = [];
      try { sources.push(...(Array.isArray(currentData) ? currentData : [])); } catch (_) {}
      try { sources.push(...getOfflineCheckins()); } catch (_) {}
      return sources
        .filter(r => String(r?.vendor_name || '').trim().toLowerCase() === normalized)
        .map(getRecordCreatedMs)
        .filter(Boolean)
        .sort((a, b) => b - a)[0] || 0;
    }

    function buildRegistroStatus({ accuracy, lastRegisterMs, nowMs }) {
      const notes = [];
      let status = 'valido';
      if (Number(accuracy || 9999) > AM_BLINDAJE_GPS_SUSPICIOUS_METERS) {
        status = 'sospechoso';
        notes.push('GPS con precisión media: ' + Math.round(Number(accuracy || 0)) + ' m');
      }
      if (lastRegisterMs && (nowMs - lastRegisterMs) < AM_BLINDAJE_MIN_VISIT_INTERVAL_MS) {
        status = 'rechazado';
        notes.push('Registro repetido en menos de 2 minutos');
      }
      return { status, notes };
    }
    async function saveCheckinRecord(record) {
      const fastRecord = {
        ...record,
        selfie_photo: record.selfie_photo || "",
        selfie_thumb: record.selfie_thumb || "",
        selfie_full_url: record.selfie_full_url || "",
        selfie_status: record.selfie_required ? (record.selfie_status || "pendiente_segundo_plano") : "no_requerida",
        selfie_uploaded_to_cloud: false,
        registro_status: record.registro_status || "valido",
        registro_notas: Array.isArray(record.registro_notas) ? record.registro_notas : [],
        server_time_requested: true
      };

      if (!navigator.onLine) {
        const offlineRecord = addOfflineCheckin(fastRecord);
        showNotification("Sin internet: registro guardado en este celular y pendiente de sincronizar", "success");
        return { offline: true, offlineId: offlineRecord.__offlineId };
      }

      try {
        const cloudRecord = {
          ...fastRecord,
          server_check_in_time: serverTimestamp(),
          server_created_at: serverTimestamp(),
          hora_fuente: "servidor_firebase",
          client_check_in_time: fastRecord.check_in_time,
          client_created_at_ms: fastRecord.created_at_ms
        };
        delete cloudRecord.selfie_full_data_url;
        const docRef = await withTimeout(addDoc(checkinsRef, cloudRecord), 12000, 'SAVE_CLOUD_TIMEOUT');
        return { offline: false, id: docRef.id };
      } catch (error) {
        console.error('Error al guardar en nube:', error);
        const offlineRecord = addOfflineCheckin(fastRecord);
        showNotification("No se pudo conectar con la nube. Registro guardado en este celular", "success");
        return { offline: true, offlineId: offlineRecord.__offlineId };
      }
    }

    async function completeSelfieInBackground(record, saveResult) {
      if (!record.selfie_required) return;

      try {
        const selfiePack = await withTimeout(captureSelfiePackage(true, record.vendor_name || ""), 8000, 'SELFIE_BACKGROUND_TIMEOUT');
        if (!selfiePack || !selfiePack.thumb) throw new Error('SELFIE_EMPTY');

        const recordWithPhoto = {
          ...record,
          selfie_photo: selfiePack.thumb,
          selfie_thumb: selfiePack.thumb,
          selfie_full_data_url: selfiePack.full,
          selfie_status: 'capturada',
          selfie_captured_at_ms: Date.now(),
          selfie_local_id: selfiePack.localSelfieId || ''
        };

        if (saveResult && saveResult.id && navigator.onLine) {
          const uploadedRecord = await uploadSelfieToCloud(recordWithPhoto);
          await withTimeout(updateDoc(doc(db, 'checkins', saveResult.id), {
            selfie_photo: uploadedRecord.selfie_thumb || uploadedRecord.selfie_photo,
            selfie_thumb: uploadedRecord.selfie_thumb || uploadedRecord.selfie_photo,
            selfie_full_url: uploadedRecord.selfie_full_url || uploadedRecord.selfie_photo,
            selfie_storage_path: uploadedRecord.selfie_storage_path || '',
            selfie_thumb_storage_path: uploadedRecord.selfie_thumb_storage_path || '',
            selfie_uploaded_to_cloud: Boolean(uploadedRecord.selfie_uploaded_to_cloud),
            selfie_status: 'capturada',
            selfie_captured_at_ms: recordWithPhoto.selfie_captured_at_ms,
            selfie_uploaded_at_ms: Date.now(),
            selfie_local_id: recordWithPhoto.selfie_local_id || ''
          }), 8000, 'UPDATE_SELFIE_TIMEOUT');
          showNotification('Selfie sincronizada', 'success');
          return;
        }

        if (saveResult && saveResult.offlineId) {
          const pending = getOfflineCheckins().map(item => {
            if (item.__offlineId !== saveResult.offlineId) return item;
            return { ...item, ...recordWithPhoto };
          });
          setOfflineCheckins(pending);
          mergePendingCheckinsIntoCurrentData();
          renderCheckins();
          showNotification('Selfie guardada en este celular; se subirá cuando haya internet', 'success');
        }
      } catch (error) {
        console.warn('Selfie en segundo plano no completada:', error);
        if (saveResult && saveResult.id && navigator.onLine) {
          try {
            await updateDoc(doc(db, 'checkins', saveResult.id), {
              selfie_status: 'fallo_segundo_plano',
              selfie_error: String((error && error.message) || error || 'SELFIE_ERROR'),
              selfie_failed_at_ms: Date.now()
            });
          } catch (updateError) {
            console.warn('No se pudo actualizar estado de selfie:', updateError);
          }
        }
      }
    }

    async function syncOfflineCheckins() {
      if (!navigator.onLine) return;

      let pending = getOfflineCheckins();
      if (pending.length === 0) {
        updateOfflineStatusBanner();
        return;
      }

      const stillPending = [];

      for (const record of pending) {
        try {
          const { __offlineId, __pendingSync, saved_offline_at_ms, ...cleanRecord } = record;
          await addDoc(checkinsRef, cleanRecord);
        } catch (error) {
          stillPending.push(record);
        }
      }

      setOfflineCheckins(stillPending);
      mergePendingCheckinsIntoCurrentData();
      renderCheckins();
      renderRoutes();
      renderProspects();
      updateOfflineStatusBanner();

      if (pending.length > stillPending.length) {
        showNotification(`Registros sincronizados: ${pending.length - stillPending.length}`, "success");
      }
    }

    function updateOfflineStatusBanner() {
      let banner = document.getElementById("offline-pro-banner");
      if (!banner) return;

      const pendingCount = getOfflineCheckins().length;

      if (!navigator.onLine) {
        banner.textContent = `🔴 Offline · ${pendingCount}`;
        banner.className = "fixed bottom-3 left-3 z-50 rounded-full px-3 py-1.5 text-[11px] font-bold shadow-lg bg-red-600 text-white opacity-90";
        return;
      }

      if (pendingCount > 0) {
        banner.textContent = `🟡 Sync · ${pendingCount}`;
        banner.className = "fixed bottom-3 left-3 z-50 rounded-full px-3 py-1.5 text-[11px] font-bold shadow-lg bg-yellow-300 text-gray-900 opacity-90";
        return;
      }

      banner.textContent = "🟢";
      banner.className = "fixed bottom-3 left-3 z-50 rounded-full px-3 py-1.5 text-[11px] font-bold shadow-lg bg-green-600 text-white opacity-80";
    }

    function createOfflineStatusBanner() {
      if (document.getElementById("offline-pro-banner")) return;
      const banner = document.createElement("div");
      banner.id = "offline-pro-banner";
      document.body.appendChild(banner);
      updateOfflineStatusBanner();
    }

    let currentData = [];
    let allVendors = [];
    let allManagers = [];
    let allDeletionLogs = [];
    let dismissedNotificationIds = [];
    let currentManagerSession = null;
    let selectedRouteDate = new Date().toLocaleDateString("en-CA");
    let selectedMapDate = new Date().toLocaleDateString("en-CA");
    let selectedMapVendor = "";
    let selectedCheckinsDate = new Date().toLocaleDateString("en-CA");
    let selectedCheckinsVendor = "";
    let selectedCheckinsType = "";
    let selectedCheckinsSelfie = "";
    let internalMap = null;
    let internalMapMarkers = null;
    let internalMapRouteLine = null;
    let isLoading = false;

    const WHATSAPP_NUMBER = "5215610687438";

    const MAP_VENDOR_COLORS = [
      "#1e56b7",
      "#e10600",
      "#059669",
      "#7c3aed",
      "#f97316",
      "#0891b2",
      "#be123c",
      "#4b5563"
    ];

    function getVendorColor(vendorName) {
      const vendors = [...new Set(currentData.map(r => r.vendor_name).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'es-MX'));
      const index = Math.max(0, vendors.indexOf(vendorName));
      return MAP_VENDOR_COLORS[index % MAP_VENDOR_COLORS.length];
    }

    function createNumberedMapIcon(number, color) {
      return L.divIcon({
        className: '',
        html: `<div class="am-map-marker" style="background:${color};">${number}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        popupAnchor: [0, -16]
      });
    }

    function renderMapLegend(records) {
      const legend = document.getElementById('map-legend');
      if (!legend) return;

      const vendors = [...new Set(records.map(r => r.vendor_name).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'es-MX'));

      if (vendors.length === 0) {
        legend.innerHTML = '';
        return;
      }

      legend.innerHTML = vendors.map(vendorName => {
        const color = getVendorColor(vendorName);
        return `
          <span class="am-map-legend-item">
            <span class="am-map-legend-dot" style="background:${color};"></span>
            ${vendorName}
          </span>
        `;
      }).join('');
    }


    // Contraseñas internas ofuscadas.
    // Nota: al ser una app web, esto solo evita que queden visibles a simple vista en el código.
    const AM_SECRET = (values, key = 37) => values.map(n => String.fromCharCode(n ^ key)).join("");

    const SUPER_MANAGERS = [
      { name: "Daniel Tellez", password: AM_SECRET([87, 80, 67, 74, 86, 87, 68, 72, 74, 107, 20]), role: "super usuario" },
      { name: "Arturo Vega", password: AM_SECRET([101, 87, 81, 77, 80, 87, 18, 16, 97]), role: "super usuario" },
      { name: "Francisco Gonzalez", password: AM_SECRET([117, 80, 72, 68, 86, 66, 74, 73]), role: "Direccion" }
    ];

    // Código maestro de respaldo para entrar al panel de gerente si falla una contraseña normal.
    const MANAGER_MASTER_CODE = AM_SECRET([16, 29, 18, 16, 20, 29, 21, 28]);
    const MASTER_MANAGER_SESSION = { name: "Acceso Maestro AM", role: "super", writtenRole: "super usuario" };

    // Control gratuito de precisión GPS
    // Menos metros = mejor ubicación. La app intenta durante unos segundos
    // tomar la mejor lectura disponible antes de decidir si acepta o rechaza.
    const MAX_GPS_ACCURACY_METERS = 150;
    const GOOD_GPS_ACCURACY_METERS = 80;
    const GPS_TIMEOUT_MS = 18000;
    const GPS_SAMPLE_WINDOW_MS = 9000;


    function getHighAccuracyPosition() {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject({ code: "NO_GEOLOCATION", message: "Tu dispositivo no soporta geolocalización" });
          return;
        }

        let bestPosition = null;
        let settled = false;
        let watchId = null;
        let finishTimer = null;

        const finish = (position) => {
          if (settled) return;
          settled = true;
          if (watchId !== null) navigator.geolocation.clearWatch(watchId);
          if (finishTimer) clearTimeout(finishTimer);
          resolve(position);
        };

        const fail = (error) => {
          if (settled) return;
          if (bestPosition) {
            finish(bestPosition);
            return;
          }
          settled = true;
          if (watchId !== null) navigator.geolocation.clearWatch(watchId);
          if (finishTimer) clearTimeout(finishTimer);
          reject(error);
        };

        const rememberBest = (position) => {
          const accuracy = Number(position.coords.accuracy || 9999);
          const bestAccuracy = bestPosition ? Number(bestPosition.coords.accuracy || 9999) : 9999;
          if (!bestPosition || accuracy < bestAccuracy) bestPosition = position;

          // Si ya es buena, no hacemos esperar al vendedor.
          if (accuracy <= GOOD_GPS_ACCURACY_METERS) finish(position);
        };

        watchId = navigator.geolocation.watchPosition(
          rememberBest,
          fail,
          {
            enableHighAccuracy: true,
            timeout: GPS_TIMEOUT_MS,
            maximumAge: 0
          }
        );

        finishTimer = setTimeout(() => {
          if (bestPosition) {
            finish(bestPosition);
          } else {
            fail({ code: 3, message: 'Se agotó el tiempo para obtener ubicación' });
          }
        }, GPS_SAMPLE_WINDOW_MS);
      });
    }

    function isGpsAccurateEnough(position) {
      const accuracy = Number(position.coords.accuracy || 9999);
      return accuracy <= MAX_GPS_ACCURACY_METERS;
    }

    function getGpsAccuracyLabel(accuracy) {
      const value = Math.round(Number(accuracy || 0));

      if (!value) return "Sin dato";
      if (value <= 30) return `${value} m - Excelente`;
      if (value <= 100) return `${value} m - Aceptable`;
      if (value <= 150) return `${value} m - Baja, pero válida`;
      return `${value} m - Imprecisa`;
    }

    function getGpsErrorMessage(error) {
      if (error && error.code === "NO_GEOLOCATION") {
        return 'Tu dispositivo no soporta geolocalización';
      }

      if (error.code === error.PERMISSION_DENIED) {
        return 'Permiso de ubicación denegado. Activa ubicación precisa para esta página.';
      }

      if (error.code === error.POSITION_UNAVAILABLE) {
        return 'No se pudo obtener la ubicación. Activa GPS y vuelve a intentar.';
      }

      if (error.code === error.TIMEOUT) {
        return 'Se agotó el tiempo para obtener ubicación. Intenta en un lugar más abierto.';
      }

      return 'Error al obtener la ubicación';
    }

    function getTodayDateKey() {
      return new Date().toLocaleDateString("en-CA");
    }

    let lastAutoDateKey = getTodayDateKey();

    function refreshDailyViewsIfDateChanged() {
      const todayKey = getTodayDateKey();

      // FIX: antes comparaba la fecha seleccionada contra el día actual.
      // Eso hacía que, al elegir un día anterior, el filtro se regresara solo a hoy.
      // Ahora solo se actualiza automáticamente cuando realmente cambia el día del calendario.
      if (todayKey === lastAutoDateKey) return;
      lastAutoDateKey = todayKey;

      selectedMapDate = todayKey;
      const mapDateInput = document.getElementById('map-date-filter');
      if (mapDateInput) mapDateInput.value = selectedMapDate;
      renderInternalMap();

      selectedCheckinsDate = todayKey;
      const checkinsDateInput = document.getElementById('checkins-date-filter');
      if (checkinsDateInput) checkinsDateInput.value = selectedCheckinsDate;
      renderCheckins();

      selectedRouteDate = todayKey;
      const routeDateInput = document.getElementById('route-date-filter');
      if (routeDateInput) routeDateInput.value = selectedRouteDate;
      renderRoutes();
    }

    function getRecordDateKey(record) {
      const rawDate = record && (record.check_in_time || record.created_at_ms);
      if (!rawDate) return '';
      return new Date(rawDate).toLocaleDateString("en-CA");
    }

    function getLatestRecordForVendor(vendorName) {
      return currentData
        .filter(record => String(record.vendor_name || '') === String(vendorName || ''))
        .sort((a, b) => Number(b.created_at_ms || new Date(b.check_in_time).getTime() || 0) - Number(a.created_at_ms || new Date(a.check_in_time).getTime() || 0))[0] || null;
    }



    const MANAGER_NOTIFICATION_EVENTS_KEY = "am_autopartes_manager_notification_events_v1";

    function getManagerNotificationEvents() {
      try {
        const events = JSON.parse(localStorage.getItem(MANAGER_NOTIFICATION_EVENTS_KEY) || "[]");
        return Array.isArray(events) ? events : [];
      } catch (error) { return []; }
    }

    function setManagerNotificationEvents(events) {
      const clean = (Array.isArray(events) ? events : []).filter(event => event && event.id).sort((a, b) => Number(b.atMs || 0) - Number(a.atMs || 0)).slice(0, 40);
      localStorage.setItem(MANAGER_NOTIFICATION_EVENTS_KEY, JSON.stringify(clean));
    }

    function addManagerNotificationEvent(options) {
      const atMs = Date.now();
      const event = {
        id: (options.type || 'manual_event') + '-' + atMs + '-' + Math.random().toString(16).slice(2),
        type: options.type || 'manual_event',
        level: options.level || 'info',
        icon: options.icon || 'bell',
        title: options.title || 'Notificación',
        detail: options.detail || '',
        source: options.source || 'Sistema',
        tab: options.tab || '',
        actionText: options.actionText || 'Revisar',
        atMs,
        isOk: false
      };
      const events = getManagerNotificationEvents();
      events.unshift(event);
      setManagerNotificationEvents(events);
      if (typeof renderManagerNotifications === 'function') renderManagerNotifications();
      return event;
    }

    function getRRHHFilterLabel(value) {
      if (value === 'local') return 'Local';
      if (value === 'todos') return 'Todos';
      return 'Foráneo';
    }

    function notifyRRHHAction(title, detail, options = {}) {
      addManagerNotificationEvent({
        title,
        detail,
        level: options.level || 'info',
        icon: options.icon || 'bell',
        source: 'Recursos Humanos',
        tab: 'rrhh',
        actionText: options.actionText || 'Ver RRHH',
        type: options.type || 'rrhh_action'
      });
    }

    const SMART_NOTIFICATIONS_READ_KEY = "am_autopartes_smart_notifications_read_v1";
    const SMART_NOTIFICATIONS_DELETED_KEY = "am_autopartes_smart_notifications_deleted_v2";

    function getSmartNotificationReadIds() {
      try { return JSON.parse(localStorage.getItem(SMART_NOTIFICATIONS_READ_KEY) || "[]"); }
      catch (error) { return []; }
    }

    function setSmartNotificationReadIds(ids) {
      const clean = Array.from(new Set(ids || [])).slice(-120);
      localStorage.setItem(SMART_NOTIFICATIONS_READ_KEY, JSON.stringify(clean));
    }

    function getLocalDismissedNotificationIds() {
      try { return JSON.parse(localStorage.getItem(SMART_NOTIFICATIONS_DELETED_KEY) || "[]"); }
      catch (error) { return []; }
    }

    function setLocalDismissedNotificationIds(ids) {
      const clean = Array.from(new Set(ids || [])).slice(-300);
      localStorage.setItem(SMART_NOTIFICATIONS_DELETED_KEY, JSON.stringify(clean));
      dismissedNotificationIds = clean;
    }

    function makeSmartNotificationId(alert) {
      return [alert.type || 'alerta', alert.level || 'info', alert.title || '', alert.detail || '']
        .join('|')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .slice(0, 260);
    }

    function notificationDocId(alertId) {
      const raw = String(alertId || 'alerta');
      let hash = 0;
      for (let i = 0; i < raw.length; i++) {
        hash = ((hash << 5) - hash) + raw.charCodeAt(i);
        hash |= 0;
      }
      return `notif_${Math.abs(hash)}_${raw.length}`;
    }

    function isSmartNotificationDismissed(alertId) {
      return dismissedNotificationIds.includes(alertId) || getLocalDismissedNotificationIds().includes(alertId);
    }

    async function deleteSmartNotification(alertId, event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (!alertId) return;

      const localIds = getLocalDismissedNotificationIds();
      if (!localIds.includes(alertId)) localIds.push(alertId);
      setLocalDismissedNotificationIds(localIds);
      renderManagerNotifications();

      try {
        await setDoc(doc(db, "dismissed_notifications", notificationDocId(alertId)), {
          alert_id: alertId,
          deleted: true,
          deleted_at_ms: Date.now(),
          deleted_by: currentManagerSession?.name || "Gerente AM"
        }, { merge: true });
        showNotification('Notificación borrada y sincronizada', 'success');
      } catch (error) {
        showNotification('Notificación borrada en este equipo; se sincronizará cuando Firebase responda', 'success');
      }
    }

    function listenForDismissedNotifications() {
      onSnapshot(dismissedNotificationsRef, (snapshot) => {
        const cloudIds = snapshot.docs
          .map(item => item.data())
          .filter(data => data && data.deleted && data.alert_id)
          .map(data => String(data.alert_id));
        const merged = Array.from(new Set([...getLocalDismissedNotificationIds(), ...cloudIds]));
        setLocalDismissedNotificationIds(merged);
        renderManagerNotifications();
      }, () => {
        dismissedNotificationIds = getLocalDismissedNotificationIds();
        renderManagerNotifications();
      });
    }

    window.deleteSmartNotification = deleteSmartNotification;

    function formatSmartNotificationTime(ms) {
      if (!ms) return 'Ahora';
      const diff = Math.max(0, Date.now() - Number(ms));
      const minutes = Math.floor(diff / 60000);
      if (minutes < 1) return 'Ahora';
      if (minutes < 60) return `Hace ${minutes} min`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `Hace ${hours} h`;
      return new Date(ms).toLocaleDateString('es-MX');
    }

    function markSmartNotificationsRead(alerts) {
      const ids = getSmartNotificationReadIds();
      (alerts || []).forEach(alert => {
        if (!alert.isOk) ids.push(alert.id || makeSmartNotificationId(alert));
      });
      setSmartNotificationReadIds(ids);
    }

    function markOneSmartNotificationRead(alertId) {
      if (!alertId) return;
      const ids = getSmartNotificationReadIds();
      ids.push(alertId);
      setSmartNotificationReadIds(ids);
      renderManagerNotifications();
    }

    function openNotificationAction(tab, alertId) {
      markOneSmartNotificationRead(alertId);
      if (tab) showManagerTab(tab);
      toggleNotificationPanel(false);
    }

    window.openNotificationAction = openNotificationAction;
    window.markSmartNotificationsRead = markSmartNotificationsRead;

    function buildManagerNotifications() {
      const alerts = [];
      const todayKey = getTodayDateKey();
      const todayRecords = currentData.filter(record => getRecordDateKey(record) === todayKey);
      const activeVendors = allVendors.filter(vendor => vendor && vendor.active !== false);
      const offlinePending = typeof getOfflineCheckins === 'function' ? getOfflineCheckins() : [];
      const now = Date.now();

      function pushAlert(alert) {
        const complete = {
          level: alert.level || 'info',
          icon: alert.icon || 'bell',
          title: alert.title || 'Alerta',
          detail: alert.detail || '',
          source: alert.source || 'Sistema',
          actionText: alert.actionText || 'Revisar',
          tab: alert.tab || '',
          type: alert.type || alert.title || 'alerta',
          atMs: alert.atMs || now,
          isOk: Boolean(alert.isOk)
        };
        complete.id = alert.id || makeSmartNotificationId(complete);
        alerts.push(complete);
      }

      getManagerNotificationEvents().forEach(event => pushAlert({
        id: event.id,
        type: event.type || 'manual_event',
        level: event.level || 'info',
        icon: event.icon || 'bell',
        title: event.title || 'Notificación',
        detail: event.detail || '',
        source: event.source || 'Sistema',
        actionText: event.actionText || 'Revisar',
        tab: event.tab || '',
        atMs: Number(event.atMs || now),
        isOk: Boolean(event.isOk)
      }));


      // Notificaciones operativas: cada registro que haga un vendedor aparece en la campanita.
      // Se toman directamente de Firebase/currentData para que RH vea la actividad real aunque no esté en la pestaña de registros.
      const recentVendorActions = (currentData || [])
        .filter(record => record && record.vendor_name && record.check_in_time)
        .sort((a, b) => Number(b.created_at_ms || new Date(b.check_in_time).getTime() || 0) - Number(a.created_at_ms || new Date(a.check_in_time).getTime() || 0))
        .slice(0, 80);

      function getActionNotificationMeta(record) {
        const type = String(record.record_type || record.tipo || record.type || 'visita').toLowerCase();
        if (type === 'inicio_ruta' || type === 'entrada') return { label: 'registró entrada / inicio de ruta', icon: 'log-in', level: 'success', tab: 'rrhh', actionText: 'Ver RRHH' };
        if (type === 'fin_ruta' || type === 'salida') return { label: 'registró salida / fin de ruta', icon: 'log-out', level: 'info', tab: 'rrhh', actionText: 'Ver RRHH' };
        if (type === 'comida_inicio') return { label: 'salió a comer', icon: 'utensils', level: 'info', tab: 'rrhh', actionText: 'Ver RRHH' };
        if (type === 'comida_fin') return { label: 'regresó de comer', icon: 'utensils-crossed', level: 'success', tab: 'rrhh', actionText: 'Ver RRHH' };
        if (type === 'prospecto') return { label: 'registró un prospecto', icon: 'user-plus', level: 'info', tab: 'prospectos', actionText: 'Ver prospectos' };
        if (type === 'visita' || type === 'checkin') return { label: 'registró visita / check-in', icon: 'map-pin-check', level: 'info', tab: 'registros', actionText: 'Ver registros' };
        return { label: getRecordTypeLabel(type), icon: 'bell', level: 'info', tab: 'registros', actionText: 'Ver registros' };
      }

      recentVendorActions.forEach(record => {
        const atMs = Number(record.created_at_ms || new Date(record.check_in_time).getTime() || now);
        const actionMeta = getActionNotificationMeta(record);
        const vendorName = String(record.vendor_name || 'Vendedor');
        const timeText = new Date(record.check_in_time).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
        const placeText = record.geo_link ? ' · ubicación disponible' : '';
        pushAlert({
          id: 'vendor-action-' + (record.__backendId || [vendorName, record.record_type || 'registro', atMs, record.latitude || '', record.longitude || ''].join('|')),
          type: 'vendor_action_' + String(record.record_type || 'registro').toLowerCase(),
          level: actionMeta.level,
          icon: actionMeta.icon,
          title: vendorName + ' ' + actionMeta.label,
          detail: timeText + placeText,
          source: 'Actividad vendedor',
          actionText: actionMeta.actionText,
          tab: actionMeta.tab,
          atMs
        });
      });

      if (offlinePending.length > 0) {
        pushAlert({
          id: `offline-pending-${offlinePending.length}`,
          type: 'offline_pending',
          level: 'warning',
          icon: 'cloud-off',
          title: `${offlinePending.length} registro${offlinePending.length === 1 ? '' : 's'} pendiente${offlinePending.length === 1 ? '' : 's'} de sincronizar`,
          detail: 'Hay información guardada en este celular que todavía no sube a Firebase.',
          source: 'Sincronización',
          actionText: 'Ver registros',
          tab: 'registros',
          atMs: Number(offlinePending[0]?.created_at_ms || now)
        });
      }

      if (activeVendors.length > 0) {
        const vendorsWithRecordToday = new Set(todayRecords.map(record => String(record.vendor_name || '').trim()).filter(Boolean));
        const missingToday = activeVendors.filter(vendor => !vendorsWithRecordToday.has(String(vendor.vendor_name || '').trim()));
        if (missingToday.length > 0) {
          pushAlert({
            id: `missing-today-${todayKey}-${missingToday.map(v => v.vendor_name).join('|')}`,
            type: 'missing_today',
            level: 'danger',
            icon: 'user-x',
            title: `${missingToday.length} vendedor${missingToday.length === 1 ? '' : 'es'} sin registro hoy`,
            detail: missingToday.slice(0, 5).map(v => v.vendor_name).join(', ') + (missingToday.length > 5 ? '...' : ''),
            source: 'Asistencia diaria',
            actionText: 'Ver vendedores',
            tab: 'vendedores',
            atMs: now
          });
        }
      }

      const inactiveToday = activeVendors.filter(vendor => {
        const latest = getLatestRecordForVendor(vendor.vendor_name);
        if (!latest || getRecordDateKey(latest) !== todayKey) return false;
        const latestMs = Number(latest.created_at_ms || new Date(latest.check_in_time).getTime() || 0);
        return latestMs && (now - latestMs) > (4 * 60 * 60 * 1000);
      });
      if (inactiveToday.length > 0) {
        const oldestLatest = inactiveToday
          .map(v => getLatestRecordForVendor(v.vendor_name))
          .map(r => Number(r?.created_at_ms || new Date(r?.check_in_time).getTime() || now))
          .sort((a, b) => a - b)[0] || now;
        pushAlert({
          id: `inactive-${todayKey}-${inactiveToday.map(v => v.vendor_name).join('|')}`,
          type: 'inactive_today',
          level: 'warning',
          icon: 'clock',
          title: `${inactiveToday.length} vendedor${inactiveToday.length === 1 ? '' : 'es'} sin movimiento reciente`,
          detail: 'Último registro hace más de 4 horas: ' + inactiveToday.slice(0, 5).map(v => v.vendor_name).join(', '),
          source: 'Seguimiento de ruta',
          actionText: 'Ver rutas',
          tab: 'rutas',
          atMs: oldestLatest
        });
      }

      const unauthorizedDevices = todayRecords.filter(record => record.device_status === 'dispositivo_no_autorizado');
      if (unauthorizedDevices.length > 0) {
        pushAlert({
          id: `unauthorized-device-${todayKey}-${unauthorizedDevices.length}`,
          type: 'unauthorized_device',
          level: 'danger',
          icon: 'shield-alert',
          title: `${unauthorizedDevices.length} intento${unauthorizedDevices.length === 1 ? '' : 's'} con dispositivo no autorizado`,
          detail: 'Revisa la columna de dispositivo en registros.',
          source: 'Seguridad de dispositivo',
          actionText: 'Ver registros',
          tab: 'registros',
          atMs: Math.max(...unauthorizedDevices.map(r => Number(r.created_at_ms || 0)), now)
        });
      }

      const weakGps = todayRecords.filter(record => Number(record.gps_accuracy_meters || 0) >= 120);
      if (weakGps.length > 0) {
        pushAlert({
          id: `weak-gps-${todayKey}-${weakGps.length}`,
          type: 'weak_gps',
          level: 'warning',
          icon: 'map-pin',
          title: `${weakGps.length} registro${weakGps.length === 1 ? '' : 's'} con GPS débil`,
          detail: 'Precisión mayor a 120 m. Conviene revisar ubicación antes de tomar decisiones.',
          source: 'Ubicación GPS',
          actionText: 'Ver mapa',
          tab: 'mapa',
          atMs: Math.max(...weakGps.map(r => Number(r.created_at_ms || 0)), now)
        });
      }

      if (securitySettings && securitySettings.selfie_required) {
        const withoutSelfie = todayRecords.filter(record => !getSelfieThumb(record) && !getSelfieFullUrl(record));
        if (withoutSelfie.length > 0) {
          pushAlert({
            id: `without-selfie-${todayKey}-${withoutSelfie.length}`,
            type: 'without_selfie',
            level: 'info',
            icon: 'camera-off',
            title: `${withoutSelfie.length} registro${withoutSelfie.length === 1 ? '' : 's'} sin selfie`,
            detail: 'La selfie está activa. Puede tratarse de registros antiguos o fotos pendientes.',
            source: 'Validación selfie',
            actionText: 'Ver registros',
            tab: 'registros',
            atMs: Math.max(...withoutSelfie.map(r => Number(r.created_at_ms || 0)), now)
          });
        }
      }

      const rrhhTodayRows = (typeof getRRHHDailyRows === 'function' ? getRRHHDailyRows() : []).filter(row => row.day === todayKey);
      const rrhhLateRows = rrhhTodayRows.filter(row => row.entrada && row.tasa !== '100%');
      const rrhhMealOverRows = rrhhTodayRows.filter(row => row.exceso === 'SI');
      if (rrhhLateRows.length > 0) {
        pushAlert({
          id: 'rrhh-late-' + todayKey + '-' + rrhhLateRows.map(row => row.name).join('|'),
          type: 'rrhh_late',
          level: 'warning',
          icon: 'alarm-clock',
          title: rrhhLateRows.length + ' vendedor' + (rrhhLateRows.length === 1 ? '' : 'es') + ' tarde en RRHH',
          detail: rrhhLateRows.slice(0, 5).map(row => row.name).join(', ') + (rrhhLateRows.length > 5 ? '...' : ''),
          source: 'Recursos Humanos',
          actionText: 'Ver RRHH',
          tab: 'rrhh',
          atMs: Math.max(...rrhhLateRows.map(row => Number(row.entrada?.created_at_ms || new Date(row.entrada?.check_in_time).getTime() || now)), now)
        });
      }
      if (rrhhMealOverRows.length > 0) {
        pushAlert({
          id: 'rrhh-meal-over-' + todayKey + '-' + rrhhMealOverRows.map(row => row.name).join('|'),
          type: 'rrhh_meal_over',
          level: 'warning',
          icon: 'utensils',
          title: rrhhMealOverRows.length + ' comida' + (rrhhMealOverRows.length === 1 ? '' : 's') + ' con exceso de 60 min',
          detail: rrhhMealOverRows.slice(0, 5).map(row => row.name + ' (' + formatMealMinutes(row.minutosComida) + ')').join(', ') + (rrhhMealOverRows.length > 5 ? '...' : ''),
          source: 'Recursos Humanos',
          actionText: 'Ver RRHH',
          tab: 'rrhh',
          atMs: now
        });
      }

      const lastDeletion = allDeletionLogs[0];
      if (lastDeletion && lastDeletion.created_at_ms && (now - Number(lastDeletion.created_at_ms)) < (24 * 60 * 60 * 1000)) {
        pushAlert({
          id: `last-deletion-${lastDeletion.created_at_ms}-${lastDeletion.status || ''}`,
          type: 'last_deletion',
          level: lastDeletion.status === 'COMPLETADO' ? 'success' : 'warning',
          icon: 'history',
          title: 'Borrado registrado en las últimas 24 horas',
          detail: `${lastDeletion.authorized_by || 'Super usuario'} · ${lastDeletion.status || 'COMPLETADO'}`,
          source: 'Historial de borrados',
          actionText: 'Ver historial',
          tab: 'historial',
          atMs: Number(lastDeletion.created_at_ms || now)
        });
      }

      if (alerts.length === 0) {
        pushAlert({
          id: 'system-ok',
          type: 'system_ok',
          level: 'success',
          icon: 'check-circle-2',
          title: 'Todo en orden',
          detail: 'No hay alertas críticas en este momento.',
          source: 'Sistema',
          actionText: '',
          tab: '',
          isOk: true,
          atMs: now
        });
      }

      const order = { danger: 1, warning: 2, info: 3, success: 4 };
      return alerts.sort((a, b) => (order[a.level] || 9) - (order[b.level] || 9) || Number(b.atMs || 0) - Number(a.atMs || 0));
    }

    window.buildManagerNotifications = buildManagerNotifications;

    function renderManagerNotifications() {
      const countEl = document.getElementById('notification-count');
      const listEl = document.getElementById('notification-list');
      if (!countEl || !listEl) return;

      const panel = document.getElementById('notification-panel');
      const panelIsOpen = Boolean(panel && panel.classList.contains('show'));
      const allAlerts = buildManagerNotifications();
      const alerts = allAlerts.filter(alert => !isSmartNotificationDismissed(alert.id));
      if (panelIsOpen) markSmartNotificationsRead(alerts);
      const readIds = new Set(getSmartNotificationReadIds());
      const unreadCount = alerts.filter(alert => !alert.isOk && !readIds.has(alert.id)).length;
      countEl.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
      countEl.classList.toggle('hidden', unreadCount === 0);

      if (alerts.length === 0) {
        listEl.innerHTML = `
          <div class="p-4 rounded-2xl bg-green-50 border border-green-100 text-center">
            <p class="text-sm font-black text-green-800">Sin notificaciones pendientes</p>
            <p class="text-xs font-semibold text-green-700 mt-1">Las alertas se generan solas con la información de Firebase.</p>
          </div>
        `;
        return;
      }

      listEl.innerHTML = alerts.map(alert => {
        const unread = !alert.isOk && !readIds.has(alert.id);
        const action = alert.tab ? `onclick="openNotificationAction('${escapeJs(alert.tab)}','${escapeJs(alert.id)}')"` : '';
        return `
          <button type="button" class="manager-pro-notification-item w-full text-left ${unread ? 'is-unread' : ''}" ${action}>
            <span class="manager-pro-notification-icon ${alert.level}"><i data-lucide="${alert.icon}" style="width:19px;height:19px;"></i></span>
            <span class="min-w-0 flex-1">
              <span class="flex items-center justify-between gap-3">
                <span class="block text-sm font-black text-gray-900">${escapeHtml(alert.title)}</span>
                ${unread ? '<span class="manager-pro-unread-dot"></span>' : ''}
              </span>
              <span class="block text-xs font-semibold text-gray-500 mt-1">${escapeHtml(alert.detail)}</span>
              <span class="flex flex-wrap items-center gap-2 mt-2">
                <span class="text-[11px] font-black text-blue-700 bg-blue-50 rounded-full px-2 py-1">${escapeHtml(alert.source)}</span>
                <span class="text-[11px] font-bold text-gray-400">${escapeHtml(formatSmartNotificationTime(alert.atMs))}</span>
                ${alert.actionText ? `<span class="text-[11px] font-black text-red-600 ml-auto">${escapeHtml(alert.actionText)} →</span>` : ''}
              </span>
            </span>
            <span type="button" onclick="deleteSmartNotification('${escapeJs(alert.id)}', event)" class="ml-2 shrink-0 rounded-xl bg-red-50 px-3 py-2 text-[11px] font-black text-red-600 hover:bg-red-100">Borrar</span>
          </button>
        `;
      }).join('');
      lucide.createIcons();
    }

    function positionNotificationPanelForMobile() {
      const panel = document.getElementById('notification-panel');
      const toggle = document.getElementById('notification-toggle');
      if (!panel) return;

      // En celular el panel se vuelve fijo al viewport. Esto evita que herede
      // posiciones del contenedor y se abra fuera de pantalla hacia la izquierda.
      if (window.innerWidth <= 768) {
        if (panel.parentElement !== document.body) {
          document.body.appendChild(panel);
        }
        const rect = toggle ? toggle.getBoundingClientRect() : { bottom: 64 };
        const top = Math.max(70, Math.min(rect.bottom + 10, window.innerHeight - 160));
        panel.style.position = 'fixed';
        panel.style.left = '12px';
        panel.style.right = '12px';
        panel.style.top = top + 'px';
        panel.style.width = 'auto';
        panel.style.maxWidth = 'calc(100vw - 24px)';
        panel.style.maxHeight = 'calc(100vh - ' + (top + 18) + 'px)';
        panel.style.transform = 'none';
        panel.style.zIndex = '2147483000';
      } else {
        const wrap = document.querySelector('.manager-pro-notify');
        if (wrap && panel.parentElement !== wrap) {
          wrap.appendChild(panel);
        }
        panel.style.position = '';
        panel.style.left = '';
        panel.style.right = '';
        panel.style.top = '';
        panel.style.width = '';
        panel.style.maxWidth = '';
        panel.style.maxHeight = '';
        panel.style.transform = '';
        panel.style.zIndex = '';
      }
    }

    function toggleNotificationPanel(force) {
      const panel = document.getElementById('notification-panel');
      if (!panel) return;
      const shouldShow = typeof force === 'boolean' ? force : !panel.classList.contains('show');
      if (shouldShow) positionNotificationPanelForMobile();
      panel.classList.toggle('show', shouldShow);
      if (shouldShow) {
        const alerts = buildManagerNotifications().filter(alert => !isSmartNotificationDismissed(alert.id));
        markSmartNotificationsRead(alerts);
        renderManagerNotifications();
        positionNotificationPanelForMobile();
      }
    }

    window.toggleNotificationPanel = toggleNotificationPanel;
    window.renderManagerNotifications = renderManagerNotifications;

    function initializeAppUi() {
      try { localStorage.removeItem('am_autopartes_local_selfies_v1'); localStorage.removeItem('am_autopartes_local_selfies_v2'); } catch (_) {}
      renderVendors();
      renderManagers();
      renderCheckins();
      renderRoutes();
      renderProspects();
      lucide.createIcons();
      const notificationToggle = document.getElementById('notification-toggle');
      if (notificationToggle) notificationToggle.addEventListener('click', () => toggleNotificationPanel());
      document.addEventListener('click', (event) => {
        const wrap = document.querySelector('.manager-pro-notify');
        const panel = document.getElementById('notification-panel');
        const clickedInsideBell = wrap && wrap.contains(event.target);
        const clickedInsidePanel = panel && panel.contains(event.target);
        if (!clickedInsideBell && !clickedInsidePanel) toggleNotificationPanel(false);
      });
      window.addEventListener('resize', () => {
        const panel = document.getElementById('notification-panel');
        if (panel && panel.classList.contains('show')) positionNotificationPanelForMobile();
      });
      renderManagerNotifications();
      listenForVendors();
      listenForManagers();
      listenForCheckins();
      listenForDeletionLogs();
      listenForDismissedNotifications();
      createOfflineStatusBanner();
      updateOfflineStatusBanner();
      syncOfflineCheckins();

      const routeFilter = document.getElementById('route-vendor-filter');
      if (routeFilter) {
        routeFilter.addEventListener('change', renderRoutes);
      }

      const checkinsDateFilter = document.getElementById('checkins-date-filter');
      if (checkinsDateFilter) {
        checkinsDateFilter.value = selectedCheckinsDate;
        checkinsDateFilter.addEventListener('change', () => {
          selectedCheckinsDate = checkinsDateFilter.value || new Date().toLocaleDateString("en-CA");
          renderCheckins();
        });
      }

      const checkinsVendorFilter = document.getElementById('checkins-vendor-filter');
      if (checkinsVendorFilter) checkinsVendorFilter.addEventListener('change', () => { selectedCheckinsVendor = checkinsVendorFilter.value || ""; renderCheckins(); });

      const checkinsTypeFilter = document.getElementById('checkins-type-filter');
      if (checkinsTypeFilter) checkinsTypeFilter.addEventListener('change', () => { selectedCheckinsType = checkinsTypeFilter.value || ""; renderCheckins(); });

      const checkinsSelfieFilter = document.getElementById('checkins-selfie-filter');
      if (checkinsSelfieFilter) checkinsSelfieFilter.addEventListener('change', () => { selectedCheckinsSelfie = checkinsSelfieFilter.value || ""; renderCheckins(); });

      const selfieRequiredToggle = document.getElementById('selfie-required-toggle');
      if (selfieRequiredToggle) {
        selfieRequiredToggle.addEventListener('change', async (event) => {
          const desiredValue = event.target.checked;
          event.target.checked = Boolean(securitySettings && securitySettings.selfie_required);
          updateSelfieToggleUi();

          const authorizedBy = await requestSuperUserPassword(desiredValue ? 'activar selfie obligatoria' : 'apagar selfie obligatoria');
          if (!authorizedBy) {
            showNotification('Cambio cancelado. No se modificó la selfie obligatoria.');
            updateSelfieToggleUi();
            return;
          }

          await setSelfieRequired(desiredValue, authorizedBy);
        });
        updateSelfieToggleUi();
      }

      const deleteAllCheckinsBtn = document.getElementById('delete-all-checkins-btn');
      if (deleteAllCheckinsBtn) {
        deleteAllCheckinsBtn.addEventListener('click', deleteAllCheckinsWithSuperAuth);
      }

      renderCheckinVendorFilter();

      const mapTypeFilter = document.getElementById('map-type-filter');
      if (mapTypeFilter) {
        mapTypeFilter.addEventListener('change', renderInternalMap);
      }

      const mapDateFilter = document.getElementById('map-date-filter');
      if (mapDateFilter) {
        mapDateFilter.value = selectedMapDate;
        mapDateFilter.addEventListener('change', () => {
          selectedMapDate = mapDateFilter.value || getTodayDateKey();
          renderInternalMap();
        });
      }

      const mapVendorFilter = document.getElementById('map-vendor-filter');
      if (mapVendorFilter) {
        mapVendorFilter.addEventListener('change', () => {
          selectedMapVendor = mapVendorFilter.value || "";
          renderInternalMap();
        });
      }

      setInterval(refreshDailyViewsIfDateChanged, 60 * 1000);

      const routeDateFilter = document.getElementById('route-date-filter');
      if (routeDateFilter) {
        routeDateFilter.value = selectedRouteDate;
        routeDateFilter.addEventListener('change', () => {
          selectedRouteDate = routeDateFilter.value || new Date().toLocaleDateString("en-CA");
          renderRoutes();
        });
      }


      listenForSecuritySettings();

      const savedSession = sessionStorage.getItem('am_manager_session');
      if (savedSession) {
        try {
          const session = JSON.parse(savedSession);
          if (session && session.name && session.role) {
            openManagerPanel(session, true);
          }
        } catch (error) {
          sessionStorage.removeItem('am_manager_session');
        }
      }
    }

    function listenForCheckins() {
      const q = query(checkinsRef, orderBy("created_at_ms", "desc"));
      onSnapshot(q, (snapshot) => {
        currentData = snapshot.docs.map((item) => {
          const data = item.data();
          return {
            __backendId: item.id,
            vendor_name: data.vendor_name,
            vendor_pin: data.vendor_pin,
            vendor_type: data.vendor_type || data.tipo_vendedor || data.tipoVendedor || '',
            tipo_vendedor: data.tipo_vendedor || data.vendor_type || data.tipoVendedor || '',
            record_type: data.record_type || "visita",
            punctuality_status: data.punctuality_status || data.estado_puntualidad || '',
            estado_puntualidad: data.estado_puntualidad || data.punctuality_status || '',
            minutes_late: Number(data.minutes_late || data.minutos_tarde || 0),
            minutos_tarde: Number(data.minutos_tarde || data.minutes_late || 0),
            location: data.location,
            check_in_time: data.check_in_time,
            created_at_ms: data.created_at_ms,
            latitude: data.latitude,
            longitude: data.longitude,
            gps_accuracy_meters: data.gps_accuracy_meters,
            geo_link: data.geo_link,
            device_id: data.device_id,
            device_info: data.device_info,
            device_status: data.device_status,
            selfie_required: data.selfie_required,
            selfie_photo: data.selfie_photo || data.selfie_full_url || '',
            selfie_thumb: data.selfie_thumb || data.selfie_photo || '',
            selfie_full_url: data.selfie_full_url || data.selfie_photo || '',
            selfie_storage_path: data.selfie_storage_path || "",
            selfie_thumb_storage_path: data.selfie_thumb_storage_path || "",
            selfie_uploaded_to_cloud: Boolean(data.selfie_uploaded_to_cloud),
            selfie_status: data.selfie_status || '',
            registro_status: data.registro_status || 'valido',
            registro_notas: Array.isArray(data.registro_notas) ? data.registro_notas : [],
            hora_fuente: data.hora_fuente || '',
            server_check_in_time: data.server_check_in_time || null,
            prospect_business_name: data.prospect_business_name || '',
            prospect_contact_name: data.prospect_contact_name || '',
            prospect_phone: data.prospect_phone || '',
            prospect_zone: data.prospect_zone || '',
            prospect_client_type: data.prospect_client_type || '',
            prospect_interest: data.prospect_interest || '',
            prospect_comments: data.prospect_comments || '',
            prospect_photo_required: Boolean(data.prospect_photo_required),
            prospect_photo_thumb: data.prospect_photo_thumb || data.prospect_photo || '',
            prospect_photo: data.prospect_photo || data.prospect_photo_thumb || '',
            prospect_photo_status: data.prospect_photo_status || ''
          };
        });
        mergePendingCheckinsIntoCurrentData();
        // Sincroniza el dashboard con los datos reales de Firebase.
        // Antes el dashboard leía arreglos globales que no siempre se actualizaban,
        // por eso se quedaba vacío o atrasado aunque Firebase sí trajera registros.
        window.checkinsData = currentData;
        window.allCheckins = currentData;
        window.checkins = currentData;
        window.records = currentData;
        window.allRecords = currentData;
        renderCheckins();
        renderRRHH();
        renderRoutes();
        renderProspects();
        updateOfflineStatusBanner();
        renderManagerNotifications();
        if (typeof window.refreshManagerRenderDashboard === "function") {
          try { window.refreshManagerRenderDashboard(); } catch (error) { console.warn("Dashboard refresh error", error); }
        }
      }, () => {
        showNotification("No se pudieron cargar los registros en tiempo real");
      });
    }



    function updateSelfieToggleUi() {
      const enabled = Boolean(securitySettings && securitySettings.selfie_required);
      const toggle = document.getElementById('selfie-required-toggle');
      const label = document.getElementById('selfie-required-label');
      const help = document.getElementById('selfie-required-help');

      if (toggle) toggle.checked = enabled;
      if (label) {
        label.textContent = enabled ? 'Selfie automática: ACTIVADA' : 'Selfie automática: APAGADA';
        label.className = enabled ? 'text-sm font-black text-green-800' : 'text-sm font-black text-red-700';
      }
      if (help) {
        help.textContent = enabled
          ? 'Selfie encendida: todos los registros pedirán foto automática con cámara frontal.'
          : 'Selfie apagada: los vendedores registrarán únicamente hora y ubicación, sin pedir foto.';
      }
    }

    function listenForSecuritySettings() {
      onSnapshot(securitySettingsRef, (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() : {};
        const savedLocalValue = localStorage.getItem('am_selfie_required');
        const fallbackValue = savedLocalValue === null ? true : savedLocalValue === 'true';

        securitySettings = {
          selfie_required: typeof data.selfie_required === 'boolean' ? data.selfie_required : fallbackValue
        };

        localStorage.setItem('am_selfie_required', String(securitySettings.selfie_required));
        updateSelfieToggleUi();
        renderManagerNotifications();
      }, () => {
        const savedLocalValue = localStorage.getItem('am_selfie_required');
        securitySettings = { selfie_required: savedLocalValue === null ? true : savedLocalValue === 'true' };
        updateSelfieToggleUi();
        renderManagerNotifications();
      });
    }

    async function setSelfieRequired(value, authorizedBy = null) {
      securitySettings.selfie_required = Boolean(value);
      localStorage.setItem('am_selfie_required', String(securitySettings.selfie_required));
      updateSelfieToggleUi();

      try {
        await setDoc(securitySettingsRef, {
          selfie_required: securitySettings.selfie_required,
          updated_at_ms: Date.now(),
          updated_by_super_user: authorizedBy ? authorizedBy.name : ''
        }, { merge: true });

        showNotification(
          securitySettings.selfie_required
            ? 'Selfie activada: ahora se pedirá foto al registrar'
            : 'Selfie apagada: ya no se pedirá foto al registrar',
          'success'
        );
      } catch (error) {
        showNotification('No se pudo guardar la configuración en la nube. Quedó guardada en este equipo.');
      }
    }

    function cleanCsvCell(value) {
      const text = String(value ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ');
      return `"${text}"`;
    }

    function downloadTextFile(filename, content, mimeType = 'text/csv;charset=utf-8;') {
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    function buildCheckinsBackupCsv(records) {
      const headers = [
        'ID Firebase',
        'Vendedor',
        'Tipo de registro',
        'Fecha y hora',
        'Fecha ISO',
        'Latitud',
        'Longitud',
        'Precision GPS metros',
        'Liga Google Maps',
        'Dispositivo',
        'ID dispositivo',
        'Estatus dispositivo',
        'Selfie requerida',
        'Selfie disponible',
        'Selfie en nube',
        'Estatus selfie'
      ];

      const rows = (records || []).map(record => [
        record.__backendId || '',
        record.vendor_name || '',
        record.checkin_type || record.type || 'check-in',
        record.created_at_ms ? new Date(record.created_at_ms).toLocaleString('es-MX') : '',
        record.created_at_ms ? new Date(record.created_at_ms).toISOString() : '',
        record.latitude || '',
        record.longitude || '',
        record.gps_accuracy_meters || '',
        record.geo_link || '',
        record.device_info || '',
        record.device_id || '',
        record.device_status || '',
        record.selfie_required ? 'SI' : 'NO',
        (record.selfie_photo || record.selfie_thumb || record.selfie_full_url) ? 'SI' : 'NO',
        record.selfie_uploaded_to_cloud ? 'SI' : 'NO',
        record.selfie_status || ''
      ]);

      return [headers, ...rows].map(row => row.map(cleanCsvCell).join(',')).join('\n');
    }

    function downloadCheckinsBackup(records, authorizedBy) {
      const safeRecords = Array.isArray(records) ? records : [];
      const now = new Date();
      const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const filename = `respaldo_registros_AM_Autopartes_${stamp}.csv`;
      const metadataLines = [
        ['Respaldo generado', now.toLocaleString('es-MX')],
        ['Autorizado por', authorizedBy?.name || 'Super usuario'],
        ['Total registros respaldados', safeRecords.length],
        []
      ].map(row => row.map(cleanCsvCell).join(',')).join('\n');
      const csv = metadataLines + buildCheckinsBackupCsv(safeRecords);
      downloadTextFile(filename, csv);
      return filename;
    }

    async function registerDeletionLog({ authorizedBy, totalRecords, backupFilename, status, errorMessage = '' }) {
      try {
        await addDoc(deletionLogsRef, {
          action: 'BORRADO_TOTAL_REGISTROS',
          authorized_by: authorizedBy?.name || 'Super usuario',
          authorized_role: authorizedBy?.role || 'super usuario',
          total_records: Number(totalRecords || 0),
          backup_filename: backupFilename || '',
          status: status || 'COMPLETADO',
          error_message: errorMessage || '',
          device_info: navigator.userAgent,
          created_at_ms: Date.now(),
          created_at_iso: new Date().toISOString()
        });
      } catch (error) {
        console.error('No se pudo guardar historial de borrado:', error);
      }
    }

    function listenForDeletionLogs() {
      const container = document.getElementById('deletion-logs-list');
      if (!container) return;

      const q = query(deletionLogsRef, orderBy('created_at_ms', 'desc'));
      onSnapshot(q, (snapshot) => {
        const logs = snapshot.docs.slice(0, 10).map(item => ({ __backendId: item.id, ...item.data() }));
        allDeletionLogs = logs;
        renderManagerNotifications();
        if (!logs.length) {
          container.innerHTML = '<p class="text-sm text-gray-500">Todavía no hay borrados registrados.</p>';
          return;
        }

        container.innerHTML = logs.map(log => {
          const dateText = log.created_at_ms ? new Date(log.created_at_ms).toLocaleString('es-MX') : 'Sin fecha';
          const statusClass = log.status === 'COMPLETADO' ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50';
          return `
            <div class="rounded-2xl border border-gray-200 bg-white/85 p-4">
              <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div>
                  <p class="font-black text-gray-900">${escapeHtml(log.action || 'BORRADO_TOTAL_REGISTROS')}</p>
                  <p class="text-sm text-gray-600">Autorizó: <b>${escapeHtml(log.authorized_by || 'Super usuario')}</b></p>
                  <p class="text-xs text-gray-500">${escapeHtml(dateText)}</p>
                </div>
                <span class="inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-black ${statusClass}">${escapeHtml(log.status || 'COMPLETADO')}</span>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3 text-xs text-gray-600">
                <p><b>Registros:</b> ${Number(log.total_records || 0)}</p>
                <p><b>Respaldo:</b> ${escapeHtml(log.backup_filename || 'Sin archivo')}</p>
              </div>
            </div>
          `;
        }).join('');
        lucide.createIcons();
      }, (error) => {
        console.error('No se pudo cargar historial de borrados:', error);
        container.innerHTML = '<p class="text-sm text-red-600 font-bold">No se pudo cargar el historial de borrados.</p>';
      });
    }

    async function deleteAllCheckinsWithSuperAuth() {
      const authorizedBy = await requestSuperUserPassword('borrar todos los registros');
      if (!authorizedBy) {
        showNotification('Borrado cancelado. No se eliminó ningún registro.');
        return;
      }

      const confirmation = prompt('Para confirmar el borrado definitivo, escribe exactamente: BORRAR');
      if (confirmation !== 'BORRAR') {
        showNotification('Confirmación incorrecta. No se eliminó ningún registro.');
        return;
      }

      const recordsToDelete = currentData.filter(record => record.__backendId);
      const recordsToBackup = currentData.slice();
      const backupFilename = downloadCheckinsBackup(recordsToBackup, authorizedBy);
      showNotification(`Respaldo descargado: ${backupFilename}`, 'success');

      if (!recordsToDelete.length) {
        localStorage.removeItem(OFFLINE_CHECKINS_KEY);
        await registerDeletionLog({ authorizedBy, totalRecords: 0, backupFilename, status: 'SIN_REGISTROS' });
        showNotification('No hay registros en la nube para borrar. Se generó respaldo de seguridad.', 'success');
        return;
      }

      const deleteButton = document.getElementById('delete-all-checkins-btn');
      const originalText = deleteButton ? deleteButton.innerHTML : '';
      if (deleteButton) {
        deleteButton.disabled = true;
        deleteButton.innerHTML = '<i data-lucide="loader" style="width:20px;height:20px;animation:spin 1s linear infinite;"></i> Borrando...';
        lucide.createIcons();
      }

      try {
        for (let i = 0; i < recordsToDelete.length; i += 20) {
          const chunk = recordsToDelete.slice(i, i + 20);
          await Promise.all(chunk.map(record => deleteDoc(doc(db, 'checkins', record.__backendId))));
        }

        await registerDeletionLog({ authorizedBy, totalRecords: recordsToDelete.length, backupFilename, status: 'COMPLETADO' });

        currentData = [];
        localStorage.removeItem(OFFLINE_CHECKINS_KEY);
        renderCheckins();
        renderRoutes();
        renderProspects();
        updateOfflineStatusBanner();
        showNotification(`Registros borrados correctamente por ${authorizedBy.name}.`, 'success');
      } catch (error) {
        console.error('Error al borrar registros:', error);
        await registerDeletionLog({ authorizedBy, totalRecords: recordsToDelete.length, backupFilename, status: 'ERROR', errorMessage: error && error.message ? error.message : String(error) });
        showNotification('No se pudieron borrar todos los registros. Revisa internet/Firebase e intenta de nuevo. El respaldo ya fue descargado.');
      } finally {
        if (deleteButton) {
          deleteButton.disabled = false;
          deleteButton.innerHTML = originalText;
          lucide.createIcons();
        }
      }
    }

    async function getFreshSecuritySettings() {
      try {
        const snap = await withTimeout(getDoc(securitySettingsRef), 5000, 'GET_SECURITY_SETTINGS_TIMEOUT');
        const data = snap.exists() ? snap.data() : {};

        if (typeof data.selfie_required === 'boolean') {
          securitySettings = { selfie_required: data.selfie_required };
          localStorage.setItem('am_selfie_required', String(securitySettings.selfie_required));
          updateSelfieToggleUi();
        }
      } catch (error) {
        console.warn('No se pudo leer configuración fresca de selfie:', error);
      }

      return securitySettings || { selfie_required: false };
    }

    function getVendorSelfieRequiredByType(vendor, recordType) {
      if (!vendor) return false;
      return Boolean(vendor.selfie_required);
    }

    async function getFreshVendorSelfieRequired(vendor, recordType = "visita") {
      if (!vendor) return false;

      try {
        if (navigator.onLine && vendor.__backendId) {
          const snap = await withTimeout(getDoc(doc(db, "vendors", vendor.__backendId)), 5000, 'GET_VENDOR_SELFIE_SETTINGS_TIMEOUT');
          if (snap.exists()) {
            const data = snap.data() || {};
            if (typeof data.selfie_required === 'boolean') return Boolean(data.selfie_required);
          }
        }
      } catch (error) {
        console.warn('No se pudo leer configuración fresca de selfie del vendedor:', error);
      }

      return Boolean(vendor.selfie_required);
    }

    function isSelfieRequiredForVendor(vendor, recordType = "visita") {
      return Boolean(vendor && vendor.selfie_required);
    }

    function listenForVendors() {
      const q = query(vendorsRef, where("active", "==", true));
      onSnapshot(q, (snapshot) => {
        allVendors = snapshot.docs.map((item) => {
          const data = item.data();
          return {
            __backendId: item.id,
            vendor_name: data.vendor_name,
            vendor_pin: data.vendor_pin,
            vendor_type: data.vendor_type || data.tipo_vendedor || data.tipoVendedor || 'local',
            tipo_vendedor: data.tipo_vendedor || data.vendor_type || data.tipoVendedor || 'local',
            active: data.active,
            authorized_device_id: data.authorized_device_id || "",
            authorized_device_info: data.authorized_device_info || "",
            authorized_device_at_ms: data.authorized_device_at_ms || null,
            vendor_photo: data.vendor_photo || data.photo || '',
            vendor_photo_thumb: data.vendor_photo_thumb || data.vendor_photo || data.photo || '',
            biometric_enabled: Boolean(data.biometric_enabled || data.biometrico_activo),
            biometrico_activo: Boolean(data.biometric_enabled || data.biometrico_activo),
            biometric_registered: Boolean(data.biometric_registered),
            selfie_required: Boolean(data.selfie_required),
            selfie_entrada: typeof data.selfie_entrada === 'boolean' ? data.selfie_entrada : Boolean(data.selfie_required),
            selfie_visita: typeof data.selfie_visita === 'boolean' ? data.selfie_visita : Boolean(data.selfie_required),
            selfie_salida: typeof data.selfie_salida === 'boolean' ? data.selfie_salida : Boolean(data.selfie_required),
            prospect_photo_required: typeof data.prospect_photo_required === 'boolean' ? data.prospect_photo_required : false
          };
        }).sort((a, b) => a.vendor_name.localeCompare(b.vendor_name, 'es-MX'));

        // Expone vendedores al dashboard para que las tarjetas se sincronicen en tiempo real.
        window.vendors = allVendors;
        window.allVendors = allVendors;
        window.vendorsData = allVendors;

        renderVendors();
        renderRRHH();
        renderManagerNotifications();
        if (typeof window.refreshManagerRenderDashboard === "function") {
          try { window.refreshManagerRenderDashboard(); } catch (error) { console.warn("Dashboard vendors refresh error", error); }
        }
      }, () => {
        showNotification("No se pudieron cargar los vendedores en tiempo real");
      });
    }

    function escapeHtml(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function escapeJs(value) {
      return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '&quot;')
        .replace(/\n/g, ' ')
        .replace(/\r/g, ' ');
    }

    function openWhatsAppApp(message) {
      const encodedMessage = encodeURIComponent(message);
      const phone = String(WHATSAPP_NUMBER || '').replace(/[^0-9]/g, '');
      const appUrl = `whatsapp://send?phone=${phone}&text=${encodedMessage}`;
      const webUrl = `https://wa.me/${phone}?text=${encodedMessage}`;
      const androidIntentUrl = `intent://send?phone=${phone}&text=${encodedMessage}#Intent;scheme=whatsapp;S.browser_fallback_url=${encodeURIComponent(webUrl)};end`;
      const isAndroid = /Android/i.test(navigator.userAgent || '');
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');

      // En Android abre el selector/app instalada: WhatsApp normal o WhatsApp Business.
      // Evita encadenar varios intentos porque eso podía terminar mandando al navegador/WhatsApp Web.
      if (isAndroid) {
        window.location.href = androidIntentUrl;
        return;
      }

      if (isMobile) {
        window.location.href = appUrl;
        setTimeout(() => { window.location.href = webUrl; }, 1800);
        return;
      }

      window.open(webUrl, '_blank');
    }

    function getManagerLoginOptionsHtml() {
      const superOptions = SUPER_MANAGERS.map(user => `
        <option value="super:${escapeHtml(user.name)}">${escapeHtml(user.name)} · ${escapeHtml(user.role || 'super usuario')}</option>
      `);

      const managerOptions = allManagers.map(manager => {
        const role = getDisplayManagerRole(manager);
        return `
          <option value="manager:${escapeHtml(manager.__backendId)}">${escapeHtml(manager.manager_name)} · ${escapeHtml(role)}</option>
        `;
      });

      return [...superOptions, ...managerOptions].join('');
    }

    function openManagerLogin() {
      const container = document.createElement('div');
      container.id = 'manager-login-modal';
      container.className = 'manager-login-native-in fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4';
      container.innerHTML = `
        <div id="manager-login-card" class="manager-login-native-card bg-white rounded-3xl p-8 shadow-2xl w-full max-w-md border border-gray-200">
          <div class="flex items-center gap-3 mb-5">
            <div class="w-12 h-12 rounded-2xl flex items-center justify-center bg-blue-100">
              <i data-lucide="shield-check" class="text-blue-700" style="width:24px;height:24px;"></i>
            </div>
            <div>
              <h3 class="text-2xl font-black text-gray-900">Acceso gerente</h3>
              <p class="text-sm text-gray-600">La app recuerda el último rol usado. Confirma con huella/rostro o cambia de usuario.</p>
            </div>
          </div>

          <div id="manager-last-user-card" class="rounded-2xl bg-blue-50 border border-blue-100 p-4 mb-4">
            <p class="text-xs font-black text-blue-800 uppercase tracking-wide">Usuario predeterminado</p>
            <p id="manager-last-user-label" class="text-lg font-black text-gray-900 mt-1">Selecciona usuario</p>
            <button id="manager-change-user-btn" type="button" class="mt-3 text-sm font-bold text-blue-700 underline">Cambiar usuario/rol</button>
          </div>

          <select id="manager-name-input" class="input-main mb-3 hidden" autofocus>
            <option value="">Seleccionar usuario</option>
            ${getManagerLoginOptionsHtml()}
          </select>
          <input type="password" id="manager-password-input" placeholder="Contraseña / código maestro" class="input-main mb-4">

          <button id="manager-login-biometric-btn" type="button" class="btn-base btn-primary w-full py-3 mb-3">
            <span style="font-size:20px;line-height:1">🔐</span> Entrar con huella / rostro
          </button>
          <p class="text-xs text-gray-500 text-center mb-4">Primera vez en este celular: selecciona usuario y escribe contraseña para activar huella. Después entra directo con biométrico.</p>

          <div class="grid grid-cols-2 gap-3">
            <button onclick="closeManagerLoginModal()" class="btn-base btn-neutral py-3">
              Cancelar
            </button>
            <button id="manager-login-enter-btn" type="button" class="btn-base bg-white border border-gray-200 text-gray-800 py-3">
              Entrar con clave
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(container);
      lucide.createIcons();
      selectLastManagerIdentityInLogin();
      const changeBtn = document.getElementById('manager-change-user-btn');
      if (changeBtn) changeBtn.addEventListener('click', () => {
        const select = document.getElementById('manager-name-input');
        const lastCard = document.getElementById('manager-last-user-card');
        if (select) { select.classList.remove('hidden'); select.focus(); }
        if (lastCard) lastCard.classList.add('ring-2', 'ring-blue-200');
        showNotification('Selecciona el nuevo usuario/rol y confirma con huella o clave', 'success');
      });
      const enterBtn = document.getElementById('manager-login-enter-btn');
      if (enterBtn) enterBtn.addEventListener('click', verifyManagerPin);
      const bioBtn = document.getElementById('manager-login-biometric-btn');
      if (bioBtn) bioBtn.addEventListener('click', verifyManagerBiometric);
      const passInput = document.getElementById('manager-password-input');
      if (passInput) passInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') verifyManagerPin();
      });
      if (!getLastManagerIdentity()) document.getElementById('manager-name-input')?.classList.remove('hidden');
    }

    document.getElementById('toggle-manager')?.addEventListener('click', openManagerLogin);

    function updateConnectionStatusPill() {
      const pill = document.getElementById('connection-status');
      const text = document.getElementById('connection-status-text');
      if (!pill || !text) return;
      const isOnline = navigator.onLine;
      pill.classList.toggle('offline', !isOnline);
      text.textContent = isOnline ? 'En línea' : 'Sin conexión';
    }
    updateConnectionStatusPill();
    window.addEventListener('online', updateConnectionStatusPill);
    window.addEventListener('offline', updateConnectionStatusPill);


    document.getElementById('exit-manager').addEventListener('click', function () {
      currentManagerSession = null;
      sessionStorage.removeItem('am_manager_session');
      setNativeManagerMode(false);
      document.getElementById('vendor-panel').classList.add('hidden');
      document.getElementById('checkin-panel').classList.remove('hidden');
      document.getElementById('manager-users-panel')?.classList.add('hidden');
      showManagerName();
      lucide.createIcons();
    });

    function normalizeText(value) {
      return String(value || '').trim().toLowerCase();
    }

    function normalizeRole(value) {
      return normalizeText(value).replace(/\s+/g, ' ');
    }

    function isSuperRole(role) {
      const cleanRole = normalizeRole(role);
      return ["super", "super usuario", "superusuario", "super user", "superuser", "direccion", "dirección"].includes(cleanRole);
    }

    function getDisplayManagerRole(manager) {
      const name = normalizeText(manager?.manager_name || manager?.name);
      const role = manager?.manager_role || manager?.role || manager?.writtenRole || 'gerente';
      if (name === 'francisco gonzalez' && isSuperRole(role)) return 'Direccion';
      return role;
    }

    function getUserAccessRole(user) {
      return isSuperRole(user?.role || user?.manager_role) ? "super" : "manager";
    }

    function getSuperManager(name, password) {
      return SUPER_MANAGERS.find(user =>
        normalizeText(user.name) === normalizeText(name) &&
        user.password === password
      );
    }

    function isSuperManager(name, password) {
      return Boolean(getSuperManager(name, password));
    }


    // ===== BIOMÉTRICO PARA GERENTE / RH / SUPER USUARIO =====
    const MANAGER_BIOMETRIC_CREDENTIALS_KEY = 'am_autopartes_manager_biometric_credentials_v1';
    const MANAGER_LAST_IDENTITY_KEY = 'am_autopartes_manager_last_identity_v1';

    function getLastManagerIdentity() {
      try { return JSON.parse(localStorage.getItem(MANAGER_LAST_IDENTITY_KEY) || 'null'); }
      catch (_) { return null; }
    }

    function setLastManagerIdentity(identity, session) {
      if (!identity || !identity.key) return;
      const payload = {
        key: identity.key,
        selectedValue: identity.type + ':' + (identity.type === 'super' ? identity.displayName : identity.source?.__backendId),
        type: identity.type,
        displayName: identity.displayName || session?.name || 'Usuario AM',
        role: identity.writtenRole || session?.writtenRole || session?.role || 'gerente',
        savedAt: new Date().toISOString()
      };
      localStorage.setItem(MANAGER_LAST_IDENTITY_KEY, JSON.stringify(payload));
    }

    function getCurrentManagerIdentityFromSession(session) {
      if (!session) return null;
      const superUser = SUPER_MANAGERS.find(user => normalizeText(user.name) === normalizeText(session.name));
      if (superUser) return { key: `super:${normalizeText(superUser.name)}`, type: 'super', source: superUser, displayName: superUser.name, role: 'super', writtenRole: superUser.role || 'super usuario' };
      const manager = allManagers.find(item => normalizeText(item.manager_name) === normalizeText(session.name));
      if (manager) return { key: `manager:${manager.__backendId}`, type: 'manager', source: manager, displayName: manager.manager_name, role: getUserAccessRole(manager), writtenRole: getDisplayManagerRole(manager) };
      return null;
    }

    function selectLastManagerIdentityInLogin() {
      const last = getLastManagerIdentity();
      const select = document.getElementById('manager-name-input');
      if (!last || !select) return;
      const optionExists = Array.from(select.options).some(option => option.value === last.selectedValue);
      if (optionExists) select.value = last.selectedValue;
      const label = document.getElementById('manager-last-user-label');
      if (label) label.textContent = `${last.displayName || 'Usuario'} · ${last.role || 'rol'}`;
    }

    function getManagerCredentialMap() {
      try { return JSON.parse(localStorage.getItem(MANAGER_BIOMETRIC_CREDENTIALS_KEY) || '{}'); }
      catch (_) { return {}; }
    }

    function setManagerCredentialMap(map) {
      localStorage.setItem(MANAGER_BIOMETRIC_CREDENTIALS_KEY, JSON.stringify(map || {}));
    }

    function getManagerLoginIdentityFromSelect() {
      const userSelect = document.getElementById('manager-name-input');
      const selectedValue = userSelect ? (userSelect.value || '') : '';
      if (!selectedValue) return null;
      const separatorIndex = selectedValue.indexOf(':');
      const type = separatorIndex >= 0 ? selectedValue.slice(0, separatorIndex) : '';
      const idOrName = separatorIndex >= 0 ? selectedValue.slice(separatorIndex + 1) : selectedValue;
      if (type === 'super') {
        const superManager = SUPER_MANAGERS.find(user => normalizeText(user.name) === normalizeText(idOrName));
        if (!superManager) return null;
        return { key: `super:${normalizeText(superManager.name)}`, type, source: superManager, displayName: superManager.name, role: 'super', writtenRole: superManager.role || 'super usuario' };
      }
      if (type === 'manager') {
        const manager = allManagers.find(item => item.__backendId === idOrName);
        if (!manager) return null;
        return { key: `manager:${manager.__backendId}`, type, source: manager, displayName: manager.manager_name, role: getUserAccessRole(manager), writtenRole: getDisplayManagerRole(manager) };
      }
      return null;
    }

    function getStoredManagerCredential(identity) {
      if (!identity || !identity.key) return null;
      return getManagerCredentialMap()[identity.key] || null;
    }

    function storeManagerCredential(identity, credential) {
      const map = getManagerCredentialMap();
      map[identity.key] = credential;
      setManagerCredentialMap(map);
    }

    function validateManagerPasswordForIdentity(identity, password) {
      if (!identity || !password) return null;
      if (password === MANAGER_MASTER_CODE) return { ...MASTER_MANAGER_SESSION };
      if (identity.type === 'super') {
        const superManager = SUPER_MANAGERS.find(user => normalizeText(user.name) === normalizeText(identity.displayName) && user.password === password);
        if (superManager) return { name: superManager.name, role: 'super', writtenRole: superManager.role || 'super usuario' };
      }
      if (identity.type === 'manager') {
        const manager = identity.source;
        if (manager && manager.manager_password === password) return { name: manager.manager_name, role: getUserAccessRole(manager), writtenRole: getDisplayManagerRole(manager) };
      }
      return null;
    }

    async function registerBiometricForManager(identity) {
      if (!supportsBiometricAuth()) throw new Error('BIOMETRIC_NOT_SUPPORTED');
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const userIdSource = new TextEncoder().encode(String(identity.key || identity.displayName || Date.now())).slice(0, 64);
      const credential = await navigator.credentials.create({ publicKey: { challenge, rp: { name: 'AM Autopartes' }, user: { id: userIdSource, name: String(identity.displayName || 'Gerente AM'), displayName: String(identity.displayName || 'Gerente AM') }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' }, timeout: 60000, attestation: 'none' } });
      if (!credential || !credential.rawId) throw new Error('BIOMETRIC_REGISTER_CANCELLED');
      const stored = { id: credential.id, rawId: bytesToBase64Url(credential.rawId), name: identity.displayName || '', role: identity.writtenRole || identity.role || '', created_at_ms: Date.now() };
      storeManagerCredential(identity, stored);
      return stored;
    }

    async function authenticateBiometricForManager(identity) {
      if (!supportsBiometricAuth()) throw new Error('BIOMETRIC_NOT_SUPPORTED');
      const stored = getStoredManagerCredential(identity);
      if (!stored || !stored.rawId) throw new Error('BIOMETRIC_NOT_REGISTERED');
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const assertion = await navigator.credentials.get({ publicKey: { challenge, allowCredentials: [{ id: base64UrlToBytes(stored.rawId), type: 'public-key', transports: ['internal'] }], userVerification: 'required', timeout: 60000 } });
      if (!assertion) throw new Error('BIOMETRIC_AUTH_CANCELLED');
      return true;
    }

    async function verifyManagerBiometric() {
      const button = document.getElementById('manager-login-biometric-btn');
      const passwordInput = document.getElementById('manager-password-input');
      const identity = getManagerLoginIdentityFromSelect();
      if (!identity) { showNotification('Selecciona primero el usuario o rol que va a entrar'); return; }
      if (!supportsBiometricAuth()) { showNotification('Este equipo/navegador no soporta huella o rostro. Usa contraseña como respaldo.'); passwordInput?.focus(); return; }
      const originalText = button ? button.innerHTML : '';
      if (button) { button.disabled = true; button.innerHTML = '<i data-lucide="loader-2" style="width:22px;height:22px;animation:spin 1s linear infinite;"></i> Validando biométrico...'; lucide.createIcons(); }
      try {
        let session = null;
        if (!getStoredManagerCredential(identity)) {
          const password = passwordInput ? passwordInput.value.trim() : '';
          session = validateManagerPasswordForIdentity(identity, password);
          if (!session) { showNotification('Primera activación: escribe la contraseña correcta de ese usuario'); passwordInput?.focus(); return; }
          await registerBiometricForManager(identity);
          showNotification('Huella/rostro activado para este usuario en este celular', 'success');
        } else {
          await authenticateBiometricForManager(identity);
          session = { name: identity.displayName, role: identity.role, writtenRole: identity.writtenRole };
        }
        const previousDefault = getLastManagerIdentity();
        setLastManagerIdentity(identity, session);
        if (previousDefault && previousDefault.key !== identity.key) {
          addManagerNotificationEvent({ type: 'manager_user_changed', level: 'info', icon: 'repeat-2', title: 'Cambio de usuario/rol', detail: `${previousDefault.displayName || 'Usuario anterior'} → ${identity.displayName}`, source: 'Acceso gerente', tab: 'dashboard', actionText: 'Ver dashboard' });
        }
        openManagerPanel(session, false, 'Huella/Rostro');
        showNotification(`Acceso biométrico correcto: ${identity.displayName}`, 'success');
      } catch (error) {
        console.warn('Error biométrico gerente:', error);
        showNotification('No se pudo validar huella/rostro. Usa contraseña como respaldo.');
      } finally {
        if (button) { button.disabled = false; button.innerHTML = originalText || '<span style="font-size:20px;line-height:1">🔐</span> Entrar con huella / rostro'; lucide.createIcons(); }
      }
    }

    function formatManagerSessionTime(value) {
      if (!value) return '-';
      try { return new Date(value).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }); }
      catch (error) { return String(value); }
    }

    function getManagerLoginHistory() {
      try { return JSON.parse(localStorage.getItem('am_manager_login_history') || '[]'); }
      catch (error) { return []; }
    }

    function saveManagerLoginHistory(session) {
      const entry = {
        name: session?.name || 'Gerente AM',
        role: session?.writtenRole || session?.role || 'gerente',
        method: session?.loginMethod || 'Contraseña normal',
        loginAt: session?.loginAt || new Date().toISOString()
      };
      const history = [entry, ...getManagerLoginHistory()].slice(0, 10);
      localStorage.setItem('am_manager_login_history', JSON.stringify(history));
    }

    async function clearManagerLoginHistory() {
      const authorizedBy = await requestSuperUserPassword('borrar el historial de accesos');
      if (!authorizedBy) {
        showNotification('Borrado cancelado');
        return;
      }

      try {
        localStorage.removeItem('am_manager_login_history');
      } catch (error) {
        console.error('No se pudo borrar historial local:', error);
      }

      const list = document.getElementById('manager-login-history-list');
      if (list) {
        list.innerHTML = '<div class="manager-login-history-row"><span>Aún no hay accesos registrados.</span></div>';
      }

      renderManagerSessionInfo();

      if (typeof showNotification === 'function') {
        showNotification('Historial de accesos borrado por super usuario', 'success');
      } else {
        alert('Historial de accesos borrado');
      }
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
      }
    }

    // Necesario porque el botón está en HTML y este archivo corre como módulo.
    window.clearManagerLoginHistory = clearManagerLoginHistory;

    function renderManagerSessionInfo() {
      const userEl = document.getElementById('session-current-user');
      const roleEl = document.getElementById('session-current-role');
      const timeEl = document.getElementById('session-current-time');
      const methodEl = document.getElementById('session-current-method');
      if (userEl) userEl.textContent = currentManagerSession?.name || 'Sin sesión';
      if (roleEl) roleEl.textContent = currentManagerSession?.writtenRole || currentManagerSession?.role || '-';
      if (timeEl) timeEl.textContent = formatManagerSessionTime(currentManagerSession?.loginAt);
      if (methodEl) methodEl.textContent = currentManagerSession?.loginMethod || '-';

      const list = document.getElementById('manager-login-history-list');
      if (!list) return;
      const history = getManagerLoginHistory();
      if (!history.length) {
        list.innerHTML = '<div class="manager-login-history-row"><span>Aún no hay accesos registrados.</span></div>';
        return;
      }
      list.innerHTML = '<div class="manager-login-history-row manager-login-history-head"><span>Usuario</span><span>Rol</span><span>Fecha / hora</span><span>Acceso</span></div>' + history.map(item => `
          <div class="manager-login-history-row">
            <span>${escapeHtml(item.name)}</span>
            <span>${escapeHtml(item.role)}</span>
            <span>${escapeHtml(formatManagerSessionTime(item.loginAt))}</span>
            <span>${escapeHtml(item.method)}</span>
          </div>
        `).join('');
    }

    function showManagerName() {
      let managerNameEl = document.getElementById('current-manager-name');
      if (!managerNameEl) return;
      managerNameEl.className = 'manager-pro-session';
      managerNameEl.textContent = currentManagerSession
        ? `Panel abierto por: ${currentManagerSession.name} · ${currentManagerSession.writtenRole || currentManagerSession.role || 'gerente'} · ${formatManagerSessionTime(currentManagerSession.loginAt)}`
        : '';
      renderManagerSessionInfo();
    }

    function requestSuperUserPassword(actionLabel) {
      return new Promise((resolve) => {
        const container = document.createElement('div');
        container.className = 'manager-login-native-in fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4';
        container.innerHTML = `
          <div class="bg-white rounded-3xl p-8 shadow-2xl w-full max-w-md border border-gray-200">
            <div class="flex items-center gap-3 mb-5">
              <div class="w-12 h-12 rounded-2xl flex items-center justify-center bg-red-100">
                <i data-lucide="shield-alert" class="text-red-600" style="width:24px;height:24px;"></i>
              </div>
              <div>
                <h3 class="text-2xl font-black text-gray-900">Confirmación requerida</h3>
                <p class="text-sm text-gray-600">Ingresa contraseña de super usuario para ${actionLabel}</p>
              </div>
            </div>

            <input type="password" id="super-password-confirm" placeholder="Contraseña super usuario" class="input-main mb-5" autofocus>

            <div class="grid grid-cols-2 gap-3">
              <button id="cancel-super-confirm" class="btn-base btn-neutral py-3">Cancelar</button>
              <button id="accept-super-confirm" class="btn-base btn-danger py-3">Autorizar</button>
            </div>
          </div>
        `;

        document.body.appendChild(container);
        lucide.createIcons();

        const passwordInput = document.getElementById('super-password-confirm');
        const cancelButton = document.getElementById('cancel-super-confirm');
        const acceptButton = document.getElementById('accept-super-confirm');

        const closeWith = (value) => {
          container.remove();
          resolve(value);
        };

        const authorize = () => {
          const password = passwordInput.value.trim();

          if (password === MANAGER_MASTER_CODE) {
            closeWith(MASTER_MANAGER_SESSION);
            return;
          }

          const superUser = SUPER_MANAGERS.find(user => user.password === password);

          if (!superUser) {
            showNotification('Contraseña de super usuario o código maestro incorrecto');
            passwordInput.value = '';
            passwordInput.focus();
            return;
          }

          closeWith(superUser);
        };

        cancelButton.addEventListener('click', () => closeWith(null));
        acceptButton.addEventListener('click', authorize);
        passwordInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') authorize();
        });
        passwordInput.focus();
      });
    }


    function closeManagerLoginModal() {
      document.querySelectorAll('#manager-login-modal, .manager-login-modal').forEach((modal) => modal.remove());
      const managerPasswordInput = document.getElementById('manager-password-input');
      if (managerPasswordInput) {
        const floatingLogin = managerPasswordInput.closest('.fixed');
        if (floatingLogin) floatingLogin.remove();
      }
    }



    function showManagerTab(tabName) {
      const selected = tabName || 'vendedores';
      document.querySelectorAll('[data-manager-tab-content]').forEach((panel) => {
        panel.classList.toggle('hidden', panel.getAttribute('data-manager-tab-content') !== selected);
      });
      document.querySelectorAll('.manager-tab-btn').forEach((button) => {
        button.classList.toggle('active', button.getAttribute('data-tab') === selected);
      });
      if (selected === 'selfie') {
        renderSelfieManagerPanel();
      }
      if (selected === 'eventos') {
        renderProspects();
      }
      if (selected === 'rrhh') {
        renderRRHH();
      }
      if (selected === 'mapa') {
        setTimeout(() => {
          try {
            if (internalMap) forceLeafletResize(internalMap, 180);
            renderInternalMap();
          } catch (error) {
            console.warn('No se pudo refrescar el mapa al abrir pestaña:', error);
          }
        }, 180);
      }
      if (window.lucide) window.lucide.createIcons();
    }

    window.showManagerTab = showManagerTab;



    function setNativeManagerMode(active) {
      const header = document.getElementById('main-app-header');
      if (header) header.classList.toggle('native-hidden', Boolean(active));
      document.body.classList.toggle('manager-native-mode', Boolean(active));
      if (active) {
        setTimeout(() => {
          try { window.scrollTo({ top: 0, behavior: 'smooth' }); }
          catch (error) { window.scrollTo(0, 0); }
        }, 40);
      }
    }

    function openManagerPanel(session, restored = false, loginMethod = 'Contraseña normal') {
      if (!restored) {
        session.loginAt = new Date().toISOString();
        session.loginMethod = loginMethod;
        saveManagerLoginHistory(session);
      } else {
        session.loginAt = session.loginAt || new Date().toISOString();
        session.loginMethod = session.loginMethod || 'Sesión restaurada';
      }
      currentManagerSession = session;
      const identityForDefault = getCurrentManagerIdentityFromSession(session);
      const previousDefault = getLastManagerIdentity();
      if (identityForDefault) {
        setLastManagerIdentity(identityForDefault, session);
        if (!restored && previousDefault && previousDefault.key !== identityForDefault.key) {
          addManagerNotificationEvent({ type: 'manager_user_changed', level: 'info', icon: 'repeat-2', title: 'Cambio de usuario/rol', detail: `${previousDefault.displayName || 'Usuario anterior'} → ${session.name || 'Nuevo usuario'}`, source: 'Acceso gerente', tab: 'dashboard', actionText: 'Ver dashboard' });
        }
      }
      showManagerTab('dashboard');
      sessionStorage.setItem('am_manager_session', JSON.stringify(session));
      closeManagerLoginModal();
      setNativeManagerMode(true);
      document.getElementById('vendor-panel').classList.remove('hidden');
      document.getElementById('checkin-panel').classList.add('hidden');

      const managerUsersPanel = document.getElementById('manager-users-panel');
      if (managerUsersPanel) {
        if (session.role === 'super') {
          managerUsersPanel.classList.remove('hidden');
        } else {
          managerUsersPanel.classList.add('hidden');
        }
      }

      showManagerName();
      renderManagers();
      renderRoutes();
      setTimeout(() => {
        if (internalMap) forceLeafletResize(internalMap, 180);
      }, 150);
      lucide.createIcons();
      setTimeout(closeManagerLoginModal, 50);
    }

    function verifyManagerPin() {
      const userSelect = document.getElementById('manager-name-input');
      const passwordInput = document.getElementById('manager-password-input');
      if (!userSelect || !passwordInput) {
        showNotification('No se encontró el formulario de gerente');
        return;
      }

      const selectedValue = userSelect.value || '';
      const password = passwordInput.value.trim();

      if (!password) {
        showNotification('Ingresa contraseña o código maestro');
        passwordInput.focus();
        return;
      }

      if (password === MANAGER_MASTER_CODE) {
        openManagerPanel({ ...MASTER_MANAGER_SESSION }, false, 'Código maestro');
        showNotification('Acceso con código maestro correcto', 'success');
        return;
      }

      const directSuper = SUPER_MANAGERS.find(user => user.password === password);
      if (directSuper && (!selectedValue || selectedValue.startsWith('super:'))) {
        openManagerPanel({ name: directSuper.name, role: 'super', writtenRole: directSuper.role }, false, 'Contraseña super usuario');
        showNotification(`Acceso de super usuario correcto: ${directSuper.name}`, 'success');
        return;
      }

      if (!selectedValue) {
        showNotification('Selecciona usuario o ingresa una contraseña de super usuario');
        passwordInput.focus();
        return;
      }

      const separatorIndex = selectedValue.indexOf(':');
      const type = separatorIndex >= 0 ? selectedValue.slice(0, separatorIndex) : '';
      const idOrName = separatorIndex >= 0 ? selectedValue.slice(separatorIndex + 1) : selectedValue;

      if (type === 'super') {
        const superManager = SUPER_MANAGERS.find(user =>
          normalizeText(user.name) === normalizeText(idOrName) &&
          user.password === password
        );

        if (superManager) {
          openManagerPanel({ name: superManager.name, role: 'super', writtenRole: superManager.role }, false, 'Contraseña super usuario');
          showNotification(`Acceso de super usuario correcto: ${superManager.name}`, 'success');
          return;
        }
      }

      if (type === 'manager') {
        const manager = allManagers.find(item =>
          item.__backendId === idOrName &&
          item.manager_password === password
        );

        if (manager) {
          const sessionRole = getUserAccessRole(manager);
          openManagerPanel({
            name: manager.manager_name,
            role: sessionRole,
            writtenRole: getDisplayManagerRole(manager)
          }, false, 'Contraseña normal');
          showNotification(sessionRole === 'super' ? 'Acceso de super usuario correcto' : 'Acceso gerente correcto', 'success');
          return;
        }
      }

      showNotification('Usuario o contraseña incorrectos');
      passwordInput.value = '';
      passwordInput.focus();
    }


    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && document.getElementById('manager-password-input')) {
        verifyManagerPin();
      }
    });

    function listenForManagers() {
      const q = query(managersRef, where("active", "==", true));
      onSnapshot(q, (snapshot) => {
        allManagers = snapshot.docs.map((item) => {
          const data = item.data();
          return {
            __backendId: item.id,
            manager_name: data.manager_name,
            manager_password: data.manager_password,
            manager_role: data.manager_role || "gerente",
            active: data.active
          };
        }).sort((a, b) => a.manager_name.localeCompare(b.manager_name, 'es-MX'));

        renderManagers();
      }, () => {
        showNotification("No se pudieron cargar los usuarios gerente");
      });
    }

    function renderManagers() {
      const listEl = document.getElementById('managers-list');
      if (!listEl) return;

      if (!currentManagerSession || currentManagerSession.role !== 'super') {
        listEl.innerHTML = '';
        return;
      }

      if (allManagers.length === 0) {
        listEl.innerHTML = `
          <div class="col-span-full text-center py-10 text-gray-600">
            No hay usuarios del panel creados
          </div>
        `;
        return;
      }

      listEl.innerHTML = allManagers.map(manager => `
        <div class="rounded-2xl p-5 bg-white/85 border border-gray-200 shadow-sm">
          <div class="flex justify-between items-start gap-3 mb-4">
            <div>
              <h3 class="text-lg font-black text-gray-900">${manager.manager_name}</h3>
              <p class="text-sm text-gray-500">Rol: <span class="font-bold">${getDisplayManagerRole(manager)}</span></p>
            </div>

            <button onclick="deleteManagerUser('${manager.__backendId}')" class="w-10 h-10 rounded-xl bg-red-50 text-red-600 hover:bg-red-100 flex items-center justify-center transition" title="Eliminar usuario gerente">
              <i data-lucide="trash-2" style="width:18px;height:18px;"></i>
            </button>
          </div>

          <div class="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 flex items-center gap-2">
            <i data-lucide="lock-keyhole" class="text-blue-700" style="width:16px;height:16px;"></i>
            <span class="text-sm text-gray-700">Contraseña:</span>
            <span class="font-mono font-black text-gray-900">${manager.manager_password}</span>
          </div>
          <div class="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 flex items-center gap-2 mt-3">
            <i data-lucide="shield" class="text-blue-700" style="width:16px;height:16px;"></i>
            <span class="text-sm text-gray-700">Rol escrito:</span>
            <span class="font-black text-gray-900">${getDisplayManagerRole(manager)}</span>
          </div>
        </div>
      `).join('');

      lucide.createIcons();
    }

    document.getElementById('manager-user-form')?.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (isLoading) return;

      if (!currentManagerSession || currentManagerSession.role !== 'super') {
        showNotification('Solo el super usuario puede crear gerentes');
        return;
      }

      const managerName = document.getElementById('new-manager-name').value.trim();
      const managerPassword = document.getElementById('new-manager-password').value.trim();
      const managerRole = document.getElementById('new-manager-role').value.trim();

      if (!managerName || !managerPassword || !managerRole) {
        showNotification('Completa nombre, contraseña y rol del usuario');
        return;
      }

      if (isSuperManager(managerName, managerPassword)) {
        showNotification('Ese acceso ya corresponde al super usuario');
        return;
      }

      if (allManagers.some(m => normalizeText(m.manager_name) === normalizeText(managerName))) {
        showNotification('Ese usuario gerente ya existe');
        return;
      }

      const authorizedSuperUser = await requestSuperUserPassword('crear usuario gerente');
      if (!authorizedSuperUser) return;

      isLoading = true;
      try {
        await addDoc(managersRef, {
          manager_name: managerName,
          manager_password: managerPassword,
          manager_role: managerRole,
          active: true,
          created_by: currentManagerSession ? currentManagerSession.name : "Super usuario",
          authorized_by: authorizedSuperUser.name,
          created_at_ms: Date.now()
        });

        document.getElementById('new-manager-name').value = '';
        document.getElementById('new-manager-password').value = '';
        document.getElementById('new-manager-role').value = '';
        showNotification('Usuario creado correctamente', 'success');
      } catch (error) {
        showNotification('No se pudo crear el usuario gerente');
      } finally {
        isLoading = false;
      }
    });

    async function deleteManagerUser(backendId) {
      if (!currentManagerSession || currentManagerSession.role !== 'super') {
        showNotification('Solo el super usuario puede eliminar gerentes');
        return;
      }

      if (!confirm('¿Seguro que quieres eliminar este usuario gerente?')) return;

      const authorizedSuperUser = await requestSuperUserPassword('eliminar usuario gerente');
      if (!authorizedSuperUser) return;

      try {
        await deleteDoc(doc(db, "managers", backendId));
        showNotification('Usuario gerente eliminado correctamente', 'success');
      } catch (error) {
        showNotification('No se pudo eliminar el usuario gerente');
      }
    }

    function normalizeVendorType(value) {
      const text = String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return text.includes('foraneo') ? 'foraneo' : 'local';
    }

    function getVendorTypeByName(vendorName) {
      const vendor = allVendors.find(v => String(v.vendor_name || '').trim() === String(vendorName || '').trim());
      return normalizeVendorType(vendor ? (vendor.vendor_type || vendor.tipo_vendedor) : 'local');
    }

    function calculatePunctuality(now = new Date()) {
      const ENTRY_HOUR = 9;
      const ENTRY_MINUTE = 0;
      const TOLERANCE_MINUTES = 10;
      const actual = now.getHours() * 60 + now.getMinutes();
      const limit = ENTRY_HOUR * 60 + ENTRY_MINUTE + TOLERANCE_MINUTES;
      const late = Math.max(0, actual - limit);
      return {
        punctuality_status: late > 0 ? 'tarde' : 'puntual',
        estado_puntualidad: late > 0 ? 'tarde' : 'puntual',
        minutes_late: late,
        minutos_tarde: late,
        schedule_start: '09:00',
        schedule_tolerance_minutes: TOLERANCE_MINUTES
      };
    }

    function getRRHHMealStats(vendorName) {
      const cleanName = String(vendorName || '').trim();
      const mealRecords = currentData
        .filter(record => String(record.vendor_name || '').trim() === cleanName)
        .filter(record => ['comida_inicio', 'comida_fin'].includes(String(record.record_type || record.tipo || record.type || '').toLowerCase()))
        .slice()
        .sort((a, b) => new Date(a.check_in_time) - new Date(b.check_in_time));

      const startsByDay = {};
      const meals = [];

      mealRecords.forEach(record => {
        const type = String(record.record_type || record.tipo || record.type || '').toLowerCase();
        const dateKey = getRecordDateKey ? getRecordDateKey(record) : new Date(record.check_in_time).toLocaleDateString('en-CA');
        if (type === 'comida_inicio') {
          startsByDay[dateKey] = record;
          return;
        }
        if (type === 'comida_fin' && startsByDay[dateKey]) {
          const start = startsByDay[dateKey];
          const startTime = new Date(start.check_in_time);
          const endTime = new Date(record.check_in_time);
          const minutes = Math.max(0, Math.round((endTime - startTime) / 60000));
          meals.push({ dateKey, start, end: record, minutes });
          delete startsByDay[dateKey];
        }
      });

      const openMeals = Object.values(startsByDay).length;
      const totalMinutes = meals.reduce((sum, meal) => sum + meal.minutes, 0);
      const avgMinutes = meals.length ? Math.round(totalMinutes / meals.length) : 0;
      const over60 = meals.filter(meal => meal.minutes > 60).length;

      return {
        comidas: meals.length,
        abiertas: openMeals,
        promedioMinutos: avgMinutes,
        excesos: over60,
        totalMinutos: totalMinutes,
        detalle: meals
      };
    }

    function formatMealMinutes(minutes) {
      const n = Number(minutes || 0);
      if (!n) return '0 min';
      const h = Math.floor(n / 60);
      const m = n % 60;
      if (!h) return `${m} min`;
      return m ? `${h} h ${m} min` : `${h} h`;
    }

    function getRRHHSelectedType() {
      const select = document.getElementById('rrhh-vendor-type-filter');
      return select ? (select.value || 'foraneo') : 'foraneo';
    }

    function getRRHHSelectedVendors() {
      const selectedType = getRRHHSelectedType();
      return allVendors.filter(v => {
        const type = normalizeVendorType(v.vendor_type || v.tipo_vendedor);
        return selectedType === 'todos' ? true : type === selectedType;
      });
    }

    function getRRHHDateFilters() {
      const fromInput = document.getElementById('rrhh-date-from');
      const toInput = document.getElementById('rrhh-date-to');
      let from = fromInput ? String(fromInput.value || '') : '';
      let to = toInput ? String(toInput.value || '') : '';
      if (from && to && from > to) {
        const temp = from;
        from = to;
        to = temp;
      }
      return { from, to };
    }

    function isRRHHDayInRange(day) {
      const filters = getRRHHDateFilters();
      if (!day) return false;
      if (filters.from && day < filters.from) return false;
      if (filters.to && day > filters.to) return false;
      return true;
    }

    function setRRHHDateToday() {
      const today = getTodayDateKey();
      const fromInput = document.getElementById('rrhh-date-from');
      const toInput = document.getElementById('rrhh-date-to');
      if (fromInput) fromInput.value = today;
      if (toInput) toInput.value = today;
      applyRRHHTypeFilter();
    }

    function clearRRHHDateFilter() {
      const fromInput = document.getElementById('rrhh-date-from');
      const toInput = document.getElementById('rrhh-date-to');
      if (fromInput) fromInput.value = '';
      if (toInput) toInput.value = '';
      applyRRHHTypeFilter();
    }

    window.setRRHHDateToday = setRRHHDateToday;
    window.clearRRHHDateFilter = clearRRHHDateFilter;

    function getRRHHDailyRows() {
      const vendorsToReview = getRRHHSelectedVendors();
      const rows = [];
      vendorsToReview.forEach(vendor => {
        const name = String(vendor.vendor_name || '').trim();
        const records = currentData
          .filter(record => String(record.vendor_name || '').trim() === name)
          .sort((a, b) => new Date(a.check_in_time) - new Date(b.check_in_time));
        const byDay = {};
        records.forEach(record => {
          const day = getRecordDateKey(record);
          if (!day || !isRRHHDayInRange(day)) return;
          if (!byDay[day]) byDay[day] = { name, day, entrada: null, comidaInicio: null, comidaFin: null, salida: null };
          const type = String(record.record_type || record.tipo || record.type || '').toLowerCase();
          if ((type.includes('inicio') || type.includes('entrada')) && type !== 'comida_inicio') {
            if (!byDay[day].entrada || new Date(record.check_in_time) < new Date(byDay[day].entrada.check_in_time)) byDay[day].entrada = record;
          }
          if (type === 'comida_inicio') byDay[day].comidaInicio = record;
          if (type === 'comida_fin') byDay[day].comidaFin = record;
          if (type.includes('fin_ruta') || type.includes('salida')) byDay[day].salida = record;
        });
        Object.values(byDay).forEach(row => {
          const inicio = row.comidaInicio ? new Date(row.comidaInicio.check_in_time) : null;
          const fin = row.comidaFin ? new Date(row.comidaFin.check_in_time) : null;
          const minutosComida = inicio && fin ? Math.max(0, Math.round((fin - inicio) / 60000)) : 0;
          const puntual = row.entrada && String(row.entrada.punctuality_status || row.entrada.estado_puntualidad || '').toLowerCase() === 'puntual';
          const tasa = row.entrada ? (puntual ? '100%' : '0%') : 'Sin entrada';
          rows.push({ ...row, minutosComida, exceso: minutosComida > 60 ? 'SI' : 'NO', tasa });
        });
      });
      return rows.sort((a,b) => String(b.day).localeCompare(String(a.day)) || String(a.name).localeCompare(String(b.name)));
    }

    function formatRRHHTime(record) {
      if (!record || !record.check_in_time) return '-';
      return new Date(record.check_in_time).toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' });
    }

    function renderRRHH() {
      const body = document.getElementById('rrhh-table-body');
      if (!body) return;
      const selectedType = getRRHHSelectedType();
      const vendorsToReview = getRRHHSelectedVendors();
      const rows = getRRHHDailyRows();
      const entradas = rows.filter(r => r.entrada);
      const puntuales = entradas.filter(r => r.tasa === '100%').length;
      const tardes = Math.max(0, entradas.length - puntuales);
      const kpi = entradas.length ? Math.round((puntuales / entradas.length) * 100) : 0;
      const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
      setText('rrhh-puntualidad-general', kpi + '%');
      const activeLabel = selectedType === 'local' ? 'Locales activos' : (selectedType === 'todos' ? 'Vendedores activos' : 'Foráneos activos');
      setText('rrhh-vendedores-label', activeLabel);
      setText('rrhh-foraneos-activos', String(vendorsToReview.length));
      setText('rrhh-entradas-total', String(entradas.length));
      setText('rrhh-tardes-total', String(tardes));

      if (!vendorsToReview.length) {
        const emptyType = selectedType === 'local' ? 'locales' : (selectedType === 'todos' ? 'vendedores' : 'foráneos');
        body.innerHTML = `<tr><td class="px-4 py-6 text-gray-500" colspan="8">Aún no tienes vendedores ${emptyType} dados de alta.</td></tr>`;
        return;
      }
      if (!rows.length) {
        body.innerHTML = '<tr><td class="px-4 py-6 text-gray-500" colspan="8">Aún no hay registros para mostrar.</td></tr>';
        return;
      }

      body.innerHTML = rows.map(row => {
        const tasaColor = row.tasa === '100%' ? 'text-green-700' : (row.tasa === 'Sin entrada' ? 'text-gray-500' : 'text-red-600');
        const excesoColor = row.exceso === 'SI' ? 'text-red-600' : 'text-green-700';
        const comidaTxt = row.minutosComida ? formatMealMinutes(row.minutosComida) : (row.comidaInicio && !row.comidaFin ? 'Abierta' : '-');
        return `
          <tr class="border-t border-gray-100">
            <td class="px-4 py-4 font-black text-gray-900">${escapeHtml(row.name || 'Sin nombre')}</td>
            <td class="px-4 py-4">${formatRRHHTime(row.entrada)}</td>
            <td class="px-4 py-4">${formatRRHHTime(row.comidaInicio)}</td>
            <td class="px-4 py-4 font-black text-blue-700">${formatRRHHTime(row.comidaFin)}</td>
            <td class="px-4 py-4">${formatRRHHTime(row.salida)}</td>
            <td class="px-4 py-4 font-bold">${comidaTxt}</td>
            <td class="px-4 py-4 font-black ${excesoColor}">${row.exceso}</td>
            <td class="px-4 py-4 font-black ${tasaColor}">${row.tasa}</td>
          </tr>`;
      }).join('');
      if (window.lucide) window.lucide.createIcons();
    }

    window.renderRRHH = renderRRHH;

    function refreshRRHHPanel() {
      renderRRHH();
      const rows = getRRHHDailyRows();
      const selectedType = getRRHHSelectedType();
      const entradas = rows.filter(row => row.entrada).length;
      notifyRRHHAction('RRHH actualizado', getRRHHFilterLabel(selectedType) + ' · ' + entradas + ' entrada' + (entradas === 1 ? '' : 's') + ' revisada' + (entradas === 1 ? '' : 's'), { level: 'success', icon: 'refresh-cw', type: 'rrhh_refresh' });
      showNotification('Datos de RRHH actualizados', 'success');
    }

    function applyRRHHTypeFilter() {
      renderRRHH();
      const selectedType = getRRHHSelectedType();
      const vendorsToReview = getRRHHSelectedVendors();
      notifyRRHHAction('Filtro RRHH aplicado', 'Vista: ' + getRRHHFilterLabel(selectedType) + ' · ' + vendorsToReview.length + ' vendedor' + (vendorsToReview.length === 1 ? '' : 'es'), { level: 'info', icon: 'filter', type: 'rrhh_filter' });
      showNotification('Filtro aplicado: ' + getRRHHFilterLabel(selectedType), 'success');
    }

    window.refreshRRHHPanel = refreshRRHHPanel;
    window.applyRRHHTypeFilter = applyRRHHTypeFilter;

    function downloadRRHHExcel() {
      const rows = getRRHHDailyRows();
      if (!rows.length) {
        showNotification('No hay registros de RRHH para exportar');
        notifyRRHHAction('Excel RRHH sin datos', 'No hubo registros para exportar con el filtro actual.', { level: 'warning', icon: 'file-warning', type: 'rrhh_excel_empty' });
        return;
      }
      let csvContent = '\uFEFF';
      csvContent += 'Filtro,Desde,Hasta,Nombre del vendedor,Fecha,Hora de entrada,Inicio comida,Regreso comida,Hora de salida,Duración,Excesos +60 min,Tasa de puntualidad\n';
      rows.forEach(row => {
        const safeName = `"${String(row.name || '').replace(/"/g, '""')}"`;
        const fecha = row.day || '';
        const comidaTxt = row.minutosComida ? formatMealMinutes(row.minutosComida) : (row.comidaInicio && !row.comidaFin ? 'Abierta' : '-');
        const filtro = getRRHHSelectedType();
        const dateFilters = getRRHHDateFilters();
        csvContent += `"${filtro}","${dateFilters.from || 'Todos'}","${dateFilters.to || 'Todos'}",${safeName},"${fecha}","${formatRRHHTime(row.entrada)}","${formatRRHHTime(row.comidaInicio)}","${formatRRHHTime(row.comidaFin)}","${formatRRHHTime(row.salida)}","${comidaTxt}","${row.exceso}","${row.tasa}"\n`;
      });
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `rrhh-reporte-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      notifyRRHHAction('Excel RRHH descargado', 'Se exportaron ' + rows.length + ' registro' + (rows.length === 1 ? '' : 's') + ' con filtro ' + getRRHHFilterLabel(getRRHHSelectedType()) + '.', { level: 'success', icon: 'file-spreadsheet', type: 'rrhh_excel_download' });
      showNotification('Reporte RRHH descargado correctamente', 'success');
    }

    window.downloadRRHHExcel = downloadRRHHExcel;


    async function fileToCompressedDataUrl(file, maxSize = 420, quality = 0.78) {
      if (!file) return '';
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('No se pudo leer la foto'));
        reader.onload = () => {
          const img = new Image();
          img.onerror = () => reject(new Error('No se pudo procesar la foto'));
          img.onload = () => {
            const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', quality));
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      });
    }

    const vendorPhotoInput = document.getElementById('new-vendor-photo');
    if (vendorPhotoInput) {
      vendorPhotoInput.addEventListener('change', async function () {
        const preview = document.getElementById('new-vendor-photo-preview');
        const file = this.files && this.files[0];
        if (!preview) return;
        if (!file) {
          preview.removeAttribute('src');
          preview.style.display = 'none';
          return;
        }
        try {
          preview.src = await fileToCompressedDataUrl(file, 180, 0.72);
          preview.style.display = 'block';
        } catch (error) {
          preview.removeAttribute('src');
          preview.style.display = 'none';
          showNotification('No se pudo previsualizar la foto');
        }
      });
    }

    document.getElementById('vendor-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (isLoading) return;

      const vendorName = document.getElementById('new-vendor-name').value.trim();
      const vendorPin = document.getElementById('new-vendor-pin').value.trim();
      const vendorType = document.getElementById('new-vendor-type') ? document.getElementById('new-vendor-type').value : 'local';
      const vendorPhotoFile = document.getElementById('new-vendor-photo') && document.getElementById('new-vendor-photo').files ? document.getElementById('new-vendor-photo').files[0] : null;
      const biometricEnabled = Boolean(document.getElementById('new-vendor-biometric') && document.getElementById('new-vendor-biometric').checked);

      if (!vendorName || !vendorPin) {
        showNotification('Por favor completa todos los campos');
        return;
      }

      if (allVendors.some(v => v.vendor_pin === vendorPin)) {
        showNotification('El PIN ya está registrado para otro vendedor');
        return;
      }

      const authorizedSuperUser = await requestSuperUserPassword('agregar vendedor');
      if (!authorizedSuperUser) return;

      isLoading = true;

      try {
        const vendorPhoto = vendorPhotoFile ? await fileToCompressedDataUrl(vendorPhotoFile, 420, 0.78) : '';

        await addDoc(vendorsRef, {
          vendor_name: vendorName,
          vendor_pin: vendorPin,
          vendor_type: vendorType,
          tipo_vendedor: vendorType,
          vendor_photo: vendorPhoto,
          vendor_photo_thumb: vendorPhoto,
          biometric_enabled: biometricEnabled,
          biometrico_activo: biometricEnabled,
          biometric_registered: false,
          active: true,
          selfie_required: false,
          selfie_entrada: false,
          selfie_visita: false,
          selfie_salida: false,
          prospect_photo_required: false,
          authorized_by: authorizedSuperUser.name,
          created_at_ms: Date.now()
        });

        document.getElementById('new-vendor-name').value = '';
        document.getElementById('new-vendor-pin').value = '';
        if (document.getElementById('new-vendor-type')) document.getElementById('new-vendor-type').value = 'local';
        if (document.getElementById('new-vendor-photo')) document.getElementById('new-vendor-photo').value = '';
        if (document.getElementById('new-vendor-photo-preview')) { document.getElementById('new-vendor-photo-preview').removeAttribute('src'); document.getElementById('new-vendor-photo-preview').style.display = 'none'; }
        if (document.getElementById('new-vendor-biometric')) document.getElementById('new-vendor-biometric').checked = false;
        showNotification('Vendedor agregado correctamente', 'success');
      } catch (error) {
        showNotification('No se pudo guardar el vendedor en Firebase');
      } finally {
        isLoading = false;
      }
    });

    function renderVendors() {
      const listEl = document.getElementById('vendors-list');

      if (allVendors.length === 0) {
        listEl.innerHTML = `
          <div class="col-span-full text-center py-10 text-gray-600">
            No hay vendedores registrados
          </div>
        `;
        if (typeof refreshBiometricVendorSelect === 'function') refreshBiometricVendorSelect();
        return;
      }

      listEl.innerHTML = allVendors.map(vendor => `
        <div class="rounded-2xl p-5 bg-white/85 border border-gray-200 shadow-sm">
          <div class="flex justify-between items-start gap-3 mb-4">
            <div class="flex items-center gap-3">
              ${vendor.vendor_photo_thumb ? `<img src="${vendor.vendor_photo_thumb}" alt="${escapeHtml(vendor.vendor_name)}" style="width:54px;height:54px;border-radius:18px;object-fit:cover;border:1px solid #e5e7eb;">` : `<div style="width:54px;height:54px;border-radius:18px;background:#dbeafe;color:#1d4ed8;display:flex;align-items:center;justify-content:center;font-weight:900;">${escapeHtml(String(vendor.vendor_name || 'V').trim().charAt(0).toUpperCase())}</div>`}
              <div>
                <div style="display:flex;align-items:center;gap:8px;"><span style="width:12px;height:12px;border-radius:50%;display:inline-block;background:${getVendorColor(vendor.vendor_name)};"></span><h3 class="text-lg font-black text-gray-900">${escapeHtml(vendor.vendor_name)}</h3></div>
                <p class="text-sm text-gray-500">Vendedor activo · <span class="font-black ${String(vendor.vendor_type || vendor.tipo_vendedor || 'local').toLowerCase() === 'foraneo' ? 'text-red-600' : 'text-blue-700'}">${String(vendor.vendor_type || vendor.tipo_vendedor || 'local').toLowerCase() === 'foraneo' ? 'FORÁNEO' : 'LOCAL'}</span></p>
              </div>
            </div>

            <button onclick="deleteVendor('${vendor.__backendId}')" class="w-10 h-10 rounded-xl bg-red-50 text-red-600 hover:bg-red-100 flex items-center justify-center transition" title="Eliminar vendedor">
              <i data-lucide="trash-2" style="width:18px;height:18px;"></i>
            </button>
          </div>

          <div class="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 flex items-center gap-2">
            <i data-lucide="key" class="text-blue-700" style="width:16px;height:16px;"></i>
            <span class="text-sm text-gray-700">PIN:</span>
            <span class="font-mono font-black text-gray-900">${escapeHtml(vendor.vendor_pin)}</span>
          </div>

          <div class="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 flex items-center gap-2">
            <span style="font-size:18px;line-height:1;">${vendor.biometric_enabled ? '🟢' : '⚪'}</span>
            <span class="text-sm text-gray-700">Biométrico:</span>
            <span class="font-black ${vendor.biometric_enabled ? 'text-green-700' : 'text-gray-500'}">${vendor.biometric_enabled ? 'ACTIVO' : 'INACTIVO'}</span>
          </div>

          <div class="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
            <div class="flex items-center gap-2 text-sm text-gray-700 font-bold mb-2">
              <i data-lucide="map-pin" class="text-red-600" style="width:16px;height:16px;"></i>
              Tipo de vendedor
            </div>
            <select class="input-main" onchange="updateVendorType('${vendor.__backendId}', this.value)">
              <option value="local" ${String(vendor.vendor_type || vendor.tipo_vendedor || 'local').toLowerCase() === 'foraneo' ? '' : 'selected'}>Local</option>
              <option value="foraneo" ${String(vendor.vendor_type || vendor.tipo_vendedor || 'local').toLowerCase() === 'foraneo' ? 'selected' : ''}>Foráneo</option>
            </select>
            <p class="text-[11px] text-gray-500 mt-2">Los foráneos se miden en la pestaña RR. HH.</p>
          </div>

          <div class="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
            <div class="flex items-center gap-2 text-sm text-gray-700 font-bold">
              <i data-lucide="smartphone" class="text-blue-700" style="width:16px;height:16px;"></i>
              Dispositivo autorizado
            </div>
            <div class="mt-1 text-xs text-gray-600">${vendor.authorized_device_info ? escapeHtml(vendor.authorized_device_info) : 'Pendiente de primer check-in'}</div>
            <div class="mt-1 font-mono text-[10px] text-gray-500 break-all">${vendor.authorized_device_id ? escapeHtml(vendor.authorized_device_id) : 'Sin ID registrado'}</div>
            <button onclick="resetVendorDevice('${vendor.__backendId}')" class="mt-3 w-full rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100 px-3 py-2 text-xs font-black transition">
              Autorizar nuevo dispositivo
            </button>
            <p class="text-[11px] text-gray-500 mt-2">Esto libera el dispositivo actual; el siguiente celular donde marque ese vendedor quedará autorizado.</p>
          </div>

          
        </div>
      `).join('');

      lucide.createIcons();
      if (typeof refreshBiometricVendorSelect === 'function') refreshBiometricVendorSelect();
    }



    async function updateVendorType(backendId, value) {
      const vendor = allVendors.find(v => v.__backendId === backendId);
      if (!vendor) return;
      const normalized = normalizeVendorType(value);
      const authorizedSuperUser = await requestSuperUserPassword(`cambiar tipo de vendedor de ${vendor.vendor_name}`);
      if (!authorizedSuperUser) {
        renderVendors();
        return;
      }
      try {
        await updateDoc(doc(db, 'vendors', backendId), {
          vendor_type: normalized,
          tipo_vendedor: normalized,
          updated_at_ms: Date.now(),
          updated_by_super_user: authorizedSuperUser.name
        });
        vendor.vendor_type = normalized;
        vendor.tipo_vendedor = normalized;
        renderVendors();
        renderRRHH();
        showNotification(`Tipo actualizado: ${vendor.vendor_name} ahora es ${normalized === 'foraneo' ? 'foráneo' : 'local'}`, 'success');
      } catch (error) {
        showNotification('No se pudo actualizar el tipo de vendedor');
        renderVendors();
      }
    }

    window.updateVendorType = updateVendorType;

    function renderSelfieManagerPanel() {
      const list = document.getElementById('selfie-manager-list');
      if (!list) return;

      if (!allVendors || allVendors.length === 0) {
        list.innerHTML = '<div class="p-4 text-sm text-gray-500">No hay vendedores cargados.</div>';
        return;
      }

      let countActive = 0;
      let countInactive = 0;
      let prospectPhotoActive = 0;
      let prospectPhotoInactive = 0;

      list.innerHTML = allVendors.map((vendor) => {
        const enabled = Boolean(vendor.selfie_required);
        const localPhotoEnabled = Boolean(vendor.prospect_photo_required);
        if (enabled) countActive++; else countInactive++;
        if (localPhotoEnabled) prospectPhotoActive++; else prospectPhotoInactive++;

        return `
          <div class="grid grid-cols-3 gap-2 px-4 py-4 items-center">
            <div>
              <p class="font-black text-gray-900">${escapeHtml(vendor.vendor_name)}</p>
              <p class="text-xs text-gray-500">PIN: ${escapeHtml(vendor.vendor_pin || '')}</p>
            </div>
            <label class="flex justify-center items-center gap-3">
              <span class="text-xs font-black ${enabled ? 'text-green-700' : 'text-gray-500'}">${enabled ? 'ENCENDIDA' : 'APAGADA'}</span>
              <input type="checkbox" class="w-6 h-6 accent-blue-700" ${enabled ? 'checked' : ''} onchange="updateVendorSelfieSetting('${vendor.__backendId}', this.checked)">
            </label>
            <label class="flex justify-center items-center gap-3">
              <span class="text-xs font-black ${localPhotoEnabled ? 'text-green-700' : 'text-gray-500'}">${localPhotoEnabled ? 'ENCENDIDA' : 'APAGADA'}</span>
              <input type="checkbox" class="w-6 h-6 accent-red-600" ${localPhotoEnabled ? 'checked' : ''} onchange="updateVendorProspectPhotoSetting('${vendor.__backendId}', this.checked)">
            </label>
          </div>
        `;
      }).join('');

      const activeEl = document.getElementById('selfie-count-active');
      const inactiveEl = document.getElementById('selfie-count-inactive');
      const prospectPhotoActiveEl = document.getElementById('prospect-photo-count-active');
      const prospectPhotoInactiveEl = document.getElementById('prospect-photo-count-inactive');

      if (activeEl) activeEl.textContent = countActive;
      if (inactiveEl) inactiveEl.textContent = countInactive;
      if (prospectPhotoActiveEl) prospectPhotoActiveEl.textContent = prospectPhotoActive;
      if (prospectPhotoInactiveEl) prospectPhotoInactiveEl.textContent = prospectPhotoInactive;
    }

    window.renderSelfieManagerPanel = renderSelfieManagerPanel;


    async function updateVendorProspectPhotoSetting(backendId, value) {
      const vendor = allVendors.find(v => v.__backendId === backendId);
      if (!vendor) return;

      const authorizedSuperUser = await requestSuperUserPassword(`${value ? 'encender' : 'apagar'} foto de local para eventos de ${vendor.vendor_name}`);
      if (!authorizedSuperUser) {
        renderSelfieManagerPanel();
        return;
      }

      try {
        await updateDoc(doc(db, 'vendors', backendId), {
          prospect_photo_required: Boolean(value),
          prospect_photo_updated_at_ms: Date.now(),
          prospect_photo_updated_by: authorizedSuperUser.name || authorizedSuperUser.email || 'super_usuario'
        });
        vendor.prospect_photo_required = Boolean(value);
        renderSelfieManagerPanel();
        showNotification(value ? 'Foto de local activada para eventos' : 'Foto de local apagada para eventos', 'success');
      } catch (error) {
        console.error('Error actualizando foto de local:', error);
        showNotification('No se pudo actualizar la foto de local. Revisa conexión.');
        renderSelfieManagerPanel();
      }
    }

    window.updateVendorProspectPhotoSetting = updateVendorProspectPhotoSetting;


    async function updateVendorSelfieSetting(backendId, value) {
      const vendor = allVendors.find(v => v.__backendId === backendId);
      if (!vendor) return;

      const authorizedSuperUser = await requestSuperUserPassword(`${value ? 'encender' : 'apagar'} selfie para ${vendor.vendor_name}`);
      if (!authorizedSuperUser) {
        renderVendors();
        renderSelfieManagerPanel();
        return;
      }

      try {
        await updateDoc(doc(db, "vendors", backendId), {
          selfie_required: Boolean(value),
          selfie_entrada: Boolean(value),
          selfie_visita: Boolean(value),
          selfie_salida: Boolean(value),
          selfie_settings_updated_by: authorizedSuperUser.name,
          selfie_settings_updated_at_ms: Date.now()
        });

        vendor.selfie_required = Boolean(value);
        vendor.selfie_entrada = Boolean(value);
        vendor.selfie_visita = Boolean(value);
        vendor.selfie_salida = Boolean(value);
        renderVendors();
        renderSelfieManagerPanel();
        showNotification(`Selfie ${value ? 'encendida' : 'apagada'} para ${vendor.vendor_name}`, 'success');
      } catch (error) {
        console.error('No se pudo actualizar selfie del vendedor:', error);
        renderVendors();
        renderSelfieManagerPanel();
        showNotification('No se pudo actualizar la configuración de selfie del vendedor');
      }
    }

    window.updateVendorSelfieSetting = updateVendorSelfieSetting;

    async function resetVendorDevice(backendId) {
      const vendor = allVendors.find(v => v.__backendId === backendId);
      if (!vendor) return;

      if (!confirm(`¿Liberar el dispositivo autorizado de ${vendor.vendor_name}?\n\nEl siguiente celular donde marque con su PIN quedará autorizado.`)) return;

      const authorizedSuperUser = await requestSuperUserPassword(`autorizar nuevo dispositivo de ${vendor.vendor_name}`);
      if (!authorizedSuperUser) return;

      try {
        await updateDoc(doc(db, "vendors", backendId), {
          authorized_device_id: "",
          authorized_device_info: "",
          authorized_device_at_ms: null,
          device_reset_by: authorizedSuperUser.name,
          device_reset_at_ms: Date.now()
        });
        showNotification(`Dispositivo liberado para ${vendor.vendor_name}`, 'success');
      } catch (error) {
        showNotification('No se pudo liberar el dispositivo');
      }
    }

    async function deleteVendor(backendId) {
      if (!confirm('¿Seguro que quieres eliminar este vendedor?')) return;

      const authorizedSuperUser = await requestSuperUserPassword('eliminar vendedor');
      if (!authorizedSuperUser) return;

      try {
        await deleteDoc(doc(db, "vendors", backendId));
        showNotification('Vendedor eliminado correctamente', 'success');
      } catch (error) {
        showNotification('No se pudo eliminar el vendedor');
      }
    }



    function createDeviceId() {
      if (window.crypto && window.crypto.randomUUID) return 'DEV-' + window.crypto.randomUUID();
      return 'DEV-' + Date.now() + '-' + Math.random().toString(36).slice(2, 11);
    }

    function getCurrentDeviceId() {
      let deviceId = localStorage.getItem('am_device_id_v1');
      if (!deviceId) {
        deviceId = createDeviceId();
        localStorage.setItem('am_device_id_v1', deviceId);
      }
      return deviceId;
    }

    function getDeviceInfo() {
      const ua = navigator.userAgent || '';
      const platform = navigator.platform || 'N/D';
      let browser = 'Navegador';
      if (/Edg/i.test(ua)) browser = 'Edge';
      else if (/Chrome/i.test(ua)) browser = 'Chrome';
      else if (/Safari/i.test(ua)) browser = 'Safari';
      else if (/Firefox/i.test(ua)) browser = 'Firefox';

      let os = platform;
      if (/Android/i.test(ua)) os = 'Android';
      else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
      else if (/Windows/i.test(ua)) os = 'Windows';
      else if (/Mac/i.test(ua)) os = 'Mac';

      return `${os} · ${browser}`;
    }

    async function verifyVendorDevice(vendor) {
      const currentDeviceId = getCurrentDeviceId();
      const currentDeviceInfo = getDeviceInfo();

      if (!vendor.authorized_device_id) {
        if (!navigator.onLine) {
          return {
            ok: false,
            device_id: currentDeviceId,
            device_info: currentDeviceInfo,
            status: 'pendiente_autorizacion',
            message: 'Primera autorización de dispositivo requiere internet.'
          };
        }

        await updateDoc(doc(db, 'vendors', vendor.__backendId), {
          authorized_device_id: currentDeviceId,
          authorized_device_info: currentDeviceInfo,
          authorized_device_at_ms: Date.now()
        });

        vendor.authorized_device_id = currentDeviceId;
        vendor.authorized_device_info = currentDeviceInfo;

        return {
          ok: true,
          device_id: currentDeviceId,
          device_info: currentDeviceInfo,
          status: 'dispositivo_autorizado_primera_vez',
          message: 'Dispositivo autorizado por primera vez.'
        };
      }

      if (vendor.authorized_device_id !== currentDeviceId) {
        return {
          ok: false,
          device_id: currentDeviceId,
          device_info: currentDeviceInfo,
          status: 'dispositivo_no_autorizado',
          message: 'Dispositivo no autorizado para este vendedor.'
        };
      }

      return {
        ok: true,
        device_id: currentDeviceId,
        device_info: currentDeviceInfo,
        status: 'dispositivo_autorizado',
        message: 'Dispositivo autorizado.'
      };
    }

    function withTimeout(promise, ms, errorMessage) {
      let timeoutId;
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(errorMessage || 'TIMEOUT')), ms);
      });
      return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
    }

    function imageFileToJpegDataUrl(file, maxWidth, quality) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
          try {
            const sourceWidth = img.naturalWidth || img.width || 640;
            const sourceHeight = img.naturalHeight || img.height || 480;
            const scale = Math.min(1, maxWidth / sourceWidth);
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(sourceWidth * scale));
            canvas.height = Math.max(1, Math.round(sourceHeight * scale));
            const ctx = canvas.getContext('2d', { alpha: false });
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(objectUrl);
            resolve(canvas.toDataURL('image/jpeg', quality));
          } catch (error) {
            URL.revokeObjectURL(objectUrl);
            reject(error);
          }
        };
        img.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('IMAGE_LOAD_ERROR'));
        };
        img.src = objectUrl;
      });
    }

    function openCameraFilePicker() {
      return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.capture = 'user';
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.addEventListener('change', () => {
          const file = input.files && input.files[0];
          input.remove();
          if (!file) return reject(new Error('SELFIE_CANCELLED'));
          resolve(file);
        }, { once: true });
        input.click();
      });
    }

    async function captureFrontCameraAutoDataUrl() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('GET_USER_MEDIA_NOT_AVAILABLE');
      }

      const overlay = document.createElement('div');
      overlay.className = 'modal-backdrop-am show';
      overlay.innerHTML = `
        <div class="modal-card-am text-center">
          <div class="flex items-center justify-center gap-2 mb-3">
            <i data-lucide="camera" class="text-blue-700" style="width:24px;height:24px;"></i>
            <h3 class="text-xl font-black text-gray-900">Tomando selfie automática</h3>
          </div>
          <p class="text-sm text-gray-600 mb-4">Mira hacia la cámara frontal. La app tomará la evidencia sola.</p>
          <video id="auto-selfie-video" autoplay playsinline muted class="w-full max-h-[52vh] object-cover rounded-2xl bg-gray-100 border border-gray-200"></video>
          <p class="text-xs font-bold text-blue-700 mt-3">Capturando...</p>
        </div>`;
      document.body.appendChild(overlay);
      if (window.lucide) lucide.createIcons();

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'user' },
            width: { ideal: 320, max: 640 },
            height: { ideal: 240, max: 480 }
          },
          audio: false
        });
        const video = overlay.querySelector('#auto-selfie-video');
        video.srcObject = stream;
        await video.play();
        await new Promise(resolve => setTimeout(resolve, 250));

        const sourceWidth = video.videoWidth || 640;
        const sourceHeight = video.videoHeight || 480;
        const maxSide = 160;
        const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(sourceWidth * scale));
        canvas.height = Math.max(1, Math.round(sourceHeight * scale));
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.42);
      } finally {
        try { if (stream) stream.getTracks().forEach(track => track.stop()); } catch (_) {}
        overlay.remove();
      }
    }

    async function captureSelfiePackage(required = false, vendorName = '') {
      if (!required) return { thumb: '', full: '', localSelfieId: '' };

      let thumb = '';
      try {
        thumb = await captureFrontCameraAutoDataUrl();
      } catch (autoError) {
        console.warn('Cámara automática no disponible; usando respaldo:', autoError);
        const file = await openCameraFilePicker();
        thumb = await imageFileToJpegDataUrl(file, 160, 0.42);
      }

      if (!thumb) throw new Error('SELFIE_EMPTY');
      const localItem = saveLocalSelfieDraft({ thumb, full: '' }, vendorName);
      return { thumb: localItem.thumb, full: '', localSelfieId: localItem.localSelfieId };
    }

    async function captureSelfieIfRequired(required = false) {
      const pack = await captureSelfiePackage(required);
      return pack.thumb || '';
    }


    function openEnvironmentCameraFilePicker() {
      return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.capture = 'environment';
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.addEventListener('change', () => {
          const file = input.files && input.files[0];
          input.remove();
          if (!file) return reject(new Error('PHOTO_CANCELLED'));
          resolve(file);
        }, { once: true });
        input.click();
      });
    }

    async function captureRearCameraAutoDataUrl(delaySeconds = 3) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('CAMERA_API_NOT_AVAILABLE');
      }

      const overlay = document.createElement('div');
      overlay.className = 'fixed inset-0 z-[99999] bg-black/90 flex items-center justify-center p-4';
      overlay.innerHTML = `
        <div class="bg-white rounded-3xl p-5 w-full max-w-md text-center shadow-2xl">
          <div class="mx-auto mb-3 w-14 h-14 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center">
            <i data-lucide="camera" style="width:30px;height:30px;"></i>
          </div>
          <h3 class="text-xl font-black text-gray-900">Foto del local</h3>
          <p class="text-sm text-gray-600 mb-4">Apunta la cámara trasera al negocio. La foto se tomará automáticamente.</p>
          <div class="relative overflow-hidden rounded-2xl border border-gray-200 bg-gray-100">
            <video id="auto-prospect-video" autoplay playsinline muted class="w-full max-h-[55vh] object-cover bg-gray-100"></video>
            <div class="absolute inset-0 pointer-events-none border-4 border-white/60 rounded-2xl"></div>
          </div>
          <p class="text-sm font-bold text-gray-600 mt-3">Captura automática en</p>
          <p id="auto-prospect-countdown" class="text-5xl font-black text-red-600 leading-none mt-1">${delaySeconds}</p>
        </div>`;
      document.body.appendChild(overlay);
      if (window.lucide) lucide.createIcons();

      let stream;
      let timerId;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 }
          },
          audio: false
        });
        const video = overlay.querySelector('#auto-prospect-video');
        const countdown = overlay.querySelector('#auto-prospect-countdown');
        video.srcObject = stream;
        await video.play();

        let remaining = Math.max(1, Number(delaySeconds) || 3);
        countdown.textContent = String(remaining);
        await new Promise((resolve) => {
          timerId = setInterval(() => {
            remaining -= 1;
            countdown.textContent = String(Math.max(remaining, 0));
            if (remaining <= 0) {
              clearInterval(timerId);
              resolve();
            }
          }, 1000);
        });

        const sourceWidth = video.videoWidth || 1280;
        const sourceHeight = video.videoHeight || 720;
        const maxSide = 260;
        const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(sourceWidth * scale));
        canvas.height = Math.max(1, Math.round(sourceHeight * scale));
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.58);
      } finally {
        try { if (timerId) clearInterval(timerId); } catch (_) {}
        try { if (stream) stream.getTracks().forEach(track => track.stop()); } catch (_) {}
        overlay.remove();
      }
    }

    async function captureProspectLocalPhoto(required = false) {
      if (!required) return '';
      try {
        return await captureRearCameraAutoDataUrl(5);
      } catch (autoError) {
        console.warn('Cámara trasera automática no disponible; usando respaldo:', autoError);
        const file = await openEnvironmentCameraFilePicker();
        return await imageFileToJpegDataUrl(file, 260, 0.58);
      }
    }

    function isFirstCheckinToday(vendorName) {
      const today = new Date().toLocaleDateString("en-CA");

      return !currentData.some(record => {
        const d = new Date(record.check_in_time);
        return (
          record.vendor_name === vendorName &&
          d.toLocaleDateString("en-CA") === today
        );
      });
    }

    // ===== BIOMÉTRICO WEB/PWA =====
    // Importante: la app NO guarda huellas. El teléfono valida huella/rostro mediante WebAuthn.
    const BIOMETRIC_CREDENTIALS_KEY = 'am_autopartes_biometric_credentials_v1';

    function supportsBiometricAuth() {
      return Boolean(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create && navigator.credentials.get);
    }

    function bytesToBase64Url(bytes) {
      const bin = Array.from(new Uint8Array(bytes)).map(b => String.fromCharCode(b)).join('');
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    }

    function base64UrlToBytes(value) {
      const padded = String(value || '').replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(value || '').length + 3) % 4);
      const bin = atob(padded);
      return Uint8Array.from(bin, c => c.charCodeAt(0));
    }

    function getBiometricCredentialMap() {
      try { return JSON.parse(localStorage.getItem(BIOMETRIC_CREDENTIALS_KEY) || '{}'); }
      catch (_) { return {}; }
    }

    function setBiometricCredentialMap(map) {
      localStorage.setItem(BIOMETRIC_CREDENTIALS_KEY, JSON.stringify(map || {}));
    }

    function getVendorKeyForBiometric(vendor) {
      return String(vendor.__backendId || vendor.vendor_pin || vendor.vendor_name || '').trim();
    }

    function getStoredBiometricCredential(vendor) {
      const key = getVendorKeyForBiometric(vendor);
      return getBiometricCredentialMap()[key] || null;
    }

    function storeBiometricCredential(vendor, credential) {
      const key = getVendorKeyForBiometric(vendor);
      const map = getBiometricCredentialMap();
      map[key] = credential;
      setBiometricCredentialMap(map);
    }

    async function registerBiometricForVendor(vendor) {
      if (!supportsBiometricAuth()) throw new Error('BIOMETRIC_NOT_SUPPORTED');
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const userIdSource = new TextEncoder().encode(String(vendor.__backendId || vendor.vendor_pin || vendor.vendor_name || Date.now())).slice(0, 64);
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: 'AM Autopartes' },
          user: {
            id: userIdSource,
            name: String(vendor.vendor_name || 'Vendedor'),
            displayName: String(vendor.vendor_name || 'Vendedor')
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 }
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'preferred'
          },
          timeout: 60000,
          attestation: 'none'
        }
      });
      if (!credential || !credential.rawId) throw new Error('BIOMETRIC_REGISTER_CANCELLED');
      const stored = {
        id: credential.id,
        rawId: bytesToBase64Url(credential.rawId),
        vendor_name: vendor.vendor_name || '',
        created_at_ms: Date.now()
      };
      storeBiometricCredential(vendor, stored);
      return stored;
    }

    async function authenticateBiometricForVendor(vendor) {
      if (!supportsBiometricAuth()) throw new Error('BIOMETRIC_NOT_SUPPORTED');
      const stored = getStoredBiometricCredential(vendor);
      if (!stored || !stored.rawId) throw new Error('BIOMETRIC_NOT_REGISTERED');
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{
            id: base64UrlToBytes(stored.rawId),
            type: 'public-key',
            transports: ['internal']
          }],
          userVerification: 'required',
          timeout: 60000
        }
      });
      if (!assertion) throw new Error('BIOMETRIC_AUTH_CANCELLED');
      return true;
    }

    const AM_SAVED_VENDOR_KEY = 'am_autopartes_vendedor_preseleccionado';

    function getSavedBiometricVendorKey() {
      try { return localStorage.getItem(AM_SAVED_VENDOR_KEY) || ''; } catch (_) { return ''; }
    }

    function saveBiometricVendorKey(key) {
      try {
        if (key) localStorage.setItem(AM_SAVED_VENDOR_KEY, key);
        else localStorage.removeItem(AM_SAVED_VENDOR_KEY);
      } catch (_) {}
    }

    function refreshBiometricVendorSelect() {
      const select = document.getElementById('biometric-vendor-select');
      if (!select) return;
      const current = select.value || getSavedBiometricVendorKey();
      const activeVendors = allVendors.filter(v => v.active !== false);
      select.innerHTML = '<option value="">Selecciona vendedor</option>' + activeVendors.map(v => {
        const keyRaw = getVendorKeyForBiometric(v);
        const key = escapeHtml(keyRaw);
        const type = normalizeVendorType(v.vendor_type || v.tipo_vendedor) === 'foraneo' ? 'Foráneo' : 'Local';
        const bio = (v.biometric_enabled || v.biometrico_activo) ? ' · biométrico' : '';
        return `<option value="${key}">${escapeHtml(v.vendor_name || 'Vendedor')} · ${type}${bio}</option>`;
      }).join('');
      if (current && activeVendors.some(v => getVendorKeyForBiometric(v) === current)) {
        select.value = current;
        saveBiometricVendorKey(current);
      } else {
        select.value = '';
        saveBiometricVendorKey('');
      }
      updateMealButtonState();
    }



    function requestNumericPinModal(options = {}) {
      const title = options.title || 'Confirmar PIN';
      const subtitle = options.subtitle || 'Ingresa tu código personal para continuar.';
      const placeholder = options.placeholder || 'PIN personal';
      const maxLength = String(options.maxLength || 6);
      return new Promise((resolve) => {
        const container = document.createElement('div');
        container.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-[120] p-4';
        container.innerHTML = `
          <div class="bg-white rounded-3xl p-7 shadow-2xl w-full max-w-sm border border-gray-200">
            <div class="flex items-center gap-3 mb-4">
              <div class="w-12 h-12 rounded-2xl flex items-center justify-center bg-blue-100">
                <i data-lucide="key-round" class="text-blue-700" style="width:24px;height:24px;"></i>
              </div>
              <div>
                <h3 class="text-2xl font-black text-gray-900">${escapeHtml(title)}</h3>
                <p class="text-sm text-gray-600">${escapeHtml(subtitle)}</p>
              </div>
            </div>
            <input type="tel" id="am-numeric-pin-modal-input" inputmode="numeric" pattern="[0-9]*" maxlength="${maxLength}" autocomplete="one-time-code" placeholder="${escapeHtml(placeholder)}" class="input-main mb-5 text-center text-2xl font-black tracking-widest">
            <div class="grid grid-cols-2 gap-3">
              <button type="button" id="am-numeric-pin-modal-cancel" class="btn-base btn-neutral py-3">Cancelar</button>
              <button type="button" id="am-numeric-pin-modal-ok" class="btn-base btn-primary py-3">Continuar</button>
            </div>
          </div>
        `;
        document.body.appendChild(container);
        if (window.lucide) lucide.createIcons();
        const input = document.getElementById('am-numeric-pin-modal-input');
        const close = (value) => { container.remove(); resolve(value); };
        const ok = () => close((input.value || '').replace(/\D/g, '').trim());
        input.addEventListener('input', () => { input.value = (input.value || '').replace(/\D/g, '').slice(0, Number(maxLength)); });
        input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ok(); if (ev.key === 'Escape') close(''); });
        document.getElementById('am-numeric-pin-modal-ok').addEventListener('click', ok);
        document.getElementById('am-numeric-pin-modal-cancel').addEventListener('click', () => close(''));
        setTimeout(() => { input.focus(); input.select(); }, 80);
      });
    }

    async function biometricAuthFlow(vendor) {
      if (!(vendor.biometric_enabled || vendor.biometrico_activo)) {
        throw new Error('BIOMETRIC_DISABLED_VENDOR');
      }
      if (!supportsBiometricAuth()) throw new Error('BIOMETRIC_NOT_SUPPORTED');

      if (!getStoredBiometricCredential(vendor)) {
        const pin = await requestNumericPinModal({ title: 'Activar huella', subtitle: 'Primera vez en este celular. Ingresa tu PIN una sola vez.', placeholder: 'PIN del vendedor' });
        if (!pin) throw new Error('BIOMETRIC_SETUP_CANCELLED');
        if (String(pin).trim() !== String(vendor.vendor_pin || '').trim()) throw new Error('BIOMETRIC_SETUP_BAD_PIN');
        await registerBiometricForVendor(vendor);
        showNotification('Biométrico activado en este celular', 'success');
      }

      await authenticateBiometricForVendor(vendor);
      return true;
    }

    async function registerPresenceForVendor(vendor, vendorPin, authMethod, sourceButton) {
      let deviceCheck;
      try {
        deviceCheck = await verifyVendorDevice(vendor);
      } catch (error) {
        showNotification('No se pudo validar el dispositivo. Intenta de nuevo con internet.');
        return;
      }

      if (!deviceCheck.ok) {
        showNotification(deviceCheck.message);
        return;
      }

      isLoading = true;

      const btn = sourceButton || document.querySelector('#checkin-form button');
      const originalText = btn ? btn.innerHTML : '';
      if (btn) {
        btn.innerHTML = '<i data-lucide="loader-2" style="width:24px;height:24px;animation:spin 1s linear infinite;"></i> Obteniendo ubicación...';
        btn.disabled = true;
        lucide.createIcons();
      }

      try {
        const firstToday = isFirstCheckinToday(vendor.vendor_name);
        const recordType = firstToday ? 'inicio_ruta' : 'visita';

        if (btn) { btn.innerHTML = '<i data-lucide="loader-2" style="width:24px;height:24px;animation:spin 1s linear infinite;"></i> Validando ubicación y selfie...'; lucide.createIcons(); }
        const positionPromise = getHighAccuracyPosition();
        const selfieRequiredPromise = getFreshVendorSelfieRequired(vendor, recordType);
        const [position, vendorSelfieRequired] = await Promise.all([positionPromise, selfieRequiredPromise]);
        const accuracy = Math.round(Number(position.coords.accuracy || 9999));
        const nowMsForRegister = Date.now();
        const lastRegisterMs = getLastVendorRegisterMs(vendor.vendor_name);
        const registroValidation = buildRegistroStatus({ accuracy, lastRegisterMs, nowMs: nowMsForRegister });

        if (registroValidation.status === "rechazado") {
          isLoading = false;
          if (btn) { btn.innerHTML = originalText; btn.disabled = false; lucide.createIcons(); }
          showNotification("Registro bloqueado: espera mínimo 2 minutos antes de registrar otra visita.");
          return;
        }

        if (!isGpsAccurateEnough(position) || accuracy > AM_BLINDAJE_GPS_MAX_METERS) {
          isLoading = false;
          if (btn) { btn.innerHTML = originalText; btn.disabled = false; lucide.createIcons(); }
          showNotification(`Ubicación demasiado imprecisa: ${accuracy} m. La app acepta hasta 150 m; activa GPS preciso o intenta en un lugar más abierto.`);
          return;
        }

        let selfiePhoto = "";
        let selfieThumb = "";
        let selfieFullDataUrl = "";
        let localSelfieId = "";
        let selfieStatus = 'no_requerida';

        if (vendorSelfieRequired) {
          if (btn) { btn.innerHTML = '<i data-lucide="camera" style="width:24px;height:24px;"></i> Tomando selfie automática...'; lucide.createIcons(); }
          const selfiePack = await withTimeout(captureSelfiePackage(true, vendor.vendor_name), 120000, 'SELFIE_REQUIRED_TIMEOUT');
          if (!selfiePack || !selfiePack.thumb) throw new Error('SELFIE_EMPTY');
          selfiePhoto = selfiePack.thumb;
          selfieThumb = selfiePack.thumb;
          selfieFullDataUrl = '';
          localSelfieId = selfiePack.localSelfieId || '';
          selfieStatus = 'capturada_local';
        }

        const latitude = position.coords.latitude.toString();
        const longitude = position.coords.longitude.toString();

        const newCheckin = {
          vendor_name: vendor.vendor_name,
          vendor_pin: vendorPin || vendor.vendor_pin || '',
          vendor_type: normalizeVendorType(vendor.vendor_type || vendor.tipo_vendedor),
          tipo_vendedor: normalizeVendorType(vendor.vendor_type || vendor.tipo_vendedor),
          biometric_enabled: Boolean(vendor.biometric_enabled || vendor.biometrico_activo),
          biometric_status: authMethod === 'biometrico' ? 'validado_dispositivo' : 'pin_respaldo',
          auth_method: authMethod || 'pin',
          metodo_autenticacion: authMethod === 'biometrico' ? 'Huella/Rostro' : 'PIN',
          ...(recordType === 'inicio_ruta' ? calculatePunctuality(new Date(nowMsForRegister)) : {}),
          record_type: recordType,
          location: `${latitude},${longitude}`,
          check_in_time: new Date(nowMsForRegister).toISOString(),
          created_at_ms: nowMsForRegister,
          latitude,
          longitude,
          gps_accuracy_meters: accuracy,
          geo_link: `https://maps.google.com/?q=${latitude},${longitude}`,
          device_id: deviceCheck.device_id,
          device_info: deviceCheck.device_info,
          device_status: deviceCheck.status,
          selfie_required: vendorSelfieRequired,
          selfie_status: selfieStatus,
          selfie_photo: selfiePhoto,
          selfie_thumb: selfieThumb,
          selfie_full_data_url: selfieFullDataUrl,
          selfie_captured_at_ms: selfieThumb ? nowMsForRegister : null,
          selfie_local_id: localSelfieId,
          registro_status: registroValidation.status,
          registro_notas: registroValidation.notes,
          gps_validation_status: accuracy > AM_BLINDAJE_GPS_SUSPICIOUS_METERS ? "precision_media" : "preciso",
          hora_fuente: navigator.onLine ? "servidor_firebase" : "pendiente_sincronizar"
        };

        if (btn) { btn.innerHTML = '<i data-lucide="check-circle" style="width:24px;height:24px;"></i> Guardado'; lucide.createIcons(); }
        const saveResult = await saveCheckinRecord(newCheckin);
        markLocalSelfieLinked(localSelfieId, saveResult && saveResult.id, saveResult && saveResult.offlineId);

        if (vendorSelfieRequired && saveResult && saveResult.id) {
          // La visita ya quedó guardada. La selfie se sincroniza en segundo plano para no hacer esperar al vendedor.
          (async () => {
            try {
              const uploadedRecord = await uploadSelfieToCloud(newCheckin);
              await withTimeout(updateDoc(doc(db, 'checkins', saveResult.id), {
                selfie_photo: uploadedRecord.selfie_thumb || uploadedRecord.selfie_photo || newCheckin.selfie_thumb,
                selfie_thumb: uploadedRecord.selfie_thumb || uploadedRecord.selfie_photo || newCheckin.selfie_thumb,
                selfie_full_url: uploadedRecord.selfie_full_url || uploadedRecord.selfie_photo || '',
                selfie_storage_path: uploadedRecord.selfie_storage_path || '',
                selfie_thumb_storage_path: uploadedRecord.selfie_thumb_storage_path || '',
                selfie_uploaded_to_cloud: Boolean(uploadedRecord.selfie_uploaded_to_cloud),
                selfie_status: 'capturada',
                selfie_uploaded_at_ms: Date.now(),
                selfie_local_id: localSelfieId || ''
              }), 12000, 'UPDATE_SELFIE_TIMEOUT');
            } catch (uploadError) {
              console.warn('Miniatura guardada; no se pudo subir link completo:', uploadError);
              try {
                await updateDoc(doc(db, 'checkins', saveResult.id), {
                  selfie_photo: newCheckin.selfie_thumb || newCheckin.selfie_photo || '',
                  selfie_thumb: newCheckin.selfie_thumb || newCheckin.selfie_photo || '',
                  selfie_status: 'capturada_local',
                  selfie_upload_error: String((uploadError && uploadError.message) || uploadError || 'UPLOAD_ERROR'),
                  selfie_local_id: localSelfieId || ''
                });
              } catch (_) {}
            }
          })();
        }

        const whatsappMessage = `🚗 Nuevo registro\n\nVendedor: ${vendor.vendor_name}\nMétodo: ${newCheckin.metodo_autenticacion}\nHora: ${new Date(newCheckin.check_in_time).toLocaleString('es-MX')}\nPrecisión GPS: ${accuracy} m\nUbicación: ${newCheckin.geo_link}`;

        const pinInput = document.getElementById('vendor-pin');
        if (pinInput) pinInput.value = '';
        const checkinFormEl = document.getElementById('checkin-form');
        if (checkinFormEl) checkinFormEl.classList.add('hidden');
        isLoading = false;
        if (btn) { btn.innerHTML = originalText; btn.disabled = false; lucide.createIcons(); }

        const statusText = newCheckin.registro_status === "sospechoso" ? " · Estatus: sospechoso por precisión GPS" : " · Estatus: válido";
        showNotification(saveResult.offline ? `Registro guardado localmente. Método: ${newCheckin.metodo_autenticacion}. Precisión: ${accuracy} m${statusText}` : `Registro correcto. Método: ${newCheckin.metodo_autenticacion}. Precisión: ${accuracy} m${statusText}`, 'success');

        // WhatsApp automático desactivado por solicitud: no abrir ni enviar mensaje al iniciar ruta.
      } catch (error) {
        isLoading = false;
        if (btn) { btn.innerHTML = originalText; btn.disabled = false; lucide.createIcons(); }
        if (error && (error.message === 'SELFIE_CANCELLED')) {
          showNotification('Registro cancelado: no se pudo tomar la selfie automática.');
        } else if (error && (error.name === 'NotAllowedError' || error.message === 'CAMERA_NOT_SUPPORTED' || String(error.message || '').includes('SELFIE') || error.message === 'CAMERA_TIMEOUT' || error.message === 'VIDEO_TIMEOUT')) {
          showNotification('No se pudo tomar la selfie. Revisa permiso de cámara y usa HTTPS/Netlify.');
        } else {
          showNotification(getGpsErrorMessage(error));
        }
      }
    }

    const showPinFallbackBtn = document.getElementById('show-pin-fallback-btn');
    if (showPinFallbackBtn) showPinFallbackBtn.addEventListener('click', () => {
      const form = document.getElementById('checkin-form');
      if (form) form.classList.toggle('hidden');
      const pin = document.getElementById('vendor-pin');
      if (pin && !form.classList.contains('hidden')) pin.focus();
    });

    const biometricBtn = document.getElementById('biometric-checkin-btn');
    const mealToggleBtn = document.getElementById('meal-toggle-btn');
    if (mealToggleBtn) mealToggleBtn.addEventListener('click', toggleMealBreak);
    const biometricVendorSelectForMeal = document.getElementById('biometric-vendor-select');
    if (biometricVendorSelectForMeal) biometricVendorSelectForMeal.addEventListener('change', function () {
      saveBiometricVendorKey(this.value || '');
      updateMealButtonState();
    });

    if (biometricBtn) biometricBtn.addEventListener('click', async function () {
      if (isLoading) return;
      const select = document.getElementById('biometric-vendor-select');
      const key = select ? select.value : '';
      if (!key) { showNotification('Selecciona el vendedor'); return; }
      const vendor = allVendors.find(v => getVendorKeyForBiometric(v) === key);
      if (!vendor) { showNotification('Vendedor no encontrado'); return; }
      if (!(vendor.biometric_enabled || vendor.biometrico_activo)) {
        showNotification('Este vendedor no tiene biométrico activado. Usa PIN como respaldo.');
        return;
      }
      const originalText = this.innerHTML;
      try {
        this.innerHTML = '<i data-lucide="loader-2" style="width:24px;height:24px;animation:spin 1s linear infinite;"></i> Validando huella...';
        this.disabled = true;
        lucide.createIcons();
        await biometricAuthFlow(vendor);
        this.innerHTML = originalText;
        this.disabled = false;
        lucide.createIcons();
        await registerPresenceForVendor(vendor, vendor.vendor_pin, 'biometrico', this);
      } catch (error) {
        this.innerHTML = originalText;
        this.disabled = false;
        lucide.createIcons();
        const msg = String((error && error.message) || error || '');
        if (msg === 'BIOMETRIC_NOT_SUPPORTED') showNotification('Este navegador/celular no soporta biométrico web. Usa PIN como respaldo.');
        else if (msg === 'BIOMETRIC_DISABLED_VENDOR') showNotification('Este vendedor no tiene biométrico activado.');
        else if (msg === 'BIOMETRIC_SETUP_BAD_PIN') showNotification('PIN incorrecto. No se activó biométrico.');
        else if (msg.includes('CANCEL')) showNotification('Validación biométrica cancelada.');
        else showNotification('No se pudo validar biométrico. Usa PIN como respaldo.');
      }
    });

    document.getElementById('checkin-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (isLoading) return;

      const vendorPin = document.getElementById('vendor-pin').value.trim();
      if (!vendorPin) { showNotification('Por favor ingresa tu PIN'); return; }

      const vendor = allVendors.find(v => v.vendor_pin === vendorPin);
      if (!vendor) { showNotification('PIN no válido. Verifica tu PIN personal.'); return; }

      await registerPresenceForVendor(vendor, vendorPin, 'pin', e.target.querySelector('button'));
    });

    function getFilteredCheckinsByDate() {
      return currentData.filter(record => {
        const d = new Date(record.check_in_time);
        const matchesDate = d.toLocaleDateString("en-CA") === selectedCheckinsDate;
        const matchesVendor = !selectedCheckinsVendor || String(record.vendor_name || '') === selectedCheckinsVendor;
        const matchesType = !selectedCheckinsType || String(record.record_type || '').toLowerCase() === selectedCheckinsType;
        const hasSelfie = Boolean(getSelfieThumb(record) || getSelfieFullUrl(record));
        const matchesSelfie = !selectedCheckinsSelfie || (selectedCheckinsSelfie === 'con' ? hasSelfie : !hasSelfie);
        return matchesDate && matchesVendor && matchesType && matchesSelfie;
      });
    }

    function renderCheckinVendorFilter() {
      const select = document.getElementById('checkins-vendor-filter');
      if (!select) return;
      const selected = select.value || selectedCheckinsVendor;
      const names = [...new Set(allVendors.map(v => v.vendor_name).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'es'));
      select.innerHTML = '<option value="">Todos</option>' + names.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
      if (names.includes(selected)) select.value = selected;
    }

    function openSelfieModal(photo, title, subtitle) {
      const modal = document.getElementById('selfie-modal');
      const img = document.getElementById('selfie-modal-img');
      if (!modal || !img) return;
      img.src = photo;
      document.getElementById('selfie-modal-title').textContent = title || 'Registro';
      document.getElementById('selfie-modal-subtitle').textContent = subtitle || '';
      modal.classList.add('show');
    }

    function closeSelfieModal() {
      const modal = document.getElementById('selfie-modal');
      const img = document.getElementById('selfie-modal-img');
      if (modal) modal.classList.remove('show');
      if (img) img.src = '';
    }

    function renderCheckins() {
      const tbody = document.getElementById('checkins-table-body');
      const dayCountEl = document.getElementById('checkins-day-count');
      const photoCountEl = document.getElementById('checkins-photo-count');
      const galleryEl = document.getElementById('selfie-gallery');
      const filteredData = getFilteredCheckinsByDate();
      const photoData = filteredData.filter(record => Boolean(getSelfieThumb(record) || getSelfieFullUrl(record))).slice(0, 30);

      if (dayCountEl) dayCountEl.textContent = filteredData.length;
      if (photoCountEl) photoCountEl.textContent = `${photoData.length} con foto`;
      if (galleryEl) {
        galleryEl.innerHTML = photoData.length ? photoData.map(record => {
          const time = new Date(record.check_in_time);
          const dateStr = time.toLocaleDateString('es-MX');
          const timeStr = time.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const title = `${record.vendor_name || 'Vendedor'} · ${getRecordTypeLabel(record.record_type)}`;
          const subtitle = `${dateStr} ${timeStr} · ${record.device_info || 'Dispositivo N/D'}`;
          const thumb = getSelfieThumb(record);
          const full = getSelfieFullUrl(record);
          return `
            <div class="rounded-3xl border border-gray-200 bg-white/85 p-3 shadow-sm">
              <img src="${thumb}" loading="lazy" class="selfie-card-img" alt="Selfie de ${escapeHtml(record.vendor_name || 'vendedor')}" onclick="openSelfieModal('${escapeJs(full || thumb)}','${escapeJs(title)}','${escapeJs(subtitle)}')">
              <div class="mt-3">
                <p class="font-black text-gray-900 truncate">${escapeHtml(record.vendor_name || 'Sin vendedor')}</p>
                <p class="text-xs font-bold text-blue-700">${getRecordTypeLabel(record.record_type)} · ${dateStr} ${timeStr}</p>
                <p class="text-[11px] text-gray-500 truncate">${escapeHtml(record.device_id || 'Sin ID')}</p>
                ${full ? `<a href="${full}" target="_blank" rel="noopener noreferrer" class="inline-flex mt-2 text-xs font-black text-blue-700 underline">Abrir foto completa</a>` : ''}
              </div>
            </div>
          `;
        }).join('') : '<div class="col-span-full rounded-2xl bg-white/70 border border-gray-200 p-5 text-center text-sm font-semibold text-gray-500">No hay selfies con los filtros seleccionados</div>';
      }

      if (filteredData.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="10" class="text-center py-8 text-gray-600">No hay registros de check-in para la fecha seleccionada</td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = filteredData.map(record => {
        const time = new Date(record.check_in_time);
        const dateStr = time.toLocaleDateString('es-MX');
        const timeStr = time.toLocaleTimeString('es-MX', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });

        return `
          <tr class="border-b border-gray-200 hover:bg-blue-50/40 transition">
            <td class="px-4 py-4 text-gray-900 font-semibold">${record.vendor_name}</td>
            <td class="px-4 py-4 text-gray-900 font-mono">${record.vendor_pin}</td>
            <td class="px-4 py-4 text-gray-900 font-semibold">${getRecordTypeLabel(record.record_type)}${record.__pendingSync ? ' <span class="ml-2 inline-flex rounded-full bg-yellow-200 px-2 py-1 text-xs font-black text-yellow-900">Pendiente</span>' : ''}</td>
            <td class="px-4 py-4">
              <a href="${record.geo_link}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-blue-700 font-semibold underline">
                <i data-lucide="map-pin" style="width:16px;height:16px;"></i>
                Ver ubicación
              </a>
            </td>
            <td class="px-4 py-4 text-gray-900 font-semibold">${getGpsAccuracyLabel(record.gps_accuracy_meters)}</td>
            <td class="px-4 py-4 text-gray-900 text-xs">
              <div class="font-black">${escapeHtml(record.device_info || 'N/D')}</div>
              <div class="font-mono text-gray-500">${escapeHtml(record.device_id || 'Sin ID')}</div>
              ${record.device_status === 'dispositivo_no_autorizado' ? '<span class="inline-flex mt-1 rounded-full bg-red-100 px-2 py-1 text-[10px] font-black text-red-700">Alerta</span>' : ''}
            </td>
            <td class="px-4 py-4">
              ${getSelfieThumb(record) ? `<div class="flex items-center gap-2"><img src="${getSelfieThumb(record)}" loading="lazy" class="selfie-thumb" alt="Selfie" onclick="openSelfieModal('${escapeJs(getSelfieFullUrl(record) || getSelfieThumb(record))}','${escapeJs(record.vendor_name || 'Vendedor')}','${escapeJs(dateStr + ' ' + timeStr + ' · ' + (record.device_info || 'Dispositivo N/D'))}')">${getSelfieFullUrl(record) ? `<a href="${getSelfieFullUrl(record)}" target="_blank" rel="noopener noreferrer" class="text-xs font-black text-blue-700 underline">Link</a>` : ''}</div>` : (record.selfie_status === 'pendiente_segundo_plano' ? '<span class="text-xs font-black text-yellow-700">Procesando foto...</span>' : '<span class="text-xs text-gray-400">Sin selfie</span>')}
            </td>
            <td class="px-4 py-4 text-gray-900">${dateStr} ${timeStr}</td>
            <td class="px-4 py-4 text-center">
              <button onclick="deleteCheckIn('${record.__backendId}')" class="w-10 h-10 rounded-xl bg-red-50 text-red-600 hover:bg-red-100 flex items-center justify-center transition mx-auto" title="Eliminar">
                <i data-lucide="trash-2" style="width:18px;height:18px;"></i>
              </button>
            </td>
          </tr>
        `;
      }).join('');

      lucide.createIcons();
    }

    function getTodayCheckins() {
      return currentData
        .filter(record => {
          const d = new Date(record.check_in_time);
          return d.toLocaleDateString("en-CA") === selectedRouteDate;
        })
        .slice()
        .sort((a, b) => new Date(a.check_in_time) - new Date(b.check_in_time));
    }

    function getSelectedRouteDateLabel() {
      if (!selectedRouteDate) return "fecha seleccionada";

      const [year, month, day] = selectedRouteDate.split("-");
      const d = new Date(Number(year), Number(month) - 1, Number(day));
      return d.toLocaleDateString('es-MX', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    }

    function getSelectedRouteVendor() {
      const select = document.getElementById('route-vendor-filter');
      return select ? select.value : '';
    }

    function getFilteredTodayCheckins() {
      const selectedVendor = getSelectedRouteVendor();
      const records = getTodayCheckins();

      if (!selectedVendor) return records;
      return records.filter(record => record.vendor_name === selectedVendor);
    }

    function updateRouteVendorFilter(todayRecords) {
      const select = document.getElementById('route-vendor-filter');
      if (!select) return;

      const currentValue = select.value;
      const vendors = [...new Set(todayRecords.map(r => r.vendor_name).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'es-MX'));

      select.innerHTML = '<option value="">Todos los vendedores</option>' + vendors.map(v =>
        `<option value="${v.replace(/"/g, '&quot;')}">${v}</option>`
      ).join('');

      if (vendors.includes(currentValue)) {
        select.value = currentValue;
      }
    }

    function renderDailySummary(records) {
      const totalStopsEl = document.getElementById('summary-total-stops');
      const activeVendorsEl = document.getElementById('summary-active-vendors');
      const timeRangeEl = document.getElementById('summary-time-range');
      const summaryEl = document.getElementById('daily-summary');

      if (!totalStopsEl || !activeVendorsEl || !timeRangeEl || !summaryEl) return;

      const vendors = [...new Set(records.map(r => r.vendor_name).filter(Boolean))];

      totalStopsEl.textContent = records.length;
      activeVendorsEl.textContent = vendors.length;

      if (records.length === 0) {
        timeRangeEl.textContent = 'Sin registros';
        summaryEl.innerHTML = `<p class="text-gray-600 text-sm">No hay resumen disponible para ${getSelectedRouteDateLabel()}.</p>`;
        return;
      }

      const first = new Date(records[0].check_in_time).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
      const last = new Date(records[records.length - 1].check_in_time).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
      timeRangeEl.textContent = `${first} - ${last}`;

      const grouped = {};
      records.forEach(record => {
        if (!grouped[record.vendor_name]) grouped[record.vendor_name] = [];
        grouped[record.vendor_name].push(record);
      });

      summaryEl.innerHTML = `
        <h3 class="font-black text-gray-900 mb-3">Resumen de ${getSelectedRouteDateLabel()}</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          ${Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'es-MX')).map(vendorName => {
            const vendorRecords = grouped[vendorName];
            const firstStop = new Date(vendorRecords[0].check_in_time).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
            const lastStop = new Date(vendorRecords[vendorRecords.length - 1].check_in_time).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

            return `
              <div class="rounded-xl bg-gray-50 border border-gray-100 p-3">
                <p class="font-black text-gray-900">${vendorName}</p>
                <p class="text-sm text-gray-600">${vendorRecords.length} parada(s)</p>
                <p class="text-xs text-gray-500">${firstStop} a ${lastStop}</p>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    function buildGoogleMapsRouteUrl(records) {
      const validRecords = records.filter(r =>
        !isNaN(parseFloat(r.latitude)) &&
        !isNaN(parseFloat(r.longitude))
      );

      if (validRecords.length === 0) return null;

      const points = validRecords.map(r => `${r.latitude},${r.longitude}`);

      if (points.length === 1) {
        return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(points[0])}`;
      }

      const origin = points[0];
      const destination = points[points.length - 1];
      const waypoints = points.slice(1, -1);

      let url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`;

      if (waypoints.length > 0) {
        url += `&waypoints=${encodeURIComponent(waypoints.join('|'))}`;
      }

      return url;
    }

    function openGoogleMapsRoute(records, label = 'ruta') {
      const url = buildGoogleMapsRouteUrl(records);

      if (!url) {
        showNotification(`No hay puntos suficientes para abrir ${label}`);
        return;
      }

      window.open(url, '_blank');
    }

    function openTodayRouteByVendor(vendorName) {
      const records = getTodayCheckins().filter(r => r.vendor_name === vendorName);
      openGoogleMapsRoute(records, `la ruta de ${vendorName}`);
    }

    function openTodayRouteAll() {
      openGoogleMapsRoute(getTodayCheckins(), 'la ruta general');
    }

    function renderRoutes() {
      const container = document.getElementById('routes-list');
      if (!container) return;

      const allTodayRecords = getTodayCheckins();
      updateRouteVendorFilter(allTodayRecords);

      const todayRecords = getFilteredTodayCheckins();
      renderDailySummary(todayRecords);

      if (todayRecords.length === 0) {
        container.innerHTML = `
          <div class="col-span-full text-center py-8 text-gray-600 rounded-2xl border border-gray-200 bg-white/70">
            No hay paradas registradas en la fecha seleccionada con este filtro
          </div>
        `;
        lucide.createIcons();
        renderInternalMap();
        return;
      }

      const grouped = {};
      todayRecords.forEach(record => {
        if (!grouped[record.vendor_name]) grouped[record.vendor_name] = [];
        grouped[record.vendor_name].push(record);
      });

      container.innerHTML = Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'es-MX')).map(vendorName => {
        const records = grouped[vendorName];
        const first = new Date(records[0].check_in_time).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
        const last = new Date(records[records.length - 1].check_in_time).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

        const stopsHtml = records.map((record, index) => {
          const stopTime = new Date(record.check_in_time).toLocaleTimeString('es-MX', {
            hour: '2-digit',
            minute: '2-digit'
          });

          return `
            <div class="flex items-start gap-3 py-2 border-t border-gray-100">
              <div class="w-7 h-7 rounded-full bg-blue-100 text-blue-700 font-black flex items-center justify-center text-sm shrink-0">
                ${index + 1}
              </div>
              <div class="min-w-0">
                <p class="text-sm font-bold text-gray-900">Parada ${index + 1}</p>
                <p class="text-xs text-gray-600">${stopTime}</p>
                <a href="${record.geo_link}" target="_blank" rel="noopener noreferrer" class="text-xs text-blue-700 underline">
                  Ver punto individual
                </a>
              </div>
            </div>
          `;
        }).join('');

        return `
          <div class="rounded-2xl p-5 bg-white/85 border border-gray-200 shadow-sm">
            <div class="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3 class="text-lg font-black text-gray-900">${vendorName}</h3>
                <p class="text-sm text-gray-600">${records.length} parada(s)</p>
                <p class="text-xs text-gray-500 mt-1">De ${first} a ${last}</p>
              </div>
              <div class="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center">
                <i data-lucide="map-pinned" style="width:18px;height:18px;"></i>
              </div>
            </div>

            <div class="mb-4 rounded-xl bg-gray-50 border border-gray-100 px-3">
              ${stopsHtml}
            </div>

          </div>
        `;
      }).join('');

      lucide.createIcons();
      renderInternalMap();
    }


    function getMapTypeFilter() {
      const select = document.getElementById('map-type-filter');
      return select ? select.value : '';
    }

    function getMapSelectedDate() {
      const input = document.getElementById('map-date-filter');
      return (input && input.value) ? input.value : (selectedMapDate || getTodayDateKey());
    }

    function getMapSelectedVendor() {
      const select = document.getElementById('map-vendor-filter');
      return (select && select.value) ? select.value : (selectedMapVendor || '');
    }

    function updateMapVendorFilter(dateRecords) {
      const select = document.getElementById('map-vendor-filter');
      if (!select) return;

      const currentValue = select.value || selectedMapVendor || '';
      const vendors = [...new Set(dateRecords.map(r => r.vendor_name).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'es-MX'));

      select.innerHTML = '<option value="">Todos los vendedores</option>' + vendors.map(vendor =>
        `<option value="${escapeHtml(vendor)}">${escapeHtml(vendor)}</option>`
      ).join('');

      if (vendors.includes(currentValue)) {
        select.value = currentValue;
        selectedMapVendor = currentValue;
      } else {
        select.value = '';
        selectedMapVendor = '';
      }
    }

    function getMapDateRecords() {
      const dateKey = getMapSelectedDate();
      return currentData
        .filter(record => getRecordDateKey(record) === dateKey)
        .slice()
        .sort((a, b) => new Date(a.check_in_time) - new Date(b.check_in_time));
    }

    function getMapFilteredRecords() {
      const type = getMapTypeFilter();
      const vendor = getMapSelectedVendor();
      const dateRecords = getMapDateRecords();
      updateMapVendorFilter(dateRecords);

      let records = dateRecords.filter(record =>
        !isNaN(parseFloat(record.latitude)) &&
        !isNaN(parseFloat(record.longitude))
      );

      if (vendor) records = records.filter(record => record.vendor_name === vendor);
      if (type) records = records.filter(record => record.record_type === type);

      return records;
    }

    function setMapDateToday() {
      selectedMapDate = getTodayDateKey();
      const input = document.getElementById('map-date-filter');
      if (input) input.value = selectedMapDate;
      renderInternalMap();
      showNotification('Mapa actualizado al día de hoy', 'success');
    }

    window.setMapDateToday = setMapDateToday;

    function getMapMarkerClass(record) {
      if (record.record_type === 'inicio_ruta') return 'map-stop-marker start';
      if (record.record_type === 'fin_ruta') return 'map-stop-marker finish';
      return 'map-stop-marker';
    }

    function forceLeafletResize(map, delay = 120) {
      if (!map) return;
      [0, delay, delay * 2, delay * 4].forEach(ms => {
        setTimeout(() => {
          try { map.invalidateSize(true); } catch (error) { console.warn('No se pudo redibujar el mapa:', error); }
        }, ms);
      });
    }

    function addRobustTileLayer(map, primaryUrl, options = {}) {
      if (!map || typeof L === 'undefined') return null;
      let fallbackLoaded = false;
      const primary = L.tileLayer(primaryUrl, options).addTo(map);
      primary.on('tileerror', () => {
        if (fallbackLoaded) return;
        fallbackLoaded = true;
        try {
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap'
          }).addTo(map);
          forceLeafletResize(map, 180);
        } catch (error) {
          console.warn('No se pudo cargar mapa de respaldo:', error);
        }
      });
      return primary;
    }

    function initializeInternalMap() {
      const mapEl = document.getElementById('internal-map');
      if (!mapEl || typeof L === 'undefined') return false;

      if (!internalMap) {
        internalMap = L.map('internal-map', {
          zoomControl: true,
          attributionControl: true
        }).setView([19.639, -99.166], 12);

        addRobustTileLayer(internalMap, 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
        });

        internalMapMarkers = L.layerGroup().addTo(internalMap);
        forceLeafletResize(internalMap, 180);
      }

      return true;
    }

    function renderInternalMap() {
      const totalEl = document.getElementById('map-total-points');
      const filterEl = document.getElementById('map-active-filter');
      const type = getMapTypeFilter();
      const dateKey = getMapSelectedDate();
      const vendor = getMapSelectedVendor();
      const records = getMapFilteredRecords();

      if (totalEl) totalEl.textContent = records.length;
      if (filterEl) {
        const dateText = dateKey === getTodayDateKey() ? 'Hoy' : dateKey;
        const parts = [dateText];
        if (vendor) parts.push(vendor);
        if (type) parts.push(getRecordTypeLabel(type));
        filterEl.textContent = parts.join(' · ');
      }

      if (!initializeInternalMap()) return;

      internalMapMarkers.clearLayers();
      if (internalMapRouteLine) {
        if (Array.isArray(internalMapRouteLine)) {
          internalMapRouteLine.forEach(line => internalMap.removeLayer(line));
        } else {
          internalMap.removeLayer(internalMapRouteLine);
        }
        internalMapRouteLine = null;
      }

      renderMapLegend(records);

      if (records.length === 0) {
        internalMap.setView([19.639, -99.166], 12);
        forceLeafletResize(internalMap, 120);
        return;
      }

      const allLatLngs = [];
      const groupedByVendor = {};

      records.forEach(record => {
        const lat = parseFloat(record.latitude);
        const lng = parseFloat(record.longitude);

        if (isNaN(lat) || isNaN(lng)) return;

        if (!groupedByVendor[record.vendor_name]) groupedByVendor[record.vendor_name] = [];
        groupedByVendor[record.vendor_name].push(record);
      });

      Object.keys(groupedByVendor)
        .sort((a, b) => a.localeCompare(b, 'es-MX'))
        .forEach(vendorName => {
          const vendorRecords = groupedByVendor[vendorName]
            .slice()
            .sort((a, b) => new Date(a.check_in_time) - new Date(b.check_in_time));

          const color = getVendorColor(vendorName);
          const vendorLatLngs = [];

          vendorRecords.forEach((record, index) => {
            const lat = parseFloat(record.latitude);
            const lng = parseFloat(record.longitude);
            const latLng = [lat, lng];

            vendorLatLngs.push(latLng);
            allLatLngs.push(latLng);

            const time = new Date(record.check_in_time).toLocaleString('es-MX', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            });

            const markerIcon = createNumberedMapIcon(index + 1, color);

            L.marker(latLng, { icon: markerIcon })
              .bindPopup(`
                <div style="font-family:Segoe UI,Tahoma,sans-serif;min-width:190px;">
                  <strong>${record.vendor_name || 'Sin vendedor'}</strong><br>
                  Parada: ${index + 1}<br>
                  Tipo: ${getRecordTypeLabel(record.record_type)}<br>
                  Hora: ${time}<br>
                  Precisión GPS: ${getGpsAccuracyLabel(record.gps_accuracy_meters)}<br>
                  <a href="${record.geo_link || '#'}" target="_blank" rel="noopener noreferrer">Abrir en Google Maps</a>
                </div>
              `)
              .addTo(internalMapMarkers);
          });

          if (vendorLatLngs.length > 1) {
            const line = L.polyline(vendorLatLngs, {
              color,
              weight: 5,
              opacity: 0.78
            }).addTo(internalMap);

            if (!internalMapRouteLine) internalMapRouteLine = [];
            internalMapRouteLine.push(line);
          }
        });

      if (allLatLngs.length === 0) {
        internalMap.setView([19.639, -99.166], 12);
        forceLeafletResize(internalMap, 120);
        return;
      }

      const bounds = L.latLngBounds(allLatLngs);
      internalMap.fitBounds(bounds, { padding: [35, 35], maxZoom: 16 });
      forceLeafletResize(internalMap, 120);
    }

    function downloadMapExcel() {
      const records = getMapFilteredRecords();

      if (records.length === 0) {
        showNotification('No hay registros en el mapa para exportar');
        return;
      }

      let csvContent = '\uFEFF';
      csvContent += 'Vendedor,Numero de parada,Tipo,Fecha,Hora,Latitud,Longitud,Precision GPS metros,Dispositivo,ID dispositivo,Selfie,Link foto completa,Link Google Maps\n';

      const grouped = {};
      records.forEach(record => {
        const vendor = record.vendor_name || 'Sin vendedor';
        if (!grouped[vendor]) grouped[vendor] = [];
        grouped[vendor].push(record);
      });

      Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'es-MX')).forEach(vendorName => {
        grouped[vendorName]
          .slice()
          .sort((a, b) => new Date(a.check_in_time) - new Date(b.check_in_time))
          .forEach((record, index) => {
            const time = new Date(record.check_in_time);
            const dateStr = time.toLocaleDateString('es-MX');
            const timeStr = time.toLocaleTimeString('es-MX', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            });

            const safeVendor = `"${String(vendorName || '').replace(/"/g, '""')}"`;
            const deviceInfo = `"${String(record.device_info || '').replace(/"/g, '""')}"`;
            const hasSelfie = (getSelfieThumb(record) || getSelfieFullUrl(record)) ? 'SI' : 'NO';
            const selfieLink = `"${String(getSelfieFullUrl(record) || getSelfieThumb(record) || '').replace(/"/g, '""')}"`;
            const mapsLink = `"${String(record.geo_link || '').replace(/"/g, '""')}"`;

            csvContent += `${safeVendor},"${index + 1}","${getRecordTypeLabel(record.record_type)}","${dateStr}","${timeStr}","${record.latitude || ''}","${record.longitude || ''}","${record.gps_accuracy_meters || ''}",${deviceInfo},"${record.device_id || ''}","${hasSelfie}",${selfieLink},${mapsLink}\n`;
          });
      });

      const selectedVendor = getMapSelectedVendor();
      const selectedType = getMapTypeFilter();
      const suffixVendor = selectedVendor ? selectedVendor.toLowerCase().replace(/\s+/g, '-') : 'todos';
      const suffixType = selectedType ? selectedType : 'todos-los-tipos';
      const dateKey = getMapSelectedDate();

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `mapa-registros-${suffixVendor}-${suffixType}-${dateKey}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showNotification('Reporte del mapa descargado correctamente', 'success');
    }

    window.downloadMapExcel = downloadMapExcel;

    function downloadCheckinsExcel() {
      const records = getFilteredCheckins ? getFilteredCheckins() : currentData.filter(record => getRecordDateKey(record) === selectedCheckinsDate);

      if (records.length === 0) {
        showNotification('No hay registros para exportar');
        return;
      }

      let csvContent = '\uFEFF';
      csvContent += 'Vendedor,Tipo,Fecha,Hora,Latitud,Longitud,Precision GPS metros,Dispositivo,ID dispositivo,Selfie,Link foto completa,Link Google Maps\n';

      records
        .slice()
        .sort((a, b) => new Date(a.check_in_time) - new Date(b.check_in_time))
        .forEach((record) => {
          const time = new Date(record.check_in_time);
          const dateStr = time.toLocaleDateString('es-MX');
          const timeStr = time.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const vendor = `"${String(record.vendor_name || '').replace(/"/g, '""')}"`;
          const deviceInfo = `"${String(record.device_info || '').replace(/"/g, '""')}"`;
          const hasSelfie = (getSelfieThumb(record) || getSelfieFullUrl(record)) ? 'SI' : 'NO';
          const selfieLink = `"${String(getSelfieFullUrl(record) || getSelfieThumb(record) || '').replace(/"/g, '""')}"`;
          const mapsLink = `"${String(record.geo_link || '').replace(/"/g, '""')}"`;

          csvContent += `${vendor},"${getRecordTypeLabel(record.record_type)}","${dateStr}","${timeStr}","${record.latitude || ''}","${record.longitude || ''}","${record.gps_accuracy_meters || ''}",${deviceInfo},"${record.device_id || ''}","${hasSelfie}",${selfieLink},${mapsLink}\n`;
        });

      const dateKey = selectedCheckinsDate || getTodayDateKey();
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `registros-${dateKey}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showNotification('Reporte de registros descargado correctamente', 'success');
    }

    window.downloadCheckinsExcel = downloadCheckinsExcel;

    function setRoutesDateToday() {
      selectedRouteDate = getTodayDateKey();
      const input = document.getElementById('route-date-filter');
      if (input) input.value = selectedRouteDate;
      renderRoutes();
      showNotification('Rutas actualizadas al día de hoy', 'success');
    }

    window.setRoutesDateToday = setRoutesDateToday;

    function setCheckinsDateToday() {
      selectedCheckinsDate = getTodayDateKey();
      const input = document.getElementById('checkins-date-filter');
      if (input) input.value = selectedCheckinsDate;
      renderCheckins();
      showNotification('Registros actualizados al día de hoy', 'success');
    }

    window.setCheckinsDateToday = setCheckinsDateToday;

    function downloadRoutesExcel() {
      const records = getFilteredTodayCheckins();

      if (records.length === 0) {
        showNotification('No hay rutas para exportar');
        return;
      }

      let csvContent = '\uFEFF';
      csvContent += 'Vendedor,Numero de parada,Tipo,Fecha,Hora,Latitud,Longitud,Precision GPS metros,Link Google Maps\n';

      const grouped = {};
      records.forEach(record => {
        if (!grouped[record.vendor_name]) grouped[record.vendor_name] = [];
        grouped[record.vendor_name].push(record);
      });

      Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'es-MX')).forEach(vendorName => {
        grouped[vendorName].forEach((record, index) => {
          const time = new Date(record.check_in_time);
          const dateStr = time.toLocaleDateString('es-MX');
          const timeStr = time.toLocaleTimeString('es-MX', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          });

          const safeVendor = `"${(vendorName || '').replace(/"/g, '""')}"`;
          const mapsLink = `"${record.geo_link || ''}"`;

          csvContent += `${safeVendor},"${index + 1}","${getRecordTypeLabel(record.record_type)}","${dateStr}","${timeStr}","${record.latitude || ''}","${record.longitude || ''}","${record.gps_accuracy_meters || ''}",${mapsLink}\n`;
        });
      });

      const selectedVendor = getSelectedRouteVendor();
      const suffix = selectedVendor ? selectedVendor.toLowerCase().replace(/\s+/g, '-') : 'general';

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `rutas-${suffix}-${selectedRouteDate}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showNotification('Rutas exportadas correctamente', 'success');
    }

    async function deleteCheckIn(backendId) {
      if (!confirm('¿Seguro que quieres eliminar este registro?')) return;

      const authorizedSuperUser = await requestSuperUserPassword('eliminar registro de check-in');
      if (!authorizedSuperUser) return;

      try {
        await deleteDoc(doc(db, "checkins", backendId));
        showNotification('Registro eliminado correctamente', 'success');
      } catch (error) {
        showNotification('No se pudo eliminar el registro');
      }
    }

    function downloadAsExcel() {
      if (currentData.length === 0) {
        showNotification('No hay datos para descargar');
        return;
      }

      let csvContent = '\uFEFF';
      csvContent += 'Vendedor,PIN,Tipo,Fecha,Hora,Latitud,Longitud,Precision GPS metros,Dispositivo,ID dispositivo,Selfie,Link foto completa,Ubicación Google Maps\n';

      currentData.forEach((record) => {
        const time = new Date(record.check_in_time);
        const dateStr = time.toLocaleDateString('es-MX');
        const timeStr = time.toLocaleTimeString('es-MX', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });

        const vendorName = `"${(record.vendor_name || '').replace(/"/g, '""')}"`;
        const mapsLink = `"${record.geo_link || ''}"`;
        const deviceInfo = `"${(record.device_info || '').replace(/"/g, '""')}"`;
        const hasSelfie = (getSelfieThumb(record) || getSelfieFullUrl(record)) ? 'SI' : 'NO';
        const selfieLink = `"${(getSelfieFullUrl(record) || getSelfieThumb(record) || '').replace(/"/g, '""')}"`;

        csvContent += `${vendorName},"${record.vendor_pin || ''}","${getRecordTypeLabel(record.record_type)}","${dateStr}","${timeStr}","${record.latitude || ''}","${record.longitude || ''}","${record.gps_accuracy_meters || ''}",${deviceInfo},"${record.device_id || ''}","${hasSelfie}",${selfieLink},${mapsLink}\n`;
      });

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `check-ins-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showNotification('Archivo descargado correctamente', 'success');
    }

    function showNotification(message, type = 'error') {
      const notification = document.createElement('div');
      const colorClass = type === 'success' ? 'bg-green-200' : (type === 'warning' ? 'bg-yellow-200' : (type === 'info' ? 'bg-blue-200' : 'bg-red-200'));
      notification.className = `fixed top-4 right-4 px-6 py-3 rounded-2xl text-black font-semibold shadow-2xl z-50 animate-fade-in ${colorClass}`;
      notification.textContent = message;
      document.body.appendChild(notification);

      setTimeout(() => notification.remove(), 3000);
    }


    function getRecordTypeLabel(type) {
      if (type === "inicio_ruta") return "Inicio de ruta";
      if (type === "fin_ruta") return "Fin de ruta";
      if (type === "comida_inicio") return "Inicio comida";
      if (type === "comida_fin") return "Regreso a jornada";
      if (type === "prospecto") return "Prospecto";
      return "Visita";
    }

    function hasStartedRouteToday(vendorName) {
      const today = new Date().toLocaleDateString("en-CA");

      return currentData.some(record => {
        const d = new Date(record.check_in_time);
        return (
          record.vendor_name === vendorName &&
          d.toLocaleDateString("en-CA") === today
        );
      });
    }

    function hasFinishedRouteToday(vendorName) {
      const today = new Date().toLocaleDateString("en-CA");

      return currentData.some(record => {
        const d = new Date(record.check_in_time);
        return (
          record.vendor_name === vendorName &&
          d.toLocaleDateString("en-CA") === today &&
          record.record_type === "fin_ruta"
        );
      });
    }


    function getTodayMealState(vendorName) {
      const today = new Date().toLocaleDateString("en-CA");
      const records = currentData
        .filter(record => {
          const type = String(record.record_type || '').toLowerCase();
          if (record.vendor_name !== vendorName || !['comida_inicio', 'comida_fin'].includes(type)) return false;
          const d = new Date(record.check_in_time);
          return d.toLocaleDateString("en-CA") === today;
        })
        .sort((a, b) => new Date(a.check_in_time) - new Date(b.check_in_time));
      let state = 'fuera_comida';
      let startedAt = null;
      records.forEach(record => {
        const type = String(record.record_type || '').toLowerCase();
        if (type === 'comida_inicio') { state = 'en_comida'; startedAt = record.check_in_time; }
        if (type === 'comida_fin') { state = 'fuera_comida'; startedAt = null; }
      });
      return { state, startedAt, records };
    }

    function updateMealButtonState() {
      const btn = document.getElementById('meal-toggle-btn');
      const note = document.getElementById('meal-status-note');
      const select = document.getElementById('biometric-vendor-select');
      if (!btn) return;
      const key = select ? select.value : '';
      const vendor = allVendors.find(v => getVendorKeyForBiometric(v) === key);
      if (!vendor) {
        btn.innerHTML = '<span style="font-size:24px;line-height:1">🍽️</span> Comida';
        if (note) note.textContent = 'Selecciona vendedor arriba para marcar comida. Tiempo permitido: hasta 60 minutos.';
        return;
      }
      const meal = getTodayMealState(vendor.vendor_name);
      if (meal.state === 'en_comida') {
        btn.innerHTML = '<i data-lucide="briefcase" style="width:24px;height:24px;"></i> Regresar a jornada';
        if (note) {
          const started = meal.startedAt ? new Date(meal.startedAt) : null;
          note.textContent = started ? `Comida iniciada: ${started.toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' })}. Recuerda regresar antes de 1 hora.` : 'En comida. Recuerda regresar antes de 1 hora.';
        }
      } else {
        btn.innerHTML = '<span style="font-size:24px;line-height:1">🍽️</span> Comida';
        if (note) note.textContent = 'Marca tu salida a comida con ubicación. Tiempo permitido: hasta 60 minutos.';
      }
      if (window.lucide) lucide.createIcons();
    }

    function scheduleMealLocalAlert(vendorName, startedAtMs) {
      try {
        const key = 'am_meal_alert_' + String(vendorName || '').toLowerCase().replace(/\s+/g, '_');
        localStorage.setItem(key, JSON.stringify({ vendorName, startedAtMs, alertAtMs: startedAtMs + 60 * 60 * 1000 }));
        setTimeout(() => {
          const current = getTodayMealState(vendorName);
          if (current.state === 'en_comida') {
            alert('Ya se cumplió 1 hora de comida. Favor de presionar "Regresar a jornada".');
            showNotification('Ya se cumplió 1 hora de comida. Regresa a jornada.', 'error');
          }
        }, 60 * 60 * 1000);
      } catch (_) {}
    }

    async function authenticateMealVendor(vendor) {
      if ((vendor.biometric_enabled || vendor.biometrico_activo) && supportsBiometricAuth()) {
        try {
          await biometricAuthFlow(vendor);
          return { ok: true, pin: vendor.vendor_pin || '', authMethod: 'biometrico' };
        } catch (error) {
          showNotification('No se pudo validar huella. Usa PIN como respaldo.');
        }
      }
      const pin = await requestNumericPinModal({ title: 'Confirmar comida', subtitle: 'Ingresa tu PIN para continuar con comida/regreso.', placeholder: 'PIN del vendedor' });
      if (!pin) return { ok: false };
      if (String(pin).trim() !== String(vendor.vendor_pin || '').trim()) {
        showNotification('PIN no válido');
        return { ok: false };
      }
      return { ok: true, pin: String(pin).trim(), authMethod: 'pin' };
    }

    async function toggleMealBreak() {
      if (isLoading) return;
      const select = document.getElementById('biometric-vendor-select');
      const key = select ? select.value : '';
      if (!key) { showNotification('Selecciona el vendedor arriba'); return; }
      const vendor = allVendors.find(v => getVendorKeyForBiometric(v) === key);
      if (!vendor) { showNotification('Vendedor no encontrado'); return; }
      if (!hasStartedRouteToday(vendor.vendor_name)) { showNotification('Primero debe registrar entrada/inicio de ruta'); return; }
      if (hasFinishedRouteToday(vendor.vendor_name)) { showNotification('La ruta ya fue finalizada hoy'); return; }

      const meal = getTodayMealState(vendor.vendor_name);
      const recordType = meal.state === 'en_comida' ? 'comida_fin' : 'comida_inicio';
      if (recordType === 'comida_inicio') {
        alert('Se ha iniciado tu tiempo de comida. Recuerda que cuentas con hasta 60 minutos; al terminar presiona "Regresar a jornada".');
      }

      const auth = await authenticateMealVendor(vendor);
      if (!auth.ok) return;

      let deviceCheck;
      try { deviceCheck = await verifyVendorDevice(vendor); }
      catch (error) { showNotification('No se pudo validar el dispositivo. Intenta con internet.'); return; }
      if (!deviceCheck.ok) { showNotification(deviceCheck.message); return; }

      const btn = document.getElementById('meal-toggle-btn');
      const originalText = btn ? btn.innerHTML : '';
      isLoading = true;
      if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" style="width:24px;height:24px;animation:spin 1s linear infinite;"></i> Guardando comida...'; lucide.createIcons(); }
      try {
        const position = await getHighAccuracyPosition();
        const accuracy = Math.round(Number(position.coords.accuracy || 9999));
        if (!isGpsAccurateEnough(position)) { showNotification('Ubicación demasiado imprecisa: ' + accuracy + ' m. La app acepta hasta 150 m; activa GPS preciso o intenta en un lugar más abierto.'); return; }
        const latitude = position.coords.latitude.toString();
        const longitude = position.coords.longitude.toString();
        const nowIso = new Date().toISOString();
        const record = {
          vendor_name: vendor.vendor_name,
          vendor_pin: auth.pin,
          vendor_type: normalizeVendorType(vendor.vendor_type || vendor.tipo_vendedor),
          tipo_vendedor: normalizeVendorType(vendor.vendor_type || vendor.tipo_vendedor),
          biometric_enabled: Boolean(vendor.biometric_enabled || vendor.biometrico_activo),
          biometric_status: auth.authMethod === 'biometrico' ? 'validado_dispositivo' : 'pin_respaldo',
          auth_method: auth.authMethod,
          metodo_autenticacion: auth.authMethod === 'biometrico' ? 'Huella/Rostro' : 'PIN',
          record_type: recordType,
          meal_break: true,
          meal_limit_minutes: 60,
          location: `${latitude},${longitude}`,
          check_in_time: nowIso,
          created_at_ms: Date.now(),
          latitude,
          longitude,
          gps_accuracy_meters: accuracy,
          geo_link: `https://maps.google.com/?q=${latitude},${longitude}`,
          device_id: deviceCheck.device_id,
          device_info: deviceCheck.device_info,
          device_status: deviceCheck.status,
          selfie_required: false,
          selfie_status: 'no_requerida'
        };
        const saveResult = await saveCheckinRecord(record);
        if (recordType === 'comida_inicio') scheduleMealLocalAlert(vendor.vendor_name, Date.now());
        showNotification(saveResult.offline ? (recordType === 'comida_inicio' ? 'Comida iniciada localmente. Regresa antes de 60 minutos.' : 'Regreso a jornada guardado localmente.') : (recordType === 'comida_inicio' ? 'Comida iniciada. Regresa antes de 60 minutos.' : 'Regreso a jornada registrado.'), 'success');
        updateMealButtonState();
      } catch (error) {
        showNotification(getGpsErrorMessage(error));
      } finally {
        isLoading = false;
        if (btn) { btn.disabled = false; btn.innerHTML = originalText; updateMealButtonState(); }
      }
    }

    function closeFinishRouteModal() {
      const modal = document.getElementById('finish-route-modal');
      if (modal) modal.remove();
      window.__finishRouteAuthMethod = 'pin';
    }
    window.closeFinishRouteModal = closeFinishRouteModal;

    function openFinishRouteModal() {
      closeFinishRouteModal();
      const container = document.createElement('div');
      container.id = 'finish-route-modal';
      container.className = 'manager-login-native-in fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4';
      container.innerHTML = `
        <div class="bg-white rounded-3xl p-8 shadow-2xl w-full max-w-md border border-gray-200">
          <div class="flex items-center gap-3 mb-5">
            <div class="w-12 h-12 rounded-2xl flex items-center justify-center bg-red-100">
              <i data-lucide="flag" class="text-red-600" style="width:24px;height:24px;"></i>
            </div>
            <div>
              <h3 class="text-2xl font-black text-gray-900">Finalizar ruta</h3>
              <p class="text-sm text-gray-600">Usa huella directo o PIN numérico de respaldo.</p>
            </div>
          </div>

          <div class="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 mb-5">
            <label class="block text-sm font-bold text-gray-800 mb-2" for="finish-route-vendor-select">Vendedor</label>
            <select id="finish-route-vendor-select" class="input-main mb-3"><option value="">Selecciona vendedor</option></select>
            <button type="button" onclick="finishRouteBiometricFromModal()" class="btn-base btn-primary w-full py-3"><span style="font-size:20px;line-height:1">🔐</span> Finalizar con huella</button>
          </div>

          <input type="tel" id="finish-route-pin" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" placeholder="PIN personal de respaldo" class="input-main mb-5" autofocus>

          <div class="grid grid-cols-2 gap-3">
            <button onclick="closeFinishRouteModal()" class="btn-base btn-neutral py-3">
              Cancelar
            </button>
            <button onclick="finishRoute()" class="btn-base btn-danger py-3">
              Finalizar
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(container);
      const finishSelect = document.getElementById('finish-route-vendor-select');
      if (finishSelect) {
        finishSelect.innerHTML = '<option value="">Selecciona vendedor</option>' + allVendors.filter(v => v.active !== false).map(v => {
          const key = escapeHtml(getVendorKeyForBiometric(v));
          const type = normalizeVendorType(v.vendor_type || v.tipo_vendedor) === 'foraneo' ? 'Foráneo' : 'Local';
          const bio = (v.biometric_enabled || v.biometrico_activo) ? ' · biométrico' : '';
          return `<option value="${key}">${escapeHtml(v.vendor_name || 'Vendedor')} · ${type}${bio}</option>`;
        }).join('');
      }
      lucide.createIcons();
      document.getElementById('finish-route-pin').focus();
    }

    async function finishRouteBiometricFromModal() {
      if (isLoading) return;
      const select = document.getElementById('finish-route-vendor-select');
      const key = select ? select.value : '';
      if (!key) { showNotification('Selecciona el vendedor'); return; }
      const vendor = allVendors.find(v => getVendorKeyForBiometric(v) === key);
      if (!vendor) { showNotification('Vendedor no encontrado'); return; }
      if (!(vendor.biometric_enabled || vendor.biometrico_activo)) { showNotification('Este vendedor no tiene biométrico activado. Usa PIN como respaldo.'); return; }
      try {
        await biometricAuthFlow(vendor);
        const pinInput = document.getElementById('finish-route-pin');
        if (pinInput) pinInput.value = vendor.vendor_pin || '';
        window.__finishRouteAuthMethod = 'biometrico';
        await finishRoute();
      } catch (error) {
        window.__finishRouteAuthMethod = 'pin';
        const msg = String((error && error.message) || error || '');
        if (msg === 'BIOMETRIC_NOT_SUPPORTED') showNotification('Este navegador/celular no soporta biométrico web. Usa PIN como respaldo.');
        else if (msg === 'BIOMETRIC_SETUP_BAD_PIN') showNotification('PIN incorrecto. No se activó biométrico.');
        else if (msg.includes('CANCEL')) showNotification('Validación biométrica cancelada.');
        else showNotification('No se pudo validar biométrico. Usa PIN como respaldo.');
      }
    }
    window.finishRouteBiometricFromModal = finishRouteBiometricFromModal;

    async function finishRoute() {
      const pinInput = document.getElementById('finish-route-pin');
      pinInput.value = (pinInput.value || '').replace(/\D/g, '').slice(0, 6);
      const vendorPin = pinInput.value.trim();

      if (!vendorPin) {
        showNotification('Ingresa tu PIN');
        return;
      }

      const vendor = allVendors.find(v => v.vendor_pin === vendorPin);
      window.__finishRouteAuthMethod = window.__finishRouteAuthMethod || 'pin';

      if (!vendor) {
        showNotification('PIN no válido');
        pinInput.value = '';
        pinInput.focus();
        return;
      }

      if (!hasStartedRouteToday(vendor.vendor_name)) {
        showNotification('Primero debes registrar un check-in para iniciar ruta');
        return;
      }

      if (hasFinishedRouteToday(vendor.vendor_name)) {
        showNotification('Esta ruta ya fue finalizada hoy');
        return;
      }

      let deviceCheck;
      try {
        deviceCheck = await verifyVendorDevice(vendor);
      } catch (error) {
        showNotification('No se pudo validar el dispositivo. Intenta de nuevo con internet.');
        return;
      }

      if (!deviceCheck.ok) {
        showNotification(deviceCheck.message);
        return;
      }

      try {
        const position = await getHighAccuracyPosition();
        const accuracy = Math.round(Number(position.coords.accuracy || 9999));

        if (!isGpsAccurateEnough(position)) {
          showNotification(`Ubicación demasiado imprecisa: ${accuracy} m. La app acepta hasta 150 m; activa GPS preciso o intenta en un lugar más abierto.`);
          return;
        }

        let selfiePhoto = '';
        let selfieThumb = '';
        let localSelfieId = '';
        const vendorSelfieRequired = await getFreshVendorSelfieRequired(vendor, "fin_ruta");
        if (vendorSelfieRequired) {
          const selfiePack = await withTimeout(captureSelfiePackage(true, vendor.vendor_name), 120000, 'SELFIE_REQUIRED_TIMEOUT');
          if (!selfiePack || !selfiePack.thumb) throw new Error('SELFIE_EMPTY');
          selfiePhoto = selfiePack.thumb;
          selfieThumb = selfiePack.thumb;
          localSelfieId = selfiePack.localSelfieId || '';
        }

        const latitude = position.coords.latitude.toString();
        const longitude = position.coords.longitude.toString();

        const finishRecord = {
          vendor_name: vendor.vendor_name,
          vendor_pin: vendorPin,
          vendor_type: normalizeVendorType(vendor.vendor_type || vendor.tipo_vendedor),
          tipo_vendedor: normalizeVendorType(vendor.vendor_type || vendor.tipo_vendedor),
          biometric_enabled: Boolean(vendor.biometric_enabled || vendor.biometrico_activo),
          biometric_status: window.__finishRouteAuthMethod === 'biometrico' ? 'validado_dispositivo' : 'pin_respaldo',
          auth_method: window.__finishRouteAuthMethod || 'pin',
          metodo_autenticacion: window.__finishRouteAuthMethod === 'biometrico' ? 'Huella/Rostro' : 'PIN',
          record_type: "fin_ruta",
          location: `${latitude},${longitude}`,
          check_in_time: new Date().toISOString(),
          created_at_ms: Date.now(),
          latitude,
          longitude,
          gps_accuracy_meters: accuracy,
          geo_link: `https://maps.google.com/?q=${latitude},${longitude}`,
          device_id: deviceCheck.device_id,
          device_info: deviceCheck.device_info,
          device_status: deviceCheck.status,
          selfie_required: vendorSelfieRequired,
          selfie_status: vendorSelfieRequired ? 'capturada_local' : 'no_requerida',
          selfie_photo: selfiePhoto,
          selfie_thumb: selfieThumb || selfiePhoto,
          selfie_local_id: localSelfieId || '',
          selfie_captured_at_ms: selfiePhoto ? Date.now() : null
        };

        const saveResult = await saveCheckinRecord(finishRecord);
        // Cerrar únicamente la ventana de Finalizar ruta al terminar el registro.
        // Antes se usaba document.querySelector('.fixed'), que podía cerrar otra ventana
        // o no encontrar correctamente esta pestaña/modal en algunos celulares.
        closeFinishRouteModal();
        renderCheckins();
        renderRoutes();
        showNotification(saveResult.offline ? `Fin de ruta guardado localmente. Precisión: ${accuracy} m` : `Ruta finalizada correctamente. Precisión: ${accuracy} m`, 'success');
      } catch (error) {
        showNotification(getGpsErrorMessage(error));
      }
    }

    document.getElementById('finish-route-btn').addEventListener('click', openFinishRouteModal);

    ['vendor-pin','prospect-pin','prospect-phone','new-vendor-pin'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => { el.value = (el.value || '').replace(/\D/g, '').slice(0, Number(el.getAttribute('maxlength') || 10)); });
    });

    const toggleProspectBtn = document.getElementById('toggle-prospect-form');
    if (toggleProspectBtn) toggleProspectBtn.addEventListener('click', () => { const form = document.getElementById('prospect-form'); if (form) form.classList.toggle('hidden'); if (window.lucide) lucide.createIcons(); });
    const prospectForm = document.getElementById('prospect-form');
    if (prospectForm) prospectForm.addEventListener('submit', saveProspectFromForm);
    ['prospect-date-filter','prospect-vendor-filter','prospect-zone-filter','prospect-client-type-filter','prospect-interest-filter'].forEach((id) => { const el = document.getElementById(id); if (el) { el.addEventListener('input', renderProspects); el.addEventListener('change', renderProspects); } });

    window.addEventListener("online", () => {
      updateOfflineStatusBanner();
      syncOfflineCheckins();
    });

    window.addEventListener("offline", updateOfflineStatusBanner);


    // Fuerza que los campos numéricos usen solamente números en celular y escritorio
    document.addEventListener("input", function(e) {
      if (!e.target) return;
      if (["new-vendor-pin", "vendor-pin", "finish-route-pin", "prospect-pin"].includes(e.target.id)) {
        e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
      }
      if (e.target.id === "prospect-phone") {
        e.target.value = e.target.value.replace(/\D/g, "").slice(0, 10);
      }
    });



    function getProspectRecords() {
      return currentData.filter(record => String(record.record_type || '').toLowerCase() === 'prospecto');
    }

    function getFilteredProspects() {
      const dateEl = document.getElementById('prospect-date-filter');
      const vendorEl = document.getElementById('prospect-vendor-filter');
      const zoneEl = document.getElementById('prospect-zone-filter');
      const typeEl = document.getElementById('prospect-client-type-filter');
      const interestEl = document.getElementById('prospect-interest-filter');
      const dateValue = dateEl ? dateEl.value : '';
      const vendorValue = vendorEl ? vendorEl.value : '';
      const zoneValue = zoneEl ? zoneEl.value.trim().toLowerCase() : '';
      const typeValue = typeEl ? typeEl.value : '';
      const interestValue = interestEl ? interestEl.value : '';
      return getProspectRecords().filter(record => {
        const recordDate = new Date(record.check_in_time).toLocaleDateString('en-CA');
        const zone = String(record.prospect_zone || '').toLowerCase();
        return (!dateValue || recordDate === dateValue) && (!vendorValue || record.vendor_name === vendorValue) && (!zoneValue || zone.includes(zoneValue)) && (!typeValue || record.prospect_client_type === typeValue) && (!interestValue || record.prospect_interest === interestValue);
      });
    }

    function renderProspectVendorFilter() {
      const select = document.getElementById('prospect-vendor-filter');
      if (!select) return;
      const selected = select.value;
      const names = [...new Set(allVendors.map(v => v.vendor_name).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'es-MX'));
      select.innerHTML = '<option value="">Todos</option>' + names.map(name => '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>').join('');
      if (names.includes(selected)) select.value = selected;
    }

    function getInterestBadgeClass(value) {
      if (value === 'Alto') return 'bg-green-100 text-green-800';
      if (value === 'Medio') return 'bg-yellow-100 text-yellow-800';
      return 'bg-red-100 text-red-800';
    }

    function renderProspects() {
      renderProspectVendorFilter();
      const tbody = document.getElementById('prospects-table-body');
      if (!tbody) return;
      const filtered = getFilteredProspects();
      const all = getProspectRecords();
      const totalEl = document.getElementById('prospect-total');
      const highEl = document.getElementById('prospect-high');
      const mediumEl = document.getElementById('prospect-medium');
      const lowEl = document.getElementById('prospect-low');
      if (totalEl) totalEl.textContent = filtered.length;
      if (highEl) highEl.textContent = filtered.filter(r => r.prospect_interest === 'Alto').length;
      if (mediumEl) mediumEl.textContent = filtered.filter(r => r.prospect_interest === 'Medio').length;
      if (lowEl) lowEl.textContent = filtered.filter(r => r.prospect_interest === 'Bajo').length;
      if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="10" class="text-center py-8 text-gray-600">' + (all.length ? 'No hay eventos con esos filtros' : 'Aún no hay eventos registrados') + '</td></tr>';
        return;
      }
      tbody.innerHTML = filtered.map(record => {
        const time = new Date(record.check_in_time);
        const dateStr = time.toLocaleDateString('es-MX');
        const timeStr = time.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
        return '<tr class="border-b border-gray-200 hover:bg-blue-50/40 transition">' +
          '<td class="px-4 py-4 text-gray-900 font-semibold">' + dateStr + '<br><span class="text-xs text-gray-500">' + timeStr + '</span></td>' +
          '<td class="px-4 py-4 text-gray-900 font-semibold">' + escapeHtml(record.vendor_name || '') + '</td>' +
          '<td class="px-4 py-4 text-gray-900 font-black">' + escapeHtml(record.prospect_business_name || '') + '</td>' +
          '<td class="px-4 py-4 text-gray-900">' + escapeHtml(record.prospect_contact_name || '') + '</td>' +
          '<td class="px-4 py-4 text-gray-900 font-mono">' + escapeHtml(record.prospect_phone || '') + '</td>' +
          '<td class="px-4 py-4 text-gray-900">' + escapeHtml(record.prospect_zone || '') + '</td>' +
          '<td class="px-4 py-4 text-gray-900">' + escapeHtml(record.prospect_client_type || '') + '</td>' +
          '<td class="px-4 py-4"><span class="inline-flex rounded-full px-3 py-1 text-xs font-black ' + getInterestBadgeClass(record.prospect_interest) + '">' + escapeHtml(record.prospect_interest || '') + '</span></td>' +
          '<td class="px-4 py-4 text-center"><span class="inline-flex rounded-full px-3 py-1 text-xs font-black ' + (String(record.prospect_comments || '').trim() ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700') + '">' + (String(record.prospect_comments || '').trim() ? 'Sí' : 'No') + '</span></td>' +
          '<td class="px-4 py-4 text-center">' + ((record.prospect_photo_thumb || record.prospect_photo) ? '<img src="' + (record.prospect_photo_thumb || record.prospect_photo) + '" loading="lazy" class="selfie-thumb mx-auto" alt="Foto local" onclick="openSelfieModal(\'' + escapeJs(record.prospect_photo || record.prospect_photo_thumb) + '\',\'Foto local prospecto\',\'' + escapeJs((record.prospect_business_name || 'Prospecto') + ' · ' + (record.prospect_zone || 'Zona N/D')) + '\')">' : '<span class="inline-flex rounded-full px-3 py-1 text-xs font-black bg-gray-100 text-gray-700">No</span>') + '</td>' +
          '<td class="px-4 py-4 text-center"><a href="' + (record.geo_link || '#') + '" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-blue-700 font-black underline"><i data-lucide="map-pin" style="width:16px;height:16px;"></i> Ver</a></td></tr>';
      }).join('');
      lucide.createIcons();
    }

    function downloadProspectsExcel() {
      const records = getFilteredProspects();
      if (!records.length) { showNotification('No hay eventos para descargar'); return; }
      let csvContent = '\uFEFF';
      csvContent += 'Fecha,Hora,Vendedor,Negocio,Contacto,Telefono,Zona,Tipo cliente,Interes,Comentarios,Foto local,Latitud,Longitud,Precision GPS metros,Ubicacion Google Maps\n';
      records.forEach(record => {
        const time = new Date(record.check_in_time);
        const dateStr = time.toLocaleDateString('es-MX');
        const timeStr = time.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const safe = (v) => '"' + String(v || '').replace(/"/g, '""') + '"';
        csvContent += [dateStr,timeStr,record.vendor_name,record.prospect_business_name,record.prospect_contact_name,record.prospect_phone,record.prospect_zone,record.prospect_client_type,record.prospect_interest,record.prospect_comments,(record.prospect_photo_thumb || record.prospect_photo) ? "SI" : "NO",record.latitude,record.longitude,record.gps_accuracy_meters,record.geo_link].map(safe).join(',') + '\n';
      });
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'eventos-' + new Date().toISOString().split('T')[0] + '.csv';
      document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
      showNotification('Prospectos descargados correctamente', 'success');
    }

    async function saveProspectFromForm(e) {
      e.preventDefault();
      if (isLoading) return;
      const pin = document.getElementById('prospect-pin').value.trim();
      const businessName = document.getElementById('prospect-business-name').value.trim();
      const contactName = document.getElementById('prospect-contact-name').value.trim();
      const phone = document.getElementById('prospect-phone').value.trim();
      const zone = document.getElementById('prospect-zone').value.trim();
      const clientType = document.getElementById('prospect-client-type').value;
      const interest = document.getElementById('prospect-interest').value;
      const comments = document.getElementById('prospect-comments').value.trim();
      if (!pin || !businessName || !contactName || !phone || !zone || !clientType || !interest) { showNotification('Debes completar todos los campos del prospecto'); return; }
      if (!/^\d{10}$/.test(phone)) { showNotification('Teléfono inválido: debe tener 10 dígitos'); return; }
      const vendor = allVendors.find(v => v.vendor_pin === pin);
      if (!vendor) { showNotification('PIN no válido. Verifica tu PIN personal.'); return; }
      let deviceCheck;
      try { deviceCheck = await verifyVendorDevice(vendor); } catch (error) { showNotification('No se pudo validar el dispositivo. Intenta con internet.'); return; }
      if (!deviceCheck.ok) { showNotification(deviceCheck.message); return; }
      const btn = e.target.querySelector('button[type="submit"]');
      const originalText = btn.innerHTML;
      isLoading = true; btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" style="width:22px;height:22px;animation:spin 1s linear infinite;"></i> Obteniendo ubicación...'; lucide.createIcons();
      try {
        const position = await getHighAccuracyPosition();
        const accuracy = Math.round(Number(position.coords.accuracy || 9999));
        if (!isGpsAccurateEnough(position)) { showNotification('Ubicación demasiado imprecisa: ' + accuracy + ' m. La app acepta hasta 150 m; activa GPS preciso o intenta en un lugar más abierto.'); return; }
        const localPhotoRequired = Boolean(vendor.prospect_photo_required);
        let prospectPhotoThumb = '';
        let prospectPhotoStatus = localPhotoRequired ? 'pendiente' : 'no_requerida';
        if (localPhotoRequired) {
          btn.innerHTML = '<i data-lucide="camera" style="width:22px;height:22px;"></i> Abriendo cámara trasera...';
          lucide.createIcons();
          prospectPhotoThumb = await withTimeout(captureProspectLocalPhoto(true), 120000, 'PROSPECT_PHOTO_TIMEOUT');
          if (!prospectPhotoThumb) throw new Error('PROSPECT_PHOTO_EMPTY');
          prospectPhotoStatus = 'capturada_local';
        }
        const latitude = position.coords.latitude.toString();
        const longitude = position.coords.longitude.toString();
        const record = { vendor_name: vendor.vendor_name, vendor_pin: pin, record_type: 'prospecto', location: latitude + ',' + longitude, check_in_time: new Date().toISOString(), created_at_ms: Date.now(), latitude, longitude, gps_accuracy_meters: accuracy, geo_link: 'https://maps.google.com/?q=' + latitude + ',' + longitude, device_id: deviceCheck.device_id, device_info: deviceCheck.device_info, device_status: deviceCheck.status, selfie_required: false, selfie_status: 'no_requerida', prospect_business_name: businessName, prospect_contact_name: contactName, prospect_phone: phone, prospect_zone: zone, prospect_client_type: clientType, prospect_interest: interest, prospect_comments: comments, prospect_photo_required: localPhotoRequired, prospect_photo_thumb: prospectPhotoThumb, prospect_photo: prospectPhotoThumb, prospect_photo_status: prospectPhotoStatus };
        const saveResult = await saveCheckinRecord(record);
        e.target.reset(); e.target.classList.add('hidden');
        showNotification(saveResult.offline ? 'Prospecto guardado localmente. Precisión: ' + accuracy + ' m' : 'Prospecto registrado correctamente. Precisión: ' + accuracy + ' m', 'success');
      } catch (error) { showNotification(getGpsErrorMessage(error)); }
      finally { isLoading = false; btn.disabled = false; btn.innerHTML = originalText; lucide.createIcons(); }
    }

    window.verifyManagerPin = verifyManagerPin;
    window.deleteCheckIn = deleteCheckIn;
    window.deleteVendor = deleteVendor;
    window.deleteManagerUser = deleteManagerUser;
    window.downloadAsExcel = downloadAsExcel;
    window.downloadProspectsExcel = downloadProspectsExcel;
    window.openTodayRouteByVendor = openTodayRouteByVendor;
    window.openTodayRouteAll = openTodayRouteAll;
    window.downloadRoutesExcel = downloadRoutesExcel;
    window.finishRoute = finishRoute;
    window.resetVendorDevice = resetVendorDevice;
    window.openSelfieModal = openSelfieModal;
    window.closeSelfieModal = closeSelfieModal;

    initializeAppUi();
  

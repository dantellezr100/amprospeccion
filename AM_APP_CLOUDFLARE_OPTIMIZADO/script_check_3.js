
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
      where
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

    async function saveCheckinRecord(record) {
      const fastRecord = {
        ...record,
        selfie_photo: record.selfie_photo || "",
        selfie_thumb: record.selfie_thumb || "",
        selfie_full_url: record.selfie_full_url || "",
        selfie_status: record.selfie_required ? (record.selfie_status || "pendiente_segundo_plano") : "no_requerida",
        selfie_uploaded_to_cloud: false
      };

      if (!navigator.onLine) {
        const offlineRecord = addOfflineCheckin(fastRecord);
        showNotification("Sin internet: registro guardado en este celular y pendiente de sincronizar", "success");
        return { offline: true, offlineId: offlineRecord.__offlineId };
      }

      try {
        const cloudRecord = { ...fastRecord };
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
      { name: "Arturo Vega", password: AM_SECRET([101, 87, 81, 77, 80, 87, 18, 16, 97]), role: "super usuario" }
    ];

    // Código maestro de respaldo para entrar al panel de gerente si falla una contraseña normal.
    const MANAGER_MASTER_CODE = AM_SECRET([16, 29, 18, 16, 20, 29, 21, 28]);
    const MASTER_MANAGER_SESSION = { name: "Acceso Maestro AM", role: "super", writtenRole: "super usuario" };

    // Control gratuito de precisión GPS
    // Menos metros = mejor ubicación. Si supera este límite, no se guarda.
    const MAX_GPS_ACCURACY_METERS = 80;
    const GPS_TIMEOUT_MS = 15000;


    function getHighAccuracyPosition() {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject({ code: "NO_GEOLOCATION", message: "Tu dispositivo no soporta geolocalización" });
          return;
        }

        navigator.geolocation.getCurrentPosition(
          resolve,
          reject,
          {
            enableHighAccuracy: true,
            timeout: GPS_TIMEOUT_MS,
            maximumAge: 0
          }
        );
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
      if (value <= 80) return `${value} m - Aceptable`;
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

    function refreshDailyViewsIfDateChanged() {
      const todayKey = getTodayDateKey();

      // El mapa debe "borrarse" visualmente cada día: cambia solo al día actual,
      // pero conserva el historial para poder regresar a fechas anteriores.
      if (selectedMapDate !== todayKey) {
        selectedMapDate = todayKey;
        const mapDateInput = document.getElementById('map-date-filter');
        if (mapDateInput) mapDateInput.value = selectedMapDate;
        renderInternalMap();
      }

      // Registros se actualiza automáticamente al día actual sin borrar historial.
      if (selectedCheckinsDate !== todayKey) {
        selectedCheckinsDate = todayKey;
        const checkinsDateInput = document.getElementById('checkins-date-filter');
        if (checkinsDateInput) checkinsDateInput.value = selectedCheckinsDate;
        renderCheckins();
      }

      // La ruta diaria también se actualiza automáticamente si se deja abierta.
      if (selectedRouteDate !== todayKey) {
        selectedRouteDate = todayKey;
        const routeDateInput = document.getElementById('route-date-filter');
        if (routeDateInput) routeDateInput.value = selectedRouteDate;
        renderRoutes();
      }
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

      const weakGps = todayRecords.filter(record => Number(record.gps_accuracy_meters || 0) >= 60);
      if (weakGps.length > 0) {
        pushAlert({
          id: `weak-gps-${todayKey}-${weakGps.length}`,
          type: 'weak_gps',
          level: 'warning',
          icon: 'map-pin',
          title: `${weakGps.length} registro${weakGps.length === 1 ? '' : 's'} con GPS débil`,
          detail: 'Precisión mayor a 60 m. Conviene revisar ubicación antes de tomar decisiones.',
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

    function toggleNotificationPanel(force) {
      const panel = document.getElementById('notification-panel');
      if (!panel) return;
      const shouldShow = typeof force === 'boolean' ? force : !panel.classList.contains('show');
      panel.classList.toggle('show', shouldShow);
      if (shouldShow) {
        const alerts = buildManagerNotifications().filter(alert => !isSmartNotificationDismissed(alert.id));
        markSmartNotificationsRead(alerts);
        renderManagerNotifications();
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
        if (wrap && !wrap.contains(event.target)) toggleNotificationPanel(false);
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
        <option value="super:${escapeHtml(user.name)}">${escapeHtml(user.name)} · super usuario</option>
      `);

      const managerOptions = allManagers.map(manager => {
        const role = manager.manager_role || "gerente";
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
              <p class="text-sm text-gray-600">Ingresa usuario y contraseña. Si falla, usa el código maestro.</p>
            </div>
          </div>

          <select id="manager-name-input" class="input-main mb-3" autofocus>
            <option value="">Seleccionar usuario</option>
            ${getManagerLoginOptionsHtml()}
          </select>
          <input type="password" id="manager-password-input" placeholder="Contraseña" class="input-main mb-5">

          <div class="grid grid-cols-2 gap-3">
            <button onclick="closeFinishRouteModal()" class="btn-base btn-neutral py-3">
              Cancelar
            </button>
            <button id="manager-login-enter-btn" type="button" class="btn-base btn-primary py-3">
              Entrar
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(container);
      lucide.createIcons();
      const enterBtn = document.getElementById('manager-login-enter-btn');
      if (enterBtn) enterBtn.addEventListener('click', verifyManagerPin);
      const passInput = document.getElementById('manager-password-input');
      if (passInput) passInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') verifyManagerPin();
      });
      document.getElementById('manager-name-input')?.focus();
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
      return ["super", "super usuario", "superusuario", "super user", "superuser"].includes(cleanRole);
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
            writtenRole: manager.manager_role || 'gerente'
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
              <p class="text-sm text-gray-500">Rol: <span class="font-bold">${manager.manager_role || 'gerente'}</span></p>
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
            <span class="font-black text-gray-900">${manager.manager_role || 'gerente'}</span>
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

    function renderRRHH() {
      const body = document.getElementById('rrhh-table-body');
      if (!body) return;
      const foraneos = allVendors.filter(v => normalizeVendorType(v.vendor_type || v.tipo_vendedor) === 'foraneo');
      const foraneoNames = new Set(foraneos.map(v => String(v.vendor_name || '').trim()).filter(Boolean));
      const entradas = currentData.filter(record => {
        const recordType = String(record.record_type || record.tipo || record.type || '').toLowerCase();
        const isEntrada = recordType.includes('inicio') || recordType.includes('entrada');
        const vendorName = String(record.vendor_name || '').trim();
        const type = normalizeVendorType(record.vendor_type || record.tipo_vendedor || getVendorTypeByName(vendorName));
        return isEntrada && type === 'foraneo' && (!foraneoNames.size || foraneoNames.has(vendorName));
      });

      const total = entradas.length;
      const puntuales = entradas.filter(e => String(e.punctuality_status || e.estado_puntualidad || '').toLowerCase() === 'puntual').length;
      const tardes = total - puntuales;
      const kpi = total ? Math.round((puntuales / total) * 100) : 0;

      const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
      setText('rrhh-puntualidad-general', kpi + '%');
      setText('rrhh-foraneos-activos', String(foraneos.length));
      setText('rrhh-entradas-total', String(total));
      setText('rrhh-tardes-total', String(tardes));

      if (!foraneos.length) {
        body.innerHTML = '<tr><td class="px-4 py-6 text-gray-500" colspan="6">Aún no tienes vendedores foráneos dados de alta.</td></tr>';
        return;
      }

      body.innerHTML = foraneos.map(vendor => {
        const name = String(vendor.vendor_name || '').trim();
        const records = entradas.filter(e => String(e.vendor_name || '').trim() === name);
        const totalVendor = records.length;
        const punctualVendor = records.filter(e => String(e.punctuality_status || e.estado_puntualidad || '').toLowerCase() === 'puntual').length;
        const lateVendor = Math.max(0, totalVendor - punctualVendor);
        const percent = totalVendor ? Math.round((punctualVendor / totalVendor) * 100) : 0;
        const lateMinutes = records.filter(e => Number(e.minutes_late || e.minutos_tarde || 0) > 0).map(e => Number(e.minutes_late || e.minutos_tarde || 0));
        const avgLate = lateMinutes.length ? Math.round(lateMinutes.reduce((a,b) => a + b, 0) / lateMinutes.length) : 0;
        const color = percent >= 90 ? 'text-green-700' : (percent >= 80 ? 'text-yellow-700' : 'text-red-600');
        return `
          <tr class="border-t border-gray-100">
            <td class="px-4 py-4 font-black text-gray-900">${escapeHtml(name || 'Sin nombre')}</td>
            <td class="px-4 py-4">${totalVendor}</td>
            <td class="px-4 py-4 text-green-700 font-bold">${punctualVendor}</td>
            <td class="px-4 py-4 text-red-600 font-bold">${lateVendor}</td>
            <td class="px-4 py-4 font-black ${color}">${percent}%</td>
            <td class="px-4 py-4">${avgLate} min</td>
          </tr>`;
      }).join('');
      if (window.lucide) window.lucide.createIcons();
    }

    window.renderRRHH = renderRRHH;

    document.getElementById('vendor-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (isLoading) return;

      const vendorName = document.getElementById('new-vendor-name').value.trim();
      const vendorPin = document.getElementById('new-vendor-pin').value.trim();
      const vendorType = document.getElementById('new-vendor-type') ? document.getElementById('new-vendor-type').value : 'local';

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
        await addDoc(vendorsRef, {
          vendor_name: vendorName,
          vendor_pin: vendorPin,
          vendor_type: vendorType,
          tipo_vendedor: vendorType,
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
        return;
      }

      listEl.innerHTML = allVendors.map(vendor => `
        <div class="rounded-2xl p-5 bg-white/85 border border-gray-200 shadow-sm">
          <div class="flex justify-between items-start gap-3 mb-4">
            <div>
              <div style="display:flex;align-items:center;gap:8px;"><span style="width:12px;height:12px;border-radius:50%;display:inline-block;background:${getVendorColor(vendor.vendor_name)};"></span><h3 class="text-lg font-black text-gray-900">${escapeHtml(vendor.vendor_name)}</h3></div>
              <p class="text-sm text-gray-500">Vendedor activo · <span class="font-black ${String(vendor.vendor_type || vendor.tipo_vendedor || 'local').toLowerCase() === 'foraneo' ? 'text-red-600' : 'text-blue-700'}">${String(vendor.vendor_type || vendor.tipo_vendedor || 'local').toLowerCase() === 'foraneo' ? 'FORÁNEO' : 'LOCAL'}</span></p>
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
            width: { ideal: 640, max: 960 },
            height: { ideal: 480, max: 720 }
          },
          audio: false
        });
        const video = overlay.querySelector('#auto-selfie-video');
        video.srcObject = stream;
        await video.play();
        await new Promise(resolve => setTimeout(resolve, 900));

        const sourceWidth = video.videoWidth || 640;
        const sourceHeight = video.videoHeight || 480;
        const maxSide = 180;
        const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(sourceWidth * scale));
        canvas.height = Math.max(1, Math.round(sourceHeight * scale));
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.48);
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
        thumb = await imageFileToJpegDataUrl(file, 180, 0.48);
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

    document.getElementById('checkin-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (isLoading) return;

      const vendorPin = document.getElementById('vendor-pin').value.trim();
      if (!vendorPin) {
        showNotification('Por favor ingresa tu PIN');
        return;
      }

      const vendor = allVendors.find(v => v.vendor_pin === vendorPin);
      if (!vendor) {
        showNotification('PIN no válido. Verifica tu PIN personal.');
        return;
      }
      try {
        localStorage.setItem('am_current_vendor_status_v1', JSON.stringify({ vendor_name: vendor.vendor_name, vendor_pin: vendorPin, at: Date.now() }));
        window.AMVendorStatusHeartbeat && window.AMVendorStatusHeartbeat.touch && window.AMVendorStatusHeartbeat.touch(vendor.vendor_name, { source: 'checkin_pin_validado' });
      } catch (_) {}

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

      const btn = e.target.querySelector('button');
      const originalText = btn.innerHTML;
      btn.innerHTML = '<i data-lucide="loader-2" style="width:24px;height:24px;animation:spin 1s linear infinite;"></i> Obteniendo ubicación...';
      btn.disabled = true;
      lucide.createIcons();

      try {
        const position = await getHighAccuracyPosition();
        const accuracy = Math.round(Number(position.coords.accuracy || 9999));

        if (!isGpsAccurateEnough(position)) {
          isLoading = false;
          btn.innerHTML = originalText;
          btn.disabled = false;
          lucide.createIcons();
          showNotification(`Ubicación imprecisa: ${accuracy} m. Activa GPS, sal a un lugar abierto y vuelve a intentar.`);
          return;
        }

        let selfiePhoto = '';
        let selfieThumb = '';
        let selfieFullDataUrl = '';
        let localSelfieId = '';
        let selfieStatus = 'no_requerida';

        const firstToday = isFirstCheckinToday(vendor.vendor_name);
        const recordType = firstToday ? "inicio_ruta" : "visita";

        // Control sencillo por vendedor: selfie encendida o apagada.
        btn.innerHTML = '<i data-lucide="settings" style="width:24px;height:24px;"></i> Validando selfie...';
        lucide.createIcons();
        const vendorSelfieRequired = await getFreshVendorSelfieRequired(vendor, recordType);

        if (vendorSelfieRequired) {
          btn.innerHTML = '<i data-lucide="camera" style="width:24px;height:24px;"></i> Tomando selfie automática...';
          lucide.createIcons();
          const selfiePack = await withTimeout(captureSelfiePackage(true, vendor.vendor_name), 120000, 'SELFIE_REQUIRED_TIMEOUT');
          if (!selfiePack || !selfiePack.thumb) throw new Error('SELFIE_EMPTY');
          selfiePhoto = selfiePack.thumb;
          selfieThumb = selfiePack.thumb;
          selfieFullDataUrl = ''; // memoria segura: no guardar foto completa Base64
          localSelfieId = selfiePack.localSelfieId || '';
          selfieStatus = 'capturada_local';
        }

        const latitude = position.coords.latitude.toString();
        const longitude = position.coords.longitude.toString();

        const newCheckin = {
          vendor_name: vendor.vendor_name,
          vendor_pin: vendorPin,
          vendor_type: normalizeVendorType(vendor.vendor_type || vendor.tipo_vendedor),
          tipo_vendedor: normalizeVendorType(vendor.vendor_type || vendor.tipo_vendedor),
          ...(recordType === 'inicio_ruta' ? calculatePunctuality(new Date()) : {}),
          record_type: recordType,
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
          selfie_status: selfieStatus,
          selfie_photo: selfiePhoto,
          selfie_thumb: selfieThumb,
          selfie_full_data_url: selfieFullDataUrl,
          selfie_captured_at_ms: selfieThumb ? Date.now() : null,
          selfie_local_id: localSelfieId
        };

        btn.innerHTML = '<i data-lucide="check-circle" style="width:24px;height:24px;"></i> Guardado';
        lucide.createIcons();
        const saveResult = await saveCheckinRecord(newCheckin);
        markLocalSelfieLinked(localSelfieId, saveResult && saveResult.id, saveResult && saveResult.offlineId);

        if (vendorSelfieRequired && saveResult && saveResult.id) {
          btn.innerHTML = '<i data-lucide="loader-2" style="width:24px;height:24px;animation:spin 1s linear infinite;"></i> Confirmando selfie...';
          lucide.createIcons();
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
        }

        const whatsappMessage = `🚗 Nuevo registro

Vendedor: ${vendor.vendor_name}
Hora: ${new Date(newCheckin.check_in_time).toLocaleString('es-MX')}
Precisión GPS: ${accuracy} m
Ubicación: ${newCheckin.geo_link}`;

        document.getElementById('vendor-pin').value = '';
        isLoading = false;
        btn.innerHTML = originalText;
        btn.disabled = false;
        lucide.createIcons();

        showNotification(saveResult.offline ? `Check-in guardado localmente. Precisión: ${accuracy} m` : `Check-in registrado correctamente. Precisión: ${accuracy} m`, 'success');

        if (firstToday) {
          // WhatsApp automático desactivado por solicitud: no abrir ni enviar mensaje al iniciar ruta.
        }
      } catch (error) {
        isLoading = false;
        btn.innerHTML = originalText;
        btn.disabled = false;
        lucide.createIcons();
        if (error && (error.message === 'SELFIE_CANCELLED')) {
          showNotification('Registro cancelado: no se pudo tomar la selfie automática.');
        } else if (error && (error.name === 'NotAllowedError' || error.message === 'CAMERA_NOT_SUPPORTED' || String(error.message || '').includes('SELFIE') || error.message === 'CAMERA_TIMEOUT' || error.message === 'VIDEO_TIMEOUT')) {
          showNotification('No se pudo tomar la selfie. Revisa permiso de cámara y usa HTTPS/Netlify.');
        } else {
          showNotification(getGpsErrorMessage(error));
        }
      }
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
      notification.className = `fixed top-4 right-4 px-6 py-3 rounded-2xl text-black font-semibold shadow-2xl z-50 animate-fade-in ${
        type === 'success' ? 'bg-green-200' : 'bg-red-200'
      }`;
      notification.textContent = message;
      document.body.appendChild(notification);

      setTimeout(() => notification.remove(), 3000);
    }


    function getRecordTypeLabel(type) {
      if (type === "inicio_ruta") return "Inicio de ruta";
      if (type === "fin_ruta") return "Fin de ruta";
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



    function closeFinishRouteModal() {
      try {
        document.querySelectorAll('#finish-route-modal, [data-finish-route-modal="true"]').forEach(el => el.remove());
      } catch (_) {
        const modal = document.getElementById('finish-route-modal');
        if (modal) modal.remove();
      }
      window.__finishRouteAuthMethod = 'pin';
      if (typeof updateFinishRouteButtonState === 'function') updateFinishRouteButtonState();
    }
    window.closeFinishRouteModal = closeFinishRouteModal;

    function getSelectedBiometricVendorForRoute() {
      const select = document.getElementById('biometric-vendor-select');
      const key = select ? select.value : '';
      return key ? allVendors.find(v => String((v && (v.vendor_id || v.id || v.vendor_pin || v.vendor_name)) || '') === key) : null;
    }

    function updateFinishRouteButtonState() {
      const btn = document.getElementById('finish-route-btn');
      if (!btn) return;
      const vendor = getSelectedBiometricVendorForRoute();
      if (vendor && hasFinishedRouteToday(vendor.vendor_name)) {
        btn.classList.add('hidden');
        btn.disabled = true;
        btn.setAttribute('aria-hidden', 'true');
      } else {
        btn.classList.remove('hidden');
        btn.disabled = false;
        btn.removeAttribute('aria-hidden');
      }
    }
    window.updateFinishRouteButtonState = updateFinishRouteButtonState;

    function openFinishRouteModal() {
      closeFinishRouteModal();
      const container = document.createElement('div');
      container.id = 'finish-route-modal';
      container.setAttribute('data-finish-route-modal', 'true');
      container.className = 'manager-login-native-in fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4';
      container.innerHTML = `
        <div class="bg-white rounded-3xl p-8 shadow-2xl w-full max-w-md border border-gray-200">
          <div class="flex items-center gap-3 mb-5">
            <div class="w-12 h-12 rounded-2xl flex items-center justify-center bg-red-100">
              <i data-lucide="flag" class="text-red-600" style="width:24px;height:24px;"></i>
            </div>
            <div>
              <h3 class="text-2xl font-black text-gray-900">Finalizar ruta</h3>
              <p class="text-sm text-gray-600">Ingresa tu PIN para cerrar tu ruta del día</p>
            </div>
          </div>

          <input type="tel" id="finish-route-pin" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" placeholder="PIN personal" class="input-main mb-5" autofocus>

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
      lucide.createIcons();
      document.getElementById('finish-route-pin').focus();
    }

    async function finishRoute() {
      const pinInput = document.getElementById('finish-route-pin');
      const vendorPin = pinInput.value.trim();

      if (!vendorPin) {
        showNotification('Ingresa tu PIN');
        return;
      }

      const vendor = allVendors.find(v => v.vendor_pin === vendorPin);

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
          showNotification(`Ubicación imprecisa: ${accuracy} m. Activa GPS, sal a un lugar abierto y vuelve a intentar.`);
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
        try {
          addManagerNotificationEvent({
            type: 'fin_ruta',
            level: 'success',
            icon: 'flag',
            title: `${vendor.vendor_name} finalizó ruta`,
            detail: `Fin de ruta registrado. Precisión GPS: ${accuracy} m`,
            source: 'Actividad vendedor',
            tab: 'rutas',
            actionText: 'Ver rutas'
          });
        } catch (_) {}
        updateFinishRouteButtonState();
        closeFinishRouteModal();
        if (typeof renderCheckins === 'function') renderCheckins();
        if (typeof renderRoutes === 'function') renderRoutes();
        showNotification(saveResult.offline ? `Fin de ruta guardado localmente. Precisión: ${accuracy} m` : `Ruta finalizada correctamente. Precisión: ${accuracy} m`, 'success');
      } catch (error) {
        showNotification(getGpsErrorMessage(error));
      }
    }

    document.getElementById('finish-route-btn').addEventListener('click', openFinishRouteModal);
    const biometricVendorSelectForFinishRoute = document.getElementById('biometric-vendor-select');
    if (biometricVendorSelectForFinishRoute) biometricVendorSelectForFinishRoute.addEventListener('change', updateFinishRouteButtonState);
    setTimeout(updateFinishRouteButtonState, 0);

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
        if (!isGpsAccurateEnough(position)) { showNotification('Ubicación imprecisa: ' + accuracy + ' m. Activa GPS y vuelve a intentar.'); return; }
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
  

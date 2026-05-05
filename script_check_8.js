
(function(){
  const GOAL_KEY = "am_daily_goal_v1";
  let dashMap = null;
  let dashMapLayer = null;

  function getDailyGoal(){
    const saved = parseInt(localStorage.getItem(GOAL_KEY) || "20", 10);
    return Number.isFinite(saved) && saved > 0 ? saved : 20;
  }

  function setDailyGoal(value){
    const goal = Math.max(1, parseInt(value || "20", 10));
    localStorage.setItem(GOAL_KEY, String(goal));
    const input = document.getElementById("daily-goal-input");
    if(input) input.value = goal;
    refreshManagerRenderDashboard && refreshManagerRenderDashboard();
  }

  function getArr(names){
    for(let i=0;i<names.length;i++){
      try { if(Array.isArray(window[names[i]])) return window[names[i]]; } catch(e){}
    }
    return [];
  }

  function normalizeType(r){
    const t = String(r.record_type || r.type || r.tipo || r.action || r.eventType || "").toLowerCase();
    if(t.includes("prospect")) return "prospecto";
    if(t.includes("ruta") || t.includes("final") || t.includes("salida")) return "ruta";
    if(t.includes("check") || t.includes("entrada") || t.includes("visita")) return "checkin";
    return "otro";
  }

  function getLatLng(r){
    const lat = r.lat ?? r.latitude ?? r.coords?.latitude ?? r.location?.latitude ?? r.geo?.lat;
    const lng = r.lng ?? r.lon ?? r.longitude ?? r.coords?.longitude ?? r.location?.longitude ?? r.geo?.lng;
    if(Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) return [Number(lat), Number(lng)];

    const raw = r.ubicacion || r.location || r.coordinates || r.gps || "";
    if(typeof raw === "string"){
      const nums = raw.match(/-?\d+(\.\d+)?/g);
      if(nums && nums.length >= 2) return [Number(nums[0]), Number(nums[1])];
    }
    return null;
  }

  function getDateValue(item){
    return item.date || item.fecha || item.createdDate || item.created_at || item.timestampDate || item.check_in_time || item.created_at_ms || "";
  }

  function todayStr(){
    const d = new Date();
    return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
  }

  function isToday(item){
    const s = String(getDateValue(item) || "");
    if(s.includes(todayStr())) return true;
    const t = item.timestamp || item.createdAt || item.created_at || item.check_in_time || item.created_at_ms || item.time;
    try {
      if(t && typeof t.toDate === "function") return t.toDate().toISOString().slice(0,10) === todayStr();
      if(t) return new Date(t).toISOString().slice(0,10) === todayStr();
    } catch(e){}
    return false;
  }

  function ensureDashboardMap(){
    const el = document.getElementById("dash-map-preview");
    if(!el || !window.L) return null;
    if(dashMap) return dashMap;

    dashMap = L.map(el, {
      zoomControl: false,
      attributionControl: true,
      scrollWheelZoom: false,
      dragging: true,
      tap: true
    }).setView([19.647, -99.169], 11);

    addRobustTileLayer(dashMap, "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap © CARTO"
    });

    dashMapLayer = L.layerGroup().addTo(dashMap);
    forceLeafletResize(dashMap, 180);

    if (window.ResizeObserver && !el.dataset.mapResizeObserver) {
      el.dataset.mapResizeObserver = "1";
      const observer = new ResizeObserver(() => forceLeafletResize(dashMap, 140));
      observer.observe(el);
    }

    return dashMap;
  }

  function updateDashboardRealMap(records){
    // Mapa de actividad eliminado del dashboard por solicitud.
    return;
  }

  window.updateDashboardRealMap = updateDashboardRealMap;

  const previousRefresh = window.refreshManagerRenderDashboard;
  window.refreshManagerRenderDashboard = function(){
    if(typeof previousRefresh === "function") previousRefresh();

    const goal = getDailyGoal();
    const input = document.getElementById("daily-goal-input");
    if(input && String(input.value) !== String(goal)) input.value = goal;

    const records = getArr(["checkins","allCheckins","checkinsData","records","allRecords"]);
    const prospects = getArr(["prospects","allProspects","prospectsData"]);
    const todayRecords = records.filter(isToday);
    const todayProspects = prospects.filter(isToday);

    const checkins = todayRecords.filter(r => normalizeType(r) === "checkin").length;
    const routes = todayRecords.filter(r => normalizeType(r) === "ruta").length;
    const prospectEvents = todayRecords.filter(r => normalizeType(r) === "prospecto").length || todayProspects.length;
    const totalEvents = checkins + prospectEvents + routes;
    const percent = Math.max(0, Math.min(100, Math.round((totalEvents / goal) * 100)));

    const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
    set("dash-checkins-hoy", checkins);
    set("dash-eventos-hoy", prospectEvents);
    set("dash-rutas-hoy", routes);
    set("dash-cumplimiento", percent + "%");
    set("dash-donut-total", totalEvents);
    set("dash-ganados", checkins);
    set("dash-seguimiento", prospectEvents);
    set("dash-pendientes", routes);
    set("dash-descartados", Math.max(0, todayRecords.length - totalEvents));
    set("dash-meta-percent", percent + "%");

    const bar = document.getElementById("dash-meta-bar");
    if(bar) bar.style.width = percent + "%";

    const metaText = document.querySelector(".manager-goal-bar div");
    if(metaText){
      metaText.innerHTML = '<i data-lucide="trophy" style="width:22px;height:22px;"></i> Meta diaria: '+goal+' eventos <b id="dash-meta-percent">'+percent+'%</b>';
      if(window.lucide) window.lucide.createIcons();
    }

    const combined = todayRecords.length ? todayRecords : records;
    updateDashboardRealMap(combined);
  };

  document.addEventListener("DOMContentLoaded", function(){
    const input = document.getElementById("daily-goal-input");
    if(input){
      input.value = getDailyGoal();
      input.addEventListener("change", () => setDailyGoal(input.value));
      input.addEventListener("blur", () => setDailyGoal(input.value));
    }
    setTimeout(() => window.refreshManagerRenderDashboard && window.refreshManagerRenderDashboard(), 900);
  });

  window.setDailyDashboardGoal = setDailyGoal;
})();

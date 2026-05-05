
(function(){
  const DASH_DATE_KEY = "am_dashboard_selected_date_v1";
  const DAILY_GOAL_KEY = "am_daily_goal_v1";

  function pad(n){ return String(n).padStart(2,"0"); }
  function localDateKeyFromDate(d){
    if(!(d instanceof Date) || isNaN(d.getTime())) return "";
    return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
  }
  function todayKey(){ return localDateKeyFromDate(new Date()); }
  function selectedDate(){
    const input = document.getElementById("dashboard-date-filter");
    return (input && input.value) || localStorage.getItem(DASH_DATE_KEY) || todayKey();
  }
  function setText(id, value){
    const el = document.getElementById(id);
    if(el) el.textContent = value;
  }
  function getArrays(){
    const records = [];
    [window.checkinsData, window.allCheckins, window.checkins, window.records, window.allRecords].forEach(arr => {
      if(Array.isArray(arr)) arr.forEach(x => { if(x && !records.includes(x)) records.push(x); });
    });
    const vendors = [];
    [window.allVendors, window.vendors, window.vendorsData].forEach(arr => {
      if(Array.isArray(arr)) arr.forEach(x => { if(x && !vendors.includes(x)) vendors.push(x); });
    });
    return { records, vendors };
  }
  function dateOf(item){
    const candidates = [item && item.check_in_time, item && item.created_at_ms, item && item.created_at, item && item.createdAt, item && item.timestamp, item && item.date, item && item.fecha];
    for(const value of candidates){
      if(!value) continue;
      if(typeof value === "string"){
        const m = value.match(/\d{4}-\d{2}-\d{2}/);
        if(m) return m[0];
      }
      try{
        if(value && typeof value.toDate === "function") return localDateKeyFromDate(value.toDate());
        const d = new Date(value);
        const key = localDateKeyFromDate(d);
        if(key) return key;
      }catch(e){}
    }
    return "";
  }
  function typeOfRecord(r){
    const t = String(r?.record_type || r?.type || r?.tipo || r?.action || r?.eventType || "").toLowerCase();
    if(t.includes("prospect")) return "prospecto";
    if(t.includes("fin_ruta") || t.includes("fin ruta") || t.includes("final") || t.includes("salida")) return "ruta";
    if(t.includes("inicio_ruta") || t.includes("entrada") || t.includes("visita") || t.includes("check")) return "checkin";
    return "otro";
  }
  function hourOf(r){
    const v = r?.check_in_time || r?.created_at_ms || r?.created_at || r?.time || r?.hora;
    try { return new Date(v).toLocaleTimeString("es-MX", {hour:"2-digit", minute:"2-digit"}); } catch(e){ return ""; }
  }
  function nameOf(r){ return r?.vendor_name || r?.vendorName || r?.vendedor || r?.vendor || r?.name || r?.nombre || "Vendedor"; }
  function locOf(r){ return r?.prospect_business_name || r?.clientName || r?.cliente || r?.businessName || r?.negocio || r?.locationName || r?.ubicacion || r?.geo_link || r?.location || "Ubicación registrada"; }
  function refreshDashboardAM(){
    const inputDate = document.getElementById("dashboard-date-filter");
    if(inputDate && !inputDate.value) inputDate.value = selectedDate();

    const { records, vendors } = getArrays();
    const date = selectedDate();
    const dayRecords = records.filter(r => dateOf(r) === date);

    const checkins = dayRecords.filter(r => typeOfRecord(r) === "checkin").length;
    const prospects = dayRecords.filter(r => typeOfRecord(r) === "prospecto").length;
    const routes = dayRecords.filter(r => typeOfRecord(r) === "ruta").length;
    const total = checkins + prospects + routes;
    const goalInput = document.getElementById("daily-goal-input");
    const goal = Math.max(1, parseInt((goalInput && goalInput.value) || localStorage.getItem(DAILY_GOAL_KEY) || "20", 10));
    const percent = Math.max(0, Math.min(100, Math.round((total / goal) * 100)));

    setText("dash-vendedores-activos", vendors.length);
    setText("dash-vendedores-sub", vendors.length + " registrados");
    setText("dash-checkins-hoy", checkins);
    setText("dash-eventos-hoy", prospects);
    setText("dash-rutas-hoy", routes);
    setText("dash-cumplimiento", percent + "%");
    setText("dash-donut-total", total);
    setText("dash-ganados", checkins);
    setText("dash-seguimiento", prospects);
    setText("dash-pendientes", routes);
    setText("dash-descartados", Math.max(0, dayRecords.length - total));
    setText("dash-meta-percent", percent + "%");

    const bar = document.getElementById("dash-meta-bar");
    if(bar) bar.style.width = percent + "%";

    const list = document.getElementById("dash-activity-list");
    if(list){
      const source = (dayRecords.length ? dayRecords : records).slice(0, 8);
      list.innerHTML = source.length ? source.map(r => '<div class="manager-activity-row"><div>'+nameOf(r)+'<br><small>Usuario</small></div><div>'+typeOfRecord(r)+'</div><div>'+locOf(r)+'</div><div>'+hourOf(r)+'</div></div>').join("") : '<div class="manager-empty">Sin actividad registrada para esta fecha.</div>';
    }
  }

  window.refreshManagerRenderDashboard = refreshDashboardAM;
  window.updateDashboardRealMap = function(){};
  window.ensureDashboardMap = function(){ return null; };

  document.addEventListener("DOMContentLoaded", function(){
    const dateInput = document.getElementById("dashboard-date-filter");
    if(dateInput){
      dateInput.value = localStorage.getItem(DASH_DATE_KEY) || todayKey();
      dateInput.addEventListener("change", function(){ localStorage.setItem(DASH_DATE_KEY, dateInput.value || todayKey()); refreshDashboardAM(); });
    }
    const goalInput = document.getElementById("daily-goal-input");
    if(goalInput){
      goalInput.value = localStorage.getItem(DAILY_GOAL_KEY) || goalInput.value || "20";
      goalInput.addEventListener("change", function(){ localStorage.setItem(DAILY_GOAL_KEY, goalInput.value || "20"); refreshDashboardAM(); });
    }
    setTimeout(refreshDashboardAM, 500);
    setTimeout(refreshDashboardAM, 1500);
  });
  setInterval(function(){
    if(document.querySelector('[data-manager-tab-content="dashboard"]:not(.hidden)')) refreshDashboardAM();
  }, 1500);
})();

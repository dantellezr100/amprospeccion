
(function(){
  const DATE_KEY = "am_dashboard_selected_date_v1";

  function pad(n){ return String(n).padStart(2,"0"); }
  function localToday(){
    const d = new Date();
    return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
  }
  function getSelectedDate(){
    const input = document.getElementById("dashboard-date-filter");
    return (input && input.value) || localStorage.getItem(DATE_KEY) || localToday();
  }
  function setSelectedDate(value){
    const date = value || localToday();
    localStorage.setItem(DATE_KEY, date);
    const input = document.getElementById("dashboard-date-filter");
    if(input) input.value = date;
    if(window.refreshManagerRenderDashboard) window.refreshManagerRenderDashboard();
  }

  function getArr(names){
    for(let i=0;i<names.length;i++){
      try { if(Array.isArray(window[names[i]])) return window[names[i]]; } catch(e){}
    }
    return [];
  }

  function getDateValue(item){
    return item.date || item.fecha || item.createdDate || item.created_at || item.timestampDate || item.check_in_time || item.created_at_ms || "";
  }

  function itemDate(item){
    const s = String(getDateValue(item) || "");
    const m = s.match(/\d{4}-\d{2}-\d{2}/);
    if(m) return m[0];

    const t = item.timestamp || item.createdAt || item.created_at || item.check_in_time || item.created_at_ms || item.time;
    try {
      if(t && typeof t.toDate === "function") return t.toDate().toISOString().slice(0,10);
      if(t) return new Date(t).toISOString().slice(0,10);
    } catch(e){}
    return "";
  }

  function normalizeType(r){
    const t = String(r.record_type || r.type || r.tipo || r.action || r.eventType || "").toLowerCase();
    if(t.includes("prospect")) return "prospecto";
    if(t.includes("ruta") || t.includes("final") || t.includes("salida")) return "ruta";
    if(t.includes("check") || t.includes("entrada") || t.includes("visita")) return "checkin";
    return "otro";
  }

  function recordsForSelectedDate(records){
    const selected = getSelectedDate();
    return (records || []).filter(r => itemDate(r) === selected);
  }

  function prospectsForSelectedDate(prospects){
    const selected = getSelectedDate();
    return (prospects || []).filter(r => itemDate(r) === selected);
  }

  function downloadDashboardGeneralExcel(){
    const selected = getSelectedDate();
    const records = recordsForSelectedDate(getArr(["checkins","allCheckins","checkinsData","records","allRecords"]));
    const prospects = prospectsForSelectedDate(getArr(["prospects","allProspects","prospectsData"]));

    const rows = [];
    rows.push(["REPORTE GENERAL AM AUTOPARTES"]);
    rows.push(["Fecha consultada", selected]);
    rows.push([]);
    rows.push(["Tipo", "Vendedor", "Acción", "Cliente/Negocio", "Ubicación", "Hora", "Latitud", "Longitud", "Comentarios"]);

    function getLatLng(r){
      const lat = r.lat ?? r.latitude ?? r.coords?.latitude ?? r.location?.latitude ?? r.geo?.lat ?? "";
      const lng = r.lng ?? r.lon ?? r.longitude ?? r.coords?.longitude ?? r.location?.longitude ?? r.geo?.lng ?? "";
      return [lat, lng];
    }

    records.forEach(r => {
      const ll = getLatLng(r);
      rows.push([
        normalizeType(r),
        r.vendor_name || r.vendorName || r.vendedor || r.vendor || r.name || r.nombre || "",
        r.record_type || r.type || r.tipo || r.action || "",
        r.prospect_business_name || r.clientName || r.cliente || r.businessName || r.negocio || "",
        r.locationName || r.ubicacion || r.location || r.gps || "",
        r.time || r.hora || (r.check_in_time ? new Date(r.check_in_time).toLocaleTimeString("es-MX", {hour:"2-digit", minute:"2-digit"}) : ""),
        ll[0],
        ll[1],
        r.comments || r.comentarios || r.notes || r.notas || ""
      ]);
    });

    prospects.forEach(p => {
      const ll = getLatLng(p);
      rows.push([
        "prospecto",
        p.vendorName || p.vendedor || p.vendor || p.name || p.nombre || "",
        "Prospecto",
        p.businessName || p.negocio || p.clientName || p.cliente || "",
        p.locationName || p.ubicacion || p.location || p.gps || "",
        p.time || p.hora || "",
        ll[0],
        ll[1],
        p.comments || p.comentarios || p.notes || p.notas || ""
      ]);
    });

    const csv = rows.map(row => row.map(cell => {
      const text = String(cell ?? "").replace(/"/g, '""');
      return `"${text}"`;
    }).join(",")).join("\n");

    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "Reporte_General_AM_Autopartes_" + selected + ".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Reescribe el refresh del dashboard para que use la fecha seleccionada
  const previousRefresh = window.refreshManagerRenderDashboard;
  window.refreshManagerRenderDashboard = function(){
    if(typeof previousRefresh === "function") previousRefresh();

    const selected = getSelectedDate();
    const input = document.getElementById("dashboard-date-filter");
    if(input && !input.value) input.value = selected;

    const records = getArr(["checkins","allCheckins","checkinsData","records","allRecords"]);
    const prospects = getArr(["prospects","allProspects","prospectsData"]);
    const dayRecords = recordsForSelectedDate(records);
    const dayProspects = prospectsForSelectedDate(prospects);

    const checkins = dayRecords.filter(r => normalizeType(r) === "checkin").length;
    const routes = dayRecords.filter(r => normalizeType(r) === "ruta").length;
    const prospectEvents = dayRecords.filter(r => normalizeType(r) === "prospecto").length || dayProspects.length;
    const totalEvents = checkins + prospectEvents + routes;

    const goalInput = document.getElementById("daily-goal-input");
    const goal = Math.max(1, parseInt((goalInput && goalInput.value) || localStorage.getItem("am_daily_goal_v1") || "20", 10));
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
    set("dash-descartados", Math.max(0, dayRecords.length - totalEvents));
    set("dash-meta-percent", percent + "%");

    const bar = document.getElementById("dash-meta-bar");
    if(bar) bar.style.width = percent + "%";

    const metaText = document.querySelector(".manager-goal-bar div");
    if(metaText){
      metaText.innerHTML = '<i data-lucide="trophy" style="width:22px;height:22px;"></i> Meta diaria: '+goal+' eventos <b id="dash-meta-percent">'+percent+'%</b>';
      if(window.lucide) window.lucide.createIcons();
    }
  };

  document.addEventListener("DOMContentLoaded", function(){
    const input = document.getElementById("dashboard-date-filter");
    if(input){
      input.value = localStorage.getItem(DATE_KEY) || localToday();
      input.addEventListener("change", () => setSelectedDate(input.value));
    }

    // Botón de reporte general del dashboard
    const buttons = Array.from(document.querySelectorAll("button"));
    buttons.forEach(btn => {
      if((btn.textContent || "").toLowerCase().includes("reporte excel general")){
        btn.onclick = downloadDashboardGeneralExcel;
      }
    });

    setTimeout(() => window.refreshManagerRenderDashboard && window.refreshManagerRenderDashboard(), 900);
  });

  window.downloadDashboardGeneralExcel = downloadDashboardGeneralExcel;
})();

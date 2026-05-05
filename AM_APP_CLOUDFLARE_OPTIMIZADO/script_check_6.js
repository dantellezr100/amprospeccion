
(function(){
  function txt(id, value){ var el=document.getElementById(id); if(el) el.textContent=value; }
  function pct(n){ return Math.max(0, Math.min(100, n)); }
  function todayStr(){
    var d=new Date();
    var y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
    return y+'-'+m+'-'+day;
  }
  function getArr(names){
    for(var i=0;i<names.length;i++){
      try { if(Array.isArray(window[names[i]])) return window[names[i]]; } catch(e){}
    }
    return [];
  }
  function getDateValue(item){
    return item.date || item.fecha || item.createdDate || item.created_at || item.timestampDate || item.check_in_time || item.created_at_ms || "";
  }
  function isToday(item){
    var s = String(getDateValue(item) || "");
    if(s.indexOf(todayStr()) >= 0) return true;
    var t = item.timestamp || item.createdAt || item.created_at || item.check_in_time || item.created_at_ms || item.time;
    try {
      if(t && typeof t.toDate === "function") return t.toDate().toISOString().slice(0,10) === todayStr();
      if(t) return new Date(t).toISOString().slice(0,10) === todayStr();
    } catch(e){}
    return false;
  }
  window.refreshManagerRenderDashboard = function(){
    var vendors = getArr(["vendors","allVendors","vendorsData"]);
    var records = getArr(["checkins","allCheckins","checkinsData","records","allRecords"]);
    var prospects = getArr(["prospects","allProspects","prospectsData"]);

    var todayRecords = records.filter(isToday);
    var todayProspects = prospects.filter(isToday);

    var checkins = todayRecords.filter(function(r){ return String(r.type || r.tipo || r.action || "").toLowerCase().indexOf("check") >= 0 || String(r.type || r.tipo || "").toLowerCase().indexOf("entrada") >= 0; }).length;
    var routes = todayRecords.filter(function(r){ var x=String(r.type || r.tipo || r.action || "").toLowerCase(); return x.indexOf("ruta") >= 0 || x.indexOf("final") >= 0 || x.indexOf("salida") >= 0; }).length;

    txt("dash-vendedores-activos", vendors.length || 0);
    txt("dash-vendedores-sub", (vendors.length || 0) + " registrados");
    txt("dash-checkins-hoy", checkins || todayRecords.length || 0);
    txt("dash-eventos-hoy", todayProspects.length || 0);
    txt("dash-rutas-hoy", routes || 0);

    var meta = 20;
    var percent = pct(Math.round(((todayProspects.length || 0) / meta) * 100));
    txt("dash-cumplimiento", percent + "%");
    txt("dash-donut-total", todayProspects.length || 0);
    txt("dash-meta-percent", percent + "%");
    var bar = document.getElementById("dash-meta-bar");
    if(bar) bar.style.width = percent + "%";

    txt("dash-ganados", todayProspects.filter(function(p){return /ganad|alto/i.test(String(p.status||p.estado||p.interest||p.interes||""));}).length);
    txt("dash-seguimiento", todayProspects.filter(function(p){return /segu/i.test(String(p.status||p.estado||""));}).length);
    txt("dash-pendientes", todayProspects.filter(function(p){return !p.status && !p.estado;}).length);
    txt("dash-descartados", todayProspects.filter(function(p){return /descart|bajo/i.test(String(p.status||p.estado||p.interest||p.interes||""));}).length);

    var list = document.getElementById("dash-activity-list");
    if(list){
      var source = todayRecords.slice(-6).reverse();
      if(!source.length) source = records.slice(-6).reverse();
      if(!source.length){
        list.innerHTML = '<div class="manager-empty">Sin actividad reciente todavía.</div>';
      } else {
        list.innerHTML = source.map(function(r){
          var vendor = r.vendor_name || r.vendorName || r.vendedor || r.vendor || r.name || r.nombre || "Vendedor";
          var action = r.record_type || r.type || r.tipo || r.action || "Registro";
          var loc = r.prospect_business_name || r.clientName || r.cliente || r.businessName || r.negocio || r.locationName || r.ubicacion || r.location || "Ubicación registrada";
          var hour = r.time || r.hora || (r.check_in_time ? new Date(r.check_in_time).toLocaleTimeString("es-MX", {hour:"2-digit", minute:"2-digit"}) : "");
          return '<div class="manager-activity-row"><div>'+vendor+'<br><small>Usuario</small></div><div>'+action+'</div><div>'+loc+'</div><div>'+hour+'</div></div>';
        }).join("");
      }
    }
  };

  setInterval(function(){ if(document.querySelector('[data-manager-tab-content="dashboard"]:not(.hidden)')) window.refreshManagerRenderDashboard(); }, 1500);
  document.addEventListener("DOMContentLoaded", function(){ setTimeout(window.refreshManagerRenderDashboard, 800); });
})();


(function(){
  function repairManagerVendorTab(){
    var btn = document.querySelector('[data-tab="vendedores"]');
    if(btn){
      btn.onclick = function(){ 
        if(typeof window.showManagerTab === "function") window.showManagerTab("vendedores"); 
      };
    }
    var dash = document.querySelector('[data-tab="dashboard"]');
    if(dash){
      dash.onclick = function(){ 
        if(typeof window.showManagerTab === "function") window.showManagerTab("dashboard"); 
      };
    }
  }
  document.addEventListener("DOMContentLoaded", repairManagerVendorTab);
  setTimeout(repairManagerVendorTab, 1000);
})();

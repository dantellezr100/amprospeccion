
(function(){
  var tries = 0;
  var timer = setInterval(function(){
    tries++;
    if(typeof window.showManagerTab === "function" && !window.__patchedDashboardRefresh){
      var original = window.showManagerTab;
      window.showManagerTab = function(tab){
        var result = original.apply(this, arguments);
        if(tab === "dashboard" && typeof window.refreshManagerRenderDashboard === "function"){
          setTimeout(window.refreshManagerRenderDashboard, 80);
        }
        return result;
      };
      window.__patchedDashboardRefresh = true;
      clearInterval(timer);
    }
    if(tries > 20) clearInterval(timer);
  }, 250);
})();

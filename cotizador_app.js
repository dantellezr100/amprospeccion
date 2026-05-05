(() => {
  const $ = id => document.getElementById(id);
  const texto = v => (v ?? '').toString().trim();
  const normalizar = s => texto(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const esc = s => texto(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const money = n => (Number(n)||0).toLocaleString('es-MX',{style:'currency',currency:'MXN'});
  const KEY_CART='am_cotizador_carrito_v3';
  const KEY_CLIENT='am_cliente_cotizador_v3';
  const KEY_CLIENTES='am_clientes_cotizador_cloud_v1';
  const KEY_PRECIOS='am_sku_precios_cloud_v1';
  const KEY_EXIST='am_existencias_cloud_v1';

  function readArray(key){ try{ const v=JSON.parse(localStorage.getItem(key)||'null'); return Array.isArray(v)?v:[]; } catch(e){ localStorage.removeItem(key); return []; } }
  function readObj(key){ try{ const v=JSON.parse(localStorage.getItem(key)||'null'); return v && typeof v === 'object' && !Array.isArray(v)?v:{}; } catch(e){ localStorage.removeItem(key); return {}; } }
  function save(key,val){ localStorage.setItem(key, JSON.stringify(val)); }
  function limpiarNumero(v){
    if(typeof v === 'number') return v;
    let s = texto(v).replace(/[$,\s]/g,'');
    if((s.match(/\./g)||[]).length > 1 && s.includes(',')) s = s.replace(/\./g,'').replace(',', '.');
    s = s.replace(/[^0-9.\-]/g,'');
    return Number(s)||0;
  }
  function porcentaje(v){
    let n = limpiarNumero(v);
    if(n > 1) n = n/100;
    return Math.max(0, Math.min(0.99, n));
  }

  const productosBase = Array.isArray(window.CATALOGO_PRODUCTOS) ? window.CATALOGO_PRODUCTOS : [];
  const clientesDefault = [
    {nombre:'PROSPECTO 35', lista_descuento:0.35, descuento_extra:0, vendedor:'-', ruta:'LOCAL', ciudad:'LOCAL', etiqueta:'35% c/IVA'},
    {nombre:'PROSPECTO 40', lista_descuento:0.40, descuento_extra:0, vendedor:'-', ruta:'LOCAL', ciudad:'LOCAL', etiqueta:'40% c/IVA'}
  ];
  const clientesBase = Array.isArray(window.CLIENTES_COTIZADOR) ? window.CLIENTES_COTIZADOR : clientesDefault;

  let clientes = readArray(KEY_CLIENTES).length ? readArray(KEY_CLIENTES) : clientesBase;
  let productosPrecios = readArray(KEY_PRECIOS).length ? readArray(KEY_PRECIOS) : (Array.isArray(window.SKU_PRECIOS_COTIZADOR) ? window.SKU_PRECIOS_COTIZADOR : []);
  let existenciasMap = Object.keys(readObj(KEY_EXIST)).length ? readObj(KEY_EXIST) : (window.EXISTENCIAS_COTIZADOR && typeof window.EXISTENCIAS_COTIZADOR === 'object' ? window.EXISTENCIAS_COTIZADOR : {});
  let productos = construirProductos();
  let resultados = [...productos];
  let paginaActual = 1;
  let porPagina = 50;
  let cotizacion = readArray(KEY_CART);
  let clienteActual = localStorage.getItem(KEY_CLIENT) || (clientes[0]?.nombre || 'PROSPECTO 40');
  let indice = [];

  function skuProducto(p){ return texto(p.sku || p.SKU || p.CLAVE || p.Clave || p.clave || p['Variant SKU']); }
  function nombreProducto(p){ return texto(p.nombre || p.pieza || p.DESCRIPCION || p.Descripcion || p.descripcion || p.title || 'Producto'); }
  function imagenProducto(p){ const sku=skuProducto(p); return texto(p.imagen || (Array.isArray(p.imagenes) ? p.imagenes[0] : '') || `imagenes/${encodeURIComponent(sku)}.jpg`); }
  function existenciaProducto(p){ return texto(p.existencia ?? p.EXIST ?? p.Existencia ?? p.existencia_total ?? '0'); }
  function clienteSel(){ return clientes.find(c => c.nombre === clienteActual) || clientes[0] || clientesDefault[1]; }
  function precioPublicoProducto(p){
    // El Excel del gerente trae el precio normal de público.
    // Este precio debe verse tal cual, sin fórmula ni descuento.
    const keys = ['precio_publico','PRECIO_PUBLICO','Publico','PÚBLICO','Precio Publico','PRECIO PUBLICO','Precio público','PRECIO PÚBLICO','Nuevo Precio Publico','NUEVO PRECIO PUBLICO','Nuevo Precio Público','NUEVO PRECIO PÚBLICO','precio','PRECIO','Importe','IMPORTE'];
    for(const k of keys){ if(p && p[k] !== undefined && texto(p[k]) !== '') return limpiarNumero(p[k]); }
    return 0;
  }
  function descuentoClienteActual(){
    const c = clienteSel();
    const lista = porcentaje(c.lista_descuento);
    const extra = porcentaje(c.descuento_extra);
    // Se aplica descuento de lista y, si existe, descuento extra sobre el resultado.
    return {lista, extra, factor: (1-lista) * (1-extra)};
  }
  function precioConIvaCliente(p){
    const publico = precioPublicoProducto(p);
    const d = descuentoClienteActual();
    return Math.max(0, publico * d.factor);
  }
  function precioProductoFinal(p){ return precioConIvaCliente(p); }
  function construirProductos(){
    let src = productosPrecios.length ? productosPrecios : productosBase;
    const imagenesCatalogo = new Map(productosBase.map(base => [skuProducto(base).toUpperCase(), base]));
    return src.map(p => {
      const sku = skuProducto(p);
      const base = imagenesCatalogo.get(sku.toUpperCase()) || {};
      const ex = existenciasMap[sku] ?? existenciasMap[sku.toUpperCase()] ?? p.existencia ?? p.EXIST ?? p.Existencia ?? p.existencia_total ?? '0';
      return {
        ...base,
        ...p,
        sku,
        existencia: ex,
        // SOLO FOTOS: si el archivo de precios no trae imagen, conserva la imagen real del catálogo.
        imagen: texto(p.imagen) || texto(base.imagen),
        imagenes: (Array.isArray(p.imagenes) && p.imagenes.length) ? p.imagenes : (Array.isArray(base.imagenes) ? base.imagenes : []),
        imagen_firebase: texto(p.imagen_firebase) || texto(base.imagen_firebase)
      };
    }).filter(p => skuProducto(p));
  }
  function textoBusqueda(p){ return normalizar([skuProducto(p), nombreProducto(p), p.descripcion, p.DESCRIPCION, p.categoria, p.marca, p.modelo, p.anio, p.handle].join(' ')); }
  function rehacerIndice(){ indice = productos.map((p,i)=>({i, sku:normalizar(skuProducto(p)), txt:textoBusqueda(p)})); }
  function guardarCarrito(){ localStorage.setItem(KEY_CART, JSON.stringify(cotizacion)); }

  function llenarClientes(){
    clientes = clientes.length ? clientes : clientesDefault;
    const opts = clientes.map(c => `<option value="${esc(c.nombre)}">${esc(c.nombre)}</option>`).join('');
    $('clientesLista').innerHTML = opts;
    if($('clienteDropdown')) $('clienteDropdown').innerHTML = '<option value="">Ver todos los clientes</option>' + opts;
    if(!clientes.some(c=>c.nombre===clienteActual)) clienteActual = clientes[0]?.nombre || '';
    $('clienteSelect').value = clienteActual;
    actualizarCliente(false);
  }
  function resolverClienteDesdeTexto(){
    const valor = texto($('clienteSelect').value);
    if(!valor) return clienteActual;
    const exacto = clientes.find(c => normalizar(c.nombre) === normalizar(valor));
    if(exacto) return exacto.nombre;
    const parcial = clientes.find(c => normalizar(c.nombre).includes(normalizar(valor)));
    return parcial ? parcial.nombre : valor;
  }
  function actualizarCliente(render=true){
    clienteActual = resolverClienteDesdeTexto() || clienteActual;
    $('clienteSelect').value = clienteActual;
    if($('clienteDropdown')) $('clienteDropdown').value = clienteActual;
    localStorage.setItem(KEY_CLIENT, clienteActual);
    const c = clienteSel();
    const lista = Math.round(porcentaje(c.lista_descuento)*100);
    const extra = Math.round(porcentaje(c.descuento_extra)*100);
    $('clienteInfo').innerHTML = `
      <div>Cliente: ${esc(c.nombre || '')}</div>
      <div>Lista: ${lista}% c/IVA${extra ? ` · Desc. extra: ${extra}%` : ''}</div>
      <div style="font-size:13px;color:#38516f;margin-top:4px">Vendedor: ${esc(c.vendedor||'-')} · Ruta: ${esc(c.ruta||'-')} · Ciudad: ${esc(c.ciudad||'-')}</div>`;
    if(render) renderTodo();
  }
  function llenarMarcas(){
    const marcas = [...new Set(productos.map(p => texto(p.marca || p.Marca)).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    $('filtroMarca').innerHTML = '<option value="">Todas las marcas</option>' + marcas.map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join('');
  }
  function buscar(){
    const q = normalizar($('buscador').value);
    const marca = normalizar($('filtroMarca').value);
    paginaActual = 1;
    let ids;
    if(!q){ ids = indice.map(x=>x.i); }
    else {
      const partes = q.split(/\s+/).filter(Boolean);
      ids = indice.filter(x => x.sku === q || partes.every(t => x.txt.includes(t))).map(x=>x.i);
      ids.sort((a,b)=>{
        const sa=normalizar(skuProducto(productos[a])), sb=normalizar(skuProducto(productos[b]));
        if(sa===q && sb!==q) return -1;
        if(sb===q && sa!==q) return 1;
        return 0;
      });
    }
    resultados = ids.map(i=>productos[i]).filter(p => !marca || normalizar(p.marca || p.Marca) === marca);
    renderCatalogo();
  }
  function cardProducto(p){
    const sku = skuProducto(p), nombre = nombreProducto(p), desc = texto(p.descripcion || p.DESCRIPCION || p.categoria || p.modelo || ''), ex = existenciaProducto(p);
    const precio = precioConIvaCliente(p);
    const enCot = cotizacion.some(x => x.sku === sku);
    return `<article class="card" onclick="abrirDetalleProducto('${esc(sku)}')">
      <img class="thumb" loading="lazy" src="${esc(imagenProducto(p))}" onerror="this.onerror=null;this.src='img/no-image.png';" alt="${esc(sku)}">
      <div>
        <div class="sku">${esc(sku)}</div>
        <div class="title">${esc(nombre)}</div>
        <div class="desc">${esc(desc)}</div>
        <div class="meta">${p.marca?esc(p.marca)+' · ':''}${p.modelo?esc(p.modelo)+' · ':''}Existencia: ${esc(ex)}</div>
        <div class="price">Público: ${money(precioPublicoProducto(p))}</div>
        <div class="price">Precio cliente: ${money(precio)}</div>
        <div class="actions" onclick="event.stopPropagation()">
          <button class="mini blue" onclick="agregarCotizacion('${esc(sku)}')">${enCot?'Agregar más':'Agregar'}</button>
        </div>
      </div>
    </article>`;
  }

  function abrirDetalleProducto(sku){
    const p = productos.find(x=>skuProducto(x)===sku);
    if(!p) return;
    const modal = $('detalleProductoModal');
    const titulo = $('detalleProductoTitulo');
    const cont = $('detalleProductoContenido');
    if(!modal || !cont) return;
    const nombre = nombreProducto(p);
    titulo.textContent = `${sku} · ${nombre}`;
    cont.innerHTML = `<div class="detailHero"><img src="${esc(imagenProducto(p))}" onerror="this.onerror=null;this.src='img/no-image.png';" alt="${esc(sku)}"></div>
      <div class="detailGrid">
        <b>SKU</b><span class="detailSku">${esc(sku)}</span>
        <b>Pieza</b><span>${esc(nombre)}</span>
        <b>Existencia</b><span>${esc(existenciaProducto(p))}</span>
        <b>Descripción</b><span>${esc(texto(p.descripcion || p.DESCRIPCION || p.categoria || p.modelo || ''))}</span>
      </div>`;
    if(typeof modal.showModal === 'function') modal.showModal();
    else modal.setAttribute('open','open');
  }
  window.abrirDetalleProducto = abrirDetalleProducto;
  function cerrarDetalleProducto(){
    const modal = $('detalleProductoModal');
    if(!modal) return;
    if(typeof modal.close === 'function') modal.close(); else modal.removeAttribute('open');
  }
  window.cerrarDetalleProducto = cerrarDetalleProducto;

  function renderCatalogo(){
    porPagina = parseInt($('porPagina').value,10) || 50;
    const total = resultados.length;
    const totalPaginas = Math.max(1, Math.ceil(total/porPagina));
    if(paginaActual > totalPaginas) paginaActual = totalPaginas;
    const inicio = (paginaActual-1)*porPagina;
    const visibles = resultados.slice(inicio, inicio+porPagina);
    $('gridProductos').innerHTML = visibles.length ? visibles.map(cardProducto).join('') : '<div class="empty">No encontré productos con esa búsqueda.</div>';
    $('resumenBusqueda').textContent = `${total.toLocaleString('es-MX')} resultado(s). Mostrando ${visibles.length} en página ${paginaActual} de ${totalPaginas}.`;
    $('paginacion').innerHTML = `<button class="btn btnSoft" ${paginaActual<=1?'disabled':''} onclick="cambiarPagina(-1)">Anterior</button><b>Página ${paginaActual} / ${totalPaginas}</b><button class="btn btnSoft" ${paginaActual>=totalPaginas?'disabled':''} onclick="cambiarPagina(1)">Siguiente</button>`;
  }
  function cambiarPagina(d){ paginaActual += d; renderCatalogo(); scrollTo({top:0,behavior:'smooth'}); } window.cambiarPagina = cambiarPagina;
  function agregarCotizacion(sku){
    const p = productos.find(x=>skuProducto(x)===sku); if(!p) return;
    const precio = precioConIvaCliente(p);
    const item = cotizacion.find(x=>x.sku===sku);
    if(item){ item.cantidad = (Number(item.cantidad)||1) + 1; item.precio = precio; }
    else cotizacion.push({sku, cantidad:1, precio_publico:precioPublicoProducto(p), precio_cliente:precio, precio});
    guardarCarrito(); renderTodo(); activarTab('cotizacion');
  } window.agregarCotizacion = agregarCotizacion;
  function renderCotizacion(){
    if(!cotizacion.length){ $('tablaCotizacion').innerHTML = '<div class="empty">Aún no tienes productos en cotización.</div>'; return; }
    let total=0;
    const rows = cotizacion.map(item => {
      const p = productos.find(x=>skuProducto(x)===item.sku) || {};
      const precioPublico = precioPublicoProducto(p) || item.precio_publico || item.precio || 0;
      const precioCliente = precioConIvaCliente(p) || item.precio_cliente || 0;
      item.precio_publico = precioPublico;
      item.precio_cliente = precioCliente;
      item.precio = precioCliente;
      item.cantidad = Math.max(1, Number(item.cantidad)||1);
      const sub = precioCliente * item.cantidad; total += sub;
      return `<tr><td onclick="abrirDetalleProducto('${esc(item.sku)}')"><b>${esc(item.sku)}</b></td><td onclick="abrirDetalleProducto('${esc(item.sku)}')">${esc(nombreProducto(p))}</td><td class="hideMob">${esc(existenciaProducto(p))}</td><td>${money(precioPublico)}</td><td><b>${money(precioCliente)}</b></td><td><input class="qty" type="number" min="1" value="${item.cantidad}" onchange="cambiarCantidad('${esc(item.sku)}',this.value)"></td><td><b>${money(sub)}</b></td><td><button class="mini" onclick="quitarCot('${esc(item.sku)}')">Quitar</button></td></tr>`;
    }).join('');
    $('tablaCotizacion').innerHTML = `<table class="quoteTable"><thead><tr><th>SKU</th><th>Producto</th><th class="hideMob">Exist.</th><th>Precio público</th><th>Precio cliente</th><th>Cant.</th><th>Total cliente</th><th></th></tr></thead><tbody>${rows}</tbody></table><div class="totalBox"><span>Total cliente c/IVA:</span><span>${money(total)}</span></div>`;
    guardarCarrito();
  }
  function cambiarCantidad(sku,val){ const item = cotizacion.find(x=>x.sku===sku); if(item){ item.cantidad = Math.max(1, Number(val)||1); guardarCarrito(); renderCotizacion(); }} window.cambiarCantidad = cambiarCantidad;
  function quitarCot(sku){ cotizacion = cotizacion.filter(x=>x.sku!==sku); guardarCarrito(); renderCotizacion(); } window.quitarCot = quitarCot;
  function renderTodo(){ renderCatalogo(); renderCotizacion(); }
  function activarTab(id){ document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===id)); document.querySelectorAll('.tabPanel').forEach(p=>p.classList.toggle('hidden',p.id!==id)); }
  function copiarCotizacion(){
    const c = clienteSel(); let total = 0;
    const lineas = cotizacion.map(item=>{ const p=productos.find(x=>skuProducto(x)===item.sku)||{}; const publico=precioPublicoProducto(p)||item.precio_publico||0; const cliente=precioConIvaCliente(p)||item.precio_cliente||item.precio||0; const sub=cliente*item.cantidad; total+=sub; return `${item.sku} | ${nombreProducto(p)} | Cant: ${item.cantidad} | Público: ${money(publico)} | Precio cliente: ${money(cliente)} | Total cliente: ${money(sub)}`; });
    const txt = `Cotización AM Autopartes\nCliente: ${c.nombre}\nLista: ${Math.round(porcentaje(c.lista_descuento)*100)}% c/IVA${porcentaje(c.descuento_extra)?' + desc. extra '+Math.round(porcentaje(c.descuento_extra)*100)+'%':''}\n\n${lineas.join('\n')}\n\nTOTAL CLIENTE c/IVA: ${money(total)}`;
    navigator.clipboard?.writeText(txt); alert('Cotización copiada.');
  }
  function vaciarCotizacion(){ if(confirm('¿Vaciar cotización?')){ cotizacion=[]; guardarCarrito(); renderCotizacion(); } }

  function rowsFromWorkbook(wb){
    const rows=[];
    wb.SheetNames.forEach(name => {
      rows.push(...XLSX.utils.sheet_to_json(wb.Sheets[name], {header:1, defval:''}));
    });
    return rows.filter(r => Array.isArray(r) && r.some(c => texto(c)));
  }
  function leerExcel(file, cb){
    if(!window.XLSX){ alert('No se cargó el lector de Excel. Prueba en Netlify con internet.'); return; }
    const reader = new FileReader();
    reader.onload = e => {
      try{ cb(rowsFromWorkbook(XLSX.read(new Uint8Array(e.target.result), {type:'array'}))); }
      catch(err){ alert('No pude leer el Excel: '+err.message); }
    };
    reader.readAsArrayBuffer(file);
  }
  function looksSku(v){ return /^[A-Z]{1,5}[-_ ]?\d{2,}|^[A-Z0-9]{3,}[-_][A-Z0-9]+/i.test(texto(v)); }
  function headerInfo(rows, words){
    let best={idx:-1,map:{}};
    for(let i=0;i<Math.min(rows.length,30);i++){
      const map={}; const norm=rows[i].map(normalizar);
      Object.entries(words).forEach(([key, pats]) => {
        const ix = norm.findIndex(c => pats.some(p => c.includes(p)));
        if(ix>=0) map[key]=ix;
      });
      if(Object.keys(map).length > Object.keys(best.map).length) best={idx:i,map};
    }
    return best;
  }
  function procesarSkuPrecios(file){
    leerExcel(file, rows => {
      const h = headerInfo(rows, {sku:['sku','clave','codigo'], desc:['descripcion','descrip','pieza','nombre'], precio:['precio','importe','lista']});
      const out=[];
      const start = h.idx >= 0 && h.map.sku !== undefined ? h.idx+1 : 0;
      for(let i=start;i<rows.length;i++){
        const r=rows[i];
        let sku, desc, precio;
        if(h.map.sku !== undefined){
          sku = r[h.map.sku]; desc = r[h.map.desc ?? h.map.sku+1]; precio = r[h.map.precio ?? h.map.desc+1 ?? 2];
        } else {
          sku = r[0]; desc = r[1]; precio = r[2];
        }
        if(!looksSku(sku)) continue;
        let pnum = limpiarNumero(precio);
        if(!pnum){
          for(let j=r.length-1;j>=0;j--){ pnum = limpiarNumero(r[j]); if(pnum) break; }
        }
        out.push({sku:texto(sku).toUpperCase(), nombre:texto(desc), descripcion:texto(desc), precio_sin_iva:pnum, precio:pnum});
      }
      if(!out.length){ alert('No detecté productos. Revisa que venga SKU, descripción y precio.'); return; }
      productosPrecios = out; save(KEY_PRECIOS, productosPrecios); aplicarDatos(`SKU/precios cargados: ${out.length.toLocaleString('es-MX')} productos.`);
      if($('skuStatus')) $('skuStatus').textContent = `Actualizado: ${out.length.toLocaleString('es-MX')} productos.`;
      subirDatosFirebase('precios', productosPrecios, 'skuStatus');
    });
  }
  function procesarExistencias(file){
    leerExcel(file, rows => {
      const h = headerInfo(rows, {sku:['sku','clave','codigo'], exist:['exist','stock','cantidad','disp']});
      const map={};
      const start = h.idx >= 0 && h.map.sku !== undefined ? h.idx+1 : 0;
      for(let i=start;i<rows.length;i++){
        const r=rows[i];
        const sku = h.map.sku !== undefined ? r[h.map.sku] : r[0];
        const ex = h.map.exist !== undefined ? r[h.map.exist] : r[1];
        if(!looksSku(sku)) continue;
        map[texto(sku).toUpperCase()] = limpiarNumero(ex);
      }
      if(!Object.keys(map).length){ alert('No detecté existencias. Revisa que venga SKU/CLAVE y EXISTENCIA.'); return; }
      existenciasMap = map; save(KEY_EXIST, existenciasMap); aplicarDatos(`Existencias cargadas: ${Object.keys(map).length.toLocaleString('es-MX')} SKU actualizados.`);
      if($('existenciasStatus')) $('existenciasStatus').textContent = `Actualizado: ${Object.keys(map).length.toLocaleString('es-MX')} SKU.`;
      subirDatosFirebase('existencias', existenciasMap, 'existenciasStatus');
    });
  }
  function procesarClientes(file){
    leerExcel(file, rows => {
      const h = headerInfo(rows, {cliente:['cliente','nombre','razon','razón'], vendedor:['vendedor','asesor'], lista:['lista','descuento','desc'], extra:['extra','adicional'], ruta:['ruta'], ciudad:['ciudad','municipio']});
      const out=[...clientesDefault];
      const start = h.idx >= 0 && h.map.cliente !== undefined ? h.idx+1 : 0;
      for(let i=start;i<rows.length;i++){
        const r=rows[i];
        const nombre = texto(h.map.cliente !== undefined ? r[h.map.cliente] : r[0]);
        if(!nombre || nombre.length < 3) continue;
        const rowText = normalizar(r.join(' '));
        let lista = 0.40;
        const listVal = h.map.lista !== undefined ? r[h.map.lista] : rowText;
        const nLista = porcentaje(listVal);
        if(nLista === 0.35 || rowText.includes('35')) lista = 0.35;
        else if(nLista === 0.40 || rowText.includes('40')) lista = 0.40;
        else if(nLista > .2 && nLista < .6) lista = nLista;
        let extra = h.map.extra !== undefined ? porcentaje(r[h.map.extra]) : 0;
        if(!extra && h.map.lista !== undefined){
          // busca otro número pequeño en la fila como 0.05 / 0.10 para extra
          for(const cell of r){ const n=porcentaje(cell); if(n>0 && n<=0.20){ extra=n; break; } }
        }
        out.push({
          nombre,
          vendedor: texto(h.map.vendedor !== undefined ? r[h.map.vendedor] : ''),
          ruta: texto(h.map.ruta !== undefined ? r[h.map.ruta] : ''),
          ciudad: texto(h.map.ciudad !== undefined ? r[h.map.ciudad] : ''),
          lista_descuento: lista,
          descuento_extra: extra,
          etiqueta: `${Math.round(lista*100)}% c/IVA${extra ? ' + '+Math.round(extra*100)+'% extra' : ''}`
        });
      }
      if(out.length <= clientesDefault.length){ alert('No detecté clientes. Revisa que venga columna Cliente/Nombre.'); return; }
      clientes = out; save(KEY_CLIENTES, clientes); llenarClientes(); renderTodo();
      if($('clientesStatus')) $('clientesStatus').textContent = `Actualizado: ${(out.length-clientesDefault.length).toLocaleString('es-MX')} clientes.`;
      if($('uploadStatus')) $('uploadStatus').textContent = 'Clientes actualizados en este equipo.';
      subirDatosFirebase('clientes', clientes, 'clientesStatus');
    });
  }
  function aplicarDatos(msg){
    productos = construirProductos(); resultados=[...productos]; cotizacion = cotizacion.filter(item => productos.some(p => skuProducto(p) === item.sku));
    rehacerIndice(); llenarMarcas(); buscar(); renderCotizacion();
    if($('badgeActualizado')) $('badgeActualizado').textContent = 'Datos actualizados';
    if($('uploadStatus')) $('uploadStatus').textContent = `${msg} Última actualización: ${new Date().toLocaleString('es-MX')}`;
  }

  async function cargarDatosFirebase(){
    if(!window.AMCloudCotizador) return false;
    try{
      const cloud = await window.AMCloudCotizador.loadAll();
      let changed = false;
      if(Array.isArray(cloud?.clientes?.datos) && cloud.clientes.datos.length){ clientes = cloud.clientes.datos; save(KEY_CLIENTES, clientes); changed = true; }
      if(Array.isArray(cloud?.precios?.datos) && cloud.precios.datos.length){ productosPrecios = cloud.precios.datos; save(KEY_PRECIOS, productosPrecios); changed = true; }
      if(cloud?.existencias?.datos && typeof cloud.existencias.datos === 'object'){ existenciasMap = cloud.existencias.datos; save(KEY_EXIST, existenciasMap); changed = true; }
      if(changed){
        productos = construirProductos(); resultados = [...productos];
        rehacerIndice(); llenarClientes(); llenarMarcas(); buscar(); renderCotizacion();
        const badge = $('badgeActualizado'); if(badge) badge.textContent = 'Lista Firebase';
      }
      return changed;
    }catch(err){ console.warn('No se pudo cargar Firebase cotizador:', err); return false; }
  }

  async function subirDatosFirebase(tipo, datos, statusId){
    if(!window.AMCloudCotizador){ alert('Firebase todavía no está listo. Espera unos segundos e intenta de nuevo.'); return false; }
    try{
      if(statusId && $(statusId)) $(statusId).textContent = 'Subiendo a Firebase...';
      await window.AMCloudCotizador.upload(tipo, datos);
      if(statusId && $(statusId)) $(statusId).textContent += ' Subido a Firebase.';
      if($('badgeActualizado')) $('badgeActualizado').textContent = 'Lista Firebase';
      return true;
    }catch(err){ console.error(err); alert('No se pudo subir a Firebase: '+err.message); return false; }
  }

  function restaurarBase(){
    localStorage.removeItem(KEY_PRECIOS); localStorage.removeItem(KEY_EXIST); localStorage.removeItem(KEY_CLIENTES); localStorage.removeItem(KEY_CART);
    productosPrecios = Array.isArray(window.SKU_PRECIOS_COTIZADOR) ? window.SKU_PRECIOS_COTIZADOR : []; existenciasMap = (window.EXISTENCIAS_COTIZADOR && typeof window.EXISTENCIAS_COTIZADOR === 'object') ? window.EXISTENCIAS_COTIZADOR : {}; clientes=clientesBase; cotizacion=[]; productos=construirProductos(); resultados=[...productos];
    rehacerIndice(); llenarClientes(); llenarMarcas(); buscar(); renderCotizacion();
    if($('clientesStatus')) $('clientesStatus').textContent='Base inicial cargada.'; if($('skuStatus')) $('skuStatus').textContent='Catálogo base cargado.'; if($('existenciasStatus')) $('existenciasStatus').textContent='Sin existencias nuevas cargadas.';
    if($('uploadStatus')) $('uploadStatus').textContent='Datos base restaurados.'; if($('badgeActualizado')) $('badgeActualizado').textContent='Lista local';
  }


  function docTipo(){ return texto($('tipoDocumento')?.value || 'COTIZACIÓN'); }
  function folioDocumento(tipo){
    const pref = tipo === 'PEDIDO' ? 'PED' : 'COT';
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    const ss = String(d.getSeconds()).padStart(2,'0');
    return `${pref}-${y}${m}${day}-${hh}${mm}${ss}`;
  }
  function construirDocumentoAM(){
    const tipo = docTipo();
    const c = clienteSel();
    const folio = folioDocumento(tipo);
    let subtotalPublico=0, totalCliente=0;
    const items = cotizacion.map(item => {
      const p = productos.find(x=>skuProducto(x)===item.sku) || {};
      const cantidad = Math.max(1, Number(item.cantidad)||1);
      const publico = precioPublicoProducto(p) || item.precio_publico || 0;
      const cliente = precioConIvaCliente(p) || item.precio_cliente || item.precio || 0;
      const totalPub = publico * cantidad;
      const totalCli = cliente * cantidad;
      subtotalPublico += totalPub;
      totalCliente += totalCli;
      return {
        sku:item.sku,
        cantidad,
        existencia: existenciaProducto(p),
        descripcion:nombreProducto(p),
        precio_publico:publico,
        total_publico:totalPub,
        precio_cliente:cliente,
        total_cliente:totalCli
      };
    });
    const descuento = Math.max(0, subtotalPublico - totalCliente);
    return {
      folio, tipo,
      cliente: c.nombre || clienteActual,
      vendedor: c.vendedor || '-',
      ruta: c.ruta || 'LOCAL',
      ciudad: c.ciudad || 'LOCAL',
      lista_descuento: porcentaje(c.lista_descuento),
      descuento_extra: porcentaje(c.descuento_extra),
      observaciones: texto($('observacionesDoc')?.value || ''),
      fecha: new Date().toISOString(),
      items,
      subtotal_publico: subtotalPublico,
      descuento,
      total_cliente: totalCliente
    };
  }
  function formatoAMHtml(doc){
    const fecha = new Date(doc.fecha);
    const fechaTxt = fecha.toLocaleDateString('es-MX');
    const horaTxt = fecha.toLocaleTimeString('es-MX');
    const descPct = Math.round((doc.lista_descuento || 0) * 100);
    const descExtraPct = Math.round((doc.descuento_extra || 0) * 100);
    const filaDescExtra = descExtraPct > 0 ? `
        <tr>
          <td class="center"><b>DESC EXTRA</b></td><td class="red center">${descExtraPct}%</td><td colspan="3"></td>
          <td class="center" colspan="4"><b>PRECIO PÚBLICO</b></td>
          <td class="center" colspan="3"><b>PRECIO CLIENTE</b></td>
        </tr>` : `
        <tr>
          <td colspan="5"></td>
          <td class="center" colspan="4"><b>PRECIO PÚBLICO</b></td>
          <td class="center" colspan="3"><b>PRECIO CLIENTE</b></td>
        </tr>`;
    const rows = doc.items.map((it,idx)=>`
      <tr>
        <td class="center">${esc(it.sku)}</td>
        <td class="center">${esc(it.cantidad)}</td>
        <td class="center">${esc(it.existencia)}</td>
        <td colspan="2">${esc(it.descripcion)}</td>
        <td class="right">${money(it.precio_publico)}</td>
        <td class="right">${money(it.total_publico)}</td>
        <td class="right">${money(it.precio_cliente)}</td>
        <td class="right">${money(it.total_cliente)}</td>
        <td class="center">${idx+1}</td>
        <td class="right">${money(it.total_cliente)}</td>
        <td class="right">${money(it.total_cliente)}</td>
      </tr>`).join('');
    const emptyRows = Array.from({length: Math.max(0, 4-doc.items.length)}, () => `
      <tr><td>&nbsp;</td><td></td><td class="center">0</td><td colspan="2"></td><td class="right">$0.00</td><td class="right">$0.00</td><td class="right">$0.00</td><td class="right">$0.00</td><td></td><td class="right">$0.00</td><td class="right">$0.00</td></tr>`).join('');
    return `
      <table class="amFormat" id="tablaFormatoAM">
        <tr>
          <td class="logoCell" colspan="2" rowspan="4"><img src="logo.png" alt="AM Autopartes" style="max-width:150px;max-height:86px;object-fit:contain;display:block;margin:auto;"></td>
          <td class="topTitle" colspan="8">AM AUTOPARTES</td>
          <td class="center"><b>Folio</b></td><td>${esc(doc.folio)}</td>
        </tr>
        <tr><td class="blue" colspan="8">${esc(doc.tipo)}</td><td class="center"><b>Versión</b></td><td>002</td></tr>
        <tr><td colspan="8"></td><td class="center"><b>Fecha</b></td><td>${fechaTxt}</td></tr>
        <tr><td colspan="8"></td><td class="center"><b>Hora</b></td><td>${horaTxt}</td></tr>
        <tr><td colspan="12">&nbsp;</td></tr>
        <tr>
          <td class="gray" colspan="2">MOSTRADOR</td>
          <td class="center" colspan="4"><b>${esc(doc.cliente)}</b></td>
          <td class="center" colspan="3">VENDEDOR: ${esc(doc.vendedor)}</td>
          <td class="center" colspan="3"><b>${esc(doc.ruta || 'LOCAL')}</b></td>
        </tr>
        <tr>
          <td class="center"><b>%</b></td><td class="center">${descPct/100}</td>
          <td colspan="4" class="center">PUE ${esc(doc.observaciones || 'PAGO CONTRA ENTREGA')}</td>
          <td class="center" colspan="3"><b>RUTA</b></td><td class="center" colspan="3">${esc(doc.ciudad || 'LOCAL')}</td>
        </tr>
        <tr>
          <td class="center"><b>OBSERVACIONES</b></td><td colspan="5">${esc(doc.observaciones)}</td>
          <td class="center" colspan="3">${fechaTxt}</td><td class="center" colspan="3">${horaTxt}</td>
        </tr>
        ${filaDescExtra}
        <tr>
          <th class="gray">CLAVE</th><th class="gray">PIEZAS</th><th class="gray">EXIST</th><th class="gray" colspan="2">DESCRIPCIÓN</th>
          <th class="lightBlue">PRECIO</th><th class="lightBlue">TOTAL</th><th class="darkBlue">IMPORTE C/IVA</th><th class="darkBlue">TOTAL C/IVA</th>
          <th class="lightBlue">PIEZAS</th><th class="lightBlue">TOTAL</th><th class="darkBlue">TOTAL C/IVA</th>
        </tr>
        ${rows}${emptyRows}
        <tr><td colspan="9" class="cream right"><b>SUBTOTAL:</b></td><td colspan="3" class="right cream"><b>${money(doc.subtotal_publico)}</b></td></tr>
        <tr><td colspan="9" class="cream right"><b>DESCUENTO:</b></td><td colspan="3" class="right cream"><b>${money(doc.descuento)}</b></td></tr>
        <tr><td colspan="9" class="green right"><b>TOTAL GENERAL CON IVA:</b></td><td colspan="3" class="right green" style="font-size:16px"><b>${money(doc.total_cliente)}</b></td></tr>
      </table>`;
  }
  function mostrarFormatoAM(doc){
    const box = $('formatoPreview');
    if(!box) return;
    box.innerHTML = formatoAMHtml(doc || construirDocumentoAM());
    box.classList.remove('hidden');
  }
  function descargarExcelAM(){
    if(!cotizacion.length){ alert('Primero agrega productos a la cotización.'); return; }
    const doc = construirDocumentoAM();
    mostrarFormatoAM(doc);
    const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${formatoAMHtml(doc)}</body></html>`;
    const blob = new Blob([html], {type:'application/vnd.ms-excel;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${doc.folio}_${doc.tipo.replace(/\s+/g,'_')}_AM.xls`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
  }

  function abrirPDFFormatoAM(doc){
    // Móvil/PWA: imprimir la misma pantalla evita popups bloqueados y duplicados.
    mostrarFormatoAM(doc);
    setTimeout(() => window.print(), 150);
    return true;
  }

  async function finalizarDocumento(){
    if(!cotizacion.length){ alert('Primero agrega productos a la cotización.'); return; }
    const doc = construirDocumentoAM();
    mostrarFormatoAM(doc);
    abrirPDFFormatoAM(doc);
  }
  function imprimirFormatoAM(){
    if(!cotizacion.length){ alert('Primero agrega productos a la cotización.'); return; }
    const doc = construirDocumentoAM();
    mostrarFormatoAM(doc);
    abrirPDFFormatoAM(doc);
  }

  function init(){
    if(!productos.length){ $('gridProductos').innerHTML='<div class="empty">No se cargó catálogo.</div>'; }
    rehacerIndice(); llenarClientes(); llenarMarcas(); buscar(); renderCotizacion();
    $('clienteSelect').addEventListener('change', actualizarCliente);
    $('clienteSelect').addEventListener('blur', actualizarCliente);
    $('clienteDropdown')?.addEventListener('change', () => { if($('clienteDropdown').value){ $('clienteSelect').value = $('clienteDropdown').value; actualizarCliente(); } });
    $('buscador').addEventListener('input', buscar);
    $('limpiarBusqueda').addEventListener('click', () => { $('buscador').value=''; buscar(); });
    $('filtroMarca').addEventListener('change', buscar);
    $('porPagina').addEventListener('change', () => { paginaActual=1; renderCatalogo(); });
    $('copiarCotizacion').addEventListener('click', copiarCotizacion);
    $('vaciarCotizacion').addEventListener('click', vaciarCotizacion);
    $('descargarExcelAM')?.addEventListener('click', descargarExcelAM);
    $('finalizarDoc')?.addEventListener('click', finalizarDocumento);
    $('imprimirFormatoAM')?.addEventListener('click', imprimirFormatoAM);
    $('cerrarDetalleProducto')?.addEventListener('click', cerrarDetalleProducto);
    $('detalleProductoModal')?.addEventListener('click', (e) => { if(e.target === $('detalleProductoModal')) cerrarDetalleProducto(); });
    $('clientesInput')?.addEventListener('change', e => { if(e.target.files[0]) procesarClientes(e.target.files[0]); });
    $('skuInput')?.addEventListener('change', e => { if(e.target.files[0]) procesarSkuPrecios(e.target.files[0]); });
    $('existenciasInput')?.addEventListener('change', e => { if(e.target.files[0]) procesarExistencias(e.target.files[0]); });
    $('publicarLocal')?.addEventListener('click', () => aplicarDatos('Actualización aplicada en este equipo.'));
    $('restaurarBase')?.addEventListener('click', restaurarBase);
    document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => activarTab(btn.dataset.tab)));
    cargarDatosFirebase();
  }
  window.addEventListener('amcloudcotizadorready', cargarDatosFirebase);
  window.addEventListener('DOMContentLoaded', init);
})();

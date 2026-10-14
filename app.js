(function () {
  "use strict";

  // ---------- estado ----------
  let products = [], sales = [], expenses = [];
  let ticket = []; // {productId, name, price, qty}
  let paymentMethod = "Efectivo";
  let cashReceived = "";
  let creditCustomer = "";
  let creditDue = defaultDue();
  let currentTab = "vender";
  let period = "hoy";
  let businessName = "Tuul Garden Kitchen";
  let editingProductId = null;
  const catColors = ["var(--green)", "var(--gold)", "var(--tomato)", "var(--lime)", "#6E7FB0", "#A0637A"];
  const catColorMap = {};

  // ---------- helpers ----------
  function pad(n) { return String(n).padStart(2, "0"); }
  function dstr(d) { d = d || new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function mxn(n) { n = Number(n) || 0; return "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtDateShort(s) {
    const [y, m, d] = s.split("-");
    const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    return d + " " + months[parseInt(m, 10) - 1];
  }
  function catColor(cat) {
    if (!catColorMap[cat]) {
      const idx = Object.keys(catColorMap).length % catColors.length;
      catColorMap[cat] = catColors[idx];
    }
    return catColorMap[cat];
  }
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 2200);
  }
  function startOfWeek(d) {
    const day = (d.getDay() + 6) % 7;
    const m = new Date(d); m.setDate(d.getDate() - day); m.setHours(0, 0, 0, 0);
    return m;
  }
  function periodRange() {
    const now = new Date();
    if (period === "hoy") { const s = dstr(now); return [s, s]; }
    if (period === "semana") { const s = startOfWeek(now); const e = new Date(s); e.setDate(s.getDate() + 6); return [dstr(s), dstr(e)]; }
    if (period === "mes") { const s = new Date(now.getFullYear(), now.getMonth(), 1); const e = new Date(now.getFullYear(), now.getMonth() + 1, 0); return [dstr(s), dstr(e)]; }
    if (period === "rango") {
      const f = document.getElementById("rangeFrom").value || dstr(now);
      const t = document.getElementById("rangeTo").value || dstr(now);
      return [f, t];
    }
    const s = dstr(now); return [s, s];
  }
  function inRange(ds, from, to) { return ds >= from && ds <= to; }
  function isPending(s) { return s.status === "pending"; }
  function addDaysStr(n) { const d = new Date(); d.setDate(d.getDate() + n); return dstr(d); }
  function defaultDue() { return addDaysStr(7); }
  function daysBetween(fromStr, toStr) {
    const a = new Date(fromStr + "T00:00:00"), b = new Date(toStr + "T00:00:00");
    return Math.round((b - a) / 86400000);
  }
  function escapeHtml(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function escapeAttr(s) { return escapeHtml(s); }

  // Confirmación en 2 pasos dentro del propio botón (más confiable que confirm()
  // en algunos navegadores empotrados / vistas de escritorio).
  function confirmClick(btn, label, onConfirm) {
    if (btn.dataset.confirming === "1") {
      clearTimeout(btn._confirmTimer);
      onConfirm();
      return;
    }
    btn.dataset.confirming = "1";
    const original = btn.textContent;
    btn.textContent = label || "¿Seguro? Toca otra vez";
    btn.classList.add("confirming");
    btn._confirmTimer = setTimeout(() => {
      if (btn.isConnected) {
        btn.textContent = original;
        btn.classList.remove("confirming");
        delete btn.dataset.confirming;
      }
    }, 2800);
  }

  // ---------- capa de API ----------
  // Todo el acceso a datos pasa por apiGet / apiSend. Hoy hablan con el
  // almacenamiento del navegador (storage.js). Para conectar un servidor real,
  // reemplaza SOLO estas dos funciones por fetch("/api" + url, ...).
  async function apiGet(url) { return LocalApi.handle("GET", url); }
  async function apiSend(method, url, body) { return LocalApi.handle(method, url, body); }
  const apiPost = (url, body) => apiSend("POST", url, body);
  const apiPut = (url, body) => apiSend("PUT", url, body);
  const apiDelete = (url) => apiSend("DELETE", url);

  function showConnBanner(show, msg) {
    const b = document.getElementById("connBanner");
    b.style.display = show ? "block" : "none";
    if (show) b.textContent = msg;
  }

  // ---------- carga de datos ----------
  let lastSig = "";
  async function loadAll(silent) {
    try {
      const [p, s, e, cfg] = await Promise.all([
        apiGet("/products"),
        apiGet("/sales"),
        apiGet("/expenses"),
        apiGet("/settings"),
      ]);
      if (silent) {
        // Refresco automático: no interrumpir si estás escribiendo en el ticket
        const ae = document.activeElement;
        if (ae && ae.closest && ae.closest("#receiptBody")) return;
      }
      const sig = JSON.stringify([p, s, e, cfg]);
      if (silent && sig === lastSig) return; // nada cambió, no redibujar
      lastSig = sig;
      products = p; sales = s; expenses = e;
      businessName = cfg.businessName || businessName;
      const brandEl = document.getElementById("brandName");
      if (document.activeElement !== brandEl) brandEl.textContent = businessName;
      showConnBanner(false);
      if (!LocalApi.persistent) {
        showConnBanner(true, "Tu navegador no permite guardar datos (¿modo privado?). Lo que captures se perderá al cerrar la pestaña.");
      }
      updateHeaderStat();
      renderCurrentTab();
    } catch (err) {
      showConnBanner(true, "No se pudieron leer los datos guardados en este navegador.");
    }
  }

  function renderCurrentTab() {
    if (currentTab === "vender") renderVender();
    if (currentTab === "gastos") renderGastos();
    if (currentTab === "creditos") renderCreditos();
    if (currentTab === "reportes") renderReportes();
    if (currentTab === "productos") renderProductos();
  }

  // ---------- header ----------
  function updateHeaderStat() {
    const today = dstr();
    const ventasHoy = sales.filter(s => s.dateStr === today && !isPending(s)).reduce((a, s) => a + (s.total || 0), 0);
    const gastosHoy = expenses.filter(e => e.dateStr === today).reduce((a, e) => a + (e.amount || 0), 0);
    const net = ventasHoy - gastosHoy;
    const el = document.getElementById("todayNet");
    el.textContent = mxn(net);
    el.style.color = net < 0 ? "var(--tomato)" : "var(--green)";

    const pend = sales.filter(isPending);
    document.getElementById("pendingTotal").textContent = mxn(pend.reduce((a, s) => a + (s.total || 0), 0));
    document.getElementById("tabCreditos").textContent = pend.length ? "Por cobrar (" + pend.length + ")" : "Por cobrar";
  }

  // ---------- tabs ----------
  document.getElementById("tabsNav").addEventListener("click", function (e) {
    const btn = e.target.closest("button[data-tab]");
    if (!btn) return;
    currentTab = btn.dataset.tab;
    document.querySelectorAll("#tabsNav button").forEach(b => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    document.getElementById("view-" + currentTab).classList.add("active");
    renderCurrentTab();
  });

  // ---------- nombre del negocio ----------
  const brandEl = document.getElementById("brandName");
  brandEl.addEventListener("blur", async function () {
    const v = brandEl.textContent.trim() || "Tuul Garden Kitchen";
    brandEl.textContent = v;
    businessName = v;
    try { await apiPost("/settings", { businessName: v }); } catch (e) { toast("No se pudo guardar el nombre."); }
  });
  brandEl.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); brandEl.blur(); } });

  document.getElementById("todayLabel").textContent = new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });

  // ================= VENDER =================
  function renderVender() {
    const grid = document.getElementById("productGrid");
    const active = products.filter(p => p.active !== false);
    if (active.length === 0) {
      grid.innerHTML = '<div class="empty-note">Todavía no tienes productos activos. Ve a la pestaña <strong>Productos</strong> para agregarlos.</div>';
    } else {
      const byCat = {};
      active.forEach(p => { const c = p.category || "Otros"; (byCat[c] = byCat[c] || []).push(p); });
      let html = "";
      Object.keys(byCat).forEach(cat => {
        const color = catColor(cat);
        html += '<div class="cat-block"><p class="cat-title"><span class="cat-dot" style="background:' + color + '"></span>' + escapeHtml(cat) + '</p><div class="product-grid">';
        byCat[cat].forEach(p => {
          const inTicket = ticket.find(t => t.productId === p.id);
          html += '<button class="product-btn" style="--cat-color:' + color + '" data-id="' + p.id + '">' +
            (inTicket ? '<span class="badge">' + inTicket.qty + '</span>' : '') +
            '<span class="pname">' + escapeHtml(p.name) + '</span>' +
            '<span class="pprice">' + mxn(p.price) + '</span></button>';
        });
        html += "</div></div>";
      });
      grid.innerHTML = html;
    }
    document.getElementById("ticketDate").textContent = new Date().toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    renderReceipt();
  }

  document.getElementById("productGrid").addEventListener("click", function (e) {
    const btn = e.target.closest(".product-btn");
    if (!btn) return;
    const p = products.find(x => String(x.id) === btn.dataset.id);
    if (!p) return;
    const existing = ticket.find(t => t.productId === p.id);
    if (existing) existing.qty += 1;
    else ticket.push({ productId: p.id, name: p.name, price: p.price, qty: 1 });
    renderVender();
  });

  function ticketTotal() { return ticket.reduce((a, t) => a + t.price * t.qty, 0); }

  function renderReceipt() {
    const body = document.getElementById("receiptBody");
    if (ticket.length === 0) {
      body.innerHTML = '<p class="receipt-empty">Toca un producto para agregarlo al ticket.</p>';
      return;
    }
    let html = '<div class="receipt-lines">';
    ticket.forEach((t, i) => {
      html += '<div class="receipt-line">' +
        '<span class="rname">' + escapeHtml(t.name) + '</span>' +
        '<span class="rqty"><button data-act="dec" data-i="' + i + '" aria-label="Quitar uno">−</button>' + t.qty + '<button data-act="inc" data-i="' + i + '" aria-label="Agregar uno">+</button></span>' +
        '<span class="ramount">' + mxn(t.price * t.qty) + '</span>' +
        '<button class="receipt-remove" data-act="del" data-i="' + i + '" aria-label="Eliminar">✕</button>' +
        '</div>';
    });
    html += '</div>';
    html += '<div class="receipt-total"><span class="tlabel">Total</span><span class="tval">' + mxn(ticketTotal()) + '</span></div>';
    html += '<div class="pay-methods">' +
      ["Efectivo", "Tarjeta", "Transferencia", "Crédito"].map(pm => '<button data-pm="' + pm + '" class="' + (paymentMethod === pm ? "active" : "") + '">' + pm + '</button>').join("") +
      '</div>';
    if (paymentMethod === "Efectivo") {
      const total = ticketTotal();
      const received = parseFloat(cashReceived);
      const hasReceived = cashReceived !== "" && !isNaN(received);
      const change = hasReceived ? received - total : null;
      html += '<div class="cash-row">' +
        '<div class="field" style="flex:1;"><label for="cashInput">Recibí</label>' +
        '<input type="number" id="cashInput" min="0" step="0.5" inputmode="decimal" placeholder="0.00" value="' + escapeAttr(cashReceived) + '"></div>' +
        '<div class="change-box ' + (change !== null && change < 0 ? "short" : "") + '">' +
        '<div class="change-label">' + (change !== null && change < 0 ? "Falta" : "Cambio") + '</div>' +
        '<div class="change-val">' + (hasReceived ? mxn(Math.abs(change)) : "—") + '</div>' +
        '</div></div>';
    } else if (paymentMethod === "Crédito") {
      const dd = daysBetween(dstr(), creditDue);
      html += '<div class="credit-box">' +
        '<div class="field"><label for="creditCustomer">Cliente</label>' +
        '<input type="text" id="creditCustomer" placeholder="Nombre de quien te debe" value="' + escapeAttr(creditCustomer) + '"></div>' +
        '<div class="field"><label>Plazo de pago</label></div>' +
        '<div class="due-chips">' +
        [7, 15, 30].map(n => '<button data-due-days="' + n + '" class="' + (dd === n ? "active" : "") + '">' + n + ' días</button>').join("") +
        '</div>' +
        '<div class="field"><label for="creditDue">Fecha límite de pago</label>' +
        '<input type="date" id="creditDue" min="' + dstr() + '" value="' + escapeAttr(creditDue) + '"></div>' +
        '</div>';
    }
    html += '<button class="btn-cobrar" id="btnCobrar">' + (paymentMethod === "Crédito" ? "Registrar crédito " : "Cobrar ") + mxn(ticketTotal()) + '</button>';
    html += '<button class="btn-vaciar" id="btnVaciar">Vaciar ticket</button>';
    body.innerHTML = html;
  }

  document.getElementById("receiptBody").addEventListener("input", function (e) {
    if (e.target.id === "creditCustomer") { creditCustomer = e.target.value; return; }
    if (e.target.id === "creditDue") { creditDue = e.target.value; return; }
    if (e.target.id !== "cashInput") return;
    cashReceived = e.target.value;
    const total = ticketTotal();
    const received = parseFloat(cashReceived);
    const hasReceived = cashReceived !== "" && !isNaN(received);
    const change = hasReceived ? received - total : null;
    const box = document.querySelector(".change-box");
    if (box) {
      box.classList.toggle("short", change !== null && change < 0);
      box.querySelector(".change-label").textContent = (change !== null && change < 0) ? "Falta" : "Cambio";
      box.querySelector(".change-val").textContent = hasReceived ? mxn(Math.abs(change)) : "—";
    }
  });

  document.getElementById("receiptBody").addEventListener("click", function (e) {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.act) {
      const i = parseInt(b.dataset.i, 10);
      if (b.dataset.act === "inc") ticket[i].qty += 1;
      if (b.dataset.act === "dec") { ticket[i].qty -= 1; if (ticket[i].qty <= 0) ticket.splice(i, 1); }
      if (b.dataset.act === "del") ticket.splice(i, 1);
      renderVender();
    } else if (b.dataset.dueDays) {
      creditDue = addDaysStr(parseInt(b.dataset.dueDays, 10));
      renderReceipt();
    } else if (b.dataset.pm) {
      paymentMethod = b.dataset.pm;
      if (paymentMethod !== "Efectivo") cashReceived = "";
      renderReceipt();
    } else if (b.id === "btnCobrar") {
      finalizeSale();
    } else if (b.id === "btnVaciar") {
      ticket = [];
      cashReceived = "";
      renderVender();
    }
  });

  async function finalizeSale() {
    if (ticket.length === 0) return;
    const total = ticketTotal();
    const received = parseFloat(cashReceived);
    const hasReceived = paymentMethod === "Efectivo" && cashReceived !== "" && !isNaN(received);
    if (paymentMethod === "Efectivo" && hasReceived && received < total) {
      const proceedAnyway = window.confirm ? confirm("El efectivo recibido es menor al total. ¿Registrar de todas formas?") : true;
      if (!proceedAnyway) return;
    }
    const saleDoc = {
      items: ticket.map(t => ({ productId: t.productId, name: t.name, price: t.price, qty: t.qty })),
      total: total,
      paymentMethod: paymentMethod,
      dateStr: dstr(),
    };
    if (hasReceived) {
      saleDoc.cashReceived = received;
      saleDoc.change = received - total;
    }
    if (paymentMethod === "Crédito") {
      const customer = creditCustomer.trim();
      if (!customer) { toast("Escribe el nombre del cliente."); return; }
      if (!creditDue || creditDue < dstr()) { toast("Elige una fecha límite válida."); return; }
      saleDoc.customer = customer;
      saleDoc.dueDate = creditDue;
    }
    try {
      await apiPost("/sales", saleDoc);
      ticket = [];
      cashReceived = "";
      if (saleDoc.dueDate) {
        toast("Crédito registrado para " + saleDoc.customer + " · vence " + fmtDateShort(saleDoc.dueDate));
        creditCustomer = "";
        creditDue = defaultDue();
        paymentMethod = "Efectivo";
      } else {
        toast(hasReceived ? "Venta registrada · Cambio: " + mxn(Math.abs(saleDoc.change)) : "Venta registrada · " + mxn(saleDoc.total));
      }
      await loadAll();
    } catch (err) {
      toast("No se pudo guardar la venta. Intenta de nuevo.");
    }
  }

  // ================= GASTOS =================
  document.getElementById("expDate").value = dstr();
  document.getElementById("btnAddExpense").addEventListener("click", async function () {
    const desc = document.getElementById("expDesc").value.trim();
    const cat = document.getElementById("expCat").value;
    const amount = parseFloat(document.getElementById("expAmount").value);
    const date = document.getElementById("expDate").value || dstr();
    if (!desc || !amount || amount <= 0) { toast("Escribe una descripción y un monto válido."); return; }
    try {
      await apiPost("/expenses", { description: desc, category: cat, amount, dateStr: date });
      document.getElementById("expDesc").value = "";
      document.getElementById("expAmount").value = "";
      toast("Gasto agregado");
      await loadAll();
    } catch (e) { toast("No se pudo guardar el gasto."); }
  });

  function renderGastos() {
    const tbody = document.querySelector("#expenseTable tbody");
    const sorted = expenses.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
    document.getElementById("expenseEmpty").style.display = sorted.length ? "none" : "block";
    tbody.innerHTML = sorted.map(e =>
      '<tr><td>' + fmtDateShort(e.dateStr) + '</td><td>' + escapeHtml(e.description) + '</td>' +
      '<td><span class="cat-pill">' + escapeHtml(e.category) + '</span></td>' +
      '<td class="num">' + mxn(e.amount) + '</td>' +
      '<td><button class="btn-ghost-danger" data-del="' + e.id + '">Eliminar</button></td></tr>'
    ).join("");
  }
  document.querySelector("#expenseTable tbody").addEventListener("click", function (e) {
    const b = e.target.closest("button[data-del]");
    if (!b) return;
    confirmClick(b, "¿Eliminar?", async function () {
      try { await apiDelete("/expenses/" + b.dataset.del); await loadAll(); }
      catch (err) { toast("No se pudo eliminar."); }
    });
  });

  // ================= PRODUCTOS =================
  function refreshCatList() {
    const cats = Array.from(new Set(products.map(p => p.category || "Otros")));
    document.getElementById("catList").innerHTML = cats.map(c => '<option value="' + escapeHtml(c) + '">').join("");
  }

  document.getElementById("btnAddProduct").addEventListener("click", async function () {
    const name = document.getElementById("prodName").value.trim();
    const cat = document.getElementById("prodCat").value.trim() || "Otros";
    const price = parseFloat(document.getElementById("prodPrice").value);
    if (!name || isNaN(price) || price < 0) { toast("Escribe un nombre y un precio válido."); return; }
    try {
      await apiPost("/products", { name, category: cat, price });
      document.getElementById("prodName").value = "";
      document.getElementById("prodPrice").value = "";
      toast("Producto agregado");
      await loadAll();
    } catch (e) { toast("No se pudo guardar el producto."); }
  });

  document.getElementById("btnSeedProducts").addEventListener("click", async function () {
    const sample = [
      { name: "Ensalada César chica", category: "Ensaladas", price: 65 },
      { name: "Ensalada César grande", category: "Ensaladas", price: 85 },
      { name: "Ensalada Griega", category: "Ensaladas", price: 80 },
      { name: "Ensalada de Pollo", category: "Ensaladas", price: 90 },
      { name: "Ensalada Vegana", category: "Ensaladas", price: 75 },
      { name: "Pollo asado extra", category: "Extras", price: 20 },
      { name: "Aguacate extra", category: "Extras", price: 15 },
      { name: "Queso extra", category: "Extras", price: 15 },
      { name: "Agua embotellada", category: "Bebidas", price: 20 },
      { name: "Refresco", category: "Bebidas", price: 25 },
    ];
    try {
      for (const p of sample) { await apiPost("/products", p); }
      toast("Productos de ejemplo agregados, edítalos a tu gusto");
      await loadAll();
    } catch (e) { toast("No se pudieron cargar los productos de ejemplo."); }
  });

  function renderProductos() {
    const tbody = document.querySelector("#productTable tbody");
    document.getElementById("productEmpty").style.display = products.length ? "none" : "block";
    tbody.innerHTML = products.map(p => {
      if (editingProductId === p.id) {
        return '<tr data-row="' + p.id + '">' +
          '<td><input type="text" class="edit-name" value="' + escapeAttr(p.name) + '" style="width:100%;padding:5px;"></td>' +
          '<td><input type="text" class="edit-cat" value="' + escapeAttr(p.category || "Otros") + '" style="width:100%;padding:5px;"></td>' +
          '<td><input type="number" class="edit-price" value="' + p.price + '" style="width:80px;padding:5px;"></td>' +
          '<td><label class="active-toggle"><input type="checkbox" class="edit-active" ' + (p.active !== false ? "checked" : "") + '></label></td>' +
          '<td><button class="btn-secondary" data-save="' + p.id + '">Guardar</button> <button class="btn-ghost-danger" data-cancel="1">Cancelar</button></td></tr>';
      }
      return '<tr><td>' + escapeHtml(p.name) + '</td>' +
        '<td><span class="cat-pill">' + escapeHtml(p.category || "Otros") + '</span></td>' +
        '<td class="num">' + mxn(p.price) + '</td>' +
        '<td>' + (p.active !== false ? "Sí" : "No") + '</td>' +
        '<td><button class="btn-secondary" data-edit="' + p.id + '">Editar</button> <button class="btn-ghost-danger" data-del="' + p.id + '">Eliminar</button></td></tr>';
    }).join("");
    refreshCatList();
  }

  document.querySelector("#productTable tbody").addEventListener("click", async function (e) {
    const editBtn = e.target.closest("button[data-edit]");
    const delBtn = e.target.closest("button[data-del]");
    const saveBtn = e.target.closest("button[data-save]");
    const cancelBtn = e.target.closest("button[data-cancel]");
    if (editBtn) { editingProductId = parseInt(editBtn.dataset.edit, 10); renderProductos(); return; }
    if (cancelBtn) { editingProductId = null; renderProductos(); return; }
    if (delBtn) {
      confirmClick(delBtn, "¿Eliminar?", async function () {
        try { await apiDelete("/products/" + delBtn.dataset.del); await loadAll(); }
        catch (err) { toast("No se pudo eliminar."); }
      });
      return;
    }
    if (saveBtn) {
      const row = saveBtn.closest("tr");
      const name = row.querySelector(".edit-name").value.trim();
      const cat = row.querySelector(".edit-cat").value.trim() || "Otros";
      const price = parseFloat(row.querySelector(".edit-price").value);
      const active = row.querySelector(".edit-active").checked;
      if (!name || isNaN(price) || price < 0) { toast("Datos inválidos."); return; }
      try {
        await apiPut("/products/" + saveBtn.dataset.save, { name, category: cat, price, active });
        editingProductId = null;
        await loadAll();
      } catch (err) { toast("No se pudo guardar."); }
    }
  });

  // ================= POR COBRAR (CRÉDITOS) =================
  function dueLabel(dueDate) {
    const d = daysBetween(dstr(), dueDate);
    if (d < 0) return { text: "Vencida hace " + (-d) + (d === -1 ? " día" : " días"), cls: "overdue" };
    if (d === 0) return { text: "Vence hoy", cls: "soon" };
    if (d <= 3) return { text: "Vence en " + d + (d === 1 ? " día" : " días"), cls: "soon" };
    return { text: "Vence en " + d + " días", cls: "" };
  }
  function creditItemsText(s) {
    return (s.items || []).map(i => i.qty + "× " + i.name).join(", ");
  }

  function renderCreditos() {
    const today = dstr();
    const pending = sales.filter(isPending).sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));
    const paid = sales.filter(s => s.dueDate && s.status === "paid").sort((a, b) => (b.paidAt || 0) - (a.paidAt || 0)).slice(0, 15);
    const totalPend = pending.reduce((a, s) => a + (s.total || 0), 0);
    const overdue = pending.filter(s => s.dueDate < today);
    const totalOver = overdue.reduce((a, s) => a + (s.total || 0), 0);

    document.getElementById("creditSummary").innerHTML = [
      ["Total por cobrar", mxn(totalPend), ""],
      ["Créditos pendientes", pending.length, ""],
      ["Vencidos", mxn(totalOver) + (overdue.length ? " (" + overdue.length + ")" : ""), overdue.length ? "neg" : ""]
    ].map(s => '<div class="stat ' + s[2] + '"><div class="slabel">' + s[0] + '</div><div class="sval">' + s[1] + '</div></div>').join("");

    document.getElementById("creditEmpty").style.display = pending.length ? "none" : "block";
    document.getElementById("creditList").innerHTML = pending.map(s => {
      const lbl = dueLabel(s.dueDate);
      return '<div class="credit-row">' +
        '<div class="credit-main"><div class="credit-name">' + escapeHtml(s.customer) + '</div>' +
        '<div class="credit-sub">' + escapeHtml(creditItemsText(s)) + ' · venta del ' + fmtDateShort(s.dateStr) + ' · límite ' + fmtDateShort(s.dueDate) + '</div></div>' +
        '<span class="due-tag ' + lbl.cls + '">' + lbl.text + '</span>' +
        '<span class="credit-amount">' + mxn(s.total) + '</span>' +
        '<button class="btn-primary" data-pay="' + s.id + '">Marcar pagada</button>' +
        '</div>';
    }).join("");

    document.getElementById("creditPaidEmpty").style.display = paid.length ? "none" : "block";
    document.getElementById("creditPaidList").innerHTML = paid.map(s =>
      '<div class="credit-row">' +
      '<div class="credit-main"><div class="credit-name">' + escapeHtml(s.customer) + '</div>' +
      '<div class="credit-sub">' + escapeHtml(creditItemsText(s)) + ' · pagado el ' + (s.paidAt ? fmtDateShort(dstr(new Date(s.paidAt))) : "—") + '</div></div>' +
      '<span class="credit-amount">' + mxn(s.total) + '</span>' +
      '<button class="btn-link" data-unpay="' + s.id + '">Deshacer</button>' +
      '</div>'
    ).join("");
  }

  document.getElementById("creditList").addEventListener("click", function (e) {
    const b = e.target.closest("button[data-pay]");
    if (!b) return;
    confirmClick(b, "¿Confirmar pago?", async function () {
      try { await apiPut("/sales/" + b.dataset.pay, { status: "paid" }); toast("Pago registrado"); await loadAll(); }
      catch (err) { toast("No se pudo actualizar."); }
    });
  });
  document.getElementById("creditPaidList").addEventListener("click", function (e) {
    const b = e.target.closest("button[data-unpay]");
    if (!b) return;
    confirmClick(b, "¿Deshacer?", async function () {
      try { await apiPut("/sales/" + b.dataset.unpay, { status: "pending" }); toast("Regresó a pendiente"); await loadAll(); }
      catch (err) { toast("No se pudo actualizar."); }
    });
  });

  // ================= REPORTES =================
  document.getElementById("periodTabs").addEventListener("click", function (e) {
    const b = e.target.closest("button[data-p]");
    if (!b) return;
    period = b.dataset.p;
    document.querySelectorAll("#periodTabs button[data-p]").forEach(x => x.classList.toggle("active", x === b));
    document.getElementById("rangePickers").style.display = period === "rango" ? "flex" : "none";
    renderReportes();
  });
  document.getElementById("rangeFrom").value = dstr();
  document.getElementById("rangeTo").value = dstr();
  document.getElementById("rangeFrom").addEventListener("change", () => { if (period === "rango") renderReportes(); });
  document.getElementById("rangeTo").addEventListener("change", () => { if (period === "rango") renderReportes(); });

  function renderReportes() {
    const [from, to] = periodRange();
    const salesF = sales.filter(s => inRange(s.dateStr, from, to));
    const expF = expenses.filter(e => inRange(e.dateStr, from, to));
    const totalVentas = salesF.reduce((a, s) => a + (s.total || 0), 0);
    const totalGastos = expF.reduce((a, e) => a + (e.amount || 0), 0);
    const totalPorCobrar = salesF.filter(isPending).reduce((a, s) => a + (s.total || 0), 0);
    const neto = totalVentas - totalPorCobrar - totalGastos;
    const numTickets = salesF.length;
    const promedio = numTickets ? totalVentas / numTickets : 0;

    document.getElementById("statRow").innerHTML = [
      ["Ventas", mxn(totalVentas), ""],
      ["Por cobrar", mxn(totalPorCobrar), ""],
      ["Gastos", mxn(totalGastos), "neg"],
      ["Ganancia neta (cobrada)", mxn(neto), neto >= 0 ? "pos" : "neg"],
      ["Tickets", numTickets, ""],
      ["Ticket promedio", mxn(promedio), ""]
    ].map(s => '<div class="stat ' + s[2] + '"><div class="slabel">' + s[0] + '</div><div class="sval">' + s[1] + '</div></div>').join("");

    const barsCard = document.getElementById("dayBarsCard");
    if (period === "semana" || period === "mes") {
      barsCard.style.display = "block";
      const days = [];
      let d = new Date(from + "T00:00:00");
      const end = new Date(to + "T00:00:00");
      while (d <= end && days.length < 31) { days.push(dstr(d)); d.setDate(d.getDate() + 1); }
      const totals = days.map(ds => sales.filter(s => s.dateStr === ds).reduce((a, s) => a + (s.total || 0), 0));
      const max = Math.max(1, ...totals);
      const today = dstr();
      document.getElementById("dayBars").innerHTML = days.map((ds, i) => {
        const h = Math.max(2, Math.round((totals[i] / max) * 100));
        const lbl = period === "semana" ? ["L", "M", "M", "J", "V", "S", "D"][i] : ds.slice(8);
        return '<div class="bar-col"><div class="bar' + (ds === today ? " today" : "") + '" style="height:' + h + '%" title="' + mxn(totals[i]) + '"></div><div class="bar-label">' + lbl + '</div></div>';
      }).join("");
    } else {
      barsCard.style.display = "none";
    }

    const agg = {};
    salesF.forEach(s => (s.items || []).forEach(it => {
      agg[it.name] = agg[it.name] || { qty: 0, revenue: 0 };
      agg[it.name].qty += it.qty;
      agg[it.name].revenue += it.price * it.qty;
    }));
    const ranked = Object.entries(agg).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 8);
    document.getElementById("rankEmpty").style.display = ranked.length ? "none" : "block";
    const maxRev = Math.max(1, ...ranked.map(r => r[1].revenue));
    document.getElementById("rankList").innerHTML = ranked.map((r, i) =>
      '<div class="rank-row"><span class="rn">' + (i + 1) + '</span><span class="rlabel">' + escapeHtml(r[0]) + '</span>' +
      '<span class="rbar-track"><span class="rbar-fill" style="width:' + Math.round(r[1].revenue / maxRev * 100) + '%"></span></span>' +
      '<span class="rval">' + mxn(r[1].revenue) + '</span></div>'
    ).join("");

    const txs = [
      ...salesF.map(s => ({ type: "sale", id: s.id, dateStr: s.dateStr, createdAt: s.createdAt, amount: s.total, sub: (s.items || []).length + " productos · " + s.paymentMethod + (s.dueDate ? " · " + s.customer + (isPending(s) ? " (pendiente)" : " (pagado)") : "") })),
      ...expF.map(e => ({ type: "expense", id: e.id, dateStr: e.dateStr, createdAt: e.createdAt, amount: e.amount, sub: e.category, title: e.description }))
    ].sort((a, b) => b.createdAt - a.createdAt).slice(0, 80);
    document.getElementById("txEmpty").style.display = txs.length ? "none" : "block";
    document.getElementById("txList").innerHTML = txs.map(t =>
      '<div class="tx-row">' +
      '<div class="tx-icon ' + t.type + '">' + (t.type === "sale" ? "🥗" : "–") + '</div>' +
      '<div class="tx-main"><div class="tx-title">' + (t.type === "sale" ? "Venta" : escapeHtml(t.title || "Gasto")) + '</div>' +
      '<div class="tx-sub">' + fmtDateShort(t.dateStr) + ' · ' + escapeHtml(t.sub) + '</div></div>' +
      '<div class="tx-amount ' + t.type + '">' + (t.type === "expense" ? "−" : "") + mxn(t.amount) + '</div>' +
      '<button class="btn-ghost-danger" data-txdel="' + t.type + ':' + t.id + '">✕</button>' +
      '</div>'
    ).join("");
  }

  document.getElementById("txList").addEventListener("click", function (e) {
    const b = e.target.closest("button[data-txdel]");
    if (!b) return;
    const [type, id] = b.dataset.txdel.split(":");
    confirmClick(b, "¿Seguro?", async function () {
      const coll = type === "sale" ? "sales" : "expenses";
      try { await apiDelete("/" + coll + "/" + id); await loadAll(); }
      catch (err) { toast("No se pudo eliminar."); }
    });
  });

  function downloadFile(name, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  document.getElementById("btnExportCsv").addEventListener("click", function () {
    const [from, to] = periodRange();
    downloadFile("reporte_" + from + "_a_" + to + ".csv", LocalApi.csv(from, to), "text/csv;charset=utf-8");
  });

  // ================= RESPALDO =================
  document.getElementById("btnBackup").addEventListener("click", function () {
    downloadFile("respaldo_tuul_" + dstr() + ".json", JSON.stringify(LocalApi.exportAll(), null, 2), "application/json");
    toast("Respaldo descargado");
  });
  document.getElementById("btnRestore").addEventListener("click", function () {
    document.getElementById("restoreFile").click();
  });
  document.getElementById("restoreFile").addEventListener("change", function (e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function () {
      let info;
      try { info = LocalApi.preview(JSON.parse(reader.result)); }
      catch (err) { toast("El archivo no es un respaldo válido."); return; }
      const ok = confirm("Se reemplazarán TODOS tus datos actuales por el respaldo:\n\n" +
        info.products + " productos, " + info.sales + " ventas y " + info.expenses + " gastos.\n\n¿Continuar?");
      if (!ok) return;
      try {
        LocalApi.importAll(JSON.parse(reader.result));
        toast("Respaldo restaurado");
        await loadAll();
      } catch (err) { toast("No se pudo restaurar el respaldo."); }
    };
    reader.readAsText(file);
  });

  // ---------- arranque ----------
  loadAll();
  // Si abres la app en dos pestañas, se mantienen al día entre sí
  window.addEventListener("storage", function (e) { if (e.key === LocalApi.storageKey) loadAll(true); });

  // Permite instalarla como app (requiere https, como en GitHub Pages)
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  }
})();

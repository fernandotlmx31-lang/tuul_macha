/*
 * Capa de datos local de Tuul Garden Kitchen.
 *
 * Guarda todo en el navegador (localStorage) y responde a las MISMAS rutas
 * que el backend de Python (/products, /sales, /expenses, /settings), así
 * app.js no sabe si habla con el navegador o con un servidor.
 *
 * Cuando quieras pasar a un servidor real, reemplaza apiGet / apiSend en
 * app.js por llamadas fetch() y este archivo deja de usarse.
 */
(function (global) {
  "use strict";

  var KEY = "tuul_pos_v1";
  var DEFAULT_NAME = "Tuul Garden Kitchen";

  // ¿El navegador permite guardar? (falla en algunos modos privados)
  var persistent = true;
  try {
    var t = "__tuul_test__";
    global.localStorage.setItem(t, "1");
    global.localStorage.removeItem(t);
  } catch (e) { persistent = false; }
  var mem = null; // respaldo en memoria si no hay localStorage

  function emptyData() {
    return {
      v: 1,
      seq: { products: 0, sales: 0, expenses: 0 },
      products: [], sales: [], expenses: [],
      settings: { businessName: DEFAULT_NAME }
    };
  }

  function maxId(list) {
    return list.reduce(function (m, x) { return Math.max(m, Number(x.id) || 0); }, 0);
  }

  function normalize(d) {
    var base = emptyData();
    d = d && typeof d === "object" ? d : {};
    base.products = Array.isArray(d.products) ? d.products : [];
    base.sales = Array.isArray(d.sales) ? d.sales : [];
    base.expenses = Array.isArray(d.expenses) ? d.expenses : [];
    if (d.settings && d.settings.businessName) base.settings.businessName = String(d.settings.businessName);
    var s = d.seq || {};
    base.seq.products = Math.max(Number(s.products) || 0, maxId(base.products));
    base.seq.sales = Math.max(Number(s.sales) || 0, maxId(base.sales));
    base.seq.expenses = Math.max(Number(s.expenses) || 0, maxId(base.expenses));
    return base;
  }

  function load() {
    if (!persistent) { if (!mem) mem = emptyData(); return mem; }
    var raw = global.localStorage.getItem(KEY);
    if (!raw) return emptyData();
    try {
      return normalize(JSON.parse(raw));
    } catch (e) {
      // Datos dañados: se conserva una copia antes de empezar de cero
      try { global.localStorage.setItem(KEY + "_corrupto_" + Date.now(), raw); } catch (e2) {}
      return emptyData();
    }
  }

  function save(d) {
    if (!persistent) { mem = d; return; }
    try {
      global.localStorage.setItem(KEY, JSON.stringify(d));
    } catch (e) {
      throw new Error("storage_full");
    }
  }

  function todayStr() {
    var d = new Date();
    function p(n) { return String(n).padStart(2, "0"); }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function fail(code) { throw new Error(code); }

  function byCreatedAsc(a, b) { return (a.createdAt - b.createdAt) || (a.id - b.id); }
  function byCreatedDesc(a, b) { return (b.createdAt - a.createdAt) || (b.id - a.id); }

  // ---------------------------------------------------------------------
  // "Servidor" local: mismas rutas y reglas que app.py
  // ---------------------------------------------------------------------
  async function handle(method, url, body) {
    var parts = String(url).split("?")[0].split("/").filter(Boolean);
    var res = parts[0];
    var id = parts[1] !== undefined ? parseInt(parts[1], 10) : null;
    var d = load();
    body = body || {};
    var i, row;

    // ---- configuración ----
    if (res === "settings") {
      if (method === "GET") return { businessName: d.settings.businessName || DEFAULT_NAME };
      if (method === "POST") {
        var name = String(body.businessName || "").trim() || DEFAULT_NAME;
        d.settings.businessName = name;
        save(d);
        return { ok: true, businessName: name };
      }
    }

    // ---- productos ----
    if (res === "products") {
      if (method === "GET") return d.products.slice().sort(byCreatedAsc);
      if (method === "POST") {
        var pname = String(body.name || "").trim();
        var pcat = String(body.category || "Otros").trim() || "Otros";
        var pprice = Number(body.price);
        if (!pname || !isFinite(pprice) || pprice < 0) fail("invalid_data");
        row = { id: ++d.seq.products, name: pname, category: pcat, price: pprice, active: true, createdAt: Date.now() };
        d.products.push(row);
        save(d);
        return row;
      }
      if (method === "PUT" && id !== null) {
        row = d.products.find(function (x) { return x.id === id; });
        if (!row) fail("not_found");
        if (body.name !== undefined && String(body.name).trim()) row.name = String(body.name).trim();
        if (body.category !== undefined) row.category = String(body.category).trim() || "Otros";
        if (body.price !== undefined && isFinite(Number(body.price))) row.price = Number(body.price);
        if (body.active !== undefined) row.active = !!body.active;
        save(d);
        return row;
      }
      if (method === "DELETE" && id !== null) {
        d.products = d.products.filter(function (x) { return x.id !== id; });
        save(d);
        return { ok: true };
      }
    }

    // ---- ventas ----
    if (res === "sales") {
      if (method === "GET") return d.sales.slice().sort(byCreatedDesc);
      if (method === "POST") {
        var items = Array.isArray(body.items) ? body.items : [];
        if (!items.length) fail("empty_ticket");
        var total = Number(body.total);
        if (!isFinite(total)) {
          total = items.reduce(function (a, it) { return a + Number(it.price) * Number(it.qty); }, 0);
        }
        if (!isFinite(total)) fail("invalid_data");
        var pm = body.paymentMethod || "Efectivo";
        var status = "paid", customer = null, dueDate = null;
        if (pm === "Crédito") {
          customer = String(body.customer || "").trim();
          dueDate = body.dueDate || null;
          if (!customer || !dueDate) fail("credit_requires_customer_and_due_date");
          status = "pending";
        }
        row = {
          id: ++d.seq.sales,
          items: items,
          total: total,
          paymentMethod: pm,
          cashReceived: body.cashReceived != null ? body.cashReceived : null,
          change: body.change != null ? body.change : null,
          dateStr: body.dateStr || todayStr(),
          createdAt: Date.now(),
          status: status,
          customer: customer,
          dueDate: dueDate,
          paidAt: null
        };
        d.sales.push(row);
        save(d);
        return row;
      }
      if (method === "PUT" && id !== null) {
        if (body.status !== "paid" && body.status !== "pending") fail("invalid_status");
        row = d.sales.find(function (x) { return x.id === id; });
        if (!row) fail("not_found");
        if (!row.dueDate) fail("not_a_credit_sale");
        row.status = body.status;
        row.paidAt = body.status === "paid" ? Date.now() : null;
        save(d);
        return row;
      }
      if (method === "DELETE" && id !== null) {
        d.sales = d.sales.filter(function (x) { return x.id !== id; });
        save(d);
        return { ok: true };
      }
    }

    // ---- gastos ----
    if (res === "expenses") {
      if (method === "GET") return d.expenses.slice().sort(byCreatedDesc);
      if (method === "POST") {
        var desc = String(body.description || "").trim();
        var amount = Number(body.amount);
        if (!desc || !isFinite(amount) || amount <= 0) fail("invalid_data");
        row = {
          id: ++d.seq.expenses,
          description: desc,
          category: body.category || "Otros",
          amount: amount,
          dateStr: body.dateStr || todayStr(),
          createdAt: Date.now()
        };
        d.expenses.push(row);
        save(d);
        return row;
      }
      if (method === "DELETE" && id !== null) {
        d.expenses = d.expenses.filter(function (x) { return x.id !== id; });
        save(d);
        return { ok: true };
      }
    }

    fail("not_found");
  }

  // ---------------------------------------------------------------------
  // CSV del reporte
  // ---------------------------------------------------------------------
  function cell(v) {
    v = v == null ? "" : String(v);
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  function csv(from, to) {
    var d = load();
    var rows = [["tipo", "fecha", "descripcion", "categoria_o_pago", "monto", "estado", "cliente", "fecha_limite"]];
    d.sales.filter(function (s) { return s.dateStr >= from && s.dateStr <= to; })
      .sort(function (a, b) { return a.createdAt - b.createdAt; })
      .forEach(function (s) {
        var desc = (s.items || []).map(function (i) { return i.name + " x" + i.qty; }).join("; ");
        rows.push(["venta", s.dateStr, desc, s.paymentMethod, Number(s.total).toFixed(2),
          s.status === "pending" ? "pendiente" : "pagado", s.customer || "", s.dueDate || ""]);
      });
    d.expenses.filter(function (e) { return e.dateStr >= from && e.dateStr <= to; })
      .sort(function (a, b) { return a.createdAt - b.createdAt; })
      .forEach(function (e) {
        rows.push(["gasto", e.dateStr, e.description, e.category, "-" + Number(e.amount).toFixed(2), "", "", ""]);
      });
    // BOM para que Excel respete los acentos
    return "\ufeff" + rows.map(function (r) { return r.map(cell).join(","); }).join("\r\n") + "\r\n";
  }

  // ---------------------------------------------------------------------
  // Respaldo / restauración
  // ---------------------------------------------------------------------
  function exportAll() {
    return { app: "tuul-pos-web", version: 1, exportedAt: new Date().toISOString(), data: load() };
  }

  function parseBackup(obj) {
    var data = obj && obj.data ? obj.data : obj;
    if (!data || !Array.isArray(data.products) || !Array.isArray(data.sales) || !Array.isArray(data.expenses)) {
      fail("invalid_backup");
    }
    return normalize(data);
  }

  function preview(obj) {
    var d = parseBackup(obj);
    return { products: d.products.length, sales: d.sales.length, expenses: d.expenses.length };
  }

  function importAll(obj) {
    var d = parseBackup(obj);
    // Copia de seguridad de lo que había antes, por si te arrepientes
    if (persistent) {
      try {
        var prev = global.localStorage.getItem(KEY);
        if (prev) global.localStorage.setItem(KEY + "_antes_de_restaurar", prev);
      } catch (e) {}
    }
    save(d);
    return { products: d.products.length, sales: d.sales.length, expenses: d.expenses.length };
  }

  global.LocalApi = {
    handle: handle,
    csv: csv,
    exportAll: exportAll,
    preview: preview,
    importAll: importAll,
    storageKey: KEY,
    get persistent() { return persistent; }
  };
})(typeof window !== "undefined" ? window : globalThis);

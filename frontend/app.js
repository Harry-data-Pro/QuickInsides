/* =========================================================================
   Auto EDA Frontend – main JS
   ========================================================================= */

const API = ""; // same origin (FastAPI serves both)
const state = {
    datasetId: null,
    filename: null,
    info: null,
    splits: null,
    preview: null,
    currentSection: "upload",
};

// --------------------------------------------------------------------------
// Utilities
// --------------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function toast(msg, type = "info", timeout = 3500) {
    const container = $("#toastContainer");
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => el.remove(), timeout);
}

function showOverlay(text = "Loading…") {
    $("#overlayText").textContent = text;
    $("#overlay").style.display = "grid";
}
function hideOverlay() {
    $("#overlay").style.display = "none";
}

async function api(path, opts = {}) {
    const res = await fetch(API + path, {
        headers: { "Content-Type": "application/json" },
        ...opts,
    });
    if (!res.ok) {
        let detail = res.statusText;
        try {
            const data = await res.json();
            detail = data.detail || JSON.stringify(data);
        } catch {}
        throw new Error(detail);
    }
    return res.json();
}

function fmt(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return "—";
    if (Math.abs(n) >= 1000) return n.toLocaleString();
    return typeof n === "number" ? n.toFixed(3).replace(/\.?0+$/, "") : n;
}

function getSelected(select) {
    return Array.from(select.selectedOptions).map((o) => o.value);
}

// --------------------------------------------------------------------------
// Navigation
// --------------------------------------------------------------------------
function showSection(name) {
    state.currentSection = name;
    $$(".section").forEach((s) => s.classList.remove("active"));
    $(`#section-${name}`).classList.add("active");
    $$("#mainNav .nav-item").forEach((b) => {
        b.classList.toggle("active", b.dataset.section === name);
    });
    if (name === "overview")   loadOverview();
    if (name === "univariate") loadUnivariate();
    if (name === "bivariate")  loadBivariate();
    if (name === "missing")    loadMissing();
    if (name === "normalize")  loadNormalize();
    if (name === "download")
        $("#downloadBtn").href = `${API}/api/dataset/${state.datasetId}/download`;
}

function unlockNav() {
    $$("#mainNav .nav-item").forEach((b) => (b.disabled = false));
}

$$("#mainNav .nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
        if (btn.disabled) return;
        showSection(btn.dataset.section);
    });
});

// --------------------------------------------------------------------------
// File upload
// --------------------------------------------------------------------------
const dropZone = $("#dropZone");
const fileInput = $("#fileInput");

dropZone.addEventListener("click", () => fileInput.click());
["dragenter", "dragover"].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropZone.classList.add("dragover");
    })
);
["dragleave", "drop"].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
    })
);
dropZone.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
});
fileInput.addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) handleFile(f);
});

async function handleFile(file) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
        toast("Please upload a CSV file", "error");
        return;
    }
    showOverlay("Uploading & analysing…");
    const fd = new FormData();
    fd.append("file", file);
    try {
        const data = await fetch(`${API}/api/upload`, { method: "POST", body: fd }).then(async (r) => {
            if (!r.ok) {
                const e = await r.json().catch(() => ({}));
                throw new Error(e.detail || r.statusText);
            }
            return r.json();
        });
        state.datasetId = data.dataset_id;
        state.filename  = data.filename;
        state.info      = data.info;
        state.splits    = data.splits;
        state.preview   = data.preview;

        $("#fileName").textContent = data.filename;
        $("#fileMeta").textContent = `${data.info.shape.rows.toLocaleString()} rows · ${data.info.shape.cols} cols`;
        $("#datasetCard").style.display = "block";
        $("#uploadStatus").style.display = "block";
        $("#uploadBadge").textContent = "success";
        $("#uploadMessage").textContent = `Loaded ${data.filename} (${data.info.shape.rows.toLocaleString()} × ${data.info.shape.cols}).`;

        unlockNav();
        toast("Dataset loaded successfully", "success");
        showSection("overview");
    } catch (err) {
        toast("Upload failed: " + err.message, "error", 6000);
    } finally {
        hideOverlay();
    }
}


// --------------------------------------------------------------------------
// Overview
// --------------------------------------------------------------------------
async function loadOverview() {
    try {
        const data = await api(`/api/dataset/${state.datasetId}/info`);
        state.info = data.info;
        state.splits = data.splits;

        // KPIs
        const numCount  = data.splits.numeric.length;
        const catCount  = data.splits.categorical.length;
        const kpis = [
            { label: "Rows",       value: data.info.shape.rows.toLocaleString(), cls: "accent-blue" },
            { label: "Columns",    value: data.info.shape.cols,                   cls: "accent-blue" },
            { label: "Numeric",    value: numCount,                                cls: "accent-green" },
            { label: "Categorical",value: catCount,                                cls: "accent-green" },
            { label: "Missing",    value: data.info.missing_total.toLocaleString(),cls: "accent-red", sub: data.info.shape.rows ? `${((data.info.missing_total / (data.info.shape.rows * data.info.shape.cols)) * 100).toFixed(2)}% of cells` : "" },
            { label: "Duplicates", value: data.info.duplicates.toLocaleString(),   cls: "accent-amber" },
        ];
        $("#kpiGrid").innerHTML = kpis.map((k) => `
            <div class="kpi ${k.cls}">
                <div class="label">${k.label}</div>
                <div class="value">${k.value}</div>
                ${k.sub ? `<div class="sub">${k.sub}</div>` : ""}
            </div>`).join("");

        // Column table
        $("#colCount").textContent = `${data.info.shape.cols} cols`;
        const tbody = $("#colTable tbody");
        tbody.innerHTML = data.info.columns.map((c) => `
            <tr>
                <td><b>${c.name}</b></td>
                <td>${c.dtype}</td>
                <td>${c.missing} (${c.missing_pct}%)</td>
                <td>${c.unique}</td>
                <td>${fmt(c.mean)}</td>
                <td>${fmt(c.std)}</td>
                <td>${fmt(c.min)}</td>
                <td>${fmt(c.median)}</td>
                <td>${fmt(c.max)}</td>
            </tr>`).join("");

        // Preview
        const preview = await api(`/api/dataset/${state.datasetId}/preview?n=10`);
        renderTable("#previewTable", preview.headers, preview.rows);
    } catch (e) {
        toast("Failed to load overview: " + e.message, "error");
    }
}

function renderTable(sel, headers, rows) {
    const t = $(sel);
    t.innerHTML = `
        <thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c === null || c === undefined ? "—" : c}</td>`).join("")}</tr>`).join("")}</tbody>`;
}


// --------------------------------------------------------------------------
// Univariate
// --------------------------------------------------------------------------
async function loadUnivariate() {
    if (!state.datasetId) return;
    const target = $("#univariateContent");
    if (target.dataset.loaded === "1") return;
    target.innerHTML = `<div class="empty"><div class="spinner dark"></div><p>Generating charts…</p></div>`;
    try {
        const data = await api(`/api/dataset/${state.datasetId}/univariate`);
        const cols = data.columns;
        target.innerHTML = Object.entries(cols).map(([name, info]) => {
            if (info.type === "numeric") {
                return `
                <div class="column-block">
                    <h3>${name} <span class="type-tag numeric">numeric</span></h3>
                    <img class="chart-img" src="${info.histogram}" alt="histogram of ${name}" />
                    <img class="chart-img" src="${info.violin}" alt="violin of ${name}" style="margin-top:14px;" />
                    <div class="stat-pills">
                        <span class="stat-pill">mean <b>${fmt(info.stats.mean)}</b></span>
                        <span class="stat-pill">median <b>${fmt(info.stats.median)}</b></span>
                        <span class="stat-pill">std <b>${fmt(info.stats.std)}</b></span>
                        <span class="stat-pill">min <b>${fmt(info.stats.min)}</b></span>
                        <span class="stat-pill">max <b>${fmt(info.stats.max)}</b></span>
                        <span class="stat-pill">skew <b>${fmt(info.stats.skew)}</b></span>
                    </div>
                </div>`;
            } else {
                return `
                <div class="column-block">
                    <h3>${name} <span class="type-tag categorical">categorical</span></h3>
                    <div style="display:grid; grid-template-columns: 1.5fr 1fr; gap:14px;">
                        <img class="chart-img" src="${info.bar}" alt="bar chart" />
                        <img class="chart-img" src="${info.pie}" alt="pie chart" />
                    </div>
                    <div class="stat-pills">
                        ${info.counts.slice(0, 5).map((c) => `<span class="stat-pill">${c.label} <b>${c.value}</b></span>`).join("")}
                    </div>
                </div>`;
            }
        }).join("");
        target.dataset.loaded = "1";
    } catch (e) {
        target.innerHTML = `<div class="empty">Failed to render: ${e.message}</div>`;
    }
}


// --------------------------------------------------------------------------
// Bivariate
// --------------------------------------------------------------------------
async function loadBivariate() {
    if (!state.datasetId) return;
    try {
        const data = await api(`/api/dataset/${state.datasetId}/info`);
        state.splits = data.splits;
        fillSelect("#nn_x", data.splits.numeric);
        fillSelect("#nn_y", data.splits.numeric);
        fillSelect("#cc_i", data.splits.categorical);
        fillSelect("#cc_c", data.splits.categorical);
        fillSelect("#pv_i", data.info.columns.map((c) => c.name));
        fillSelect("#pv_c", data.info.columns.map((c) => c.name));
        fillSelect("#pv_v", data.splits.numeric);
    } catch (e) {
        toast("Failed: " + e.message, "error");
    }
}

function fillSelect(sel, options) {
    const el = $(sel);
    el.innerHTML = options.map((o) => `<option value="${o}">${o}</option>`).join("");
}

$$(".tab[data-bvtab]").forEach((t) =>
    t.addEventListener("click", () => {
        $$(".tab[data-bvtab]").forEach((x) => x.classList.remove("active"));
        t.classList.add("active");
        $$(".bvtab-panel").forEach((p) => (p.style.display = "none"));
        $(`.bvtab-panel[data-panel="${t.dataset.bvtab}"]`).style.display = "block";
    })
);


$("#nn_go").addEventListener("click", async () => {
    const x = $("#nn_x").value, y = $("#nn_y").value, kind = $("#nn_kind").value;
    if (!x || !y) { toast("Select two columns", "error"); return; }
    showOverlay("Rendering plot…");
    try {
        const r = await api(`/api/dataset/${state.datasetId}/bivariate/num-num`, {
            method: "POST",
            body: JSON.stringify({ x_col: x, y_col: y, kind }),
        });
        $("#nn_output").innerHTML = `<img class="chart-img" src="${r.image}" alt="plot" />`;
    } catch (e) {
        toast("Failed: " + e.message, "error");
    } finally { hideOverlay(); }
});

$("#cc_go").addEventListener("click", async () => {
    const i = $("#cc_i").value, c = $("#cc_c").value;
    if (!i || !c) { toast("Select two columns", "error"); return; }
    showOverlay("Computing crosstab…");
    try {
        const r = await api(`/api/dataset/${state.datasetId}/bivariate/cat-cat`, {
            method: "POST",
            body: JSON.stringify({ index_col: i, column_col: c }),
        });
        if (!r.crosstab.length) { $("#cc_output").innerHTML = `<div class="empty">No data</div>`; return; }
        const headers = Object.keys(r.crosstab[0]);
        const wrap = document.createElement("div");
        wrap.className = "table-wrap";
        const tbl = document.createElement("table");
        tbl.innerHTML = `<thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>`;
        const tbody = document.createElement("tbody");
        r.crosstab.forEach((row) => {
            const tr = document.createElement("tr");
            headers.forEach((h) => {
                const td = document.createElement("td");
                const v = row[h];
                td.textContent = v === undefined || v === null ? "—" : v;
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        tbl.appendChild(tbody);
        wrap.appendChild(tbl);
        $("#cc_output").innerHTML = "";
        $("#cc_output").appendChild(wrap);
    } catch (e) {
        toast("Failed: " + e.message, "error");
    } finally { hideOverlay(); }
});


$("#pv_go").addEventListener("click", async () => {
    const idx  = getSelected($("#pv_i"));
    const cols = getSelected($("#pv_c"));
    const vals = getSelected($("#pv_v"));
    const agg  = $("#pv_agg").value;
    if (!vals.length) { toast("Select at least one value column", "error"); return; }
    showOverlay("Computing pivot…");
    try {
        const r = await api(`/api/dataset/${state.datasetId}/bivariate/pivot`, {
            method: "POST",
            body: JSON.stringify({ index_cols: idx, column_cols: cols, value_cols: vals, aggfunc: agg }),
        });
        if (!r.values.length) { $("#pv_output").innerHTML = `<div class="empty">No data</div>`; return; }
        const headers = ["index", ...r.columns];
        const rows = r.index.map((i, k) => [i, ...r.values[k]]);
        const wrap = document.createElement("div");
        wrap.className = "table-wrap";
        const tbl = document.createElement("table");
        tbl.innerHTML = `<thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>`;
        const tbody = document.createElement("tbody");
        rows.forEach((row) => {
            const tr = document.createElement("tr");
            row.forEach((c) => {
                const td = document.createElement("td");
                td.textContent = fmt(c);
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        tbl.appendChild(tbody);
        wrap.appendChild(tbl);
        $("#pv_output").innerHTML = "";
        $("#pv_output").appendChild(wrap);
    } catch (e) {
        toast("Failed: " + e.message, "error");
    } finally { hideOverlay(); }
});


// --------------------------------------------------------------------------
// Missing values
// --------------------------------------------------------------------------
async function loadMissing() {
    if (!state.datasetId) return;
    const target = $("#missingContent");
    if (target.dataset.loaded === "1") return;
    try {
        const data = await api(`/api/dataset/${state.datasetId}/info`);
        const missingCols = data.info.columns.filter((c) => c.missing > 0);
        if (!missingCols.length) {
            target.innerHTML = `<div class="empty" style="padding:30px;">No missing values found 🎉</div>`;
            $("#applyMissing").style.display = "none";
            target.dataset.loaded = "1";
            return;
        }
        const isNum = (dtype) => ["int64", "float64", "float32", "int32"].includes(dtype);
        const numStrat = ["Do Nothing", "Fill with Mean (Average)", "Fill with Median (Middle Value)", "Fill with Zero (0)", "Drop Rows"];
        const catStrat = ["Do Nothing", "Fill with Mode (Most Frequent)", "Fill as 'Unknown'", "Drop Rows"];
        target.innerHTML = missingCols.map((c) => {
            const opts = isNum(c.dtype) ? numStrat : catStrat;
            return `
                <div class="strategy-row">
                    <div class="col-name">${c.name} <span class="type-tag ${isNum(c.dtype) ? "numeric" : "categorical"}">${isNum(c.dtype) ? "num" : "cat"}</span></div>
                    <div class="col-stats">${c.missing} missing · ${c.dtype}</div>
                    <select data-col="${c.name}">
                        ${opts.map((o) => `<option value="${o}">${o}</option>`).join("")}
                    </select>
                </div>`;
        }).join("");
        target.dataset.loaded = "1";
    } catch (e) {
        toast("Failed: " + e.message, "error");
    }
}

$("#applyMissing").addEventListener("click", async () => {
    const strategies = {};
    $$("#missingContent select[data-col]").forEach((sel) => {
        strategies[sel.dataset.col] = sel.value;
    });
    showOverlay("Imputing missing values…");
    try {
        const r = await api(`/api/dataset/${state.datasetId}/missing`, {
            method: "POST",
            body: JSON.stringify({ strategies }),
        });
        state.info = r.info; state.splits = r.splits; state.preview = r.preview;
        $("#missingLog").style.display = "block";
        const headers = ["Column", "Strategy", "Missing Before", "Missing After", "Rows Dropped"];
        renderTable("#missingTable", headers, r.log.map((l) => [
            l.column, l.strategy, l.missing_before, l.missing_after, l.rows_dropped
        ]));
        toast("Missing values handled", "success");
        $("#univariateContent").dataset.loaded = "";
    } catch (e) {
        toast("Failed: " + e.message, "error");
    } finally { hideOverlay(); }
});


// --------------------------------------------------------------------------
// Outliers
// --------------------------------------------------------------------------
$("#applyIQR").addEventListener("click", async () => {
    showOverlay("Removing outliers…");
    try {
        const r = await api(`/api/dataset/${state.datasetId}/outliers`, {
            method: "POST",
            body: JSON.stringify({ columns: null }),
        });
        state.info = r.info; state.splits = r.splits; state.preview = r.preview;
        $("#iqrSummary").style.display = "block";
        const target = $("#iqrContent");
        target.innerHTML = r.summary.map((s) => {
            const diffRows = Object.entries(s.diff).map(([k, v]) => `<tr><td>${k}</td><td>${fmt(v)}</td></tr>`).join("");
            return `
                <div class="column-block" style="margin-bottom:14px;">
                    <h3>${s.column} <span class="type-tag numeric">${s.removed_pct}% removed</span></h3>
                    <div class="stat-pills" style="margin-bottom:10px;">
                        <span class="stat-pill">Lower bound <b>${fmt(s.lower_bound)}</b></span>
                        <span class="stat-pill">Upper bound <b>${fmt(s.upper_bound)}</b></span>
                    </div>
                    <div class="table-wrap">
                        <table>
                            <thead><tr><th>Statistic</th><th>Change (old − new)</th></tr></thead>
                            <tbody>${diffRows}</tbody>
                        </table>
                    </div>
                </div>`;
        }).join("");
        toast("Outliers removed", "success");
        $("#univariateContent").dataset.loaded = "";
    } catch (e) {
        toast("Failed: " + e.message, "error");
    } finally { hideOverlay(); }
});


// --------------------------------------------------------------------------
// Normalize
// --------------------------------------------------------------------------
async function loadNormalize() {
    if (!state.datasetId) return;
    const target = $("#normalizeContent");
    if (target.dataset.loaded === "1") return;
    try {
        const data = await api(`/api/dataset/${state.datasetId}/info`);
        const isNum = (dtype) => ["int64", "float64", "float32", "int32"].includes(dtype);
        const numCols = data.info.columns.filter((c) => isNum(c.dtype));
        const opts = ["Do Nothing", "MinMaxScaler", "StandardScaler"];
        target.innerHTML = numCols.map((c) => `
            <div class="strategy-row">
                <div class="col-name">${c.name} <span class="type-tag numeric">numeric</span></div>
                <div class="col-stats">mean ${fmt(c.mean)} · std ${fmt(c.std)}</div>
                <select data-col="${c.name}">
                    ${opts.map((o) => `<option value="${o}">${o}</option>`).join("")}
                </select>
            </div>`).join("");
        target.dataset.loaded = "1";
    } catch (e) {
        toast("Failed: " + e.message, "error");
    }
}

$("#applyNormalize").addEventListener("click", async () => {
    const strategies = {};
    $$("#normalizeContent select[data-col]").forEach((sel) => {
        strategies[sel.dataset.col] = sel.value;
    });
    showOverlay("Normalising features…");
    try {
        const r = await api(`/api/dataset/${state.datasetId}/normalize`, {
            method: "POST",
            body: JSON.stringify({ strategies }),
        });
        state.info = r.info; state.splits = r.splits; state.preview = r.preview;
        $("#normalizeLog").style.display = "block";
        const out = $("#normalizeContent_out");
        out.innerHTML = r.log.map((l) => {
            if (l.strategy === "Do Nothing") {
                return `<div class="strategy-row"><div class="col-name">${l.column}</div><div class="col-stats">No scaling applied</div><div></div></div>`;
            }
            return `
                <div class="column-block" style="margin-bottom:14px;">
                    <h3>${l.column} <span class="type-tag numeric">${l.strategy}</span></h3>
                    <img class="chart-img" src="${l.comparison}" alt="before vs after" />
                </div>`;
        }).join("");
        toast("Normalisation applied", "success");
        $("#univariateContent").dataset.loaded = "";
    } catch (e) {
        toast("Failed: " + e.message, "error");
    } finally { hideOverlay(); }
});







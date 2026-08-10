// ==UserScript==
// @name         YOS & SPLUNK Sync Overlay - SIDEBAR INTEGRATION 8.4
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  Pulsante "S" integrato nella barra laterale di YOS. Cambia colore (Verde/Giallo/Rosso) e apre un mini-popup.
// @author       Lorenzo Scurati
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @updateURL    https://raw.githubusercontent.com/LorenzoScurati/publicfede/main/YOS_CHUTE_SPLUNK.user.js
// @downloadURL  https://raw.githubusercontent.com/LorenzoScurati/publicfede/main/YOS_CHUTE_SPLUNK.user.js
// @grant        GM_cookie
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      ot-splunk1.corp.ds.fedex.com
// ==/UserScript==

(function () {
    'use strict';

    const SPLUNK_HOST = "https://ot-splunk1.corp.ds.fedex.com";
    const IS_YOS = window.location.hostname.includes("yos.apps.tnt.com");

    // Elenco Chute
    const ELENCO_CHUTE_TEORICHE = [
        "QAL", "MZ1", "MLA", "PSA", "TO1", "GOA", "IOE", "QVA",
        "BEA", "VBS", "VBS DOM", "REM", "CUF", "IIM", "QZR",
        "VNZ", "BO1", "HNJ", "FIA", "93A", "NC3", "QPZ", "QPA",
        "TV1", "ILJ", "MM1 DOM", "MM1 INT", "ICM", "BRG", "RNV",
        "ISV", "OS3", "AOT", "SKG GRE",
        "IPO", "BA5", "BZQ", "AN6", "ATHC", "DZ5", "RMZ", "PD2",
        "IBU", "DFT", "BO2", "TEST"
    ];

    let cacheDestinazioni = [];
    let statoAttuale = "Avvio in corso...";

    // ============================================================
    // QUERY SPLUNK DINAMICA
    // ============================================================
    function getSplunkQuery(minuti) {
        return `search index=uDS_application site="IMRH" Event=SortReport earliest=-${minuti}m latest=now
| rex field=_raw "Data=(?<json>\\{.*\\})"
| spath input=json
| eval record_type="SORT"
| search ActualDestination!="999999" AND RejectReason=null
| fields _time Barcode ActualDestination SortedByRule record_type

| append [
    search index=uDS_application site="IMRH" Event=RfLoadingValidationRequest* earliest=-${minuti}m latest=now
    | rex field=_raw "HuBarcode=(?<Barcode>[^;]+)"
    | eval record_type="RF"
    | fields _time Barcode record_type
]

| append [
    search index=uDS_application site="IMRH" Event=ChuteScanningOrchestrator Action=ReceiveResponse earliest=-${minuti}m latest=now
    | rex field=_raw "(?i)PackageBarcode\\":\\"(?<Barcode>[^\\"]+)"
    | rex field=_raw "(?i)ResponseBody=\\{[^\\}]*\\"status\\":\\"(?<Status>[^\\"]+)\\""
    | search Status="SUCCESS"
    | eval record_type="CHUTE"
    | fields _time Barcode record_type
]

| sort 0 - _time
| dedup Barcode record_type
| stats
    min(eval(if(record_type="SORT",  _time, null())))  AS SortTime
    min(eval(if(record_type="RF",    _time, null())))  AS RFTime
    min(eval(if(record_type="CHUTE", _time, null())))  AS ChuteTime
    values(ActualDestination) AS ActualDestination
    values(SortedByRule)      AS SortedByRule
  BY Barcode
| eval
    Chute_Flag = if(isnotnull(ChuteTime), 1, 0)
| stats
    sum(Chute_Flag)      AS Chute_Count
    values(SortedByRule) AS SortedByRule
  BY ActualDestination
| where Chute_Count > 0
| eval SortedByRule = mvjoin(SortedByRule, ", ")
| rename ActualDestination AS Destination
| rename SortedByRule AS Rules
| table Destination Rules`;
    }

    // ============================================================
    // MOTORE API SPLUNK
    // ============================================================

    function gmRequest(dettagli) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== "function") { reject(new Error("GM_xmlhttpRequest non disponibile.")); return; }
            GM_xmlhttpRequest(Object.assign({
                timeout: 60000,
                anonymous: false,
                withCredentials: true
            }, dettagli, {
                onload: (res) => resolve(res),
                onerror: () => reject(new Error("Richiesta di rete bloccata.")),
                ontimeout: () => reject(new Error("Timeout (60s)."))
            }));
        });
    }

    function ottieniCsrfSplunk() {
        return new Promise((resolve) => {
            if (typeof GM_cookie === "undefined" || typeof GM_cookie.list !== "function") { resolve({ valore: null }); return; }
            GM_cookie.list({ url: SPLUNK_HOST + "/" }, (cookies, error) => {
                if (error || !cookies) { resolve({ valore: null }); return; }
                const c = cookies.find((k) => /csrf/i.test(k.name));
                resolve({ valore: c ? c.value : null });
            });
        });
    }

    async function pulisciJobSplunkVecchi(csrfInfo) {
        const headers = { "X-Requested-With": "XMLHttpRequest" };
        if (csrfInfo.valore) headers["X-Splunk-Form-Key"] = csrfInfo.valore;
        try {
            const res = await gmRequest({
                method: "GET",
                url: SPLUNK_HOST + "/en-US/splunkd/__raw/services/search/jobs?output_mode=json&count=0",
                headers: headers
            });
            const dati = JSON.parse(res.responseText);
            const sids = (dati.entry || []).map((e) => e.name).filter(Boolean);
            for (const sid of sids) {
                await gmRequest({ method: "DELETE", url: SPLUNK_HOST + "/en-US/splunkd/__raw/services/search/jobs/" + encodeURIComponent(sid), headers: headers });
            }
        } catch (e) {}
    }

    async function recuperaDatiDaSplunk() {
        const minuti = GM_getValue('splunk_api_minutes', "90");
        const querySplunk = getSplunkQuery(minuti);
        const corpo = "output_mode=json&search=" + encodeURIComponent(querySplunk);

        const csrfInfo = await ottieniCsrfSplunk();
        await pulisciJobSplunkVecchi(csrfInfo);

        const headers = { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" };
        if (csrfInfo.valore) headers["X-Splunk-Form-Key"] = csrfInfo.valore;

        const res = await gmRequest({
            method: "POST",
            url: SPLUNK_HOST + "/en-US/splunkd/__raw/services/search/jobs/export",
            headers: headers,
            data: corpo
        });

        if (res.status === 401 || res.status === 403) throw new Error("Credenziali scadute. Loggati di nuovo su Splunk.");
        if (res.status < 200 || res.status >= 300) throw new Error(`Errore Server (${res.status})`);
        if (res.responseText && res.responseText.trim().startsWith("<html")) throw new Error("Sessione scaduta.");

        const destinazioniTrovate = [];
        let contatoreRighe = 0;
        let erroreSplunk = null;

        res.responseText.split("\n").filter(Boolean).forEach((riga) => {
            try {
                const obj = JSON.parse(riga);
                if (obj.messages && Array.isArray(obj.messages)) {
                    const fatal = obj.messages.find(m => m.type === "FATAL" || m.type === "ERROR");
                    if (fatal) erroreSplunk = fatal.text;
                }

                const r = obj && obj.result;
                if (!r) return;

                contatoreRighe++;
                const ruleString = r.Rules || r.Destination || r.rules;
                if (ruleString) {
                    const parts = ruleString.split(',').map(p => p.trim()).filter(Boolean);
                    destinazioniTrovate.push(...parts);
                }
            } catch (e) {}
        });

        if (erroreSplunk) throw new Error("Errore SPL: " + erroreSplunk);

        cacheDestinazioni = [...new Set(destinazioniTrovate)];
        statoAttuale = `OK: ${cacheDestinazioni.length} rotte in ${minuti}m`;
    }

    // ============================================================
    // LATO GRAFICO (Colorazione Chute)
    // ============================================================

    function sanitize(str) {
        if (!str) return "";
        return String(str).replace(/[^A-Z0-9]/ig, '').toUpperCase();
    }

    function isLenientMatch(yosCode, targetCode) {
        if (yosCode === targetCode) return true;
        if (targetCode.length >= 3 && yosCode.startsWith(targetCode)) return true;
        if (yosCode.length >= 3 && targetCode.startsWith(yosCode)) return true;
        return false;
    }

    function applyYosSplunkColors() {
        const dockingBgs = document.querySelectorAll('.docking_bg, .reverse_docking_bg');
        if (!dockingBgs.length || cacheDestinazioni.length === 0) return;

        const splunkDestinations = cacheDestinazioni.map(sanitize);
        const teoriche = ELENCO_CHUTE_TEORICHE.map(sanitize);

        dockingBgs.forEach(dockingBg => {
            const doorSpan = dockingBg.querySelector('.door_number span, .reverse_door_number span');
            if (!doorSpan) return;

            const bayNum = parseInt(doorSpan.textContent.trim(), 10);
            if (isNaN(bayNum) || bayNum < 300 || bayNum > 499) return;

            const destDiv = dockingBg.querySelector('.assign_text, .reverse_assign_text');
            if (!destDiv) return;

            const destName = (destDiv.textContent || '').trim().toUpperCase();
            if (!destName) return;

            let possibleMatches = [sanitize(destName)];

            if (destName.length >= 3) {
                const base = destName.slice(0, -1);
                const suffix = destName.slice(-1);
                if (suffix === 'D') possibleMatches.push(sanitize(base + ' DOM'));
                else if (suffix === 'I') possibleMatches.push(sanitize(base + ' INT'));
            }

            const isPresentInSplunk = possibleMatches.some(pm => splunkDestinations.some(val => isLenientMatch(pm, val)));
            const isPresentInTeorico = possibleMatches.some(pm => teoriche.some(val => isLenientMatch(pm, val)));

            if (isPresentInSplunk) {
                dockingBg.style.boxShadow = 'inset 0 0 0 5px #28a745'; // Verde
            } else if (isPresentInTeorico) {
                dockingBg.style.boxShadow = 'inset 0 0 0 5px #dc3545'; // Rosso
            } else {
                dockingBg.style.boxShadow = 'inset 0 0 0 5px #ffc107'; // Giallo
            }
        });
    }

    // ============================================================
    // SIDEBAR MENU INJECTION
    // ============================================================

    function injectSidebarButton() {
        const menuPanel = document.querySelector('.cc-hub-menu-panel');
        if (!menuPanel) return false;

        // Evita duplicati
        if (document.getElementById('tnt-splunk-sidebar-wrapper')) return true;

        const wrapper = document.createElement('div');
        wrapper.id = 'tnt-splunk-sidebar-wrapper';
        wrapper.style.position = 'relative';
        wrapper.style.marginTop = '10px';

        // Il pulsante a forma di S
        const btn = document.createElement('div');
        btn.id = 'tnt-splunk-s-btn';
        btn.className = 'yos-custom-sidebar-btn';
        btn.title = 'Splunk Sync';
        btn.style.cssText = 'display:flex; justify-content:center; align-items:center; width:34px; height:34px; border-radius:5px; font-weight:900; font-size:18px; color:white; cursor:pointer; background:#ffc107; transition:background 0.3s; margin:0 auto; font-family:Roboto,sans-serif; user-select:none; box-shadow: 0 2px 4px rgba(0,0,0,0.3);';
        btn.innerText = 'S';

        // Il Popup Nascosto
        const popup = document.createElement('div');
        popup.id = 'tnt-splunk-popup';
        popup.style.cssText = 'display:none; position:absolute; left:55px; top:-30px; background:#1c1c1e; border:1px solid #333; border-radius:8px; padding:12px; width:170px; box-shadow:0 6px 15px rgba(0,0,0,0.6); z-index:999999; color:#f2f2f2; font-family:Roboto,sans-serif;';

        const minSelezionati = GM_getValue('splunk_api_minutes', "90");
        let opzioniHtml = '';
        [5, 10, 20, 30, 60, 90, 120, 180].forEach(m => {
            opzioniHtml += `<option value="${m}" ${minSelezionati == m ? 'selected' : ''}>Ultime ${m} min</option>`;
        });

        popup.innerHTML = `
            <div style="font-size:13px; font-weight:bold; margin-bottom:8px; color:#8B5CF6; border-bottom: 1px solid #333; padding-bottom: 5px;">Splunk Sync</div>
            <div id="tnt-splunk-popup-status" style="font-size:11px; margin-bottom:10px; color:#c7c7cc; line-height:1.4;">${statoAttuale}</div>
            <select id="tnt-splunk-popup-time" style="width:100%; padding:6px; border-radius:4px; background:#2e2e31; color:white; border:1px solid #444; margin-bottom:10px; outline:none; font-size:11px; cursor:pointer;">
                ${opzioniHtml}
            </select>
            <button id="tnt-splunk-popup-force" style="width:100%; padding:8px; border:none; border-radius:4px; background:#FF7A00; color:#1c1c1e; cursor:pointer; font-weight:bold; font-size:12px; transition: opacity 0.2s;">Aggiorna Ora</button>
        `;

        wrapper.appendChild(btn);
        wrapper.appendChild(popup);
        menuPanel.appendChild(wrapper);

        // Gestione Click
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
        });

        // Cambio minuti
        document.getElementById('tnt-splunk-popup-time').addEventListener('change', (e) => {
            GM_setValue('splunk_api_minutes', e.target.value);
            lanciaAggiornamentoUI();
        });

        // Forza Aggiornamento
        const forceBtn = document.getElementById('tnt-splunk-popup-force');
        forceBtn.addEventListener('click', () => {
            lanciaAggiornamentoUI();
        });

        // Chiudi popup cliccando fuori
        document.addEventListener('click', (e) => {
            if (!wrapper.contains(e.target)) {
                popup.style.display = 'none';
            }
        });

        return true;
    }

    function updateIconStatus() {
        const btn = document.getElementById('tnt-splunk-s-btn');
        const popupStatus = document.getElementById('tnt-splunk-popup-status');
        const forceBtn = document.getElementById('tnt-splunk-popup-force');

        if (!btn) return;

        btn.title = statoAttuale;
        if (popupStatus) popupStatus.innerText = statoAttuale;

        if (statoAttuale.includes("OK")) {
            btn.style.background = "#34C759"; // Verde iOS
            btn.style.color = "#ffffff";
        } else if (statoAttuale.includes("Errore") || statoAttuale.includes("scaduta")) {
            btn.style.background = "#E24B4A"; // Rosso
            btn.style.color = "#ffffff";
        } else {
            btn.style.background = "#FAC775"; // Giallo
            btn.style.color = "#1c1c1e"; // Testo scuro per contrasto
        }

        if (forceBtn) {
            if (statoAttuale.includes("Interrogazione") || statoAttuale.includes("Ricerca")) {
                forceBtn.style.opacity = '0.5';
                forceBtn.disabled = true;
                forceBtn.innerText = 'Attendere...';
            } else {
                forceBtn.style.opacity = '1';
                forceBtn.disabled = false;
                forceBtn.innerText = 'Aggiorna Ora';
            }
        }
    }

    // ============================================================
    // GESTIONE SINCRONIZZAZIONE
    // ============================================================

    async function lanciaAggiornamentoUI() {
        statoAttuale = "Interrogazione in corso...";
        updateIconStatus();

        const slowTimer = setTimeout(() => {
            if (statoAttuale === "Interrogazione in corso...") {
                statoAttuale = "Ricerca Splunk (attendi)...";
                updateIconStatus();
            }
        }, 8000);

        try {
            await recuperaDatiDaSplunk();
            applyYosSplunkColors();
        } catch (e) {
            statoAttuale = "Errore: " + (e.message || "Sconosciuto");
            console.error("[SPLUNK API SYNC ERROR]", e);
        } finally {
            clearTimeout(slowTimer);
            updateIconStatus();
        }
    }

    // ============================================================
    // BOOTSTRAP
    // ============================================================

    if (IS_YOS) {
        setInterval(() => {
            const isPlanciaAttiva = document.querySelectorAll('.docking_door_area').length > 0;
            const menuPanel = document.querySelector('.cc-hub-menu-panel');
            const wrapper = document.getElementById('tnt-splunk-sidebar-wrapper');

            // Se usciamo dalla plancia, nascondi l'icona
            if (!isPlanciaAttiva) {
                if (wrapper) wrapper.style.display = 'none';
                return;
            }

            // Se siamo in plancia ma il bottone non c'è, lo iniettiamo e facciamo il primo avvio
            if (menuPanel && !wrapper) {
                injectSidebarButton();
                lanciaAggiornamentoUI();
            } else if (wrapper) {
                wrapper.style.display = 'block';
                applyYosSplunkColors();
            }

        }, 1000);

        // Ciclo di auto-refresh in background (ogni 30 secondi)
        setInterval(() => {
            if (document.querySelectorAll('.docking_door_area').length > 0) {
                lanciaAggiornamentoUI();
            }
        }, 30000);
    }

})();


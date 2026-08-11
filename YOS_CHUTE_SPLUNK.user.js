// ==UserScript==
// @name         YOS & SPLUNK Sync Overlay - SIDEBAR INTEGRATION 2.2
// @namespace    http://tampermonkey.net/
// @version      2.2
// @description  Pulsante "S" integrato. Auto-login SSO Splunk in background tramite tab temporanea.
// @author       Lorenzo Scurati
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @updateURL    https://raw.githubusercontent.com/LorenzoScurati/publicfede/main/YOS_CHUTE_SPLUNK.user.js
// @downloadURL  https://raw.githubusercontent.com/LorenzoScurati/publicfede/main/YOS_CHUTE_SPLUNK.user.js
// @grant        GM_cookie
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      ot-splunk1.corp.ds.fedex.com
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    // 1. CONFIGURAZIONE E COSTANTI
    // ============================================================
    const CONFIG = {
        SPLUNK_HOST: "https://ot-splunk1.corp.ds.fedex.com",
        IS_YOS: window.location.hostname.includes("yos.apps.tnt.com"),
        REFRESH_UI_MS: 1000,
        REFRESH_API_MS: 30000,
        SSO_TIMEOUT_MS: 15000, // Tempo (in millisecondi) per lasciar completare i redirect di login
        COLORS: {
            CHUTE_MATCH: '#28a745',
            CHUTE_THEORY: '#dc3545',
            CHUTE_UNKNOWN: '#ffc107',
            BTN_OK: '#2E7D32',
            BTN_ERR: '#C62828',
            BTN_WARN: '#555555',
            BTN_LOADING: '#D97706',
            ACCENT: '#8B5CF6'
        }
    };

    const sanitize = (str) => str ? String(str).replace(/[^A-Z0-9]/ig, '').toUpperCase() : "";

    const CHUTE_TEORICHE_SANITIZED = [
        "QAL", "MZ1", "MLA", "PSA", "TO1", "GOA", "IOE", "QVA",
        "BEA", "VBS", "VBS DOM", "REM", "CUF", "IIM", "QZR",
        "VNZ", "BO1", "HNJ", "FIA", "93A", "NC3", "QPZ", "QPA",
        "TV1", "ILJ", "MM1 DOM", "MM1 INT", "ICM", "BRG", "RNV",
        "ISV", "OS3", "AOT", "SKG GRE", "IPO", "BA5", "BZQ",
        "AN6", "ATHC", "DZ5", "RMZ", "PD2", "IBU", "DFT", "BO2", "TEST"
    ].map(sanitize);

    let splunkDestinationsSanitized = [];
    let statoAttuale = "Avvio in corso...";
    let ssoTentatoOggi = false; // Flag per evitare loop di aperture infinite

    if (!CONFIG.IS_YOS) return;

    // ============================================================
    // 2. INIEZIONE STILI CSS AVANZATI
    // ============================================================
    function injectCustomCSS() {
        if (document.getElementById('tnt-splunk-styles')) return;
        const style = document.createElement('style');
        style.id = 'tnt-splunk-styles';
        style.textContent = `
            .yos-custom-s-btn {
                display: flex; justify-content: center; align-items: center;
                width: 42px; height: 42px; border-radius: 8px;
                font-weight: 700; font-size: 20px; color: white;
                cursor: pointer; margin: 8px auto;
                font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                user-select: none; box-shadow: 0 2px 4px rgba(0,0,0,0.4);
                transition: transform 0.15s ease, filter 0.15s ease, background 0.3s ease;
            }
            .yos-custom-s-btn:hover { transform: scale(1.05); filter: brightness(1.15); box-shadow: 0 4px 8px rgba(0,0,0,0.5); }
            .yos-splunk-popup {
                display: none; position: absolute; left: 60px; top: -40px;
                background: #252526; border: 1px solid #444; border-radius: 10px;
                padding: 18px; width: 250px; box-shadow: 0 10px 30px rgba(0,0,0,0.6);
                z-index: 999999; color: #f2f2f2; font-family: 'Segoe UI', Roboto, sans-serif;
            }
            .yos-splunk-popup-header {
                font-size: 15px; font-weight: 700; color: ${CONFIG.COLORS.ACCENT};
                border-bottom: 1px solid #444; padding-bottom: 8px; margin-bottom: 12px;
            }
            .yos-splunk-status { font-size: 13px; margin-bottom: 14px; color: #d4d4d4; line-height: 1.5; }
            .yos-splunk-select {
                width: 100%; padding: 10px; border-radius: 6px; background: #1e1e1e; color: white;
                border: 1px solid #555; margin-bottom: 14px; font-size: 13px; cursor: pointer;
                outline: none; appearance: auto; transition: border-color 0.2s;
            }
            .yos-splunk-select:focus { border-color: ${CONFIG.COLORS.ACCENT}; }
            .yos-splunk-force-btn {
                width: 100%; padding: 10px; border: none; border-radius: 6px;
                background: ${CONFIG.COLORS.ACCENT}; color: white; cursor: pointer;
                font-weight: bold; font-size: 14px; transition: background 0.2s ease, opacity 0.2s ease;
            }
            .yos-splunk-force-btn:hover:not(:disabled) { background: #7C3AED; }
            .yos-splunk-force-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        `;
        document.head.appendChild(style);
    }

    // ============================================================
    // 3. QUERY SPLUNK DINAMICA
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
| eval Chute_Flag = if(isnotnull(ChuteTime), 1, 0)
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
    // 4. MOTORE API & AUTO-LOGIN SSO
    // ============================================================
    function gmRequest(dettagli) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== "function") return reject(new Error("GM_xmlhttpRequest non disponibile."));
            GM_xmlhttpRequest({
                timeout: 60000, anonymous: false, withCredentials: true, ...dettagli,
                onload: resolve, onerror: () => reject(new Error("Rete bloccata.")), ontimeout: () => reject(new Error("Timeout (60s)."))
            });
        });
    }

    function ottieniCsrfSplunk() {
        return new Promise((resolve) => {
            if (typeof GM_cookie === "undefined" || typeof GM_cookie.list !== "function") return resolve({ valore: null });
            GM_cookie.list({ url: CONFIG.SPLUNK_HOST + "/" }, (cookies, error) => {
                if (error || !cookies) return resolve({ valore: null });
                const c = cookies.find((k) => /csrf/i.test(k.name));
                resolve({ valore: c ? c.value : null });
            });
        });
    }

    // Apre Splunk di nascosto, aspetta il tempo di login e chiude
    async function eseguiLoginAutomatico() {
        return new Promise((resolve) => {
            statoAttuale = `🔄 Autenticazione SSO (${CONFIG.SSO_TIMEOUT_MS/1000}s)...`;
            updateIconStatus();

            let authTab = null;
            try {
                // background tab
                authTab = GM_openInTab(CONFIG.SPLUNK_HOST + "/en-US/app/launcher/home", { active: false, insert: true });
            } catch (e) {
                console.error("Popup bloccato dal browser. Consenti i popup per YOS.", e);
                resolve(false);
                return;
            }

            // Aspetta i secondi definiti e poi tenta di chiudere la tab
            setTimeout(() => {
                try {
                    if (authTab && typeof authTab.close === 'function') {
                        authTab.close();
                    }
                } catch(e) {} // Ignora se la tab è già chiusa dall'utente
                resolve(true);
            }, CONFIG.SSO_TIMEOUT_MS);
        });
    }

    async function pulisciJobSplunkVecchi(csrfInfo) {
        const headers = { "X-Requested-With": "XMLHttpRequest" };
        if (csrfInfo.valore) headers["X-Splunk-Form-Key"] = csrfInfo.valore;
        try {
            const res = await gmRequest({ method: "GET", url: `${CONFIG.SPLUNK_HOST}/en-US/splunkd/__raw/services/search/jobs?output_mode=json&count=0`, headers });
            const dati = JSON.parse(res.responseText);
            const sids = (dati.entry || []).map((e) => e.name).filter(Boolean);
            await Promise.all(sids.map(sid => gmRequest({ method: "DELETE", url: `${CONFIG.SPLUNK_HOST}/en-US/splunkd/__raw/services/search/jobs/${encodeURIComponent(sid)}`, headers }).catch(() => {})));
        } catch (e) {}
    }

    async function recuperaDatiDaSplunk(isRetry = false) {
        let csrfInfo = await ottieniCsrfSplunk();

        // LOGICA DI AUTO-LOGIN: Se non abbiamo il cookie, avvia la procedura in background
        if (!csrfInfo.valore && !isRetry && !ssoTentatoOggi) {
            ssoTentatoOggi = true;
            await eseguiLoginAutomatico();
            csrfInfo = await ottieniCsrfSplunk(); // Ricarichiamo il cookie dopo l'attesa
        }

        await pulisciJobSplunkVecchi(csrfInfo);

        const minuti = GM_getValue('splunk_api_minutes', "90");
        const querySplunk = getSplunkQuery(minuti);
        const corpo = `output_mode=json&search=${encodeURIComponent(querySplunk)}`;

        const headers = { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" };
        if (csrfInfo.valore) headers["X-Splunk-Form-Key"] = csrfInfo.valore;

        const res = await gmRequest({ method: "POST", url: `${CONFIG.SPLUNK_HOST}/en-US/splunkd/__raw/services/search/jobs/export`, headers, data: corpo });

        // Se l'API ci rimbalza (401/403 o pagina HTML di login) anche se avevamo il cookie
        if (res.status === 401 || res.status === 403 || (res.responseText && res.responseText.trim().startsWith("<html"))) {
            if (!isRetry && !ssoTentatoOggi) {
                ssoTentatoOggi = true;
                await eseguiLoginAutomatico();
                return recuperaDatiDaSplunk(true); // Riprova in ricorsione una sola volta
            } else {
                throw new Error("SSO Fallito. Apri Splunk manualmente e riprova.");
            }
        }

        if (res.status < 200 || res.status >= 300) throw new Error(`Errore Server (${res.status})`);

        const destinazioniTrovate = [];
        let erroreSplunk = null;

        const lines = res.responseText.split("\n");
        for (const riga of lines) {
            if (!riga) continue;
            try {
                const obj = JSON.parse(riga);
                if (obj.messages && Array.isArray(obj.messages)) {
                    const fatal = obj.messages.find(m => m.type === "FATAL" || m.type === "ERROR");
                    if (fatal) erroreSplunk = fatal.text;
                }
                const r = obj.result;
                if (!r) continue;
                const ruleString = r.Rules || r.Destination || r.rules;
                if (ruleString) {
                    const parts = ruleString.split(',').map(p => p.trim()).filter(Boolean);
                    destinazioniTrovate.push(...parts);
                }
            } catch (e) {}
        }

        if (erroreSplunk) throw new Error(`Errore SPL: ${erroreSplunk}`);
        const uniqueDestinations = [...new Set(destinazioniTrovate)];
        splunkDestinationsSanitized = uniqueDestinations.map(sanitize);
        statoAttuale = `✅ OK: ${uniqueDestinations.length} rotte in ${minuti}m`;
        ssoTentatoOggi = false; // Resetta il flag in caso di successo
    }

    // ============================================================
    // 5. LATO GRAFICO (Colorazione Chute)
    // ============================================================
    function isLenientMatch(yosCode, targetCode) {
        if (yosCode === targetCode) return true;
        if (targetCode.length >= 3 && yosCode.startsWith(targetCode)) return true;
        if (yosCode.length >= 3 && targetCode.startsWith(yosCode)) return true;
        return false;
    }

    function applyYosSplunkColors() {
        if (splunkDestinationsSanitized.length === 0) return;
        const dockingBgs = document.querySelectorAll('.docking_bg, .reverse_docking_bg');

        dockingBgs.forEach(dockingBg => {
            const doorSpan = dockingBg.querySelector('.door_number span, .reverse_door_number span');
            if (!doorSpan) return;
            const bayNum = parseInt(doorSpan.textContent.trim(), 10);
            if (isNaN(bayNum) || bayNum < 300 || bayNum > 499) return;

            const destDiv = dockingBg.querySelector('.assign_text, .reverse_assign_text');
            const destName = (destDiv?.textContent || '').trim().toUpperCase();
            if (!destName) return;

            let possibleMatches = [sanitize(destName)];
            if (destName.length >= 3) {
                const base = destName.slice(0, -1);
                const suffix = destName.slice(-1);
                if (suffix === 'D') possibleMatches.push(sanitize(`${base} DOM`));
                else if (suffix === 'I') possibleMatches.push(sanitize(`${base} INT`));
            }

            const isPresentInSplunk = possibleMatches.some(pm => splunkDestinationsSanitized.some(val => isLenientMatch(pm, val)));
            const isPresentInTeorico = !isPresentInSplunk && possibleMatches.some(pm => CHUTE_TEORICHE_SANITIZED.some(val => isLenientMatch(pm, val)));

            if (isPresentInSplunk) {
                dockingBg.style.boxShadow = `inset 0 0 0 5px ${CONFIG.COLORS.CHUTE_MATCH}`;
            } else if (isPresentInTeorico) {
                dockingBg.style.boxShadow = `inset 0 0 0 5px ${CONFIG.COLORS.CHUTE_THEORY}`;
            } else {
                dockingBg.style.boxShadow = `inset 0 0 0 5px ${CONFIG.COLORS.CHUTE_UNKNOWN}`;
            }
        });
    }

    // ============================================================
    // 6. SIDEBAR MENU INJECTION & UI LOGIC
    // ============================================================
    function updateIconStatus() {
        const btn = document.getElementById('tnt-splunk-s-btn');
        const popupStatus = document.getElementById('tnt-splunk-popup-status');
        const forceBtn = document.getElementById('tnt-splunk-popup-force');

        if (!btn) return;
        btn.title = statoAttuale;
        if (popupStatus) popupStatus.innerText = statoAttuale;

        if (statoAttuale.includes("✅ OK")) {
            btn.style.background = CONFIG.COLORS.BTN_OK;
        } else if (statoAttuale.includes("Errore") || statoAttuale.includes("Fallito")) {
            btn.style.background = CONFIG.COLORS.BTN_ERR;
        } else if (statoAttuale.includes("Interrogazione") || statoAttuale.includes("Ricerca") || statoAttuale.includes("SSO")) {
            btn.style.background = CONFIG.COLORS.BTN_LOADING;
        } else {
            btn.style.background = CONFIG.COLORS.BTN_WARN;
        }

        if (forceBtn) {
            const isWorking = statoAttuale.includes("Interrogazione") || statoAttuale.includes("Ricerca") || statoAttuale.includes("SSO");
            forceBtn.disabled = isWorking;
            forceBtn.innerText = isWorking ? 'Attendere...' : 'Aggiorna Ora';
        }
    }

    function injectSidebarButton() {
        const menuPanel = document.querySelector('.cc-hub-menu-panel');
        if (!menuPanel || document.getElementById('tnt-splunk-sidebar-wrapper')) return;

        injectCustomCSS();

        const wrapper = document.createElement('div');
        wrapper.id = 'tnt-splunk-sidebar-wrapper';
        wrapper.style.cssText = 'position:relative; width: 100%; display: flex; justify-content: center;';

        const minSelezionati = GM_getValue('splunk_api_minutes', "90");
        const optionsHtml = [5, 10, 20, 30, 60, 90, 120, 180]
            .map(m => `<option value="${m}" ${minSelezionati == m ? 'selected' : ''}>Ultime ${m} minuti</option>`)
            .join('');

        wrapper.innerHTML = `
            <div id="tnt-splunk-s-btn" class="yos-custom-s-btn" title="Splunk Sync" style="background:${CONFIG.COLORS.BTN_WARN};">
                S
            </div>
            <div id="tnt-splunk-popup" class="yos-splunk-popup">
                <div class="yos-splunk-popup-header">Splunk Sync</div>
                <div id="tnt-splunk-popup-status" class="yos-splunk-status">${statoAttuale}</div>
                <select id="tnt-splunk-popup-time" class="yos-splunk-select">
                    ${optionsHtml}
                </select>
                <button id="tnt-splunk-popup-force" class="yos-splunk-force-btn">Aggiorna Ora</button>
            </div>
        `;
        menuPanel.appendChild(wrapper);

        const btn = document.getElementById('tnt-splunk-s-btn');
        const popup = document.getElementById('tnt-splunk-popup');

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
        });

        document.getElementById('tnt-splunk-popup-time').addEventListener('change', (e) => {
            GM_setValue('splunk_api_minutes', e.target.value);
            lanciaAggiornamentoUI();
        });

        document.getElementById('tnt-splunk-popup-force').addEventListener('click', lanciaAggiornamentoUI);

        document.addEventListener('click', (e) => {
            if (!wrapper.contains(e.target)) popup.style.display = 'none';
        });
    }

    // ============================================================
    // 7. GESTIONE SINCRONIZZAZIONE
    // ============================================================
    async function lanciaAggiornamentoUI() {
        statoAttuale = "⏳ Interrogazione in corso...";
        updateIconStatus();

        try {
            await recuperaDatiDaSplunk();
            applyYosSplunkColors();
        } catch (e) {
            statoAttuale = `❌ Errore: ${e.message || "Sconosciuto"}`;
            console.error("[SPLUNK API SYNC ERROR]", e);
        } finally {
            updateIconStatus();
        }
    }

    // ============================================================
    // 8. BOOTSTRAP
    // ============================================================
    setInterval(() => {
        const isPlanciaAttiva = document.querySelectorAll('.docking_door_area').length > 0;
        const menuPanel = document.querySelector('.cc-hub-menu-panel');
        const wrapper = document.getElementById('tnt-splunk-sidebar-wrapper');

        if (!isPlanciaAttiva) {
            if (wrapper) wrapper.style.display = 'none';
            return;
        }

        if (menuPanel && !wrapper) {
            injectSidebarButton();
            lanciaAggiornamentoUI();
        } else if (wrapper) {
            wrapper.style.display = 'flex';
            applyYosSplunkColors();
        }
    }, CONFIG.REFRESH_UI_MS);

    setInterval(() => {
        if (document.querySelectorAll('.docking_door_area').length > 0) {
            lanciaAggiornamentoUI();
        }
    }, CONFIG.REFRESH_API_MS);

})();

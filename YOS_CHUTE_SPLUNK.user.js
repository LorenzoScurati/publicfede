// ==UserScript==
// @name         YOS & SPLUNK Sync Overlay - SIDEBAR INTEGRATION 9.8
// @namespace    http://tampermonkey.net/
// @version      2.3
// @description  Leggibilità Produttività migliorata, Turno resettato su AUTO all'avvio.
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
        SSO_TIMEOUT_MS: 15000, 
        COLORS: {
            CHUTE_MATCH: '#28a745', CHUTE_THEORY: '#dc3545', CHUTE_UNKNOWN: '#ffc107',
            BTN_OK: '#2E7D32', BTN_ERR: '#C62828', BTN_LOADING: '#D97706',
            BTN_GRAY: '#555555', 
            ACCENT_SYNC: '#8B5CF6', 
            ACCENT_PROD: '#3B82F6'  
        }
    };

    const sanitize = (str) => str ? String(str).replace(/[^A-Z0-9]/ig, '').toUpperCase() : "";

    const CHUTE_TEORICHE_SANITIZED = [
        "QAL", "MZ1", "MLA", "PSA", "TO1", "GOA", "IOE", "QVA", "BEA", "VBS", "VBS DOM", "REM", "CUF", 
        "IIM", "QZR", "VNZ", "BO1", "HNJ", "FIA", "93A", "NC3", "QPZ", "QPA", "TV1", "ILJ", "MM1 DOM", 
        "MM1 INT", "ICM", "BRG", "RNV", "ISV", "OS3", "AOT", "SKG GRE", "IPO", "BA5", "BZQ", "AN6", 
        "ATHC", "DZ5", "RMZ", "PD2", "IBU", "DFT", "BO2", "TEST"
    ].map(sanitize);

    let splunkDestinationsSanitized = [];
    let statoS = "Avvio in corso...";
    let statoP = "In attesa...";
    let colliProcessati = "---";
    let datiNoRead = "---";
    let ssoTentatoOggi = false; 

    if (!CONFIG.IS_YOS) return;

    // --- FORZA IL TURNO SU "AUTO" AD OGNI AVVIO DEL BROWSER/SCRIPT ---
    GM_setValue('splunk_prod_shift', 'AUTO');

    // ============================================================
    // 2. STILI CSS AVANZATI (Aggiornati per Leggibilità)
    // ============================================================
    function injectCustomCSS() {
        if (document.getElementById('tnt-splunk-styles')) return;
        const style = document.createElement('style');
        style.id = 'tnt-splunk-styles';
        style.textContent = `
            .yos-btn-stack { display: flex; flex-direction: column; gap: 10px; align-items: center; width: 100%; margin-top: 10px; position: relative; }
            .yos-custom-btn {
                display: flex; justify-content: center; align-items: center;
                width: 42px; height: 42px; border-radius: 8px;
                font-weight: 700; font-size: 20px; color: white;
                cursor: pointer; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                user-select: none; box-shadow: 0 2px 4px rgba(0,0,0,0.4);
                transition: transform 0.15s ease, filter 0.15s ease, background 0.3s ease;
            }
            .yos-custom-btn:hover { transform: scale(1.05); filter: brightness(1.15); box-shadow: 0 4px 8px rgba(0,0,0,0.5); }
            .yos-splunk-popup {
                display: none; position: absolute; left: 60px;
                background: #252526; border: 1px solid #444; border-radius: 10px;
                padding: 18px; width: 250px; box-shadow: 0 10px 30px rgba(0,0,0,0.6);
                z-index: 999999; color: #f2f2f2; font-family: 'Segoe UI', Roboto, sans-serif;
            }
            .yos-splunk-popup-header { font-size: 15px; font-weight: 700; border-bottom: 1px solid #444; padding-bottom: 8px; margin-bottom: 12px; }
            .yos-splunk-status { font-size: 12px; margin-bottom: 14px; color: #d4d4d4; line-height: 1.4; font-style: italic; }
            .yos-splunk-select {
                width: 100%; padding: 10px; border-radius: 6px; background: #1e1e1e; color: white; 
                border: 1px solid #555; margin-bottom: 14px; font-size: 13px; cursor: pointer; outline: none;
            }
            .yos-splunk-force-btn {
                width: 100%; padding: 10px; border: none; border-radius: 6px;
                color: white; cursor: pointer; font-weight: bold; font-size: 14px; transition: opacity 0.2s ease;
            }
            .yos-splunk-force-btn:hover:not(:disabled) { filter: brightness(1.2); }
            .yos-splunk-force-btn:disabled { opacity: 0.5; cursor: not-allowed; }
            
            .big-number-card { background: #1e1e1e; border-radius: 8px; padding: 12px; border: 1px solid #333; text-align: center; margin-bottom: 15px; box-shadow: inset 0 2px 5px rgba(0,0,0,0.3); }
            .big-number-title { font-size: 11px; color: #aaa; text-transform: uppercase; letter-spacing: 0.5px; }
            .big-number-val { font-size: 34px; font-weight: 800; color: #ffffff; margin-top: 4px; font-family: monospace; }
            
            /* --- NUOVO STILE PER I NOREAD --- */
            .small-sub-text {
                margin-top: 12px;
                border-top: 1px solid #333;
                padding-top: 10px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .small-sub-text-label {
                font-size: 12px;
                color: #cccccc;
                font-weight: 600;
                letter-spacing: 0.3px;
            }
            .small-sub-text-value {
                color: #ff6b6b; /* Rosso più acceso */
                font-weight: 900;
                font-size: 14px;
                background: rgba(255, 107, 107, 0.15); /* Sfondo leggero rosso */
                padding: 3px 8px;
                border-radius: 4px;
            }
        `;
        document.head.appendChild(style);
    }

    // ============================================================
    // 3. LOGICA DEI TURNI ESATTA (Giornata Operativa 16:00 - 09:00)
    // ============================================================
    function getShiftTimestamps(mode) {
        const now = new Date();
        const hour = now.getHours();
        
        let opStart = new Date(now);
        if (hour < 16) {
            opStart.setDate(opStart.getDate() - 1);
        }
        opStart.setHours(16, 0, 0, 0);

        let dayShiftStart = new Date(opStart); 
        let dayShiftEnd = new Date(opStart);
        dayShiftEnd.setDate(dayShiftEnd.getDate() + 1);
        dayShiftEnd.setHours(1, 0, 0, 0);      

        let nightShiftStart = new Date(dayShiftEnd); 
        let nightShiftEnd = new Date(opStart);
        nightShiftEnd.setDate(nightShiftEnd.getDate() + 1);
        nightShiftEnd.setHours(9, 0, 0, 0);    

        let targetMode = mode;
        if (mode === 'AUTO') {
            if (now >= nightShiftStart && now < nightShiftEnd) {
                targetMode = 'NOTTE';
            } else if (now >= dayShiftStart && now < dayShiftEnd) {
                targetMode = 'GIORNO';
            } else {
                targetMode = 'FULL'; 
            }
        }
        
        let start, end;
        if (targetMode === 'NOTTE') {
            start = nightShiftStart;
            end = nightShiftEnd;
        } else if (targetMode === 'GIORNO') {
            start = dayShiftStart;
            end = dayShiftEnd;
        } else {
            start = dayShiftStart;
            end = nightShiftEnd;
        }
        
        return {
            earliest: Math.floor(start.getTime() / 1000),
            latest: Math.floor(end.getTime() / 1000),
            label: targetMode
        };
    }

    // ============================================================
    // 4. MOTORE API UNIFICATO SPLUNK & AUTO-LOGIN
    // ============================================================
    function gmRequest(dettagli) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                timeout: 60000, anonymous: false, withCredentials: true, ...dettagli,
                onload: resolve, onerror: () => reject(new Error("Rete bloccata.")), ontimeout: () => reject(new Error("Timeout (60s)."))
            });
        });
    }

    function ottieniCsrfSplunk() {
        return new Promise((resolve) => {
            GM_cookie.list({ url: CONFIG.SPLUNK_HOST + "/" }, (cookies, error) => {
                const c = cookies && !error ? cookies.find((k) => /csrf/i.test(k.name)) : null;
                resolve({ valore: c ? c.value : null });
            });
        });
    }

    async function eseguiLoginAutomatico() {
        return new Promise((resolve) => {
            const tempStatoS = statoS; const tempStatoP = statoP;
            statoS = `🔄 Autenticazione SSO...`; statoP = `🔄 Autenticazione SSO...`;
            updateIconStatus();

            let authTab = GM_openInTab(CONFIG.SPLUNK_HOST + "/en-US/app/launcher/home", { active: false, insert: true });
            
            setTimeout(() => {
                try { if (authTab && typeof authTab.close === 'function') authTab.close(); } catch(e) {}
                statoS = tempStatoS; statoP = tempStatoP;
                resolve(true);
            }, CONFIG.SSO_TIMEOUT_MS);
        });
    }

    async function runSplunkExport(query, isRetry = false) {
        let csrfInfo = await ottieniCsrfSplunk();

        if (!csrfInfo.valore && !isRetry && !ssoTentatoOggi) {
            ssoTentatoOggi = true;
            await eseguiLoginAutomatico();
            csrfInfo = await ottieniCsrfSplunk();
        }

        const corpo = `output_mode=json&search=${encodeURIComponent(query)}`;
        const headers = { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" };
        if (csrfInfo.valore) headers["X-Splunk-Form-Key"] = csrfInfo.valore;

        const res = await gmRequest({ method: "POST", url: `${CONFIG.SPLUNK_HOST}/en-US/splunkd/__raw/services/search/jobs/export`, headers, data: corpo });

        if (res.status === 401 || res.status === 403 || (res.responseText && res.responseText.trim().startsWith("<html"))) {
            if (!isRetry && !ssoTentatoOggi) {
                ssoTentatoOggi = true;
                await eseguiLoginAutomatico();
                return runSplunkExport(query, true); 
            } else throw new Error("SSO Fallito. Apri Splunk manualmente.");
        }

        if (res.status < 200 || res.status >= 300) throw new Error(`Errore Server (${res.status})`);
        ssoTentatoOggi = false;
        return res.responseText;
    }

    // ============================================================
    // 5. CHIAMATE SPECIFICHE E PARSING
    // ============================================================
    async function recuperaDatiSync() {
        const minuti = GM_getValue('splunk_api_minutes', "90");
        const query = `search index=uDS_application site="IMRH" Event=SortReport earliest=-${minuti}m latest=now | rex field=_raw "Data=(?<json>\\{.*\\})" | spath input=json | eval record_type="SORT" | search ActualDestination!="999999" AND RejectReason=null | fields _time Barcode ActualDestination SortedByRule record_type | append [search index=uDS_application site="IMRH" Event=RfLoadingValidationRequest* earliest=-${minuti}m latest=now | rex field=_raw "HuBarcode=(?<Barcode>[^;]+)" | eval record_type="RF" | fields _time Barcode record_type] | append [search index=uDS_application site="IMRH" Event=ChuteScanningOrchestrator Action=ReceiveResponse earliest=-${minuti}m latest=now | rex field=_raw "(?i)PackageBarcode\\":\\"(?<Barcode>[^\\"]+)" | rex field=_raw "(?i)ResponseBody=\\{[^\\}]*\\"status\\":\\"(?<Status>[^\\"]+)\\"" | search Status="SUCCESS" | eval record_type="CHUTE" | fields _time Barcode record_type] | sort 0 - _time | dedup Barcode record_type | stats min(eval(if(record_type="SORT", _time, null()))) AS SortTime min(eval(if(record_type="RF", _time, null()))) AS RFTime min(eval(if(record_type="CHUTE", _time, null()))) AS ChuteTime values(ActualDestination) AS ActualDestination values(SortedByRule) AS SortedByRule BY Barcode | eval Chute_Flag = if(isnotnull(ChuteTime), 1, 0) | stats sum(Chute_Flag) AS Chute_Count values(SortedByRule) AS SortedByRule BY ActualDestination | where Chute_Count > 0 | eval SortedByRule = mvjoin(SortedByRule, ", ") | rename ActualDestination AS Destination | rename SortedByRule AS Rules | table Destination Rules`;
        
        const resText = await runSplunkExport(query);
        const destinazioni = [];
        let err = null;

        resText.split("\n").filter(Boolean).forEach(riga => {
            try {
                const obj = JSON.parse(riga);
                if (obj.messages && obj.messages.some(m => m.type === "FATAL")) err = obj.messages[0].text;
                if (obj.result) destinazioni.push(...((obj.result.Rules || obj.result.Destination || "").split(',').map(p => p.trim()).filter(Boolean)));
            } catch(e) {}
        });

        if (err) throw new Error(err);
        const uniq = [...new Set(destinazioni)];
        splunkDestinationsSanitized = uniq.map(sanitize);
        statoS = `✅ OK: ${uniq.length} rotte in ${minuti}m`;
    }

    async function recuperaDatiProduttivita() {
        const mode = GM_getValue('splunk_prod_shift', "AUTO");
        const times = getShiftTimestamps(mode);
        
        const query = `search index=ops_reporting_detail location_id="IMRH" sort_area_type="*" earliest=${times.earliest} latest=${times.latest} | search sort_result IN ("SORTED", "REJECT", "LOST", "OVERFLOW") | stats dc(barcode) as totale, count(eval(reject_reason="NoRead")) as noread_count`;
        
        const resText = await runSplunkExport(query);
        let count = 0;
        let noread = 0;
        let err = null;

        resText.split("\n").filter(Boolean).forEach(riga => {
            try {
                const obj = JSON.parse(riga);
                if (obj.messages && obj.messages.some(m => m.type === "FATAL")) err = obj.messages[0].text;
                if (obj.result) {
                    if (obj.result.totale) count = parseInt(obj.result.totale, 10);
                    if (obj.result.noread_count) noread = parseInt(obj.result.noread_count, 10);
                }
            } catch(e) {}
        });

        if (err) throw new Error(err);
        
        colliProcessati = count.toLocaleString('it-IT');
        
        const percNoRead = count > 0 ? ((noread / count) * 100).toFixed(2) : 0;
        datiNoRead = `${noread.toLocaleString('it-IT')} (${percNoRead}%)`;

        statoP = `✅ OK: Dati Turno ${times.label}`;
    }

    // ============================================================
    // 6. UI: AGGIORNAMENTO GRAFICO 
    // ============================================================
    function applyYosSplunkColors() {
        if (splunkDestinationsSanitized.length === 0) return;
        document.querySelectorAll('.docking_bg, .reverse_docking_bg').forEach(dockingBg => {
            const doorSpan = dockingBg.querySelector('.door_number span, .reverse_door_number span');
            if (!doorSpan) return;
            const bayNum = parseInt(doorSpan.textContent.trim(), 10);
            if (isNaN(bayNum) || bayNum < 300 || bayNum > 499) return;

            const destName = (dockingBg.querySelector('.assign_text, .reverse_assign_text')?.textContent || '').trim().toUpperCase();
            if (!destName) return;

            let matches = [sanitize(destName)];
            if (destName.length >= 3) {
                const b = destName.slice(0, -1), s = destName.slice(-1);
                if (s === 'D') matches.push(sanitize(`${b} DOM`));
                else if (s === 'I') matches.push(sanitize(`${b} INT`));
            }

            const inSplunk = matches.some(pm => splunkDestinationsSanitized.some(v => v === pm || (pm.length>=3 && v.startsWith(pm)) || (v.length>=3 && pm.startsWith(v))));
            const inTeorico = !inSplunk && matches.some(pm => CHUTE_TEORICHE_SANITIZED.some(v => v === pm || (pm.length>=3 && v.startsWith(pm)) || (v.length>=3 && pm.startsWith(v))));

            dockingBg.style.boxShadow = `inset 0 0 0 5px ${inSplunk ? CONFIG.COLORS.CHUTE_MATCH : (inTeorico ? CONFIG.COLORS.CHUTE_THEORY : CONFIG.COLORS.CHUTE_UNKNOWN)}`;
        });
    }

    function updateIconStatus() {
        const btnS = document.getElementById('tnt-btn-s'); const statS = document.getElementById('tnt-stat-s'); const fceS = document.getElementById('tnt-fce-s');
        const btnP = document.getElementById('tnt-btn-p'); const statP = document.getElementById('tnt-stat-p'); const fceP = document.getElementById('tnt-fce-p');
        const valP = document.getElementById('tnt-prod-val'); const nrP = document.getElementById('tnt-prod-noread');

        if (btnS) {
            btnS.title = statoS; if (statS) statS.innerText = statoS;
            if (statoS.includes("✅ OK")) btnS.style.background = CONFIG.COLORS.BTN_OK;
            else if (statoS.includes("Errore") || statoS.includes("Fallito")) btnS.style.background = CONFIG.COLORS.BTN_ERR;
            else if (statoS.includes("Interrogazione") || statoS.includes("SSO")) btnS.style.background = CONFIG.COLORS.BTN_LOADING;
            else btnS.style.background = CONFIG.COLORS.BTN_GRAY;
            
            if (fceS) { fceS.disabled = statoS.includes("Interrogazione") || statoS.includes("SSO"); fceS.innerText = fceS.disabled ? 'Attendere...' : 'Aggiorna Ora'; }
        }

        if (btnP) {
            btnP.title = statoP; if (statP) statP.innerText = statoP;
            if (valP) valP.innerText = colliProcessati;
            if (nrP) nrP.innerText = datiNoRead;

            if (statoP.includes("Errore") || statoP.includes("Fallito")) btnP.style.background = CONFIG.COLORS.BTN_ERR;
            else if (statoP.includes("Interrogazione") || statoP.includes("SSO")) btnP.style.background = CONFIG.COLORS.BTN_LOADING;
            else btnP.style.background = CONFIG.COLORS.BTN_GRAY; 
            
            if (fceP) { fceP.disabled = statoP.includes("Interrogazione") || statoP.includes("SSO"); fceP.innerText = fceP.disabled ? 'Attendere...' : 'Aggiorna Ora'; }
        }
    }

    // ============================================================
    // 7. INJECTION & LOGICA DI AVVIO
    // ============================================================
    function injectSidebarInterface() {
        const menuPanel = document.querySelector('.cc-hub-menu-panel');
        if (!menuPanel || document.getElementById('tnt-splunk-sidebar-wrapper')) return;

        injectCustomCSS();
        const wrapper = document.createElement('div');
        wrapper.id = 'tnt-splunk-sidebar-wrapper';
        wrapper.className = 'yos-btn-stack';

        const minVal = GM_getValue('splunk_api_minutes', "90");
        const prodVal = GM_getValue('splunk_prod_shift', "AUTO");

        wrapper.innerHTML = `
            <!-- BOTTONE E POPUP: SYNC -->
            <div id="tnt-btn-s" class="yos-custom-btn" style="background:${CONFIG.COLORS.BTN_GRAY};">S</div>
            <div id="tnt-pop-s" class="yos-splunk-popup" style="top: 0px;">
                <div class="yos-splunk-popup-header" style="color: ${CONFIG.COLORS.ACCENT_SYNC};">Splunk Sync</div>
                <div id="tnt-stat-s" class="yos-splunk-status">${statoS}</div>
                <select id="tnt-sel-s" class="yos-splunk-select">
                    ${[5, 10, 20, 30, 60, 90, 120, 180].map(m => `<option value="${m}" ${minVal == m ? 'selected' : ''}>Ultime ${m} minuti</option>`).join('')}
                </select>
                <button id="tnt-fce-s" class="yos-splunk-force-btn" style="background:${CONFIG.COLORS.ACCENT_SYNC};">Aggiorna Ora</button>
            </div>

            <!-- BOTTONE E POPUP: PRODUTTIVITÀ -->
            <div id="tnt-btn-p" class="yos-custom-btn" style="background:${CONFIG.COLORS.BTN_GRAY};">P</div>
            <div id="tnt-pop-p" class="yos-splunk-popup" style="top: 52px;">
                <div class="yos-splunk-popup-header" style="color: ${CONFIG.COLORS.ACCENT_PROD};">Produttività</div>
                <div id="tnt-stat-p" class="yos-splunk-status">${statoP}</div>
                
                <div class="big-number-card">
                    <div class="big-number-title">Colli Unici (Barcode)</div>
                    <div id="tnt-prod-val" class="big-number-val">${colliProcessati}</div>
                    
                    <div class="small-sub-text">
                        <span class="small-sub-text-label">Scarti NoRead:</span>
                        <span class="small-sub-text-value" id="tnt-prod-noread">${datiNoRead}</span>
                    </div>
                </div>

                <select id="tnt-sel-p" class="yos-splunk-select">
                    <option value="AUTO" ${prodVal === 'AUTO' ? 'selected' : ''}>Turno Automatico</option>
                    <option value="GIORNO" ${prodVal === 'GIORNO' ? 'selected' : ''}>Giorno (16:00 - 01:00)</option>
                    <option value="NOTTE" ${prodVal === 'NOTTE' ? 'selected' : ''}>Notte (01:00 - 09:00)</option>
                    <option value="FULL" ${prodVal === 'FULL' ? 'selected' : ''}>Full Day (16:00 - 09:00)</option>
                </select>
                <button id="tnt-fce-p" class="yos-splunk-force-btn" style="background:${CONFIG.COLORS.ACCENT_PROD};">Aggiorna Ora</button>
            </div>
        `;
        menuPanel.appendChild(wrapper);

        const popS = document.getElementById('tnt-pop-s'), popP = document.getElementById('tnt-pop-p');
        
        document.getElementById('tnt-btn-s').addEventListener('click', (e) => { e.stopPropagation(); popP.style.display = 'none'; popS.style.display = popS.style.display === 'none' ? 'block' : 'none'; });
        document.getElementById('tnt-btn-p').addEventListener('click', (e) => { e.stopPropagation(); popS.style.display = 'none'; popP.style.display = popP.style.display === 'none' ? 'block' : 'none'; });
        document.addEventListener('click', (e) => { if (!wrapper.contains(e.target)) { popS.style.display = 'none'; popP.style.display = 'none'; }});

        document.getElementById('tnt-sel-s').addEventListener('change', (e) => { GM_setValue('splunk_api_minutes', e.target.value); triggerSync(); });
        document.getElementById('tnt-fce-s').addEventListener('click', triggerSync);
        
        document.getElementById('tnt-sel-p').addEventListener('change', (e) => { GM_setValue('splunk_prod_shift', e.target.value); triggerProd(); });
        document.getElementById('tnt-fce-p').addEventListener('click', triggerProd);
    }

    async function triggerSync() {
        statoS = "⏳ Interrogazione in corso..."; updateIconStatus();
        try { await recuperaDatiSync(); applyYosSplunkColors(); } 
        catch (e) { statoS = `❌ Errore: ${e.message || "Sconosciuto"}`; } 
        finally { updateIconStatus(); }
    }

    async function triggerProd() {
        statoP = "⏳ Interrogazione in corso..."; updateIconStatus();
        try { await recuperaDatiProduttivita(); } 
        catch (e) { statoP = `❌ Errore: ${e.message || "Sconosciuto"}`; } 
        finally { updateIconStatus(); }
    }

    // ============================================================
    // 8. BOOTSTRAP: AVVIO E REFRESH
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
            injectSidebarInterface();
            triggerSync();
            triggerProd();
        } else if (wrapper) {
            wrapper.style.display = 'flex';
            applyYosSplunkColors(); 
        }
    }, CONFIG.REFRESH_UI_MS);

    setInterval(() => {
        if (document.querySelectorAll('.docking_door_area').length > 0) {
            triggerSync();
            triggerProd();
        }
    }, CONFIG.REFRESH_API_MS);

})();

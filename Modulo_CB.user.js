// ==UserScript==
// @name         YOS & CONS - Modulo CB (Check Bulk & EOPS)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Modulo On-Demand: UI Fix, Aggiunta Colli (Ordinati), e Sistema di Backup 24H.
// @author       Lorenzo Scurati
// @match        https://yos.apps.tnt.com/hub-overview*
// @match        https://dh-cons-maintenance-ui-production-directed-handling.fxi-001.fxi-prod.az.fxei.fedex.com/*
// @match        https://eops-lb-las.prod.cloud.fedex.com/*
// @match        https://conser-lb-atl.prod.cloud.fedex.com:8134/*
// @match        https://eai-5530-user-interface-prod.app.paas.fedex.com/*
// @updateURL    https://raw.githubusercontent.com/LorenzoScurati/publicfede/main/Modulo_CB.user.js
// @downloadURL  https://raw.githubusercontent.com/LorenzoScurati/publicfede/main/Modulo_CB.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================
    // SISTEMA ANTI-SOSPENSIONE & KILL-SWITCH
    // ==========================================
    let audioCtx = null;
    let wakeLockObj = null;

    function startAntiSleep() {
        if (!window.wakeLockActive) {
            window.wakeLockActive = true;
            try {
                if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                if (audioCtx.state === 'suspended') audioCtx.resume();

                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.frequency.value = 30;
                gain.gain.value = 0.001;
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start();
                window.antiSleepOsc = osc;
                console.log("[CB Modulo] 🛡️ Scudo Anti-Sospensione (Audio) ATTIVO");
            } catch(e) {}

            if ('wakeLock' in navigator) {
                navigator.wakeLock.request('screen').then(wl => {
                    wakeLockObj = wl;
                    console.log("[CB Modulo] 🖥️ Screen Wake Lock ATTIVO");
                }).catch(e => {});
            }
        }
    }

    function stopAntiSleep() {
        if (window.wakeLockActive) {
            window.wakeLockActive = false;
            try {
                if (window.antiSleepOsc) {
                    window.antiSleepOsc.stop();
                    window.antiSleepOsc.disconnect();
                    window.antiSleepOsc = null;
                }
                if (audioCtx) audioCtx.suspend();
                console.log("[CB Modulo] 🛡️ Scudo Anti-Sospensione DISATTIVATO");
            } catch(e) {}

            if (wakeLockObj) {
                wakeLockObj.release().then(() => wakeLockObj = null);
                console.log("[CB Modulo] 🖥️ Screen Wake Lock RILASCIATO");
            }
        }
    }

    function stopAllProcesses() {
        GM_setValue('cb_scan_state', 'STANDBY');
        GM_setValue('eops_auto_mode', false);
        GM_setValue('cb_phase3_active', false);
        GM_setValue('cb_phase3_completed', false);
        stopAntiSleep();
        console.log('[CB Modulo] 🛑 PROCESSO INTERROTTO FORZATAMENTE (Kill-Switch).');
    }

    setInterval(() => {
        let s1 = GM_getValue('cb_scan_state', 'STANDBY');
        let s2 = GM_getValue('eops_auto_mode', false);
        let s3 = GM_getValue('cb_phase3_active', false);

        let isRunning = (s1 === 'INIT' || s1 === 'SWEEPING' || s2 === true || s3 === true);

        if (isRunning && !window.wakeLockActive) startAntiSleep();
        else if (!isRunning && window.wakeLockActive) stopAntiSleep();
    }, 2000);

    document.addEventListener('click', () => {
        if (window.wakeLockActive && audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    });

    // ==========================================
    // PULIZIA MEMORIA INIZIALE
    // ==========================================
    if (window.location.href.includes('hub-overview') && !window.yosCbResetDone) {
        window.yosCbResetDone = true;
        stopAllProcesses();
    }

    // STATI FASE 1 (CB)
    let cbInitPhase = 0;
    let cbActiveBulks = [];
    let cbLastPageActionTime = 0;
    let cbPagePiecesRequested = false;

    // ==========================================
    // DIZIONARIO FEDEX -> TNT
    // ==========================================
    const fedexToTntMap = {
        "CDGT9": "06A", "AOIP": "AN6", "AOTT8": "AOT", "BRIP": "BA5",
        "BCNA": "BCN", "BCNB": "BCN", "QNOA": "BEA", "GBNA": "BO1", "BLQP": "BO2",
        "TARA": "BRG", "BZQA": "BZQ", "CUFT8": "CUF", "DTZT": "DFT", "DUSC": "DNG",
        "DUSA": "DUS+RGL", "QCZA": "RMZ", "ZIPH": "FCS", "ZIQH": "FIA", "GOAA": "GOA",
        "HAJA": "HNJ", "ZIAT7": "IBD", "DCIA": "IBU", "FIRA": "ICM", "FRLA": "IIM",
        "IPRA": "ILJ", "ISHA": "IOE", "ISRA": "IPO", "LTZA": "ISV", "QQKH": "KG4",
        "LUGA": "LUG", "LYSA": "LYS", "MADA": "MAD+", "MADC": "MAD+", "QAQA": "MDA",
        "MILT7": "MIL", "ZMIA": "MM1D", "ZIEA": "MM1I", "MRST8": "MRS", "STXA": "MV9",
        "MXPA": "MXPE", "MXPB": "MXPI", "ZJYH": "NT3", "SUFA": "OS3",
        "QCLA": "OSO", "ZMFH": "PD2", "PMFT8": "PMF", "PSAT8": "PSA", "QALA": "QAL",
        "QARA": "QAR", "QARH": "QAR", "QPAA": "QPA", "QPZT8": "QPZ", "QVAT7": "QVA",
        "QZRT8": "QZR", "RANA": "REM", "QEAA": "RNV", "ROMT7": "ROM", "SKGA": "SKG",
        "XIKA": "TO1", "XNCA": "TV1", "VBSA": "VBS", "VBST7": "VBS", "XRLA": "VE1",
        "VNZT7": "VNZ", "VRNA": "VRN", "XVYA": "ZD1", "ZRHA": "ZRH", "ZCBA": "Z8C"
    };

    function translateLocID(code) {
        if (!code || code === "N/D") return 'N/D';
        return fedexToTntMap[code.toUpperCase()] || code.toUpperCase();
    }

    // ==========================================
    // STILI CSS MODULO CB & EOPS
    // ==========================================
    const style = document.createElement('style');
    style.innerHTML = `
        .yos-custom-sidebar-btn { width: 36px; height: 36px; margin: 12px auto; display: flex; align-items: center; justify-content: center; color: #ffffff; font-weight: bold; font-family: Arial, Roboto, sans-serif; font-size: 14px; cursor: pointer; border-radius: 8px; background-color: #6e6e6e; border: 2px solid #8a8a8a; box-shadow: 0 1px 3px rgba(0,0,0,0.3); transition: all 0.2s ease-in-out; box-sizing: border-box; text-shadow: 1px 1px 2px rgba(0,0,0,0.5); }
        .yos-custom-sidebar-btn:hover { background-color: #858585; border-color: #a3a3a3; }
        .cb-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); z-index: 1000000; display: flex; align-items: center; justify-content: center; font-family: Roboto, sans-serif; }
        .cb-modal { background: #1e1e1e; padding: 25px; border-radius: 8px; color: #fff; border: 2px solid #4d4d4d; box-shadow: 0 10px 40px rgba(0,0,0,0.7); display: flex; flex-direction: column; }
        .cb-modal-small { width: 500px; max-width: 90%; }
        .cb-modal-large { width: 85vw; height: 85vh; max-width: 1400px; }
        .cb-modal-content { flex-grow: 1; overflow-y: auto; padding-right: 10px; margin-bottom: 20px; }
        .cb-modal h2 { color: #0df; border-bottom: 1px solid #444; padding-bottom: 10px; margin-top:0; font-size: 20px; flex-shrink: 0; }
        .cb-modal p { line-height: 1.5; color: #ccc; font-size: 14px; margin-bottom: 20px; }
        .cb-modal select, .cb-modal input { background: #333; color: white; padding: 10px; border: 1px solid #555; border-radius: 4px; margin-top: 5px; margin-bottom: 15px; width: 100%; font-size: 14px; outline: none; }
        .cb-modal label { display: block; margin-top: 10px; font-weight: bold; font-size: 13px; color: #0df; }
        .cb-btn { background: #007bff; color: white; padding: 12px 20px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-top: 15px; width: 100%; font-size: 15px; text-transform: uppercase; transition: background 0.2s; flex-shrink: 0; box-sizing: border-box; }
        .cb-btn:hover { background: #0056b3; }
        .cb-btn-close { background: #dc3545; }
        .cb-btn-close:hover { background: #c82333; }
        .cb-table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 14px; }
        .cb-table th { background: #333; color: #ff9800; padding: 10px; text-align: left; position: sticky; top: 0; z-index: 2; box-shadow: 0 2px 2px -1px rgba(0,0,0,0.4); }
        .cb-table td { border-bottom: 1px dotted #444; padding: 10px; }
        .cb-group-header { background-color: rgba(255, 152, 0, 0.2); padding: 12px; margin-top: 20px; font-weight: bold; border-left: 4px solid #ff9800; color: #fff; font-size: 15px; }
        .eops-manual-panel { position: fixed; top: 10px; left: 50%; transform: translateX(-50%); background: #1e1e1e; border: 3px solid #0df; padding: 15px 30px; border-radius: 10px; z-index: 9999999; display: flex; align-items: center; gap: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.8); font-family: Arial, sans-serif; }
        .eops-btn-action { background-color: #28a745; color: white; font-weight: bold; border: none; padding: 10px 20px; font-size: 16px; border-radius: 5px; cursor: pointer; box-shadow: 0 4px 10px rgba(40,167,69,0.4); transition: transform 0.1s; }
        .eops-btn-action:active { transform: scale(0.95); }
        .eops-btn-action:disabled { background-color: #555 !important; cursor: not-allowed; box-shadow: none; color: #aaa; transform: none; }
        @keyframes yos-pulse { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }
        .yos-pulse-text { animation: yos-pulse 1.5s infinite; }
    `;
    document.head.appendChild(style);

    // ==========================================
    // UTILS E FIX TENDINE
    // ==========================================
    function forceAggressiveClick(btn) {
        if (!btn) return;
        try { btn.scrollIntoView({ block: 'center' }); } catch(e){}
        btn.focus();
        const enterDown = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13 });
        const enterUp = new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13 });
        btn.dispatchEvent(enterDown);
        btn.dispatchEvent(enterUp);
        btn.click();
    }

    function clickOptionByText(text) {
        const options = document.querySelectorAll('mat-option');
        options.forEach(opt => {
            if (opt.innerText.trim().toUpperCase() === text.toUpperCase()) forceAggressiveClick(opt);
        });
        setTimeout(() => {
            const backdrop = document.querySelector('.cdk-overlay-backdrop');
            if (backdrop) backdrop.click();
        }, 150);
    }

    function deepClearFilters() {
        const resetBtn = document.querySelector('button[title="Reset filter"]');
        if (resetBtn) forceAggressiveClick(resetBtn);
        const closeButtons = document.querySelectorAll('button.mat-icon-button');
        closeButtons.forEach(btn => {
            const icon = btn.querySelector('mat-icon');
            if (icon && icon.innerText.trim() === 'close') {
                const style = window.getComputedStyle(btn);
                if (style.visibility !== 'hidden' && style.display !== 'none') forceAggressiveClick(btn);
            }
        });
    }

    function downloadCSV(bulks) {
        if (!bulks || bulks.length === 0) return;
        let csvContent = "data:text/csv;charset=utf-8,CONS ID,ASSET ID,UNIT TYPE,STATE,DESTINATION,PIECE COUNT\n";
        bulks.forEach(b => csvContent += `${b.consId},${b.assetId},${b.unitType},${b.state},${b.destination},${b.pieceCount}\n`);
        let link = document.createElement("a");
        link.href = encodeURI(csvContent);
        link.download = "Report_BULK_NO_CONS.csv";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function downloadPhase3CSV(results) {
        if (!results || results.length === 0) return;
        // Ordina dal più grande al più piccolo
        results.sort((a, b) => (b.pieceCount || 0) - (a.pieceCount || 0));

        let csvContent = "data:text/csv;charset=utf-8,CONS ID,TRACKING NUMBER,STATO TRL,DEST BULK,TNT DEST,PEZZI\n";
        results.forEach(r => {
            let tntDest = translateLocID(r.bulkDestRaw);
            let statoPuro = r.trlStatus.includes('✅') ? 'ASSOCIATA' : (r.trlStatus.includes('NO TRACKING') ? 'NESSUN TRACKING' : 'NON ASSOCIATA');
            csvContent += `${r.cons},${r.track},${statoPuro},${r.bulkDestRaw},${tntDest},${r.pieceCount || 0}\n`;
        });
        let link = document.createElement("a");
        link.href = encodeURI(csvContent);
        link.download = "Report_Fase3_Associazioni.csv";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // ==========================================
    // INIEZIONE PULSANTI IN YOS
    // ==========================================
    function injectYosSidebarButtons() {
        if (!window.location.href.includes('hub-overview')) return;
        const sidebar = document.querySelector('.cc-hub-menu-panel');
        if (!sidebar) return;

        if (!document.getElementById('tnt-sidebar-cb-btn')) {
            const cbContainer = document.createElement('div');
            cbContainer.style.position = 'relative';
            const cbBtn = document.createElement('div');
            cbBtn.id = 'tnt-sidebar-cb-btn';
            cbBtn.className = 'yos-custom-sidebar-btn';
            cbBtn.title = 'Check Bulk (CB)';
            cbBtn.innerText = 'CB';
            cbBtn.onclick = showWelcomeModal;
            cbContainer.appendChild(cbBtn);
            sidebar.appendChild(cbContainer);
        }
    }

    // ==========================================
    // MODALI YOS
    // ==========================================
    function showWelcomeModal() {
        let backupStr = GM_getValue('cb_backup_data', null);
        let hasValidBackup = false;
        let backupTimeStr = "";

        // Controllo validità Backup 24H
        if (backupStr) {
            try {
                let parsed = JSON.parse(backupStr);
                if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
                    hasValidBackup = true;
                    let d = new Date(parsed.timestamp);
                    let h = String(d.getHours()).padStart(2, '0');
                    let m = String(d.getMinutes()).padStart(2, '0');
                    let day = String(d.getDate()).padStart(2, '0');
                    let month = String(d.getMonth() + 1).padStart(2, '0');
                    backupTimeStr = `${day}/${month} ore ${h}:${m}`;
                } else {
                    GM_setValue('cb_backup_data', null); // Scaduto, pulisci
                }
            } catch(e){}
        }

        const overlay = document.createElement('div');
        overlay.className = 'cb-overlay';

        let html = `
            <div class="cb-modal cb-modal-small">
                <h2>👋 Benvenuto!</h2>
                <div class="cb-modal-content" style="margin-bottom:0;">
                    <p style="font-size: 16px;">Benvenuto nell'<b>automatic light BULK-NO_CONS check</b>.</p>
                    <p style="font-size: 15px;">Questo programma estrae tutte le Bulk (OTHER) da CONS Maintenance e verifica se sono state associate a un Trailer.</p>
                </div>
                <button class="cb-btn" id="cb-welcome-ok" style="background-color: #28a745;">🚀 NUOVO CHECK BULK</button>`;

        if (hasValidBackup) {
            html += `<button class="cb-btn" id="cb-welcome-backup" style="background-color: #17a2b8; margin-top: 10px;">💾 CARICA BACKUP (${backupTimeStr})</button>`;
        }

        html += `
                <button class="cb-btn cb-btn-close" id="cb-welcome-cancel" style="margin-top: 10px;">Annulla</button>
            </div>
        `;

        overlay.innerHTML = html;
        document.body.appendChild(overlay);

        document.getElementById('cb-welcome-cancel').onclick = () => { overlay.remove(); stopAllProcesses(); };
        document.getElementById('cb-welcome-ok').onclick = () => { overlay.remove(); showSettingsModal(); };

        if (hasValidBackup) {
            document.getElementById('cb-welcome-backup').onclick = () => {
                overlay.remove();
                showPhase3ResultsModal(true); // Parametro true indica caricamento da backup
            };
        }
    }

    function showSettingsModal() {
        const overlay = document.createElement('div');
        overlay.className = 'cb-overlay';
        overlay.innerHTML = `
            <div class="cb-modal cb-modal-small">
                <h2>⚙️ Impostazioni Check Bulk</h2>
                <div class="cb-modal-content" style="margin-bottom:0;">
                    <label>🕒 Ore di scanning su CONS:</label>
                    <select id="cb-hours">
                        <option value="12">12 ore</option>
                        <option value="24" selected>24 ore</option>
                        <option value="48">48 ore</option>
                        <option value="72">72 ore</option>
                        <option value="96">96 ore</option>
                    </select>

                    <label>📦 Evita Bulk con pezzi pari o inferiori a:</label>
                    <select id="cb-min-pieces">
                        <option value="1">Ignora se <= 1 pezzo (mostra da 2 in su)</option>
                        <option value="2">Ignora se <= 2 pezzi (mostra da 3 in su)</option>
                        <option value="5">Ignora se <= 5 pezzi (mostra da 6 in su)</option>
                        <option value="10">Ignora se <= 10 pezzi (mostra da 11 in su)</option>
                    </select>

                    <label>📄 Scarica Report CSV a fine check?</label>
                    <select id="cb-csv">
                        <option value="SI">Sì, scarica il CSV in automatico</option>
                        <option value="NO">No, fammi vedere solo il report a schermo</option>
                    </select>
                </div>
                <button class="cb-btn" id="cb-start-btn">AVVIA CHECK BULK</button>
                <button class="cb-btn cb-btn-close" id="cb-cancel-settings">Annulla e Chiudi</button>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('cb-cancel-settings').onclick = () => { overlay.remove(); stopAllProcesses(); };
        document.getElementById('cb-start-btn').onclick = () => {
            const settings = {
                hours: document.getElementById('cb-hours').value,
                minPieces: parseInt(document.getElementById('cb-min-pieces').value),
                csv: document.getElementById('cb-csv').value
            };
            GM_setValue('cb_settings', JSON.stringify(settings));
            GM_setValue('cb_phase2_extracted', '[]');
            GM_setValue('cons_scan_state', 'PAUSED');
            GM_setValue('cb_scan_state', 'INIT');
            overlay.remove();
        };
    }

    function showCbResultsModal() {
        let bulksStr = GM_getValue('cb_found_bulks', '[]');
        let bulks = [];
        try { bulks = JSON.parse(bulksStr); } catch(e){}

        // Crea il dizionario delle Bulk e lo salva in memoria (Includendo anche i pezzi!)
        let bulkDict = {};
        bulks.forEach(b => { bulkDict[b.consId] = { destination: b.destination, pieces: b.pieceCount }; });
        GM_setValue('cb_bulk_dictionary', JSON.stringify(bulkDict));

        let cleanConsIds = [...new Set(bulks.map(b => b.consId).filter(id => id && id.trim() !== ''))];
        GM_setValue('eops_pending_cons', JSON.stringify(cleanConsIds));

        let grouped = {};
        bulks.forEach(b => { if (!grouped[b.destination]) grouped[b.destination] = []; grouped[b.destination].push(b); });

        const overlay = document.createElement('div');
        overlay.className = 'cb-overlay';
        overlay.id = 'cb-results-modal';

        let html = `<div class="cb-modal cb-modal-large"><h2>📊 Report BULK-NO_CONS (Fase 1 completata)</h2><div class="cb-modal-content">`;
        if (Object.keys(grouped).length === 0) {
            html += `<p style="color: #ff9800; font-weight: bold; font-size: 16px;">Nessuna Bulk trovata con i filtri impostati.</p>`;
        } else {
            Object.keys(grouped).sort().forEach(dest => {
                html += `<div class="cb-group-header">Destinazione: ${dest} (${grouped[dest].length} elementi trovati)</div>
                         <table class="cb-table"><thead><tr><th>CONS ID</th><th>ASSET ID</th><th>UNIT TYPE</th><th>STATE</th><th>PIECES</th></tr></thead><tbody>`;
                grouped[dest].forEach(b => html += `<tr><td>${b.consId}</td><td>${b.assetId}</td><td>${b.unitType}</td><td>${b.state}</td><td>${b.pieceCount}</td></tr>`);
                html += `</tbody></table>`;
            });
        }

        html += `</div>
                <div style="text-align: center; margin-bottom: 10px; flex-shrink: 0;">
                    <span style="color: #0df; font-weight: bold; font-size: 16px;">(Trovati ${cleanConsIds.length} CONS univoci da scansionare)</span><br><br>
                    <button class="cb-btn" id="cb-open-eops" style="background-color: #28a745; max-width: 400px; margin: 0 auto;">🚀 VAI ALLA FASE 2 (Apri EOPS)</button>
                </div>
                <button class="cb-btn cb-btn-close" id="cb-close-results">CHIUDI REPORT E FERMA</button>
            </div>`;
        overlay.innerHTML = html;
        document.body.appendChild(overlay);

        document.getElementById('cb-close-results').onclick = () => { overlay.remove(); stopAllProcesses(); };
        let openEopsBtn = document.getElementById('cb-open-eops');
        if (openEopsBtn) {
            openEopsBtn.onclick = () => {
                GM_setValue('eops_auto_mode', true);
                window.open('https://eops-lb-las.prod.cloud.fedex.com/eShipmentGUI/DisplayLinkHandler?id=5', 'eops_tab');
                overlay.remove();
            };
        }
    }

    function showIntermediateResultsModal() {
        let extracted = JSON.parse(GM_getValue('cb_phase2_extracted', '[]'));
        let pending = JSON.parse(GM_getValue('eops_pending_cons', '[]'));

        let overlay = document.createElement('div');
        overlay.className = 'cb-overlay';

        let html = `
            <div class="cb-modal cb-modal-large">
                <h2>🔍 Mapping: CONS --> Tracking Number</h2>
                <div class="cb-modal-content">
                    <table class="cb-table">
                        <thead><tr><th>CONS ID</th><th>TRACKING NUMBER</th></tr></thead><tbody>`;

        extracted.forEach(r => html += `<tr><td><strong style="color:#0df;">${r.cons}</strong></td><td style="color:#fff;">${r.track}</td></tr>`);

        html += `</tbody></table></div>`;

        if (pending.length > 0) {
            html += `<div style="text-align: center; margin-top: 15px; padding: 15px; background: rgba(255, 152, 0, 0.1); border: 1px solid #ff9800; border-radius: 5px;">
                        <p style="color: #ff9800; font-weight: bold; font-size:16px;">Ci sono ancora <span style="font-size:20px; color:#fff;">${pending.length}</span> CONS da scansionare.</p>
                        <button class="cb-btn yos-pulse-text" id="cb-next-30" style="background-color:#28a745; margin-top:10px; max-width: 400px;">GESTISCI I PROSSIMI 30</button>
                     </div>`;
        } else {
            html += `<div style="text-align: center; margin-top: 15px; padding: 15px; background: rgba(40, 167, 69, 0.1); border: 1px solid #28a745; border-radius: 5px;">
                        <span style="color: #28a745; font-weight: bold; font-size:18px;">Tutte le CONS processate! (Fase 2 Finita) 🎉</span>
                        <br><br>
                        <button class="cb-btn yos-pulse-text" id="cb-start-phase3" style="background-color:#9c27b0; max-width: 400px; margin: 0 auto;">🚀 AVVIA FASE 3 (Check Associazioni)</button>
                     </div>`;
        }

        html += `<button class="cb-btn cb-btn-close" id="cb-close-int">CHIUDI E FERMA TUTTO</button></div>`;
        overlay.innerHTML = html;
        document.body.appendChild(overlay);

        document.getElementById('cb-close-int').onclick = () => { overlay.remove(); stopAllProcesses(); };

        let nextBtn = document.getElementById('cb-next-30');
        if (nextBtn) {
            nextBtn.onclick = () => {
                GM_setValue('eops_auto_mode', true);
                window.open('https://eops-lb-las.prod.cloud.fedex.com/eShipmentGUI/DisplayLinkHandler?id=5', 'eops_tab');
                overlay.remove();
            };
        }

        let f3Btn = document.getElementById('cb-start-phase3');
        if (f3Btn) {
            f3Btn.onclick = () => {
                let p2extracted = JSON.parse(GM_getValue('cb_phase2_extracted', '[]'));
                let bDict = JSON.parse(GM_getValue('cb_bulk_dictionary', '{}'));

                // Mappiamo i dati agganciando anche i pezzi dal dizionario
                let p3Queue = p2extracted.map(e => ({
                    cons: e.cons,
                    track: e.track,
                    bulkDestRaw: (bDict[e.cons] && bDict[e.cons].destination) ? bDict[e.cons].destination : 'N/D',
                    pieceCount: (bDict[e.cons] && bDict[e.cons].pieces) ? bDict[e.cons].pieces : 0
                }));

                GM_setValue('cb_phase3_active', true);
                GM_setValue('cb_phase3_queue', JSON.stringify(p3Queue));
                GM_setValue('cb_phase3_results', '[]');
                GM_setValue('cb_phase3_completed', false);

                window.open('https://eai-5530-user-interface-prod.app.paas.fedex.com/pkitracknumber', 'pki_tab');
                overlay.remove();
            };
        }
    }

    function showPhase3ResultsModal(fromBackup = false) {
        let results = [];
        if (fromBackup) {
            let bk = JSON.parse(GM_getValue('cb_backup_data', '{}'));
            results = bk.data || [];
        } else {
            results = JSON.parse(GM_getValue('cb_phase3_results', '[]'));
        }

        // ORDINAMENTO DECRESCENTE PER PEZZI
        results.sort((a, b) => (b.pieceCount || 0) - (a.pieceCount || 0));

        let overlay = document.createElement('div');
        overlay.className = 'cb-overlay';

        let headerText = fromBackup ? '💾 Report Finale (Caricato da Backup)' : '🚢 Report Finale (Associazioni Bulk -> Trailer)';

        let html = `
            <div class="cb-modal cb-modal-large">
                <h2>${headerText}</h2>
                <div class="cb-modal-content">
                    <table class="cb-table">
                        <thead><tr>
                            <th>CONS ID</th>
                            <th>TRACKING NUMBER</th>
                            <th>STATO TRL</th>
                            <th>DEST BULK</th>
                            <th>TNT DEST</th>
                            <th style="text-align:center;">PEZZI</th>
                        </tr></thead><tbody>`;

        results.forEach(r => {
            let tntDest = translateLocID(r.bulkDestRaw);
            let colorStato = r.trlStatus.includes('✅') ? '#28a745' : '#dc3545';

            html += `<tr>
                <td><strong style="color:#0df;">${r.cons}</strong></td>
                <td>${r.track}</td>
                <td style="color:${colorStato}; font-weight:bold;">${r.trlStatus}</td>
                <td>${r.bulkDestRaw || 'N/D'}</td>
                <td style="color:#ff9800; font-weight:bold;">${tntDest}</td>
                <td style="color:#fff; background-color: rgba(0,0,0,0.3); text-align:center; font-weight:bold; border-radius: 4px;">${r.pieceCount || 0}</td>
            </tr>`;
        });

        html += `</tbody></table></div>`;

        if (!fromBackup) {
            html += `<div style="text-align: center; margin-top: 15px; padding: 15px; background: rgba(40, 167, 69, 0.1); border: 2px solid #28a745; border-radius: 5px; margin-bottom: 15px;">
                        <span style="color: #28a745; font-weight: bold; font-size:22px;" class="yos-pulse-text">✅ CHECK FINITO! 🎉</span><br>
                        <span style="color: #fff; font-size: 14px; margin-top:5px; display:inline-block;">Controlla le associazioni qui sopra o scarica il CSV.</span>
                     </div>`;
        }

        // Pulsanti Stacked in colonna come richiesto
        html += `<div style="display: flex; flex-direction: column; gap: 10px;">
                    <button class="cb-btn" id="cb-download-f3" style="background-color: #17a2b8; margin: 0;">📥 SCARICA CSV FINALE</button>
                    <button class="cb-btn cb-btn-close" id="cb-close-f3" style="margin: 0;">CHIUDI E RESETTA</button>
                </div>
            </div>`;

        overlay.innerHTML = html;
        document.body.appendChild(overlay);

        document.getElementById('cb-download-f3').onclick = () => {
            downloadPhase3CSV(results);
        };

        document.getElementById('cb-close-f3').onclick = () => {
            if (!fromBackup) {
                GM_setValue('cb_phase3_results', '[]');
                GM_setValue('cb_phase2_extracted', '[]');
            }
            overlay.remove();
            stopAllProcesses();
        };
    }

    // ==========================================
    // LOGICA FASE 1: CONS MAINTENANCE SWEEPING
    // ==========================================
    function processCbMaintenanceInCons() {
        if (!document.title.includes('CONS Maintenance')) return;

        let cbState = GM_getValue('cb_scan_state', 'STANDBY');

        let banner = document.getElementById('cb-info-banner');
        if (cbState === 'INIT' || cbState === 'SWEEPING') {
            if (!banner) {
                banner = document.createElement('div');
                banner.id = 'cb-info-banner';
                banner.style.cssText = 'position:fixed; bottom:20px; left:20px; background:#ff9800; color:#fff; padding:15px 25px; border-radius:8px; font-weight:bold; font-size:15px; box-shadow: 0 4px 15px rgba(0,0,0,0.6); z-index:9999999; border: 2px solid #e65100; pointer-events:none; font-family: sans-serif;';
                banner.innerHTML = `<span class="yos-pulse-text">⏳ Scansione Bulk in Corso... (NON TOCCARE IL PAGINATORE)</span>`;
                document.body.appendChild(banner);
            }
        } else {
            if (banner) banner.remove();
        }

        if (cbState === 'STANDBY' || cbState === 'COMPLETED') return;

        if (cbState === 'INIT') {
            if (cbInitPhase === 0) {
                cbInitPhase = 1;
                cbActiveBulks = [];
                cbPagePiecesRequested = false;
                deepClearFilters();

                let settingsStr = GM_getValue('cb_settings', '{"hours":"24", "minPieces":1, "csv":"SI"}');
                let settings = JSON.parse(settingsStr);

                setTimeout(() => {
                    const originSelect = document.querySelector('mat-select[formcontrolname="originLocCd"]');
                    if (originSelect && !originSelect.disabled) { forceAggressiveClick(originSelect); setTimeout(() => clickOptionByText('IMRH'), 500); }
                }, 800);

                setTimeout(() => {
                    const hoursSelect = document.querySelector('mat-select[formcontrolname="hours"]');
                    if (hoursSelect && !hoursSelect.disabled) { forceAggressiveClick(hoursSelect); setTimeout(() => clickOptionByText(settings.hours + ' hours'), 500); }
                }, 1800);

                setTimeout(() => {
                    const unitSelect = document.querySelector('mat-select[formcontrolname="unitType"]');
                    if (unitSelect && !unitSelect.disabled) { forceAggressiveClick(unitSelect); setTimeout(() => clickOptionByText('OTHER'), 500); }
                }, 2800);

                setTimeout(() => {
                    const paginatorSelect = document.querySelector('.mat-paginator-page-size-select mat-select');
                    if (paginatorSelect) { forceAggressiveClick(paginatorSelect); setTimeout(() => clickOptionByText('100'), 500); }
                }, 3800);

                setTimeout(() => {
                    const refreshBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText && b.innerText.includes('Refresh CONS Data'));
                    if (refreshBtn) forceAggressiveClick(refreshBtn);

                    cbInitPhase = 2;
                    cbLastPageActionTime = Date.now();
                }, 4800);
            } else if (cbInitPhase === 2) {
                if (Date.now() - cbLastPageActionTime > 3000) {
                    GM_setValue('cb_scan_state', 'SWEEPING');
                    cbInitPhase = 0;
                    cbLastPageActionTime = Date.now();
                    cbPagePiecesRequested = false;
                }
            }
            return;
        }

        if (cbState === 'SWEEPING') {
            let timeOnPage = Date.now() - cbLastPageActionTime;

            if (!cbPagePiecesRequested && timeOnPage > 2000) {
                let clickedAny = false;

                const viewBtns = document.querySelectorAll('button[title="Click to view piece count"]');
                viewBtns.forEach(btn => { forceAggressiveClick(btn); clickedAny = true; });

                const refreshPieceBtns = document.querySelectorAll('.piece-count-refresh');
                refreshPieceBtns.forEach(btn => {
                    forceAggressiveClick(btn);
                    const parent = btn.closest('button') || btn.parentElement;
                    if(parent) forceAggressiveClick(parent);
                    clickedAny = true;
                });

                cbPagePiecesRequested = true;
                if (clickedAny) {
                    console.log("[CB Modulo] View cliccati, attendo 2.5s per il caricamento...");
                    cbLastPageActionTime = Date.now();
                } else {
                    cbLastPageActionTime = Date.now() - 1000;
                }
                return;
            }

            if (cbPagePiecesRequested && timeOnPage > 2500) {
                console.log("[CB Modulo] Estrazione dati in corso...");

                let settingsStr = GM_getValue('cb_settings', '{"minPieces":1}');
                let settings = JSON.parse(settingsStr);
                let minThreshold = settings.minPieces || 1;

                document.querySelectorAll('tbody tr').forEach(row => {
                    const stateNode = row.querySelector('td.mat-column-positionState');
                    if (stateNode && stateNode.innerText.trim().toUpperCase() === 'ABANDONED') return;

                    const unitTypeNode = row.querySelector('td.mat-column-unitType');
                    if (unitTypeNode && unitTypeNode.innerText.trim().toUpperCase() !== 'OTHER') return;

                    const consIdNode = row.querySelector('td.mat-column-consId');
                    const consId = consIdNode ? consIdNode.innerText.trim().toUpperCase() : '';
                    const assetIdNode = row.querySelector('td.mat-column-assetId');
                    const assetId = assetIdNode ? assetIdNode.innerText.trim().toUpperCase() : '';
                    const destNode = row.querySelector('td.mat-column-destinationLocCd') || row.querySelector('td.mat-column-destination');
                    const rawDest = destNode ? destNode.innerText.trim() : '';

                    let pieceCount = 0;
                    const pieceSpan = row.querySelector('.piece-count');
                    if (pieceSpan) pieceCount = parseInt(pieceSpan.innerText.replace(/\D/g, ''), 10) || 0;

                    if (consId !== '' && pieceCount > minThreshold) {
                        if (!cbActiveBulks.some(b => b.consId === consId)) {
                            cbActiveBulks.push({ consId, assetId, unitType: 'OTHER', state: stateNode ? stateNode.innerText.trim().toUpperCase() : '', destination: rawDest, pieceCount });
                        }
                    }
                });

                const nextBtn = document.querySelector('button[aria-label="Next page"]');
                const isNextDisabled = !nextBtn || nextBtn.disabled || nextBtn.hasAttribute('disabled') || nextBtn.classList.contains('mat-button-disabled');

                if (!isNextDisabled) {
                    console.log("[CB Modulo] Vado alla pagina successiva (NEXT)");
                    forceAggressiveClick(nextBtn);
                    cbPagePiecesRequested = false;
                    cbLastPageActionTime = Date.now();
                } else {
                    console.log("[CB Modulo] Fine delle pagine raggiunto! Salvataggio in corso...");
                    GM_setValue('cb_found_bulks', JSON.stringify(cbActiveBulks));
                    GM_setValue('cb_scan_state', 'COMPLETED');
                }
            }
        }
    }

    // ==========================================
    // LOGICA FASE 2 E 3: GESTIONE MODALI YOS E AUTOMAZIONE
    // ==========================================
    setInterval(() => {
        let isYos = window.location.href.includes('hub-overview');
        let hasSelectReportBtn = document.querySelector('input[type="submit"][value="Select Report"]') !== null;
        let hasTextArea = document.querySelector('textarea[name="delimitedTrackingNumber"]') !== null;
        let isEopsList = document.body.innerText.includes('CONS Report Results') && document.querySelectorAll('a[href*="method=displayDetail"]').length > 0;
        let isAutoMode = GM_getValue('eops_auto_mode', false);

        if (isYos) {
            let cbState = GM_getValue('cb_scan_state', 'STANDBY');
            let f1Loader = document.getElementById('cb-loader-overlay');

            if (cbState === 'INIT' || cbState === 'SWEEPING') {
                if (!f1Loader) {
                    let d = document.createElement('div');
                    d.className = 'cb-overlay';
                    d.id = 'cb-loader-overlay';
                    d.innerHTML = `
                        <div class="cb-modal cb-modal-small" style="text-align: center; pointer-events: none;">
                            <h2 class="yos-pulse-text" style="color: #ff9800; font-size: 20px; border: none;">🛑 Controllo BULK-NO_CONS in corso...</h2>
                            <p style="font-size: 15px; font-weight: bold; color: #fff; margin-top: 10px;">
                                Input bloccati. Attendi che arrivi il report 30 per 30.
                            </p>
                        </div>`;
                    document.body.appendChild(d);
                }
            } else if (cbState === 'COMPLETED') {
                if (f1Loader) f1Loader.remove();
                GM_setValue('cb_scan_state', 'STANDBY');
                let bulks = []; try { bulks = JSON.parse(GM_getValue('cb_found_bulks', '[]')); } catch(e){}
                try { if (JSON.parse(GM_getValue('cb_settings', '{}')).csv === 'SI') downloadCSV(bulks); } catch(e) {}
                showCbResultsModal();
            } else {
                if (f1Loader) f1Loader.remove();
            }

            if (GM_getValue('cb_show_intermediate_yos', false)) {
                GM_setValue('cb_show_intermediate_yos', false);
                showIntermediateResultsModal();
            }

            if (GM_getValue('cb_phase3_completed', false)) {
                GM_setValue('cb_phase3_completed', false);
                alert("✅ CHECK FINITO! Controlla YOS.");
                showPhase3ResultsModal();
            }

            injectYosSidebarButtons();
        }

        if (hasSelectReportBtn && !window.autoSelectDone && isAutoMode) {
            window.autoSelectDone = true;
            let panel = document.createElement('div');
            panel.className = 'eops-manual-panel';
            panel.innerHTML = `<span style="color:#0df; font-weight:bold;" class="yos-pulse-text">⏳ Automazione: Seleziono Report...</span>`;
            document.body.appendChild(panel);
            setTimeout(() => document.querySelector('input[type="submit"][value="Select Report"]').click(), 800);
        }

        if (hasTextArea && !window.autoPasteDone && isAutoMode) {
            window.autoPasteDone = true;
            let pending = JSON.parse(GM_getValue('eops_pending_cons', '[]'));
            let panel = document.createElement('div');
            panel.className = 'eops-manual-panel';

            if (pending.length === 0) {
                panel.innerHTML = `<span style="color:#ff9800; font-weight:bold;">Tutti i CONS sono stati analizzati.</span>`;
                document.body.appendChild(panel);
                GM_setValue('eops_auto_mode', false);
                return;
            }

            panel.innerHTML = `<span style="color:#0df; font-weight:bold;" class="yos-pulse-text">⏳ Inserimento tranche CONS...</span>`;
            document.body.appendChild(panel);

            setTimeout(() => {
                let batch = pending.slice(0, 30);
                let remaining = pending.slice(30);
                GM_setValue('eops_pending_cons', JSON.stringify(remaining));

                let textArea = document.querySelector('textarea[name="delimitedTrackingNumber"]');
                textArea.value = batch.join('\n');
                textArea.dispatchEvent(new Event('input', {bubbles: true}));
                textArea.dispatchEvent(new Event('change', {bubbles: true}));
                setTimeout(() => document.querySelector('input[type="submit"][value="Query Report"]')?.click(), 800);
            }, 800);
        }

        if (isEopsList && isAutoMode && !document.getElementById('panel-eops-3')) {
            let panel = document.createElement('div');
            panel.id = 'panel-eops-3'; panel.className = 'eops-manual-panel';
            panel.innerHTML = `<button class="eops-btn-action" id="btn-step-3" style="background-color:#9c27b0;">3. Apri Tutto (Estrai Tracking)</button>`;
            document.body.appendChild(panel);

            document.getElementById('btn-step-3').onclick = async () => {
                let btn = document.getElementById('btn-step-3');
                btn.innerText = "⏳ Estrazione in background (non chiudere)...";
                btn.disabled = true;

                let links = Array.from(document.querySelectorAll('a[href*="method=displayDetail"]'));
                let extracted = [];

                for (let a of links) {
                    let tr = a.closest('tr');
                    let consId = tr ? tr.cells[0].innerText.trim() : 'UNKNOWN';
                    try {
                        let response = await fetch(a.href);
                        let html = await response.text();
                        let doc = new DOMParser().parseFromString(html, "text/html");
                        let tables = doc.querySelectorAll('.report');
                        let track = "N/D";

                        if(tables.length > 1) {
                            let rows = tables[1].querySelectorAll('tr');
                            if(rows.length > 1) {
                                let cell = rows[1].querySelectorAll('td')[0];
                                if(cell) track = cell.innerText.trim();
                            }
                        }
                        extracted.push({ cons: consId, track: track });
                    } catch(e) {
                        console.error("[CB Modulo] Errore fetch per " + consId, e);
                        extracted.push({ cons: consId, track: "ERRORE CONNESSIONE" });
                    }
                }

                let allExtracted = JSON.parse(GM_getValue('cb_phase2_extracted', '[]'));
                allExtracted = allExtracted.concat(extracted);
                GM_setValue('cb_phase2_extracted', JSON.stringify(allExtracted));
                GM_setValue('cb_show_intermediate_yos', true);

                btn.innerText = "✅ Estrazione Fatta! Controlla YOS.";
                btn.style.backgroundColor = "#28a745";
            };
        }
    }, 1000);

    // ==========================================
    // LOGICA FASE 3: PACKAGE INQUIRY (ESTRAZIONE ASSOCIAZIONI BULK/TRAILER)
    // ==========================================
    setInterval(() => {
        let isPki = window.location.href.includes('pkitracknumber');
        if (!isPki) return;

        let isPhase3Active = GM_getValue('cb_phase3_active', false);
        if (!isPhase3Active) return;

        let queue = JSON.parse(GM_getValue('cb_phase3_queue', '[]'));

        if (queue.length === 0) {
            // SALVA BACKUP PRIMA DI CHIUDERE LA FASE 3
            let finalResults = JSON.parse(GM_getValue('cb_phase3_results', '[]'));
            GM_setValue('cb_backup_data', JSON.stringify({ timestamp: Date.now(), data: finalResults }));

            GM_setValue('cb_phase3_active', false);
            GM_setValue('cb_phase3_completed', true);
            let panel = document.getElementById('pki-panel');
            if(panel) panel.innerHTML = `<span style="color:#28a745; font-weight:bold;">✅ FASE 3 COMPLETATA! Controlla YOS.</span>`;
            return;
        }

        let panel = document.getElementById('pki-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'pki-panel';
            panel.className = 'eops-manual-panel';
            document.body.appendChild(panel);
        }

        let currentItem = queue[0];
        let trackUpper = currentItem.track ? currentItem.track.toUpperCase().trim() : "";
        panel.innerHTML = `<span style="color:#0df; font-weight:bold;" class="yos-pulse-text">⏳ Fase 3: Cerco Stato Trailer per ${trackUpper} (${queue.length} rimanenti)</span>`;

        let isInvalidTrack = !trackUpper ||
                             trackUpper === "N/D" ||
                             trackUpper.includes("ERRORE") ||
                             trackUpper.includes("NO PACKAGE") ||
                             !/^[A-Z0-9]+$/.test(trackUpper);

        if (isInvalidTrack) {
            currentItem.trlStatus = "❌ NO TRACKING";
            let results = JSON.parse(GM_getValue('cb_phase3_results', '[]'));
            results.push(currentItem);
            GM_setValue('cb_phase3_results', JSON.stringify(results));

            queue.shift();
            GM_setValue('cb_phase3_queue', JSON.stringify(queue));
            return;
        }

        let inputField = document.getElementById('packageTrackingNumber');

        let isResultPage = document.body.innerText.includes('Scan Activity') || document.body.innerText.includes('Status/Comments');
        let notFound = document.body.innerText.includes('No results') || document.body.innerText.includes('Not Found');

        if (isResultPage || notFound) {
            if (!window.phase3ResultExtracted) {
                window.phase3ResultExtracted = true;

                let foundNewerTrailer = false;

                if (!notFound) {
                    let trs = document.querySelectorAll('tr');
                    for (let r of trs) {
                        let rowText = r.innerText.toUpperCase();

                        if (rowText.includes(currentItem.cons.toUpperCase())) {
                            break;
                        }

                        if (rowText.includes('DIRECTED_HANDLING')) {
                            if (rowText.includes('TRAILER') || rowText.includes('TRUCK')) {
                                foundNewerTrailer = true;
                            }
                        }
                    }
                }

                currentItem.trlStatus = foundNewerTrailer ? '✅ ASSOCIATA A TRL' : '❌ NON ASSOCIATA A TRL';

                let results = JSON.parse(GM_getValue('cb_phase3_results', '[]'));
                results.push(currentItem);
                GM_setValue('cb_phase3_results', JSON.stringify(results));

                queue.shift();
                GM_setValue('cb_phase3_queue', JSON.stringify(queue));

                setTimeout(() => {
                    window.location.href = 'https://eai-5530-user-interface-prod.app.paas.fedex.com/pkitracknumber';
                }, 1000);
            }
        }
        else if (inputField) {
            window.phase3ResultExtracted = false;

            if (!window.phase3SearchTriggered || window.lastSearchedTrack !== currentItem.track) {
                window.phase3SearchTriggered = true;
                window.lastSearchedTrack = currentItem.track;

                inputField.focus();
                inputField.value = currentItem.track;
                inputField.dispatchEvent(new Event('input', {bubbles: true}));
                inputField.dispatchEvent(new Event('change', {bubbles: true}));
                inputField.blur();

                setTimeout(() => {
                    let submitBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim().toUpperCase() === 'SUBMIT' || b.textContent.trim().toUpperCase() === 'SUBMIT');
                    if (submitBtn) submitBtn.click();
                }, 800);
            }
        }
    }, 1500);

    // ==========================================
    // INIT IN CONS MAINTENANCE
    // ==========================================
    setInterval(() => {
        if (document.title.includes('CONS Maintenance')) processCbMaintenanceInCons();
    }, 1000);

})();

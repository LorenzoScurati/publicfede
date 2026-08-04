// ==UserScript==
// @name         YOS & CONS Sync Overlay (Zone 300/400) - PRO V2.9.5
// @namespace    http://tampermonkey.net/
// @version      2.9.5
// @description  Audio Wake Lock (Background), Double check Colli esteso (2.5s).
// @author       Lorenzo Scurati
// @match        https://yos.apps.tnt.com/hub-overview*
// @match        https://dh-cons-maintenance-ui-production-directed-handling.fxi-001.fxi-prod.az.fxei.fedex.com/*
// @updateURL    https://raw.githubusercontent.com/LorenzoScurati/publicfede/main/YOS_CONS.user.js
// @downloadURL  https://raw.githubusercontent.com/LorenzoScurati/publicfede/main/YOS_CONS.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function() {
    'use strict';

    let isAutoScanActive = true;
    let isManualModeActive = false;
    let isRewinding = false;
    let lastClickTime = 0;

    let isProcessingCommand = false;

    let isInitializing = true;
    let hasInitializedFilters = false;
    let initCountdown = 3; 

    let completedSweeps = 0;

    let activeTrailers = {};
    let tempCycleTrailers = {};

    // ==========================================
    // DIZIONARIO FEDEX -> TNT (Per Origine e Destinazione)
    // ==========================================
    const fedexToTntMap = {
        "CDGT9": "06A", "AOIP": "AN6", "AOTT8": "AOT", "ATHA": "ATH+", "BRIP": "BA5",
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
        if (!code) return '-';
        return fedexToTntMap[code.toUpperCase()] || code.toUpperCase();
    }

    // ==========================================
    // STILI CSS
    // ==========================================
    const style = document.createElement('style');
    style.innerHTML = `
        div[id^="container_"] { position: relative !important; }
        .yos-container-custom-info {
            position: absolute; left: 50%; transform: translate(-50%, -50%);
            font-size: 13px; font-weight: bold; color: #ffffff;
            background-color: rgba(0, 0, 0, 0.6);
            padding: 1px 5px; border-radius: 3px; z-index: 99; pointer-events: none;
            white-space: nowrap; transition: background-color 0.3s, color 0.3s, border 0.3s;
        }
        .yos-zone-400 { top: 18% !important; }
        .yos-zone-300 { top: 82% !important; }

        .yos-piece-count-badge {
            position: absolute; left: 50%;
            font-size: 11px; font-weight: bold; color: #0df;
            background-color: rgba(0, 0, 0, 0.85);
            padding: 1px 4px; border-radius: 3px; z-index: 98; pointer-events: none;
            white-space: nowrap; border: 1px solid #0df; box-shadow: 0 0 5px rgba(0,221,255,0.5);
            transition: all 0.3s;
        }
        .yos-pc-400 { top: 38%; transform: translateX(-50%); }
        .yos-pc-300 { top: 62%; transform: translate(-50%, -100%); }

        #tnt-cons-dashboard {
            position: fixed; bottom: 20px; left: 20px; z-index: 999999;
            display: flex; flex-direction: column; gap: 8px;
            font-family: Roboto, sans-serif; font-size: 13px; font-weight: bold;
        }
        .cons-dash-btn {
            padding: 10px 20px; border-radius: 5px; color: white;
            font-weight: bold; border: 1px solid rgba(255,255,255,0.2); cursor: pointer;
            box-shadow: 0 4px 10px rgba(0,0,0,0.5); transition: background 0.2s;
        }
        #tnt-cons-autoscan-btn { background: #28a745; }
        #tnt-cons-manual-btn { background: #6c757d; }

        .cons-info-box {
            padding: 8px 15px; border-radius: 5px; background: #1e1e1e; color: #e3e3e3;
            border: 1px solid #444; box-shadow: 0 4px 10px rgba(0,0,0,0.5); text-align: center;
        }
        .text-warning { color: #ffc107; }
        .text-ready { color: #00bcd4; }
        .text-danger { color: #dc3545; }

        #tnt-yos-bottom-container {
            position: fixed; bottom: 20px; right: 20px; z-index: 999999;
            display: flex; gap: 10px; align-items: center; font-family: Roboto, sans-serif;
        }
        #tnt-yos-sync-status {
            padding: 8px 15px; border-radius: 20px; color: white; font-weight: bold; font-size: 12px;
            box-shadow: 0 4px 10px rgba(0,0,0,0.5); display: flex; align-items: center; gap: 8px;
            pointer-events: none; transition: background-color 0.3s;
        }
        #tnt-yos-restart-btn {
            padding: 8px 15px; border-radius: 20px; color: white; font-weight: bold; font-size: 12px;
            background-color: #007bff; border: 1px solid rgba(255,255,255,0.2); cursor: pointer;
            box-shadow: 0 4px 10px rgba(0,0,0,0.5); transition: background-color 0.3s;
        }
        #tnt-yos-restart-btn:hover { background-color: #0056b3; }
        .sync-dot {
            width: 10px; height: 10px; border-radius: 50%; background-color: white; box-shadow: 0 0 5px rgba(255,255,255,0.8);
        }
        #tnt-yos-remote-control {
            position: fixed; bottom: 65px; right: 20px; z-index: 999999;
            padding: 12px 15px; border-radius: 8px; background: #1e1e1e; color: #e3e3e3;
            font-family: Roboto, sans-serif; font-size: 12px; font-weight: bold;
            box-shadow: 0 4px 10px rgba(0,0,0,0.6); border: 1px solid #444;
            display: flex; flex-direction: column; gap: 8px;
        }
        .yos-control-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        #tnt-yos-remote-control select {
            background: #333; color: white; border: 1px solid #555; padding: 4px 8px;
            border-radius: 4px; outline: none; font-weight: bold; cursor: pointer; min-width: 110px;
        }
        @keyframes yos-pulse {
            0% { opacity: 1; }
            50% { opacity: 0.4; }
            100% { opacity: 1; }
        }
        .yos-pulse-text {
            animation: yos-pulse 1.5s infinite;
        }
    `;
    document.head.appendChild(style);

    // ==========================================
    // UTILS
    // ==========================================
    function forceAggressiveClick(btn) {
        if (!btn) return;
        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
            if (opt.innerText.trim() === text) forceAggressiveClick(opt);
        });
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

    function formatShortDate(dateStr) {
        if (!dateStr || dateStr === '-') return '-';
        return dateStr.replace(/[-/]?20\d{2}/g, '').trim();
    }

    // ==========================================
    // HACK: AUDIO WAKE LOCK (Anti-Throttling Background)
    // ==========================================
    let isAudioPlaying = false;
    function enableAudioWakeLock() {
        if (isAudioPlaying) return;
        if (!document.title.includes('CONS Maintenance')) return;

        try {
            // Traccia WAV silente generata in Base64 (pochi byte)
            const silentAudioUrl = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
            const audio = new Audio(silentAudioUrl);
            audio.loop = true;
            audio.play().then(() => {
                isAudioPlaying = true;
                console.log('[YOS-SYNC] 🎵 Audio Wake Lock ATTIVO: La tab è forzata ad alta priorità in background.');
            }).catch(e => {
                console.warn('[YOS-SYNC] 🔇 Autoplay bloccato. Fai un clic sulla pagina CONS per attivare l\'anti-throttling.');
            });
        } catch (e) {}
    }

    // Il browser blocca l'audio automatico, quindi lo accendiamo al primo clic sulla pagina
    document.addEventListener('click', enableAudioWakeLock, { once: true });


    // ==========================================
    // UI: CONS MAINTENANCE
    // ==========================================
    function injectConsDashboard() {
        if (!document.title.includes('CONS Maintenance')) return;

        let dashboard = document.getElementById('tnt-cons-dashboard');
        if (!dashboard) {
            dashboard = document.createElement('div');
            dashboard.id = 'tnt-cons-dashboard';

            const manualBtn = document.createElement('button');
            manualBtn.id = 'tnt-cons-manual-btn';
            manualBtn.className = 'cons-dash-btn';
            manualBtn.innerHTML = '🛠️ Lavoro Manuale: OFF';
            manualBtn.onclick = () => {
                enableAudioWakeLock(); // Clic sul bottone conta per l'audio lock!
                isManualModeActive = !isManualModeActive;
                const autoBtn = document.getElementById('tnt-cons-autoscan-btn');
                if (isManualModeActive) {
                    manualBtn.innerHTML = '🛠️ Lavoro Manuale: ON';
                    manualBtn.style.background = '#dc3545';
                    isAutoScanActive = false;
                    if(autoBtn) { autoBtn.innerHTML = '⏸️ Auto-Scan: BLOCCATO'; autoBtn.style.background = '#6c757d'; }
                    GM_setValue('cons_scan_state', 'MANUAL_MODE');
                    GM_setValue('cons_single_check_queue', '[]');
                } else {
                    manualBtn.innerHTML = '🛠️ Lavoro Manuale: OFF';
                    manualBtn.style.background = '#6c757d';
                    GM_setValue('cons_scan_state', 'PAUSED');
                    if(autoBtn) { autoBtn.innerHTML = '⏸️ Auto-Scan: PAUSA'; autoBtn.style.background = '#ff9800'; }
                }
            };

            const autoBtn = document.createElement('button');
            autoBtn.id = 'tnt-cons-autoscan-btn';
            autoBtn.className = 'cons-dash-btn';
            autoBtn.innerHTML = '🔄 Auto-Scan: ON';
            autoBtn.onclick = () => {
                enableAudioWakeLock(); // Clic sul bottone conta per l'audio lock!
                
                if (isManualModeActive) {
                    isManualModeActive = false;
                    manualBtn.innerHTML = '🛠️ Lavoro Manuale: OFF';
                    manualBtn.style.background = '#6c757d';
                }

                if (!isAutoScanActive && completedSweeps >= 2) {
                    autoBtn.innerHTML = '⏳ Riavvio in corso...';
                    autoBtn.style.background = '#ffc107';
                    GM_setValue('cons_active_trailers', '{}');
                    GM_setValue('cons_initial_scan_done', false);
                    deepClearFilters();
                    setTimeout(() => location.reload(), 500);
                    return;
                }

                isAutoScanActive = !isAutoScanActive;
                if (isAutoScanActive) {
                    autoBtn.innerHTML = '🔄 Auto-Scan: ON';
                    autoBtn.style.background = '#28a745';
                    GM_setValue('cons_scan_state', 'RUNNING');
                } else {
                    autoBtn.innerHTML = '⏸️ Auto-Scan: PAUSA';
                    autoBtn.style.background = '#ff9800';
                    isRewinding = false;
                    GM_setValue('cons_scan_state', 'PAUSED');
                }
            };

            const infoBox = document.createElement('div');
            infoBox.id = 'tnt-cons-timer-box';
            infoBox.className = 'cons-info-box';
            infoBox.innerHTML = "In attesa della pagina...";

            dashboard.appendChild(manualBtn);
            dashboard.appendChild(autoBtn);
            dashboard.appendChild(infoBox);
            document.body.appendChild(dashboard);
        }

        const infoBox = document.getElementById('tnt-cons-timer-box');
        if (infoBox) {
            if (isManualModeActive) {
                infoBox.innerHTML = "<span class='text-danger'>MODALITÀ MANUALE ATTIVA (Sync Sospeso)</span>";
            } else if (isInitializing) {
                infoBox.innerHTML = "Avvio in: <span class='text-warning'>" + initCountdown + "s</span>";
            } else if (!isAutoScanActive && completedSweeps >= 2) {
                infoBox.innerHTML = "<span class='text-ready'>IN PAUSA: Dati Pronti (Cicli Terminati)</span>";
            } else if (!isAutoScanActive) {
                infoBox.innerHTML = "<span class='text-warning'>IN PAUSA (In attesa)</span>";
            } else {
                infoBox.innerHTML = "Scansione in corso... <small>(" + completedSweeps + "/2 giri completati)</small>";
            }
        }
    }

    // ==========================================
    // LOGICA SETUP VELOCIZZATO (2.5 Secondi)
    // ==========================================
    function runSetupSequence() {
        if (hasInitializedFilters) return;
        const resetBtn = document.querySelector('button[title="Reset filter"]');
        if (!resetBtn) return;

        hasInitializedFilters = true;
        const targetHours = GM_getValue('cons_target_hours', '24');
        const targetUnit = GM_getValue('cons_target_unittype', 'NONE');

        GM_setValue('cons_scan_state', 'RUNNING');
        GM_setValue('cons_initial_scan_done', false);

        setTimeout(deepClearFilters, 200);

        setTimeout(() => {
            const originSelect = document.querySelector('mat-select[formcontrolname="originLocCd"]');
            if (originSelect && !originSelect.disabled) { forceAggressiveClick(originSelect); setTimeout(() => clickOptionByText('IMRH'), 300); }
        }, 500);

        setTimeout(() => {
            const hoursSelect = document.querySelector('mat-select[formcontrolname="hours"]');
            if (hoursSelect && !hoursSelect.disabled) { forceAggressiveClick(hoursSelect); setTimeout(() => clickOptionByText(targetHours + ' hours'), 300); }
        }, 1000);

        setTimeout(() => {
            const unitSelect = document.querySelector('mat-select[formcontrolname="unitType"]');
            if (unitSelect && !unitSelect.disabled) {
                if (targetUnit === "NONE") {
                    const parentField = unitSelect.closest('.mat-form-field');
                    const closeBtn = parentField ? parentField.querySelector('button.close-icon') : null;
                    if (closeBtn && window.getComputedStyle(closeBtn).visibility !== 'hidden') forceAggressiveClick(closeBtn);
                } else {
                    forceAggressiveClick(unitSelect); setTimeout(() => clickOptionByText(targetUnit), 300);
                }
            }
        }, 1500);

        setTimeout(() => {
            const paginatorSelect = document.querySelector('.mat-paginator-page-size-select mat-select');
            if (paginatorSelect) { forceAggressiveClick(paginatorSelect); setTimeout(() => clickOptionByText('100'), 300); }
        }, 2000);

        setTimeout(() => {
            isInitializing = false;
            lastClickTime = 0;
        }, 2500);
    }

    // ==========================================
    // TIMER GLOBALE 1 SECONDO (Pause Check)
    // ==========================================
    setInterval(() => {
        if (document.title.includes('CONS Maintenance')) {
            if (GM_getValue('cons_hard_reset_command', false)) {
                GM_setValue('cons_hard_reset_command', false);
                GM_setValue('cons_active_trailers', '{}');
                GM_setValue('cons_initial_scan_done', false);
                deepClearFilters();
                setTimeout(() => location.reload(), 500);
                return;
            }

            if (isInitializing && hasInitializedFilters) {
                if (initCountdown > 0) initCountdown--;
            } else if (!isInitializing && isAutoScanActive && !isManualModeActive) {
                if (completedSweeps >= 2) {
                    isAutoScanActive = false;
                    GM_setValue('cons_scan_state', 'COMPLETED');
                    GM_setValue('cons_initial_scan_done', true);

                    const btn = document.getElementById('tnt-cons-autoscan-btn');
                    if (btn) {
                        btn.innerHTML = '▶️ RIPARTI (Hard Reset)';
                        btn.style.background = '#007bff';
                    }

                    const finalRefreshBtn = document.querySelector('button[title="Reset filter"]');
                    if (finalRefreshBtn) forceAggressiveClick(finalRefreshBtn);
                }
            }
        }
    }, 1000);

    // ==========================================
    // ESECUZIONE SINGOLO CHECK (PRIORITÀ)
    // ==========================================
    function finalizeSingleCheck(targetId, newRecords) {
        activeTrailers[targetId] = newRecords;
        GM_setValue('cons_active_trailers', JSON.stringify(activeTrailers));
        GM_setValue('cons_last_heartbeat', Date.now());

        deepClearFilters();
        setTimeout(() => {
            const refreshBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText && b.innerText.includes('Refresh CONS Data'));
            if (refreshBtn) forceAggressiveClick(refreshBtn);

            setTimeout(() => {
                isProcessingCommand = false;
                lastClickTime = Date.now();
                
                isAutoScanActive = false;
                GM_setValue('cons_scan_state', 'PAUSED_POST_CHECK');
                
                const autoBtn = document.getElementById('tnt-cons-autoscan-btn');
                if (autoBtn) {
                    autoBtn.innerHTML = '⏸️ Auto-Scan: PAUSA (Post-Check)';
                    autoBtn.style.background = '#ff9800';
                }
            }, 1000);
        }, 500);
    }

    function processSingleCheckQueue() {
        if (!GM_getValue('cons_initial_scan_done', false)) return false;
        if (isProcessingCommand) return true;
        
        if (isManualModeActive) {
            GM_setValue('cons_single_check_queue', '[]'); 
            return false;
        }

        let queueStr = GM_getValue('cons_single_check_queue', '[]');
        let queue = [];
        try { queue = JSON.parse(queueStr); } catch(e){}

        if (queue.length === 0) return false;

        let targetId = queue.shift();
        GM_setValue('cons_single_check_queue', JSON.stringify(queue));

        console.log(`[YOS-SYNC] 🔍 SINGLE CHECK FASE 1: Avviato per Trailer: ${targetId}`);
        isProcessingCommand = true;
        GM_setValue('cons_scan_state', 'SINGLE_CHECK');

        deepClearFilters();

        setTimeout(() => {
            let inputs = document.querySelectorAll('input');
            let tInput = Array.from(inputs).find(i => i.getAttribute('formcontrolname') === 'trailerAssetId' || (i.placeholder && i.placeholder.includes('Trailer')));

            if (tInput) {
                tInput.value = targetId;
                tInput.dispatchEvent(new Event('input', {bubbles: true}));
                tInput.dispatchEvent(new Event('change', {bubbles: true}));
            }

            setTimeout(() => {
                const refreshBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText && b.innerText.includes('Refresh CONS Data'));
                forceAggressiveClick(refreshBtn);

                setTimeout(() => {
                    const viewBtns = document.querySelectorAll('button[title="Click to view piece count"]');
                    viewBtns.forEach(btn => forceAggressiveClick(btn));

                    const refreshPieceBtns = document.querySelectorAll('.piece-count-refresh');
                    refreshPieceBtns.forEach(btn => {
                        forceAggressiveClick(btn);
                        const parent = btn.closest('button') || btn.parentElement;
                        if(parent) forceAggressiveClick(parent);
                    });

                    // FASE 1 - ESTRAZIONE (Con Double Check Esteso)
                    setTimeout(() => {
                        
                        const executeFase1 = (isRetry) => {
                            let newRecords = [];
                            let targetDestRaw = null;
                            let needsRetryForPieces = false;

                            const rows = document.querySelectorAll('tbody tr');
                            rows.forEach(row => {
                                const tIdNode = row.querySelector('td.mat-column-trailerAssetId');
                                if (!tIdNode || tIdNode.innerText.trim().toUpperCase() !== targetId) return;

                                const destNode = row.querySelector('td.mat-column-destinationLocCd') || row.querySelector('td.mat-column-destination');
                                const rawDest = destNode ? destNode.innerText.trim() : '';
                                if (!targetDestRaw && rawDest !== '') {
                                    targetDestRaw = rawDest;
                                }

                                const stateNode = row.querySelector('td.mat-column-positionState');
                                const state = stateNode ? stateNode.innerText.trim().toUpperCase() : '';
                                
                                if (state === 'ABANDONED') return;

                                const consIdNode = row.querySelector('td.mat-column-consId');
                                const consId = consIdNode ? consIdNode.innerText.trim().toUpperCase() : '';

                                const unitTypeNode = row.querySelector('td.mat-column-unitType');
                                const unitType = unitTypeNode ? unitTypeNode.innerText.trim().toUpperCase() : '';

                                const assetIdNode = row.querySelector('td.mat-column-assetId');
                                const assetId = assetIdNode ? assetIdNode.innerText.trim().toUpperCase() : '';

                                const originNode = row.querySelector('td.mat-column-originLocCd') || row.querySelector('td.mat-column-origin');
                                const rawOrigin = originNode ? originNode.innerText.trim() : '';
                                const origin = translateLocID(rawOrigin);
                                const destination = translateLocID(rawDest);

                                const openNode = row.querySelector('td.mat-column-openDate') || row.querySelector('td.mat-column-openDt');
                                const openDate = openNode ? openNode.innerText.trim().replace(/\n/g, ' ') : '';

                                const closeNode = row.querySelector('td.mat-column-closeDate') || row.querySelector('td.mat-column-closeDt');
                                const closeDate = closeNode ? closeNode.innerText.trim().replace(/\n/g, ' ') : '';

                                let pieceCount = 0;
                                const pieceSpan = row.querySelector('.piece-count');
                                if (pieceSpan) {
                                    let parsed = parseInt(pieceSpan.innerText.replace(/\D/g, ''), 10);
                                    if (!isNaN(parsed)) pieceCount = parsed;
                                }

                                if (consId !== '') {
                                    // Se siamo nel primo tentativo e i colli sono vuoti/zero, forziamo il retry
                                    if (pieceCount === 0 && !isRetry) {
                                        needsRetryForPieces = true;
                                    }
                                    newRecords.push({ state, assetId, unitType, pieceCount, consId, origin, destination, openDate, closeDate });
                                }
                            });

                            if (needsRetryForPieces) {
                                console.log(`[YOS-SYNC] ⚠️ Colli vuoti, attesa extra per caricamento FedEx (2.5 sec)...`);
                                setTimeout(() => executeFase1(true), 2500); // 2.5 SECONDI EXTRA
                                return;
                            }

                            // FASE 2
                            if (targetDestRaw) {
                                console.log(`[YOS-SYNC] 🔍 SINGLE CHECK FASE 2: Cerco Bulk/Bag (OTHER) per dest: ${targetDestRaw}`);
                                deepClearFilters();

                                setTimeout(() => {
                                    let destInput = Array.from(document.querySelectorAll('input')).find(i => i.getAttribute('formcontrolname') === 'destinationLocCd' || (i.placeholder && i.placeholder.includes('Destination')));
                                    if (destInput) {
                                        destInput.value = targetDestRaw;
                                        destInput.dispatchEvent(new Event('input', {bubbles: true}));
                                        destInput.dispatchEvent(new Event('change', {bubbles: true}));
                                    }

                                    const unitSelect = document.querySelector('mat-select[formcontrolname="unitType"]');
                                    if (unitSelect && !unitSelect.disabled) {
                                        forceAggressiveClick(unitSelect);

                                        setTimeout(() => {
                                            clickOptionByText('OTHER');

                                            setTimeout(() => {
                                                const refreshBtn2 = Array.from(document.querySelectorAll('button')).find(b => b.innerText && b.innerText.includes('Refresh CONS Data'));
                                                forceAggressiveClick(refreshBtn2);

                                                setTimeout(() => {
                                                    const viewBtns2 = document.querySelectorAll('button[title="Click to view piece count"]');
                                                    viewBtns2.forEach(btn => forceAggressiveClick(btn));

                                                    const refreshPieceBtns2 = document.querySelectorAll('.piece-count-refresh');
                                                    refreshPieceBtns2.forEach(btn => {
                                                        forceAggressiveClick(btn);
                                                        const parent = btn.closest('button') || btn.parentElement;
                                                        if(parent) forceAggressiveClick(parent);
                                                    });

                                                    setTimeout(() => {
                                                        const rows2 = document.querySelectorAll('tbody tr');
                                                        rows2.forEach(row => {
                                                            const stateNode = row.querySelector('td.mat-column-positionState');
                                                            const state = stateNode ? stateNode.innerText.trim().toUpperCase() : '';
                                                            if (state === 'ABANDONED') return;

                                                            const unitTypeNode = row.querySelector('td.mat-column-unitType');
                                                            const unitType = unitTypeNode ? unitTypeNode.innerText.trim().toUpperCase() : '';
                                                            if (unitType !== 'OTHER') return;

                                                            const consIdNode = row.querySelector('td.mat-column-consId');
                                                            const consId = consIdNode ? consIdNode.innerText.trim().toUpperCase() : '';

                                                            const assetIdNode = row.querySelector('td.mat-column-assetId');
                                                            const assetId = assetIdNode ? assetIdNode.innerText.trim().toUpperCase() : '';

                                                            const originNode = row.querySelector('td.mat-column-originLocCd') || row.querySelector('td.mat-column-origin');
                                                            const rawOrigin2 = originNode ? originNode.innerText.trim() : '';
                                                            const origin = translateLocID(rawOrigin2);

                                                            const destNode = row.querySelector('td.mat-column-destinationLocCd') || row.querySelector('td.mat-column-destination');
                                                            const rawDest2 = destNode ? destNode.innerText.trim() : '';
                                                            const destination = translateLocID(rawDest2);

                                                            const openNode = row.querySelector('td.mat-column-openDate') || row.querySelector('td.mat-column-openDt');
                                                            const openDate = openNode ? openNode.innerText.trim().replace(/\n/g, ' ') : '';

                                                            const closeNode = row.querySelector('td.mat-column-closeDate') || row.querySelector('td.mat-column-closeDt');
                                                            const closeDate = closeNode ? closeNode.innerText.trim().replace(/\n/g, ' ') : '';

                                                            let pieceCount = 0;
                                                            const pieceSpan = row.querySelector('.piece-count');
                                                            if (pieceSpan) {
                                                                pieceCount = parseInt(pieceSpan.innerText.replace(/\D/g, ''), 10) || 0;
                                                            }

                                                            if (consId !== '') {
                                                                if (!newRecords.some(r => r.consId === consId)) {
                                                                    newRecords.push({ state, assetId, unitType, pieceCount, consId, origin, destination, openDate, closeDate });
                                                                }
                                                            }
                                                        });

                                                        finalizeSingleCheck(targetId, newRecords);

                                                    }, 3000); 
                                                }, 2000); 
                                            }, 500); 
                                        }, 500); 
                                    } else {
                                        finalizeSingleCheck(targetId, newRecords);
                                    }
                                }, 1000); 
                            } else {
                                finalizeSingleCheck(targetId, newRecords);
                            }
                        };

                        executeFase1(false);

                    }, 3000); 
                }, 2000); 
            }, 1500); 
        }, 800);

        return true;
    }

    // ==========================================
    // COMANDI REMOTI E LOOP PRINCIPALE
    // ==========================================
    function checkPendingCommands() {
        if (isProcessingCommand) return true;
        
        if (isManualModeActive) {
            GM_setValue('cons_pending_hours_command', null);
            GM_setValue('cons_pending_unittype_command', null);
            return false;
        }

        const pendingHours = GM_getValue('cons_pending_hours_command', null);
        const pendingUnit = GM_getValue('cons_pending_unittype_command', null);

        if (pendingHours) {
            isProcessingCommand = true;
            GM_setValue('cons_pending_hours_command', null);
            const selectBox = document.querySelector('mat-select[formcontrolname="hours"]');
            if (selectBox) {
                forceAggressiveClick(selectBox);
                setTimeout(() => {
                    clickOptionByText(pendingHours + " hours");
                    setTimeout(() => { isProcessingCommand = false; lastClickTime = Date.now(); }, 1000);
                }, 500);
            } else isProcessingCommand = false;
            return true;
        }

        if (pendingUnit) {
            isProcessingCommand = true;
            GM_setValue('cons_pending_unittype_command', null);
            const selectBox = document.querySelector('mat-select[formcontrolname="unitType"]');
            if (selectBox) {
                if (pendingUnit === "NONE") {
                    const parentField = selectBox.closest('.mat-form-field');
                    const closeBtn = parentField ? parentField.querySelector('button.close-icon') : null;
                    if (closeBtn && window.getComputedStyle(closeBtn).visibility !== 'hidden') forceAggressiveClick(closeBtn);
                    setTimeout(() => { isProcessingCommand = false; lastClickTime = Date.now(); }, 1000);
                } else {
                    forceAggressiveClick(selectBox);
                    setTimeout(() => {
                        clickOptionByText(pendingUnit);
                        setTimeout(() => { isProcessingCommand = false; lastClickTime = Date.now(); }, 1000);
                    }, 500);
                }
            } else isProcessingCommand = false;
            return true;
        }
        return false;
    }

    function scanConsMaintenance() {
        if (!document.title.includes('CONS Maintenance')) return;
        injectConsDashboard();

        if (isInitializing) { runSetupSequence(); return; }
        
        if (isManualModeActive) {
            GM_setValue('cons_single_check_queue', '[]');
            return; 
        }

        if (processSingleCheckQueue()) return;
        if (checkPendingCommands()) return;
        if (isProcessingCommand || !isAutoScanActive) return;

        const loader = document.querySelector('mat-progress-spinner, .loader');
        if (loader && loader.offsetHeight > 0) return;
        
        const rowsCheck = document.querySelectorAll('tbody tr');
        let hasAssets = Array.from(rowsCheck).some(r => r.querySelector('td.mat-column-trailerAssetId'));
        let targetDelay = hasAssets ? 800 : 1300; 

        if (Date.now() - lastClickTime < targetDelay) return; 

        const prevBtn = document.querySelector('button[aria-label="Previous page"]');
        const nextBtn = document.querySelector('button[aria-label="Next page"]');
        if (!prevBtn || !nextBtn) return;

        const isPrevDisabled = prevBtn.disabled || prevBtn.hasAttribute('disabled') || prevBtn.classList.contains('mat-button-disabled');
        const isNextDisabled = nextBtn.disabled || nextBtn.hasAttribute('disabled') || nextBtn.classList.contains('mat-button-disabled');

        if (!isRewinding) {
            const rows = document.querySelectorAll('tbody tr');
            rows.forEach(row => {
                const tIdNode = row.querySelector('td.mat-column-trailerAssetId');
                if (!tIdNode) return;
                const tId = tIdNode.innerText.trim().toUpperCase();
                if (!tId) return;

                const stateNode = row.querySelector('td.mat-column-positionState');
                const state = stateNode ? stateNode.innerText.trim().toUpperCase() : '';
                if (state === 'ABANDONED') return;

                const consIdNode = row.querySelector('td.mat-column-consId');
                const consId = consIdNode ? consIdNode.innerText.trim().toUpperCase() : '';
                const unitTypeNode = row.querySelector('td.mat-column-unitType');
                const unitType = unitTypeNode ? unitTypeNode.innerText.trim().toUpperCase() : '';
                const assetIdNode = row.querySelector('td.mat-column-assetId');
                const assetId = assetIdNode ? assetIdNode.innerText.trim().toUpperCase() : '';

                const originNode = row.querySelector('td.mat-column-originLocCd') || row.querySelector('td.mat-column-origin');
                const rawOrigin = originNode ? originNode.innerText.trim() : '';
                const origin = translateLocID(rawOrigin);

                const destNode = row.querySelector('td.mat-column-destinationLocCd') || row.querySelector('td.mat-column-destination');
                const rawDest = destNode ? destNode.innerText.trim() : '';
                const destination = translateLocID(rawDest);

                const openNode = row.querySelector('td.mat-column-openDate') || row.querySelector('td.mat-column-openDt');
                const openDate = openNode ? openNode.innerText.trim().replace(/\n/g, ' ') : '';

                const closeNode = row.querySelector('td.mat-column-closeDate') || row.querySelector('td.mat-column-closeDt');
                const closeDate = closeNode ? closeNode.innerText.trim().replace(/\n/g, ' ') : '';

                let pieceCount = 0;
                const pieceSpan = row.querySelector('.piece-count');
                if (pieceSpan) {
                    pieceCount = parseInt(pieceSpan.innerText.replace(/\D/g, ''), 10) || 0;
                }

                if (!activeTrailers[tId]) activeTrailers[tId] = [];
                const isDuplicateConsId = activeTrailers[tId].some(r => r.consId === consId);

                if (!isDuplicateConsId && consId !== '') {
                    activeTrailers[tId].push({ state, assetId, unitType, pieceCount, consId, origin, destination, openDate, closeDate });
                }
            });

            GM_setValue('cons_active_trailers', JSON.stringify(activeTrailers));
            GM_setValue('cons_last_heartbeat', Date.now());

            if (!isNextDisabled) {
                forceAggressiveClick(nextBtn); lastClickTime = Date.now();
            } else {
                completedSweeps++;
                if (!isPrevDisabled) {
                    isRewinding = true; forceAggressiveClick(prevBtn); lastClickTime = Date.now();
                } else {
                    const refreshBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText && b.innerText.includes('Refresh CONS Data'));
                    forceAggressiveClick(refreshBtn); lastClickTime = Date.now();
                }
            }
        } else {
            if (!isPrevDisabled) {
                forceAggressiveClick(prevBtn); lastClickTime = Date.now();
                GM_setValue('cons_last_heartbeat', Date.now());
            } else {
                isRewinding = false;
                completedSweeps++;
                const refreshBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText && b.innerText.includes('Refresh CONS Data'));
                forceAggressiveClick(refreshBtn); lastClickTime = Date.now();
            }
        }
    }

    // ==========================================
    // LOGICA YOS (Iniezione, Monitor & Control)
    // ==========================================
    function renderYosRemoteControl() {
        if (!document.title.includes('CONS Maintenance')) {
            let controlPanel = document.getElementById('tnt-yos-remote-control');
            if (!controlPanel) {
                controlPanel = document.createElement('div');
                controlPanel.id = 'tnt-yos-remote-control';
                const currentTargetHours = GM_getValue('cons_target_hours', '24');
                const currentTargetUnit = GM_getValue('cons_target_unittype', 'NONE');

                controlPanel.innerHTML = `
                    <div class="yos-control-row">
                        <span>🕒 History:</span>
                        <select id="tnt-yos-hours-select">
                            <option value="12" ${currentTargetHours === '12' ? 'selected' : ''}>12 hours</option>
                            <option value="24" ${currentTargetHours === '24' ? 'selected' : ''}>24 hours</option>
                            <option value="48" ${currentTargetHours === '48' ? 'selected' : ''}>48 hours</option>
                            <option value="72" ${currentTargetHours === '72' ? 'selected' : ''}>72 hours</option>
                            <option value="96" ${currentTargetHours === '96' ? 'selected' : ''}>96 hours</option>
                        </select>
                    </div>
                    <div class="yos-control-row">
                        <span>📦 Type:</span>
                        <select id="tnt-yos-unittype-select">
                            <option value="NONE" ${currentTargetUnit === 'NONE' ? 'selected' : ''}>Tutti (Nessun Filtro)</option>
                            <option value="TRAILER" ${currentTargetUnit === 'TRAILER' ? 'selected' : ''}>Trailer</option>
                            <option value="OTHER" ${currentTargetUnit === 'OTHER' ? 'selected' : ''}>Bulk (OTHER)</option>
                            <option value="BAG" ${currentTargetUnit === 'BAG' ? 'selected' : ''}>Bag (BAG)</option>
                        </select>
                    </div>
                `;
                document.body.appendChild(controlPanel);

                document.getElementById('tnt-yos-hours-select').addEventListener('change', function(e) {
                    GM_setValue('cons_target_hours', e.target.value); GM_setValue('cons_pending_hours_command', e.target.value);
                });
                document.getElementById('tnt-yos-unittype-select').addEventListener('change', function(e) {
                    GM_setValue('cons_target_unittype', e.target.value); GM_setValue('cons_pending_unittype_command', e.target.value);
                });
            }

            let bottomContainer = document.getElementById('tnt-yos-bottom-container');
            if (!bottomContainer) {
                bottomContainer = document.createElement('div');
                bottomContainer.id = 'tnt-yos-bottom-container';

                let statusBadge = document.createElement('div');
                statusBadge.id = 'tnt-yos-sync-status';
                statusBadge.innerHTML = `<span class="sync-dot"></span> <span class="sync-text">Connessione in corso...</span>`;

                let restartBtn = document.createElement('button');
                restartBtn.id = 'tnt-yos-restart-btn';
                restartBtn.innerHTML = '🔄 Riparti CONS';
                restartBtn.onclick = () => { GM_setValue('cons_hard_reset_command', true); };

                bottomContainer.appendChild(statusBadge);
                bottomContainer.appendChild(restartBtn);
                document.body.appendChild(bottomContainer);
            }

            const statusBadge = document.getElementById('tnt-yos-sync-status');
            const activeTrailersStr = GM_getValue('cons_active_trailers', '{}');
            let currentConsTrailers = {};
            try { currentConsTrailers = JSON.parse(activeTrailersStr); } catch(e){}

            const lastHeartbeat = GM_getValue('cons_last_heartbeat', 0);
            const timeDiff = Date.now() - lastHeartbeat;
            const textEl = statusBadge.querySelector('.sync-text');
            const numTrailers = Object.keys(currentConsTrailers).length;
            const scanState = GM_getValue('cons_scan_state', 'RUNNING');

            if (lastHeartbeat === 0) {
                statusBadge.style.backgroundColor = '#6c757d'; textEl.innerText = 'CONS in attesa...';
            }
            else if (scanState === 'MANUAL_MODE') {
                statusBadge.style.backgroundColor = '#6c757d'; statusBadge.style.color = 'white';
                textEl.innerText = `🛠️ CONS IN MANUALE (Sync bloccato)`;
            }
            else if (scanState === 'SINGLE_CHECK') {
                statusBadge.style.backgroundColor = '#9c27b0'; statusBadge.style.color = 'white';
                textEl.innerText = `🟣 SINGLE CHECK IN CORSO...`;
            }
            else if (scanState === 'PAUSED_POST_CHECK') {
                statusBadge.style.backgroundColor = '#ff9800'; statusBadge.style.color = 'black';
                textEl.innerText = `⏸️ CONS IN PAUSA (Post-Check) - ${numTrailers} TRL`;
            }
            else if (timeDiff < 6000) {
                statusBadge.style.backgroundColor = '#28a745'; statusBadge.style.color = 'white'; textEl.innerText = `🟢 SYNC ATTIVO (${numTrailers} TRL)`;
            } else if (timeDiff < 15000) {
                statusBadge.style.backgroundColor = '#ffc107'; statusBadge.style.color = 'black'; textEl.innerText = `🟡 LENTO/PAUSA (${numTrailers} TRL)`;
            } else {
                if (scanState === 'COMPLETED') {
                    let d = new Date(lastHeartbeat);
                    let hh = String(d.getHours()).padStart(2, '0');
                    let mm = String(d.getMinutes()).padStart(2, '0');
                    statusBadge.style.backgroundColor = '#007bff'; statusBadge.style.color = 'white';
                    textEl.innerText = `🔵 CACHE DELLE ${hh}:${mm} (DB Pronto)`;
                } else {
                    statusBadge.style.backgroundColor = '#dc3545'; statusBadge.style.color = 'white';
                    textEl.innerText = `🔴 CONNESSIONE PERSA (DB Congelato)`;
                }
            }
        }
    }

    function injectIntoYosModal() {
        const remarksContainer = document.querySelector('.door-info__movmt-history');
        if (!remarksContainer) return;

        const staleInjections = document.querySelectorAll('.tnt-cons-modal-injection');
        staleInjections.forEach(el => el.remove());

        const activeTrailersStr = GM_getValue('cons_active_trailers', '{}');
        let currentConsTrailers = {};
        try { currentConsTrailers = JSON.parse(activeTrailersStr); } catch(e){}

        const lastHeartbeat = GM_getValue('cons_last_heartbeat', 0).toString();
        const isInitialScanDone = GM_getValue('cons_initial_scan_done', false) === true || GM_getValue('cons_initial_scan_done', false) === "true";

        const modalRoot = remarksContainer.closest('.modal-content, .mat-dialog-container, body');
        const modalText = (modalRoot ? modalRoot.innerText : '').toUpperCase();

        let foundTrailerId = null;
        let lastClicked = GM_getValue('yos_last_clicked_trailer', '');

        if (lastClicked && modalText.includes(lastClicked)) {
            foundTrailerId = lastClicked;
        } else {
            const trailerIds = Object.keys(currentConsTrailers).sort((a,b) => b.length - a.length);
            for (let tId of trailerIds) {
                let regex = new RegExp("\\b" + tId + "\\b");
                if (regex.test(modalText)) {
                    foundTrailerId = tId;
                    break;
                }
            }
        }

        if (!foundTrailerId && isInitialScanDone) return;

        if (!remarksContainer.dataset.autoCheckTriggered) {
            remarksContainer.dataset.autoCheckTriggered = Date.now().toString();
            let singleQueueStr = GM_getValue('cons_single_check_queue', "[]");
            let singleQueue = [];
            try { singleQueue = JSON.parse(singleQueueStr); } catch(err){}

            if (foundTrailerId && !singleQueue.includes(foundTrailerId)) {
                singleQueue.push(foundTrailerId);
                GM_setValue('cons_single_check_queue', JSON.stringify(singleQueue));
            }
        }

        let triggerTime = parseInt(remarksContainer.dataset.autoCheckTriggered);
        let currentHeartbeat = parseInt(lastHeartbeat);

        let isLoading = !isInitialScanDone || (currentHeartbeat <= triggerTime);

        let tableHTML = '';

        if (isLoading) {
            let loadingText = !isInitialScanDone
                ? `⏳ INIZIALIZZAZIONE IN CORSO... (Attendere il primo giro completo di CONS)`
                : `⏳ IN CARICAMENTO DATI LIVE CONS PER ${foundTrailerId || ''}...`;

            let subtitleText = !isInitialScanDone
                ? `(Il Single Check sarà avviato appena la lista base sarà in memoria)`
                : `(Attendere il termine del Single Check su CONS)`;

            tableHTML = `
                <div class="tnt-cons-modal-injection" data-heartbeat="${lastHeartbeat}" data-loading="true" data-initial="${isInitialScanDone}" style="margin-top: 20px; border-top: 1px solid #ff9800; padding-top: 20px; padding-bottom: 10px; width: 100%; text-align: center;">
                    <strong class="yos-pulse-text" style="color: #ff9800; font-size: 15px; display: block;">${loadingText}</strong>
                    <span style="color: #999; font-size: 11px; display: block; margin-top: 5px;">${subtitleText}</span>
                </div>
            `;
        } else {
            const records = currentConsTrailers[foundTrailerId] || [];
            
            let d = new Date(currentHeartbeat);
            let timeStr = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0') + ':' + d.getSeconds().toString().padStart(2, '0');

            const trailers = records.filter(r => r.unitType === 'TRAILER').sort((a, b) => Number(b.consId) - Number(a.consId));
            const bulks = records.filter(r => r.unitType !== 'TRAILER').sort((a, b) => Number(b.consId) - Number(a.consId));

            let warningHTML = "";
            if (trailers.length === 0) {
                warningHTML = `<div style="background-color: rgba(220,53,69,0.2); border: 1px solid #dc3545; color: #ff4d4d; padding: 10px; margin-bottom: 15px; text-align: center; font-weight: bold; font-size: 15px; border-radius: 4px; box-shadow: 0 0 10px rgba(220,53,69,0.5);">CASSA SENZA CONS COLLEGATA</div>`;
            }

            tableHTML = `
                <div class="tnt-cons-modal-injection" data-heartbeat="${lastHeartbeat}" data-loading="false" data-initial="${isInitialScanDone}" style="margin-top: 20px; border-top: 1px solid #ff9800; padding-top: 10px; width: 100%;">
                    ${warningHTML}
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <strong style="color: #ff9800; font-size: 14px;">🚚 DATI CONS LIVE E BULK (${foundTrailerId})</strong>
                        <span style="color: #bbb; font-size: 11px;">Ultimo aggiornamento: <b style="color: #fff">${timeStr}</b></span>
                    </div>
            `;

            if (records.length > 0) {
                tableHTML += `
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; font-size: 14px; font-weight: bold; border-collapse: collapse; text-align: left; font-family: Roboto, sans-serif;">
                            <thead>
                                <tr style="border-bottom: 2px solid #ff9800; color: #ff9800;">
                                    <th style="padding: 2px 4px;">CONS ID</th>
                                    <th style="padding: 2px 4px;">ASSET ID</th>
                                    <th style="padding: 2px 4px;">UNIT TYPE</th>
                                    <th style="padding: 2px 4px;">STATE</th>
                                    <th style="padding: 2px 4px;">DEST.</th>
                                    <th style="padding: 2px 4px;">OPEN</th>
                                    <th style="padding: 2px 4px;">CLOSE</th>
                                    <th style="padding: 2px 4px; text-align: center;">PIECES</th>
                                </tr>
                            </thead>
                            <tbody>
                `;

                trailers.forEach(r => {
                    tableHTML += `
                        <tr style="border-bottom: 1px dotted rgba(255, 152, 0, 0.4); color: #ff9800; line-height: 1.2;">
                            <td style="padding: 2px 4px;">${r.consId}</td>
                            <td style="padding: 2px 4px;">${r.assetId}</td>
                            <td style="padding: 2px 4px;">${r.unitType}</td>
                            <td style="padding: 2px 4px;">${r.state}</td>
                            <td style="padding: 2px 4px;">${r.destination || '-'}</td>
                            <td style="padding: 2px 4px;">${formatShortDate(r.openDate)}</td>
                            <td style="padding: 2px 4px;">${formatShortDate(r.closeDate)}</td>
                            <td style="padding: 2px 4px; color: #fff; background-color: rgba(255, 152, 0, 0.2); text-align: center;">${r.pieceCount}</td>
                        </tr>
                    `;
                });

                bulks.forEach(r => {
                    tableHTML += `
                        <tr style="border-bottom: 1px dotted rgba(199, 125, 255, 0.4); color: #c77dff; line-height: 1.2;">
                            <td style="padding: 2px 4px;">${r.consId}</td>
                            <td style="padding: 2px 4px;">${r.assetId}</td>
                            <td style="padding: 2px 4px;">${r.unitType}</td>
                            <td style="padding: 2px 4px;">${r.state}</td>
                            <td style="padding: 2px 4px;">${r.destination || '-'}</td>
                            <td style="padding: 2px 4px;">${formatShortDate(r.openDate)}</td>
                            <td style="padding: 2px 4px;">${formatShortDate(r.closeDate)}</td>
                            <td style="padding: 2px 4px; color: #fff; background-color: rgba(199, 125, 255, 0.2); text-align: center;">${r.pieceCount}</td>
                        </tr>
                    `;
                });

                tableHTML += `</tbody></table></div>`;
            }
            
            tableHTML += `</div>`;
        }

        const injectionDiv = document.createElement('div');
        injectionDiv.innerHTML = tableHTML;

        const targetRow = remarksContainer.querySelector('.row.door-info__movmt-section-row') || remarksContainer;
        targetRow.appendChild(injectionDiv.firstElementChild);
    }

    function injectIntoYosContainers() {
        const containers = document.querySelectorAll('div[id^="container_"]');
        if (containers.length === 0) return;

        renderYosRemoteControl();

        const activeTrailersStr = GM_getValue('cons_active_trailers', '{}');
        let currentConsTrailers = {};
        try { currentConsTrailers = JSON.parse(activeTrailersStr); } catch(e){}

        const lastHeartbeat = GM_getValue('cons_last_heartbeat', 0);
        const isCacheOld = (Date.now() - lastHeartbeat) > 1800000;

        containers.forEach(container => {
            if (!/^container_\d+$/.test(container.id)) return;
            const parentUnit = container.closest('[id^="unit_"]') || container.parentElement;
            if (!parentUnit) return;

            const text = parentUnit.innerText || '';
            const bayMatch = text.match(/\b([1-6]\d\d)\b/);
            let customInfo = container.querySelector('.yos-container-custom-info');

            if (!bayMatch) { if (customInfo) customInfo.remove(); return; }

            const bayNum = parseInt(bayMatch[1], 10);
            const isZone300 = bayNum >= 300 && bayNum <= 399;
            const isZone400 = bayNum >= 400 && bayNum <= 499;

            if (!isZone300 && !isZone400) { if (customInfo) customInfo.remove(); return; }

            const unitIdMatch = parentUnit.id.match(/unit_(\d+)/);
            let trailerId = "";
            if (unitIdMatch) {
                const nameDiv = document.getElementById('unitname_' + unitIdMatch[1]);
                if (nameDiv) trailerId = nameDiv.innerText.trim().toUpperCase();
            }

            if (!container.dataset.clickTrackerBound) {
                container.dataset.clickTrackerBound = "true";

                container.addEventListener('click', function(e) {
                    if (trailerId !== "") {
                        GM_setValue('yos_last_clicked_trailer', trailerId);
                    }
                });

                container.addEventListener('dblclick', function(e) {
                    if (trailerId !== "") {
                        GM_setValue('yos_last_clicked_trailer', trailerId);
                        let singleQueueStr = GM_getValue('cons_single_check_queue', "[]");
                        let singleQueue = [];
                        try { singleQueue = JSON.parse(singleQueueStr); } catch(err){}

                        if (!singleQueue.includes(trailerId)) {
                            singleQueue.push(trailerId);
                            GM_setValue('cons_single_check_queue', JSON.stringify(singleQueue));
                        }
                    }
                });
            }

            if (!customInfo) {
                customInfo = document.createElement('div');
                customInfo.id = 'tnt-custom-info-' + bayNum;
                customInfo.className = 'yos-container-custom-info';

                if (isZone400) customInfo.classList.add('yos-zone-400');
                if (isZone300) customInfo.classList.add('yos-zone-300');

                container.appendChild(customInfo);
            }

            let pieceBadge = container.querySelector('.yos-piece-count-badge');
            if (!pieceBadge) {
                pieceBadge = document.createElement('div');
                pieceBadge.className = 'yos-piece-count-badge';
                if (isZone400) pieceBadge.classList.add('yos-pc-400');
                if (isZone300) pieceBadge.classList.add('yos-pc-300');
                container.appendChild(pieceBadge);
            }

            const isReady = container.classList.contains('unit_ready_outline') && container.querySelector('.doorstatus-ready-loaded') !== null;
            if (isReady && trailerId !== "") {
                let trackedStr = GM_getValue('yos_ready_trailers_tracked', "[]");
                let queuedList = [];
                try { queuedList = JSON.parse(trackedStr); } catch(e){}

                if (!queuedList.includes(trailerId)) {
                    queuedList.push(trailerId);
                    if (queuedList.length > 200) queuedList.shift();
                    GM_setValue('yos_ready_trailers_tracked', JSON.stringify(queuedList));

                    let singleQueueStr = GM_getValue('cons_single_check_queue', "[]");
                    let singleQueue = [];
                    try { singleQueue = JSON.parse(singleQueueStr); } catch(e){}

                    if (!singleQueue.includes(trailerId)) {
                        singleQueue.push(trailerId);
                        GM_setValue('cons_single_check_queue', JSON.stringify(singleQueue));
                    }
                }
            }

            let targetText = "X";
            let targetBg = "rgba(0, 0, 0, 0.6)";
            let targetColor = "white";
            let targetBorder = isCacheOld ? "2px solid red" : "none";
            let totalPieces = 0;

            let showBadge = false;
            let badgeText = "";
            let badgeColor = "#0df";
            let badgeBg = "rgba(0, 0, 0, 0.85)";
            let badgeBorder = "1px solid #0df";
            let badgeBoxShadow = "0 0 5px rgba(0,221,255,0.5)";

            if (trailerId !== "" && currentConsTrailers[trailerId]) {
                const records = currentConsTrailers[trailerId];

                if (records.length > 0) {
                    const trailers = records.filter(r => r.unitType === 'TRAILER');
                    const bulks = records.filter(r => r.unitType !== 'TRAILER');

                    const sortedRecords = [...records].sort((a, b) => Number(b.consId) - Number(a.consId));
                    const ultimaCons = sortedRecords.find(r => r.unitType === 'TRAILER') || sortedRecords[0];
                    totalPieces = ultimaCons ? (ultimaCons.pieceCount || 0) : 0;

                    let activeTrailersWithPieces = trailers.filter(r => (r.pieceCount || 0) > 0).length;

                    if (trailers.length > 1) {
                        targetText = "!"; targetBg = "rgba(220, 53, 69, 0.9)"; targetColor = "white";
                    } else if (trailers.length === 1) {
                        targetText = "✅"; targetBg = "rgba(40, 167, 69, 0.9)"; targetColor = "white";
                    } else if (bulks.length > 0) {
                        targetText = "?"; targetBg = "rgba(199, 125, 255, 0.9)"; targetColor = "white";
                    }

                    if (trailers.length <= 1) {
                        if (totalPieces > 0) {
                            showBadge = true;
                            badgeText = totalPieces + " pz";
                            if (trailers.length === 0) {
                                badgeColor = "#c77dff";
                                badgeBorder = "1px solid #c77dff";
                                badgeBoxShadow = "0 0 5px rgba(199, 125, 255, 0.5)";
                            }
                        }
                    } else if (trailers.length > 1) {
                        if (activeTrailersWithPieces <= 1) {
                            if (totalPieces > 0) {
                                showBadge = true;
                                badgeText = totalPieces + " pz";
                                badgeColor = "#ffeb3b";
                                badgeBorder = "1px solid #ffeb3b";
                                badgeBoxShadow = "0 0 5px rgba(255, 235, 59, 0.5)";
                            }
                        } else {
                            showBadge = true;
                            badgeText = "ATTENZIONE";
                            badgeColor = "#ffffff";
                            badgeBg = "rgba(220, 53, 69, 0.9)";
                            badgeBorder = "1px solid #dc3545";
                            badgeBoxShadow = "0 0 5px rgba(220, 53, 69, 0.8)";
                        }
                    }
                }
            }

            if (customInfo.innerText !== targetText) customInfo.innerText = targetText;
            if (customInfo.style.backgroundColor !== targetBg) customInfo.style.backgroundColor = targetBg;
            if (customInfo.style.color !== targetColor) customInfo.style.color = targetColor;
            if (customInfo.style.border !== targetBorder) customInfo.style.border = targetBorder;

            if (showBadge) {
                if (pieceBadge.innerText !== badgeText) pieceBadge.innerText = badgeText;
                if (pieceBadge.style.color !== badgeColor) pieceBadge.style.color = badgeColor;
                if (pieceBadge.style.backgroundColor !== badgeBg) pieceBadge.style.backgroundColor = badgeBg;
                if (pieceBadge.style.border !== badgeBorder) pieceBadge.style.border = badgeBorder;
                if (pieceBadge.style.boxShadow !== badgeBoxShadow) pieceBadge.style.boxShadow = badgeBoxShadow;
                if (pieceBadge.style.display !== "block") pieceBadge.style.display = "block";
            } else {
                if (pieceBadge.style.display !== "none") pieceBadge.style.display = "none";
            }
        });
    }

    // ==========================================
    // HACK: WEB WORKER
    // ==========================================
    try {
        const workerCode = `
            let interval;
            self.onmessage = function(e) {
                if (e.data === 'start') {
                    interval = setInterval(() => postMessage('tick'), 500);
                }
            };
        `;
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const timerWorker = new Worker(URL.createObjectURL(blob));

        timerWorker.onmessage = function() {
            scanConsMaintenance();
            injectIntoYosContainers();
            injectIntoYosModal();
        };
        timerWorker.postMessage('start');

    } catch (e) {
        console.warn("[YOS-SYNC] ⚠️ Web Worker bloccato. Uso setInterval standard.");
        setInterval(() => {
            scanConsMaintenance();
            injectIntoYosContainers();
            injectIntoYosModal();
        }, 500);
    }

})();

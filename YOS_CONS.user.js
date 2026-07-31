// ==UserScript==
// @name         YOS & CONS Sync Overlay (Zone 300/400) - PRO V1.6
// @namespace    http://tampermonkey.net/
// @version      1.6
// @description  DOM UI Fix (Icona + Colli), Doppio Click Sicuro su Reset Filter, Setup Ripristinato.
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
    let isRewinding = false;
    let lastClickTime = 0;
    
    // Remote command flags
    let isProcessingCommand = false; 
    
    // Setup and Database variables
    let isInitializing = true; 
    let hasInitializedFilters = false;
    let initCountdown = 10; 
    
    let dbCooldownSeconds = 120; 
    let completedSweeps = 0;     
    
    let activeTrailers = {}; 
    let tempCycleTrailers = {};

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
            display: flex; align-items: center; justify-content: center;
        }
        .yos-zone-400 { top: 18% !important; }
        .yos-zone-300 { top: 82% !important; }

        .yos-piece-count-badge {
            position: absolute; left: 50%; transform: translateX(-50%);
            font-size: 11px; font-weight: bold; color: #0df;
            background-color: rgba(0, 0, 0, 0.85);
            padding: 1px 4px; border-radius: 3px; z-index: 98; pointer-events: none;
            white-space: nowrap; border: 1px solid #0df; box-shadow: 0 0 5px rgba(0,221,255,0.5);
        }
        /* Zona 400: appeso sotto l'icona */
        .yos-zone-400 .yos-piece-count-badge { top: 130%; } 
        /* Zona 300: appoggiato sopra l'icona */
        .yos-zone-300 .yos-piece-count-badge { bottom: 130%; } 

        /* Plancia CONS Maintenance */
        #tnt-cons-dashboard {
            position: fixed; bottom: 20px; left: 20px; z-index: 999999;
            display: flex; flex-direction: column; gap: 8px;
            font-family: Roboto, sans-serif; font-size: 13px; font-weight: bold;
        }
        #tnt-cons-autoscan-btn {
            padding: 10px 20px; border-radius: 5px; background: #28a745; color: white;
            font-weight: bold; border: 1px solid rgba(255,255,255,0.2); cursor: pointer;
            box-shadow: 0 4px 10px rgba(0,0,0,0.5); transition: background 0.2s;
        }
        .cons-info-box {
            padding: 8px 15px; border-radius: 5px; background: #1e1e1e; color: #e3e3e3;
            border: 1px solid #444; box-shadow: 0 4px 10px rgba(0,0,0,0.5); text-align: center;
        }
        .text-warning { color: #ffc107; }
        .text-ready { color: #00bcd4; }

        /* Plancia YOS Remote Control & Status */
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

    // NUOVA FUNZIONE: Doppio click sicuro sul reset
    function forceSicuroResetFilter() {
        console.log("[YOS-SYNC] 🧹 Click di sicurezza su 'Reset filter'...");
        const resetBtn = document.querySelector('button[title="Reset filter"]');
        if (resetBtn) {
            resetBtn.click();
            setTimeout(() => { if (resetBtn) resetBtn.click(); }, 300);
            
            // Per sicurezza chiude anche le piccole X sulle chips
            const closeButtons = document.querySelectorAll('button.mat-icon-button');
            closeButtons.forEach(btn => {
                const icon = btn.querySelector('mat-icon');
                if (icon && icon.innerText.trim() === 'close') btn.click();
            });
        }
    }

    // ==========================================
    // UI: CONS MAINTENANCE
    // ==========================================
    function injectConsDashboard() {
        if (!document.title.includes('CONS Maintenance')) return;
        
        let dashboard = document.getElementById('tnt-cons-dashboard');
        if (!dashboard) {
            dashboard = document.createElement('div');
            dashboard.id = 'tnt-cons-dashboard';
            
            const btn = document.createElement('button');
            btn.id = 'tnt-cons-autoscan-btn';
            btn.innerHTML = '🔄 Auto-Scan: ON';
            btn.onclick = () => {
                if (!isAutoScanActive && dbCooldownSeconds <= 0 && completedSweeps >= 2) {
                    btn.innerHTML = '⏳ Riavvio in corso...';
                    btn.style.background = '#ffc107'; 
                    GM_setValue('cons_active_trailers', '{}');
                    GM_setValue('cons_initial_scan_done', false); 
                    forceSicuroResetFilter();
                    setTimeout(() => location.reload(), 500);
                    return; 
                }

                isAutoScanActive = !isAutoScanActive;
                if (isAutoScanActive) {
                    btn.innerHTML = '🔄 Auto-Scan: ON';
                    btn.style.background = '#28a745'; 
                    GM_setValue('cons_scan_state', 'RUNNING');
                } else {
                    btn.innerHTML = '⏸️ Auto-Scan: PAUSA';
                    btn.style.background = '#dc3545'; 
                    isRewinding = false;
                }
            };

            const infoBox = document.createElement('div');
            infoBox.id = 'tnt-cons-timer-box';
            infoBox.className = 'cons-info-box';
            infoBox.innerHTML = "In attesa della pagina...";

            dashboard.appendChild(btn);
            dashboard.appendChild(infoBox);
            document.body.appendChild(dashboard);
        }

        const infoBox = document.getElementById('tnt-cons-timer-box');
        if (infoBox) {
            if (isInitializing) {
                infoBox.innerHTML = "Avvio in: <span class='text-warning'>" + initCountdown + "s</span>";
            } else if (!isAutoScanActive && dbCooldownSeconds <= 0 && completedSweeps >= 2) {
                infoBox.innerHTML = "<span class='text-ready'>IN PAUSA: Dati Pronti (2+ Giri)</span>";
            } else if (!isAutoScanActive) {
                infoBox.innerHTML = "<span class='text-warning'>IN PAUSA MANUALE</span>";
            } else {
                const mins = Math.floor(Math.max(0, dbCooldownSeconds) / 60);
                const secs = Math.max(0, dbCooldownSeconds) % 60;
                const secsPadded = secs < 10 ? "0" + secs : secs;
                
                if (dbCooldownSeconds <= 0 && completedSweeps < 2) {
                    infoBox.innerHTML = "<span class='text-warning'>Attesa cicli... (" + completedSweeps + "/2)</span>";
                } else {
                    infoBox.innerHTML = "Scan in: <span class='text-warning'>" + mins + ":" + secsPadded + "</span> <small>(" + completedSweeps + "/2 giri)</small>";
                }
            }
        }
    }

    // ==========================================
    // LOGICA SETUP
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
        
        setTimeout(forceSicuroResetFilter, 500);

        setTimeout(() => {
            const originSelect = document.querySelector('mat-select[formcontrolname="originLocCd"]');
            if (originSelect && !originSelect.disabled) { forceAggressiveClick(originSelect); setTimeout(() => clickOptionByText('IMRH'), 500); }
        }, 2000);

        setTimeout(() => {
            const hoursSelect = document.querySelector('mat-select[formcontrolname="hours"]');
            if (hoursSelect && !hoursSelect.disabled) { forceAggressiveClick(hoursSelect); setTimeout(() => clickOptionByText(targetHours + ' hours'), 500); }
        }, 4000);

        setTimeout(() => {
            const unitSelect = document.querySelector('mat-select[formcontrolname="unitType"]');
            if (unitSelect && !unitSelect.disabled) {
                if (targetUnit === "NONE") {
                    const parentField = unitSelect.closest('.mat-form-field');
                    const closeBtn = parentField ? parentField.querySelector('button.close-icon') : null;
                    if (closeBtn && window.getComputedStyle(closeBtn).visibility !== 'hidden') forceAggressiveClick(closeBtn);
                } else {
                    forceAggressiveClick(unitSelect); setTimeout(() => clickOptionByText(targetUnit), 500);
                }
            }
        }, 6000);

        setTimeout(() => {
            const paginatorSelect = document.querySelector('.mat-paginator-page-size-select mat-select');
            if (paginatorSelect) { forceAggressiveClick(paginatorSelect); setTimeout(() => clickOptionByText('100'), 500); }
        }, 8000);

        setTimeout(() => {
            isInitializing = false;
            lastClickTime = 0; 
        }, 10000);
    }

    // ==========================================
    // TIMER GLOBALE 1 SECONDO
    // ==========================================
    setInterval(() => {
        if (document.title.includes('CONS Maintenance')) {
            if (GM_getValue('cons_hard_reset_command', false)) {
                GM_setValue('cons_hard_reset_command', false);
                GM_setValue('cons_active_trailers', '{}');
                GM_setValue('cons_initial_scan_done', false);
                forceSicuroResetFilter();
                setTimeout(() => location.reload(), 500);
                return;
            }

            if (isInitializing && hasInitializedFilters) {
                if (initCountdown > 0) initCountdown--;
            } else if (!isInitializing && isAutoScanActive) {
                if (dbCooldownSeconds > 0) {
                    dbCooldownSeconds--;
                } 
                else if (dbCooldownSeconds <= 0 && completedSweeps >= 2) {
                    isAutoScanActive = false; 
                    GM_setValue('cons_scan_state', 'COMPLETED');
                    GM_setValue('cons_initial_scan_done', true); 
                    
                    const btn = document.getElementById('tnt-cons-autoscan-btn');
                    if (btn) {
                        btn.innerHTML = '▶️ RIPARTI (Hard Reset)';
                        btn.style.background = '#007bff'; 
                    }

                    forceSicuroResetFilter();
                }
            }
        }
    }, 1000);

    // ==========================================
    // ESECUZIONE SINGOLO CHECK (PRIORITÀ)
    // ==========================================
    function processSingleCheckQueue() {
        if (!GM_getValue('cons_initial_scan_done', false)) return false; 
        if (isProcessingCommand) return true; 

        let queueStr = GM_getValue('cons_single_check_queue', '[]');
        let queue = [];
        try { queue = JSON.parse(queueStr); } catch(e){}

        if (queue.length === 0) return false;

        let targetId = queue.shift();
        GM_setValue('cons_single_check_queue', JSON.stringify(queue));
        
        console.log(`[YOS-SYNC] 🔍 SINGLE CHECK avviato per Trailer (Chiuso): ${targetId}`);
        isProcessingCommand = true;
        GM_setValue('cons_scan_state', 'SINGLE_CHECK'); 

        // Pulisce SOLO le caselle di testo per non perdere le ore
        const inputs = document.querySelectorAll('input[formcontrolname="trailerAssetId"], input[formcontrolname="consId"], input[formcontrolname="assetId"]');
        inputs.forEach(i => {
            i.value = '';
            i.dispatchEvent(new Event('input', {bubbles: true}));
        });

        setTimeout(() => {
            let tInput = Array.from(document.querySelectorAll('input')).find(i => i.getAttribute('formcontrolname') === 'trailerAssetId');
            if (tInput) {
                tInput.value = targetId;
                tInput.dispatchEvent(new Event('input', {bubbles: true}));
                tInput.dispatchEvent(new Event('change', {bubbles: true}));
            }

            setTimeout(() => {
                const refreshBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText && b.innerText.includes('Refresh CONS Data'));
                if(refreshBtn) refreshBtn.click();

                // Aspetta 3.5 secondi che carichi il record
                setTimeout(() => {
                    const viewBtns = document.querySelectorAll('button[title="Click to view piece count"]');
                    if (viewBtns.length > 0) {
                        viewBtns.forEach(btn => btn.click());
                    }

                    // Aspetta altri 3 secondi per leggere i colli espansi
                    setTimeout(() => {
                        try {
                            let newRecords = [];
                            let pieceCountIndex = -1;
                            document.querySelectorAll('thead th').forEach((th, idx) => {
                                if (th.innerText.toUpperCase().includes('PIECE COUNT')) pieceCountIndex = idx;
                            });

                            const rows = document.querySelectorAll('tbody tr');
                            rows.forEach(row => {
                                const tIdNode = row.querySelector('td.mat-column-trailerAssetId');
                                if (!tIdNode || tIdNode.innerText.trim().toUpperCase() !== targetId) return;

                                const stateNode = row.querySelector('td.mat-column-positionState');
                                const state = stateNode ? stateNode.innerText.trim().toUpperCase() : '';
                                if (state === 'ABANDONED') return; 
                                
                                const consIdNode = row.querySelector('td.mat-column-consId');
                                const consId = consIdNode ? consIdNode.innerText.trim().toUpperCase() : '';
                                const unitTypeNode = row.querySelector('td.mat-column-unitType');
                                const unitType = unitTypeNode ? unitTypeNode.innerText.trim().toUpperCase() : '';
                                const assetIdNode = row.querySelector('td.mat-column-assetId');
                                const assetId = assetIdNode ? assetIdNode.innerText.trim().toUpperCase() : '';

                                // Estrazione Colli
                                let pieceCount = 0;
                                const pieceSpan = row.querySelector('.piece-count');
                                if (pieceSpan) {
                                    pieceCount = parseInt(pieceSpan.innerText.replace(/\D/g, ''), 10) || 0;
                                } else {
                                    const cells = row.querySelectorAll('td');
                                    if (pieceCountIndex > -1 && cells[pieceCountIndex]) {
                                        pieceCount = parseInt(cells[pieceCountIndex].innerText.replace(/\D/g, ''), 10) || 0;
                                    }
                                }

                                if (consId !== '') newRecords.push({ state, assetId, unitType, pieceCount, consId });
                            });

                            // Salva i dati appena letti
                            activeTrailers[targetId] = newRecords;
                            GM_setValue('cons_active_trailers', JSON.stringify(activeTrailers));
                            GM_setValue('cons_last_heartbeat', Date.now());
                        } catch(e) { console.error("Errore lettura Single Check:", e); }

                        // -------------------------------------------------------------
                        // FINE SINGLE CHECK: Clicchiamo Reset Filter Sicuro!
                        // -------------------------------------------------------------
                        forceSicuroResetFilter();
                        
                        setTimeout(() => {
                            console.log("[YOS-SYNC] 🔄 Ripristino setup base dopo Single Check...");
                            isInitializing = true;
                            hasInitializedFilters = false;
                            initCountdown = 8;
                            isProcessingCommand = false;
                            lastClickTime = Date.now();
                            GM_setValue('cons_scan_state', 'RUNNING');
                        }, 1500);

                    }, 3000); 
                }, 3500); 
            }, 500);
        }, 500);

        return true;
    }

    // ==========================================
    // COMANDI REMOTI (One-Shot Options)
    // ==========================================
    function checkPendingCommands() {
        if (isProcessingCommand) return true;
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

    // ==========================================
    // LOGICA CONS MAINTENANCE (Scanner Principale)
    // ==========================================
    function scanConsMaintenance() {
        if (!document.title.includes('CONS Maintenance')) return;
        injectConsDashboard();

        if (isInitializing) { runSetupSequence(); return; }

        if (processSingleCheckQueue()) return;
        if (checkPendingCommands()) return;
        
        if (isProcessingCommand || !isAutoScanActive) return;

        const loader = document.querySelector('mat-progress-spinner, .loader');
        if (loader && loader.offsetHeight > 0) return;
        if (Date.now() - lastClickTime < 2500) return;

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

                let pieceCount = 0;
                const pieceSpan = row.querySelector('.piece-count');
                if (pieceSpan) {
                    pieceCount = parseInt(pieceSpan.innerText.replace(/\D/g, ''), 10) || 0;
                }

                if (!activeTrailers[tId]) activeTrailers[tId] = [];
                const isDuplicateConsId = activeTrailers[tId].some(r => r.consId === consId);
                
                if (!isDuplicateConsId && consId !== '') {
                    activeTrailers[tId].push({ state, assetId, unitType, pieceCount, consId });
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
            else if (scanState === 'SINGLE_CHECK') {
                statusBadge.style.backgroundColor = '#9c27b0'; statusBadge.style.color = 'white'; 
                textEl.innerText = `🟣 SINGLE CHECK IN CORSO...`;
            }
            else if (timeDiff < 6000) {
                statusBadge.style.backgroundColor = '#28a745'; textEl.innerText = `🟢 SYNC ATTIVO (${numTrailers} TRL)`;
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

            // FIX STRUTTURALE DOM per mantenere l'icona separata dai colli
            if (!customInfo) {
                customInfo = document.createElement('div');
                customInfo.id = 'tnt-custom-info-' + bayNum;
                customInfo.className = 'yos-container-custom-info';
                
                if (isZone400) customInfo.classList.add('yos-zone-400');
                if (isZone300) customInfo.classList.add('yos-zone-300');
                
                // SPAN separato per contenere ✅, X, ! o ?
                let statusSpan = document.createElement('span');
                statusSpan.className = 'yos-status-text';
                customInfo.appendChild(statusSpan);

                // DIV separato per il badge dei colli
                let pieceBadge = document.createElement('div');
                pieceBadge.className = 'yos-piece-count-badge';
                customInfo.appendChild(pieceBadge);

                container.appendChild(customInfo);
            }

            let statusSpan = customInfo.querySelector('.yos-status-text');
            let pieceBadge = customInfo.querySelector('.yos-piece-count-badge');
            
            const unitIdMatch = parentUnit.id.match(/unit_(\d+)/);
            let trailerId = "";
            if (unitIdMatch) {
                const nameDiv = document.getElementById('unitname_' + unitIdMatch[1]);
                if (nameDiv) trailerId = nameDiv.innerText.trim().toUpperCase();
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

            // LOGICA COLORI E COLLI YOS 
            let targetText = "X";
            let targetBg = "rgba(0, 0, 0, 0.6)";
            let targetColor = "white";
            let targetBorder = isCacheOld ? "2px solid red" : "none";
            let totalPieces = 0;

            if (trailerId !== "" && currentConsTrailers[trailerId]) {
                const records = currentConsTrailers[trailerId];
                
                if (records.length > 0) {
                    const trailers = records.filter(r => r.unitType === 'TRAILER');
                    const bulks = records.filter(r => r.unitType === 'OTHER' || r.unitType === 'BAG');

                    totalPieces = records.reduce((acc, r) => acc + (r.pieceCount || 0), 0);

                    if (trailers.length > 1) {
                        targetText = "!"; targetBg = "rgba(220, 53, 69, 0.9)"; targetColor = "white";
                    } else if (bulks.length > 0) {
                        targetText = "?"; targetBg = "rgba(255, 193, 7, 0.9)"; targetColor = "black";
                    } else if (trailers.length === 1) {
                        targetText = "✅"; targetBg = "rgba(40, 167, 69, 0.9)"; targetColor = "white";
                    }
                }
            } 

            // Applica stili visivi in modo sicuro (non distrugge i nodi figli)
            if (statusSpan && statusSpan.innerText !== targetText) statusSpan.innerText = targetText;
            if (customInfo.style.backgroundColor !== targetBg) customInfo.style.backgroundColor = targetBg;
            if (customInfo.style.color !== targetColor) customInfo.style.color = targetColor;
            if (customInfo.style.border !== targetBorder) customInfo.style.border = targetBorder;

            // Mostra o nascondi il badge dei colli
            if (totalPieces > 0 && pieceBadge) {
                if (pieceBadge.innerText !== totalPieces + " pz") pieceBadge.innerText = totalPieces + " pz";
                if (pieceBadge.style.display !== "block") pieceBadge.style.display = "block";
            } else if (pieceBadge) {
                if (pieceBadge.style.display !== "none") pieceBadge.style.display = "none";
            }
        });
    }

    // ==========================================
    // HACK: WEB WORKER (Anti-Throttling Background)
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
        };
        timerWorker.postMessage('start');
        
    } catch (e) {
        console.warn("[YOS-SYNC] ⚠️ Web Worker bloccato. Uso setInterval standard.");
        setInterval(() => {
            scanConsMaintenance();
            injectIntoYosContainers();
        }, 500);
    }

})();

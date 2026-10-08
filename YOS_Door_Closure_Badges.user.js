// ==UserScript==
// @name         YOS Door Closure Badges
// @namespace    http://tampermonkey.net/
// @version      1.13
// @description  Carico e scarico. Chiusura baie piu cutoff chute gialle.
// @author       Lorenzo Scurati
// @match        https://yos.apps.tnt.com/hub-overview*
// @updateURL    https://raw.githubusercontent.com/LorenzoScurati/publicfede/main/YOS_Door_Closure_Badges.user.js
// @downloadURL  https://raw.githubusercontent.com/LorenzoScurati/publicfede/main/YOS_Door_Closure_Badges.user.js
// @grant        none
// ==/UserScript==
(function () {
    'use strict';
    const TIME_WINDOW_MINUTES = 180;
    let globalOutboundCache = [];
    let lastUpdateStr = "In attesa dati...";
    let timeFilterApplied = false;
    let isVisuallyHidden = false;

    // Baie gialle = scarico (inbound), non carico. Restano fuori da questo script.
    // 719-728 IMPORT, 729-732 EXPORT, 815-818 EXPORT-CUSTOMER.
    function isScaricoBay(bayNum) {
        return (bayNum >= 719 && bayNum <= 732) || (bayNum >= 815 && bayNum <= 818);
    }

    function getZone(bayNum) {
        if (bayNum >= 300 && bayNum <= 399) return '300';
        if (bayNum >= 400 && bayNum <= 499) return '400';
        if (bayNum >= 700 && bayNum <= 799) return '700';
        if (bayNum >= 800 && bayNum <= 899) return '800';
        return null;
    }

    // --- REGOLE CHIUSURA (Suddivise e commentate) ---
    const CLOSURE_RULES = {
        // 1. STANDARD (-20 MINUTI)
        'BO2': 20, 'AN6': 20, 'FC5': 20, 'PD2': 20, 'RMZ': 20, 'NT3': 20, 'FIA': 20, 'QZR': 20, 'NC3': 20, 'ROM': 20,
        'PSA': 20, 'BA5': 20, 'TV1': 20, 'BO1': 20, 'QVA': 20, 'TO1': 20, 'ZD1': 20, 'IBU': 20, 'ICM': 20, 'IIM': 20,
        'VE1': 20, 'IBD': 20, 'QPA': 20, 'VNZ': 20, 'PMF': 20, 'IPO': 20, 'QPZ': 20, 'CUF': 20, 'AOT': 20, 'OSO': 20,
        'MIL': 20, 'RNV': 20, 'ILJ': 20, 'ISV': 20, 'BEA': 20, 'REM': 20, 'FCO': 20, 'MDA': 20, 'VRN': 20, 'MM1': 20,
        'BRG': 20, 'VBS': 20, 'GOA': 20, 'MZ1': 20, 'OS3': 20, 'QAL': 20, 'IOE': 20, 'MZ2': 20, 'MOL': 20, 'HN1': 20, 'BM': 20,
        // 2. ANTICIPO 40 MINUTI
        'ATH': 40, 'MRS': 40, 'XPI': 40, 'LYS': 40, 'MXP': 40, '06A': 40,
        // 3. ANTICIPO 1 ORA (60 MINUTI)
        'SKG': 60, 'MV9': 60, 'XWT': 60, 'KR9': 60, 'DNG': 60, 'HNJ': 60, 'QAR': 60, 'MAD': 60, 'WA1': 60, 'BCN': 60,
        'BZQ': 60, 'DFT': 60, 'Z8C': 20, '93A': 60,
        // 4. ANTICIPO 2 ORE (120 MINUTI)
        'ZRH': 120, 'DZ5': 120, 'LUG': 120, 'KG4': 120
    };

    function getClosureOffsetMinutes(dest) {
        if (!dest) return 20;
        const clean = String(dest).split('+')[0].trim();
        if (CLOSURE_RULES[clean] !== undefined) return CLOSURE_RULES[clean];
        if (CLOSURE_RULES[dest] !== undefined) return CLOSURE_RULES[dest];
        for (const key in CLOSURE_RULES) {
            if (clean.startsWith(key)) return CLOSURE_RULES[key];
        }
        return 20;
    }

    // --- STILI CSS UNIFICATI ---
    const style = document.createElement('style');
    style.innerHTML = `
        /* Trasparenza attiva che mantiene il DOM vivo */
        body.yos-hide-panel app-responsive-task-panel { opacity: 0 !important; pointer-events: none !important; transform: scale(0.01) !important; transform-origin: top left !important; position: fixed !important; z-index: -9999 !important; }
        /* Container UI in Basso a Sinistra - NOTA: Usiamo prefisso tnt-yos- per eludere il MutationObserver dell'altro script */
        #tnt-yos-ui-container { position: fixed; bottom: 20px; left: 20px; z-index: 999999; display: flex; flex-direction: column; gap: 10px; }
        .yos-btn { color: #fff; border: none; padding: 10px 16px; border-radius: 6px; font-weight: bold; font-size: 13px; cursor: pointer; box-shadow: 0 4px 10px rgba(0,0,0,0.5); transition: background-color 0.2s; text-align: left; }
        #tnt-yos-export-btn { background-color: #007bff; }
        #tnt-yos-export-btn:hover { background-color: #0056b3; }
        #tnt-yos-toggle-btn { background-color: #6c757d; }
        #tnt-yos-toggle-btn:hover { background-color: #5a6268; }
        #tnt-yos-status-indicator { background: #18191a; color: #28a745; border: 1px solid #28a745; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: bold; font-family: sans-serif; box-shadow: 0 4px 10px rgba(0,0,0,0.5); display: flex; align-items: center; gap: 8px; pointer-events: none; }
        #tnt-yos-status-indicator .dot { width: 10px; height: 10px; background-color: #28a745; border-radius: 50%; box-shadow: 0 0 8px #28a745; }
        /* 400 e 700 sotto la baia, 300 e 800 sopra */
        .trailer_unit.door, .reverse_trailer_unit.door { position: relative; }
        .trailer_unit.door:hover, .reverse_trailer_unit.door:hover { z-index: 400 !important; }
        .tnt-yos-close {
            position: absolute !important;
            left: 50% !important;
            transform: translateX(-50%) !important;
            z-index: 80 !important;
            min-width: 52px !important;
            padding: 4px 6px !important;
            border-radius: 5px !important;
            border: 2px solid rgba(255,255,255,0.9) !important;
            box-shadow: 0 2px 6px rgba(0,0,0,0.7) !important;
            pointer-events: none !important;
            text-align: center !important;
            line-height: 1 !important;
            white-space: nowrap !important;
            transition: transform 0.12s ease !important;
        }
        .trailer_unit.door:hover .tnt-yos-close,
        .reverse_trailer_unit.door:hover .tnt-yos-close {
            z-index: 500 !important;
            transform: translateX(-50%) scale(1.55) !important;
        }
        .tnt-yos-above { top: -30px !important; }
        .tnt-yos-below { bottom: -30px !important; }
        .tnt-yos-time {
            font-family: Roboto, sans-serif !important;
            font-size: 15px !important;
            font-weight: 800 !important;
            letter-spacing: -0.2px !important;
            text-shadow: 0 1px 1px rgba(0,0,0,0.45) !important;
        }
        .yos-bg-nextday { background: #4a5158 !important; color: #f4f6f8 !important; }
        .yos-bg-normal  { background: #00c2e0 !important; color: #04181c !important; }
        .yos-bg-warning { background: #ffe14a !important; color: #1a1400 !important; }
        .yos-bg-urgent  { background: #ff7a00 !important; color: #1a0d00 !important; }
        .yos-bg-expired { background: #ff2d3a !important; color: #ffffff !important; }
        .yos-bg-closed  { background: #00e05a !important; color: #04210e !important; }
        /* Modale Tabelle */
        .yos-modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.75); z-index: 100000; display: flex; align-items: center; justify-content: center; font-family: sans-serif; }
        .yos-modal-content { background: #272828; color: #e3e3e3; width: 90%; max-width: 1250px; max-height: 85vh; border-radius: 8px; border: 1px solid #444; display: flex; flex-direction: column; box-shadow: 0 4px 20px rgba(0,0,0,0.6); }
        .yos-modal-header { padding: 15px 20px; background: #333435; border-bottom: 1px solid #444; display: flex; justify-content: space-between; align-items: center; }
        .yos-modal-header h3 { margin: 0; font-size: 16px; color: #fff; }
        .yos-modal-tabs { display: flex; gap: 10px; padding: 10px 20px; background: #1e1e1e; border-bottom: 1px solid #444; align-items: center; flex-wrap: wrap; }
        .yos-tab-btn { background: #3a3b3c; color: #ccc; border: none; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 13px; }
        .yos-tab-btn.active { background: #007bff; color: #fff; font-weight: bold; }
        .yos-modal-body { padding: 15px; overflow-y: auto; flex: 1; }
        .yos-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .yos-table th, .yos-table td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #3d3e3f; }
        .yos-table th { background: #1f2020; color: #aaa; position: sticky; top: 0; z-index: 2; }
        .yos-section-divider { background-color: #0d47a1 !important; color: #ffffff !important; font-weight: bold; font-size: 13px; padding: 8px 12px !important; }
        .yos-row-urgent { background-color: rgba(255, 193, 7, 0.22) !important; color: #ffda6a; }
        .yos-row-imminent { background-color: rgba(255, 152, 0, 0.25) !important; color: #ffb74d !important; }
        .yos-row-expired { background-color: rgba(244, 67, 54, 0.2) !important; color: #ef9a9a !important; }
        .yos-row-waiting-window { background-color: rgba(255, 235, 59, 0.08) !important; color: #fff176; }
        .yos-row-managed { background-color: rgba(40, 167, 69, 0.22) !important; color: #85e39d !important; border-left: 4px solid #28a745; }
        .yos-modal-footer { padding: 12px 20px; background: #333435; border-top: 1px solid #444; display: flex; justify-content: space-between; align-items: center; }
        .yos-btn-close { background: #dc3545; color: white; border: none; padding: 6px 14px; border-radius: 4px; cursor: pointer; }
        .yos-btn-csv { background: #28a745; color: white; border: none; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 13px; }
        .yos-btn-img { background: #17a2b8; color: white; border: none; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 13px; }
    `;
    document.head.appendChild(style);

    // --- SETUP INTERFACCIA ---
    function initUI() {
        if (document.getElementById('tnt-yos-ui-container')) return;
        const container = document.createElement('div');
        container.id = 'tnt-yos-ui-container';
        const indicator = document.createElement('div');
        indicator.id = 'tnt-yos-status-indicator';
        indicator.innerHTML = `<span class="dot" id="tnt-yos-dot"></span> <span id="tnt-yos-status-text">Attesa Outbound...</span>`;
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'tnt-yos-toggle-btn';
        toggleBtn.className = 'yos-btn';
        toggleBtn.innerHTML = '👁️ Nascondi Pannello';
        toggleBtn.onclick = () => {
            isVisuallyHidden = !isVisuallyHidden;
            if (isVisuallyHidden) {
                document.body.classList.add('yos-hide-panel');
                toggleBtn.innerHTML = '👁️ Mostra Pannello';
                toggleBtn.style.backgroundColor = '#17a2b8';
            } else {
                document.body.classList.remove('yos-hide-panel');
                toggleBtn.innerHTML = '👁️ Nascondi Pannello';
                toggleBtn.style.backgroundColor = '#6c757d';
            }
        };
        const exportBtn = document.createElement('button');
        exportBtn.id = 'tnt-yos-export-btn';
        exportBtn.className = 'yos-btn';
        exportBtn.innerHTML = '📊 Esporta Outbound';
        exportBtn.onclick = buildAndShowModal;
        container.appendChild(indicator);
        container.appendChild(toggleBtn);
        container.appendChild(exportBtn);
        document.body.appendChild(container);
    }

    // --- AGGIORNAMENTO STATO ---
    function updateStatusUI(isPanelOpen) {
        const statusText = document.getElementById('tnt-yos-status-text');
        const statusDot = document.getElementById('tnt-yos-dot');
        const indicator = document.getElementById('tnt-yos-status-indicator');
        if (!statusText) return;
        if (isPanelOpen) {
            statusText.innerText = `🟢 IN LETTURA (${globalOutboundCache.length} mezzi)`;
            statusDot.style.backgroundColor = '#28a745';
            statusDot.style.boxShadow = '0 0 8px #28a745';
            indicator.style.borderColor = '#28a745';
        } else {
            statusText.innerText = `🟠 CACHE FERMA (${globalOutboundCache.length} mezzi)`;
            statusDot.style.backgroundColor = '#ff9800';
            statusDot.style.boxShadow = '0 0 8px #ff9800';
            indicator.style.borderColor = '#ff9800';
        }
    }

    // --- AUTOMAZIONE DATA E ORA SU 3 GIORNI (Ieri -> Domani) ---
    function fixDateTimeFilter() {
        const isPanelOpen = document.querySelector('app-outbound') !== null;
        if (!isPanelOpen) {
            timeFilterApplied = false;
            return;
        }
        if (timeFilterApplied) return;
        const calIcon = document.querySelector('.calendar-icon-image[src*="duration.svg"]');
        const applyBtn = Array.from(document.querySelectorAll('*')).find(el => el.textContent && el.textContent.trim() === 'APPLY DURATION' && el.children.length === 0);
        if (!applyBtn && calIcon) {
            calIcon.click();
            return;
        }
        if (applyBtn) {
            const popup = applyBtn.closest('.cdk-overlay-pane, .mat-dialog-container') || document.body;
            const textInputs = Array.from(popup.querySelectorAll('input[type="text"]'));
            const startTimeInput = popup.querySelector('input.start-time');
            const endTimeInput = popup.querySelector('input.end-time');
            let startDateInput = null;
            let endDateInput = null;
            for (let i = 0; i < textInputs.length; i++) {
                if (textInputs[i] === startTimeInput && i > 0) startDateInput = textInputs[i - 1];
                if (textInputs[i] === endTimeInput && i > 0) endDateInput = textInputs[i - 1];
            }
            const now = new Date();
            const dateIeri = new Date(now); dateIeri.setDate(now.getDate() - 1);
            const dateDomani = new Date(now); dateDomani.setDate(now.getDate() + 1);
            const formatD = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
            const strIeri = formatD(dateIeri);
            const strDomani = formatD(dateDomani);
            function setAngularVal(el, val) {
                if (el && el.value !== val) {
                    el.value = val;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    el.dispatchEvent(new Event('blur', { bubbles: true }));
                }
            }
            setAngularVal(startDateInput, strIeri);
            setAngularVal(startTimeInput, '00:00');
            setAngularVal(endDateInput, strDomani);
            setAngularVal(endTimeInput, '23:59');
            setTimeout(() => {
                applyBtn.click();
                timeFilterApplied = true;
            }, 300);
        }
    }

    // --- FUNZIONE DI CALCOLO DINAMICA (Dal Dynamic Same-Day Fix) ---
    function getClosureDetails(dateStr, depTimeStr, offsetMinutes) {
        try {
            const [depH, depM] = depTimeStr.split(':').map(Number);
            if (isNaN(depH) || isNaN(depM)) return null;
            const now = new Date();
            let depDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), depH, depM, 0, 0);
            if (dateStr && dateStr.includes('-')) {
                const [day, month] = dateStr.split('-').map(Number);
                depDate.setMonth(month - 1, day);
            } else if ((depDate.getTime() - now.getTime()) < -12 * 3600 * 1000) {
                depDate.setDate(depDate.getDate() + 1);
            }
            const closureDate = new Date(depDate.getTime() - (offsetMinutes * 60 * 1000));
            const isDifferentDay = closureDate.getDate() !== now.getDate() || closureDate.getMonth() !== now.getMonth();
            const diffMinutes = Math.round((closureDate.getTime() - now.getTime()) / 60000);
            const closureH = String(closureDate.getHours()).padStart(2, '0');
            const closureM = String(closureDate.getMinutes()).padStart(2, '0');
            return { closureTimeStr: `${closureH}:${closureM}`, diffMinutes, isDifferentDay, minutesLeft: Math.round((depDate.getTime() - now.getTime()) / 60000) };
        } catch (e) {
            return null;
        }
    }

    function formatRemainingTime(minToClosure, isManaged) {
        if (isManaged) return 'CHIUSO';
        if (minToClosure < 0) return `${minToClosure} min (Scaduto)`;
        if (minToClosure >= 60) {
            const h = Math.floor(minToClosure / 60);
            const m = minToClosure % 60;
            return `${minToClosure} min (${h}h ${m}m)`;
        }
        return `${minToClosure} min`;
    }

    function readText(el) {
        return el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '';
    }

    // --- LETTURA E AGGIORNAMENTO CACHE ---
    function updateCache() {
        const panel = document.querySelector('app-outbound');
        updateStatusUI(panel !== null);
        if (panel) {
            const items = [];
            const now = new Date();
            const scheduledElements = panel.querySelectorAll('outbound-scheduled');
            scheduledElements.forEach(el => {
                const dateEl = el.querySelector('.outbound-dates-position-change');
                const doorEl = el.querySelector('.outbound-door-number');
                const destEl = el.querySelector('.outbound-current-destination');
                const dateText = readText(dateEl);
                const doorText = readText(doorEl);
                const destText = readText(destEl);
                const timeMatch = dateText.match(/(\d{2}-\d{2})\s+(\d{2}:\d{2})/) || (el.innerText || '').match(/(\d{2}-\d{2})\s+(\d{2}:\d{2})/);
                if (!timeMatch) return;

                const giorno = timeMatch[1];
                const oraPartenza = timeMatch[2];
                // 300 / 400 / 700 / 800. I parcheggi Pxxx restano fuori.
                const bayMatch = doorText.match(/^(?:3\d\d|4\d\d|7\d\d|8\d\d)$/) || (el.innerText || '').match(/\b(3\d\d|4\d\d|7\d\d|8\d\d)\b/);
                const isParking = /^P\d{3}$/i.test(doorText) || /\bP\d{3}\b/i.test(el.innerText || '');
                if (!bayMatch || isParking) return;

                const bay = bayMatch[1] || bayMatch[0];
                const bayNum = parseInt(bay, 10);
                if (isScaricoBay(bayNum)) return;

                const zone = getZone(bayNum);
                if (!zone) return;

                let dest = destText && destText !== '-' ? destText : '-';
                if (dest === '-') {
                    const parts = (el.innerText || '').split(/\s+|\t+/).filter(Boolean);
                    for (let p of parts) {
                        p = p.trim();
                        if (/^[A-Z0-9]{2,6}(\+[A-Z0-9]+)?$/.test(p) && p !== bay && /[A-Z]/.test(p) && !['OUTBOUND', 'SCHEDULED', 'ALLOCATED', 'LOCATION'].includes(p)) {
                            dest = p;
                            break;
                        }
                    }
                }

                const isBlueManaged = el.querySelector('.highlight-task') !== null || el.classList.contains('highlight-task');
                const closureOffset = getClosureOffsetMinutes(dest);
                const closureInfo = getClosureDetails(giorno, oraPartenza, closureOffset);
                let closureTimeStr = '-';
                let minutesToClosure = 999;
                let isDifferentDay = false;
                let isWithin180Min = false;
                if (closureInfo) {
                    closureTimeStr = closureInfo.closureTimeStr;
                    minutesToClosure = closureInfo.diffMinutes;
                    isDifferentDay = closureInfo.isDifferentDay;
                    isWithin180Min = closureInfo.minutesLeft >= 0 && closureInfo.minutesLeft <= TIME_WINDOW_MINUTES;
                }
                const isUrgent = !isBlueManaged && minutesToClosure <= 10 && minutesToClosure >= 0;
                const isImminent = !isBlueManaged && minutesToClosure > 10 && minutesToClosure <= 20;
                const isExpired = !isBlueManaged && minutesToClosure < 0;
                items.push({
                    giorno, oraPartenza, dest, bay, bayNum, zone,
                    minutesToClosure, closureTimeStr, closureOffset,
                    isManaged: isBlueManaged, isUrgent, isImminent, isExpired, isWithin180Min, isDifferentDay
                });
            });

            const uniqueItems = [];
            const map = new Map();
            for (const item of items) {
                const key = `${item.giorno}-${item.oraPartenza}-${item.bay}`;
                if (!map.has(key)) {
                    map.set(key, true);
                    uniqueItems.push(item);
                }
            }
            globalOutboundCache = uniqueItems;
            lastUpdateStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        }
    }

    function clearDoorMark(container) {
        container.querySelectorAll('.yos-door-badge, .tnt-yos-close').forEach(node => node.remove());
        const bg = container.querySelector('.docking_bg, .reverse_docking_bg');
        if (bg) {
            bg.classList.remove('tnt-yos-dock');
            bg.style.removeProperty('--tnt-edge');
        }
    }

    // Orario dentro il trailer, sul lato dell'etichetta destinazione.
    // 800 (etichetta sotto): in basso sul trailer, lontano dalla targa.
    // 700 reverse (etichetta sopra): in alto sul trailer, lontano dalla targa.
    function processBadges() {
        const scheduleMap = {};
        globalOutboundCache.forEach(d => {
            const prev = scheduleMap[d.bay];
            if (!prev || d.minutesToClosure < prev.minutesToClosure) scheduleMap[d.bay] = d;
        });
        const doorContainers = document.querySelectorAll('.trailer_unit.door, .reverse_trailer_unit.door');
        doorContainers.forEach(container => {
            const doorNumEl = container.querySelector('.door_number, .reverse_door_number');
            if (!doorNumEl) return;
            const bayText = doorNumEl.innerText.replace(/\s+/g, '').trim();
            const bayMatch = bayText.match(/^(3\d\d|4\d\d|5\d\d|6\d\d|7\d\d|8\d\d)$/);
            if (!bayMatch) return;
            const bayNum = bayMatch[1] || bayMatch[0];
            const bayInt = parseInt(bayNum, 10);
            const host = container.querySelector('.unit.container, .reverse_unit.container');
            const bg = container.querySelector('.docking_bg, .reverse_docking_bg');

            if (isScaricoBay(bayInt) || !scheduleMap[bayNum]) {
                clearDoorMark(container);
                return;
            }

            const data = scheduleMap[bayNum];
            let colorClass = 'yos-bg-normal';
            if (data.isManaged) colorClass = 'yos-bg-closed';
            else if (data.isDifferentDay) colorClass = 'yos-bg-nextday';
            else if (data.minutesToClosure < 0) colorClass = 'yos-bg-expired';
            else if (data.minutesToClosure <= 30) colorClass = 'yos-bg-urgent';
            else if (data.minutesToClosure <= 60) colorClass = 'yos-bg-warning';

            const positionClass = (bayInt >= 800 && bayInt <= 899) ? 'tnt-yos-above'
                : (bayInt >= 700 && bayInt <= 799) ? 'tnt-yos-below'
                : (bayInt >= 400 && bayInt <= 499) ? 'tnt-yos-below'
                : 'tnt-yos-above';
            container.querySelectorAll('.tnt-yos-close, .yos-door-badge').forEach(node => node.remove());
            const badge = document.createElement('div');
            badge.id = `tnt-yos-badge-${bayNum}`;
            badge.className = `tnt-yos-close ${positionClass} ${colorClass}`;
            badge.innerHTML = `<span class="tnt-yos-time">${data.closureTimeStr}</span>`;
            badge.title = `Baia ${bayNum} | Dest: ${data.dest || '-'} | Partenza: ${data.oraPartenza} | Chiusura: ${data.closureTimeStr} (-${data.closureOffset}m)`;
            container.appendChild(badge);
        });
    }

    // --- LOGICA MODALE PER ESPORTAZIONE DATI ---
    let activeZone = '400';
    const ZONES = ['400', '300', '700', '800'];

    function groupZoneItems(itemList, zone) {
        const filtered = itemList.filter(d => d.zone === zone);
        const byClose = (a, b) => a.minutesToClosure - b.minutesToClosure;
        if (zone === '400') {
            const bassa = filtered.filter(d => d.bayNum >= 401 && d.bayNum <= 429).sort(byClose);
            const alta = filtered.filter(d => d.bayNum >= 430 && d.bayNum <= 456).sort(byClose);
            return [{ title: '📍 ZONA 400 BASSA (BAIE 401 - 429)', items: bassa }, { title: '📍 ZONA 400 ALTA (BAIE 430 - 456)', items: alta }];
        } else if (zone === '300') {
            const bassa = filtered.filter(d => d.bayNum >= 301 && d.bayNum <= 327).sort(byClose);
            const alta = filtered.filter(d => d.bayNum >= 328 && d.bayNum <= 355).sort(byClose);
            return [{ title: '📍 ZONA 300 BASSA (BAIE 301 - 327)', items: bassa }, { title: '📍 ZONA 300 ALTA (BAIE 328 - 355)', items: alta }];
        } else if (zone === '700') {
            const sinistra = filtered.filter(d => d.bayNum >= 701 && d.bayNum <= 718).sort(byClose);
            const destra = filtered.filter(d => d.bayNum >= 733 && d.bayNum <= 746).sort(byClose);
            const altre = filtered.filter(d => !((d.bayNum >= 701 && d.bayNum <= 718) || (d.bayNum >= 733 && d.bayNum <= 746))).sort(byClose);
            const groups = [
                { title: '📍 ZONA 700 SINISTRA (BAIE 701 - 718)', items: sinistra },
                { title: '📍 ZONA 700 DESTRA (BAIE 733 - 746) — scarico 719-732 escluso', items: destra }
            ];
            if (altre.length) groups.push({ title: '📍 ZONA 700 ALTRE', items: altre });
            return groups;
        } else if (zone === '800') {
            const sinistra = filtered.filter(d => d.bayNum >= 819 && d.bayNum <= 846).sort(byClose);
            const destra = filtered.filter(d => d.bayNum >= 800 && d.bayNum <= 814).sort(byClose);
            const altre = filtered.filter(d => !((d.bayNum >= 819 && d.bayNum <= 846) || (d.bayNum >= 800 && d.bayNum <= 814))).sort(byClose);
            const groups = [
                { title: '📍 ZONA 800 SINISTRA (BAIE 819 - 846)', items: sinistra },
                { title: '📍 ZONA 800 DESTRA (BAIE 800 - 814) — scarico 815-818 escluso', items: destra }
            ];
            if (altre.length) groups.push({ title: '📍 ZONA 800 ALTRE', items: altre });
            return groups;
        }
        return [];
    }

    function buildAndShowModal() {
        if (globalOutboundCache.length === 0) {
            alert("Nessun dato! Assicurati di aprire il menu 'Outbound View' almeno una volta per dare inizio al caricamento.");
            return;
        }
        const existing = document.getElementById('tnt-yos-modal');
        if (existing) existing.remove();
        const modal = document.createElement('div');
        modal.id = 'tnt-yos-modal';
        modal.className = 'yos-modal-overlay';
        const tabButtons = ZONES.map(z => `<button class="yos-tab-btn ${activeZone === z ? 'active' : ''}" id="tab-${z}">Zona ${z}</button>`).join('');
        modal.innerHTML = `
            <div class="yos-modal-content">
                <div class="yos-modal-header">
                    <h3>📊 Outbound Schedulati (Dati estratti alle: ${lastUpdateStr})</h3>
                    <button class="yos-btn-close" id="yos-close-x">✕</button>
                </div>
                <div class="yos-modal-tabs">
                    ${tabButtons}
                    <div style="margin-left:auto; display:flex; align-items:center; gap:10px;">
                        <button class="yos-btn-img" id="top-img-btn">📸 Scarica Immagine</button>
                        <button class="yos-btn-csv" id="top-csv-btn">📥 Scarica CSV</button>
                        <label style="font-size:12px; margin-left:5px;"><input type="checkbox" id="yos-select-all"> Seleziona Tutti</label>
                    </div>
                </div>
                <div class="yos-modal-body">
                    <table class="yos-table">
                        <thead>
                            <tr><th style="width: 40px;">Sel.</th><th>Baia / Pos.</th><th>Giorno</th><th>Ora Partenza</th><th>Destinazione</th><th>Orario Chiusura</th><th>Tempo Rimanente</th><th>Stato</th></tr>
                        </thead>
                        <tbody id="yos-table-body"></tbody>
                    </table>
                </div>
                <div class="yos-modal-footer">
                    <button class="yos-btn-close" id="yos-close-btn">Chiudi</button>
                    <div style="display:flex; gap:10px;">
                        <button class="yos-btn-img" id="bot-img-btn">📸 Scarica Immagine PNG</button>
                        <button class="yos-btn-csv" id="bot-csv-btn">📥 Scarica CSV Selezione</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        document.getElementById('yos-close-x').onclick = () => modal.remove();
        document.getElementById('yos-close-btn').onclick = () => modal.remove();
        ZONES.forEach(z => {
            document.getElementById(`tab-${z}`).onclick = () => { activeZone = z; updateTabStyles(); renderTableRows(); };
        });
        document.getElementById('yos-select-all').onchange = (e) => { document.querySelectorAll('.yos-row-check').forEach(cb => cb.checked = e.target.checked); };
        document.getElementById('top-csv-btn').onclick = downloadCSV; document.getElementById('bot-csv-btn').onclick = downloadCSV;
        document.getElementById('top-img-btn').onclick = generateImage; document.getElementById('bot-img-btn').onclick = generateImage;
        renderTableRows();
    }

    function updateTabStyles() {
        ZONES.forEach(z => {
            const el = document.getElementById(`tab-${z}`);
            if (el) el.className = `yos-tab-btn ${activeZone === z ? 'active' : ''}`;
        });
    }

    function renderTableRows() {
        const tbody = document.getElementById('yos-table-body');
        tbody.innerHTML = '';
        const groups = groupZoneItems(globalOutboundCache, activeZone);
        let totalItems = 0; let allChecked = true;
        groups.forEach(group => {
            if (group.items.length > 0) {
                totalItems += group.items.length;
                const sectionTr = document.createElement('tr');
                sectionTr.innerHTML = `<td colspan="8" class="yos-section-divider">${group.title}</td>`;
                tbody.appendChild(sectionTr);
                group.items.forEach(row => {
                    const tr = document.createElement('tr');
                    if (row.isManaged) tr.className = 'yos-row-managed';
                    else if (row.isExpired) tr.className = 'yos-row-expired';
                    else if (row.isUrgent) tr.className = 'yos-row-urgent';
                    else if (row.isImminent) tr.className = 'yos-row-imminent';
                    else if (row.isWithin180Min) tr.className = 'yos-row-waiting-window';
                    const isChecked = row.isWithin180Min || row.isManaged ? 'checked' : '';
                    if (!isChecked) allChecked = false;
                    let statusDisplay = 'In attesa';
                    if (row.isManaged) statusDisplay = '<span style="color:#28a745; font-weight:bold;">CHIUSO</span>';
                    else if (row.isExpired) statusDisplay = '<span style="color:#f44336; font-weight:bold;">🚨 SCADUTO</span>';
                    else if (row.isUrgent) statusDisplay = '<span style="color:#ffda6a; font-weight:bold;">⚠️ DA CHIUDERE</span>';
                    else if (row.isImminent) statusDisplay = '<span style="color:#ff9800; font-weight:bold;">🟠 CHIUSURA IMMINENTE</span>';
                    tr.innerHTML = `
                        <td><input type="checkbox" class="yos-row-check" data-bay="${row.bay}" data-time="${row.oraPartenza}" ${isChecked}></td>
                        <td><strong>${row.bay}</strong></td>
                        <td>${row.giorno}</td>
                        <td>${row.oraPartenza}</td>
                        <td><strong>${row.dest}</strong></td>
                        <td><strong>${row.closureTimeStr} (-${row.closureOffset}m)</strong></td>
                        <td><strong>${formatRemainingTime(row.minutesToClosure, row.isManaged)}</strong></td>
                        <td>${statusDisplay}</td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        });
        if (totalItems === 0) { tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 20px; color: #888;">Nessun mezzo in memoria.</td></tr>`; }
        const selectAllCb = document.getElementById('yos-select-all');
        if (selectAllCb) selectAllCb.checked = allChecked;
    }

    function getSelectedData() {
        const selectedData = [];
        document.querySelectorAll('.yos-row-check').forEach(cb => {
            if (cb.checked) {
                const bay = cb.getAttribute('data-bay'); const time = cb.getAttribute('data-time');
                const found = globalOutboundCache.find(d => d.bay === bay && d.oraPartenza === time);
                if (found) selectedData.push(found);
            }
        });
        return selectedData;
    }

    function downloadCSV() {
        const selectedData = getSelectedData();
        if (selectedData.length === 0) { alert('Seleziona almeno una riga da scaricare!'); return; }
        let csvContent = 'data:text/csv;charset=utf-8,Zona,Baia,Giorno,Ora Partenza,Destinazione,Orario Chiusura,Tempo Rimanente,Stato\n';
        selectedData.forEach(r => {
            const remaining = formatRemainingTime(r.minutesToClosure, r.isManaged);
            const stato = r.isManaged ? 'CHIUSO' : (r.isExpired ? 'SCADUTO' : (r.isUrgent ? 'DA CHIUDERE' : (r.isImminent ? 'CHIUSURA IMMINENTE' : 'In attesa')));
            csvContent += `"${r.zone}","${r.bay}","${r.giorno}","${r.oraPartenza}","${r.dest}","${r.closureTimeStr}","${remaining}","${stato}"\n`;
        });
        const link = document.createElement('a'); link.setAttribute('href', encodeURI(csvContent));
        link.setAttribute('download', `Outbound_Zona_${activeZone}_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
    }

    function generateImage() {
        const selectedData = getSelectedData();
        if (selectedData.length === 0) { alert('Seleziona almeno una riga da esportare!'); return; }
        const groups = groupZoneItems(selectedData, activeZone);
        const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
        const rowHeight = 38, subHeaderHeight = 32, mainHeaderHeight = 85, width = 1000;
        let totalRows = 0, totalSubHeaders = 0;
        groups.forEach(g => { if (g.items.length > 0) { totalSubHeaders++; totalRows += g.items.length; } });
        const height = mainHeaderHeight + (totalSubHeaders * subHeaderHeight) + (totalRows * rowHeight) + 20;
        canvas.width = width * 2; canvas.height = height * 2; ctx.scale(2, 2);
        ctx.fillStyle = '#1e1e1e'; ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#007bff'; ctx.fillRect(0, 0, width, 45);
        ctx.fillStyle = '#ffffff'; ctx.font = 'bold 16px Roboto, sans-serif';
        ctx.fillText(`OUTBOUND SCHEDULE — ZONA ${activeZone}`, 20, 28);
        const now24h = `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;
        ctx.font = '12px Roboto, sans-serif'; ctx.fillText(`Aggiornato ore: ${now24h}`, width - 160, 28);
        ctx.fillStyle = '#2d2d2d'; ctx.fillRect(0, 45, width, 40);
        ctx.fillStyle = '#aaaaaa'; ctx.font = 'bold 12px Roboto, sans-serif';
        ctx.fillText('BAIA', 20, 68); ctx.fillText('GIORNO', 90, 68); ctx.fillText('PARTENZA', 180, 68);
        ctx.fillText('DESTINAZIONE', 290, 68); ctx.fillText('ORARIO CHIUSURA', 420, 68); ctx.fillText('TEMPO RIMANENTE', 580, 68); ctx.fillText('STATO', 780, 68);
        let y = 85;
        groups.forEach(g => {
            if (g.items.length > 0) {
                ctx.fillStyle = '#0d47a1'; ctx.fillRect(0, y, width, subHeaderHeight);
                ctx.fillStyle = '#ffffff'; ctx.font = 'bold 13px Roboto, sans-serif';
                ctx.fillText(g.title, 20, y + 21);
                y += subHeaderHeight;
                g.items.forEach((r, i) => {
                    if (r.isManaged) { ctx.fillStyle = 'rgba(40, 167, 69, 0.2)'; ctx.fillRect(0, y, width, rowHeight); ctx.fillStyle = '#28a745'; ctx.fillRect(0, y, 6, rowHeight); }
                    else if (r.isExpired) { ctx.fillStyle = 'rgba(244, 67, 54, 0.2)'; ctx.fillRect(0, y, width, rowHeight); }
                    else if (r.isUrgent) { ctx.fillStyle = 'rgba(255, 193, 7, 0.18)'; ctx.fillRect(0, y, width, rowHeight); }
                    else if (r.isImminent) { ctx.fillStyle = 'rgba(255, 152, 0, 0.22)'; ctx.fillRect(0, y, width, rowHeight); }
                    else { ctx.fillStyle = i % 2 === 0 ? '#252627' : '#1e1e1e'; ctx.fillRect(0, y, width, rowHeight); }
                    ctx.fillStyle = '#333333'; ctx.fillRect(0, y + rowHeight - 1, width, 1);
                    ctx.font = 'bold 13px Roboto, sans-serif';
                    ctx.fillStyle = r.isManaged ? '#85e39d' : (r.isExpired ? '#ef9a9a' : (r.isUrgent ? '#ffda6a' : (r.isImminent ? '#ffb74d' : '#ffffff')));
                    ctx.fillText(r.bay, 20, y + 24);
                    ctx.font = '12px Roboto, sans-serif'; ctx.fillStyle = '#e3e3e3';
                    ctx.fillText(r.giorno, 90, y + 24); ctx.fillText(r.oraPartenza, 180, y + 24);
                    ctx.font = 'bold 12px Roboto, sans-serif'; ctx.fillText(r.dest, 290, y + 24);
                    ctx.fillText(`${r.closureTimeStr} (-${r.closureOffset}m)`, 420, y + 24);
                    ctx.fillText(formatRemainingTime(r.minutesToClosure, r.isManaged), 580, y + 24);
                    if (r.isManaged) { ctx.fillStyle = '#28a745'; ctx.fillText('CHIUSO', 780, y + 24); }
                    else if (r.isExpired) { ctx.fillStyle = '#f44336'; ctx.fillText('🚨 SCADUTO', 780, y + 24); }
                    else if (r.isUrgent) { ctx.fillStyle = '#ffda6a'; ctx.fillText('⚠️ DA CHIUDERE', 780, y + 24); }
                    else if (r.isImminent) { ctx.fillStyle = '#ff9800'; ctx.fillText('🟠 CHIUSURA IMMINENTE', 780, y + 24); }
                    else { ctx.fillStyle = '#aaaaaa'; ctx.fillText('In attesa', 780, y + 24); }
                    y += rowHeight;
                });
            }
        });
        const link = document.createElement('a'); link.download = `Outbound_Zona_${activeZone}_${String(new Date().getHours()).padStart(2, '0')}-${String(new Date().getMinutes()).padStart(2, '0')}.png`;
        link.href = canvas.toDataURL('image/png'); link.click();
    }

    // --- SCARICO (chute gialle) ---
    const cacheMovimenti = new Map();
    const CODICI_INTERNAZIONALI = new Set(['BCN', 'XXJ', 'LUG', 'MAD', 'HNJ', 'MRS', 'PRG', 'MV9', 'LYS', 'SKG', 'ATH', 'DFT', 'DFT*', 'DNG', 'DNG*', 'XWT', 'WA1', 'BZQ', 'QAR', 'IIM', 'LJU', 'ZRH', 'ECL', 'KCW']);
    const MARGINE_DOM = 60;
    const MARGINE_INT = 150;
    const CATEGORIE = [
        { nome: 'Import Prima', short: 'IMPORT', ore: 21, min: 30, codici: ['DNG', 'QAR', 'XWT', 'MAD', 'WA1', 'BZQ', 'MV9', 'BCN', 'DFT', 'MXP', 'XXJ'] },
        { nome: 'Clienti Dom.', short: 'CLIENTI', ore: 21, min: 45, codici: ['AOS1', 'ESSENZ', 'SATCI', 'GAMESTOP', 'AT21', 'CEMB', 'RUBI', 'PJLO', 'COWA', 'HILT', 'INCO', 'PENT', 'LIVA', 'RUNN', 'PNT1', 'TRAS', 'COVD'] },
        { nome: 'Filiali Sud', short: 'SUD', ore: 21, min: 45, codici: ['ISV', 'IOE', 'PRG'] },
        { nome: 'Imp Down.', short: 'IMPORT', ore: 23, min: 45, codici: ['HNJ', 'DNG*', 'DFT*', 'BCN', 'ECL', 'LUG'] },
        { nome: 'Mix Italia', short: 'MIX', ore: 23, min: 45, codici: ['CUF', 'OS3', 'IBU', 'IPO', 'ICM', 'RNV', 'ILJ', 'QVA', 'QAL', 'BEA', 'BRG', 'MZ1', 'GOA', 'OSO', 'B8Y', 'M1S', 'TO1', 'ZD1', 'MIL'] },
        { nome: 'Filiali Exp.', short: 'EXPORT', ore: 1, min: 0, codici: ['VBS', 'MM1', 'VE1', 'IBD', 'REM', 'BO1', 'B7Q', 'QPA', 'VRN', 'MDA', 'PMF', 'IIM'] },
        { nome: 'Clienti Int.', short: 'CLIENTI', ore: 1, min: 0, codici: ['GEWI', 'MASE', 'APLE', 'UFAL', 'GDEC'] },
        { nome: 'Div 07', short: 'NORD', ore: 4, min: 0, codici: ['BRG', 'IPO', 'MZ1', 'IBU', 'TO1', 'MM1', 'VRN', 'VNZ', 'TV1', 'VE1'] },
        { nome: 'Import Seconda', short: 'IMPORT', ore: 4, min: 0, codici: ['MV9', 'BCN', 'SKG', 'XWT', 'ATH', 'KCW'] },
        { nome: 'Hub 07 Nord', short: 'HUB', ore: 5, min: 30, codici: ['BO2', 'PD2', 'FC5', 'PSA', 'ZRO', 'PSR', 'LJU'] },
        { nome: 'Hub Exp/Sud', short: 'EXPORT', ore: 8, min: 50, codici: ['AN6', 'FIA', 'NC3', 'NT3', 'GDEC', 'COFR', 'UFAL', 'APLE'] },
        { nome: 'Imp Anticipi', short: 'IMPORT', ore: 8, min: 50, codici: ['LYS', 'MRS', 'NT3', 'BA5'] }
    ];
    const CODE_SET = new Set(CATEGORIE.flatMap((c) => c.codici));
    const GROUP_FALLBACK = { IMPORT: 'Import Prima', MIX: 'Mix Italia', EXPORT: 'Filiali Exp.', 'EXP+': 'Hub Exp/Sud' };

    const scaricoStyle = document.createElement('style');
    scaricoStyle.textContent = `
        .trailer_unit.door, .reverse_trailer_unit.door { position: relative; }
        .trailer_unit.door:hover, .reverse_trailer_unit.door:hover { z-index: 400 !important; }
        .tnt-scarico-under {
            position: absolute !important; left: 50% !important; transform: translateX(-50%) !important;
            z-index: 90 !important; min-width: 52px !important; padding: 3px 6px !important;
            border-radius: 5px !important; border: 2px dashed rgba(255,255,255,0.95) !important;
            box-shadow: 0 2px 6px rgba(0,0,0,0.7) !important; pointer-events: none !important;
            text-align: center !important; line-height: 1.05 !important; white-space: nowrap !important;
        }
        .tnt-sc-above { top: -32px !important; }
        .tnt-sc-below { bottom: -32px !important; }
        .tnt-scarico-kind { display: block !important; font: 800 9px Roboto, sans-serif !important; }
        .tnt-scarico-time { display: block !important; font: 800 14px Roboto, sans-serif !important; }
        .tnt-scarico-vert {
            position: absolute !important; left: 50% !important; top: 46% !important;
            transform: translate(-50%, -50%) !important; z-index: 70 !important;
            writing-mode: vertical-rl !important; font: 800 11px Roboto, sans-serif !important;
            letter-spacing: 1px !important; color: #1a1400 !important;
            background: rgba(255, 225, 74, 0.92) !important; border: 1px dashed #fff !important;
            border-radius: 3px !important; padding: 4px 2px !important; pointer-events: none !important;
        }
        .trailer_unit.door:hover .tnt-scarico-under,
        .reverse_trailer_unit.door:hover .tnt-scarico-under { z-index: 500 !important; transform: translateX(-50%) scale(1.4) !important; }
        .tnt-sc-cyan { background: #00c2e0 !important; color: #04181c !important; }
        .tnt-sc-yellow { background: #ffe14a !important; color: #1a1400 !important; }
        .tnt-sc-orange { background: #ff7a00 !important; color: #1a0d00 !important; }
        .tnt-sc-red { background: #ff2d3a !important; color: #fff !important; }
        .tnt-sc-gray { background: #4a5158 !important; color: #f4f6f8 !important; }
    `;
    document.head.appendChild(scaricoStyle);

    function readJson(key) {
        try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
    }
    function hydrateFromYosTool() {
        const movimenti = readJson('tnt_cache_movimenti_per_unit_v1') || {};
        Object.keys(movimenti).forEach((id) => {
            const mov = movimenti[id];
            if (!mov) return;
            cacheMovimenti.set(String(id), { origin: mov.origin, dest: mov.destination || mov.dest, actualArrival: mov.actualArrival || mov.scheduleArrival || mov.estimatedArrival });
        });
    }
    function storeMov(unitId, unitName, data) {
        if (unitId) cacheMovimenti.set(String(unitId), data);
        if (unitName) cacheMovimenti.set(String(unitName).trim(), data);
    }
    function parseXhrResponse(url, testo) {
        try {
            if (url && String(url).indexOf('dockingDoors') !== -1) {
                const porte = JSON.parse(testo);
                if (!Array.isArray(porte)) return;
                const arrivi = readJson('tnt_arrivi_baia_scarico_v1') || {};
                let changed = false;
                porte.forEach((porta) => {
                    const doorNumber = porta && porta.doorName;
                    const unit = porta && porta.unitDTO;
                    if (!doorNumber) return;
                    if (porta.status !== 'OCCUPIED' || !unit) {
                        if (arrivi[doorNumber]) { delete arrivi[doorNumber]; changed = true; }
                        return;
                    }
                    const orario = unit.updatedDateTimestamp || unit.updatedDate || new Date().toISOString();
                    if (!arrivi[doorNumber] || arrivi[doorNumber].unitId !== unit.unitId) {
                        arrivi[doorNumber] = { unitId: unit.unitId, orario: orario };
                        changed = true;
                    }
                    if (unit.unitName) storeMov(unit.unitId, unit.unitName, cacheMovimenti.get(String(unit.unitId)) || { origin: '', actualArrival: orario });
                });
                if (changed) localStorage.setItem('tnt_arrivi_baia_scarico_v1', JSON.stringify(arrivi));
                return;
            }
            const dati = JSON.parse(testo);
            if (Array.isArray(dati) && dati.length && dati[0].movementId) {
                dati.forEach((mov) => {
                    (mov.units || []).forEach((u) => {
                        if (!u.unitId) return;
                        storeMov(u.unitId, u.unitName, { origin: mov.origin, dest: mov.destination, actualArrival: mov.actualArrival || mov.scheduleArrival });
                    });
                });
            }
        } catch (e) {}
    }
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) { this._tntUrl = url; return origOpen.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function (body) {
        this.addEventListener('load', function () { parseXhrResponse(this._tntUrl, this.responseText); });
        return origSend.apply(this, arguments);
    };

    function isYellow(el) {
        if (!el) return false;
        const c = (el.style.backgroundColor || window.getComputedStyle(el).backgroundColor || '').replace(/\s/g, '');
        return c === 'rgb(255,217,127)' || c === 'rgb(255,217,128)' || c === 'rgb(255,214,102)';
    }
    function isScaricoBay(bay, container) {
        const known = (bay >= 101 && bay <= 114) || (bay >= 201 && bay <= 214)
            || (bay >= 501 && bay <= 514) || (bay >= 601 && bay <= 614)
            || (bay >= 719 && bay <= 732) || (bay >= 815 && bay <= 818);
        if (known) return true;
        const bg = container.querySelector('.docking_bg, .reverse_docking_bg');
        if (!isYellow(bg)) return false;
        return (bay >= 100 && bay <= 299) || (bay >= 500 && bay <= 699) || (bay >= 700 && bay <= 899);
    }
    function positionClass(bay) {
        if ((bay >= 800 && bay <= 899) || (bay >= 100 && bay <= 199) || (bay >= 500 && bay <= 599)) return 'tnt-sc-above';
        return 'tnt-sc-below';
    }
    function groupType(container, bay) {
        const text = (container.innerText || '').toUpperCase();
        if (text.includes('EXP+') || (bay >= 815 && bay <= 818)) return 'EXP+';
        if (text.includes('EXPORT') || (bay >= 729 && bay <= 732)) return 'EXPORT';
        if (text.includes('MIX') || (bay >= 725 && bay <= 728)) return 'MIX';
        if (text.includes('IMPORT') || (bay >= 719 && bay <= 724)) return 'IMPORT';
        return '';
    }
    function codeFromText(text) {
        const parts = String(text || '').toUpperCase().split(/[^A-Z0-9*]+/);
        return parts.find((p) => CODE_SET.has(p) || CODE_SET.has(p + '*')) || '';
    }
    function eOrarioDiChiusura(data) {
        const minuti = data.getHours() * 60 + data.getMinutes();
        if (data.getDay() === 6 && minuti >= 120) return true;
        if (data.getDay() === 0 && minuti < 20 * 60 + 30) return true;
        return false;
    }
    function calcolaCutoffInbound(codice, arrivo, arrivoPorta) {
        const margine = CODICI_INTERNAZIONALI.has(codice) ? MARGINE_INT : MARGINE_DOM;
        const candidati = CATEGORIE.filter((c) => c.codici.includes(codice));
        if (!candidati.length || !arrivo) return null;
        const choices = [];
        candidati.forEach((cat) => {
            for (let offset = -1; offset <= 5; offset++) {
                const d = new Date(arrivo.getFullYear(), arrivo.getMonth(), arrivo.getDate() + offset, cat.ore, cat.min, 0, 0);
                if (d.getTime() >= arrivo.getTime() && !eOrarioDiChiusura(d)) { choices.push({ cat, cutoffDate: d }); break; }
            }
        });
        if (!choices.length) return null;
        choices.sort((a, b) => a.cutoffDate - b.cutoffDate);
        let risultato = choices[0];
        for (let i = 0; i < choices.length; i++) {
            if ((choices[i].cutoffDate - arrivo) / 60000 >= margine) { risultato = choices[i]; break; }
        }
        if (arrivoPorta && arrivoPorta > arrivo && (risultato.cutoffDate - arrivoPorta) / 60000 < margine) {
            const base = risultato.cutoffDate;
            for (let offset = 0; offset <= 5; offset++) {
                const d = new Date(arrivoPorta.getFullYear(), arrivoPorta.getMonth(), arrivoPorta.getDate() + offset, risultato.cat.ore, risultato.cat.min, 0, 0);
                if (d > base && (d - arrivoPorta) / 60000 >= margine && !eOrarioDiChiusura(d)) return { cat: risultato.cat, cutoffDate: d };
            }
        }
        return risultato;
    }
    function parseWhen(value) {
        if (!value) return null;
        if (value instanceof Date) return value;
        const text = String(value);
        const full = text.match(/(\d{2})[\/\-](\d{2})(?:[\/\-]\d{2,4})?\s+(\d{2}):(\d{2})/);
        const now = new Date();
        if (full) return new Date(now.getFullYear(), Number(full[2]) - 1, Number(full[1]), Number(full[3]), Number(full[4]), 0, 0);
        const iso = Date.parse(text);
        if (!isNaN(iso)) return new Date(iso);
        return null;
    }
    function harvestDom() {
        document.querySelectorAll('.arrival_units').forEach((el) => {
            const title = el.getAttribute('title') || '';
            const originEl = el.querySelector('.inbound-origin-en-route, .inbound-origin');
            const arrivalEl = el.querySelector('.arrival-time-en-route, .arrival-time');
            if (!title || !originEl) return;
            const parts = title.split('#');
            const data = { origin: originEl.textContent.trim(), dest: 'IMR', actualArrival: arrivalEl ? arrivalEl.textContent.trim() : '' };
            storeMov(parts[1], parts[0], data);
        });
    }
    function lookup(container, bay) {
        harvestDom();
        const arrivi = readJson('tnt_arrivi_baia_scarico_v1') || {};
        const nameEl = container.querySelector('.unit_name, .reverse_unit_name');
        const assignEl = container.querySelector('[class*="assign_text"]');
        const unitName = nameEl ? nameEl.textContent.trim() : '';
        const arrivo = arrivi[String(bay)];
        let mov = cacheMovimenti.get(unitName) || (arrivo && cacheMovimenti.get(String(arrivo.unitId))) || null;
        const domCode = codeFromText(assignEl && assignEl.textContent) || codeFromText(container.innerText);
        const origin = (mov && mov.origin) || domCode || '';
        const arrival = parseWhen(mov && mov.actualArrival) || parseWhen(arrivo && arrivo.orario) || new Date();
        const porta = parseWhen(arrivo && arrivo.orario);
        return { origin, arrival, porta, unitName };
    }
    function colorClass(when) {
        if (!when) return 'tnt-sc-gray';
        const now = new Date();
        const diff = Math.round((when.getTime() - now.getTime()) / 60000);
        if (when.getDate() !== now.getDate() || when.getMonth() !== now.getMonth()) return 'tnt-sc-gray';
        if (diff < 0) return 'tnt-sc-red';
        if (diff <= 30) return 'tnt-sc-orange';
        if (diff <= 60) return 'tnt-sc-yellow';
        return 'tnt-sc-cyan';
    }
    function paintScarico() {
        hydrateFromYosTool();
        document.querySelectorAll('.trailer_unit.door, .reverse_trailer_unit.door').forEach((container) => {
            const doorNumEl = container.querySelector('.door_number, .reverse_door_number');
            if (!doorNumEl) return;
            const bayMatch = (doorNumEl.innerText || '').replace(/\s+/g, '').match(/^(1\d\d|2\d\d|5\d\d|6\d\d|7\d\d|8\d\d)$/);
            if (!bayMatch) return;
            const bay = parseInt(bayMatch[1], 10);
            const oldUnder = container.querySelector('.tnt-scarico-under');
            const oldVert = container.querySelector('.tnt-scarico-vert');
            if (!isScaricoBay(bay, container)) {
                if (oldUnder) oldUnder.remove();
                if (oldVert) oldVert.remove();
                return;
            }
            const info = lookup(container, bay);
            const group = groupType(container, bay);
            let label = group || 'SCARICO';
            let when = null;
            let title = info.unitName || 'senza cassa';
            if (info.origin) {
                const res = calcolaCutoffInbound(info.origin, info.arrival, info.porta);
                if (res) {
                    label = res.cat.short;
                    when = res.cutoffDate;
                    title = res.cat.nome + ' | ' + info.origin;
                }
            }
            if (!when && group && GROUP_FALLBACK[group]) {
                const cat = CATEGORIE.find((c) => c.nome === GROUP_FALLBACK[group]);
                if (cat) {
                    label = cat.short;
                    when = new Date();
                    when.setHours(cat.ore, cat.min, 0, 0);
                    if (when.getTime() < Date.now() - 30 * 60000) when.setDate(when.getDate() + 1);
                    title = cat.nome + ' | chute ' + group;
                }
            }
            const time = when ? String(when.getHours()).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0') : '--:--';
            let pill = oldUnder;
            if (!pill) { pill = document.createElement('div'); container.appendChild(pill); }
            pill.className = 'tnt-scarico-under ' + positionClass(bay) + ' ' + colorClass(when);
            pill.innerHTML = '<span class="tnt-scarico-kind">' + label + '</span><span class="tnt-scarico-time">' + time + '</span>';
            pill.title = title + ' | cutoff ' + time;
            const host = container.querySelector('.unit.container, .reverse_unit.container') || container;
            let tag = oldVert;
            if (!tag) { tag = document.createElement('div'); tag.className = 'tnt-scarico-vert'; host.appendChild(tag); }
            if (tag.textContent !== label) tag.textContent = label;
        });
    }
    
    // --- TIMERS ---
    setInterval(initUI, 1000);
    setInterval(fixDateTimeFilter, 1000);
    setInterval(updateCache, 1500);
    setInterval(processBadges, 2000);
    setInterval(paintScarico, 2000);
    setTimeout(paintScarico, 800);
})();

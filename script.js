/**
 * @file This script handles the logic for a solar battery storage simulation application.
 * It allows users to upload their energy consumption data (HDF format),
 * configure battery and financial parameters, and run a simulation to see
 * the potential savings and performance of a battery system.
 *
 * @author Your Name/Team
 * @version 2.7.1
 * @changelog
 * - v2.7.1:
 * - (Fix) Corrected a logic regression from v2.7.0. The pre-emptive discharge logic for Export Maximiser strategies was incorrectly nested, preventing it from running. This has been fixed to restore the original, correct behavior.
 * - v2.7.0:
 * - (Feat) Added new 'Historical Forecast Charging' strategy.
 * - v2.6.1:
 * - (Fix) Removed duplicate event listeners in updateUIWithResults.
 */

document.addEventListener('DOMContentLoaded', () => {

    // --- CONSTANTS --- //
    const HOURS_PER_INTERVAL = 0.5;
    const INTERVALS_PER_DAY = 24 / HOURS_PER_INTERVAL;
    const DAYS_IN_YEAR = 365;
    const FLOAT_TOLERANCE = 0.001;
    const FORECAST_CONSUMPTION_THRESHOLD = 0.75;
    const GENERIC_MPRN = "12345678912";
    const GENERIC_METER_ID = "SIMULATED_METER";
    const THIRTY_MINUTES_MS = 30 * 60 * 1000;

    // --- APPLICATION STATE --- //
    let fullData = [];
    let simulationResults = {};
    let isSimulating = false;
    let energyChartInstance = null;
    let socChartInstance = null;
    let monthlyConsumptionChartInstance = null;
    let optimizationChartInstance = null;
    let pvgisMonthlyChartInstance = null;
    let pvgisUnscaledData = null;

    // --- INITIALIZATION --- //
    function initialize() {
        setupUI();
        setupEventListeners();
        updateFinancialsUI();
        document.getElementById('importTariffHourly').dispatchEvent(new Event('change'));
        document.getElementById('exportTariffFlat').dispatchEvent(new Event('change'));
    }

    function setupUI() {
        createHourlyRateInputs();
        lucide.createIcons();
    }

    function setupEventListeners() {
        document.getElementById('calculateBtn').addEventListener('click', runFullSimulation);
        document.getElementById('exportBtn').addEventListener('click', exportResultsToCSV);
        document.getElementById('exportHdfScBtn')?.addEventListener('click', () => exportSimulatedHDF('selfConsumption'));
        document.getElementById('exportHdfEmBtn')?.addEventListener('click', () => exportSimulatedHDF('exportMaximiser'));
        document.getElementById('exportHdfBemBtn')?.addEventListener('click', () => exportSimulatedHDF('balancedExportMaximiser'));
        document.getElementById('exportHdfImBtn')?.addEventListener('click', () => exportSimulatedHDF('importMinimiser'));
        document.getElementById('exportHdfHfBtn')?.addEventListener('click', () => exportSimulatedHDF('historicalForecast'));
        document.getElementById('monthSelector').addEventListener('change', e => updateDaySelector(e.target.value));
        document.getElementById('daySelector').addEventListener('change', e => updateDailyView(e.target.value));
        document.getElementById('prevDayBtn').addEventListener('click', () => navigateDay(-1));
        document.getElementById('nextDayBtn').addEventListener('click', () => navigateDay(1));
        document.querySelectorAll('input[name="strategy"]').forEach(radio => {
            radio.addEventListener('change', handleStrategyChange);
        });
        document.querySelectorAll('input[name="dataSource"]').forEach(radio => {
            radio.addEventListener('change', handleDataSourceChange);
        });
        const pvgisFileEl = document.getElementById('pvgisFile');
        if (pvgisFileEl) {
            pvgisFileEl.addEventListener('change', handlePvgisFileChange);
        }
        document.querySelectorAll('input[name="importTariffType"], input[name="exportTariffType"]').forEach(radio => {
            radio.addEventListener('change', handleTariffTypeChange);
        });
        document.querySelectorAll('[data-tooltip-target]').forEach(button => {
            button.addEventListener('click', handleTooltipToggle);
        });
        document.addEventListener('click', () => {
             document.querySelectorAll('.tooltip').forEach(tooltip => tooltip.classList.add('hidden'));
        });
    }

    // --- UI & EVENT HANDLERS --- //
    function createHourlyRateInputs() {
        const createTable = (type, defaultValues) => {
            let tableHTML = `<table class="tariff-table"><thead><tr>
                <th class="border-r border-gray-200">Time</th>
                <th class="text-center">Rate (€/kWh)</th>
                <th class="force-control-col hidden text-center" title="Force Charge Period"><i data-lucide="zap" class="h-4 w-4 inline-block"></i></th>
            </tr></thead><tbody>`;
            for (let i = 0; i < 24; i++) {
                const defaultValue = Array.isArray(defaultValues) ? defaultValues[i] : defaultValues;
                const hour = i.toString().padStart(2, '0');
                tableHTML += `<tr>
                    <td class="border-r border-gray-200">${hour}:00-${hour}:59</td>
                    <td class="text-center"><input type="number" id="${type}-rate-${i}" class="input-field rate-input" value="${defaultValue}" step="0.01"></td>
                    <td class="force-control-col hidden text-center">
                        <label class="force-cb-label"><input type="checkbox" id="${type}-force-charge-${i}" class="h-4 w-4"></label>
                    </td>
                </tr>`;
            }
            tableHTML += '</tbody></table>';
            return tableHTML;
        };
        const defaultImportRates = Array(24).fill('0.42');
        defaultImportRates[2] = '0.06';
        defaultImportRates[3] = '0.06';
        defaultImportRates[4] = '0.06';
        const defaultExportRate = '0.25';
        document.getElementById('hourlyImportGrid').innerHTML = createTable('import', defaultImportRates);
        document.getElementById('hourlyExportGrid').innerHTML = createTable('export', defaultExportRate);
    }
    
    function updateFinancialsUI() {
        const strategy = document.querySelector('input[name="strategy"]:checked')?.value || 'self-consumption';
        const requiresForceCharge = ['export-maximiser', 'balanced-export-maximiser', 'import-minimiser', 'historical-forecast'].includes(strategy);
        document.querySelectorAll('.force-control-col').forEach(c => c.classList.toggle('hidden', !requiresForceCharge));
        document.getElementById('force-charge-warning').classList.toggle('hidden', !requiresForceCharge);
        if (requiresForceCharge) {
            const importHourlyRadio = document.getElementById('importTariffHourly');
            if (!importHourlyRadio.checked) {
                importHourlyRadio.checked = true;
                importHourlyRadio.dispatchEvent(new Event('change'));
            }
        }
        document.querySelectorAll('.strategy-description').forEach(el => el.classList.add('hidden'));
        const descEl = document.getElementById(`desc-${strategy}`);
        if (descEl) {
            descEl.classList.remove('hidden');
        }
    }

    function handleStrategyChange() {
        updateFinancialsUI();
        if (simulationResults.selfConsumption) {
            const monthSelector = document.getElementById('monthSelector');
            if (monthSelector.value)
                updateDaySelector(monthSelector.value);
        }
    }

    function handleDataSourceChange(e) {
        const pvgisOptions = document.getElementById('pvgis-options');
        if (e.target.value === 'pvgis') {
            pvgisOptions.classList.remove('hidden');
        } else {
            pvgisOptions.classList.add('hidden');
        }
    }

    async function handlePvgisFileChange(e) {
        const file = e.target.files[0];
        const summaryContainer = document.getElementById('pvgis-summary');
        const summaryMetricsEl = document.getElementById('pvgis-summary-metrics');
        if (!summaryContainer || !summaryMetricsEl) {
            console.error("PVGIS summary UI elements are missing from the DOM.");
            return;
        }
        pvgisUnscaledData = null;
        if (!file) {
            summaryContainer.classList.add('hidden');
            return;
        }
        summaryMetricsEl.innerHTML = '<p>Parsing file...</p>';
        summaryContainer.classList.remove('hidden');
        if (pvgisMonthlyChartInstance) pvgisMonthlyChartInstance.destroy();
        try {
            const csvText = await file.text();
            pvgisUnscaledData = parsePvgisCsv(csvText);
            if (pvgisUnscaledData.data.length === 0) throw new Error("No data found in PVGIS file.");
            updatePvgisDisplay();
        } catch (error) {
            console.error("Error parsing PVGIS file:", error);
            summaryMetricsEl.innerHTML = `<p class="text-red-500 font-semibold">Error: ${error.message}</p>`;
            if (pvgisMonthlyChartInstance) pvgisMonthlyChartInstance.destroy();
        }
    }

    function updatePvgisDisplay() {
        if (!pvgisUnscaledData) return;
        const summaryMetricsEl = document.getElementById('pvgis-summary-metrics');
        const dataForSummary = pvgisUnscaledData.data;
        const metadata = pvgisUnscaledData.metadata;
        const summary = calculatePvgisSummary(dataForSummary);
        let specifiedPowerHtml = '';
        if (metadata.specifiedPeakPower) {
            specifiedPowerHtml = `<p><strong>Specified System Size (in file):</strong> ${metadata.specifiedPeakPower.toFixed(2)} kWp</p>`;
        }
        let yearInfoHtml = '';
        if (summary.isMultiYear) {
            yearInfoHtml = `<p class="text-indigo-600"><strong>Data Year Displayed:</strong> ${summary.yearUsed} (latest from multi-year file)</p>`;
        }
        summaryMetricsEl.innerHTML = `
            ${specifiedPowerHtml}
            <p><strong>Peak Power Output:</strong> ${summary.peakPower.toFixed(2)} kW</p>
            <p><strong>Total Annual Generation:</strong> ${summary.totalAnnualGeneration.toFixed(0)} kWh</p>
            ${yearInfoHtml}
        `;
        generatePvgisMonthlyChart(summary.monthlyGeneration);
        lucide.createIcons();
    }

    function handleTariffTypeChange(e) {
        const type = e.target.name.includes('import') ? 'import' : 'export';
        const isHourly = e.target.value === 'hourly';
        document.getElementById(`${type}FlatRateSection`).classList.toggle('hidden', isHourly);
        document.getElementById(`${type}HourlyRateSection`).classList.toggle('hidden', !isHourly);
    }

    function handleTooltipToggle(e) {
        e.stopPropagation();
        const tooltipId = e.currentTarget.getAttribute('data-tooltip-target');
        const tooltip = document.getElementById(tooltipId);
        if (tooltip) {
            document.querySelectorAll('.tooltip').forEach(t => {
                if (t.id !== tooltipId) {
                    t.classList.add('hidden');
                }
            });
            tooltip.classList.toggle('hidden');
        }
    }

    function navigateDay(direction) {
        const daySelector = document.getElementById('daySelector');
        const newIndex = daySelector.selectedIndex + direction;
        if (newIndex >= 0 && newIndex < daySelector.options.length) {
            daySelector.selectedIndex = newIndex;
            daySelector.dispatchEvent(new Event('change'));
        }
    }
    
    function setStatus(message, type = 'info') {
        const statusEl = document.getElementById('status');
        statusEl.textContent = message;
        statusEl.className = 'text-center mt-2 mb-4 text-sm font-medium';
        switch (type) {
            case 'error': statusEl.classList.add('text-red-500'); break;
            case 'success': statusEl.classList.add('text-green-500'); break;
            case 'warning': statusEl.classList.add('text-yellow-500'); break;
            case 'loading': statusEl.classList.add('text-gray-500'); break;
            default: statusEl.classList.add('text-gray-700'); break;
        }
    }

    // --- DATA PARSING & PREPARATION --- //
    function parseHDF(csvText) {
        const lines = csvText.trim().split('\n');
        let headerIndex = -1;
        let header;
        for (let i = 0; i < lines.length; i++) {
            const lowerLine = lines[i].toLowerCase();
            if (lowerLine.includes('read date') && lowerLine.includes('read type') && (lowerLine.includes('read value') || lowerLine.includes('read val'))) {
                headerIndex = i;
                header = lines[i].split(',').map(h => h.trim().replace(/"/g, ''));
                break;
            }
        }
        if (headerIndex === -1) {
            throw new Error('Could not find a valid header row in HDF file. Expected "Read Date", "Read Type", and "Read Value" columns.');
        }
        const dateIndex = header.findIndex(h => h.toLowerCase().includes('read date'));
        const typeIndex = header.findIndex(h => h.toLowerCase().includes('read type'));
        const valueIndex = header.findIndex(h => h.toLowerCase().includes('read value') || h.toLowerCase().includes('read val'));
        if (dateIndex === -1 || typeIndex === -1 || valueIndex === -1) {
            throw new Error('HDF file is missing required columns (Date, Type, or Value).');
        }
        const dataMap = new Map();
        for (let i = headerIndex + 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            const values = lines[i].split(',');
            if (values.length <= Math.max(dateIndex, typeIndex, valueIndex)) continue;
            const dateStr = values[dateIndex]?.trim().replace(/"/g, '');
            const dateParts = dateStr?.match(/(\d{2})[\/-](\d{2})[\/-](\d{4})\s(\d{2}):(\d{2})/);
            if (!dateParts) continue;
            const [, day, month, year, hour, minute] = dateParts;
            const originalTimestamp = new Date(`${year}-${month}-${day}T${hour}:${minute}:00Z`);
            if (isNaN(originalTimestamp.getTime())) continue;
            const halfHourBucketTimestamp = new Date(originalTimestamp.getTime() - THIRTY_MINUTES_MS);
            const key = halfHourBucketTimestamp.toISOString();
            const readType = values[typeIndex]?.trim().replace(/"/g, '').toLowerCase();
            const readValue = parseFloat(values[valueIndex]);
            if (!readType || isNaN(readValue)) continue;
            if (!dataMap.has(key)) {
                dataMap.set(key, { timestamp: halfHourBucketTimestamp, consumption: 0, generation: 0 });
            }
            const entry = dataMap.get(key);
            if (readType.includes('active import')) {
                entry.consumption += readValue;
            } else if (readType.includes('active export')) {
                entry.generation += readValue;
            }
        }
        if (dataMap.size === 0) return [];
        return Array.from(dataMap.values()).sort((a, b) => a.timestamp - b.timestamp);
    }
    
    function parsePvgisCsv(csvText) {
        const lines = csvText.trim().split('\n');
        let dataStartIndex = -1;
        let headers = [];
        const metadata = { specifiedPeakPower: null };
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('#') && line.includes('peakpower=')) {
                const match = line.match(/peakpower=([0-9.]+)/);
                if (match && match[1]) {
                    metadata.specifiedPeakPower = parseFloat(match[1]);
                }
            }
            if (line.toLowerCase().startsWith('time,p,')) {
                dataStartIndex = i + 1;
                headers = line.split(',').map(h => h.trim());
                break;
            }
        }
        if (dataStartIndex === -1) {
            throw new Error('Could not find a valid data header row in the PVGIS file. Expected a line starting with "time,P,...".');
        }
        const pIndex = headers.findIndex(h => h === 'P');
        if (pIndex === -1) throw new Error('PVGIS file is missing the required "P" (power) column.');
        const pvgisData = [];
        for (let i = dataStartIndex; i < lines.length; i++) {
            const values = lines[i].split(',');
            pvgisData.push({ time: values[0], P: parseFloat(values[pIndex]) });
        }
        return { data: pvgisData, metadata: metadata };
    }

    function calculatePvgisSummary(rawPvgisData) {
        let latestYear = 0;
        const allYears = new Set();
        rawPvgisData.forEach(d => {
            const year = parseInt(d.time.substring(0, 4), 10);
            allYears.add(year);
            if (year > latestYear) {
                latestYear = year;
            }
        });
        const singleYearData = rawPvgisData.filter(d => {
            const year = parseInt(d.time.substring(0, 4), 10);
            return year === latestYear;
        });
        const monthlyGeneration = Array(12).fill(0);
        let totalAnnualGeneration = 0;
        let peakPower = 0;
        const transformedData = transformPvgisData(singleYearData);
        transformedData.forEach(d => {
            const monthIndex = d.timestamp.getUTCMonth();
            monthlyGeneration[monthIndex] += d.generation;
            totalAnnualGeneration += d.generation;
        });
        singleYearData.forEach(d => {
            if (d.P > peakPower) peakPower = d.P;
        });
        return { monthlyGeneration, totalAnnualGeneration, peakPower: peakPower / 1000, yearUsed: latestYear, isMultiYear: allYears.size > 1 };
    }

    function filterLast12FullMonths(data) {
        if (data.length === 0) return [];
        const latestTimestamp = data[data.length - 1].timestamp;
        const endDate = new Date(latestTimestamp);
        endDate.setUTCDate(1);
        endDate.setUTCHours(0, 0, 0, 0);
        const startDate = new Date(endDate);
        startDate.setUTCFullYear(startDate.getUTCFullYear() - 1);
        return data.filter(row => row.timestamp >= startDate && row.timestamp < endDate);
    }

    const yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0));

    // --- SIMULATION CORE --- //
    async function runFullSimulation() {
        if (isSimulating) { return; }
        const params = getSimulationParameters();
        const hasForceChargeHours = params.forceChargeHours.some(h => h === true);
        const requiresForceCharge = ['export-maximiser', 'balanced-export-maximiser', 'import-minimiser', 'historical-forecast'].includes(params.strategy);
        if (requiresForceCharge && !hasForceChargeHours) {
            setStatus(`Error: For the selected strategy, you must select at least one hour for Force Charging.`, 'error');
            return;
        }
        isSimulating = true;
        document.getElementById('calculateBtn').disabled = true;
        try {
            const file = document.getElementById('csvFile').files[0];
            if (!file) throw new Error('Please select a CSV data file.');
            setStatus('Reading and parsing your HDF data file...', 'loading');
            await yieldToBrowser();
            if (params.dataSource === 'pvgis') {
                const pvgisFile = document.getElementById('pvgisFile').files[0];
                if (!pvgisFile) throw new Error('Please select a PVGIS CSV file.');
                setStatus('Reading and parsing your PVGIS data file...', 'loading');
                await yieldToBrowser();
                const fileText = await file.text();
                let parsedData = parseHDF(fileText);
                if (parsedData.length === 0) throw new Error('No valid data rows were parsed from the HDF file. Please check the file format.');
                const pvgisText = await pvgisFile.text();
                const pvgisResult = parsePvgisCsv(pvgisText);
                const transformedPvgisData = transformPvgisData(pvgisResult.data);
                parsedData = mergePvgisData(parsedData, transformedPvgisData);
                setStatus('PVGIS data merged. Filtering data...', 'loading');
                await yieldToBrowser();
                fullData = filterLast12FullMonths(parsedData);
            } else {
                const fileText = await file.text();
                let parsedData = parseHDF(fileText);
                if (parsedData.length === 0) throw new Error('No valid data rows were parsed from the HDF file. Please check the file format.');
                fullData = filterLast12FullMonths(parsedData);
            }
            if (fullData.length === 0) throw new Error('No data found within the last 12 full months. Please ensure your file contains a recent and complete year of data.');
            const uniqueMonths = new Set(fullData.map(d => d.timestamp.toISOString().slice(0, 7))).size;
            if (uniqueMonths < 12) {
                setStatus(`Warning: Only ${uniqueMonths} full months of data found. Annual figures will be an extrapolation. Running simulation...`, 'warning');
            } else {
                setStatus('Data processed successfully. Running simulation...', 'loading');
            }
            await yieldToBrowser();

            setStatus('Running Self-Consumption simulation...', 'loading');
            await yieldToBrowser();
            const resultsSC = await runSimulation(fullData, { ...params, strategy: 'self-consumption' });
            setStatus('Running Export Maximiser simulation...', 'loading');
            await yieldToBrowser();
            const resultsEM = await runSimulation(fullData, { ...params, strategy: 'export-maximiser' });
            setStatus('Running Balanced Export Maximiser simulation...', 'loading');
            await yieldToBrowser();
            const resultsBEM = await runSimulation(fullData, { ...params, strategy: 'balanced-export-maximiser' });
            setStatus('Running Import Minimiser simulation...', 'loading');
            await yieldToBrowser();
            const resultsIM = await runSimulation(fullData, { ...params, strategy: 'import-minimiser' });
            setStatus('Running Historical Forecast simulation...', 'loading');
            await yieldToBrowser();
            const resultsHF = await runSimulation(fullData, { ...params, strategy: 'historical-forecast' });

            simulationResults = {
                selfConsumption: resultsSC,
                exportMaximiser: resultsEM,
                balancedExportMaximiser: resultsBEM,
                importMinimiser: resultsIM,
                historicalForecast: resultsHF
            };
            updateUIWithResults(hasForceChargeHours);
            setStatus('Running optimization analysis for different battery sizes...', 'loading');
            await yieldToBrowser();
            const optimizationData = await runOptimizationAnalysis(fullData, params);
            generateOptimizationChart(optimizationData, params.batteryCapacity);
            setStatus('Simulation and analysis complete! Results are shown below.', 'success');
        } catch (error) {
            console.error('Error during simulation process:', error);
            setStatus(`Error: ${error.message}`, 'error');
        } finally {
            isSimulating = false;
            document.getElementById('calculateBtn').disabled = false;
        }
    }
    
    function getSimulationParameters() {
        const batteryCapacity = parseFloat(document.getElementById('batterySize').value);
        const params = {
            batteryCapacity: batteryCapacity,
            usableCapacity: batteryCapacity * (parseFloat(document.getElementById('usableCapacity').value) / 100),
            minSoc: parseFloat(document.getElementById('minSoc').value),
            maxSoc: parseFloat(document.getElementById('maxSoc').value),
            maxChargeRate: parseFloat(document.getElementById('chargeRate').value),
            maxDischargeRate: parseFloat(document.getElementById('chargeRate').value),
            roundtripEfficiency: parseFloat(document.getElementById('roundtripEfficiency').value) / 100,
            systemCost: parseFloat(document.getElementById('systemCost').value),
            strategy: document.querySelector('input[name="strategy"]:checked').value,
            dataSource: document.querySelector('input[name="dataSource"]:checked').value,
            mic: parseFloat(document.getElementById('mic').value),
            mec: parseFloat(document.getElementById('mec').value),
            importPrices: [],
            exportPrices: [],
            forceChargeHours: [],
        };
        const importIsHourly = document.querySelector('input[name="importTariffType"]:checked').value === 'hourly';
        const exportIsHourly = document.querySelector('input[name="exportTariffType"]:checked').value === 'hourly';
        for (let i = 0; i < 24; i++) {
            params.importPrices[i] = importIsHourly ? parseFloat(document.getElementById(`import-rate-${i}`).value) : parseFloat(document.getElementById('importPrice').value);
            params.exportPrices[i] = exportIsHourly ? parseFloat(document.getElementById(`export-rate-${i}`).value) : parseFloat(document.getElementById('exportPrice').value);
            params.forceChargeHours[i] = document.getElementById(`import-force-charge-${i}`)?.checked || false;
        }
        return params;
    }

    function transformPvgisData(hourlyData) {
        const pvgisData = [];
        hourlyData.forEach(item => {
            const timeStr = item.time;
            const pvgisYear = parseInt(timeStr.substring(0, 4), 10);
            const month = parseInt(timeStr.substring(4, 6), 10) - 1;
            const day = parseInt(timeStr.substring(6, 8), 10);
            const hour = parseInt(timeStr.substring(9, 11), 10);
            const powerInWatts = item.P;
            const energyInKwh_30min = (powerInWatts * HOURS_PER_INTERVAL) / 1000;
            const firstIntervalTs = new Date(Date.UTC(pvgisYear, month, day, hour, 0, 0));
            const secondIntervalTs = new Date(Date.UTC(pvgisYear, month, day, hour, 30, 0));
            if (isNaN(firstIntervalTs.getTime())) return;
            pvgisData.push({ timestamp: firstIntervalTs, generation: energyInKwh_30min });
            pvgisData.push({ timestamp: secondIntervalTs, generation: energyInKwh_30min });
        });
        return pvgisData;
    }

    function mergePvgisData(consumptionData, generationData) {
        const getMonthDayTimeKey = (date) => {
            const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
            const day = date.getUTCDate().toString().padStart(2, '0');
            const hours = date.getUTCHours().toString().padStart(2, '0');
            const minutes = date.getUTCMinutes().toString().padStart(2, '0');
            return `${month}-${day}T${hours}:${minutes}`;
        };
        const genMap = new Map(generationData.map(d => [getMonthDayTimeKey(d.timestamp), d.generation]));
        return consumptionData.map(row => {
            const key = getMonthDayTimeKey(row.timestamp);
            let newGeneration = genMap.get(key) || 0;
            if (newGeneration === 0 && key.startsWith('02-29')) {
                const fallbackKey = key.replace('02-29', '02-28');
                newGeneration = genMap.get(fallbackKey) || 0;
            }
            return { ...row, generation: newGeneration };
        });
    }

    async function runSimulation(data, params) {
        const minSoC_kWh = params.usableCapacity * (params.minSoc / 100);
        const maxSoC_kWh = params.usableCapacity * (params.maxSoc / 100);
        let batterySoC = minSoC_kWh;
        const monthlyData = {};
        const detailedLog = [];
        const efficiencySqrt = Math.sqrt(params.roundtripEfficiency);
        if (params.strategy === 'historical-forecast') {
            const totalConsumption = data.reduce((sum, row) => sum + row.consumption, 0);
            const totalDays = data.length / INTERVALS_PER_DAY;
            params.averageDailyConsumption = totalDays > 0 ? totalConsumption / totalDays : 0;
        }
        let dailyMaxSoC = minSoC_kWh;
        let forceChargeScheduledToday = false;
        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const prevRow = i > 0 ? data[i - 1] : null;
            if (i > 0 && i % 1000 === 0) {
                setStatus(`Running ${params.strategy} simulation... (${Math.round((i / data.length) * 100)}%)`, 'loading');
                await yieldToBrowser();
            }
            const mKey = row.timestamp.toISOString().slice(0, 7);
            if (!monthlyData[mKey]) {
                monthlyData[mKey] = { costWithoutBattery: 0, costWithBattery: 0, exportRevenue: 0, savings: 0, importWithoutBattery: 0, importWithBattery: 0, exportWithBattery: 0, consumption: 0, generation: 0, chargedToBattery: 0, dischargedFromBattery: 0, missedFullCharges: 0 };
            }
            if (prevRow && row.timestamp.getUTCDate() !== prevRow.timestamp.getUTCDate()) {
                if (forceChargeScheduledToday && dailyMaxSoC < (maxSoC_kWh * 0.99)) {
                    const prevMKey = prevRow.timestamp.toISOString().slice(0, 7);
                    if (monthlyData[prevMKey]) monthlyData[prevMKey].missedFullCharges++;
                }
                dailyMaxSoC = batterySoC;
                forceChargeScheduledToday = false;
            }
            const result = runSingleTimeStep(row, batterySoC, params, minSoC_kWh, maxSoC_kWh, efficiencySqrt, forceChargeScheduledToday, data, i);
            batterySoC = result.newSoC;
            forceChargeScheduledToday = result.newForceChargeScheduledToday;
            const m = monthlyData[mKey];
            m.consumption += row.consumption;
            m.generation += row.generation;
            m.importWithBattery += result.gridImport;
            m.exportWithBattery += result.gridExport;
            m.chargedToBattery += result.toBattery;
            m.dischargedFromBattery += result.fromBattery;
            m.costWithBattery += result.gridImport * params.importPrices[row.timestamp.getUTCHours()];
            m.exportRevenue += result.gridExport * params.exportPrices[row.timestamp.getUTCHours()];
            const energyImportWithoutBattery = Math.max(0, row.consumption - row.generation);
            m.costWithoutBattery += energyImportWithoutBattery * params.importPrices[row.timestamp.getUTCHours()];
            m.importWithoutBattery += energyImportWithoutBattery;
            detailedLog.push({
                timestamp: row.timestamp,
                consumption: row.consumption,
                generation: row.generation,
                gridImport: result.gridImport,
                gridExport: result.gridExport,
                batteryCharge: result.toBattery,
                batteryDischarge: result.fromBattery,
                batterySoC: batterySoC
            });
            if (forceChargeScheduledToday) {
                dailyMaxSoC = Math.max(dailyMaxSoC, batterySoC);
            }
        }
        return aggregateFinalResults(monthlyData, detailedLog, data.length, params);
    }

    // --- FIX --- The logic here has been reverted to the original correct structure to prevent regression bugs.
    function runSingleTimeStep(row, currentSoC, params, minSoC_kWh, maxSoC_kWh, efficiencySqrt, forceChargeScheduledToday, data, currentIndex) {
        let { consumption: homeConsumption, generation: solarGeneration } = row;
        let batterySoC = currentSoC;
        let gridImport = 0, gridExport = 0, toBattery = 0, fromBattery = 0;

        const hour = row.timestamp.getUTCHours();
        const month = row.timestamp.getUTCMonth();
        const isHeatingSeason = [0, 1, 10, 11].includes(month);

        const availableEnergyInBattery = Math.max(0, batterySoC - minSoC_kWh);
        const spaceInBattery = Math.max(0, maxSoC_kWh - batterySoC);
        
        const isExportStrategy = params.strategy === 'export-maximiser' || params.strategy === 'balanced-export-maximiser';
        const isImportMinimiser = params.strategy === 'import-minimiser';
        const isHistoricalForecast = params.strategy === 'historical-forecast';
        
        // This variable determines if the current hour is marked for force charging from the grid.
        const isForceChargeHour = (isExportStrategy || isImportMinimiser || isHistoricalForecast) && params.forceChargeHours[hour];

        // This variable determines if we are in the hours LEADING UP TO a force charge window.
        let isPreChargeHour = false;
        if (isExportStrategy && !isForceChargeHour) {
            const nextHour = (hour + 1) % 24;
            const hourAfterNext = (hour + 2) % 24;
            const hourAfterNext2 = (hour + 3) % 24;
            const hourAfterNext3 = (hour + 4) % 24;
            isPreChargeHour = (
                params.forceChargeHours[nextHour] || 
                params.forceChargeHours[hourAfterNext] ||
                params.forceChargeHours[hourAfterNext2] ||
                params.forceChargeHours[hourAfterNext3]
            );
        }

        // 1. Direct Solar Self-Consumption
        let remainingDemand = homeConsumption;
        let excessSolar = solarGeneration;
        const selfConsumptionFromSolar = Math.min(remainingDemand, excessSolar);
        remainingDemand -= selfConsumptionFromSolar;
        excessSolar -= selfConsumptionFromSolar;

        // 2. Discharge from Battery to meet Home Demand (if not a force-charge hour)
        if (!isForceChargeHour) {
            const dischargeForHome = Math.min(remainingDemand, availableEnergyInBattery * efficiencySqrt, params.maxDischargeRate * HOURS_PER_INTERVAL);
            if (dischargeForHome > FLOAT_TOLERANCE) {
                const energyDrawnFromBattery = dischargeForHome / efficiencySqrt;
                batterySoC -= energyDrawnFromBattery;
                fromBattery += energyDrawnFromBattery;
                remainingDemand -= dischargeForHome;
            }
        }
        
        // 3. Import from Grid for remaining home demand
        gridImport += remainingDemand;

        // 4. Handle Excess Solar Generation
        if (excessSolar > 0) {
            if (isExportStrategy && isPreChargeHour) {
                gridExport += excessSolar;
            } else {
                const chargeFromSolar = Math.min(excessSolar, spaceInBattery / efficiencySqrt, params.maxChargeRate * HOURS_PER_INTERVAL);
                if (chargeFromSolar > FLOAT_TOLERANCE) {
                    batterySoC += chargeFromSolar * efficiencySqrt;
                    toBattery += chargeFromSolar;
                    gridExport += excessSolar - chargeFromSolar;
                } else {
                    gridExport += excessSolar;
                }
            }
        }

        // 5. Handle Force-Charge Strategy Logic
        const isAnyChargeStrategy = isExportStrategy || isImportMinimiser || isHistoricalForecast;
        if (isAnyChargeStrategy) {
            
            // 5a. Pre-emptive discharge (for export strategies ONLY, during pre-charge hours)
            if (isPreChargeHour && isExportStrategy) {
                const skipPreemptiveDischarge = (params.strategy === 'balanced-export-maximiser' && isHeatingSeason);
                if (!skipPreemptiveDischarge) {
                    const energyToDischarge = Math.min(availableEnergyInBattery * efficiencySqrt, params.maxDischargeRate * HOURS_PER_INTERVAL);
                    const currentExportPower = gridExport / HOURS_PER_INTERVAL;
                    const availableExportCapacity = params.mec - currentExportPower;
                    const finalDischarge = Math.min(energyToDischarge, availableExportCapacity * HOURS_PER_INTERVAL);
                    
                    if (finalDischarge > FLOAT_TOLERANCE) {
                        const energyDrawn = finalDischarge / efficiencySqrt;
                        batterySoC -= energyDrawn;
                        fromBattery += energyDrawn;
                        gridExport += finalDischarge;
                    }
                }
            }
            
            // 5b. Force Charge from Grid (during force-charge hours)
            if (isForceChargeHour) {
                let proceedWithForceCharge = true;
                
                // For the new strategy, check the forecast. This is the ONLY strategy that does this check.
                if (isHistoricalForecast) {
                    const tomorrowData = data.slice(currentIndex + 1, currentIndex + 1 + INTERVALS_PER_DAY);
                    if (tomorrowData.length === INTERVALS_PER_DAY) {
                        const predictedSolarForTomorrow = tomorrowData.reduce((sum, dayRow) => sum + dayRow.generation, 0);
                        const predictionThreshold = params.averageDailyConsumption * FORECAST_CONSUMPTION_THRESHOLD;
                        if (predictedSolarForTomorrow > predictionThreshold) {
                            proceedWithForceCharge = false;
                        }
                    }
                }
                
                // If the decision is to charge (always true for old strategies, conditional for new one)
                if (proceedWithForceCharge) {
                    forceChargeScheduledToday = true;
                    const homeImportPower = remainingDemand / HOURS_PER_INTERVAL;
                    const availableGridPowerForCharge = params.mic - homeImportPower;
                    const chargePower = Math.min(params.maxChargeRate, availableGridPowerForCharge);
                    let energyToCharge = Math.max(0, chargePower * HOURS_PER_INTERVAL);
                    energyToCharge = Math.min(energyToCharge, spaceInBattery / efficiencySqrt);
                    
                    if (energyToCharge > FLOAT_TOLERANCE) {
                        batterySoC += energyToCharge * efficiencySqrt;
                        toBattery += energyToCharge;
                        gridImport += energyToCharge;
                    }
                }
            }
        }
        // --- END FIX ---
        
        // 6. Final Clipping
        if (gridExport / HOURS_PER_INTERVAL > params.mec) {
            gridExport = params.mec * HOURS_PER_INTERVAL;
        }

        return {
            gridImport, gridExport, toBattery, fromBattery, 
            newSoC: batterySoC, 
            newForceChargeScheduledToday: forceChargeScheduledToday
        };
    }

    function aggregateFinalResults(monthlyData, detailedLog, dataLength, params) {
        let totalConsumption = 0, totalImportWithBattery = 0, totalExportWithBattery = 0,
            totalSavings = 0, totalBillBefore = 0, totalBillAfter = 0;
        Object.values(monthlyData).forEach(m => {
            m.savings = m.costWithoutBattery - (m.costWithBattery - m.exportRevenue);
            totalSavings += m.savings;
            totalBillBefore += m.costWithoutBattery;
            totalBillAfter += (m.costWithBattery - m.exportRevenue);
            totalConsumption += m.consumption;
            totalImportWithBattery += m.importWithBattery;
            totalExportWithBattery += m.exportWithBattery;
        });
        const daysInData = dataLength / INTERVALS_PER_DAY;
        const scalingFactor = daysInData > 0 ? DAYS_IN_YEAR / daysInData : 1;
        const annualSavings = totalSavings * scalingFactor;
        return {
            annualSavings: annualSavings,
            paybackPeriod: (params.systemCost > 0 && annualSavings > 0 ? params.systemCost / annualSavings : Infinity),
            selfSufficiency: totalConsumption > 0 ? (1 - (totalImportWithBattery / totalConsumption)) * 100 : 0,
            annualBillBefore: totalBillBefore * scalingFactor,
            annualBillAfter: totalBillAfter * scalingFactor,
            annualImportAfter: totalImportWithBattery * scalingFactor,
            annualExportAfter: totalExportWithBattery * scalingFactor,
            monthlyData,
            detailedLog: detailedLog
        };
    }

    async function runOptimizationAnalysis(data, baseParams) {
        const sizesToTest = [5, 10, 15, 20, 25, 30, 35, 40];
        if (!sizesToTest.includes(baseParams.batteryCapacity)) {
            sizesToTest.push(baseParams.batteryCapacity);
            sizesToTest.sort((a, b) => a - b);
        }
        const selfConsumptionResults = [];
        const exportMaximiserResults = [];
        const balancedExportMaximiserResults = [];
        const importMinimiserResults = [];
        const historicalForecastResults = [];
        for (const size of sizesToTest) {
            const commonParams = { ...baseParams };
            commonParams.batteryCapacity = size;
            commonParams.usableCapacity = size * (parseFloat(document.getElementById('usableCapacity').value) / 100);
            const resultSC = await runSimulation(data, { ...commonParams, strategy: 'self-consumption' });
            selfConsumptionResults.push({ size: size, savings: resultSC.annualSavings });
            const resultEM = await runSimulation(data, { ...commonParams, strategy: 'export-maximiser' });
            exportMaximiserResults.push({ size: size, savings: resultEM.annualSavings });
            const resultBEM = await runSimulation(data, { ...commonParams, strategy: 'balanced-export-maximiser' });
            balancedExportMaximiserResults.push({ size: size, savings: resultBEM.annualSavings });
            const resultIM = await runSimulation(data, { ...commonParams, strategy: 'import-minimiser' });
            importMinimiserResults.push({ size: size, savings: resultIM.annualSavings });
            const resultHF = await runSimulation(data, { ...commonParams, strategy: 'historical-forecast' });
            historicalForecastResults.push({ size: size, savings: resultHF.annualSavings });
        }
        return { selfConsumptionResults, exportMaximiserResults, balancedExportMaximiserResults, importMinimiserResults, historicalForecastResults, sizes: sizesToTest };
    }

    // --- UI RESULTS DISPLAY --- //
    function updateUIWithResults(hasForceChargeHours) {
        document.getElementById('welcomePanel').classList.add('hidden');
        document.getElementById('resultsPanel').classList.remove('hidden');
        document.getElementById('optimizationChartContainer').classList.remove('hidden');
        const warningEl = document.getElementById('comparisonWarning');
        if (warningEl) {
            if (!hasForceChargeHours) {
                warningEl.innerHTML = '<p class="font-bold">Note on "Export Maximiser" & Forecast Results</p><p>No force-charge hours were selected. The results for any strategy other than Self-Consumption may not be representative. To see an accurate comparison, select your cheap-rate hours and run the simulation again.</p>';
                warningEl.classList.remove('hidden');
            } else {
                warningEl.classList.add('hidden');
            }
        }
        const formatCurrency = (value) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(value);
        const formatKWh = (value) => `${value.toFixed(0)} kWh`;
        const formatYears = (value) => isFinite(value) ? `${value.toFixed(1)} years` : 'Never';
        const formatPercent = (value) => `${value.toFixed(1)}%`;
        const resultsSC = simulationResults.selfConsumption;
        const resultsEM = simulationResults.exportMaximiser;
        const resultsBEM = simulationResults.balancedExportMaximiser;
        const resultsIM = simulationResults.importMinimiser;
        const resultsHF = simulationResults.historicalForecast;
        const tableBody = document.getElementById('comparisonTableBody');
        const createRow = (metric, valueSC, valueEM, valueBEM, valueIM, valueHF, formatter) => {
            const isLowerBetter = metric.toLowerCase().includes('payback') || metric.toLowerCase().includes('bill') || metric.toLowerCase().includes('import');
            const values = [parseFloat(valueSC), parseFloat(valueEM), parseFloat(valueBEM), parseFloat(valueIM), parseFloat(valueHF)];
            const bestValue = isLowerBetter ? Math.min(...values) : Math.max(...values);
            const isBest = (val) => Math.abs(parseFloat(val) - bestValue) < FLOAT_TOLERANCE;
            const scClass = isBest(valueSC) ? 'text-green-600 font-bold' : '';
            const emClass = isBest(valueEM) ? 'text-green-600 font-bold' : '';
            const bemClass = isBest(valueBEM) ? 'text-green-600 font-bold' : '';
            const imClass = isBest(valueIM) ? 'text-green-600 font-bold' : '';
            const hfClass = isBest(valueHF) ? 'text-green-600 font-bold' : '';
            return `
                <tr class="text-center">
                    <td class="p-3 text-left font-medium text-gray-700">${metric}</td>
                    <td class="p-3 font-mono ${scClass}">${formatter(valueSC)}</td>
                    <td class="p-3 font-mono ${emClass}">${formatter(valueEM)}</td>
                    <td class="p-3 font-mono ${bemClass}">${formatter(valueBEM)}</td>
                    <td class="p-3 font-mono ${imClass}">${formatter(valueIM)}</td>
                    <td class="p-3 font-mono ${hfClass}">${formatter(valueHF)}</td>
                </tr>
            `;
        };
        tableBody.innerHTML = `
            ${createRow('Annual Savings', resultsSC.annualSavings, resultsEM.annualSavings, resultsBEM.annualSavings, resultsIM.annualSavings, resultsHF.annualSavings, formatCurrency)}
            ${createRow('Payback Period', resultsSC.paybackPeriod, resultsEM.paybackPeriod, resultsBEM.paybackPeriod, resultsIM.paybackPeriod, resultsHF.paybackPeriod, formatYears)}
            ${createRow('Self-Sufficiency', resultsSC.selfSufficiency, resultsEM.selfSufficiency, resultsBEM.selfSufficiency, resultsIM.selfSufficiency, resultsHF.selfSufficiency, formatPercent)}
            ${createRow('Annual Bill (After)', resultsSC.annualBillAfter, resultsEM.annualBillAfter, resultsBEM.annualBillAfter, resultsIM.annualBillAfter, resultsHF.annualBillAfter, formatCurrency)}
            ${createRow('Annual Import', resultsSC.annualImportAfter, resultsEM.annualImportAfter, resultsBEM.annualImportAfter, resultsIM.annualImportAfter, resultsHF.annualImportAfter, formatKWh)}
            ${createRow('Annual Export', resultsSC.annualExportAfter, resultsEM.annualExportAfter, resultsBEM.annualExportAfter, resultsIM.annualExportAfter, resultsHF.annualExportAfter, formatKWh)}
        `;
        generateBeforeSummary();
        generateMonthlyConsumptionChart();
        const monthSelector = document.getElementById('monthSelector');
        monthSelector.innerHTML = '';
        const monthKeys = Object.keys(resultsSC.monthlyData).sort();
        monthKeys.forEach(key => {
            const option = document.createElement('option');
            option.value = key;
            const [year, month] = key.split('-');
            option.textContent = new Date(year, month - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
            monthSelector.appendChild(option);
        });
        if (monthKeys.length > 0) {
            monthSelector.value = monthKeys[monthKeys.length - 1];
            updateDaySelector(monthSelector.value);
        }
    }

    function generateBeforeSummary() {
        let totalImport = 0, totalExport = 0, totalBill = 0;
        const params = getSimulationParameters();
        fullData.forEach(row => {
            const hour = row.timestamp.getUTCHours();
            const imp = Math.max(0, row.consumption - row.generation);
            const exp = Math.max(0, row.generation - row.consumption);
            totalImport += imp;
            totalExport += exp;
            totalBill += imp * params.importPrices[hour];
        });
        const daysInData = fullData.length / INTERVALS_PER_DAY;
        const scalingFactor = daysInData > 0 ? DAYS_IN_YEAR / daysInData : 1;
        const formatCurrency = (value) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(value);
        const formatKWhAnnual = (value) => `${(value * scalingFactor).toFixed(0)} kWh`;
        document.getElementById('beforeSummary').innerHTML = `
            <div class="result-card"><h3 class="result-title"><i data-lucide="log-in" class="mr-2 h-5 w-5"></i>Annual Import</h3><p class="result-value">${formatKWhAnnual(totalImport)}</p></div>
            <div class="result-card"><h3 class="result-title"><i data-lucide="log-out" class="mr-2 h-5 w-5"></i>Annual Export</h3><p class="result-value">${formatKWhAnnual(totalExport)}</p></div>
            <div class="result-card"><h3 class="result-title"><i data-lucide="receipt" class="mr-2 h-5 w-5"></i>Est. Annual Bill</h3><p class="result-value">${formatCurrency(totalBill * scalingFactor)}</p></div>
        `;
        lucide.createIcons();
    }
    
    function updateDaySelector(monthKey) {
        if (!simulationResults.selfConsumption) return;
        const daySelector = document.getElementById('daySelector');
        daySelector.innerHTML = '';
        const selectedStrategy = document.querySelector('input[name="strategy"]:checked')?.value || 'self-consumption';
        let detailedLogForStrategy;
        switch (selectedStrategy) {
            case 'export-maximiser': detailedLogForStrategy = simulationResults.exportMaximiser.detailedLog; break;
            case 'balanced-export-maximiser': detailedLogForStrategy = simulationResults.balancedExportMaximiser.detailedLog; break;
            case 'import-minimiser': detailedLogForStrategy = simulationResults.importMinimiser.detailedLog; break;
            case 'historical-forecast': detailedLogForStrategy = simulationResults.historicalForecast.detailedLog; break;
            default: detailedLogForStrategy = simulationResults.selfConsumption.detailedLog;
        }
        const daysInMonth = detailedLogForStrategy
            .filter(log => log.timestamp.toISOString().startsWith(monthKey))
            .map(log => log.timestamp.toISOString().slice(0, 10));
        const uniqueDays = [...new Set(daysInMonth)].sort();
        uniqueDays.forEach(dayStr => {
            const option = document.createElement('option');
            option.value = dayStr;
            option.textContent = new Date(dayStr + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
            daySelector.appendChild(option);
        });
        updateMonthlySummary(monthKey);
        if (uniqueDays.length > 0) {
            daySelector.value = uniqueDays[0];
            updateDailyView(uniqueDays[0]);
        }
    }
    
    function updateMonthlySummary(monthKey) {
        if (!simulationResults.selfConsumption) return;
        const selectedStrategy = document.querySelector('input[name="strategy"]:checked')?.value || 'self-consumption';
        let resultsForStrategy;
        switch (selectedStrategy) {
            case 'export-maximiser': resultsForStrategy = simulationResults.exportMaximiser; break;
            case 'balanced-export-maximiser': resultsForStrategy = simulationResults.balancedExportMaximiser; break;
            case 'import-minimiser': resultsForStrategy = simulationResults.importMinimiser; break;
            case 'historical-forecast': resultsForStrategy = simulationResults.historicalForecast; break;
            default: resultsForStrategy = simulationResults.selfConsumption;
        }
        const monthSummary = resultsForStrategy.monthlyData[monthKey];
        if (!monthSummary) return;
        const [year, month] = monthKey.split('-');
        const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
        document.getElementById('summaryMonth').textContent = monthName;
        const formatCurrency = (value) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(value);
        const formatKWh = (value) => `${value.toFixed(1)} kWh`;
        let summaryHTML = `
            <li class="flex justify-between"><span>Monthly Savings:</span><span class="font-mono font-bold">${formatCurrency(monthSummary.savings)}</span></li>
            <li class="border-t border-gray-200 my-2"></li>
            <li class="flex justify-between"><span>Total Consumption:</span><span class="font-mono">${formatKWh(monthSummary.consumption)}</span></li>
            <li class="flex justify-between"><span>Total Generation:</span><span class="font-mono">${formatKWh(monthSummary.generation)}</span></li>
            <li class="border-t border-gray-200 my-2"></li>
            <li class="flex justify-between"><span>Import w/o Battery:</span><span class="font-mono">${formatKWh(monthSummary.importWithoutBattery || 0)}</span></li>
            <li class="flex justify-between"><span>Import w/ Battery:</span><span class="font-mono">${formatKWh(monthSummary.importWithBattery)}</span></li>
            <li class="flex justify-between"><span>Export w/ Battery:</span><span class="font-mono">${formatKWh(monthSummary.exportWithBattery)}</span></li>
            <li class="border-t border-gray-200 my-2"></li>
            <li class="flex justify-between"><span>Charged to Battery:</span><span class="font-mono">${formatKWh(monthSummary.chargedToBattery)}</span></li>
            <li class="flex justify-between"><span>Discharged from Battery:</span><span class="font-mono">${formatKWh(monthSummary.dischargedFromBattery)}</span></li>
        `;
        if ((['export-maximiser', 'balanced-export-maximiser', 'import-minimiser', 'historical-forecast'].includes(selectedStrategy)) && monthSummary.missedFullCharges > 0) {
            summaryHTML += `<li class="border-t border-gray-200 my-2"></li><li class="flex justify-between text-yellow-500" title="The battery did not reach its target SoC on these days during the Force Charge window, likely due to grid import (MIC) or charge rate limits."><span>Missed Full Charges:</span><span class="font-mono font-bold">${monthSummary.missedFullCharges} days</span></li>`;
        }
        document.getElementById('monthlySummaryList').innerHTML = summaryHTML;
    }

    function updateDailyView(dayStr) {
        if (!dayStr || !simulationResults.selfConsumption) return;
        const params = getSimulationParameters();
        const selectedStrategy = document.querySelector('input[name="strategy"]:checked')?.value || 'self-consumption';
        const strategyDisplayEl = document.getElementById('dailyAnalysisStrategy');
        if (strategyDisplayEl) {
            let formattedName = 'Self-Consumption';
            switch (selectedStrategy) {
                case 'export-maximiser': formattedName = 'Export Maximiser'; break;
                case 'balanced-export-maximiser': formattedName = 'Balanced Export Maximiser'; break;
                case 'import-minimiser': formattedName = 'Import Minimiser'; break;
                case 'historical-forecast': formattedName = 'Historical Forecast'; break;
            }
            strategyDisplayEl.textContent = `(${formattedName})`;
        }
        let detailedLogForStrategy;
        switch (selectedStrategy) {
            case 'export-maximiser': detailedLogForStrategy = simulationResults.exportMaximiser.detailedLog; break;
            case 'balanced-export-maximiser': detailedLogForStrategy = simulationResults.balancedExportMaximiser.detailedLog; break;
            case 'import-minimiser': detailedLogForStrategy = simulationResults.importMinimiser.detailedLog; break;
            case 'historical-forecast': detailedLogForStrategy = simulationResults.historicalForecast.detailedLog; break;
            default: detailedLogForStrategy = simulationResults.selfConsumption.detailedLog;
        }
        const dayData = detailedLogForStrategy.filter(log => log.timestamp.toISOString().startsWith(dayStr));
        if (dayData.length === 0) return;
        document.getElementById('chartDate').textContent = new Date(dayStr + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const chartSeries = {
            labels: dayData.map(d => d.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
            baseNetKw: dayData.map(d => (d.consumption - d.generation) / HOURS_PER_INTERVAL),
            newNetFlowKw: dayData.map(d => (d.gridImport - d.gridExport) / HOURS_PER_INTERVAL),
            batterySoC: dayData.map(d => (d.batterySoC / params.usableCapacity) * 100)
        };
        if (energyChartInstance) energyChartInstance.destroy();
        if (socChartInstance) socChartInstance.destroy();
        const energyCtx = document.getElementById('energyChart').getContext('2d');
        energyChartInstance = new Chart(energyCtx, getEnergyChartConfig(chartSeries));
        const socCtx = document.getElementById('socChart').getContext('2d');
        socChartInstance = new Chart(socCtx, getSoCChartConfig(chartSeries));
        const daySelector = document.getElementById('daySelector');
        document.getElementById('prevDayBtn').disabled = daySelector.selectedIndex === 0;
        document.getElementById('nextDayBtn').disabled = daySelector.selectedIndex === daySelector.options.length - 1;
    }

    // --- CHARTING --- //
    function generateOptimizationChart(optimizationData, userSelectedSize) {
        if (optimizationChartInstance) optimizationChartInstance.destroy();
        const ctx = document.getElementById('optimizationChart').getContext('2d');
        const { selfConsumptionResults, exportMaximiserResults, balancedExportMaximiserResults, importMinimiserResults, historicalForecastResults, sizes } = optimizationData;
        const pointRadii = sizes.map(size => size === userSelectedSize ? 6 : 3);
        const chartOptions = getBaseChartOptions('Annual Savings (€)', true);
        chartOptions.scales.x.title = { display: true, text: 'Battery Size (kWh)', color: '#4b5563' };
        optimizationChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: sizes,
                datasets: [
                    { label: 'Self-Consumption', data: selfConsumptionResults.map(d => d.savings), borderColor: 'rgba(139, 92, 246, 1)', backgroundColor: 'rgba(139, 92, 246, 1)', pointRadius: pointRadii, pointHoverRadius: 8, fill: false, tension: 0.1 },
                    { label: 'Export Maximiser', data: exportMaximiserResults.map(d => d.savings), borderColor: 'rgba(239, 68, 68, 1)', backgroundColor: 'rgba(239, 68, 68, 1)', pointRadius: pointRadii, pointHoverRadius: 8, fill: false, tension: 0.1 },
                    { label: 'Balanced Export Maximiser', data: balancedExportMaximiserResults.map(d => d.savings), borderColor: 'rgba(5, 150, 105, 1)', backgroundColor: 'rgba(5, 150, 105, 1)', pointRadius: pointRadii, pointHoverRadius: 8, fill: false, tension: 0.1 },
                    { label: 'Import Minimiser', data: importMinimiserResults.map(d => d.savings), borderColor: 'rgba(59, 130, 246, 1)', backgroundColor: 'rgba(59, 130, 246, 1)', pointRadius: pointRadii, pointHoverRadius: 8, fill: false, tension: 0.1 },
                    { label: 'Historical Forecast', data: historicalForecastResults.map(d => d.savings), borderColor: 'rgba(249, 115, 22, 1)', backgroundColor: 'rgba(249, 115, 22, 1)', pointRadius: pointRadii, pointHoverRadius: 8, fill: false, tension: 0.1 }
                ]
            },
            options: chartOptions
        });
    }

    function generateMonthlyConsumptionChart() {
        if (monthlyConsumptionChartInstance) monthlyConsumptionChartInstance.destroy();
        const ctx = document.getElementById('monthlyConsumptionChart').getContext('2d');
        const sortedKeys = Object.keys(simulationResults.selfConsumption.monthlyData).sort();
        const monthLabels = sortedKeys.map(key => {
            const [year, month] = key.split('-');
            return new Date(year, month - 1).toLocaleString('default', { month: 'short' });
        });
        const monthData = sortedKeys.map(key => simulationResults.selfConsumption.monthlyData[key].consumption);
        monthlyConsumptionChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: monthLabels,
                datasets: [{
                    label: 'Total Consumption (kWh)',
                    data: monthData,
                    backgroundColor: 'rgba(79, 70, 229, 0.6)',
                    borderColor: 'rgba(79, 70, 229, 1)',
                    borderWidth: 1
                }]
            },
            options: getBaseChartOptions('Monthly Consumption (kWh)', false)
        });
    }
    
    function generatePvgisMonthlyChart(monthlyData) {
        if (pvgisMonthlyChartInstance) pvgisMonthlyChartInstance.destroy();
        const ctx = document.getElementById('pvgisMonthlyChart').getContext('2d');
        const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const chartOptions = getBaseChartOptions('PV Generation (kWh)', false);
        chartOptions.scales.y.beginAtZero = true;
        pvgisMonthlyChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: monthLabels,
                datasets: [{
                    label: 'Monthly Generation (kWh)',
                    data: monthlyData,
                    backgroundColor: 'rgba(245, 158, 11, 0.6)',
                    borderColor: 'rgba(245, 158, 11, 1)',
                    borderWidth: 1
                }]
            },
            options: chartOptions
        });
    }

    function getEnergyChartConfig(chartData) {
        const minPower = Math.min(...chartData.newNetFlowKw, ...chartData.baseNetKw);
        const yMin = Math.min(-2, Math.floor(minPower));
        const config = {
            type: 'line',
            data: {
                labels: chartData.labels,
                datasets: [
                    { label: 'Grid Flow with Battery (kW)', data: chartData.newNetFlowKw, borderColor: '#ef4444', borderWidth: 2, pointRadius: 0, fill: false, tension: 0.4 },
                    { label: 'Grid Flow without Battery (kW)', data: chartData.baseNetKw, borderColor: '#8b5cf6', borderWidth: 2, borderDash: [5, 5], pointRadius: 0, fill: false, tension: 0.4 }
                ]
            },
            options: getBaseChartOptions('Power (kW)', true)
        };
        config.options.scales.y.min = yMin;
        config.options.scales.x.ticks = { display: false };
        config.options.plugins.legend.position = 'bottom';
        config.options.scales.y.grid = {
            color: (context) => (context.tick.value === 0) ? '#22c55e' : 'rgba(0, 0, 0, 0.1)',
            lineWidth: (context) => (context.tick.value === 0) ? 2 : 1
        };
        return config;
    }
    
    function getSoCChartConfig(chartData) {
        const config = {
            type: 'bar',
            data: {
                labels: chartData.labels,
                datasets: [{
                    label: 'Battery SoC (%)',
                    data: chartData.batterySoC,
                    backgroundColor: '#3b82f6',
                }]
            },
            options: getBaseChartOptions('Battery SoC (%)', false)
        };
        config.options.scales.y.min = 0;
        config.options.scales.y.max = 100;
        config.options.scales.y.ticks.callback = value => value + '%';
        config.options.scales.x.ticks = { color: '#4b5563', maxRotation: 0, autoSkip: true, maxTicksLimit: 12 };
        config.options.scales.x.grid = { drawOnChartArea: false };
        config.options.scales.x.barPercentage = 1.0;
        config.options.scales.x.categoryPercentage = 1.0;
        config.options.plugins.tooltip.callbacks = { label: (context) => `SoC: ${context.parsed.y.toFixed(1)}%` };
        return config;
    }

    function getBaseChartOptions(yAxisTitle, showLegend = true) {
        const gridColor = 'rgba(0, 0, 0, 0.1)';
        const labelColor = '#4b5563';
        return {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: showLegend, labels: { color: labelColor } },
                tooltip: { mode: 'index', intersect: false, backgroundColor: 'rgba(0, 0, 0, 0.8)' }
            },
            scales: {
                y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: labelColor }, title: { display: true, text: yAxisTitle, color: labelColor } },
                x: { grid: { color: gridColor }, ticks: { color: labelColor } }
            },
            interaction: { mode: 'index', intersect: false }
        };
    }

    // --- UTILITIES --- //
    function exportResultsToCSV() {
        const selectedStrategy = document.querySelector('input[name="strategy"]:checked')?.value || 'self-consumption';
        let detailedLog;
        switch (selectedStrategy) {
            case 'export-maximiser': detailedLog = simulationResults.exportMaximiser?.detailedLog; break;
            case 'balanced-export-maximiser': detailedLog = simulationResults.balancedExportMaximiser?.detailedLog; break;
            case 'import-minimiser': detailedLog = simulationResults.importMinimiser?.detailedLog; break;
            case 'historical-forecast': detailedLog = simulationResults.historicalForecast?.detailedLog; break;
            default: detailedLog = simulationResults.selfConsumption?.detailedLog;
        }
        if (!detailedLog || detailedLog.length === 0) {
            setStatus("No simulation data to export. Please run a simulation first.", "warning");
            return;
        }
        const headers = ["Timestamp (UTC)", "Consumption (kWh)", "Generation (kWh)", "Grid Import (kWh)", "Grid Export (kWh)", "Battery Charge (kWh)", "Battery Discharge (kWh)", "Battery SoC (kWh)"];
        const pad = (num) => num.toString().padStart(2, '0');
        const rows = detailedLog.map(log => {
            const ts = log.timestamp;
            const dateStr = `${ts.getUTCFullYear()}-${pad(ts.getUTCMonth() + 1)}-${pad(ts.getUTCDate())} ${pad(ts.getUTCHours())}:${pad(ts.getUTCMinutes())}:${pad(ts.getUTCMinutes() || '00')}`;
            return [
                dateStr,
                log.consumption.toFixed(4),
                log.generation.toFixed(4),
                log.gridImport.toFixed(4),
                log.gridExport.toFixed(4),
                log.batteryCharge.toFixed(4),
                log.batteryDischarge.toFixed(4),
                log.batterySoC.toFixed(4)
            ].join(',');
        });
        const csvContent = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.setAttribute("href", URL.createObjectURL(blob));
        const fileName = `battery_sim_${selectedStrategy}.csv`;
        link.setAttribute("download", fileName);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setStatus(`Exported ${fileName}`, 'success');
    }

    function formatDateForHDF(date) {
        const pad = (num) => num.toString().padStart(2, '0');
        const day = pad(date.getUTCDate());
        const month = pad(date.getUTCMonth() + 1);
        const year = date.getUTCFullYear();
        const hours = pad(date.getUTCHours());
        const minutes = pad(date.getUTCMinutes());
        return `${day}-${month}-${year} ${hours}:${minutes}`;
    }

    function exportSimulatedHDF(strategy) {
        if (!strategy || !simulationResults[strategy]) {
            setStatus(`No simulation data found for strategy: ${strategy}. Please run a simulation first.`, "warning");
            return;
        }
        const detailedLog = simulationResults[strategy].detailedLog;
        if (!detailedLog || detailedLog.length === 0) {
            setStatus(`No detailed log data found for strategy: ${strategy}.`, "warning");
            return;
        }
        const headers = "MPRN,Meter Serial Number,Read Value,Read Type,Read Date and End Time";
        const rows = [];
        detailedLog.forEach(log => {
            const intervalEndTime = new Date(log.timestamp.getTime() + THIRTY_MINUTES_MS);
            const formattedTimestamp = formatDateForHDF(intervalEndTime);
            const importRow = [ GENERIC_MPRN, GENERIC_METER_ID, log.gridImport.toFixed(4), "Active Import Interval (kWh)", formattedTimestamp ].join(',');
            const exportRow = [ GENERIC_MPRN, GENERIC_METER_ID, log.gridExport.toFixed(4), "Active Export Interval (kWh)", formattedTimestamp ].join(',');
            rows.push(importRow);
            rows.push(exportRow);
        });
        const csvContent = [headers, ...rows].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.setAttribute("href", URL.createObjectURL(blob));
        const fileName = `simulated_hdf_${strategy}.csv`;
        link.setAttribute("download", fileName);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setStatus(`Exported ${fileName}`, 'success');
    }

    // --- START THE APP --- //
    initialize();

});

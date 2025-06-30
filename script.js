/**
 * @file This script handles the logic for a solar battery storage simulation application.
 * It allows users to upload their energy consumption data (HDF format),
 * configure battery and financial parameters, and run a simulation to see
 * the potential savings and performance of a battery system.
 *
 * @author Your Name/Team
 * @version 2.0.0
 */

document.addEventListener('DOMContentLoaded', () => {

    // --- CONSTANTS --- //
    const HOURS_PER_INTERVAL = 0.5; // The duration of each data interval in hours (e.g., 30 minutes).
    const INTERVALS_PER_DAY = 24 / HOURS_PER_INTERVAL;
    const DAYS_IN_YEAR = 365;
    const FLOAT_TOLERANCE = 0.001; // A small value to avoid floating-point inaccuracies in comparisons.

    // --- APPLICATION STATE --- //
    let fullData = []; // Holds the filtered 12-month dataset from the user's file.
    let simulationResults = {}; // Stores results. Will hold keys for each strategy.
    let isSimulating = false; // Flag to prevent multiple simulations from running at once.

    // Chart.js instances. Stored globally to be destroyed and recreated on updates.
    let energyChartInstance = null;
    let socChartInstance = null;
    let monthlyConsumptionChartInstance = null;
    let optimizationChartInstance = null;
    let pvgisMonthlyChartInstance = null;
    let pvgisUnscaledData = null; // Cache for the originally uploaded PVGIS data.

    // --- INITIALIZATION --- //

    /**
     * Main initialization function that sets up the application.
     */
    function initialize() {
        setupUI();
        setupEventListeners();
        updateFinancialsUI(); // Initial call to set the correct UI state based on default values.

        // Trigger change events to ensure the UI reflects the default checked radio buttons.
        document.getElementById('importTariffHourly').dispatchEvent(new Event('change'));
        document.getElementById('exportTariffFlat').dispatchEvent(new Event('change'));
    }

    /**
     * Sets up the initial UI elements, like the dynamic tariff tables.
     */
    function setupUI() {
        createHourlyRateInputs();
        lucide.createIcons(); // Initialize Lucide icons used in the HTML.
    }

    /**
     * Binds all necessary event listeners to the DOM elements.
     */
    function setupEventListeners() {
        document.getElementById('calculateBtn').addEventListener('click', runFullSimulation);
        document.getElementById('exportBtn').addEventListener('click', exportResultsToCSV);

        // Daily view navigation
        document.getElementById('monthSelector').addEventListener('change', e => updateDaySelector(e.target.value));
        document.getElementById('daySelector').addEventListener('change', e => updateDailyView(e.target.value));
        document.getElementById('prevDayBtn').addEventListener('click', () => navigateDay(-1));
        document.getElementById('nextDayBtn').addEventListener('click', () => navigateDay(1));

        // Strategy radio buttons
        document.querySelectorAll('input[name="strategy"]').forEach(radio => {
            radio.addEventListener('change', handleStrategyChange);
        });

        // Data source radio buttons
        document.querySelectorAll('input[name="dataSource"]').forEach(radio => {
            radio.addEventListener('change', handleDataSourceChange);
        });

        // Safeguard: Only add listeners for PVGIS elements if they exist in the DOM.
        // This prevents errors if the script loads before the HTML is fully parsed.
        const pvgisFileEl = document.getElementById('pvgisFile');
        if (pvgisFileEl) {
            pvgisFileEl.addEventListener('change', handlePvgisFileChange);
        }
        const pvgisScalingFactorEl = document.getElementById('pvgisScalingFactor');
        if (pvgisScalingFactorEl) {
            pvgisScalingFactorEl.addEventListener('input', updatePvgisDisplay);
        }

        // Tariff type radio buttons (Flat vs Hourly)
        document.querySelectorAll('input[name="importTariffType"], input[name="exportTariffType"]').forEach(radio => {
            radio.addEventListener('change', handleTariffTypeChange);
        });

        // Tooltip handling
        document.querySelectorAll('[data-tooltip-target]').forEach(button => {
            button.addEventListener('click', handleTooltipToggle);
        });

        // Global click listener to hide tooltips when clicking away
        document.addEventListener('click', () => {
             document.querySelectorAll('.tooltip').forEach(tooltip => tooltip.classList.add('hidden'));
        });
    }


    // --- UI & EVENT HANDLERS --- //

    /**
     * Dynamically generates the HTML tables for hourly import/export rate inputs.
     */
    function createHourlyRateInputs() {
        const createTable = (type, defaultValue) => {
            let tableHTML = `<table class="tariff-table"><thead><tr>
                <th class="border-r border-gray-200">Time</th>
                <th class="text-center">Rate (€/kWh)</th>
                <th class="force-control-col hidden text-center" title="Force Charge Period"><i data-lucide="zap" class="h-4 w-4 inline-block"></i></th>
            </tr></thead><tbody>`;

            for (let i = 0; i < 24; i++) {
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
        document.getElementById('hourlyImportGrid').innerHTML = createTable('import', '0.35');
        document.getElementById('hourlyExportGrid').innerHTML = createTable('export', '0.15');
    }
    
    /**
     * Updates the visibility of UI elements based on the selected strategy.
     * Manages the "Force Charge" column and related warnings.
     */
    function updateFinancialsUI() {
        const strategy = document.querySelector('input[name="strategy"]:checked')?.value || 'self-consumption';
        const isExportMaximiser = strategy === 'export-maximiser';

        // Toggle visibility of the "Force Charge" column in tariff tables
        document.querySelectorAll('.force-control-col').forEach(c => c.classList.toggle('hidden', !isExportMaximiser));
        
        // Show or hide the warning message for the Export Maximiser strategy
        document.getElementById('force-charge-warning').classList.toggle('hidden', !isExportMaximiser);
        
        // For 'Export Maximiser', force the import tariff to be 'Hourly'
        if (isExportMaximiser) {
            const importHourlyRadio = document.getElementById('importTariffHourly');
            if (!importHourlyRadio.checked) {
                importHourlyRadio.checked = true;
                importHourlyRadio.dispatchEvent(new Event('change')); // Trigger event to update UI
            }
        }

        // Show the description for the currently selected strategy
        document.querySelectorAll('.strategy-description').forEach(el => el.classList.add('hidden'));
        const descEl = document.getElementById(`desc-${strategy}`);
        if (descEl) {
            descEl.classList.remove('hidden');
        }
    }

    /**
     * Handles the strategy change event, updating the UI and refreshing the daily view if applicable.
     */
    function handleStrategyChange() {
        updateFinancialsUI();

        if (simulationResults.selfConsumption) {
            const monthSelector = document.getElementById('monthSelector');
            // Re-trigger the day selector update to refresh all daily charts and summaries
            if (monthSelector.value)
                updateDaySelector(monthSelector.value);
        }
    }

    /**
     * Handles showing or hiding the PVGIS simulation options based on user selection.
     * @param {Event} e - The change event object.
     */
    function handleDataSourceChange(e) {
        const pvgisOptions = document.getElementById('pvgis-options');
        if (e.target.value === 'pvgis') {
            pvgisOptions.classList.remove('hidden');
        } else {
            pvgisOptions.classList.add('hidden');
        }
    }

    /**
     * Handles the PVGIS file input change event to parse the file and display a summary.
     * @param {Event} e The file input change event.
     */
    async function handlePvgisFileChange(e) {
        const file = e.target.files[0];
        const summaryContainer = document.getElementById('pvgis-summary');
        const summaryMetricsEl = document.getElementById('pvgis-summary-metrics');

        // Safeguard: If the necessary UI elements don't exist, we can't proceed.
        if (!summaryContainer || !summaryMetricsEl) {
            console.error("PVGIS summary UI elements are missing from the DOM.");
            return;
        }

        pvgisUnscaledData = null; // Clear cache on new file selection

        if (!file) {
            summaryContainer.classList.add('hidden');
            return;
        }

        // Clear previous summary and show loading state
        document.getElementById('pvgisScalingFactor').value = 1; // Reset scaler to 1

        summaryMetricsEl.innerHTML = '<p>Parsing file...</p>';
        summaryContainer.classList.remove('hidden');
        if (pvgisMonthlyChartInstance) pvgisMonthlyChartInstance.destroy();

        try {
            const csvText = await file.text();
            pvgisUnscaledData = parsePvgisCsv(csvText);
            if (pvgisUnscaledData.data.length === 0) throw new Error("No data found in PVGIS file.");

            updatePvgisDisplay(); // Perform the initial display

        } catch (error) {
            console.error("Error parsing PVGIS file:", error);
            summaryMetricsEl.innerHTML = `<p class="text-red-500 font-semibold">Error: ${error.message}</p>`;
            if (pvgisMonthlyChartInstance) pvgisMonthlyChartInstance.destroy();
        }
    }

    /**
     * Updates the PVGIS summary display based on the cached data and the current scaling factor.
     */
    function updatePvgisDisplay() {
        if (!pvgisUnscaledData) return;

        const summaryMetricsEl = document.getElementById('pvgis-summary-metrics');
        const scalingFactor = parseFloat(document.getElementById('pvgisScalingFactor').value) || 1;

        // Create a scaled copy of the data for the summary
        const scaledData = pvgisUnscaledData.data.map(d => ({ ...d, P: d.P * scalingFactor }));
        const metadata = pvgisUnscaledData.metadata;

        const summary = calculatePvgisSummary(scaledData);

        // Populate metrics
        let specifiedPowerHtml = '';
        if (metadata.specifiedPeakPower) {
            // The specified power from the file is NOT scaled, which is useful for comparison.
            specifiedPowerHtml = `<p><strong>Specified System Size (in file):</strong> ${metadata.specifiedPeakPower.toFixed(2)} kWp</p>`;
        }
        let yearInfoHtml = '';
        if (summary.isMultiYear) {
            yearInfoHtml = `<p class="text-indigo-600"><strong>Data Year Displayed:</strong> ${summary.yearUsed} (latest from multi-year file)</p>`;
        }

        summaryMetricsEl.innerHTML = `
            ${specifiedPowerHtml}
            <p><strong>Peak Power Output (Scaled):</strong> ${summary.peakPower.toFixed(2)} kW</p>
            <p><strong>Total Annual Generation (Scaled):</strong> ${summary.totalAnnualGeneration.toFixed(0)} kWh</p>
            ${yearInfoHtml}
        `;

        // Generate chart
        generatePvgisMonthlyChart(summary.monthlyGeneration);
        lucide.createIcons(); // Re-render any icons if needed
    }
    /**
     * Handles the change event for tariff type radio buttons (flat vs. hourly).
     * @param {Event} e - The change event object.
     */
    function handleTariffTypeChange(e) {
        const type = e.target.name.includes('import') ? 'import' : 'export';
        const isHourly = e.target.value === 'hourly';
        document.getElementById(`${type}FlatRateSection`).classList.toggle('hidden', isHourly);
        document.getElementById(`${type}HourlyRateSection`).classList.toggle('hidden', !isHourly);
    }
    /**
     * Handles the click event to show/hide tooltips.
     * @param {Event} e - The click event object.
     */
    function handleTooltipToggle(e) {
        e.stopPropagation(); // Prevent the global click listener from immediately hiding the tooltip.
        const tooltipId = e.currentTarget.getAttribute('data-tooltip-target');
        const tooltip = document.getElementById(tooltipId);
        
        if (tooltip) {
            // Hide all other tooltips before showing the current one
            document.querySelectorAll('.tooltip').forEach(t => {
                if (t.id !== tooltipId) {
                    t.classList.add('hidden');
                }
            });
            tooltip.classList.toggle('hidden');
        }
    }

    /**
     * Navigates to the previous or next day in the daily view.
     * @param {number} direction - The direction to navigate (-1 for previous, 1 for next).
     */
    function navigateDay(direction) {
        const daySelector = document.getElementById('daySelector');
        const newIndex = daySelector.selectedIndex + direction;
        if (newIndex >= 0 && newIndex < daySelector.options.length) {
            daySelector.selectedIndex = newIndex;
            daySelector.dispatchEvent(new Event('change'));
        }
    }
    
    /**
     * Sets a message in the status bar UI element.
     * @param {string} message - The text to display.
     * @param {'info'|'loading'|'success'|'warning'|'error'} type - The type of message, for styling.
     */
    function setStatus(message, type = 'info') {
        const statusEl = document.getElementById('status');
        statusEl.textContent = message;
        // Reset classes and apply new ones based on type
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

    /**
     * Parses the text content of an HDF (Half-hourly Data File) CSV.
     * @param {string} csvText - The raw text from the CSV file.
     * @returns {Array<Object>} An array of parsed data objects, sorted by timestamp.
     */
    function parseHDF(csvText) {
        const lines = csvText.trim().split('\n');
        let headerIndex = -1;
        let header;

        // Find the header row which contains specific key column names.
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

        // Use a map to aggregate consumption and generation data into 30-minute buckets.
        const dataMap = new Map();
        for (let i = headerIndex + 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;

            const values = lines[i].split(',');
            if (values.length <= Math.max(dateIndex, typeIndex, valueIndex)) continue;
            
            const dateStr = values[dateIndex]?.trim().replace(/"/g, '');
            // Regex to handle DD/MM/YYYY HH:MM or DD-MM-YYYY HH:MM formats.
            const dateParts = dateStr?.match(/(\d{2})[\/-](\d{2})[\/-](\d{4})\s(\d{2}):(\d{2})/);
            if (!dateParts) continue;

            const [, day, month, year, hour, minute] = dateParts;
            const originalTimestamp = new Date(`${year}-${month}-${day}T${hour}:${minute}:00Z`);
            if (isNaN(originalTimestamp.getTime())) continue;

            // Normalize the timestamp to the start of its 30-minute interval.
            const halfHourBucketTimestamp = new Date(originalTimestamp);
            halfHourBucketTimestamp.setUTCMinutes(Math.floor(originalTimestamp.getUTCMinutes() / 30) * 30, 0, 0);

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
        
        // Convert map to array and sort by timestamp.
        return Array.from(dataMap.values()).sort((a, b) => a.timestamp - b.timestamp);
    }
    
    /**
     * Parses the text content of a PVGIS hourly data CSV.
     * @param {string} csvText - The raw text from the PVGIS CSV file.
     * @returns {Object} An object containing the data array and metadata.
     */
    function parsePvgisCsv(csvText) {
        const lines = csvText.trim().split('\n');
        let dataStartIndex = -1;
        let headers = [];
        const metadata = {
            specifiedPeakPower: null
        };

        // Find metadata and the start of the data.
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Look for metadata line like: # lat=..., lon=..., peakpower=10, ...
            if (line.startsWith('#') && line.includes('peakpower=')) {
                const match = line.match(/peakpower=([0-9.]+)/);
                if (match && match[1]) {
                    metadata.specifiedPeakPower = parseFloat(match[1]);
                }
            }

            if (line.toLowerCase().startsWith('time,p,')) {
                dataStartIndex = i + 1;
                headers = line.split(',').map(h => h.trim());
                break; // Stop searching once we find the data header
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

    /**
     * Calculates summary metrics from raw PVGIS data.
     * @param {Array<Object>} rawPvgisData - The raw data from `parsePvgisCsv`.
     * @returns {Object} An object with monthly generation, total generation, and peak power.
     */
    function calculatePvgisSummary(rawPvgisData) {
        // Find the most recent year in the dataset and check for multiple years
        let latestYear = 0;
        const allYears = new Set();
        rawPvgisData.forEach(d => {
            const year = parseInt(d.time.substring(0, 4), 10);
            allYears.add(year);
            if (year > latestYear) {
                latestYear = year;
            }
        });

        // Filter the data to only include the most recent year for the summary
        const singleYearData = rawPvgisData.filter(d => {
            const year = parseInt(d.time.substring(0, 4), 10);
            return year === latestYear;
        });

        const monthlyGeneration = Array(12).fill(0);
        let totalAnnualGeneration = 0;
        let peakPower = 0;

        // Use the single-year data for transformation and calculation
        const transformedData = transformPvgisData(singleYearData);

        transformedData.forEach(d => {
            const monthIndex = d.timestamp.getUTCMonth(); // 0-11
            monthlyGeneration[monthIndex] += d.generation;
            totalAnnualGeneration += d.generation;
        });

        // Find peak power from the single-year data as well for consistency
        singleYearData.forEach(d => {
            if (d.P > peakPower) peakPower = d.P;
        });

        return { monthlyGeneration, totalAnnualGeneration, peakPower: peakPower / 1000, yearUsed: latestYear, isMultiYear: allYears.size > 1 };
    }

    /**
     * Filters the parsed data to include only the last 12 full calendar months.
     * This ensures that annual calculations are based on a complete year of data.
     * @param {Array<Object>} data - The full array of parsed data.
     * @returns {Array<Object>} The filtered data array.
     */
    function filterLast12FullMonths(data) {
        if (data.length === 0) return [];

        const latestTimestamp = data[data.length - 1].timestamp;
        
        // Find the start of the month of the last data point.
        const endDate = new Date(latestTimestamp);
        endDate.setUTCDate(1);
        endDate.setUTCHours(0, 0, 0, 0);

        // Subtract one year to get the start date.
        const startDate = new Date(endDate);
        startDate.setUTCFullYear(startDate.getUTCFullYear() - 1);
        
        return data.filter(row => row.timestamp >= startDate && row.timestamp < endDate);
    }

    /**
     * A helper function to pause execution and allow the browser to repaint the UI.
     * This is crucial for updating status messages during a long-running simulation.
     * @returns {Promise<void>}
     */
    const yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0));

    /**
     * Checks if a given year is a leap year.
     * @param {number} year The year to check.
     * @returns {boolean} True if it's a leap year.
     */
    function isLeapYear(year) {
        return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    }


    // --- SIMULATION CORE --- //

    /**
     * Orchestrates the entire simulation process from file reading to displaying results.
     */
    async function runFullSimulation() {
        if (isSimulating) { return; }

        const params = getSimulationParameters();
        
        // Validation check for Export Maximiser strategy
        if (params.strategy === 'export-maximiser' && !params.forceChargeHours.some(h => h === true)) {
            setStatus('Error: For the Export Maximiser strategy, you must select at least one hour for Force Charging.', 'error');
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

                // First, parse the HDF to get the consumption data and the target year
                const fileText = await file.text();
                let parsedData = parseHDF(fileText);
                if (parsedData.length === 0) throw new Error('No valid data rows were parsed from the HDF file. Please check the file format.');

                const lastDataPoint = parsedData[parsedData.length - 1];
                const dataYear = lastDataPoint?.timestamp.getUTCFullYear();
                if (!dataYear) throw new Error("Could not determine the year from your HDF data.");

                // Now, parse the uploaded PVGIS file
                const pvgisText = await pvgisFile.text();
                const pvgisResult = parsePvgisCsv(pvgisText); // This is the unscaled data

                // Get the scaling factor from the UI
                const scalingFactor = parseFloat(document.getElementById('pvgisScalingFactor').value) || 1;
                // Create a scaled copy of the data for the simulation
                const rawPvgisData = pvgisResult.data.map(d => ({ ...d, P: d.P * scalingFactor }));
                
                // Transform the PVGIS data using its own timestamps. The year-agnostic merge will happen later.
                const transformedPvgisData = transformPvgisData(rawPvgisData);

                parsedData = mergePvgisData(parsedData, transformedPvgisData);
                setStatus('PVGIS data merged. Filtering data...', 'loading');
                await yieldToBrowser();
                fullData = filterLast12FullMonths(parsedData);
            } else {
                // If not using PVGIS, just parse the HDF as normal
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

            // --- Run Both Simulations for Comparison ---
            setStatus('Running Self-Consumption simulation...', 'loading');
            await yieldToBrowser();
            const paramsSC = { ...params, strategy: 'self-consumption' };
            const resultsSC = await runSimulation(fullData, paramsSC);

            setStatus('Running Export Maximiser simulation...', 'loading');
            await yieldToBrowser();
            const paramsEM = { ...params, strategy: 'export-maximiser' };
            const resultsEM = await runSimulation(fullData, paramsEM);

            simulationResults = {
                selfConsumption: resultsSC,
                exportMaximiser: resultsEM
            };
            updateUIWithResults();

            // Run optimization analysis for different battery sizes
            setStatus('Running optimization analysis for different battery sizes...', 'loading');
            await yieldToBrowser();
            const optimizationData = await runOptimizationAnalysis(fullData, params); // Use user's selected params for this
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
    
    /**
     * Collects all user-defined parameters from the input fields.
     * @returns {Object} An object containing all parameters for the simulation.
     */
    function getSimulationParameters() {
        const batteryCapacity = parseFloat(document.getElementById('batterySize').value);
        
        const params = {
            batteryCapacity: batteryCapacity,
            usableCapacity: batteryCapacity * (parseFloat(document.getElementById('usableCapacity').value) / 100),
            minSoc: parseFloat(document.getElementById('minSoc').value),
            maxSoc: parseFloat(document.getElementById('maxSoc').value),
            maxChargeRate: parseFloat(document.getElementById('chargeRate').value),
            maxDischargeRate: parseFloat(document.getElementById('chargeRate').value), // Assuming charge and discharge rates are the same
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

    /**
     * Transforms raw hourly PVGIS data into 30-minute interval data.
     * @param {Array<Object>} hourlyData - The raw hourly data from the PVGIS CSV.
     * @returns {Array<Object>} An array of transformed data points with 30-minute intervals.
     */
    function transformPvgisData(hourlyData) {
        const pvgisData = [];
        hourlyData.forEach(item => {
            const timeStr = item.time; // Format: "20230101:0010"
            const pvgisYear = parseInt(timeStr.substring(0, 4), 10);
            const month = parseInt(timeStr.substring(4, 6), 10) - 1;
            const day = parseInt(timeStr.substring(6, 8), 10);
            const hour = parseInt(timeStr.substring(9, 11), 10);

            const powerInWatts = item.P;
            // PVGIS gives average power (W) over the hour. To get energy (kWh) for 30 mins,
            // we multiply by 0.5 hours and divide by 1000.
            const energyInKwh_30min = (powerInWatts * HOURS_PER_INTERVAL) / 1000;

            // Create two 30-minute intervals for each hour, using the year from the PVGIS data itself.
            const firstIntervalTs = new Date(Date.UTC(pvgisYear, month, day, hour, 0, 0));
            const secondIntervalTs = new Date(Date.UTC(pvgisYear, month, day, hour, 30, 0));

            // A safeguard against invalid dates that could be created from malformed CSV data.
            if (isNaN(firstIntervalTs.getTime())) return;

            pvgisData.push({ timestamp: firstIntervalTs, generation: energyInKwh_30min });
            pvgisData.push({ timestamp: secondIntervalTs, generation: energyInKwh_30min });
        });
        return pvgisData;
    }

    /**
     * Merges simulated PVGIS generation data with the user's consumption data.
     * @param {Array<Object>} consumptionData - The user's data parsed from HDF.
     * @param {Array<Object>} generationData - The simulated data from PVGIS.
     * @returns {Array<Object>} The merged dataset.
     */
    function mergePvgisData(consumptionData, generationData) {
        // Helper to create a year-agnostic key (e.g., "02-29T14:30") from a Date object.
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

            // Special handling for leap day (Feb 29). If the consumption data has a Feb 29
            // but the generation data (from a non-leap year) does not, use Feb 28 data as a fallback.
            if (newGeneration === 0 && key.startsWith('02-29')) {
                const fallbackKey = key.replace('02-29', '02-28');
                newGeneration = genMap.get(fallbackKey) || 0;
            }

            return { ...row, generation: newGeneration };
        });
    }
    /**
     * The core simulation engine that processes the data step-by-step.
     * @param {Array<Object>} data - The time-series data to simulate over.
     * @param {Object} params - The simulation parameters.
     * @returns {Promise<Object>} An object containing the aggregated results.
     */
    async function runSimulation(data, params) {
        const minSoC_kWh = params.usableCapacity * (params.minSoc / 100);
        const maxSoC_kWh = params.usableCapacity * (params.maxSoc / 100);
        let batterySoC = minSoC_kWh; // Start simulation with battery at minimum SoC.

        const monthlyData = {}; 
        const detailedLog = [];
        const efficiencySqrt = Math.sqrt(params.roundtripEfficiency);

        // State variables for tracking daily metrics in the Export Maximiser strategy
        let dailyMaxSoC = minSoC_kWh;
        let forceChargeScheduledToday = false;

        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const prevRow = i > 0 ? data[i - 1] : null;

            // --- Progress Update & Day Rollover Logic ---
            if (i > 0 && i % 1000 === 0) { 
                setStatus(`Running simulation... (${Math.round((i/data.length)*100)}%)`, 'loading'); 
                await yieldToBrowser(); 
            }
            
            const mKey = row.timestamp.toISOString().slice(0, 7);
            if (!monthlyData[mKey]) {
                monthlyData[mKey] = { costWithoutBattery: 0, costWithBattery: 0, exportRevenue: 0, savings: 0, importWithoutBattery: 0, importWithBattery: 0, exportWithBattery: 0, consumption: 0, generation: 0, chargedToBattery: 0, dischargedFromBattery: 0, missedFullCharges: 0 };
            }

            // Check if the day has changed to reset daily tracking variables
            if (prevRow && row.timestamp.getUTCDate() !== prevRow.timestamp.getUTCDate()) {
                // If a force charge was scheduled but the battery didn't reach near-full, log it.
                if (forceChargeScheduledToday && dailyMaxSoC < (maxSoC_kWh * 0.99)) {
                    const prevMKey = prevRow.timestamp.toISOString().slice(0, 7);
                    if (monthlyData[prevMKey]) monthlyData[prevMKey].missedFullCharges++;
                }
                // Reset daily trackers
                dailyMaxSoC = batterySoC;
                forceChargeScheduledToday = false;
            }

            // --- Core Simulation Step ---
            const result = runSingleTimeStep(row, batterySoC, params, minSoC_kWh, maxSoC_kWh, efficiencySqrt, forceChargeScheduledToday);

            // Update state for the next iteration
            batterySoC = result.newSoC;
            forceChargeScheduledToday = result.newForceChargeScheduledToday;
            
            // --- Log & Aggregate Results ---
            const m = monthlyData[mKey];
            m.consumption += row.consumption; 
            m.generation += row.generation; 
            m.importWithBattery += result.gridImport; 
            m.exportWithBattery += result.gridExport;
            m.chargedToBattery += result.toBattery; 
            m.dischargedFromBattery += result.fromBattery;
            m.costWithBattery += result.gridImport * params.importPrices[row.timestamp.getUTCHours()]; 
            m.exportRevenue += result.gridExport * params.exportPrices[row.timestamp.getUTCHours()];
            
            // Calculate baseline cost for comparison
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

    /**
     * Executes the logic for a single time interval (e.g., 30 minutes).
     * This function is the heart of the simulation's decision-making process.
     * @returns {Object} The results of this single time step.
     */
    function runSingleTimeStep(row, currentSoC, params, minSoC_kWh, maxSoC_kWh, efficiencySqrt, forceChargeScheduledToday) {
        let { consumption: homeConsumption, generation: solarGeneration } = row;
        let batterySoC = currentSoC;
        let gridImport = 0, gridExport = 0, toBattery = 0, fromBattery = 0;

        const hour = row.timestamp.getUTCHours();
        const availableEnergyInBattery = Math.max(0, batterySoC - minSoC_kWh);
        const spaceInBattery = Math.max(0, maxSoC_kWh - batterySoC);
        const isForceChargeHour = params.strategy === 'export-maximiser' && params.forceChargeHours[hour];

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
            if (params.strategy === 'self-consumption') {
                // In self-consumption, prioritize charging the battery with solar
                const chargeFromSolar = Math.min(excessSolar, spaceInBattery / efficiencySqrt, params.maxChargeRate * HOURS_PER_INTERVAL);
                if (chargeFromSolar > FLOAT_TOLERANCE) {
                    batterySoC += chargeFromSolar * efficiencySqrt;
                    toBattery += chargeFromSolar;
                    gridExport += excessSolar - chargeFromSolar; // Export any solar left over
                } else {
                    gridExport += excessSolar; // Export all if battery is full
                }
            } else {
                // In other strategies (like export maximiser), immediately export solar
                gridExport += excessSolar;
            }
        }

        // 5. Handle Export Maximiser Strategy Logic
        if (params.strategy === 'export-maximiser') {
            // 5a. Pre-emptive discharge: Dump battery charge to the grid just before a force-charge window
            // to make space for cheap grid charging.
            const nextHour = (hour + 1) % 24;
            const hourAfterNext = (hour + 2) % 24;
            const isPreChargeHour = !isForceChargeHour && (params.forceChargeHours[nextHour] || params.forceChargeHours[hourAfterNext]);
            
            if (isPreChargeHour) {
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
            
            // 5b. Force Charge from Grid
            if (isForceChargeHour) {
                forceChargeScheduledToday = true;
                const homeImportPower = remainingDemand / HOURS_PER_INTERVAL; // Remaining demand is now home import
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
        
        // 6. Final Clipping: Ensure grid export does not exceed the Maximum Export Capacity (MEC)
        if (gridExport / HOURS_PER_INTERVAL > params.mec) {
            gridExport = params.mec * HOURS_PER_INTERVAL;
        }

        return {
            gridImport, gridExport, toBattery, fromBattery, 
            newSoC: batterySoC, 
            newForceChargeScheduledToday: forceChargeScheduledToday
        };
    }

    /**
     * Calculates final summary statistics after the simulation loop is complete.
     * @param {Object} monthlyData - Aggregated data for each month.
     * @param {number} dataLength - The total number of intervals simulated.
     * @param {Array<Object>} detailedLog - The detailed log from the simulation.
     * @param {Object} params - The simulation parameters.
     * @returns {Object} The final results object.
     */
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

    /**
     * Runs the simulation for a range of battery sizes to find the optimal one.
     * @param {Array<Object>} data - The time-series data.
     * @param {Object} baseParams - The user's original simulation parameters.
     * @returns {Promise<Array<Object>>} A promise that resolves to an array of {size, savings}.
     */
    async function runOptimizationAnalysis(data, baseParams) {
        const sizesToTest = [5, 10, 15, 20, 25, 30, 35, 40];
        // Ensure the user's selected size is in the test set
        if (!sizesToTest.includes(baseParams.batteryCapacity)) {
            sizesToTest.push(baseParams.batteryCapacity);
            sizesToTest.sort((a, b) => a - b);
        }

        const results = [];
        for (const size of sizesToTest) {
            const testParams = { ...baseParams };
            testParams.batteryCapacity = size;
            // Recalculate usable capacity based on the new size and the user's % setting
            testParams.usableCapacity = size * (parseFloat(document.getElementById('usableCapacity').value) / 100);

            // We don't need the detailed log for this, so we can run a slightly faster version
            const result = await runSimulation(data, testParams);
            results.push({
                size: size,
                savings: result.annualSavings
            });
        }
        return results;
    }


    // --- UI RESULTS DISPLAY --- //

    /**
     * Updates the entire UI with the simulation results.
     */
    function updateUIWithResults() { 
        document.getElementById('welcomePanel').classList.add('hidden'); 
        document.getElementById('resultsPanel').classList.remove('hidden'); 
        document.getElementById('optimizationChartContainer').classList.remove('hidden');
        
        const formatCurrency = (value) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(value); 
        const formatKWh = (value) => `${value.toFixed(0)} kWh`;
        const formatYears = (value) => isFinite(value) ? `${value.toFixed(1)} years` : 'Never';
        const formatPercent = (value) => `${value.toFixed(1)}%`;

        const resultsSC = simulationResults.selfConsumption;
        const resultsEM = simulationResults.exportMaximiser;
        const tableBody = document.getElementById('comparisonTableBody');

        const createRow = (metric, valueSC, valueEM, formatter) => {
            // For payback, bill, import, lower is better. For others, higher is better.
            const isLowerBetter = metric.toLowerCase().includes('payback') || metric.toLowerCase().includes('bill') || metric.toLowerCase().includes('import');
            let isBetterSC = isLowerBetter ? parseFloat(valueSC) < parseFloat(valueEM) : parseFloat(valueSC) > parseFloat(valueEM);
            let isBetterEM = isLowerBetter ? parseFloat(valueEM) < parseFloat(valueSC) : parseFloat(valueEM) > parseFloat(valueSC);

            return `
                <tr class="text-center">
                    <td class="p-3 text-left font-medium text-gray-700">${metric}</td>
                    <td class="p-3 font-mono ${isBetterSC ? 'text-green-600 font-bold' : ''}">${formatter(valueSC)}</td>
                    <td class="p-3 font-mono ${isBetterEM ? 'text-green-600 font-bold' : ''}">${formatter(valueEM)}</td>
                </tr>
            `;
        };

        tableBody.innerHTML = `
            ${createRow('Annual Savings', resultsSC.annualSavings, resultsEM.annualSavings, formatCurrency)}
            ${createRow('Payback Period', resultsSC.paybackPeriod, resultsEM.paybackPeriod, formatYears)}
            ${createRow('Self-Sufficiency', resultsSC.selfSufficiency, resultsEM.selfSufficiency, formatPercent)}
            ${createRow('Annual Bill (After)', resultsSC.annualBillAfter, resultsEM.annualBillAfter, formatCurrency)}
            ${createRow('Annual Import', resultsSC.annualImportAfter, resultsEM.annualImportAfter, formatKWh)}
            ${createRow('Annual Export', resultsSC.annualExportAfter, resultsEM.annualExportAfter, formatKWh)}
        `;
        
        // --- Generate Charts & Selectors ---
        generateBeforeSummary();
        generateMonthlyConsumptionChart();
        
        const monthSelector = document.getElementById('monthSelector'); 
        monthSelector.innerHTML = ''; 
        const monthKeys = Object.keys(resultsSC.monthlyData).sort(); // Use one of the results to get keys
        
        monthKeys.forEach(key => { 
            const option = document.createElement('option'); 
            option.value = key; 
            const [year, month] = key.split('-'); 
            option.textContent = new Date(year, month - 1).toLocaleString('default', { month: 'long', year: 'numeric' }); 
            monthSelector.appendChild(option); 
        }); 
        
        // --- Initialize Daily View ---
        if (monthKeys.length > 0) { 
            monthSelector.value = monthKeys[monthKeys.length - 1]; // Default to the last month
            updateDaySelector(monthSelector.value); 
        } 
    }

    /**
     * Generates the "Before" summary showing the situation without a battery.
     */
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
    
    /**
     * Populates the day selector based on the chosen month and updates the monthly summary.
     * @param {string} monthKey - The selected month key (e.g., "2023-04").
     */
    function updateDaySelector(monthKey) {
        if (!simulationResults.selfConsumption) return; // Guard against running before simulation

        const daySelector = document.getElementById('daySelector');
        daySelector.innerHTML = '';
        
        const selectedStrategy = document.querySelector('input[name="strategy"]:checked')?.value || 'self-consumption';
        const detailedLogForStrategy = selectedStrategy === 'export-maximiser' 
            ? simulationResults.exportMaximiser.detailedLog 
            : simulationResults.selfConsumption.detailedLog;
        
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
        
        // Default to showing the first day of the selected month
        if (uniqueDays.length > 0) {
            daySelector.value = uniqueDays[0];
            updateDailyView(uniqueDays[0]);
        }
    }
    
    /**
     * Updates the detailed monthly summary list in the UI.
     * @param {string} monthKey - The selected month key (e.g., "2023-04").
     */
    function updateMonthlySummary(monthKey) { 
        if (!simulationResults.selfConsumption) return; // Guard against running before simulation

        const selectedStrategy = document.querySelector('input[name="strategy"]:checked')?.value || 'self-consumption';
        const resultsForStrategy = selectedStrategy === 'export-maximiser' 
            ? simulationResults.exportMaximiser
            : simulationResults.selfConsumption;
        
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

        if (selectedStrategy === 'export-maximiser' && monthSummary.missedFullCharges > 0) {
            summaryHTML += `<li class="border-t border-gray-200 my-2"></li><li class="flex justify-between text-yellow-500" title="The battery did not reach its target SoC on these days during the Force Charge window, likely due to grid import (MIC) or charge rate limits."><span>Missed Full Charges:</span><span class="font-mono font-bold">${monthSummary.missedFullCharges} days</span></li>`;
        }
        document.getElementById('monthlySummaryList').innerHTML = summaryHTML;
    }

    /**
     * Updates the daily charts (Energy Flow and SoC) for the selected day.
     * @param {string} dayStr - The selected day string (e.g., "2023-04-15").
     */
    function updateDailyView(dayStr) { 
        if (!dayStr || !simulationResults.selfConsumption) return; 
        
        const params = getSimulationParameters();
        const selectedStrategy = document.querySelector('input[name="strategy"]:checked')?.value || 'self-consumption';
        const detailedLogForStrategy = selectedStrategy === 'export-maximiser' 
            ? simulationResults.exportMaximiser.detailedLog 
            : simulationResults.selfConsumption.detailedLog;

        const dayData = detailedLogForStrategy.filter(log => log.timestamp.toISOString().startsWith(dayStr)); 
        if (dayData.length === 0) return; 

        document.getElementById('chartDate').textContent = new Date(dayStr + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); 
        
        const chartSeries = { 
            labels: dayData.map(d => d.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })), 
            baseNetKw: dayData.map(d => (d.consumption - d.generation) / HOURS_PER_INTERVAL),
            newNetFlowKw: dayData.map(d => (d.gridImport - d.gridExport) / HOURS_PER_INTERVAL),
            batterySoC: dayData.map(d => (d.batterySoC / params.usableCapacity) * 100)
        }; 
        
        // Destroy old charts before creating new ones to prevent memory leaks
        if (energyChartInstance) energyChartInstance.destroy(); 
        if (socChartInstance) socChartInstance.destroy();

        const energyCtx = document.getElementById('energyChart').getContext('2d'); 
        energyChartInstance = new Chart(energyCtx, getEnergyChartConfig(chartSeries)); 
        
        const socCtx = document.getElementById('socChart').getContext('2d');
        socChartInstance = new Chart(socCtx, getSoCChartConfig(chartSeries));

        // Update navigation button states
        const daySelector = document.getElementById('daySelector'); 
        document.getElementById('prevDayBtn').disabled = daySelector.selectedIndex === 0; 
        document.getElementById('nextDayBtn').disabled = daySelector.selectedIndex === daySelector.options.length - 1; 
    }

    
    // --- CHARTING --- //
    
    /**
     * Generates the optimization chart showing savings vs. battery size.
     * @param {Array<Object>} optimizationData - Array of {size, savings}.
     * @param {number} userSelectedSize - The battery size the user originally selected.
     */
    function generateOptimizationChart(optimizationData, userSelectedSize) {
        if (optimizationChartInstance) optimizationChartInstance.destroy();
        const ctx = document.getElementById('optimizationChart').getContext('2d');

        // Highlight the data point for the user's currently selected size
        const pointColors = optimizationData.map(d => d.size === userSelectedSize ? 'rgba(239, 68, 68, 1)' : 'rgba(79, 70, 229, 1)');
        const pointRadii = optimizationData.map(d => d.size === userSelectedSize ? 6 : 3);

        const chartOptions = getBaseChartOptions('Annual Savings (€)', false);
        chartOptions.scales.x.title = { display: true, text: 'Battery Size (kWh)', color: '#4b5563' };

        optimizationChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: optimizationData.map(d => d.size),
                datasets: [{
                    label: 'Annual Savings (€)',
                    data: optimizationData.map(d => d.savings),
                    borderColor: 'rgba(79, 70, 229, 0.8)',
                    backgroundColor: pointColors, // For points
                    pointRadius: pointRadii,
                    pointHoverRadius: 8,
                    fill: false,
                    tension: 0.1
                }]
            },
            options: chartOptions
        });
    }
    /**
     * Generates the monthly consumption bar chart.
     */
    function generateMonthlyConsumptionChart() {
        if (monthlyConsumptionChartInstance) monthlyConsumptionChartInstance.destroy();
        const ctx = document.getElementById('monthlyConsumptionChart').getContext('2d');

        const sortedKeys = Object.keys(simulationResults.selfConsumption.monthlyData).sort();
        const monthLabels = sortedKeys.map(key => {
            const [year, month] = key.split('-');
            return new Date(year, month-1).toLocaleString('default', { month: 'short' });
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
    
    /**
     * Generates the monthly PVGIS generation bar chart.
     * @param {Array<number>} monthlyData - An array of 12 numbers representing monthly generation.
     */
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
                    backgroundColor: 'rgba(245, 158, 11, 0.6)', // Amber color
                    borderColor: 'rgba(245, 158, 11, 1)',
                    borderWidth: 1
                }]
            },
            options: chartOptions
        });
    }

    /**
     * Creates the configuration object for the daily energy flow line chart.
     * @param {Object} chartData - The data series for the chart.
     * @returns {Object} A Chart.js configuration object.
     */
    function getEnergyChartConfig(chartData) {
        const minPower = Math.min(...chartData.newNetFlowKw, ...chartData.baseNetKw);
        const yMin = Math.min(-2, Math.floor(minPower)); // Ensure a minimum range

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

        // Customizations for this specific chart
        config.options.scales.y.min = yMin;
        config.options.scales.x.ticks = { display: false };
        config.options.plugins.legend.position = 'bottom';
        config.options.scales.y.grid = { 
            color: (context) => (context.tick.value === 0) ? '#22c55e' : 'rgba(0, 0, 0, 0.1)',
            lineWidth: (context) => (context.tick.value === 0) ? 2 : 1
        };
        
        return config;
    }
    
    /**
     * Creates the configuration object for the daily State of Charge (SoC) bar chart.
     * @param {Object} chartData - The data series for the chart.
     * @returns {Object} A Chart.js configuration object.
     */
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
        
        // Customizations for this specific chart
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

    /**
     * Provides a base configuration for all charts to ensure a consistent look and feel.
     * @param {string} yAxisTitle - The title for the Y-axis.
     * @param {boolean} showLegend - Whether to display the chart legend.
     * @returns {Object} A base Chart.js options object.
     */
    function getBaseChartOptions(yAxisTitle, showLegend = true) {
        const gridColor = 'rgba(0, 0, 0, 0.1)';
        const labelColor = '#4b5563';
        
        return {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { 
                    display: showLegend,
                    labels: { color: labelColor } 
                },
                tooltip: { 
                    mode: 'index', 
                    intersect: false,
                    backgroundColor: 'rgba(0, 0, 0, 0.8)'
                }
            },
            scales: {
                y: { 
                    beginAtZero: true, 
                    grid: { color: gridColor }, 
                    ticks: { color: labelColor },
                    title: { display: true, text: yAxisTitle, color: labelColor }
                },
                x: { 
                    grid: { color: gridColor }, 
                    ticks: { color: labelColor }
                }
            },
            interaction: {
                mode: 'index',
                intersect: false
            }
        };
    }


    // --- UTILITIES --- //

    /**
     * Exports the detailed simulation log to a CSV file.
     */
    function exportResultsToCSV() { 
        if (!simulationResults?.detailedLog?.length) { 
            setStatus("No simulation data to export. Please run a simulation first.", "warning"); 
            return; 
        } 
        
        const headers = ["Timestamp (UTC)", "Consumption (kWh)", "Generation (kWh)", "Grid Import (kWh)", "Grid Export (kWh)", "Battery Charge (kWh)", "Battery Discharge (kWh)", "Battery SoC (kWh)"]; 
        const pad = (num) => num.toString().padStart(2, '0');

        const rows = simulationResults.detailedLog.map(log => {
            const ts = log.timestamp;
            // Format timestamp to a more standard and sortable format
            const dateStr = `${ts.getUTCFullYear()}-${pad(ts.getUTCMonth() + 1)}-${pad(ts.getUTCDate())} ${pad(ts.getUTCHours())}:${pad(ts.getUTCMinutes())}:${pad(ts.getUTCSeconds() || '00')}`;
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
        link.setAttribute("download", "battery_simulation_export.csv"); 
        link.style.visibility = 'hidden'; 
        
        document.body.appendChild(link); 
        link.click(); 
        document.body.removeChild(link); 
    }

    // --- START THE APP --- //
    initialize();

});

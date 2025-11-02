Home Battery Savings Calculator
A browser-based tool designed to help Irish homeowners with solar PV systems estimate the potential financial savings of installing a home battery. By uploading their official ESB Networks HDF (Harmonised Data File), users can run a detailed, year-long simulation to see how a battery would have performed with their actual energy consumption and generation data.

It now also supports exporting a new, simulated HDF file for each strategy, allowing for a full, comprehensive tariff analysis on external comparison sites.

Features
Detailed HDF Parsing: Directly processes the 30-minute interval CSV file provided by ESB Networks, ensuring the simulation is based on real-world data.

Customisable System Configuration: Allows users to set key technical parameters for their battery system, including:

Total and Usable Capacity (kWh)

Charge/Discharge Rate (kW)

Round-trip Efficiency (%)

Maximum Grid Import & Export (MIC/MEC) limits

Minimum/Maximum State of Charge (SoC)

PV System Simulation: Allows users without existing solar data to simulate a new PV system by uploading an hourly data file from the PVGIS service.

Advanced Simulation Strategies:

Self-Consumption: A standard strategy that prioritises storing excess solar power to be used later in the home.

Export Maximiser: An advanced strategy that force-charges the battery from the grid during designated cheap-rate hours and attempts to 'force discharge' by exporting to the grid right before the cheap window starts to make space.

Balanced Export Maximiser: A balanced version of the Export Maximiser. It avoids pre-emptive grid export during the winter months (Nov, Dec, Jan, Feb) to preserve battery for higher heating loads.

Import Minimiser: Prioritises self-consumption, but also force-charges from the grid during cheap rates. It never force-discharges, ensuring the battery is full for your own use.

Flexible Tariff Options: Supports flat-rate and hourly import/export tariffs to accurately model various energy plans. Default rates are pre-set to a Pinergy EV tariff (€0.06/kWh @ 2-5am) and a 25c/kWh export rate for demonstration.

Simulated HDF Export:

Generate a new, ESB-compatible HDF file for each of the 4 simulation strategies.

Allows for a full, comprehensive financial analysis on dedicated tariff comparison sites (e.g., www.energypal.ie) that includes standing charges, PSO levies, and other fees.

Exported files are anonymous and use a generic MPRN/Meter ID to protect your privacy.

Preliminary Financial Analysis: Provides a clear side-by-side comparison of all four simulation strategies, showing key annual metrics based on unit rates only:

Annual Savings

Payback Period

Self-Sufficiency

Annual Bill (Before & After)

Grid Import/Export

Interactive Data Visualisation:

Annual and monthly summary cards.

Interactive daily charts showing energy flow and battery state of charge.

Battery Size Optimisation Chart: A graph that compares estimated annual savings across different battery sizes to help users identify the most cost-effective system.

How to Use
Download Your HDF File: Log in to your ESB Networks account and download your detailed Harmonised Data File (HDF) for the last 12-18 months. Important: Choose the "30-minute readings in calculated kWh" option.

Open the Calculator: Open the index.html file in any modern web browser.

Upload Your File: In Section 1, click "Choose file" and select the HDF file you downloaded.

Configure Your System:

PV Data: If you don't have solar data, select "Simulate New PV System", download the hourly data file from the PVGIS website (instructions provided in the app), and upload it.

Technical Details: Enter the technical details of the battery system you are considering. Use the info icons for help on specific terms.

Strategy: Choose the simulation strategy you want to model.

Financials: Enter the total installed cost of the system and configure your electricity import/export tariffs. If using a strategy with force-charging, be sure to select your cheap-rate hours in the hourly import table.

Run the Simulation: Click the "Run Simulation" button at the top of the configuration panel.

Review Preliminary Results: Review the side-by-side "After" Scenario table for a quick estimate of unit-rate savings. Use the interactive charts to explore daily performance.

Perform Full Financial Analysis (Recommended):

On the results page, scroll down to the "Download HDF for Full Financial Analysis" section.

Read the disclaimer about standing charges.

Download the HDF file for the strategy you're most interested in (e.g., "Import Minimiser HDF").

Upload this new file to a comparison site like www.energypal.ie to get a complete financial breakdown, including all standing charges and levies, for every tariff on the market.

Technical Details
Frontend: Built with plain HTML, JavaScript, and styled with Tailwind CSS.

Charting: Uses Chart.js for all data visualisation.

Icons: Icons are provided by the Lucide icon library.

Timestamp Correction: Accurately handles the HDF 'End of Interval' timestamp by shifting all data 30 minutes on import (and back on export) to ensure correct alignment for simulation and analysis.

Client-Side Simulation: All file parsing and simulation logic runs directly in the user's browser. No data is uploaded to any server, ensuring user privacy.

Future Development
Save/Load Profiles: Add the ability to save and load different configuration profiles, making it easier to compare different system setups.

Disclaimer
This tool is intended for estimation purposes only. The built-in financial calculations are based only on the unit rates you provide and do not include standing charges, PSO levies, or other fees.

For a complete and accurate financial analysis, please use the exported "Simulated HDF File" on a dedicated comparison website like www.energypal.ie, which can account for all parts of an electricity bill.

Actual savings may vary due to changes in weather, energy usage, and electricity tariffs.

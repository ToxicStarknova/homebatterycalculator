Home Battery Savings Calculator
==============================

A browser-based tool designed to help Irish homeowners with solar PV systems estimate the potential financial savings of installing a home battery. By uploading their official ESB Networks HDF (Harmonised Data File), users can run a detailed, year-long simulation to see how a battery would have performed with their actual energy consumption and generation data.

Features
--------

*   **Detailed HDF Parsing:** Directly processes the CSV file provided by ESB Networks, ensuring the simulation is based on real-world data.
*   **Customisable System Configuration:** Allows users to set key technical parameters for their battery system, including:
    *   Total and Usable Capacity (kWh)
    *   Charge/Discharge Rate (kW)
    *   Round-trip Efficiency (%)
    *   Maximum Grid Import & Export (MIC/MEC)
    *   Minimum/Maximum State of Charge (SoC)
*   **Advanced Simulation Strategies:**
    *   **Self-Consumption:** A standard strategy that prioritises storing excess solar power to be used later in the home.
    *   **Export Maximiser (Tariff Optimiser):** An advanced strategy that force-charges the battery from the grid during designated cheap-rate hours.
*   **Flexible Tariff Options:** Supports flat-rate and hourly import/export tariffs to accurately model various energy plans.
*   **Comprehensive Financial Analysis:** Provides clear annual summaries of:
    *   Estimated Bill (Before & After Battery)
    *   Total Annual Savings
    *   System Payback Period
    *   Self-Sufficiency Percentage
*   **Interactive Data Visualisation:**
    *   Annual and monthly summary cards.
    *   Interactive daily charts showing energy flow and battery state of charge.
    *   **Battery Size Optimisation Chart:** A graph that compares annual savings across different battery sizes to help users identify the most cost-effective system.

How to Use
----------

1.  **Download Your HDF File:** Log in to your ESB Networks account and download your detailed Harmonised Data File (HDF) for the last 12-18 months.
2.  **Open the Calculator:** Open the `index.html` file in any modern web browser.
3.  **Upload Your File:** In Section 1, click "Choose file" and select the HDF file you downloaded.
4.  **Configure Your System:**
    *   In Section 2, enter the technical details of the battery system you are considering. Use the info icons for help on specific terms.
    *   In Section 3, choose the simulation strategy you want to model.
    *   In Section 4, enter the total installed cost of the system and configure your electricity import/export tariffs. If using the "Export Maximiser" strategy, be sure to select your cheap-rate hours for force-charging.
5.  **Run the Simulation:** Click the "Run Simulation" button at the top of the configuration panel.
6.  **Analyse the Results:** Review the summary cards and interactive charts on the right-hand side to see your potential savings and energy usage patterns. Use the new "Battery Size vs. Annual Savings" chart to see which system size offers the best return on investment.

Technical Details
-----------------

*   **Frontend:** Built with plain HTML, JavaScript, and styled with Tailwind CSS.
*   **Charting:** Uses Chart.js for all data visualisation.
*   **Icons:** Icons are provided by the Lucide icon library.
*   **Client-Side Simulation:** All file parsing and simulation logic runs directly in the user's browser. No data is uploaded to any server, ensuring user privacy.

Future Development
------------------

*   **PV Simulation:** The next major planned feature is to add a PV (solar panel) simulation mode. This will allow users who do not yet have solar panels to estimate their potential savings by entering their location, system size, and orientation, using the PVGIS API to generate synthetic solar data.

Disclaimer
----------

This tool is intended for estimation purposes only. The financial calculations are based on the data you provide and the simulation logic. Actual savings may vary due to changes in weather, energy usage, and electricity tariffs.

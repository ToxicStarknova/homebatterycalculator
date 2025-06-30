/**
 * Fetches hourly solar PV generation data from the PVGIS API.
 * @param {object} params - The parameters for the PVGIS API call.
 * @param {number} params.lat - Latitude.
 * @param {number} params.lon - Longitude.
 * @param {number} params.peakpower - PV system size in kWp.
 * @param {number} params.loss - System loss in percent.
 * @param {number} params.tilt - Panel tilt in degrees.
 * @param {number} params.azimuth - Panel azimuth in degrees (0=N, 90=E, 180=S, 270=W).
* @param {number} [params.year] - Optional. The year for which to fetch data. If not provided, uses the latest available year.
 * @returns {Promise<Array>} A promise that resolves to an array of hourly generation data objects.
 */
async function fetchPvgisData(params) {
    const API_URL = 'https://re.jrc.ec.europa.eu/api/v5_2/seriescalc';

    // PVGIS API uses a different convention for azimuth (aspect):
    // 0=South, -90=East, 90=West.
    // The app's UI uses: 180=South, 90=East, 270=West.
    // The conversion is: pvgis_aspect = app_azimuth - 180.
    const pvgisAspect = params.azimuth - 180;

    const urlParams = new URLSearchParams({
        lat: params.lat,
        lon: params.lon,
        peakpower: params.peakpower,
        loss: params.loss,
        angle: params.tilt,
        aspect: pvgisAspect,
        outputformat: 'json',
        pvcalculation: 1,
    });

    if (params.year) {
        urlParams.append('startyear', params.year);
        urlParams.append('endyear', params.year);
    }

    const pvgisUrl = `${API_URL}?${urlParams.toString()}`;

    // DEVELOPMENT NOTE: Using a CORS proxy to bypass browser security restrictions
    // when running from a local server (http://localhost). This is a common development
    // workaround. For a production deployment, you would typically have your own backend
    // server make this API call to avoid relying on a third-party proxy. We are switching
    // to a different proxy service that has proven more reliable.
    const proxyUrl = `https://thingproxy.freeboard.io/fetch/${pvgisUrl}`;
    console.log('Fetching from PVGIS via proxy:', proxyUrl);

    try {
        const response = await fetch(proxyUrl);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`PVGIS API request failed with status ${response.status}. Response: ${errorText}`);
        }
        const data = await response.json();
        return data.outputs.hourly;
    } catch (error) {
        console.error('Failed to fetch PVGIS data:', error);
        throw new Error(`Could not retrieve data from PVGIS. Check browser console for the full URL and error details.`);
    }
}
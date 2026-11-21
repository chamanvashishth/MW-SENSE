// Recorded data excerpted with attribution. This is historical replay, never live ESP32 telemetry.
// Greenhouse source: https://github.com/Saynbemorinbewang2/Open-Dataset-for-Precision-Agriculture-in-Greenhouse-Environments
// UCI source: https://archive.ics.uci.edu/dataset/360/air+quality (CC BY 4.0)
// The greenhouse files do not include absolute timestamps. Number_data is an ordinal per sensor.
// No source below includes an SGP40 VOC index or ESP32 ADC counts.
const greenhouseRows = data => data.split(';').map((line, i) => {
  const [temperature, humidity, soil, rssi] = line.trim().split(/\s+/).map(Number);
  return { sample: i + 1, temperature, humidity, soil, rssi, voc: null, recordedTime: `Sample ${i + 1} (30 minute source interval)` };
});
const airRows = data => data.split(';').map((line, i) => {
  const [date, hour, t, h, response] = line.trim().split(/\s+/);
  return { sample: i + 1, temperature: Number(t), humidity: Number(h), soil: null, voc: null, rssi: null, metalOxideResponse: Number(response), recordedTime: `${date} ${hour.replaceAll('.', ':')}` };
});

export const DATASETS = Object.freeze({
  greenhouse1: {
    id: 'greenhouse1', name: 'Greenhouse Scenario 1', origin: 'University of Ngaoundéré WSN greenhouse dataset',
    sourceUrl: 'https://github.com/Saynbemorinbewang2/Open-Dataset-for-Precision-Agriculture-in-Greenhouse-Environments/blob/master/Dataset_scenario_1.csv',
    cadence: 'Approximately 30 minutes per device according to source README',
    note: '40 unmodified measurements from Sensor 1. Original Soil_humidity zero values are retained as zero, not interpreted as missing. RSSI is source equipment signal strength, not the virtual ESP32 WiFi status.',
    measured: ['temperature', 'humidity', 'soil', 'rssi'], rows: greenhouseRows('25.3 86 0 -86;25.6 86 0 -91;26.3 83 0 -86;27.6 75 0 -87;27.5 73 0 -86;27.7 72 0 -86;26.9 74 0 -82;24.7 80 0 -82;23.8 86 0 -82;23.3 88 0 -82;22.9 89 11.10 -82;22.6 91 20.70 -81;22.5 92 31 -82;22.2 94 40.80 -82;22.4 95 70.03 -81;22.2 95 59.30 -81;22.4 95 53 -81;22.5 95 40.80 -81;22.4 95 41.30 -81;22.2 95 39.90 -81;22.1 95 39.90 -81;21.8 94 35.10 -81;21.5 94 29.70 -80;21.8 94 28.70 -81;22 95 26 -81;21.9 94 23.50 -80;21.8 94 21.30 -80;21.7 94 15 -81;21.3 94 12.30 -80;21.6 94 11 -81;21.6 94 9.20 -81;21.9 94 8.10 -80;22.3 95 8.20 -81;24.3 89 6.23 -81;25.1 86 6.45 -85;29.3 76 1.10 -84;28.8 74 0 -84;31.1 69 0 -83;35.3 54 0 -83;32.6 62 0 -90'),
  },
  greenhouse4: {
    id: 'greenhouse4', name: 'Greenhouse Scenario 4', origin: 'University of Ngaoundéré WSN greenhouse dataset',
    sourceUrl: 'https://github.com/Saynbemorinbewang2/Open-Dataset-for-Precision-Agriculture-in-Greenhouse-Environments/blob/master/Dataset_scenario_4.csv',
    cadence: 'Approximately 30 minutes per device according to source README',
    note: '40 unmodified measurements from Sensor 1. Source scenario conditions differ. Zero soil readings are preserved.',
    measured: ['temperature', 'humidity', 'soil', 'rssi'], rows: greenhouseRows('32.5 57 0 -86;32.1 60 0 -88;29 72 0 -88;27.7 74 0 -90;27 78 0 -89;25.7 86 0 -87;24.8 91 0 -88;24 95 0 -86;23.6 95 0 -87;23.6 95 0 -89;23.5 95 0 -88;22.7 95 0 -87;22.5 95 0 -93;22.3 95 0 -89;22.5 95 0 -89;22.4 95 0 -89;22 95 0 -88;22.3 95 0 -88;22.6 95 0 -88;22.6 95 0 -87;22.5 95 0 -87;22.3 95 0 -89;22.3 95 0 -88;22.4 95 0 -95;22.4 95 0 -87;22.7 95 0 -86;22.7 95 0 -87;22.5 95 0 -89;22.8 95 0 -90;23.3 95 0 -88;24.1 95 0 -93;24.3 95 0 -92;24.4 95 0 -92;28.3 85 0 -89;30.1 75 0 -91;30.5 77 29.02 -92;32.8 64 25.32 -92;34.9 62 34.18 -90;36.9 62 46.39 -87;35.5 59 65.47 -92'),
  },
  uci: {
    id: 'uci', name: 'UCI Urban Air Quality', origin: 'UCI Air Quality, Italy 2004',
    sourceUrl: 'https://archive.ics.uci.edu/dataset/360/air+quality',
    cadence: 'Hourly averages, original timestamps provided',
    note: '40 original hourly temperature and relative humidity observations from UCI AirQualityUCI.csv. PT08.S1(CO) metal oxide response is available for inspection, but is NOT an SGP40 VOC index, CO concentration, or calibrated air quality index. Dataset distributed as CC BY 4.0.',
    measured: ['temperature', 'humidity', 'metalOxideResponse'], rows: airRows('10/03/2004 18.00.00 13.6 48.9 1360;10/03/2004 19.00.00 13.3 47.7 1292;10/03/2004 20.00.00 11.9 54 1402;10/03/2004 21.00.00 11 60 1376;10/03/2004 22.00.00 11.2 59.6 1272;10/03/2004 23.00.00 11.2 59.2 1197;11/03/2004 00.00.00 11.3 56.8 1185;11/03/2004 01.00.00 10.7 60 1136;11/03/2004 02.00.00 10.7 59.7 1094;11/03/2004 03.00.00 10.3 60.2 1010;11/03/2004 04.00.00 10.1 60.5 1011;11/03/2004 05.00.00 11 56.2 1066;11/03/2004 06.00.00 10.5 58.1 1052;11/03/2004 07.00.00 10.2 59.6 1144;11/03/2004 08.00.00 10.8 57.4 1333;11/03/2004 09.00.00 10.5 60.6 1351;11/03/2004 10.00.00 10.8 58.4 1233;11/03/2004 11.00.00 10.5 57.9 1179;11/03/2004 12.00.00 9.5 66.8 1236;11/03/2004 13.00.00 8.3 76.4 1286;11/03/2004 14.00.00 8 81.1 1371;11/03/2004 15.00.00 8.3 79.8 1310;11/03/2004 16.00.00 9.7 71.2 1292;11/03/2004 17.00.00 9.8 67.6 1383;11/03/2004 18.00.00 10.3 64.2 1581;11/03/2004 19.00.00 9.7 69.3 1776;11/03/2004 20.00.00 9.6 67.8 1640;11/03/2004 21.00.00 9.1 64 1313;11/03/2004 22.00.00 8.2 63.4 965;11/03/2004 23.00.00 8.2 60.8 913;12/03/2004 00.00.00 8.3 58.5 1080;12/03/2004 01.00.00 7.7 59.7 1044;12/03/2004 02.00.00 7.1 61.8 988;12/03/2004 03.00.00 7 62.3 889;12/03/2004 04.00.00 6.1 65.9 831;12/03/2004 05.00.00 6.3 65 847;12/03/2004 06.00.00 6.8 62.9 927;12/03/2004 07.00.00 6.4 65.1 1091;12/03/2004 08.00.00 7.3 63.1 1587;12/03/2004 09.00.00 9.2 56.2 1545'),
  },
});
export function validateReplayRows(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 10000) throw Error('Replay must contain 1 to 10000 rows.');
  return rows.map((item, i) => {
    const row = { sample: Number(item.sample) || i + 1, recordedTime: String(item.recordedTime || `Record ${i+1}`), rssi: null, voc: null, metalOxideResponse: null };
    for (const [key, range] of Object.entries({temperature:[-40,80],humidity:[0,100],soil:[0,100]})) {
      if (item[key] === null || item[key] === undefined || item[key] === '') { row[key] = null; continue; }
      const val = Number(item[key]);
      if (!Number.isFinite(val) || val < range[0] || val > range[1]) throw Error(`Row ${i+1} has invalid ${key}.`);
      row[key] = val;
    }
    if (row.temperature===null && row.humidity===null && row.soil===null) throw Error(`Row ${i+1} has no sensor observations.`);
    if (item.rssi != null && Number.isFinite(Number(item.rssi))) row.rssi=Number(item.rssi);
    if (item.metalOxideResponse != null && Number.isFinite(Number(item.metalOxideResponse))) row.metalOxideResponse=Number(item.metalOxideResponse);
    return row;
  });
}
export function parseCsvReplay(csv) {
  if (typeof csv !== 'string' || csv.length > 1024*1024) throw Error('CSV must be a text file below 1 MB.');
  const lines = csv.trim().replace(/^\uFEFF/, '').split(/\r?\n/).filter(x=>x.trim());
  if (lines.length < 2) throw Error('CSV needs a header and at least one observation.');
  const headers=lines[0].split(',').map(x=>x.trim().toLowerCase());
  const aliases={temperature:['temperature','temperature_c','temp','t'],humidity:['humidity','relative_humidity','humidity_pct','rh'],soil:['soil','soil_moisture','soil_humidity','moisture'],recordedTime:['timestamp','date','time','recordedtime'],rssi:['rssi']};
  const position=Object.fromEntries(Object.entries(aliases).map(([key, keys])=>[key,headers.findIndex(h=>keys.includes(h))]));
  if (position.temperature<0 && position.humidity<0 && position.soil<0) throw Error('CSV needs a temperature, humidity or soil_moisture column.');
  return validateReplayRows(lines.slice(1).map((line,i)=>{
    const pieces=line.split(',').map(x=>x.trim());
    if (pieces.length !== headers.length) throw Error(`CSV row ${i+2} has the wrong number of columns.`);
    const at=k=>position[k]<0?null:pieces[position[k]];
    return {sample:i+1,recordedTime:at('recordedTime')||`Record ${i+1}`,temperature:at('temperature'),humidity:at('humidity'),soil:at('soil'),rssi:at('rssi')};
  }));
}


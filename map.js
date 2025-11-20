// 用 d3 + MapLibre（完全免费，不需要 token）
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@3.6.1/+esm';

console.log('MapLibre GL JS Loaded:', maplibregl);

// ========== 常量 & URL ==========
const BIKE_LANE_PAINT = {
  'line-color': '#32D400',
  'line-width': 3,
  'line-opacity': 0.6,
};

const BOSTON_BIKE_URL =
  'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson';

const CAMBRIDGE_BIKE_URL =
  'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson';

const BLUEBIKES_STATION_URL =
  'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';

const BLUEBIKES_TRAFFIC_URL =
  'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

// ========== 工具函数：地图坐标 ==========
let map; // 提前声明，让 getCoords 能访问

function getCoords(station) {
  const lon = +(
    station.lon ??
    station.Long ??
    station.Longitude ??
    station.long ??
    station.longitude
  );

  const lat = +(
    station.lat ??
    station.Lat ??
    station.Latitude ??
    station.latitude
  );

  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    console.warn('Invalid coords for station:', station);
    return { cx: -9999, cy: -9999 };
  }

  const point = new maplibregl.LngLat(lon, lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// ========== 工具函数：时间 ==========
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// ========== 工具函数：计算 station traffic ==========
function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id,
  );

  const arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id,
  );

  return stations.map((station) => {
    const id = station.short_name ?? station.Number;

    const arr = arrivals.get(id) ?? 0;
    const dep = departures.get(id) ?? 0;

    station.arrivals = arr;
    station.departures = dep;
    station.totalTraffic = arr + dep;

    return station;
  });
}

// ========== 创建 MapLibre 地图（完全免费底图） ==========
// 使用 MapLibre 官方 demo 的 OSM style，不需要 token
map = new maplibregl.Map({
  container: 'map',
  style: 'https://demotiles.maplibre.org/style.json',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

map.on('load', async () => {
  console.log('Map has loaded!');

  // ---------- 2 条 bike lane ----------
  map.addSource('boston_route', {
    type: 'geojson',
    data: BOSTON_BIKE_URL,
  });

  map.addLayer({
    id: 'boston-bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: BIKE_LANE_PAINT,
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: CAMBRIDGE_BIKE_URL,
  });

  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_route',
    paint: BIKE_LANE_PAINT,
  });

  // ---------- 站点数据 ----------
  let stationsRaw = [];
  try {
    const jsonData = await d3.json(BLUEBIKES_STATION_URL);
    stationsRaw = jsonData.data.stations;
    console.log('Loaded stations (raw length):', stationsRaw.length);
    console.log('One station example:', stationsRaw[0]);
  } catch (error) {
    console.error('Error loading Bluebikes stations:', error);
  }

  if (!stationsRaw.length) {
    console.error('No stations loaded, aborting.');
    return;
  }

  // ---------- 骑行记录 ----------
  let trips = [];
  try {
    trips = await d3.csv(BLUEBIKES_TRAFFIC_URL, (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);
      return trip;
    });
    console.log('Loaded trips length:', trips.length);
    console.log('One trip example:', trips[0]);
  } catch (error) {
    console.error('Error loading Bluebikes trips:', error);
  }

  if (!trips.length) {
    console.error('No trips loaded, aborting.');
    return;
  }

  // ---------- 初始 traffic（全部 trips） ----------
  let stations = computeStationTraffic(stationsRaw, trips);

  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  const stationFlow = d3
    .scaleQuantize()
    .domain([0, 1])
    .range([0, 0.5, 1]);

  function getDepartureRatio(d) {
    if (!d.totalTraffic || d.totalTraffic === 0) {
      return 0.5;
    }
    const raw = d.departures / d.totalTraffic;
    const clamped = Math.max(0, Math.min(1, raw));
    return stationFlow(clamped);
  }

  // 这里假设你在 CSS 里有一个 overlay 的 SVG（和原来一样）
  const svg = d3.select('#map').select('svg');

  let circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name ?? d.Number)
    .enter()
    .append('circle')
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('fill-opacity', 0.6)
    .attr('r', (d) => radiusScale(d.totalTraffic || 0))
    .each(function (d) {
      d3.select(this)
        .append('title')
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
        );
    })
    .style('--departure-ratio', getDepartureRatio);

  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }

  updatePositions();

  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  // ========== 时间 slider ==========
  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  let currentTimeFilter = -1;

  function updateScatterPlot(timeFilter) {
    const filteredTrips =
      timeFilter === -1
        ? trips
        : trips.filter((trip) => {
            const startedMinutes = minutesSinceMidnight(trip.started_at);
            const endedMinutes = minutesSinceMidnight(trip.ended_at);
            return (
              Math.abs(startedMinutes - timeFilter) <= 60 ||
              Math.abs(endedMinutes - timeFilter) <= 60
            );
          });

    const filteredStations = computeStationTraffic(
      stationsRaw,
      filteredTrips,
    );

    const maxTraffic = d3.max(filteredStations, (d) => d.totalTraffic) || 1;

    if (timeFilter === -1) {
      radiusScale.range([0, 25]);
    } else {
      radiusScale.range([3, 50]);
    }
    radiusScale.domain([0, maxTraffic]);

    circles = svg
      .selectAll('circle')
      .data(filteredStations, (d) => d.short_name ?? d.Number)
      .join(
        (enter) =>
          enter
            .append('circle')
            .attr('stroke', 'white')
            .attr('stroke-width', 1)
            .attr('fill-opacity', 0.6)
            .each(function (d) {
              d3.select(this)
                .append('title')
                .text(
                  `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
                );
            }),
        (update) => update,
        (exit) => exit.remove(),
      )
      .attr('r', (d) => radiusScale(d.totalTraffic || 0))
      .style('--departure-ratio', getDepartureRatio);

    updatePositions();
  }

  function updateTimeDisplay() {
    const value = Number(timeSlider.value);
    currentTimeFilter = value;

    if (value === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(value);
      anyTimeLabel.style.display = 'none';
    }

    updateScatterPlot(currentTimeFilter);
  }

  if (timeSlider) {
    timeSlider.addEventListener('input', updateTimeDisplay);
    updateTimeDisplay();
  }
});

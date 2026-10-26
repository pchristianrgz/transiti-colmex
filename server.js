const express = require("express");
const fetch = require("node-fetch");
const GtfsRealtimeBindings = require("gtfs-realtime-bindings");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const GTFS_FEED_URL = "https://romamobilita.it/sites/default/files/rome_rtgtfs_trip_updates_feed.pb";

let feedCache = null;
let lastFetch = 0;

async function getFeed() {
  const now = Date.now();
  if (feedCache && (now - lastFetch < 15000)) {
    return feedCache;
  }
  const response = await fetch(GTFS_FEED_URL);
  if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
  const buffer = await response.arrayBuffer();
  feedCache = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
  lastFetch = now;
  return feedCache;
}

function resolveHeadsign(routeId, stopId, apiHeadsign) {
  if (apiHeadsign && apiHeadsign.trim().length > 0) {
    return apiHeadsign.trim();
  }
  if (routeId.includes("870")) return "Dir. Paola / S. Pietro";
  if (routeId.includes("31")) {
    return stopId === "70572" ? "Dir. Laurentina (Metro B)" : "Dir. P.le Clodio";
  }
  if (routeId.includes("33")) {
    return stopId === "70572" ? "Dir. Monti S. Paolo" : "Dir. Bravetta / Pisana";
  }
  if (routeId.includes("8")) return "Dir. Piazza Venezia";
  return "Linea Urbana";
}

app.use(express.static("public"));

app.get("/api/arrivals", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  const MONITORED_STOPS = [
    { stopId: "70535", allowedRoutes: ["870"], label: "Casaletto / Alessandri" },
    { stopId: "70572", allowedRoutes: ["31", "33"], label: "Colli Portuensi / Monteverde" },
    { stopId: "70525", allowedRoutes: ["8", "8BUS"], label: "Gianicolense / Casaletto" }
  ];

  try {
    const feed = await getFeed();
    const nowUnix = Math.floor(Date.now() / 1000);
    const results = [];

    for (const monitor of MONITORED_STOPS) {
      for (const entity of feed.entity) {
        if (!entity.tripUpdate) continue;

        const routeId = (entity.tripUpdate.trip.routeId || "").trim().toUpperCase();
        const routeMatch = monitor.allowedRoutes.some(r => routeId.includes(r));
        if (!routeMatch) continue;

        const rawHeadsign = entity.tripUpdate.trip.tripHeadsign || "";
        const destination = resolveHeadsign(routeId, monitor.stopId, rawHeadsign);

        const stopUpdates = entity.tripUpdate.stopTimeUpdate || [];
        for (const stop of stopUpdates) {
          if (stop.stopId === monitor.stopId) {
            const arrTime = (stop.arrival && stop.arrival.time)
              ? (stop.arrival.time.low || stop.arrival.time)
              : null;

            if (arrTime) {
              const diffMinutes = Math.round((arrTime - nowUnix) / 60);
              if (diffMinutes >= 0 && diffMinutes <= 60) {
                results.push({
                  route: routeId,
                  stopName: monitor.label,
                  destination: destination,
                  minutes: diffMinutes,
                  timestamp: arrTime
                });
              }
            }
          }
        }
      }
    }

    results.sort((a, b) => a.minutes - b.minutes);
    return res.json(results);
  } catch (err) {
    console.error("Error al procesar feed:", err);
    return res.status(500).json({ error: "Error consultando datos de transporte" });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
});
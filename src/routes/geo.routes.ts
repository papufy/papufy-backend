import { Router } from "express";
import { badRequest } from "../utils/errors";

const geoRoutes = Router();

geoRoutes.get("/reverse", async (req, res, next) => {
  try {
    const latRaw = req.query.lat;
    const lonRaw = req.query.lon;
    const lat = Number(latRaw);
    const lon = Number(lonRaw);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw badRequest("Latitude/longitude inválidas.");
    }

    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      format: "json",
      "accept-language": "pt-BR",
      addressdetails: "1",
    });

    const upstream = await fetch(
      `https://nominatim.openstreetmap.org/reverse?${params.toString()}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "Papufy/1.0 (https://papufy.com; contato@papufy.com)",
        },
      }
    );

    if (!upstream.ok) {
      res.status(502).json({ error: "Falha ao consultar geocodificação." });
      return;
    }

    const data = (await upstream.json()) as {
      address?: Record<string, string>;
    };

    res.json(data);
  } catch (err) {
    next(err);
  }
});

export { geoRoutes };

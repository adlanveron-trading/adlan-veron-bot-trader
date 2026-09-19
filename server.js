/* =========================================================
   Adlan Veron XAU/USD Trading Prediction Tool - Backend
   =========================================================
   Kenapa perlu backend, bukan langsung dari browser?
   - API key (Anthropic/OpenAI/Gemini/TwelveData) TIDAK BOLEH
     ditaruh di JavaScript frontend, karena bisa dicuri siapa
     saja lewat "View Source". Backend inilah yang menyimpan
     key dengan aman di server (.env) dan menjadi perantara.
========================================================= */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false })); // CSP diatur manual jika perlu
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname))); // serve index.html, style.css, app.js

// Batasi request supaya tidak disalahgunakan / boros biaya API
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20, // maksimal 20 request/menit per IP
  message: { error: "Terlalu banyak permintaan, coba lagi sebentar lagi." },
});
app.use("/api/", limiter);

/* ---------------- MARKET DATA PROXY (TwelveData) ---------------- */
app.get("/api/market", async (req, res) => {
  try {
    const { symbol = "XAU/USD", interval = "1h", outputsize = 150 } = req.query;
    const apiKey = process.env.TWELVEDATA_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "TWELVEDATA_API_KEY belum diatur di .env" });
    }

    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(
      symbol
    )}&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey}`;

    const r = await fetch(url);
    const json = await r.json();

    if (json.status === "error") {
      return res.status(400).json({ error: json.message || "Gagal mengambil data" });
    }

    // TwelveData mengembalikan data terbaru dulu -> kita balik urutannya jadi lama->baru
    const candles = (json.values || [])
      .map((v) => ({
        time: v.datetime,
        open: parseFloat(v.open),
        high: parseFloat(v.high),
        low: parseFloat(v.low),
        close: parseFloat(v.close),
        volume: v.volume ? parseFloat(v.volume) : null,
      }))
      .reverse();

    res.json({ candles });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error saat mengambil data market" });
  }
});

/* ---------------- CHAT AI PROXY (Claude / OpenAI / Gemini) ---------------- */
const SYSTEM_PROMPT = `Anda adalah asisten riset pasar emas XAU/USD yang berpengalaman.
Tugas Anda:
- Menjawab pertanyaan seputar kondisi pasar XAU/USD, analisa teknikal, dan strategi trading secara edukatif.
- Selalu bersikap objektif, jelaskan alasan/reasoning teknikal (RSI, MACD, support/resistance, sentimen pasar), jangan hanya menjawab "beli" atau "jual" tanpa penjelasan.
- SELALU ingatkan bahwa ini bukan nasihat keuangan resmi dan trading emas/forex berisiko tinggi.
- Jangan pernah menjanjikan profit pasti atau akurasi 100%.
- Jawab dalam Bahasa Indonesia yang mudah dipahami trader pemula maupun berpengalaman.`;

app.post("/api/chat", async (req, res) => {
  try {
    const { provider = "gemini", messages = [] } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages kosong" });
    }

    let reply;
    if (provider === "gemini") {
      reply = await callGemini(messages);
    } else if (provider === "meta") {
      reply = await callMeta(messages);
    } else {
      return res.status(400).json({ error: "Provider tidak dikenal" });
    }

    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Gagal memproses chat" });
  }
});

async function callMeta(messages) {
  // Meta AI (meta.ai) adalah aplikasi web, bukan API. Untuk menjalankan model
  // Llama (model di balik Meta AI) secara gratis tanpa kartu kredit, kita
  // pakai Groq — penyedia hosting resmi untuk model open-source seperti Llama.
  // Catatan: llama-3.1-8b-instant dipakai karena otomatis bisa diakses semua
  // akun Groq gratis baru (model 70B kadang butuh verifikasi tambahan).
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY belum diatur di .env (untuk fitur Meta AI/Llama)");

  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      max_tokens: 700,
    }),
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

async function callGemini(messages) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY belum diatur di .env");

  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
      }),
    }
  );
  const data = await r.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates[0].content.parts.map((p) => p.text).join("\n");
}

app.listen(PORT, () => {
  console.log(`Adlan Veron XAU/USD server berjalan di http://localhost:${PORT}`);
});

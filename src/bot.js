require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');

const {
  TELEGRAM_BOT_TOKEN,
  GOOGLE_SCRIPT_URL,
  ALLOWED_CHAT_ID,
  TIMEZONE = 'Asia/Jakarta'
} = process.env;

validateEnv();

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

bot.onText(/^\/start$/, (message) => {
  bot.sendMessage(
    message.chat.id,
    [
      'Bot rekap laporan keuangan siap dipakai.',
      '',
      'Format cepat:',
      'masuk 50000 Gaji freelance',
      'keluar 15000 Makan siang',
      '',
      'Format dengan tanggal:',
      '/rekap 2026-06-19 keluar 15000 Beli bensin',
      '',
      'Cek saldo:',
      '/tabungan',
      '',
      'Kolom spreadsheet: tanggal, jenis, jumlah, keterangan'
    ].join('\n')
  );
});

bot.onText(/^\/format$/, (message) => {
  bot.sendMessage(
    message.chat.id,
    [
      'Contoh input:',
      'masuk 50000 Gaji freelance',
      'keluar 15000 Makan siang',
      '/rekap 2026-06-19 masuk 250000 Penjualan produk',
      '',
      'Jenis yang diterima: masuk dan keluar.'
    ].join('\n')
  );
});

bot.onText(/^\/tabungan$/, async (message) => {
  if (!isAllowedChat(message.chat.id)) {
    await bot.sendMessage(message.chat.id, 'Chat ini belum diizinkan untuk melihat rekap.');
    return;
  }

  try {
    const result = await getSummary();
    await bot.sendMessage(message.chat.id, buildSummaryMessage(result.summary).join('\n'));
  } catch (error) {
    console.error(error);
    await bot.sendMessage(message.chat.id, 'Gagal mengambil data tabungan. Cek Apps Script dan deploy versi terbaru.');
  }
});

bot.on('message', async (message) => {
  if (!message.text || message.text.startsWith('/start') || message.text.startsWith('/format') || message.text.startsWith('/tabungan')) {
    return;
  }

  if (!isAllowedChat(message.chat.id)) {
    await bot.sendMessage(message.chat.id, 'Chat ini belum diizinkan untuk mengisi rekap.');
    return;
  }

  const parsed = parseFinancialMessage(message.text);
  if (!parsed) {
    await bot.sendMessage(
      message.chat.id,
      [
        'Format belum cocok.',
        '',
        'Kirim seperti ini:',
        'masuk 50000 Gaji freelance',
        'keluar 15000 Makan siang',
        '/rekap 2026-06-19 keluar 15000 Beli bensin'
      ].join('\n')
    );
    return;
  }

  try {
    const result = await appendRow(parsed);

    await bot.sendMessage(
      message.chat.id,
      buildSuccessMessage(parsed, result.summary).join('\n')
    );
  } catch (error) {
    console.error(error);
    await bot.sendMessage(message.chat.id, 'Gagal menyimpan data. Cek GOOGLE_SCRIPT_URL dan deployment Apps Script.');
  }
});

bot.on('polling_error', (error) => {
  console.error('Telegram polling error:', error.message);
});

function buildSuccessMessage(data, summary) {
  const lines = [
    'Berhasil disimpan ke Google Spreadsheet.',
    `Tanggal: ${data.tanggal}`,
    `Jenis: ${data.jenis}`,
    `Jumlah: ${formatRupiah(data.jumlah)}`,
    `Keterangan: ${data.keterangan}`
  ];

  if (summary) {
    lines.push(
      '',
      'Rekap sekarang:',
      `Total masuk: ${formatRupiah(summary.totalMasuk)}`,
      `Total keluar: ${formatRupiah(summary.totalKeluar)}`,
      `Saldo: ${formatRupiah(summary.saldo)}`
    );
  }

  return lines;
}

function buildSummaryMessage(summary) {
  if (!summary) {
    return [
      'Rekap belum tersedia.',
      'Pastikan Apps Script sudah diganti ke versi terbaru dan deploy New version.'
    ];
  }

  return [
    'Tabungan sekarang:',
    `Total masuk: ${formatRupiah(summary.totalMasuk)}`,
    `Total keluar: ${formatRupiah(summary.totalKeluar)}`,
    `Saldo: ${formatRupiah(summary.saldo)}`
  ];
}

function validateEnv() {
  const required = [
    'TELEGRAM_BOT_TOKEN',
    'GOOGLE_SCRIPT_URL'
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Env belum lengkap: ${missing.join(', ')}`);
  }
}

function isAllowedChat(chatId) {
  if (!ALLOWED_CHAT_ID) {
    return true;
  }

  return String(chatId) === String(ALLOWED_CHAT_ID);
}

function parseFinancialMessage(text) {
  const normalized = text.trim().replace(/\s+/g, ' ');
  const input = normalized.replace(/^\/rekap\s+/i, '');
  const parts = input.split(' ');

  let tanggal = getToday();
  let jenisIndex = 0;

  if (isIsoDate(parts[0])) {
    tanggal = parts[0];
    jenisIndex = 1;
  }

  const jenis = normalizeJenis(parts[jenisIndex]);
  const jumlahText = parts[jenisIndex + 1];
  const keterangan = parts.slice(jenisIndex + 2).join(' ').trim();

  if (!jenis || !jumlahText || !keterangan) {
    return null;
  }

  const jumlah = parseJumlah(jumlahText);
  if (!Number.isFinite(jumlah) || jumlah <= 0) {
    return null;
  }

  return {
    tanggal,
    jenis,
    jumlah,
    keterangan
  };
}

function normalizeJenis(value = '') {
  const jenis = value.toLowerCase();
  const pemasukan = ['pemasukan', 'masuk', 'income', 'debit'];
  const pengeluaran = ['pengeluaran', 'keluar', 'expense', 'kredit'];

  if (pemasukan.includes(jenis)) {
    return 'masuk';
  }

  if (pengeluaran.includes(jenis)) {
    return 'keluar';
  }

  return null;
}

function parseJumlah(value) {
  const cleaned = value.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  return Number(cleaned);
}

function isIsoDate(value = '') {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

async function appendRow(data) {
  const response = await fetch(GOOGLE_SCRIPT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    throw new Error(`Apps Script error: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.message || 'Apps Script menolak data.');
  }

  return result;
}

async function getSummary() {
  const url = new URL(GOOGLE_SCRIPT_URL);
  url.searchParams.set('action', 'summary');

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Apps Script error: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.message || 'Apps Script gagal mengambil summary.');
  }

  return result;
}

function formatRupiah(value) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(value);
}

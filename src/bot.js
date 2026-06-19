require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');

const {
  TELEGRAM_BOT_TOKEN,
  GOOGLE_SCRIPT_URL,
  OCR_SPACE_API_KEY,
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
      'Foto struk:',
      'Kirim foto dengan caption: keluar 15000 Makan siang',
      'Atau isi OCR_SPACE_API_KEY agar bot bisa baca nominal dari foto.',
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
      'Contoh foto:',
      'Kirim foto struk dengan caption: keluar 15000 Belanja',
      'Kalau OCR aktif, foto tanpa caption akan dicatat sebagai keluar.',
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

bot.on('photo', async (message) => {
  if (!isAllowedChat(message.chat.id)) {
    await bot.sendMessage(message.chat.id, 'Chat ini belum diizinkan untuk mengisi rekap.');
    return;
  }

  try {
    let parsed = null;

    if (message.caption) {
      parsed = parseFinancialMessage(message.caption);
    }

    if (!parsed) {
      if (!OCR_SPACE_API_KEY) {
        await bot.sendMessage(
          message.chat.id,
          [
            'Foto diterima, tapi OCR belum aktif.',
            'Pakai caption dulu seperti ini:',
            'keluar 15000 Makan siang',
            '',
            'Kalau mau otomatis baca nominal dari foto, isi OCR_SPACE_API_KEY di .env.'
          ].join('\n')
        );
        return;
      }

      await bot.sendMessage(message.chat.id, 'Foto diterima. Sedang membaca nominal dari gambar...');
      parsed = await parseExpenseFromPhoto(message);
    }

    const result = await appendRow(parsed);
    await bot.sendMessage(
      message.chat.id,
      buildSuccessMessage(parsed, result.summary).join('\n')
    );
  } catch (error) {
    console.error(error);
    await bot.sendMessage(message.chat.id, 'Gagal membaca atau menyimpan foto. Coba kirim foto lebih jelas atau pakai caption: keluar 15000 keterangan.');
  }
});

bot.on('message', async (message) => {
  if (!message.text || message.photo || message.text.startsWith('/start') || message.text.startsWith('/format') || message.text.startsWith('/tabungan')) {
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

async function parseExpenseFromPhoto(message) {
  const text = await readTextFromPhoto(message);
  const jumlah = extractLargestAmount(text);

  if (!jumlah) {
    throw new Error('Nominal tidak ditemukan dari hasil OCR.');
  }

  return {
    tanggal: getToday(),
    jenis: 'keluar',
    jumlah,
    keterangan: 'Foto pengeluaran'
  };
}

async function readTextFromPhoto(message) {
  const photo = message.photo[message.photo.length - 1];
  const fileUrl = await bot.getFileLink(photo.file_id);
  const imageResponse = await fetch(fileUrl);

  if (!imageResponse.ok) {
    throw new Error(`Gagal mengambil foto Telegram: ${imageResponse.status}`);
  }

  const imageBuffer = await imageResponse.arrayBuffer();
  const imageBlob = new Blob([imageBuffer], {
    type: imageResponse.headers.get('content-type') || 'image/jpeg'
  });

  const formData = new FormData();
  formData.append('apikey', OCR_SPACE_API_KEY);
  formData.append('language', 'eng');
  formData.append('isOverlayRequired', 'false');
  formData.append('scale', 'true');
  formData.append('OCREngine', '2');
  formData.append('file', imageBlob, 'telegram-photo.jpg');

  const ocrResponse = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    body: formData
  });

  if (!ocrResponse.ok) {
    throw new Error(`OCR gagal: ${ocrResponse.status}`);
  }

  const result = await ocrResponse.json();
  if (result.IsErroredOnProcessing) {
    throw new Error(result.ErrorMessage || 'OCR gagal memproses gambar.');
  }

  return (result.ParsedResults || [])
    .map((item) => item.ParsedText)
    .filter(Boolean)
    .join('\n');
}

function extractLargestAmount(text) {
  const matches = text.match(/(?:rp\s*)?[\d]{1,3}(?:[.,\s]\d{3})+(?:,\d{1,2})?|(?:rp\s*)?\d{4,}/gi) || [];
  const numbers = matches
    .map(parseJumlah)
    .filter((value) => Number.isFinite(value) && value > 0);

  if (numbers.length === 0) {
    return null;
  }

  return Math.max(...numbers);
}

function formatRupiah(value) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(value);
}

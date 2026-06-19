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

  if (data.receipt) {
    lines.push('', ...buildReceiptLines(data.receipt));
  }

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

function buildReceiptLines(receipt) {
  const lines = ['Detail nota:'];

  receipt.items.slice(0, 10).forEach((item) => {
    const qty = item.qty ? `${item.qty}x ` : '';
    const price = item.price ? `${formatRupiah(item.price)} ` : '';
    lines.push(`${qty}${price}${item.name} ${formatRupiah(item.amount)}`);
  });

  if (receipt.items.length > 10) {
    lines.push(`...dan ${receipt.items.length - 10} item lain`);
  }

  lines.push(`Total: ${formatRupiah(receipt.total)}`);

  if (receipt.cash) {
    lines.push(`Cash/Tunai: ${formatRupiah(receipt.cash)}`);
  }

  if (receipt.change) {
    lines.push(`Kembalian: ${formatRupiah(receipt.change)}`);
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
  const raw = value.replace(/[^\d,.-]/g, '');
  const hasDot = raw.includes('.');
  const hasComma = raw.includes(',');

  if (hasDot && hasComma) {
    const lastDot = raw.lastIndexOf('.');
    const lastComma = raw.lastIndexOf(',');
    const decimalSeparator = lastDot > lastComma ? '.' : ',';
    const thousandsSeparator = decimalSeparator === '.' ? ',' : '.';
    const normalized = raw
      .replace(new RegExp(`\\${thousandsSeparator}`, 'g'), '')
      .replace(decimalSeparator, '.');
    return Number(normalized);
  }

  if (hasComma) {
    const parts = raw.split(',');
    const lastPart = parts[parts.length - 1];
    const commaIsThousands = lastPart.length === 3 && parts.length <= 3;
    return Number(commaIsThousands ? raw.replace(/,/g, '') : raw.replace(',', '.'));
  }

  if (hasDot) {
    const parts = raw.split('.');
    const lastPart = parts[parts.length - 1];
    const dotIsThousands = lastPart.length === 3 && parts.length <= 3;
    return Number(dotIsThousands ? raw.replace(/\./g, '') : raw);
  }

  const cleaned = raw;
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
  const receipt = parseReceiptText(text);
  const jumlah = receipt.total;

  if (!jumlah) {
    throw new Error('Nominal tidak ditemukan dari hasil OCR.');
  }

  return {
    tanggal: getToday(),
    jenis: 'keluar',
    jumlah,
    keterangan: buildReceiptDescription(receipt),
    receipt
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

function parseReceiptText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const items = extractReceiptItems(lines);
  const labels = extractReceiptLabels(lines);
  const total = labels.total || inferTotalFromItems(items) || extractReceiptTotal(lines);

  return {
    items,
    total,
    cash: labels.cash,
    change: labels.change
  };
}

function extractReceiptItems(lines) {
  const ignored = /total|subtotal|sub total|cash|tunai|bayar|change|kembali|pajak|tax|ppn|diskon|discount|tanggal|date|jam|time|nota|struk|invoice/i;
  const items = [];

  lines.forEach((line) => {
    if (ignored.test(line)) {
      return;
    }

    const item = parseReceiptItemLine(line);
    if (item) {
      items.push(item);
    }
  });

  return items;
}

function parseReceiptItemLine(line) {
  const normalized = line.replace(/\s+/g, ' ').trim();

  const qtyFirst = normalized.match(/^(\d+)\s*x?\s+([\d.,]+)\s+(.+?)\s+(?:rp\s*)?([\d.,]+)$/i);
  if (qtyFirst) {
    return {
      qty: Number(qtyFirst[1]),
      price: parseJumlah(qtyFirst[2]),
      name: cleanItemName(qtyFirst[3]),
      amount: parseJumlah(qtyFirst[4])
    };
  }

  const nameFirst = normalized.match(/^(.+?)\s+(\d+)\s*x?\s+([\d.,]+)\s+(?:rp\s*)?([\d.,]+)$/i);
  if (nameFirst) {
    return {
      qty: Number(nameFirst[2]),
      price: parseJumlah(nameFirst[3]),
      name: cleanItemName(nameFirst[1]),
      amount: parseJumlah(nameFirst[4])
    };
  }

  const simple = normalized.match(/^(.+?)\s+(?:rp\s*)?([\d.,]+)$/i);
  if (simple && /[a-z]/i.test(simple[1])) {
    const amount = parseJumlah(simple[2]);

    if (amount >= 1000) {
      return {
        qty: null,
        price: null,
        name: cleanItemName(simple[1]),
        amount
      };
    }
  }

  return null;
}

function extractReceiptLabels(lines) {
  const labels = {
    total: null,
    cash: null,
    change: null
  };

  lines.forEach((line) => {
    const lowerLine = line.toLowerCase();
    const amounts = extractAmounts(line);
    const amount = amounts[amounts.length - 1];

    if (!amount) {
      return;
    }

    if (/(grand\s*total|total\s*(bayar|belanja|tagihan)?|jumlah\s*bayar|amount\s*due)/i.test(lowerLine) && !/(subtotal|sub\s*total)/i.test(lowerLine)) {
      labels.total = amount;
      return;
    }

    if (/(cash|tunai|uang\s*bayar|bayar)/i.test(lowerLine) && !/(total|jumlah)/i.test(lowerLine)) {
      labels.cash = amount;
      return;
    }

    if (/(change|kembali|kembalian)/i.test(lowerLine)) {
      labels.change = amount;
    }
  });

  return labels;
}

function inferTotalFromItems(items) {
  if (items.length === 0) {
    return null;
  }

  return items.reduce((total, item) => total + item.amount, 0);
}

function extractReceiptTotal(lines) {
  const totalKeywords = [
    'grand total',
    'total bayar',
    'total belanja',
    'total tagihan',
    'jumlah bayar',
    'amount due',
    'total'
  ];

  const ignoredKeywords = [
    'subtotal',
    'sub total',
    'diskon',
    'discount',
    'pajak',
    'tax',
    'ppn',
    'kembali',
    'change',
    'tunai',
    'cash',
    'tanggal',
    'date',
    'jam',
    'time',
    'no.',
    'nota',
    'struk'
  ];

  const scoredAmounts = [];

  lines.forEach((line, index) => {
    const lowerLine = line.toLowerCase();
    const amounts = extractAmounts(line);

    amounts.forEach((amount) => {
      let score = 0;

      if (totalKeywords.some((keyword) => lowerLine.includes(keyword))) {
        score += 100;
      }

      if (ignoredKeywords.some((keyword) => lowerLine.includes(keyword))) {
        score -= 50;
      }

      score += Math.min(index, 30);
      score += Math.min(amount / 100000, 20);

      scoredAmounts.push({ amount, score });
    });
  });

  if (scoredAmounts.length === 0) {
    return null;
  }

  scoredAmounts.sort((a, b) => b.score - a.score || b.amount - a.amount);
  return scoredAmounts[0].amount;
}

function buildReceiptDescription(receipt) {
  if (receipt.items.length === 0) {
    return 'Foto pengeluaran';
  }

  const names = receipt.items
    .slice(0, 3)
    .map((item) => item.name)
    .join(', ');

  const suffix = receipt.items.length > 3 ? ` +${receipt.items.length - 3} item` : '';
  return `Foto: ${names}${suffix}`;
}

function cleanItemName(name) {
  return name
    .replace(/\s+/g, ' ')
    .replace(/rp$/i, '')
    .trim();
}

function extractAmounts(text) {
  const matches = text.match(/(?:rp\s*)?[\d]{1,3}(?:[.,\s]\d{3})+(?:,\d{1,2})?|(?:rp\s*)?\d{4,}/gi) || [];

  return matches
    .map(parseJumlah)
    .filter((value) => Number.isFinite(value) && value > 0);
}

function formatRupiah(value) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(value);
}

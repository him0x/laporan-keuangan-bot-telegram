# Bot Rekap Laporan Keuangan Telegram ke Google Spreadsheet

Project ini membuat bot Telegram untuk mencatat laporan keuangan ke Google Spreadsheet lewat Google Apps Script.

Kolom spreadsheet:

```text
tanggal | jenis | jumlah | keterangan
```

## Cara Pakai

1. Install dependency:

```bash
npm install
```

2. Salin file env:

```bash
copy .env.example .env
```

3. Isi `.env`:

```env
TELEGRAM_BOT_TOKEN=token_dari_botfather
GOOGLE_SCRIPT_URL=https://script.google.com/macros/s/xxxx/exec
OCR_SPACE_API_KEY=
```

4. Buat Google Apps Script di spreadsheet, lalu deploy sebagai Web App.

Kode Apps Script:

```javascript
function doGet(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sheet1');
  const summary = updateSummary(sheet);

  return ContentService
    .createTextOutput(JSON.stringify({
      success: true,
      message: 'Apps Script aktif. Data dikirim lewat bot Telegram.',
      summary: summary
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sheet1');
  const data = JSON.parse(e.postData.contents);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['tanggal', 'jenis', 'jumlah', 'keterangan']);
  }

  sheet.appendRow([
    data.tanggal,
    data.jenis,
    data.jumlah,
    data.keterangan
  ]);

  const summary = updateSummary(sheet);

  return ContentService
    .createTextOutput(JSON.stringify({
      success: true,
      summary: summary
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

function updateSummary(sheet) {
  const lastRow = sheet.getLastRow();
  const rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 4).getValues() : [];

  let totalMasuk = 0;
  let totalKeluar = 0;

  rows.forEach(function(row) {
    const jenis = String(row[1]).toLowerCase();
    const jumlah = Number(row[2]) || 0;

    if (jenis === 'masuk') {
      totalMasuk += jumlah;
    }

    if (jenis === 'keluar') {
      totalKeluar += jumlah;
    }
  });

  const saldo = totalMasuk - totalKeluar;

  sheet.getRange('F1:G4').setValues([
    ['rekap', 'jumlah'],
    ['total masuk', totalMasuk],
    ['total keluar', totalKeluar],
    ['saldo', saldo]
  ]);

  return {
    totalMasuk: totalMasuk,
    totalKeluar: totalKeluar,
    saldo: saldo
  };
}
```

Saat deploy:

```text
Execute as: Me
Who has access: Anyone
```

5. Jalankan bot:

```bash
npm start
```

## Format Chat Telegram

Tanpa tanggal, bot memakai tanggal hari ini:

```text
masuk 50000 Gaji freelance
keluar 15000 Makan siang
```

Dengan tanggal:

```text
/rekap 2026-06-19 keluar 15000 Beli bensin
```

Setelah data tersimpan, bot langsung membalas total `masuk`, total `keluar`, dan `saldo`. Spreadsheet juga otomatis mengisi rekap realtime di kolom `F:G`.

Cek tabungan kapan saja:

```text
/tabungan
```

## Input dari Foto

Cara paling simpel, kirim foto struk dengan caption:

```text
keluar 15000 Makan siang
```

Bot akan menyimpan caption itu sebagai transaksi `keluar`.

Kalau ingin bot membaca nominal otomatis dari foto, isi `OCR_SPACE_API_KEY` di `.env`.

```env
OCR_SPACE_API_KEY=api_key_ocr_space
```

Jika foto dikirim tanpa caption dan OCR aktif, bot akan:

```text
1. Membaca teks dari gambar
2. Mencari baris total/jumlah bayar/grand total
3. Menyimpan sebagai jenis keluar
4. Menampilkan detail item, cash/tunai, dan kembalian jika terbaca
```

Contoh hasil baca nota:

```text
Detail nota:
1x Rp45.000 sate kambing Rp45.000
1x Rp45.000 sate lembu Rp45.000
Total: Rp337.000
Cash/Tunai: Rp350.000
Kembalian: Rp13.000
```

Yang mengurangi saldo adalah `Total`, bukan `Cash/Tunai` dan bukan `Kembalian`.

Catatan: hasil OCR tergantung kualitas foto. Kalau struk buram, miring, atau nominal tidak jelas, lebih aman kirim foto dengan caption.

Jenis yang diterima:

```text
masuk
keluar
```

## Membatasi Chat Telegram

Isi `ALLOWED_CHAT_ID` di `.env` kalau bot hanya boleh menerima input dari satu chat.

```env
ALLOWED_CHAT_ID=123456789
```

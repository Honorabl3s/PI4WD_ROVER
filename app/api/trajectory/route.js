import fs from 'fs';
import path from 'path';

// File JSON akan disimpan di root direktori proyek Next.js
const filePath = path.join(process.cwd(), 'perjalanan.json');

// Menerima data dari Tombol Y (Save)
export async function POST(req) {
  try {
    const data = await req.json();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return Response.json({ success: true, message: 'Data perjalanan berhasil disimpan!' });
  } catch (error) {
    return Response.json({ success: false, error: 'Gagal menyimpan data' }, { status: 500 });
  }
}

// Membaca data untuk Tombol A & X (Playback)
export async function GET() {
  try {
    if (!fs.existsSync(filePath)) {
      return Response.json([]); // Kembalikan array kosong jika belum ada rekaman
    }
    const fileData = fs.readFileSync(filePath, 'utf-8');
    return Response.json(JSON.parse(fileData));
  } catch (error) {
    return Response.json({ success: false, error: 'Gagal membaca data' }, { status: 500 });
  }
}
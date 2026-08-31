import type { NextConfig } from "next";

const nextConfig = {
  output: 'export', // <-- Ini yang mengubah web menjadi HTML statis
  images: {
    unoptimized: true, // <-- Wajib ditambahkan agar gambar tidak error saat diexport
  },
  // ... (biarkan konfigurasi lain jika ada)
};

export default nextConfig;

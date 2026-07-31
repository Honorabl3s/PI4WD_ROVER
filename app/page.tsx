export default function Home() {
  const streamUrl = "http://172.17.19.107:5000/video_feed";

  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-zinc-950 text-white p-4">
      {/* Pastikan tag h1 ini utuh */}
      <h1 className="text-3xl font-bold text-emerald-400 mb-6">Robot FPV Dashboard</h1>
      
      <div className="border-4 border-emerald-400 rounded-xl overflow-hidden shadow-[0_0_30px_rgba(52,211,153,0.3)]">
        <img 
          src={streamUrl} 
          alt="Live Camera Feed" 
          className="w-full max-w-3xl object-cover"
        />
      </div>

      {/* Pastikan tag p ini utuh */}
      <p className="mt-8 text-zinc-400 animate-pulse">Menunggu koneksi Joystick...</p>
    </main>
  );
}
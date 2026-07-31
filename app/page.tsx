'use client';

import { useState, useEffect } from 'react';

export default function RobotDashboard() {
  const streamUrl = 'http://172.17.19.107:8080/stream';

  const [gamepadStatus, setGamepadStatus] = useState("Menunggu pemindaian...");
  const [steering, setSteering] = useState({ x: 0, y: 0 });

  // Fungsi untuk memaksa baca secara manual saat tombol diklik
  const forceScanGamepad = () => {
    if (typeof navigator !== "undefined" && navigator.getGamepads) {
      const gamepads = navigator.getGamepads();
      let activeGp = null;

      for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i] !== null) {
          activeGp = gamepads[i];
          break;
        }
      }

      if (activeGp) {
        setGamepadStatus(`🟢 SUKSES DITEMUKAN: ${activeGp.id.substring(0, 20)}`);
      } else {
        setGamepadStatus("🔴 TETAP KOSONG. Pastikan URL adalah localhost:3000!");
        alert("Gamepad tidak terdeteksi oleh kode. Pastikan kamu membuka web via http://localhost:3000");
      }
    }
  };

  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof navigator !== "undefined" && navigator.getGamepads) {
        const gamepads = navigator.getGamepads();
        let activeGp = null;
        for (let i = 0; i < gamepads.length; i++) {
          if (gamepads[i] !== null) {
            activeGp = gamepads[i];
            break;
          }
        }

        if (activeGp) {
          setGamepadStatus(`🟢 TERHUBUNG: ${activeGp.id.substring(0, 20)}...`);
          
          const rawX = activeGp.axes[0];
          const rawY = activeGp.axes[1];
          
          const x = Math.abs(rawX) > 0.15 ? Number(rawX.toFixed(2)) : 0;
          const y = Math.abs(rawY) > 0.15 ? Number(rawY.toFixed(2)) : 0;

          setSteering({ x, y });
        }
      }
    }, 100);

    return () => clearInterval(interval);
  }, []);

  return (
    <main className="min-h-screen bg-gray-900 text-white p-8 font-sans">
      <div className="max-w-5xl mx-auto">
        <header className="mb-8 border-b border-gray-700 pb-4 flex justify-between items-center">
          <h1 className="text-3xl font-bold text-emerald-400">Robot Vision Control</h1>
          <button 
            onClick={forceScanGamepad}
            className="bg-emerald-500 hover:bg-emerald-400 text-gray-900 font-bold py-2 px-6 rounded shadow-lg transition-transform active:scale-95"
          >
            🕹️ Pindai Gamepad
          </button>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-gray-800 rounded-xl p-4 border border-gray-700 shadow-xl">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
              <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse"></span>
              Live Feed
            </h2>
            <div className="aspect-video bg-black rounded-lg overflow-hidden flex items-center justify-center border border-gray-900">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={streamUrl} alt="Robot view" className="w-full h-full object-cover" />
            </div>
          </div>

          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 shadow-xl flex flex-col">
            <h2 className="text-lg font-semibold mb-4 border-b border-gray-700 pb-2">
              XBOX Controller
            </h2>
            
            <div className="flex-1 flex flex-col justify-center gap-6">
              <div className="bg-gray-900 p-3 rounded border border-gray-700 text-sm font-mono text-center">
                {gamepadStatus}
              </div>

              <div className="bg-gray-900 p-4 rounded-lg flex flex-col items-center gap-4 border border-gray-700">
                <div className="text-xs text-gray-400 text-center mb-2">Left Analog Stick</div>
                <div className="w-24 h-24 bg-gray-800 rounded-full border-2 border-gray-600 relative">
                  <div 
                    className="w-6 h-6 bg-emerald-400 rounded-full absolute shadow-[0_0_10px_rgba(52,211,153,0.5)] transition-transform duration-75"
                    style={{
                      top: '50%',
                      left: '50%',
                      transform: `translate(calc(-50% + ${steering.x * 40}px), calc(-50% + ${steering.y * 40}px))`
                    }}
                  ></div>
                </div>
                <div className="font-mono text-sm mt-2 flex flex-col items-center text-emerald-400">
                  <span>X: {steering.x}</span>
                  <span>Y: {steering.y}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
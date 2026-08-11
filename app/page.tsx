'use client';

import { useState, useEffect, useRef } from 'react';

export default function RobotDashboard() {
  const PI_IP = '172.17.19.107'; 
  const streamUrl = `http://${PI_IP}:8080/stream`;

  const [controlMode, setControlMode] = useState('gamepad');
  const [gamepadStatus, setGamepadStatus] = useState("Menunggu Gamepad...");
  const [steering, setSteering] = useState({ x: 0, y: 0 });
  
  const wsRef = useRef<any>(null);
  const keysRef = useRef({ up: false, down: false, left: false, right: false });

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
      if (activeGp) setGamepadStatus(`🟢 TERHUBUNG: ${activeGp.id.substring(0, 15)}...`);
    }
  };

  useEffect(() => {
    const ws = new WebSocket(`ws://${PI_IP}:8765`);
    ws.onopen = () => console.log("WebSocket Terhubung ke Pi!");
    ws.onclose = () => console.log("WebSocket Terputus.");
    wsRef.current = ws;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (['ArrowUp', 'w', 'W'].includes(e.key)) keysRef.current.up = true;
      if (['ArrowDown', 's', 'S'].includes(e.key)) keysRef.current.down = true;
      if (['ArrowLeft', 'a', 'A'].includes(e.key)) keysRef.current.left = true;
      if (['ArrowRight', 'd', 'D'].includes(e.key)) keysRef.current.right = true;
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (['ArrowUp', 'w', 'W'].includes(e.key)) keysRef.current.up = false;
      if (['ArrowDown', 's', 'S'].includes(e.key)) keysRef.current.down = false;
      if (['ArrowLeft', 'a', 'A'].includes(e.key)) keysRef.current.left = false;
      if (['ArrowRight', 'd', 'D'].includes(e.key)) keysRef.current.right = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    const interval = setInterval(() => {
      let currentX = 0;
      let currentY = 0;

      if (controlMode === 'gamepad') {
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
            const rawX = activeGp.axes[0];
            const maju = activeGp.buttons[6].value;   // RT untuk maju
            const mundur = activeGp.buttons[7].value; // LT untuk mundur
            
            const throttle = maju - mundur; 
            currentX = Math.abs(rawX) > 0.15 ? Number(rawX.toFixed(2)) : 0;
            currentY = Number(throttle.toFixed(2));
          }
        }
      } else if (controlMode === 'keyboard') {
        currentY = (keysRef.current.up ? 1 : 0) - (keysRef.current.down ? 1 : 0);
        currentX = (keysRef.current.right ? 1 : 0) - (keysRef.current.left ? 1 : 0);
      }

      setSteering({ x: currentX, y: currentY });

      if (wsRef.current && wsRef.current.readyState === 1) {
        wsRef.current.send(JSON.stringify({ x: currentX, y: currentY }));
      }
    }, 100);

    return () => {
      clearInterval(interval);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (wsRef.current) wsRef.current.close();
    };
  }, [controlMode, PI_IP]); 

  // --- PERBAIKAN VISUALIZER ---
  // Membatasi titik hijau agar tidak menembus batas lingkaran (radius 48px - setengah ukuran dot 12px)
  const maxRadius = 36; 
  // Nilai input stik (-1 sampai 1) dikali dengan radius maksimal
  const dotX = steering.x * maxRadius;
  // Sumbu Y dibalik (* -1) karena di CSS titik Y=0 ada di atas, sedangkan maju (positif) inginnya ke atas
  const dotY = steering.y * -1 * maxRadius;

  return (
    <main className="min-h-screen bg-gray-900 text-white p-8 font-sans">
      <div className="max-w-5xl mx-auto">
        <header className="mb-8 border-b border-gray-700 pb-4 flex flex-col md:flex-row justify-between items-center gap-4">
          <h1 className="text-3xl font-bold text-emerald-400">Robot Vision Control</h1>
          
          <div className="flex gap-2 bg-gray-800 p-1 rounded-lg border border-gray-700">
            <button 
              onClick={() => setControlMode('gamepad')}
              className={`py-2 px-4 rounded font-semibold transition-colors ${controlMode === 'gamepad' ? 'bg-emerald-500 text-gray-900' : 'text-gray-400 hover:text-white'}`}
            >
              🎮 Gamepad
            </button>
            <button 
              onClick={() => setControlMode('keyboard')}
              className={`py-2 px-4 rounded font-semibold transition-colors ${controlMode === 'keyboard' ? 'bg-emerald-500 text-gray-900' : 'text-gray-400 hover:text-white'}`}
            >
              ⌨️ Keyboard
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-gray-800 rounded-xl p-4 border border-gray-700 shadow-xl">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
              <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse"></span>
              Live Feed
            </h2>
            <div className="aspect-video bg-black rounded-lg overflow-hidden flex items-center justify-center border border-gray-900 relative">
              {/* PERBAIKAN KAMERA HP: Menggunakan img standar dengan error fallback */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img 
                src={streamUrl} 
                alt="Robot view" 
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.parentElement!.innerHTML = '<div class="text-red-400 text-center p-4">Kamera gagal dimuat.<br/>Pastikan Pi dan HP berada dalam jaringan Tailscale/Wi-Fi yang sama.</div>';
                }}
              />
            </div>
          </div>

          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 shadow-xl flex flex-col">
            <h2 className="text-lg font-semibold mb-4 border-b border-gray-700 pb-2 flex justify-between items-center">
              <span>Status Kontrol</span>
              {controlMode === 'gamepad' && (
                <button onClick={forceScanGamepad} className="text-xs bg-gray-700 hover:bg-gray-600 py-1 px-2 rounded">
                  Pindai Ulang
                </button>
              )}
            </h2>
            
            <div className="flex-1 flex flex-col justify-center gap-6">
              <div className="bg-gray-900 p-3 rounded border border-gray-700 text-sm font-mono text-center">
                {controlMode === 'keyboard' ? '⌨️ AKTIF: Gunakan W-A-S-D atau Panah' : gamepadStatus}
              </div>

              <div className="bg-gray-900 p-4 rounded-lg flex flex-col items-center gap-4 border border-gray-700">
                <div className="text-xs text-gray-400 text-center mb-2">Visualizer (X / Y)</div>
                
                {/* PERBAIKAN VISUALIZER CSS */}
                <div className="w-24 h-24 bg-gray-800 rounded-full border-2 border-gray-600 relative overflow-hidden flex items-center justify-center">
                  {/* Grid Crosshair Tengah */}
                  <div className="absolute w-full h-[1px] bg-gray-600"></div>
                  <div className="absolute h-full w-[1px] bg-gray-600"></div>
                  
                  {/* Titik Hijau */}
                  <div 
                    className="w-6 h-6 bg-emerald-400 rounded-full absolute shadow-[0_0_10px_rgba(52,211,153,0.5)] transition-all duration-75"
                    style={{ transform: `translate(${dotX}px, ${dotY}px)` }}
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
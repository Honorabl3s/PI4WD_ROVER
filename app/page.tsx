'use client';

import { useState, useEffect, useRef } from 'react';
import { Pixelify_Sans } from 'next/font/google';

const pixelify = Pixelify_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

// ==========================================
// A. KOMPONEN LOGO PI4WD ROVER
// ==========================================
const PiRoverLogo = ({ scale = 1 }: { scale?: number }) => {
  return (
    <div className="flex flex-col items-center select-none" style={{ transform: `scale(${scale})` }}>
      <div className="flex items-center gap-2 font-extrabold text-3xl md:text-4xl tracking-widest">
        <div className="w-5 h-5 md:w-6 md:h-6 border-2 border-emerald-500 bg-emerald-100 rounded-sm -rotate-45 shadow-sm"></div>
        <span className="text-red-600 relative -top-0.5">PI4</span>
        <span className="text-slate-900">WD ROVER</span>
        <div className="w-5 h-5 md:w-6 md:h-6 border-2 border-emerald-500 bg-emerald-100 rounded-sm rotate-45 shadow-sm"></div>
      </div>
    </div>
  );
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const RECORD_INTERVAL_MS = 50;
const DIRECTION_BRAKE_MS = 600;
const MAX_STEP_TIMEOUT_MS = 15000;
const LATENCY_COMPENSATION_TICKS = 3;

type MotionType = 'FORWARD' | 'REVERSE' | 'TURN_LEFT' | 'TURN_RIGHT' | 'STOP';
type TrajectoryStep = { x: number; y: number; target_ticks_l: number; target_ticks_r: number; motion?: MotionType; };

export default function RobotDashboard() {
  const PI_IP = '192.168.11.110';
  const streamUrl = `http://${PI_IP}:8080/stream`;

  const [isLoading, setIsLoading] = useState(true);
  const [controlMode, setControlMode] = useState<'pc-mobile' | 'gamepad'>('pc-mobile');
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  const [gpVisuals, setGpVisuals] = useState({ lt: 0, rt: 0, steer: 0, btnA: false, btnB: false, btnX: false, btnY: false });
  
  const containerRef = useRef<HTMLDivElement>(null);

  const currentTicksRef = useRef({ l: 0, r: 0 });
  const lastRecordedTicksRef = useRef({ l: 0, r: 0 });
  const activeMotionRef = useRef<MotionType>('STOP');
  const lastCommandRef = useRef({ x: 0, y: 0 });
  
  const isRecordingRef = useRef(false);
  const isPlayingRef = useRef(false);
  const isSavingRef = useRef(false);
  const trajectoryRef = useRef<TrajectoryStep[]>([]);
  const prevBtnsRef = useRef({ A: false, B: false, Y: false, X: false });
  const wsRef = useRef<WebSocket | null>(null);
  
  const keysRef = useRef({ up: false, down: false, left: false, right: false });

  const sendCommand = (x: number, y: number) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ x, y }));
    }
  };

  const stopRobot = () => { sendCommand(0, 0); };

  const getMotionType = (x: number, y: number): MotionType => {
    const DEADZONE = 0.10;
    if (Math.abs(x) <= DEADZONE && Math.abs(y) <= DEADZONE) return 'STOP';
    if (Math.abs(y) > DEADZONE) return y > 0 ? 'FORWARD' : 'REVERSE';
    return x > 0 ? 'TURN_RIGHT' : 'TURN_LEFT';
  };

  const executePlayback = async (reverse: boolean = false) => {
    if (isPlayingRef.current || isSavingRef.current) return;
    isPlayingRef.current = true;
    try {
      const res = await fetch(`/api/trajectory?_t=${Date.now()}`, { method: 'GET', cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      const data = (await res.json()) as TrajectoryStep[];
      if (!Array.isArray(data) || data.length === 0) { alert('Data rute kosong!'); return; }
      const routeData = reverse ? [...data].reverse() : data;
      let lastActiveMotion: MotionType = 'STOP'; 
      for (let i = 0; i < routeData.length; i++) {
        if (!isPlayingRef.current) break;
        const step = routeData[i];
        const targetX = reverse ? -step.x : step.x;
        const targetY = reverse ? -step.y : step.y;
        const currentMotion = getMotionType(targetX, targetY);
        if (currentMotion !== 'STOP' && lastActiveMotion !== 'STOP') {
          if ((lastActiveMotion === 'FORWARD' && currentMotion === 'REVERSE') || (lastActiveMotion === 'REVERSE' && currentMotion === 'FORWARD')) {
            stopRobot(); await sleep(DIRECTION_BRAKE_MS);
          }
        }
        if (currentMotion !== 'STOP') lastActiveMotion = currentMotion;
        sendCommand(targetX, targetY);
        const startL = currentTicksRef.current.l; const startR = currentTicksRef.current.r;
        const targetL = Math.max(0, Number(step.target_ticks_l || 0)); const targetR = Math.max(0, Number(step.target_ticks_r || 0));
        const compTargetL = Math.max(0, targetL - LATENCY_COMPENSATION_TICKS); const compTargetR = Math.max(0, targetR - LATENCY_COMPENSATION_TICKS);
        if (targetL === 0 && targetR === 0) { await sleep(RECORD_INTERVAL_MS); continue; }
        const stepStartTime = Date.now();
        while (isPlayingRef.current) {
          const currentDeltaL = Math.abs(currentTicksRef.current.l - startL); const currentDeltaR = Math.abs(currentTicksRef.current.r - startR);
          let stepFinished = false;
          if (targetL > targetR) stepFinished = currentDeltaL >= compTargetL;
          else if (targetR > targetL) stepFinished = currentDeltaR >= compTargetR;
          else stepFinished = currentDeltaL >= compTargetL || currentDeltaR >= compTargetR;
          if (stepFinished || (Date.now() - stepStartTime > MAX_STEP_TIMEOUT_MS)) break;
          await sleep(10);
        }
      }
    } catch (error) { console.error('Playback Error:', error);
    } finally { stopRobot(); isPlayingRef.current = false; }
  };

  const handleAction = async (action: 'RECORD' | 'SAVE' | 'PLAY_FWD' | 'PLAY_REV') => {
    if (action === 'PLAY_FWD' || action === 'PLAY_REV') {
        if (isPlayingRef.current) { 
            isPlayingRef.current = false; 
            stopRobot(); 
        }
        else if (!isSavingRef.current && !isRecordingRef.current) {
            executePlayback(action === 'PLAY_REV');
        }
    } else if (action === 'RECORD') {
        if (!isRecordingRef.current && !isPlayingRef.current && !isSavingRef.current) {
            isRecordingRef.current = true; 
            trajectoryRef.current = [];
            lastRecordedTicksRef.current = { l: currentTicksRef.current.l, r: currentTicksRef.current.r };
            activeMotionRef.current = 'STOP'; 
            lastCommandRef.current = { x: 0, y: 0 }; 
            stopRobot();
        }
    } else if (action === 'SAVE') {
        if (isRecordingRef.current) {
            isRecordingRef.current = false;
            isSavingRef.current = true;
            
            if (trajectoryRef.current.length > 0) {
                try {
                    const res = await fetch('/api/trajectory', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(trajectoryRef.current)
                    });
                    
                    if (res.ok) alert('Rute berhasil disimpan!');
                    else alert('Gagal menyimpan rute.');
                } catch (error) {
                    console.error('Save error:', error);
                    alert('Terjadi kesalahan sistem saat menyimpan.');
                }
            } else {
                alert('Tidak ada data rute untuk disimpan (robot belum bergerak).');
            }
            isSavingRef.current = false;
        }
    }
  };

  useEffect(() => {
    const loadingTimer = setTimeout(() => setIsLoading(false), 2000);

    const ws = new WebSocket(`ws://${PI_IP}:8765`);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.ticks_l !== undefined && data.ticks_r !== undefined) {
          currentTicksRef.current = { l: Number(data.ticks_l), r: Number(data.ticks_r) };
        }
      } catch (error) {}
    };
    wsRef.current = ws;

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w' || key === 'arrowup') keysRef.current.up = true;
      if (key === 's' || key === 'arrowdown') keysRef.current.down = true;
      if (key === 'a' || key === 'arrowleft') keysRef.current.left = true;
      if (key === 'd' || key === 'arrowright') keysRef.current.right = true;
      
      if (e.repeat) return; 
      if (key === 'v') handleAction('RECORD');
      if (key === 'b') handleAction('SAVE');
      if (key === 'n') handleAction('PLAY_FWD');
      if (key === 'm') handleAction('PLAY_REV');
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w' || key === 'arrowup') keysRef.current.up = false;
      if (key === 's' || key === 'arrowdown') keysRef.current.down = false;
      if (key === 'a' || key === 'arrowleft') keysRef.current.left = false;
      if (key === 'd' || key === 'arrowright') keysRef.current.right = false;
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    const interval = setInterval(() => {
      let currentX = 0; let currentY = 0;
      let gpA = false, gpB = false, gpY = false, gpX = false;
      let gpLT = 0, gpRT = 0, gpSteer = 0;

      if (controlMode === 'gamepad' && typeof navigator !== 'undefined' && navigator.getGamepads) {
        const gamepads = navigator.getGamepads();
        let activeGp: Gamepad | null = null;
        for (let i = 0; i < gamepads.length; i++) { if (gamepads[i]) { activeGp = gamepads[i]; break; } }
        
        if (activeGp) {
          gpSteer = activeGp.axes[0] || 0; 
          gpRT = activeGp.buttons[7]?.value || 0; 
          gpLT = activeGp.buttons[6]?.value || 0; 
          
          currentX = Math.abs(gpSteer) > 0.15 ? Number(gpSteer.toFixed(2)) : 0;
          currentY = Number((gpRT - gpLT).toFixed(2));

          gpA = activeGp.buttons[0]?.pressed || false;
          gpB = activeGp.buttons[1]?.pressed || false;
          gpX = activeGp.buttons[2]?.pressed || false;
          gpY = activeGp.buttons[3]?.pressed || false;
          
          setGpVisuals({ lt: gpLT, rt: gpRT, steer: gpSteer, btnA: gpA, btnB: gpB, btnX: gpX, btnY: gpY });
        }
      } else if (controlMode === 'pc-mobile') {
        // W (up) menghasilkan 1, S (down) menghasilkan -1
        currentY = (keysRef.current.up ? 1 : 0) - (keysRef.current.down ? 1 : 0); 
        currentX = (keysRef.current.right ? 1 : 0) - (keysRef.current.left ? 1 : 0); 
      }

      const currentMotion = getMotionType(currentX, currentY);

      if (gpB && !prevBtnsRef.current.B) handleAction('RECORD');
      if (gpY && !prevBtnsRef.current.Y) handleAction('SAVE');
      if (gpA && !prevBtnsRef.current.A) handleAction('PLAY_FWD');
      if (gpX && !prevBtnsRef.current.X) handleAction('PLAY_REV');
      prevBtnsRef.current = { A: gpA, B: gpB, Y: gpY, X: gpX };

      if (isPlayingRef.current || isSavingRef.current) return;
      
      if (isRecordingRef.current) {
        if (currentMotion !== activeMotionRef.current) {
          const deltaL = Math.abs(currentTicksRef.current.l - lastRecordedTicksRef.current.l); 
          const deltaR = Math.abs(currentTicksRef.current.r - lastRecordedTicksRef.current.r);
          if ((deltaL > 0 || deltaR > 0) && activeMotionRef.current !== 'STOP') {
            trajectoryRef.current.push({ x: lastCommandRef.current.x, y: lastCommandRef.current.y, target_ticks_l: deltaL, target_ticks_r: deltaR, motion: activeMotionRef.current });
          }
          lastRecordedTicksRef.current = { l: currentTicksRef.current.l, r: currentTicksRef.current.r }; 
          activeMotionRef.current = currentMotion;
        }
        if (currentMotion !== 'STOP') lastCommandRef.current = { x: currentX, y: currentY };
      }
      sendCommand(currentX, currentY);
    }, RECORD_INTERVAL_MS);

    return () => {
      clearTimeout(loadingTimer); 
      clearInterval(interval);
      window.removeEventListener('keydown', handleKeyDown); 
      window.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      if (wsRef.current) wsRef.current.close();
    };
  }, [controlMode, PI_IP]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) { 
      if (containerRef.current) {
        containerRef.current.requestFullscreen().catch((err) => console.log(err)); 
      }
    } else { 
      if (document.exitFullscreen) {
        document.exitFullscreen(); 
      }
    }
  };

  return (
    <main 
      onContextMenu={(e) => e.preventDefault()}
      className={`min-h-screen bg-emerald-50 flex flex-col select-none touch-none overflow-x-hidden ${pixelify.className}`} 
      style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
    >
      {/* LOADING SCREEN */}
      <div className={`fixed inset-0 z-[200] bg-emerald-50 flex flex-col items-center justify-center transition-opacity duration-1000 ease-in-out ${isLoading ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="scale-125 md:scale-150"><PiRoverLogo /></div>
        <div className="mt-16 flex items-center gap-3 text-slate-500 text-sm tracking-widest uppercase">
          <div className="w-3 h-3 rounded-sm bg-emerald-500 animate-pulse"></div>
          Menghubungkan ke Robot...
        </div>
      </div>

      {/* HEADER LOGO */}
      <header className="w-full flex justify-center pt-6 pb-2 md:pt-8 md:pb-4 bg-emerald-50 relative z-0">
        <PiRoverLogo />
      </header>

      {/* MAIN CAMERA FEED & OVERLAY LAYOUT - DITENGAHKAN DAN DIPERBESAR */}
      <div className="w-full px-4 md:px-8 flex-1 flex flex-col items-center justify-center relative z-10">
        <div 
          ref={containerRef}
          className={`relative bg-[#0a0a8a] overflow-hidden shadow-2xl transition-all duration-300 ${
            isFullscreen 
              ? 'fixed inset-0 z-[150] bg-black border-0 rounded-none w-full h-full' 
              : 'w-full max-w-7xl aspect-[4/3] md:aspect-video rounded-xl md:rounded-2xl border-4 border-slate-900'
          }`}
        >
          
          {/* Stream Kamera */}
          <img src={streamUrl} alt="Robot Feed" className="absolute inset-0 w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          
          {/* Indikator Status Perekaman */}
          {(isRecordingRef.current || isPlayingRef.current) && (
            <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 flex gap-2">
              {isRecordingRef.current && <span className="bg-red-600 text-white px-4 py-1.5 rounded-sm text-sm tracking-wider animate-pulse shadow-lg border-2 border-red-800">MEREKAM</span>}
              {isPlayingRef.current && <span className="bg-emerald-600 text-white px-4 py-1.5 rounded-sm text-sm tracking-wider animate-pulse shadow-lg border-2 border-emerald-800">MEMUTAR RUTE</span>}
            </div>
          )}

          {/* OVERLAY: TOP BAR */}
          <div className="absolute top-4 left-0 right-0 flex justify-center z-20 pointer-events-none">
            <div className="flex gap-2 pointer-events-auto shadow-lg bg-slate-900/70 p-1.5 border-2 border-slate-700/50 backdrop-blur-sm rounded-md">
              <button 
                onClick={() => setControlMode('pc-mobile')} 
                className={`px-4 py-1.5 rounded-sm text-sm tracking-wider transition-all ${controlMode === 'pc-mobile' ? 'bg-[#b6e9c9] text-slate-900' : 'bg-transparent text-white hover:bg-white/20'}`}
              >
                PC/MOBILE
              </button>
              <button 
                onClick={() => setControlMode('gamepad')} 
                className={`px-4 py-1.5 rounded-sm text-sm tracking-wider transition-all ${controlMode === 'gamepad' ? 'bg-[#b6e9c9] text-slate-900' : 'bg-transparent text-white hover:bg-white/20'}`}
              >
                GAMEPAD
              </button>
            </div>
          </div>

          {/* OVERLAY: FULLSCREEN TOGGLE */}
          <button onClick={toggleFullscreen} className="absolute top-5 right-5 z-20 flex items-center gap-2 text-white text-sm tracking-widest drop-shadow-md hover:text-emerald-300 pointer-events-auto bg-slate-900/50 px-3 py-1.5 rounded-sm border border-white/20">
            {isFullscreen ? 'KELUAR' : 'FULLSCREEN'}
          </button>

          {/* OVERLAY: BOTTOM LEFT (MOVEMENT CONTROLS) */}
          <div className="absolute bottom-6 left-6 md:bottom-8 md:left-8 z-20 pointer-events-auto">
            {controlMode === 'pc-mobile' ? (
              <div className="flex flex-col items-center gap-2">
                <button 
                  onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); keysRef.current.up = true; }} 
                  onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); keysRef.current.up = false; }} 
                  className="w-14 h-14 md:w-16 md:h-16 bg-[#a2dfb4] active:bg-[#8bc99d] text-slate-900 text-3xl rounded-sm shadow-[4px_4px_0_#75a884] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all border-2 border-slate-900 flex items-center justify-center pb-1"
                >
                  W
                </button>
                <div className="flex gap-2">
                  <button 
                    onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); keysRef.current.left = true; }} 
                    onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); keysRef.current.left = false; }} 
                    className="w-14 h-14 md:w-16 md:h-16 bg-[#a2dfb4] active:bg-[#8bc99d] text-slate-900 text-3xl rounded-sm shadow-[4px_4px_0_#75a884] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all border-2 border-slate-900 flex items-center justify-center pb-1"
                  >
                    A
                  </button>
                  <button 
                    onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); keysRef.current.down = true; }} 
                    onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); keysRef.current.down = false; }} 
                    className="w-14 h-14 md:w-16 md:h-16 bg-[#a2dfb4] active:bg-[#8bc99d] text-slate-900 text-3xl rounded-sm shadow-[4px_4px_0_#75a884] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all border-2 border-slate-900 flex items-center justify-center pb-1"
                  >
                    S
                  </button>
                  <button 
                    onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); keysRef.current.right = true; }} 
                    onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); keysRef.current.right = false; }} 
                    className="w-14 h-14 md:w-16 md:h-16 bg-[#a2dfb4] active:bg-[#8bc99d] text-slate-900 text-3xl rounded-sm shadow-[4px_4px_0_#75a884] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all border-2 border-slate-900 flex items-center justify-center pb-1"
                  >
                    D
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2 pointer-events-none">
                <div className="flex gap-2">
                  <div className={`w-16 h-10 rounded-sm flex items-center justify-center text-xl border-2 transition-colors ${gpVisuals.lt > 0.1 ? 'bg-white text-slate-900 border-slate-900' : 'bg-slate-900/50 text-white border-white/50 backdrop-blur-sm'}`}>LT</div>
                  <div className={`w-16 h-10 rounded-sm flex items-center justify-center text-xl border-2 transition-colors ${gpVisuals.rt > 0.1 ? 'bg-white text-slate-900 border-slate-900' : 'bg-slate-900/50 text-white border-white/50 backdrop-blur-sm'}`}>RT</div>
                </div>
                <div className="w-full bg-slate-900/80 rounded-sm p-2 h-14 flex items-center justify-center relative shadow-lg border-2 border-white/20">
                   <div className="absolute left-3 text-white/50">L</div>
                   <div className="w-8 h-8 bg-red-500 rounded-sm transition-transform border-2 border-slate-900" style={{ transform: `translateX(${gpVisuals.steer * 40}px)` }}></div>
                   <div className="absolute right-3 text-white/50">R</div>
                </div>
              </div>
            )}
          </div>

          {/* OVERLAY: BOTTOM RIGHT (ACTION CONTROLS) */}
          <div className="absolute bottom-6 right-6 md:bottom-8 md:right-8 z-20 flex gap-2 md:gap-3 pointer-events-auto">
            {[
              { action: 'RECORD', pc: 'V', gp: 'B', color: 'bg-[#f87171] shadow-[4px_4px_0_#b91c1c]', activeColor: 'active:bg-red-500', gpState: gpVisuals.btnB },
              { action: 'SAVE', pc: 'B', gp: 'Y', color: 'bg-[#fbbf24] shadow-[4px_4px_0_#d97706]', activeColor: 'active:bg-amber-500', gpState: gpVisuals.btnY },
              { action: 'PLAY_FWD', pc: 'N', gp: 'A', color: 'bg-[#34d399] shadow-[4px_4px_0_#047857]', activeColor: 'active:bg-emerald-500', gpState: gpVisuals.btnA },
              { action: 'PLAY_REV', pc: 'M', gp: 'X', color: 'bg-[#60a5fa] shadow-[4px_4px_0_#1d4ed8]', activeColor: 'active:bg-blue-500', gpState: gpVisuals.btnX }
            ].map((btn) => (
              <div key={btn.action} className="flex flex-col items-center gap-2">
                <span className="text-[10px] md:text-xs text-white tracking-widest bg-slate-900/50 px-1.5 py-0.5 rounded-sm">
                  {btn.action === 'PLAY_FWD' ? 'PLAY' : btn.action === 'PLAY_REV' ? 'R-PLAY' : btn.action}
                </span>
                <button 
                  onClick={() => handleAction(btn.action as any)}
                  className={`w-12 h-12 md:w-14 md:h-14 ${btn.color} ${btn.activeColor} ${controlMode === 'gamepad' && btn.gpState ? 'translate-x-1 translate-y-1 shadow-none brightness-90' : ''} text-slate-900 text-2xl md:text-3xl rounded-sm active:shadow-none active:translate-x-1 active:translate-y-1 transition-all border-2 border-slate-900 flex items-center justify-center pb-1`}
                >
                  {controlMode === 'pc-mobile' ? btn.pc : btn.gp}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* FOOTER TEXT */}
      <footer className="w-full py-6 md:py-8 flex flex-col items-center justify-center text-center px-4 relative z-0">
        <h3 className="text-slate-600 tracking-widest text-xs md:text-sm uppercase mb-1">
          LAB INSTRUMENTASI ELEKTRONIKA & KECERDASAN BUATAN
        </h3>
        <p className="text-slate-600 tracking-widest text-xs md:text-sm uppercase">
          PROGRAM STUDI TEKNIK ELEKTRO
        </p>
      </footer>
    </main>
  );
}
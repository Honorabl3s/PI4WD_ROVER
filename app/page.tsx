'use client';

import { useState, useEffect, useRef } from 'react';

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// KONFIGURASI
const RECORD_INTERVAL_MS = 50;
const DIRECTION_BRAKE_MS = 600;
const MAX_STEP_TIMEOUT_MS = 15000;
const LATENCY_COMPENSATION_TICKS = 3;

// TYPE
type Steering = {
  x: number;
  y: number;
};

type MotionType =
  | 'FORWARD'
  | 'REVERSE'
  | 'TURN_LEFT'
  | 'TURN_RIGHT'
  | 'STOP';

type TrajectoryStep = {
  x: number;
  y: number;
  target_ticks_l: number;
  target_ticks_r: number;
  motion?: MotionType;
  sample_ms?: number;
};

export default function RobotDashboard() {
  const PI_IP = '192.168.0.105';
  const streamUrl = `http://${PI_IP}:8080/stream`;

  const [controlMode, setControlMode] = useState('touch');
  const [gamepadStatus, setGamepadStatus] = useState('Menunggu Gamepad...');
  const [steering, setSteering] = useState({ x: 0, y: 0 });
  const [ticks, setTicks] = useState({ l: 0, r: 0 });
  const [isRecordingUI, setIsRecordingUI] = useState(false);
  const [isPlayingUI, setIsPlayingUI] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

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
  
  const keysRef = useRef({ up: false, down: false, left: false, right: false, q: false, e: false });
  const touchStateRef = useRef({ turn: 0, throttle: 0, pan: 0 });

  const sendCommand = (x: number, y: number, pan: number = 0) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ x, y, pan }));
    }
  };

  const stopRobot = () => {
    setSteering({ x: 0, y: 0 });
    sendCommand(0, 0, touchStateRef.current.pan); 
  };

  const getMotionType = (x: number, y: number): MotionType => {
    const DEADZONE = 0.10;
    const hasX = Math.abs(x) > DEADZONE;
    const hasY = Math.abs(y) > DEADZONE;

    if (!hasX && !hasY) return 'STOP';
    if (hasY) return y > 0 ? 'FORWARD' : 'REVERSE';
    return x > 0 ? 'TURN_RIGHT' : 'TURN_LEFT';
  };

  const executePlayback = async (reverse: boolean = false) => {
    if (isPlayingRef.current || isSavingRef.current) return;

    isPlayingRef.current = true;
    setIsPlayingUI(true);
    console.log(`Memulai Playback ${reverse ? 'REVERSE' : 'FORWARD'}...`);

    try {
      const res = await fetch(`/api/trajectory?_t=${Date.now()}`, { method: 'GET', cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      const data = (await res.json()) as TrajectoryStep[];

      if (!Array.isArray(data) || data.length === 0) {
        alert('Data perjalanan kosong! Rekam rute terlebih dahulu.');
        return;
      }

      const routeData = reverse ? [...data].reverse() : data;
      let lastActiveMotion: MotionType = 'STOP'; 

      for (let i = 0; i < routeData.length; i++) {
        if (!isPlayingRef.current) break;

        const step = routeData[i];
        const targetX = reverse ? -step.x : step.x;
        const targetY = reverse ? -step.y : step.y;
        const currentMotion = getMotionType(targetX, targetY);

        if (currentMotion !== 'STOP' && lastActiveMotion !== 'STOP') {
          const isReversal =
            (lastActiveMotion === 'FORWARD' && currentMotion === 'REVERSE') ||
            (lastActiveMotion === 'REVERSE' && currentMotion === 'FORWARD') ||
            (lastActiveMotion === 'TURN_LEFT' && currentMotion === 'TURN_RIGHT') ||
            (lastActiveMotion === 'TURN_RIGHT' && currentMotion === 'TURN_LEFT');

          if (isReversal) {
            stopRobot();
            await sleep(DIRECTION_BRAKE_MS);
            if (!isPlayingRef.current) break;
          }
        }

        if (currentMotion !== 'STOP') lastActiveMotion = currentMotion;

        setSteering({ x: targetX, y: targetY });
        sendCommand(targetX, targetY, touchStateRef.current.pan);

        const startL = currentTicksRef.current.l;
        const startR = currentTicksRef.current.r;
        
        const targetL = Math.max(0, Number(step.target_ticks_l || 0));
        const targetR = Math.max(0, Number(step.target_ticks_r || 0));

        const compTargetL = Math.max(0, targetL - LATENCY_COMPENSATION_TICKS);
        const compTargetR = Math.max(0, targetR - LATENCY_COMPENSATION_TICKS);

        if (targetL === 0 && targetR === 0) {
          await sleep(RECORD_INTERVAL_MS);
          continue;
        }

        const stepStartTime = Date.now();

        while (isPlayingRef.current) {
          const currentDeltaL = Math.abs(currentTicksRef.current.l - startL);
          const currentDeltaR = Math.abs(currentTicksRef.current.r - startR);
          let stepFinished = false;

          if (targetL > targetR) {
            stepFinished = currentDeltaL >= compTargetL;
          } else if (targetR > targetL) {
            stepFinished = currentDeltaR >= compTargetR;
          } else {
            stepFinished = currentDeltaL >= compTargetL || currentDeltaR >= compTargetR;
          }

          if (stepFinished) break;
          
          if (Date.now() - stepStartTime > MAX_STEP_TIMEOUT_MS) {
            console.warn(`Timeout step ${i}: Robot tersangkut.`);
            break;
          }
          await sleep(10);
        }
      }
      console.log('Playback selesai!');
    } catch (error) {
      console.error('Gagal playback:', error);
    } finally {
      stopRobot();
      isPlayingRef.current = false;
      setIsPlayingUI(false);
    }
  };

  const forceScanGamepad = () => {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const gamepads = navigator.getGamepads();
    let activeGp: Gamepad | null = null;
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i]) { activeGp = gamepads[i]; break; }
    }
    if (activeGp) setGamepadStatus(`🟢 TERHUBUNG: ${activeGp.id.substring(0, 15)}...`);
  };

  const saveTrajectory = async () => {
    isSavingRef.current = true;
    try {
      stopRobot();
      
      const deltaL = Math.abs(currentTicksRef.current.l - lastRecordedTicksRef.current.l);
      const deltaR = Math.abs(currentTicksRef.current.r - lastRecordedTicksRef.current.r);
      if ((deltaL > 0 || deltaR > 0) && activeMotionRef.current !== 'STOP') {
        trajectoryRef.current.push({
          x: lastCommandRef.current.x,
          y: lastCommandRef.current.y,
          target_ticks_l: deltaL,
          target_ticks_r: deltaR,
          motion: activeMotionRef.current,
        });
      }

      const trajectoryToSave = [...trajectoryRef.current];
      if (trajectoryToSave.length === 0) return;

      const res = await fetch('/api/trajectory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trajectoryToSave),
      });

      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
    } catch (error) {
      alert('Gagal menyimpan rute.');
    } finally {
      isSavingRef.current = false;
    }
  };

  const handleTouchAction = (action: 'RECORD' | 'SAVE' | 'PLAY_FWD' | 'PLAY_REV') => {
    if (action === 'PLAY_FWD') {
      if (isPlayingRef.current) { isPlayingRef.current = false; stopRobot(); }
      else if (!isSavingRef.current && !isRecordingRef.current) executePlayback(false);
    } else if (action === 'PLAY_REV') {
      if (isPlayingRef.current) { isPlayingRef.current = false; stopRobot(); }
      else if (!isSavingRef.current && !isRecordingRef.current) executePlayback(true);
    } else if (action === 'RECORD') {
      if (!isRecordingRef.current && !isPlayingRef.current && !isSavingRef.current) {
        isRecordingRef.current = true;
        setIsRecordingUI(true);
        trajectoryRef.current = [];
        lastRecordedTicksRef.current = { l: currentTicksRef.current.l, r: currentTicksRef.current.r };
        activeMotionRef.current = 'STOP';
        lastCommandRef.current = { x: 0, y: 0 };
        stopRobot();
      }
    } else if (action === 'SAVE') {
      if (isRecordingRef.current) {
        isRecordingRef.current = false;
        setIsRecordingUI(false);
        saveTrajectory();
      }
    }
  };

  const enterFullscreen = () => {
    const elem = document.documentElement;
    if (elem.requestFullscreen) {
      elem.requestFullscreen();
    }
  };

  const exitFullscreen = () => {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    const ws = new WebSocket(`ws://${PI_IP}:8765`);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.ticks_l !== undefined && data.ticks_r !== undefined) {
          const newTicks = { l: Number(data.ticks_l), r: Number(data.ticks_r) };
          setTicks(newTicks);
          currentTicksRef.current = newTicks;
        }
      } catch (error) {}
    };
    wsRef.current = ws;

    // PERBAIKAN LOGIKA KEYBOARD (Q dan E ditambahkan & CapsLock kebal)
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'arrowup' || key === 'w') keysRef.current.up = true;
      if (key === 'arrowdown' || key === 's') keysRef.current.down = true;
      if (key === 'arrowleft' || key === 'a') keysRef.current.left = true;
      if (key === 'arrowright' || key === 'd') keysRef.current.right = true;
      if (key === 'q') keysRef.current.q = true; 
      if (key === 'e') keysRef.current.e = true; 
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'arrowup' || key === 'w') keysRef.current.up = false;
      if (key === 'arrowdown' || key === 's') keysRef.current.down = false;
      if (key === 'arrowleft' || key === 'a') keysRef.current.left = false;
      if (key === 'arrowright' || key === 'd') keysRef.current.right = false;
      
      // Saat tombol dilepas, kembalikan posisi pan (menoleh) ke 0 secara paksa
      if (key === 'q') {
          keysRef.current.q = false;
          touchStateRef.current.pan = 0; 
      }
      if (key === 'e') {
          keysRef.current.e = false;
          touchStateRef.current.pan = 0; 
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    const interval = setInterval(() => {
      let currentX = 0; let currentY = 0; let currentPan = 0;
      let btnA = false; let btnB = false; let btnY = false; let btnX = false;

      if (controlMode === 'gamepad') {
        if (typeof navigator !== 'undefined' && navigator.getGamepads) {
          const gamepads = navigator.getGamepads();
          let activeGp: Gamepad | null = null;
          for (let i = 0; i < gamepads.length; i++) {
            if (gamepads[i]) { activeGp = gamepads[i]; break; }
          }
          if (activeGp) {
            const rawX = activeGp.axes[0] || 0; 
            const rawPan = activeGp.axes[2] || 0; 
            const maju = activeGp.buttons[7]?.value || 0;
            const mundur = activeGp.buttons[6]?.value || 0;
            
            currentX = Math.abs(rawX) > 0.15 ? Number(rawX.toFixed(2)) : 0;
            currentY = Number((mundur - maju).toFixed(2));
            currentPan = Math.abs(rawPan) > 0.15 ? Number(rawPan.toFixed(2)) : 0;

            btnA = activeGp.buttons[0]?.pressed || false;
            btnB = activeGp.buttons[1]?.pressed || false;
            btnY = activeGp.buttons[3]?.pressed || false;
            btnX = activeGp.buttons[2]?.pressed || false;
          }
        }
      } else if (controlMode === 'keyboard') {
        currentY = (keysRef.current.down ? 1 : 0) - (keysRef.current.up ? 1 : 0);
        currentX = (keysRef.current.right ? 1 : 0) - (keysRef.current.left ? 1 : 0);
        currentPan = (keysRef.current.e ? 1 : 0) - (keysRef.current.q ? 1 : 0);
      } else if (controlMode === 'touch' || isFullscreen) {
        currentX = touchStateRef.current.turn;
        currentY = touchStateRef.current.throttle;
        currentPan = touchStateRef.current.pan;
      }

      // GLOBAL KEYBOARD OVERRIDE: Berlaku dimanapun asalkan tombol keyboard ditekan
      if (keysRef.current.up || keysRef.current.down || keysRef.current.left || keysRef.current.right) {
        currentY = (keysRef.current.down ? 1 : 0) - (keysRef.current.up ? 1 : 0);
        currentX = (keysRef.current.right ? 1 : 0) - (keysRef.current.left ? 1 : 0);
      }
      if (keysRef.current.q || keysRef.current.e) {
        currentPan = (keysRef.current.e ? 1 : 0) - (keysRef.current.q ? 1 : 0);
        touchStateRef.current.pan = currentPan; // Sinkronkan ke UI Sentuh
      }

      const currentMotion = getMotionType(currentX, currentY);

      if (btnA && !prevBtnsRef.current.A && !isRecordingRef.current) {
        if (isPlayingRef.current) { isPlayingRef.current = false; stopRobot(); } 
        else if (!isSavingRef.current) executePlayback(false);
      }

      if (btnX && !prevBtnsRef.current.X && !isRecordingRef.current) {
        if (isPlayingRef.current) { isPlayingRef.current = false; stopRobot(); } 
        else if (!isSavingRef.current) executePlayback(true);
      }

      if (btnB && !prevBtnsRef.current.B && !isRecordingRef.current && !isPlayingRef.current && !isSavingRef.current) {
        isRecordingRef.current = true;
        setIsRecordingUI(true);
        trajectoryRef.current = [];
        lastRecordedTicksRef.current = { l: currentTicksRef.current.l, r: currentTicksRef.current.r };
        activeMotionRef.current = currentMotion;
        lastCommandRef.current = { x: currentX, y: currentY };
        stopRobot();
      }

      if (btnY && !prevBtnsRef.current.Y && isRecordingRef.current) {
        isRecordingRef.current = false;
        setIsRecordingUI(false);
        saveTrajectory();
      }

      prevBtnsRef.current = { A: btnA, B: btnB, Y: btnY, X: btnX };

      if (isPlayingRef.current || isSavingRef.current) return;

      if (isRecordingRef.current) {
        if (currentMotion !== activeMotionRef.current) {
          const deltaL = Math.abs(currentTicksRef.current.l - lastRecordedTicksRef.current.l);
          const deltaR = Math.abs(currentTicksRef.current.r - lastRecordedTicksRef.current.r);

          if ((deltaL > 0 || deltaR > 0) && activeMotionRef.current !== 'STOP') {
            trajectoryRef.current.push({
              x: lastCommandRef.current.x,
              y: lastCommandRef.current.y,
              target_ticks_l: deltaL,
              target_ticks_r: deltaR,
              motion: activeMotionRef.current,
            });
          }

          lastRecordedTicksRef.current = { l: currentTicksRef.current.l, r: currentTicksRef.current.r };
          activeMotionRef.current = currentMotion;
        }

        if (currentMotion !== 'STOP') {
          lastCommandRef.current = { x: currentX, y: currentY };
        }
      }

      setSteering({ x: currentX, y: currentY });
      sendCommand(currentX, currentY, currentPan);
    }, RECORD_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      if (wsRef.current) wsRef.current.close();
    };
  }, [controlMode, PI_IP, isFullscreen]);

  const maxRadius = 36;
  const dotX = steering.x * maxRadius;
  const dotY = steering.y * maxRadius;

  return (
    <main 
      onContextMenu={(e) => e.preventDefault()}
      className="min-h-screen bg-slate-950 text-slate-100 p-3 md:p-8 font-sans pb-12 select-none" 
      style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
    >
      <div className="max-w-5xl mx-auto space-y-4 md:space-y-6">
        
        {/* HEADER */}
        <header className="flex flex-col md:flex-row justify-between items-center gap-4 bg-slate-900/60 p-4 rounded-2xl border border-slate-800 shadow-lg backdrop-blur-sm">
          <div className="flex items-center gap-4 flex-wrap">
            <h1 className="text-xl md:text-2xl font-black bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent tracking-tight">
              ROBOT VISION 
            </h1>
            {isRecordingUI && (
              <span className="flex items-center gap-2 bg-red-500/10 text-red-500 border border-red-500/50 px-3 py-1 rounded-full text-xs font-bold animate-pulse">
                <span className="w-2 h-2 bg-red-500 rounded-full shadow-[0_0_8px_#ef4444]"></span> MEREKAM...
              </span>
            )}
            {isPlayingUI && (
              <span className="flex items-center gap-2 bg-blue-500/10 text-blue-400 border border-blue-500/50 px-3 py-1 rounded-full text-xs font-bold animate-pulse">
                <span className="w-2 h-2 bg-blue-400 rounded-full shadow-[0_0_8px_#60a5fa]"></span> MEMUTAR ULANG...
              </span>
            )}
          </div>
          
          <div className="flex gap-2 bg-slate-950/50 p-1.5 rounded-xl border border-slate-800 text-xs font-medium">
            <button onClick={() => setControlMode('touch')} className={`py-1.5 px-3 rounded-lg transition-all ${controlMode === 'touch' ? 'bg-emerald-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>📱 Touch</button>
            <button onClick={() => setControlMode('gamepad')} className={`py-1.5 px-3 rounded-lg transition-all ${controlMode === 'gamepad' ? 'bg-emerald-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>🎮 Gamepad</button>
            <button onClick={() => setControlMode('keyboard')} className={`py-1.5 px-3 rounded-lg transition-all ${controlMode === 'keyboard' ? 'bg-emerald-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>⌨️ Keyboard</button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          
          {/* (KAMERA & TOUCH CONTROLLER INLINE) */}
          <div className="lg:col-span-2 flex flex-col gap-4 md:gap-6">
            
            <div className="bg-slate-900/60 rounded-3xl p-3 md:p-4 border border-slate-800 shadow-xl backdrop-blur-sm">
              <div className="flex justify-between items-center mb-2 px-2">
                <h2 className="text-sm font-bold flex items-center gap-2 text-slate-300 uppercase tracking-widest">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span> Live Feed
                </h2>
                {/* TOMBOL FULL-SCREEN */}
                <button 
                  onClick={enterFullscreen}
                  className="bg-emerald-500/20 hover:bg-emerald-500/40 text-emerald-400 border border-emerald-500/50 text-[10px] font-bold px-3 py-1 rounded-lg transition-colors flex items-center gap-1"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                  Full Screen
                </button>
              </div>
              
              <div className="aspect-video bg-black rounded-2xl overflow-hidden flex items-center justify-center border border-slate-950 shadow-inner relative">
                <img src={streamUrl} alt="Robot view" className="w-full h-full object-contain pointer-events-auto" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              </div>
            </div>

            {/* TOUCH UI BARU SESUAI DESAIN */}
            {controlMode === 'touch' && (
              <div className="bg-slate-900/80 p-6 md:p-8 rounded-3xl border border-slate-800 shadow-2xl flex flex-row justify-between items-center backdrop-blur-md select-none touch-none">
                
                {/* SISI KIRI: Aksi dan Slider Kamera */}
                <div className="flex flex-col gap-5 w-1/2 max-w-[260px]">
                  {/* 4 Tombol Aksi Berjejer */}
                  <div className="flex justify-between gap-2">
                    <button onClick={() => handleTouchAction('RECORD')} className="w-12 h-12 bg-red-600/70 active:bg-red-500 rounded-xl flex items-center justify-center shadow-lg border border-red-500/30 transition-all">
                       <svg className="w-5 h-5 text-white pointer-events-none" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /></svg>
                    </button>
                    <button onClick={() => handleTouchAction('SAVE')} className="w-12 h-12 bg-amber-600/70 active:bg-amber-500 rounded-xl flex items-center justify-center shadow-lg border border-amber-500/30 transition-all">
                       <svg className="w-5 h-5 text-white pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                    </button>
                    <button onClick={() => handleTouchAction('PLAY_REV')} className="w-12 h-12 bg-blue-600/70 active:bg-blue-500 rounded-xl flex items-center justify-center shadow-lg border border-blue-500/30 transition-all">
                       <svg className="w-5 h-5 text-white pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                    </button>
                    <button onClick={() => handleTouchAction('PLAY_FWD')} className="w-12 h-12 bg-emerald-600/70 active:bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg border border-emerald-500/30 transition-all">
                       <svg className="w-5 h-5 text-white pointer-events-none" fill="currentColor" viewBox="0 0 24 24"><path d="M5 3l14 9-14 9V3z" /></svg>
                    </button>
                  </div>

                  {/* Slider Kamera di Bawah Tombol Aksi */}
                  <div className="w-full bg-slate-950/50 p-3 rounded-2xl border border-slate-800 shadow-inner flex items-center gap-3">
                     <span className="text-xs font-bold text-slate-500">Q</span>
                     <input 
                        type="range" min="-1" max="1" step="0.05" defaultValue="0"
                        onInput={(e) => { touchStateRef.current.pan = Number(e.currentTarget.value); }}
                        onPointerUp={(e) => { 
                          e.currentTarget.value = "0"; 
                          touchStateRef.current.pan = 0; 
                        }}
                        onPointerLeave={(e) => {
                          e.currentTarget.value = "0"; 
                          touchStateRef.current.pan = 0; 
                        }}
                        className="w-full accent-red-500"
                     />
                     <span className="text-xs font-bold text-slate-500">E</span>
                  </div>
                </div>

                {/* SISI KANAN: D-Pad Pergerakan Salib */}
                <div className="flex flex-col items-center gap-1 pointer-events-auto">
                  {/* MAJU */}
                  <button 
                    onPointerDown={() => touchStateRef.current.throttle = -1} 
                    onPointerUp={() => touchStateRef.current.throttle = 0} 
                    onPointerLeave={() => touchStateRef.current.throttle = 0} 
                    className="w-14 h-14 bg-red-600/70 active:bg-red-500 rounded-2xl flex items-center justify-center shadow-lg border border-red-500/30 text-white transition-colors"
                  >
                    <svg className="w-7 h-7 pointer-events-none" fill="currentColor" viewBox="0 0 24 24"><path d="M12 4l-8 8h6v8h4v-8h6z"/></svg>
                  </button>
                  
                  {/* KIRI DAN KANAN */}
                  <div className="flex gap-14">
                    <button 
                      onPointerDown={() => touchStateRef.current.turn = -1} 
                      onPointerUp={() => touchStateRef.current.turn = 0} 
                      onPointerLeave={() => touchStateRef.current.turn = 0} 
                      className="w-14 h-14 bg-red-600/70 active:bg-red-500 rounded-2xl flex items-center justify-center shadow-lg border border-red-500/30 text-white transition-colors"
                    >
                      <svg className="w-7 h-7 pointer-events-none" fill="currentColor" viewBox="0 0 24 24"><path d="M4 12l8 8v-6h8v-4h-8V4z"/></svg>
                    </button>
                    <button 
                      onPointerDown={() => touchStateRef.current.turn = 1} 
                      onPointerUp={() => touchStateRef.current.turn = 0} 
                      onPointerLeave={() => touchStateRef.current.turn = 0} 
                      className="w-14 h-14 bg-red-600/70 active:bg-red-500 rounded-2xl flex items-center justify-center shadow-lg border border-red-500/30 text-white transition-colors"
                    >
                      <svg className="w-7 h-7 pointer-events-none" fill="currentColor" viewBox="0 0 24 24"><path d="M20 12l-8-8v6H4v4h8v6z"/></svg>
                    </button>
                  </div>
                  
                  {/* MUNDUR */}
                  <button 
                    onPointerDown={() => touchStateRef.current.throttle = 1} 
                    onPointerUp={() => touchStateRef.current.throttle = 0} 
                    onPointerLeave={() => touchStateRef.current.throttle = 0} 
                    className="w-14 h-14 bg-red-600/70 active:bg-red-500 rounded-2xl flex items-center justify-center shadow-lg border border-red-500/30 text-white transition-colors"
                  >
                     <svg className="w-7 h-7 pointer-events-none" fill="currentColor" viewBox="0 0 24 24"><path d="M12 20l8-8h-6V4h-4v8H4z"/></svg>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* KOLOM KANAN (STATUS) */}
          <div className="bg-slate-900/60 rounded-3xl p-5 md:p-6 border border-slate-800 shadow-xl flex flex-col justify-between backdrop-blur-sm">
            <div>
              <h2 className="text-sm font-bold mb-4 md:mb-5 border-b border-slate-800 pb-3 flex justify-between items-center text-slate-300 uppercase tracking-widest">
                <span>Status Kontrol</span>
                {controlMode === 'gamepad' && ( <button onClick={forceScanGamepad} className="text-[10px] bg-slate-800 hover:bg-slate-700 py-1 px-2 rounded-md transition-colors">Pindai Ulang</button> )}
              </h2>
              
              <div className="flex flex-col gap-4 md:gap-5">
                <div className="bg-slate-950/50 p-3 rounded-xl border border-slate-800/50 text-xs font-mono text-center text-emerald-400 pointer-events-none">
                  {controlMode === 'touch' ? '📱 AKTIF: DUAL-PAD SENTUH' : controlMode === 'keyboard' ? '⌨️ AKTIF: W-A-S-D & Q-E' : gamepadStatus}
                </div>

                <div className="bg-slate-950/50 p-4 md:p-5 rounded-2xl flex flex-col items-center gap-4 border border-slate-800/50 shadow-inner pointer-events-none">
                  <div className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Visualizer Posisi</div>
                  
                  <div className="w-24 h-24 bg-slate-900 rounded-full border-2 border-slate-800 relative overflow-hidden flex items-center justify-center shadow-inner">
                    <div className="absolute w-full h-[1px] bg-slate-800"></div>
                    <div className="absolute h-full w-[1px] bg-slate-800"></div>
                    <div className="w-5 h-5 bg-emerald-400 rounded-full absolute shadow-[0_0_12px_#34d399] transition-all duration-75" style={{ transform: `translate(${dotX}px, ${dotY}px)` }}></div>
                  </div>
                  
                  <div className="font-mono text-xs flex gap-4 text-emerald-400 font-bold bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800">
                    <span>X: {steering.x}</span><span>Y: {steering.y}</span>
                  </div>
                  
                  <div className="font-mono text-xs flex justify-between w-full px-2 text-blue-400 border-t border-slate-800/50 pt-4 font-bold">
                    <span>⚙️ L: {ticks.l}</span><span>⚙️ R: {ticks.r}</span>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Tombol aksi cadangan untuk UI Desktop */}
            <div className="mt-6 md:mt-8 pt-5 border-t border-slate-800 flex flex-col gap-3">
              <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1 pointer-events-none">Panel Cadangan Aksi</div>
              <div className="grid grid-cols-2 gap-3 opacity-50 hover:opacity-100 transition-opacity">
                <button onClick={() => handleTouchAction('RECORD')} className="bg-slate-800 hover:bg-red-600 text-white py-2 rounded-lg text-xs font-bold transition-colors">Rekam</button>
                <button onClick={() => handleTouchAction('SAVE')} className="bg-slate-800 hover:bg-amber-500 text-white py-2 rounded-lg text-xs font-bold transition-colors">Simpan</button>
                <button onClick={() => handleTouchAction('PLAY_FWD')} className="bg-slate-800 hover:bg-emerald-500 text-white py-2 rounded-lg text-xs font-bold transition-colors">P. Maju</button>
                <button onClick={() => handleTouchAction('PLAY_REV')} className="bg-slate-800 hover:bg-blue-500 text-white py-2 rounded-lg text-xs font-bold transition-colors">P. Mundur</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* OVERLAY LAYAR PENUH (FULL SCREEN) LAYOUT BARU */}
      {isFullscreen && (
        <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center overflow-hidden touch-none select-none">
          
          <img 
            src={streamUrl} 
            alt="Robot Fullscreen" 
            className="absolute inset-0 w-full h-full object-contain pointer-events-none" 
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />

          <button 
            onClick={exitFullscreen}
            className="absolute top-4 right-4 z-[101] bg-white/10 hover:bg-white/30 px-4 py-2 rounded-full text-white text-xs font-bold backdrop-blur-md pointer-events-auto border border-white/20 shadow-lg"
          >
            ✕ Keluar
          </button>

          {/* AREA KONTROL OVERLAY */}
          <div className="absolute inset-0 z-[101] flex flex-row items-end justify-between px-8 md:px-16 pb-8 md:pb-12 pointer-events-none">
            
            {/* SISI KIRI: Aksi dan Slider Kamera */}
            <div className="flex flex-col gap-6 pointer-events-auto w-[240px] md:w-[280px]">
              {/* 4 Tombol Aksi Berjejer */}
              <div className="flex justify-between gap-3">
                <button onClick={() => handleTouchAction('RECORD')} className="w-12 h-12 md:w-14 md:h-14 bg-red-600/70 active:bg-red-500 rounded-xl flex items-center justify-center backdrop-blur-md shadow-lg border border-red-500/30 transition-all">
                   <svg className="w-5 h-5 text-white pointer-events-none" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /></svg>
                </button>
                <button onClick={() => handleTouchAction('SAVE')} className="w-12 h-12 md:w-14 md:h-14 bg-amber-600/70 active:bg-amber-500 rounded-xl flex items-center justify-center backdrop-blur-md shadow-lg border border-amber-500/30 transition-all">
                   <svg className="w-5 h-5 text-white pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                </button>
                <button onClick={() => handleTouchAction('PLAY_REV')} className="w-12 h-12 md:w-14 md:h-14 bg-blue-600/70 active:bg-blue-500 rounded-xl flex items-center justify-center backdrop-blur-md shadow-lg border border-blue-500/30 transition-all">
                   <svg className="w-5 h-5 text-white pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
                <button onClick={() => handleTouchAction('PLAY_FWD')} className="w-12 h-12 md:w-14 md:h-14 bg-emerald-600/70 active:bg-emerald-500 rounded-xl flex items-center justify-center backdrop-blur-md shadow-lg border border-emerald-500/30 transition-all">
                   <svg className="w-5 h-5 text-white pointer-events-none" fill="currentColor" viewBox="0 0 24 24"><path d="M5 3l14 9-14 9V3z" /></svg>
                </button>
              </div>

              {/* Slider Kamera di Bawah Tombol Aksi */}
              <div className="w-full bg-black/40 p-4 rounded-2xl backdrop-blur-md border border-white/10 shadow-lg flex items-center gap-3">
                 <span className="text-sm font-bold text-white/70">Q</span>
                 <input 
                    type="range" min="-1" max="1" step="0.05" defaultValue="0"
                    onInput={(e) => { touchStateRef.current.pan = Number(e.currentTarget.value); }}
                    onPointerUp={(e) => { 
                      e.currentTarget.value = "0"; 
                      touchStateRef.current.pan = 0; 
                    }}
                    onPointerLeave={(e) => {
                      e.currentTarget.value = "0"; 
                      touchStateRef.current.pan = 0; 
                    }}
                    className="w-full accent-red-500"
                 />
                 <span className="text-sm font-bold text-white/70">E</span>
              </div>
            </div>

            {/* SISI KANAN: D-Pad Pergerakan Salib */}
            <div className="flex flex-col items-center gap-2 pointer-events-auto">
              {/* MAJU */}
              <button 
                onPointerDown={() => touchStateRef.current.throttle = -1} 
                onPointerUp={() => touchStateRef.current.throttle = 0} 
                onPointerLeave={() => touchStateRef.current.throttle = 0} 
                className="w-16 h-16 md:w-20 md:h-20 bg-red-600/60 active:bg-red-500 rounded-2xl flex items-center justify-center backdrop-blur-md shadow-xl border border-red-500/40 text-white transition-colors"
              >
                <svg className="w-8 h-8 pointer-events-none" fill="currentColor" viewBox="0 0 24 24"><path d="M12 4l-8 8h6v8h4v-8h6z"/></svg>
              </button>
              
              {/* KIRI DAN KANAN */}
              <div className="flex gap-16 md:gap-20">
                <button 
                  onPointerDown={() => touchStateRef.current.turn = -1} 
                  onPointerUp={() => touchStateRef.current.turn = 0} 
                  onPointerLeave={() => touchStateRef.current.turn = 0} 
                  className="w-16 h-16 md:w-20 md:h-20 bg-red-600/60 active:bg-red-500 rounded-2xl flex items-center justify-center backdrop-blur-md shadow-xl border border-red-500/40 text-white transition-colors"
                >
                  <svg className="w-8 h-8 pointer-events-none" fill="currentColor" viewBox="0 0 24 24"><path d="M4 12l8 8v-6h8v-4h-8V4z"/></svg>
                </button>
                <button 
                  onPointerDown={() => touchStateRef.current.turn = 1} 
                  onPointerUp={() => touchStateRef.current.turn = 0} 
                  onPointerLeave={() => touchStateRef.current.turn = 0} 
                  className="w-16 h-16 md:w-20 md:h-20 bg-red-600/60 active:bg-red-500 rounded-2xl flex items-center justify-center backdrop-blur-md shadow-xl border border-red-500/40 text-white transition-colors"
                >
                  <svg className="w-8 h-8 pointer-events-none" fill="currentColor" viewBox="0 0 24 24"><path d="M20 12l-8-8v6H4v4h8v6z"/></svg>
                </button>
              </div>
              
              {/* MUNDUR */}
              <button 
                onPointerDown={() => touchStateRef.current.throttle = 1} 
                onPointerUp={() => touchStateRef.current.throttle = 0} 
                onPointerLeave={() => touchStateRef.current.throttle = 0} 
                className="w-16 h-16 md:w-20 md:h-20 bg-red-600/60 active:bg-red-500 rounded-2xl flex items-center justify-center backdrop-blur-md shadow-xl border border-red-500/40 text-white transition-colors"
              >
                 <svg className="w-8 h-8 pointer-events-none" fill="currentColor" viewBox="0 0 24 24"><path d="M12 20l8-8h-6V4h-4v8H4z"/></svg>
              </button>
            </div>

          </div>
        </div>
      )}

    </main>
  );
}
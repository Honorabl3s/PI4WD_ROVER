'use client';

import { useState, useEffect, useRef } from 'react';

// ============================================================
// HELPER
// ============================================================
const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================
// KONFIGURASI
// ============================================================
const RECORD_INTERVAL_MS = 50;
const DIRECTION_BRAKE_MS = 600;
const MAX_STEP_TIMEOUT_MS = 15000;
const LATENCY_COMPENSATION_TICKS = 3;

// ============================================================
// TYPE
// ============================================================
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
  const [isFullscreen, setIsFullscreen] = useState(false); // State Fullscreen

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

  const touchStateRef = useRef({ turn: 0, throttle: 0 });

  const sendCommand = (x: number, y: number) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ x, y }));
    }
  };

  const stopRobot = () => {
    setSteering({ x: 0, y: 0 });
    sendCommand(0, 0);
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
        sendCommand(targetX, targetY);

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

  // Fungsi Full-Screen
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
    // Sinkronisasi status fullscreen dari sistem
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
      let currentX = 0; let currentY = 0;
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
            const maju = activeGp.buttons[7]?.value || 0;
            const mundur = activeGp.buttons[6]?.value || 0;
            currentX = Math.abs(rawX) > 0.15 ? Number(rawX.toFixed(2)) : 0;
            currentY = Number((mundur - maju).toFixed(2));
            btnA = activeGp.buttons[0]?.pressed || false;
            btnB = activeGp.buttons[1]?.pressed || false;
            btnY = activeGp.buttons[3]?.pressed || false;
            btnX = activeGp.buttons[2]?.pressed || false;
          }
        }
      } else if (controlMode === 'keyboard') {
        currentY = (keysRef.current.down ? 1 : 0) - (keysRef.current.up ? 1 : 0);
        currentX = (keysRef.current.right ? 1 : 0) - (keysRef.current.left ? 1 : 0);
      } else if (controlMode === 'touch' || isFullscreen) {
        // Kontrol layar sentuh aktif baik di mode touch biasa maupun fullscreen
        currentX = touchStateRef.current.turn;
        currentY = touchStateRef.current.throttle;
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
      sendCommand(currentX, currentY);
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
          
          {/* KOLOM KIRI (KAMERA & TOUCH CONTROLLER) */}
          <div className="lg:col-span-2 flex flex-col gap-4 md:gap-6">
            
            <div className="bg-slate-900/60 rounded-3xl p-3 md:p-4 border border-slate-800 shadow-xl backdrop-blur-sm">
              <div className="flex justify-between items-center mb-2 px-2">
                <h2 className="text-sm font-bold flex items-center gap-2 text-slate-300 uppercase tracking-widest">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span> Live Feed
                </h2>
                {/* TOMBOL PEMICU FULL-SCREEN */}
                <button 
                  onClick={enterFullscreen}
                  className="bg-emerald-500/20 hover:bg-emerald-500/40 text-emerald-400 border border-emerald-500/50 text-[10px] font-bold px-3 py-1 rounded-lg transition-colors flex items-center gap-1"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                  Full Screen
                </button>
              </div>
              <div className="aspect-video bg-black rounded-2xl overflow-hidden flex items-center justify-center border border-slate-950 shadow-inner relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={streamUrl} alt="Robot view" className="w-full h-full object-contain pointer-events-auto" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              </div>
            </div>

            {/* DUAL-PAD SPLIT CONTROLLER UI BAWAAN */}
            {controlMode === 'touch' && (
              <div className="bg-slate-900/80 p-4 md:p-6 rounded-3xl border border-slate-800 shadow-2xl flex flex-row justify-around items-center backdrop-blur-md select-none">
                
                {/* SISI KIRI: BELOK */}
                <div className="flex flex-col items-center gap-3">
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest pointer-events-none">Steering</div>
                  <div className="flex gap-2 sm:gap-3 bg-slate-950/50 p-2 sm:p-2.5 rounded-[2rem] border border-slate-800/50 shadow-inner">
                    <button
                      onPointerDown={() => { touchStateRef.current.turn = -0.6; }}
                      onPointerUp={() => { touchStateRef.current.turn = 0; }}
                      onPointerLeave={() => { touchStateRef.current.turn = 0; }}
                      className="w-16 h-16 sm:w-20 sm:h-20 bg-gradient-to-b from-emerald-500 to-emerald-700 active:from-emerald-400 active:to-emerald-600 rounded-2xl shadow-[0_4px_15px_rgba(16,185,129,0.2)] flex items-center justify-center transition-transform active:scale-90 touch-none border border-emerald-400/20"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 sm:h-10 sm:w-10 text-white drop-shadow-md pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                      </svg>
                    </button>
                    <button
                      onPointerDown={() => { touchStateRef.current.turn = 0.6; }}
                      onPointerUp={() => { touchStateRef.current.turn = 0; }}
                      onPointerLeave={() => { touchStateRef.current.turn = 0; }}
                      className="w-16 h-16 sm:w-20 sm:h-20 bg-gradient-to-b from-emerald-500 to-emerald-700 active:from-emerald-400 active:to-emerald-600 rounded-2xl shadow-[0_4px_15px_rgba(16,185,129,0.2)] flex items-center justify-center transition-transform active:scale-90 touch-none border border-emerald-400/20"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 sm:h-10 sm:w-10 text-white drop-shadow-md pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* SISI KANAN: THROTTLE */}
                <div className="flex flex-col items-center gap-3">
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest pointer-events-none">Throttle</div>
                  <div className="flex flex-col gap-2 sm:gap-3 bg-slate-950/50 p-2 sm:p-2.5 rounded-[2rem] border border-slate-800/50 shadow-inner">
                    <button
                      onPointerDown={() => { touchStateRef.current.throttle = -0.6; }}
                      onPointerUp={() => { touchStateRef.current.throttle = 0; }}
                      onPointerLeave={() => { touchStateRef.current.throttle = 0; }}
                      className="w-20 h-12 sm:w-28 sm:h-14 bg-gradient-to-b from-emerald-500 to-emerald-700 active:from-emerald-400 active:to-emerald-600 rounded-2xl shadow-[0_4px_15px_rgba(16,185,129,0.2)] flex items-center justify-center transition-transform active:scale-90 touch-none border border-emerald-400/20"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 sm:h-8 sm:w-8 text-white drop-shadow-md pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                      </svg>
                    </button>
                    <button
                      onPointerDown={() => { touchStateRef.current.throttle = 0.6; }}
                      onPointerUp={() => { touchStateRef.current.throttle = 0; }}
                      onPointerLeave={() => { touchStateRef.current.throttle = 0; }}
                      className="w-20 h-12 sm:w-28 sm:h-14 bg-gradient-to-b from-amber-500 to-amber-700 active:from-amber-400 active:to-amber-600 rounded-2xl shadow-[0_4px_15px_rgba(245,158,11,0.2)] flex items-center justify-center transition-transform active:scale-90 touch-none border border-amber-400/20"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 sm:h-8 sm:w-8 text-white drop-shadow-md pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                      </svg>
                    </button>
                  </div>
                </div>

              </div>
            )}
          </div>

          {/* KOLOM KANAN (STATUS & AKSI RUTE) */}
          <div className="bg-slate-900/60 rounded-3xl p-5 md:p-6 border border-slate-800 shadow-xl flex flex-col justify-between backdrop-blur-sm">
            <div>
              <h2 className="text-sm font-bold mb-4 md:mb-5 border-b border-slate-800 pb-3 flex justify-between items-center text-slate-300 uppercase tracking-widest">
                <span>Status Kontrol</span>
                {controlMode === 'gamepad' && ( <button onClick={forceScanGamepad} className="text-[10px] bg-slate-800 hover:bg-slate-700 py-1 px-2 rounded-md transition-colors">Pindai Ulang</button> )}
              </h2>
              
              <div className="flex flex-col gap-4 md:gap-5">
                <div className="bg-slate-950/50 p-3 rounded-xl border border-slate-800/50 text-xs font-mono text-center text-emerald-400 pointer-events-none">
                  {controlMode === 'touch' ? '📱 AKTIF: DUAL-PAD SENTUH' : controlMode === 'keyboard' ? '⌨️ AKTIF: W-A-S-D' : gamepadStatus}
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

            {/* TOMBOL AKSI RUTE */}
            <div className="mt-6 md:mt-8 pt-5 border-t border-slate-800 flex flex-col gap-3">
              <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1 pointer-events-none">Memori Rute</div>
              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={() => handleTouchAction('RECORD')}
                  className="bg-gradient-to-b from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 active:scale-95 text-white font-bold py-3 px-2 rounded-xl text-xs shadow-[0_4px_10px_rgba(239,68,68,0.2)] transition-all flex items-center justify-center gap-1 touch-none"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 pointer-events-none" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /></svg>
                  <span className="pointer-events-none drop-shadow-sm">Rekam</span>
                </button>
                <button 
                  onClick={() => handleTouchAction('SAVE')}
                  className="bg-gradient-to-b from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 active:scale-95 text-white font-bold py-3 px-2 rounded-xl text-xs shadow-[0_4px_10px_rgba(245,158,11,0.2)] transition-all flex items-center justify-center gap-1 touch-none"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                  <span className="pointer-events-none drop-shadow-sm">Simpan</span>
                </button>
                <button 
                  onClick={() => handleTouchAction('PLAY_FWD')}
                  className="bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 active:scale-95 text-white font-bold py-3 px-2 rounded-xl text-[11px] shadow-[0_4px_10px_rgba(16,185,129,0.2)] transition-all flex items-center justify-center gap-1 touch-none"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 pointer-events-none" fill="currentColor" viewBox="0 0 24 24"><path d="M5 3l14 9-14 9V3z" /></svg>
                  <span className="pointer-events-none drop-shadow-sm">Play Fwd</span>
                </button>
                <button 
                  onClick={() => handleTouchAction('PLAY_REV')}
                  className="bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 active:scale-95 text-white font-bold py-3 px-2 rounded-xl text-[11px] shadow-[0_4px_10px_rgba(59,130,246,0.2)] transition-all flex items-center justify-center gap-1 touch-none"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  <span className="pointer-events-none drop-shadow-sm">Play Rev</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* OVERLAY LAYAR PENUH (FULL SCREEN) */}
      {isFullscreen && (
        <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center overflow-hidden touch-none select-none">
          
          {/* Live Feed Video Background */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img 
            src={streamUrl} 
            alt="Robot Fullscreen" 
            className="absolute inset-0 w-full h-full object-contain pointer-events-none" 
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />

          {/* Tombol Keluar (Pojok Kanan Atas) */}
          <button 
            onClick={exitFullscreen}
            className="absolute top-4 right-4 z-[101] bg-white/10 hover:bg-white/30 px-4 py-2 rounded-full text-white text-xs font-bold backdrop-blur-md pointer-events-auto border border-white/20 shadow-lg"
          >
            ✕ Keluar
          </button>

          {/* AREA KONTROL OVERLAY */}
          <div className="absolute inset-0 z-[101] flex flex-row items-end justify-between px-6 md:px-12 pb-6 md:pb-8 pointer-events-none">
            
            {/* KIRI: Tombol Kiri & Kanan (Steering) */}
            <div className="flex gap-1 md:gap-2 pointer-events-auto shadow-2xl rounded-2xl">
              <button 
                onPointerDown={() => { touchStateRef.current.turn = -1; }}
                onPointerUp={() => { touchStateRef.current.turn = 0; }}
                onPointerLeave={() => { touchStateRef.current.turn = 0; }}
                className="w-16 h-20 md:w-20 md:h-24 bg-red-600/50 active:bg-red-500 flex items-center justify-center rounded-l-xl border-r border-red-800/30 backdrop-blur-sm transition-colors"
              >
                <svg className="w-8 h-8 md:w-10 md:h-10 text-white/80 pointer-events-none" fill="currentColor" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7v14z"/></svg>
              </button>
              <button 
                onPointerDown={() => { touchStateRef.current.turn = 1; }}
                onPointerUp={() => { touchStateRef.current.turn = 0; }}
                onPointerLeave={() => { touchStateRef.current.turn = 0; }}
                className="w-16 h-20 md:w-20 md:h-24 bg-red-600/50 active:bg-red-500 flex items-center justify-center rounded-r-xl backdrop-blur-sm transition-colors"
              >
                <svg className="w-8 h-8 md:w-10 md:h-10 text-white/80 pointer-events-none" fill="currentColor" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7V5z"/></svg>
              </button>
            </div>

            {/* TENGAH: 4 Tombol Aksi (D-Pad Style) */}
            <div className="relative w-28 h-28 md:w-36 md:h-36 pointer-events-auto mb-2">
              {/* Tombol Atas (Rekam) */}
              <button onClick={() => handleTouchAction('RECORD')} className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-10 md:w-12 md:h-12 bg-red-600/50 active:bg-red-500 rounded-full flex items-center justify-center shadow-lg backdrop-blur-sm transition-colors">
                <svg className="w-5 h-5 md:w-6 md:h-6 text-white/80 pointer-events-none" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /></svg>
              </button>
              {/* Tombol Bawah (Simpan) */}
              <button onClick={() => handleTouchAction('SAVE')} className="absolute bottom-0 left-1/2 -translate-x-1/2 w-10 h-10 md:w-12 md:h-12 bg-red-600/50 active:bg-red-500 rounded-full flex items-center justify-center shadow-lg backdrop-blur-sm transition-colors">
                <svg className="w-5 h-5 md:w-6 md:h-6 text-white/80 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
              </button>
              {/* Tombol Kiri (Play Rev) */}
              <button onClick={() => handleTouchAction('PLAY_REV')} className="absolute left-0 top-1/2 -translate-y-1/2 w-10 h-10 md:w-12 md:h-12 bg-red-600/50 active:bg-red-500 rounded-full flex items-center justify-center shadow-lg backdrop-blur-sm transition-colors">
                <svg className="w-5 h-5 md:w-6 md:h-6 text-white/80 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              </button>
              {/* Tombol Kanan (Play Fwd) */}
              <button onClick={() => handleTouchAction('PLAY_FWD')} className="absolute right-0 top-1/2 -translate-y-1/2 w-10 h-10 md:w-12 md:h-12 bg-red-600/50 active:bg-red-500 rounded-full flex items-center justify-center shadow-lg backdrop-blur-sm transition-colors">
                 <svg className="w-5 h-5 md:w-6 md:h-6 text-white/80 pointer-events-none" fill="currentColor" viewBox="0 0 24 24"><path d="M5 3l14 9-14 9V3z" /></svg>
              </button>
            </div>

            {/* KANAN: Tombol Atas & Bawah (Throttle) */}
            <div className="flex flex-col gap-1 md:gap-2 pointer-events-auto shadow-2xl rounded-2xl">
              <button 
                onPointerDown={() => { touchStateRef.current.throttle = -1; }}
                onPointerUp={() => { touchStateRef.current.throttle = 0; }}
                onPointerLeave={() => { touchStateRef.current.throttle = 1; }}
                className="w-20 h-16 md:w-24 md:h-20 bg-red-600/50 active:bg-red-500 flex items-center justify-center rounded-t-xl border-b border-red-800/30 backdrop-blur-sm transition-colors"
              >
                <svg className="w-8 h-8 md:w-10 md:h-10 text-white/80 pointer-events-none" fill="currentColor" viewBox="0 0 24 24"><path d="M5 15l7-7 7 7H5z"/></svg>
              </button>
              <button 
                onPointerDown={() => { touchStateRef.current.throttle = 1; }}
                onPointerUp={() => { touchStateRef.current.throttle = 0; }}
                onPointerLeave={() => { touchStateRef.current.throttle = 0; }}
                className="w-20 h-16 md:w-24 md:h-20 bg-red-600/50 active:bg-red-500 flex items-center justify-center rounded-b-xl backdrop-blur-sm transition-colors"
              >
                <svg className="w-8 h-8 md:w-10 md:h-10 text-white/80 pointer-events-none" fill="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7h14z"/></svg>
              </button>
            </div>

          </div>
        </div>
      )}

    </main>
  );
}
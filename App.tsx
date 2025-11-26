import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Play, Square, RefreshCw, Settings, Send, Radio, Activity, Plus, Usb, AlertTriangle, ExternalLink } from 'lucide-react';
import { SerialConfig, ConnectionStatus, LogEntry, ChartDataPoint } from './types';
import { 
  formatHexString, 
  hexToUint8Array, 
  uint8ArrayToHex, 
  bytesToDecimal, 
  decimalToBytes 
} from './utils/hexUtils';
import { Terminal } from './components/Terminal';
import { ChartPanel } from './components/ChartPanel';

// Web Serial API Type Definitions
interface SerialPort {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: {
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: 'none' | 'even' | 'odd';
  }): Promise<void>;
  close(): Promise<void>;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
}

declare global {
  interface Navigator {
    serial: {
      requestPort(options?: any): Promise<SerialPort>;
      getPorts(): Promise<SerialPort[]>;
      addEventListener(type: string, listener: (e: any) => void): void;
      removeEventListener(type: string, listener: (e: any) => void): void;
    };
  }
}

// Default instruction: 05 43 46 0D 46 04 00 0D
const DEFAULT_HEX = "05 43 46 0D 46 04 00 0D";
const DEFAULT_BAUD = 115200;

export default function App() {
  // Browser Support & Environment Check
  const [isSupported, setIsSupported] = useState(true);
  const [isIframe, setIsIframe] = useState(false);

  // Serial Port State
  const [port, setPort] = useState<SerialPort | null>(null);
  const [knownPorts, setKnownPorts] = useState<SerialPort[]>([]);
  const [selectedPortIndex, setSelectedPortIndex] = useState<number>(0);
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  const [reader, setReader] = useState<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const [writer, setWriter] = useState<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  
  // App Config State
  const [config, setConfig] = useState<SerialConfig>({
    baudRate: DEFAULT_BAUD,
    dataBits: 8,
    stopBits: 1,
    parity: 'none'
  });
  
  // Data State
  const [inputHex, setInputHex] = useState(DEFAULT_HEX);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  
  // Auto Send Logic State
  const [isAutoSending, setIsAutoSending] = useState(false);
  const [autoIntervalMs, setAutoIntervalMs] = useState(100);
  const [counter, setCounter] = useState(0); // This tracks the 00 00 -> 00 03 increment
  
  // Refs for loop management
  const autoSendTimerRef = useRef<number | null>(null);
  const counterRef = useRef(0);
  const portRef = useRef<SerialPort | null>(null); // Ref to keep track of port for cleanup

  // ---------------------------------------------------------------------------
  // Init: Check Support & Load Known Ports
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Check if running in iframe
    try {
      if (window.self !== window.top) {
        setIsIframe(true);
      }
    } catch (e) {
      setIsIframe(true);
    }

    const checkSupport = async () => {
      if (!('serial' in navigator)) {
        setIsSupported(false);
        return;
      }
      
      try {
        const ports = await navigator.serial.getPorts();
        setKnownPorts(ports);
        if (ports.length > 0) {
          setSelectedPortIndex(0);
        }
      } catch (e) {
        console.error("Failed to get ports", e);
      }
    };
    checkSupport();

    const handlePortChange = () => {
      checkSupport();
    };

    if ('serial' in navigator) {
      navigator.serial.addEventListener('connect', handlePortChange);
      navigator.serial.addEventListener('disconnect', handlePortChange);
    }
    
    return () => {
      if ('serial' in navigator) {
        navigator.serial.removeEventListener('connect', handlePortChange);
        navigator.serial.removeEventListener('disconnect', handlePortChange);
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Helper: Logging
  // ---------------------------------------------------------------------------
  const addLog = useCallback((type: LogEntry['type'], data: string) => {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
    
    setLogs(prev => {
      const newLogs = [...prev, {
        id: crypto.randomUUID(),
        timestamp: timeStr,
        type,
        data
      }];
      if (newLogs.length > 500) return newLogs.slice(newLogs.length - 500); // Keep last 500
      return newLogs;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Serial Connection Management
  // ---------------------------------------------------------------------------
  
  const handleRequestPort = async () => {
    if (!isSupported) return;
    try {
      const newPort = await navigator.serial.requestPort();
      const currentPorts = await navigator.serial.getPorts();
      setKnownPorts(currentPorts);
      // Find the new port index
      const newIndex = currentPorts.indexOf(newPort);
      if (newIndex !== -1) {
        setSelectedPortIndex(newIndex);
      }
    } catch (err: any) {
      console.error("Request port error:", err);
      if (err.name === 'NotFoundError') {
        // User cancelled the dialog, usually harmless
        return;
      }
      if (err.name === 'SecurityError') {
        alert("Permission Blocked by Editor Preview.\n\nPlease find the 'Open in New Window' or 'Pop out' button in your editor's toolbar to run this app in a standard browser tab.");
      } else {
        alert(`Error selecting port: ${err.message || err.toString()}`);
      }
    }
  };

  const openPort = async () => {
    if (!isSupported) {
      alert("Web Serial API is not supported in this browser. Please use Chrome, Edge, or Opera.");
      return;
    }

    let targetPort = knownPorts[selectedPortIndex];

    // Case: No ports available in list, force user to pick one
    if (!targetPort) {
      try {
        targetPort = await navigator.serial.requestPort();
        const currentPorts = await navigator.serial.getPorts();
        setKnownPorts(currentPorts);
        const idx = currentPorts.indexOf(targetPort);
        if (idx !== -1) setSelectedPortIndex(idx);
      } catch (err: any) {
        if (err.name === 'NotFoundError') return; // User cancelled
        
        if (err.name === 'SecurityError') {
           alert("Permission Blocked by Editor Preview.\n\nPlease find the 'Open in New Window' or 'Pop out' button in your editor's toolbar to run this app in a standard browser tab.");
           return;
        }
        
        alert(`Failed to select port: ${err.message}`);
        return; 
      }
    }

    if (!targetPort) return;

    try {
      setStatus(ConnectionStatus.CONNECTING);
      
      await targetPort.open({
        baudRate: config.baudRate,
        dataBits: config.dataBits,
        stopBits: config.stopBits,
        parity: config.parity
      });

      setPort(targetPort);
      portRef.current = targetPort;
      
      // Setup Writer
      if (targetPort.writable) {
        const writer = targetPort.writable.getWriter();
        setWriter(writer);
      }

      setStatus(ConnectionStatus.CONNECTED);
      
      const info = targetPort.getInfo();
      const pidLabel = info.usbProductId ? ` (PID: ${info.usbProductId.toString(16)})` : '';
      addLog('info', `Connected to Port ${selectedPortIndex + 1}${pidLabel} @ ${config.baudRate}`);

      // Start Reading Loop
      readLoop(targetPort);

    } catch (err: any) {
      console.error(err);
      setStatus(ConnectionStatus.ERROR);
      addLog('error', `Connection failed: ${err.message}`);
      
      let msg = `Could not connect: ${err.message}`;
      if (err.message.includes('locked')) {
        msg += "\nThe port is used by another app (or this app in another tab).";
      }
      alert(msg);
      
      setPort(null);
      portRef.current = null;
    }
  };

  const disconnectPort = async () => {
    setIsAutoSending(false); // Stop loop first

    try {
      if (reader) {
        await reader.cancel();
        setReader(null);
      }
      if (writer) {
        writer.releaseLock();
        setWriter(null);
      }
      if (port) {
        await port.close();
        setPort(null);
        portRef.current = null;
      }
      setStatus(ConnectionStatus.DISCONNECTED);
      addLog('info', 'Port disconnected.');
    } catch (e: any) {
      console.error("Error closing port:", e);
      // Force reset state even if error
      setStatus(ConnectionStatus.DISCONNECTED);
      setPort(null);
    }
  };

  const readLoop = async (currentPort: SerialPort) => {
    if (!currentPort.readable) return;
    
    const portReader = currentPort.readable.getReader();
    setReader(portReader);

    try {
      while (true) {
        const { value, done } = await portReader.read();
        if (done) {
          // Reader has been canceled.
          break;
        }
        if (value) {
          handleDataReceived(value);
        }
      }
    } catch (error) {
      console.error("Read error:", error);
      addLog('error', 'Read Error. Port might be disconnected.');
      // Optionally trigger disconnect logic here
    } finally {
      portReader.releaseLock();
    }
  };

  // ---------------------------------------------------------------------------
  // Data Handling Logic
  // ---------------------------------------------------------------------------
  const handleDataReceived = (data: Uint8Array) => {
    const hexStr = uint8ArrayToHex(data);
    addLog('rx', hexStr);

    // Parsing specific byte requirement (Bytes 7-8 1-based index -> 6-7 0-based)
    // Prompt says: "收到指令的相应第7 8字节" (indices 6 and 7)
    if (data.length >= 8) {
      const val = bytesToDecimal(data[6], data[7]);
      
      const now = new Date();
      const timeLabel = `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`;

      setChartData(prev => {
        const newData = [...prev];
        if (newData.length > 50) newData.shift();
        
        newData.push({
          time: timeLabel,
          sentValue: null,
          receivedValue: val
        });
        return newData;
      });
    }
  };

  const sendData = async (hexString: string, isAuto = false): Promise<void> => {
    if (!writer || status !== ConnectionStatus.CONNECTED) {
      addLog('error', 'Port not open');
      return;
    }

    try {
      const data = hexToUint8Array(hexString);
      await writer.write(data);
      addLog('tx', formatHexString(hexString));

      // Parsing specific byte requirement (Bytes 4-5 1-based index -> 3-4 0-based)
      if (data.length >= 5) {
        const val = bytesToDecimal(data[3], data[4]);
        
        const now = new Date();
        const timeLabel = `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`;

        setChartData(prev => {
          const newData = [...prev];
          if (newData.length > 50) newData.shift();
          newData.push({
            time: timeLabel,
            sentValue: val,
            receivedValue: null
          });
          return newData;
        });
      }

    } catch (err: any) {
      addLog('error', `Send failed: ${err.message}`);
      setIsAutoSending(false); // Stop loop on error
    }
  };

  // ---------------------------------------------------------------------------
  // Auto Send / Loop Logic
  // ---------------------------------------------------------------------------
  
  useEffect(() => {
    counterRef.current = counter;
  }, [counter]);

  const tickAutoSend = useCallback(async () => {
    try {
      let baseBytes = Array.from(hexToUint8Array(inputHex));
      
      if (baseBytes.length < 5) {
        addLog('error', 'Base command too short for auto-increment logic');
        setIsAutoSending(false);
        return;
      }

      const currentVal = counterRef.current;
      const [high, low] = decimalToBytes(currentVal);
      
      baseBytes[3] = high;
      baseBytes[4] = low;
      
      const newHexStr = uint8ArrayToHex(new Uint8Array(baseBytes));
      await sendData(newHexStr, true);

      counterRef.current = currentVal + 3;
      setCounter(counterRef.current);

    } catch (e) {
      setIsAutoSending(false);
      addLog('error', 'Invalid Hex in input field');
    }
  }, [inputHex, sendData, addLog]);


  useEffect(() => {
    if (isAutoSending && status === ConnectionStatus.CONNECTED) {
      autoSendTimerRef.current = window.setInterval(tickAutoSend, autoIntervalMs);
    } else {
      if (autoSendTimerRef.current) {
        clearInterval(autoSendTimerRef.current);
        autoSendTimerRef.current = null;
      }
    }
    return () => {
      if (autoSendTimerRef.current) clearInterval(autoSendTimerRef.current);
    };
  }, [isAutoSending, status, autoIntervalMs, tickAutoSend]);

  const toggleAutoSend = () => {
    if (isAutoSending) {
      setIsAutoSending(false);
    } else {
      setCounter(0);
      counterRef.current = 0;
      setIsAutoSending(true);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="flex flex-col h-full bg-slate-950 p-4 gap-4">
      
      {/* IFRAME / UNSUPPORTED BANNER */}
      {isIframe && (
         <div className="bg-amber-900/50 border border-amber-500 text-amber-100 p-3 rounded flex items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-3">
             <AlertTriangle className="shrink-0 text-amber-400" />
             <div>
               <p className="font-bold">Preview Mode Detected</p>
               <p className="text-sm">Browser security blocks Serial Port access in this preview window. </p>
             </div>
          </div>
          <div className="text-xs bg-amber-800/50 px-3 py-1 rounded text-amber-200 border border-amber-700">
             Please use the <strong>"Open in New Window"</strong> button in your editor toolbar
          </div>
        </div>
      )}

      {!isSupported && !isIframe && (
        <div className="bg-red-900/50 border border-red-500 text-red-100 p-3 rounded flex items-center gap-3">
          <AlertTriangle className="shrink-0" />
          <div>
            <p className="font-bold">Web Serial API Not Supported</p>
            <p className="text-sm">Please use a Chromium-based browser (Chrome, Edge, Opera) on Desktop.</p>
          </div>
        </div>
      )}

      {/* HEADER & SETTINGS */}
      <header className="flex flex-wrap items-center justify-between gap-4 p-4 bg-slate-900 rounded-lg border border-slate-800 shadow-md">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-600 rounded-lg shadow-lg shadow-blue-900/50">
            <Activity className="text-white" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-100">HexSerial Viz</h1>
            <div className="flex items-center gap-2 text-xs">
              <span className={`w-2 h-2 rounded-full ${status === ConnectionStatus.CONNECTED ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
              <span className="text-slate-400 uppercase">{status}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          
          {/* Port Selection Group */}
          <div className="flex flex-col gap-1">
             <label className="text-xs text-slate-500 uppercase font-bold flex items-center gap-1">
                <Usb size={12} /> Port Selection
             </label>
             <div className="flex gap-1 relative">
                <select 
                  className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-l px-2 py-1 outline-none focus:border-blue-500 min-w-[120px]"
                  value={selectedPortIndex}
                  onChange={(e) => setSelectedPortIndex(Number(e.target.value))}
                  disabled={status === ConnectionStatus.CONNECTED || !isSupported}
                >
                  {knownPorts.length === 0 && <option value={0}>Click (+) to add --&gt;</option>}
                  {knownPorts.map((p, idx) => {
                    const info = p.getInfo();
                    const name = info.usbVendorId 
                      ? `Port ${idx + 1} (ID:${info.usbVendorId.toString(16).toUpperCase()})` 
                      : `Port ${idx + 1}`;
                    return <option key={idx} value={idx}>{name}</option>;
                  })}
                </select>
                <button 
                  onClick={handleRequestPort}
                  disabled={status === ConnectionStatus.CONNECTED || !isSupported}
                  className={`
                    bg-slate-700 hover:bg-slate-600 text-slate-200 px-2 rounded-r border-t border-r border-b border-slate-700 flex items-center justify-center disabled:opacity-50 transition-colors
                    ${knownPorts.length === 0 ? 'animate-pulse ring-2 ring-blue-500' : ''}
                  `}
                  title="Grant Permission to New Device"
                >
                  <Plus size={16} />
                </button>
             </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500 uppercase font-bold">Baud Rate</label>
            <select 
              className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-2 py-1 outline-none focus:border-blue-500"
              value={config.baudRate}
              disabled={status === ConnectionStatus.CONNECTED}
              onChange={(e) => setConfig({...config, baudRate: Number(e.target.value)})}
            >
              {[9600, 19200, 38400, 57600, 115200, 230400, 921600].map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
             <label className="text-xs text-slate-500 uppercase font-bold">Settings</label>
             <div className="flex gap-1 text-xs font-mono">
               <span className="bg-slate-800 text-slate-400 px-2 py-1 rounded border border-slate-700">8-N-1</span>
             </div>
          </div>

          <button
            onClick={status === ConnectionStatus.CONNECTED ? disconnectPort : openPort}
            disabled={!isSupported}
            className={`
              flex items-center gap-2 px-6 py-2 rounded font-bold transition-all shadow-lg ml-2 disabled:opacity-50 disabled:cursor-not-allowed
              ${status === ConnectionStatus.CONNECTED 
                ? 'bg-red-600 hover:bg-red-700 text-white shadow-red-900/50' 
                : 'bg-green-600 hover:bg-green-700 text-white shadow-green-900/50'}
            `}
          >
            {status === ConnectionStatus.CONNECTED ? (
              <>
                <Square size={16} fill="currentColor" /> Disconnect
              </>
            ) : (
              <>
                <Settings size={16} /> Connect
              </>
            )}
          </button>
        </div>
      </header>

      {/* MAIN CONTENT GRID */}
      <main className="flex-1 grid grid-rows-[1.5fr_1fr] md:grid-rows-1 md:grid-cols-[400px_1fr] gap-4 min-h-0">
        
        {/* LEFT PANEL: CONTROLS & LOGS */}
        <div className="flex flex-col gap-4 min-h-0">
          
          {/* CONTROL BOX */}
          <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 shadow-lg space-y-4">
            <h3 className="text-slate-400 text-sm font-bold uppercase tracking-wider flex items-center gap-2">
              <Radio size={16} /> Transmission Control
            </h3>
            
            <div className="space-y-2">
              <label className="text-xs text-slate-500">Hex Payload (Bytes 4 & 5 auto-update)</label>
              <textarea 
                className="w-full h-24 bg-slate-950 border border-slate-700 rounded p-2 text-slate-200 font-mono text-sm resize-none focus:border-blue-500 outline-none"
                value={inputHex}
                onChange={(e) => setInputHex(formatHexString(e.target.value))}
                spellCheck={false}
              />
            </div>

            <div className="flex items-center gap-2">
              <button 
                onClick={() => sendData(inputHex)}
                disabled={status !== ConnectionStatus.CONNECTED || isAutoSending}
                className="flex-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-blue-400 border border-slate-700 py-2 rounded flex items-center justify-center gap-2 font-semibold transition-colors"
              >
                <Send size={16} /> Send Once
              </button>
            </div>

            <div className="border-t border-slate-800 pt-4 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold text-slate-300">Auto Increment Loop</span>
                <span className="text-xs text-slate-500 bg-slate-950 px-2 py-1 rounded font-mono">
                  Val: {counter} (0x{counter.toString(16).padStart(4, '0')})
                </span>
              </div>
              
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="text-xs text-slate-500 block mb-1">Interval (ms)</label>
                  <input 
                    type="number" 
                    value={autoIntervalMs}
                    onChange={(e) => setAutoIntervalMs(Math.max(50, Number(e.target.value)))}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm text-center"
                  />
                </div>
                <button 
                  onClick={toggleAutoSend}
                  disabled={status !== ConnectionStatus.CONNECTED}
                  className={`
                    flex-1 py-4 rounded font-bold flex flex-col items-center justify-center gap-1 transition-all
                    ${isAutoSending 
                      ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-lg shadow-amber-900/50' 
                      : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-900/50 disabled:bg-slate-800 disabled:text-slate-600'}
                  `}
                >
                  {isAutoSending ? (
                    <>
                      <Square size={20} fill="currentColor" /> Stop
                    </>
                  ) : (
                    <>
                      <RefreshCw size={20} /> Start Loop
                    </>
                  )}
                </button>
              </div>
              <p className="text-[10px] text-slate-500 leading-tight">
                * Replaces bytes 4 & 5 (0-indexed 3 & 4) of Hex Payload. Starts at 0, increments by 3.
              </p>
            </div>
          </div>

          {/* TERMINAL */}
          <div className="flex-1 min-h-0">
            <Terminal logs={logs} clearLogs={() => setLogs([])} />
          </div>

        </div>

        {/* RIGHT PANEL: CHART */}
        <div className="h-full min-h-[300px]">
          <ChartPanel data={chartData} />
        </div>

      </main>
    </div>
  );
}
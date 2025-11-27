import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Play, Square, RefreshCw, Settings, Send, Radio, Activity, Plus, Usb, AlertTriangle, ArrowRightLeft, Hash, X, ArrowDownToLine, Monitor, ShieldCheck, Loader2, Clock, BarChart2 } from 'lucide-react';
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
  const [showSettings, setShowSettings] = useState(false);
  const [config, setConfig] = useState<SerialConfig>({
    baudRate: DEFAULT_BAUD,
    dataBits: 8,
    stopBits: 1,
    parity: 'none'
  });
  
  // Data State
  const [manualHex, setManualHex] = useState(DEFAULT_HEX); // Separate input for Manual
  const [sweepBaseHex, setSweepBaseHex] = useState(DEFAULT_HEX); // Separate input for Sweep Base
  
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const fullLogHistory = useRef<string[]>([]); // Stores FULL history for export
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [lastReceivedValue, setLastReceivedValue] = useState<number | null>(null);
  const [isRxInvalid, setIsRxInvalid] = useState(false); // Used to display "INVALID"
  
  // Statistics State
  const [stats, setStats] = useState({ tx: 0, rx: 0, invalid: 0 });
  const [elapsedTime, setElapsedTime] = useState("00:00:00");
  const startTimeRef = useRef<number | null>(null);

  // Sweep / Auto Send Logic State
  const [isAutoSending, setIsAutoSending] = useState(false);
  const [autoIntervalMs, setAutoIntervalMs] = useState(100);
  const [isRetrying, setIsRetrying] = useState(false); // UI State for visual feedback
  
  // Sweep Configuration
  const [rangeStartHex, setRangeStartHex] = useState<string>("0000");
  const [rangeEndHex, setRangeEndHex] = useState<string>("00C8"); // 200 decimal
  const [incrementStep, setIncrementStep] = useState<number>(3);
  
  // Byte Manipulation Config (TX)
  const [targetByteIndex, setTargetByteIndex] = useState<number>(3); // Index of the first byte to modify
  const [isBigEndian, setIsBigEndian] = useState<boolean>(true); // true = High First

  // Byte Parsing Config (RX)
  const [rxByteIndex, setRxByteIndex] = useState<number>(6); // Default to 7th byte (Index 6)
  const [rxIsBigEndian, setRxIsBigEndian] = useState<boolean>(true); // Default High First
  const [enableHeaderCheck, setEnableHeaderCheck] = useState<boolean>(true); // Strict Validation DEFAULT TRUE
  
  const [counter, setCounter] = useState(0); 

  // Refs for loop management and data correlation
  const autoSendTimerRef = useRef<number | null>(null);
  const counterRef = useRef(0);
  const pendingFrequencyRef = useRef<number | null>(null); // Stores the Freq of the sent command
  const lastSentHexRef = useRef<string | null>(null); // Stores the last sent hex for retry logic
  const waitingForResponseRef = useRef<boolean>(false); // Lock-step mechanism
  const portRef = useRef<SerialPort | null>(null);

  // RX Buffer for reassembling fragmented packets
  const rxBuffer = useRef<Uint8Array>(new Uint8Array(0));

  // ---------------------------------------------------------------------------
  // Init: Check Support & Load Known Ports
  // ---------------------------------------------------------------------------
  useEffect(() => {
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
  // Timer for Sweep Stats
  // ---------------------------------------------------------------------------
  const formatDuration = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    let timerId: number;
    if (isAutoSending && startTimeRef.current) {
      timerId = window.setInterval(() => {
        const diff = Date.now() - (startTimeRef.current || Date.now());
        setElapsedTime(formatDuration(diff));
      }, 1000);
    }
    return () => clearInterval(timerId);
  }, [isAutoSending]);

  // ---------------------------------------------------------------------------
  // Helper: Logging & Export
  // ---------------------------------------------------------------------------
  const getTimestamp = () => {
    const now = new Date();
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
  };

  const addLog = useCallback((type: LogEntry['type'], data: string) => {
    const timeStr = getTimestamp();
    
    // 1. Update Full History (Memory)
    const logLine = `[${timeStr}] ${type.toUpperCase().padEnd(5)}: ${data}`;
    fullLogHistory.current.push(logLine);

    // 2. Update UI State (Capped)
    setLogs(prev => {
      const newLogs = [...prev, {
        id: crypto.randomUUID(),
        timestamp: timeStr,
        type,
        data
      }];
      if (newLogs.length > 500) return newLogs.slice(newLogs.length - 500); 
      return newLogs;
    });
  }, []);

  const handleExportLogs = async () => {
    if (fullLogHistory.current.length === 0) {
      alert("No logs to export.");
      return;
    }

    const content = fullLogHistory.current.join('\n');
    
    try {
      // Use File System Access API if available
      if ('showSaveFilePicker' in window) {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: 'serial_logs.txt',
          types: [{
            description: 'Text Files',
            accept: { 'text/plain': ['.txt'] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        addLog('info', 'Logs saved to file.');
      } else {
        // Fallback for browsers without File System API
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'serial_logs.txt';
        a.click();
        URL.revokeObjectURL(url);
        addLog('info', 'Logs downloaded.');
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error("Export failed:", err);
        addLog('error', `Export failed: ${err.message}`);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Serial Connection Management
  // ---------------------------------------------------------------------------
  
  const handleRequestPort = async () => {
    if (!isSupported) return;
    try {
      const newPort = await navigator.serial.requestPort();
      const currentPorts = await navigator.serial.getPorts();
      setKnownPorts(currentPorts);
      const newIndex = currentPorts.indexOf(newPort);
      if (newIndex !== -1) {
        setSelectedPortIndex(newIndex);
      }
    } catch (err: any) {
      if (err.name === 'NotFoundError') return;
      if (err.name === 'SecurityError') {
        alert("Permission Blocked by Editor Preview.\n\nPlease find the 'Open in New Window' or 'Pop out' button in your editor's toolbar to run this app in a standard browser tab.");
      } else {
        alert(`Error selecting port: ${err.message || err.toString()}`);
      }
    }
  };

  const openPort = async () => {
    if (!isSupported) {
      alert("Web Serial API is not supported in this browser.");
      return;
    }

    let targetPort = knownPorts[selectedPortIndex];

    if (!targetPort) {
      try {
        targetPort = await navigator.serial.requestPort();
        const currentPorts = await navigator.serial.getPorts();
        setKnownPorts(currentPorts);
        const idx = currentPorts.indexOf(targetPort);
        if (idx !== -1) setSelectedPortIndex(idx);
      } catch (err: any) {
        if (err.name === 'NotFoundError') return; 
        if (err.name === 'SecurityError') {
           alert("Permission Blocked by Editor Preview.\n\nPlease find the 'Open in New Window' or 'Pop out' button.");
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
      
      if (targetPort.writable) {
        const writer = targetPort.writable.getWriter();
        setWriter(writer);
      }

      setStatus(ConnectionStatus.CONNECTED);
      const info = targetPort.getInfo();
      addLog('info', `Connected to Port ${selectedPortIndex + 1} @ ${config.baudRate}`);
      
      // Clear buffer on new connection
      rxBuffer.current = new Uint8Array(0);
      readLoop(targetPort);

    } catch (err: any) {
      setStatus(ConnectionStatus.ERROR);
      addLog('error', `Connection failed: ${err.message}`);
      alert(`Could not connect: ${err.message}`);
      setPort(null);
      portRef.current = null;
    }
  };

  const disconnectPort = async () => {
    setIsAutoSending(false);

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
        if (done) break;
        if (value) {
          handleDataReceived(value);
        }
      }
    } catch (error) {
      addLog('error', 'Read Error.');
    } finally {
      portReader.releaseLock();
    }
  };

  const sendData = async (hexString: string): Promise<void> => {
    if (!writer || status !== ConnectionStatus.CONNECTED) {
      addLog('error', 'Port not open');
      return;
    }

    try {
      const data = hexToUint8Array(hexString);
      await writer.write(data);
      addLog('tx', formatHexString(hexString));
      
      // Update TX Stats
      setStats(prev => ({ ...prev, tx: prev.tx + 1 }));

    } catch (err: any) {
      addLog('error', `Send failed: ${err.message}`);
      setIsAutoSending(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Data Handling Logic
  // ---------------------------------------------------------------------------
  
  const handleDataReceived = (chunk: Uint8Array) => {
    const hexStr = uint8ArrayToHex(chunk);
    addLog('rx', hexStr);

    // Universal Buffering: Always accumulate chunks to handle split packets
    const newBuffer = new Uint8Array(rxBuffer.current.length + chunk.length);
    newBuffer.set(rxBuffer.current);
    newBuffer.set(chunk, rxBuffer.current.length);
    rxBuffer.current = newBuffer;

    if (enableHeaderCheck) {
       processRxBuffer();
    } else {
       // --- STANDARD MODE (Manual Index) ---
       if (rxBuffer.current.length > rxByteIndex + 1) {
         const b1 = rxBuffer.current[rxByteIndex];
         const b2 = rxBuffer.current[rxByteIndex + 1];
         parseAndRecord(b1, b2);
         setStats(prev => ({ ...prev, rx: prev.rx + 1 })); // Count simple RX
         rxBuffer.current = new Uint8Array(0); 
       }
    }
  };

  const processRxBuffer = () => {
    const HEADER = [0xFF, 0xFE, 0xFD, 0xFC, 0x02, 0x56];
    const FOOTER = [0xFB, 0xFA, 0xF9, 0xF8]; 
    const PACKET_LEN = 15;

    let buffer = rxBuffer.current;
    let packetFound = false;

    // Scan buffer for header
    let ptr = 0;
    while (ptr <= buffer.length - PACKET_LEN) {
      
      // 1. Check Header
      let isHeader = true;
      for (let i = 0; i < HEADER.length; i++) {
        if (buffer[ptr + i] !== HEADER[i]) {
          isHeader = false;
          break;
        }
      }

      if (isHeader) {
        // 2. Check Footer (starts at offset 11)
        let isFooter = true;
        for (let i = 0; i < FOOTER.length; i++) {
           if (buffer[ptr + 11 + i] !== FOOTER[i]) {
             isFooter = false;
             break;
           }
        }

        if (isFooter) {
          // 3. Validate Range (Bytes 6 & 7)
          const b1 = buffer[ptr + 6];
          const b2 = buffer[ptr + 7];
          
          let val = 0;
          if (rxIsBigEndian) val = bytesToDecimal(b1, b2);
          else val = bytesToDecimal(b2, b1);

          if (val >= 0 && val <= 4096) {
             // === VALID PACKET ===
             packetFound = true;
             parseAndRecord(b1, b2);
             
             // Update Stats
             setStats(prev => ({ ...prev, rx: prev.rx + 1 }));

             // Unlock Loop
             waitingForResponseRef.current = false;
             setIsRetrying(false);
             setIsRxInvalid(false);

             // Consume this packet
             ptr += PACKET_LEN;
             
             // Since we processed a valid packet, we can break or continue.
             // Usually one response per command. We break to allow state updates.
             // Update buffer immediately
             rxBuffer.current = buffer.slice(ptr);
             return; 
          } else {
             // === INVALID RANGE ===
             setStats(prev => ({ ...prev, invalid: prev.invalid + 1 }));
             ptr += PACKET_LEN;
          }
        } else {
           // Header found, but Footer Mismatch. 
           setStats(prev => ({ ...prev, invalid: prev.invalid + 1 }));
           ptr++; 
        }
      } else {
        ptr++;
      }
    }

    // Trim buffer to save memory if we advanced
    if (ptr > 0) {
      rxBuffer.current = buffer.slice(ptr);
    }
    
    // If we are waiting for a response and didn't find a valid one yet:
    if (waitingForResponseRef.current && !packetFound) {
       setIsRxInvalid(true);
       setLastReceivedValue(null);
    }
  };

  const parseAndRecord = (b1: number, b2: number) => {
    let receivedValue = 0;
    if (rxIsBigEndian) {
      receivedValue = bytesToDecimal(b1, b2); 
    } else {
      receivedValue = bytesToDecimal(b2, b1); 
    }
    
    // Real-time value update
    setLastReceivedValue(receivedValue);
    setIsRxInvalid(false);
    
    // Correlate with the last sent frequency if available (Auto Sweep Mode)
    if (pendingFrequencyRef.current !== null) {
      const freq = Number(pendingFrequencyRef.current.toFixed(4));
      
      setChartData(prev => [
        ...prev,
        {
          x: freq, 
          y: receivedValue
        }
      ]);

      const timeStr = getTimestamp();
      const dataLog = `[${timeStr}] DATA : Freq=${freq.toFixed(4)} kHz, RxValue=${receivedValue}`;
      fullLogHistory.current.push(dataLog);
    }
  };


  // ---------------------------------------------------------------------------
  // Auto Send / Loop Logic
  // ---------------------------------------------------------------------------
  
  // Calculate expected total points based on current config
  const totalSweepPoints = useMemo(() => {
    const start = parseInt(rangeStartHex.replace(/[^0-9A-Fa-f]/g, ''), 16);
    const end = parseInt(rangeEndHex.replace(/[^0-9A-Fa-f]/g, ''), 16);
    if (isNaN(start) || isNaN(end) || incrementStep <= 0 || start > end) return 0;
    return Math.floor((end - start) / incrementStep) + 1;
  }, [rangeStartHex, rangeEndHex, incrementStep]);

  // Helper for Freq Calculation (Display)
  const calculateFreqFromHex = (hex: string) => {
    const val = parseInt(hex.replace(/[^0-9A-Fa-f]/g, ''), 16);
    if (isNaN(val)) return "---";
    return ((val / 65536) * 32000).toFixed(3) + " kHz";
  };

  useEffect(() => {
    counterRef.current = counter;
  }, [counter]);

  const currentBytesLength = Math.floor(sweepBaseHex.replace(/[^0-9A-Fa-f]/g, '').length / 2);

  const tickAutoSend = useCallback(async () => {
    try {
      // --- LOCK STEP RETRY LOGIC ---
      if (enableHeaderCheck && waitingForResponseRef.current) {
        if (lastSentHexRef.current) {
          setIsRetrying(true);
          await sendData(lastSentHexRef.current);
        }
        return; 
      }
      // -----------------------------
      
      setIsRetrying(false);

      const endValDecimal = parseInt(rangeEndHex.replace(/[^0-9A-Fa-f]/g, ''), 16);
      
      // 1. Check Range
      if (counterRef.current > endValDecimal) {
        setIsAutoSending(false);
        addLog('info', 'Sweep Complete.');
        return;
      }

      // 2. Prepare Command
      // USE sweepBaseHex here
      let baseBytes = Array.from(hexToUint8Array(sweepBaseHex));
      
      if (targetByteIndex < 0 || targetByteIndex >= baseBytes.length - 1) {
         addLog('error', `Target Byte Index ${targetByteIndex} out of bounds`);
         setIsAutoSending(false);
         return;
      }

      const currentVal = counterRef.current;
      const [high, low] = decimalToBytes(currentVal);
      
      if (isBigEndian) {
        baseBytes[targetByteIndex] = high;
        baseBytes[targetByteIndex + 1] = low;
      } else {
        baseBytes[targetByteIndex] = low;
        baseBytes[targetByteIndex + 1] = high;
      }
      
      // 3. Frequency
      const frequency = (currentVal / 65536) * 32000;
      pendingFrequencyRef.current = frequency;

      // 4. Send
      const newHexStr = uint8ArrayToHex(new Uint8Array(baseBytes));
      lastSentHexRef.current = newHexStr; 
      await sendData(newHexStr);

      // 5. Lock
      if (enableHeaderCheck) {
        waitingForResponseRef.current = true; 
        setIsRxInvalid(false); // Reset invalid state for new attempt
      }

      // 6. Increment
      counterRef.current = currentVal + incrementStep;
      setCounter(counterRef.current);

    } catch (e) {
      setIsAutoSending(false);
      addLog('error', 'Invalid Hex or Config');
    }
  }, [sweepBaseHex, sendData, addLog, rangeEndHex, incrementStep, targetByteIndex, isBigEndian, enableHeaderCheck]);


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
      waitingForResponseRef.current = false;
      setIsRetrying(false);
      rxBuffer.current = new Uint8Array(0); // Clear buffer
      startTimeRef.current = null;
    } else {
      const startDec = parseInt(rangeStartHex.replace(/[^0-9A-Fa-f]/g, ''), 16);
      const endDec = parseInt(rangeEndHex.replace(/[^0-9A-Fa-f]/g, ''), 16);

      if (isNaN(startDec) || isNaN(endDec)) {
        addLog('error', 'Invalid Start/End Hex values');
        return;
      }

      setCounter(startDec);
      counterRef.current = startDec;
      setChartData([]); 
      pendingFrequencyRef.current = null;
      waitingForResponseRef.current = false; 
      setIsRetrying(false);
      setIsRxInvalid(false);
      rxBuffer.current = new Uint8Array(0); // Clear buffer
      
      // Stats Reset
      setStats({ tx: 0, rx: 0, invalid: 0 });
      setElapsedTime("00:00:00");
      startTimeRef.current = Date.now();

      setIsAutoSending(true);
      addLog('info', `Starting Sweep: 0x${rangeStartHex} -> 0x${rangeEndHex}, Step: ${incrementStep}. Expected Points: ${totalSweepPoints}`);
    }
  };

  const clearLogs = () => {
    setLogs([]);
    fullLogHistory.current = [];
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="flex flex-col h-full bg-slate-950 p-4 gap-4 relative">
      
      {/* Settings Modal */}
      {showSettings && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-700 p-6 rounded-lg shadow-2xl w-80 relative flex flex-col gap-4">
            <button 
              onClick={() => setShowSettings(false)} 
              className="absolute top-3 right-3 text-slate-500 hover:text-white transition-colors"
            >
              <X size={20}/>
            </button>
            
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <Settings size={20} className="text-blue-500"/>
              <h2 className="text-lg font-bold text-white">Serial Config</h2>
            </div>

            <div className="space-y-4">
              {/* Baud Rate */}
              <div className="flex flex-col gap-1">
                 <label className="text-xs text-slate-500 uppercase font-bold">Baud Rate</label>
                 <select 
                   className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-3 py-2 outline-none focus:border-blue-500"
                   value={config.baudRate}
                   onChange={(e) => setConfig({...config, baudRate: Number(e.target.value)})}
                 >
                   {[9600, 19200, 38400, 57600, 115200, 230400, 921600].map(r => (
                     <option key={r} value={r}>{r}</option>
                   ))}
                 </select>
              </div>

              {/* Data Bits */}
              <div className="flex flex-col gap-1">
                 <label className="text-xs text-slate-500 uppercase font-bold">Data Bits</label>
                 <select 
                   className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-3 py-2 outline-none focus:border-blue-500"
                   value={config.dataBits}
                   onChange={(e) => setConfig({...config, dataBits: Number(e.target.value)})}
                 >
                   <option value={8}>8</option>
                   <option value={7}>7</option>
                 </select>
              </div>

              {/* Stop Bits */}
              <div className="flex flex-col gap-1">
                 <label className="text-xs text-slate-500 uppercase font-bold">Stop Bits</label>
                 <select 
                   className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-3 py-2 outline-none focus:border-blue-500"
                   value={config.stopBits}
                   onChange={(e) => setConfig({...config, stopBits: Number(e.target.value)})}
                 >
                   <option value={1}>1</option>
                   <option value={2}>2</option>
                 </select>
              </div>

              {/* Parity */}
              <div className="flex flex-col gap-1">
                 <label className="text-xs text-slate-500 uppercase font-bold">Parity</label>
                 <select 
                   className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-3 py-2 outline-none focus:border-blue-500"
                   value={config.parity}
                   onChange={(e) => setConfig({...config, parity: e.target.value as any})}
                 >
                   <option value="none">None</option>
                   <option value="even">Even</option>
                   <option value="odd">Odd</option>
                 </select>
              </div>
            </div>

            <button 
              onClick={() => setShowSettings(false)} 
              className="mt-2 w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded font-bold transition-colors"
            >
              Apply & Close
            </button>
          </div>
        </div>
      )}

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
             Open in New Window to use.
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
          <div className="flex flex-col gap-1">
             <label className="text-xs text-slate-500 uppercase font-bold flex items-center gap-1">
                <Usb size={12} /> Port
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
                  className={`bg-slate-700 hover:bg-slate-600 text-slate-200 px-2 rounded-r border-t border-r border-b border-slate-700 flex items-center justify-center ${knownPorts.length === 0 ? 'animate-pulse ring-2 ring-blue-500' : ''}`}
                >
                  <Plus size={16} />
                </button>
             </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500 uppercase font-bold">Baud Rate</label>
            <div className="flex gap-1">
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
              
              <button 
                onClick={() => setShowSettings(true)}
                disabled={status === ConnectionStatus.CONNECTED}
                className="bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 rounded px-2 flex items-center justify-center disabled:opacity-50"
                title="Serial Settings"
              >
                <Settings size={16} />
              </button>
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
              <> <Square size={16} fill="currentColor" /> Disconnect </>
            ) : (
              <> <Usb size={16} /> Connect </>
            )}
          </button>
        </div>
      </header>

      {/* MAIN CONTENT GRID */}
      <main className="flex-1 grid grid-rows-[auto_1fr] md:grid-rows-1 md:grid-cols-[400px_1fr] gap-4 min-h-0">
        
        {/* LEFT PANEL: CONTROLS & LOGS */}
        <div className="flex flex-col gap-4 min-h-0 overflow-y-auto pr-2 custom-scrollbar">
          
          {/* MANUAL TRANSMISSION BOX */}
          <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 shadow-lg space-y-3">
             <h3 className="text-slate-400 text-sm font-bold uppercase tracking-wider flex items-center gap-2">
               <Send size={16} /> Manual Transmission
             </h3>
             <textarea 
                className="w-full h-12 bg-slate-950 border border-slate-700 rounded p-2 text-slate-200 font-mono text-sm resize-none focus:border-blue-500 outline-none"
                value={manualHex}
                onChange={(e) => setManualHex(formatHexString(e.target.value))}
                placeholder="Enter Hex (e.g., 05 43 46)"
                spellCheck={false}
              />
              <button 
                onClick={() => {
                  sendData(manualHex);
                }}
                disabled={status !== ConnectionStatus.CONNECTED || isAutoSending}
                className="w-full bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-400 hover:text-white border border-slate-700 py-1.5 rounded flex items-center justify-center gap-2 text-xs font-semibold transition-colors"
              >
                <Send size={12} /> Send Once
              </button>
          </div>

          {/* SWEEP CONTROL BOX */}
          <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 shadow-lg space-y-4">
            <h3 className="text-slate-400 text-sm font-bold uppercase tracking-wider flex items-center gap-2">
              <Radio size={16} /> Sweep Control
            </h3>
            
            <div className="space-y-2">
              <label className="text-xs text-slate-500">Sweep Base Template</label>
              <textarea 
                className="w-full h-16 bg-slate-950 border border-slate-700 rounded p-2 text-slate-200 font-mono text-sm resize-none focus:border-blue-500 outline-none"
                value={sweepBaseHex}
                onChange={(e) => setSweepBaseHex(formatHexString(e.target.value))}
                spellCheck={false}
                placeholder="Hex Base for Auto Increment"
              />
            </div>

            {/* Config: Range (Hex) */}
            <div className="grid grid-cols-3 gap-2 bg-slate-950/50 p-2 rounded border border-slate-800 relative mt-4">
              <div>
                 <div className="flex justify-between items-end mb-1">
                   <label className="text-[10px] text-slate-500 flex items-center gap-1">
                     <Hash size={10} /> Start
                   </label>
                   <span className="text-[10px] text-blue-400 font-mono">
                     Freq: {calculateFreqFromHex(rangeStartHex)}
                   </span>
                 </div>
                 <input 
                    type="text" 
                    value={rangeStartHex}
                    onChange={(e) => setRangeStartHex(formatHexString(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-center focus:border-blue-500 outline-none"
                    placeholder="0000"
                 />
              </div>
              <div>
                 <div className="flex justify-between items-end mb-1">
                   <label className="text-[10px] text-slate-500 flex items-center gap-1">
                      <Hash size={10} /> End
                   </label>
                   <span className="text-[10px] text-blue-400 font-mono">
                     {calculateFreqFromHex(rangeEndHex)}
                   </span>
                 </div>
                 <input 
                    type="text" 
                    value={rangeEndHex}
                    onChange={(e) => setRangeEndHex(formatHexString(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-center focus:border-blue-500 outline-none"
                    placeholder="00C8"
                 />
              </div>
              <div>
                 <label className="text-[10px] text-slate-500 block mb-1 mt-4">Step (Dec)</label>
                 <input 
                    type="number" 
                    value={incrementStep}
                    onChange={(e) => setIncrementStep(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-center focus:border-blue-500 outline-none"
                 />
              </div>
              {/* Expected Point Count */}
              <div className="absolute -top-3 right-0 bg-slate-800 text-slate-400 text-[10px] px-2 py-0.5 rounded-full border border-slate-700 shadow">
                Est. Points: <span className="text-white font-bold">{totalSweepPoints}</span>
              </div>
            </div>

            {/* Config: Byte Manipulation (TX) */}
            <div className="bg-slate-950/50 p-2 rounded border border-slate-800 grid grid-cols-2 gap-2">
               <div>
                  <label className="text-[10px] text-slate-500 block mb-1 font-bold">TX: Modify Bytes</label>
                  <select 
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 outline-none"
                    value={targetByteIndex}
                    onChange={(e) => setTargetByteIndex(Number(e.target.value))}
                  >
                    {/* Dynamically generate options based on hex string length */}
                    {Array.from({ length: Math.max(0, currentBytesLength - 1) }).map((_, i) => (
                      <option key={i} value={i}>
                        Bytes {i}-{i+1}
                      </option>
                    ))}
                  </select>
               </div>
               <div>
                  <label className="text-[10px] text-slate-500 block mb-1 font-bold">TX Endianness</label>
                  <button
                    onClick={() => setIsBigEndian(!isBigEndian)}
                    className="w-full flex items-center justify-between px-2 py-1 bg-slate-900 border border-slate-700 rounded text-xs text-slate-300 hover:bg-slate-800"
                  >
                    <span>{isBigEndian ? 'High First' : 'Low First'}</span>
                    <ArrowRightLeft size={12} className="text-slate-500" />
                  </button>
               </div>
            </div>

            {/* Config: Byte Parsing (RX) */}
            <div className="bg-slate-950/50 p-2 rounded border border-slate-800 grid grid-cols-2 gap-2">
               <div>
                  <label className="text-[10px] text-slate-500 block mb-1 font-bold">RX: Parse Start Index</label>
                  <div className="flex items-center gap-2">
                     <span className="text-[10px] text-slate-600">Byte</span>
                     <input 
                      type="number"
                      min="0"
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 outline-none text-center disabled:opacity-50"
                      value={rxByteIndex}
                      onChange={(e) => setRxByteIndex(Math.max(0, Number(e.target.value)))}
                      disabled={enableHeaderCheck}
                    />
                  </div>
                  <div className="text-[9px] text-slate-600 text-right mt-0.5">
                     {enableHeaderCheck ? '(Strict 15-byte packet)' : `(Parses ${rxByteIndex} & ${rxByteIndex+1})`}
                  </div>
               </div>
               <div>
                  <label className="text-[10px] text-slate-500 block mb-1 font-bold">RX Endianness</label>
                  <button
                    onClick={() => setRxIsBigEndian(!rxIsBigEndian)}
                    className="w-full flex items-center justify-between px-2 py-1 bg-slate-900 border border-slate-700 rounded text-xs text-slate-300 hover:bg-slate-800"
                  >
                    <span>{rxIsBigEndian ? 'High First' : 'Low First'}</span>
                    <ArrowRightLeft size={12} className="text-slate-500" />
                  </button>
               </div>

               {/* HEADER VALIDATION TOGGLE */}
               <div className="col-span-2">
                 <button
                    onClick={() => setEnableHeaderCheck(!enableHeaderCheck)}
                    className={`w-full flex items-center gap-2 px-2 py-1 border rounded text-xs transition-colors ${enableHeaderCheck ? 'bg-amber-900/30 border-amber-600 text-amber-200' : 'bg-slate-900 border-slate-700 text-slate-500'}`}
                 >
                    <ShieldCheck size={12} className={enableHeaderCheck ? 'text-amber-400' : 'text-slate-600'} />
                    <span>Strict Packet Validation</span>
                 </button>
                 {enableHeaderCheck && (
                   <span className="text-[9px] text-amber-500 block mt-1 ml-1 font-mono leading-tight">
                     Req: Len=15, Header=FF..56, Footer=FB..F8, Val=0-4096
                   </span>
                 )}
               </div>
               
               {/* Real-time Value Display */}
               <div className="col-span-2 mt-2 pt-2 border-t border-slate-800">
                  <div className="flex items-center justify-between">
                     <div className="flex items-center gap-1.5 text-slate-400">
                        <Monitor size={12}/>
                        <span className="text-xs font-bold uppercase">Live Value (Dec)</span>
                     </div>
                     <div className={`font-mono text-lg font-bold ${lastReceivedValue !== null ? 'text-green-400' : 'text-red-500'}`}>
                        {enableHeaderCheck && isRxInvalid ? "INVALID" : (lastReceivedValue !== null ? lastReceivedValue : "OFF")}
                     </div>
                  </div>
               </div>
            </div>

            <div className="border-t border-slate-800 pt-4 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold text-slate-300">Sweep Status</span>
                <span className="text-xs text-slate-500 bg-slate-950 px-2 py-1 rounded font-mono border border-slate-800">
                   {counter} (0x{counter.toString(16).toUpperCase().padStart(4, '0')})
                </span>
              </div>

              {isRetrying && (
                <div className="text-xs bg-amber-900/20 text-amber-400 p-1.5 rounded border border-amber-800 flex items-center gap-2 animate-pulse">
                  <Loader2 size={12} className="animate-spin"/>
                  Waiting for Valid Packet (Retrying)...
                </div>
              )}
              
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="text-[10px] text-slate-500 block mb-1">Interval (ms)</label>
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
                    flex-1 py-3 rounded font-bold flex flex-col items-center justify-center gap-1 transition-all
                    ${isAutoSending 
                      ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-lg shadow-amber-900/50' 
                      : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-900/50 disabled:bg-slate-800 disabled:text-slate-600'}
                  `}
                >
                  {isAutoSending ? (
                    <> <Square size={16} fill="currentColor" /> Stop Sweep </>
                  ) : (
                    <> <RefreshCw size={16} /> Start Sweep </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* STATISTICS BOX */}
          <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 shadow-lg space-y-3">
             <h3 className="text-slate-400 text-sm font-bold uppercase tracking-wider flex items-center gap-2">
               <BarChart2 size={16} /> Statistics
             </h3>
             <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-950 p-2 rounded border border-slate-800 flex flex-col items-center">
                   <span className="text-xs text-slate-500 uppercase font-bold">TX Sent</span>
                   <span className="text-lg font-mono text-blue-400">{stats.tx}</span>
                </div>
                <div className="bg-slate-950 p-2 rounded border border-slate-800 flex flex-col items-center">
                   <span className="text-xs text-slate-500 uppercase font-bold">RX Valid</span>
                   <span className="text-lg font-mono text-green-400">{stats.rx}</span>
                </div>
                <div className="bg-slate-950 p-2 rounded border border-slate-800 flex flex-col items-center">
                   <span className="text-xs text-slate-500 uppercase font-bold">RX Invalid</span>
                   <span className="text-lg font-mono text-red-400">{stats.invalid}</span>
                </div>
                <div className="bg-slate-950 p-2 rounded border border-slate-800 flex flex-col items-center">
                   <span className="text-xs text-slate-500 uppercase font-bold flex items-center gap-1">
                      <Clock size={10} /> Time
                   </span>
                   <span className="text-lg font-mono text-yellow-400">{elapsedTime}</span>
                </div>
             </div>
          </div>

          {/* TERMINAL */}
          <div className="flex-1 min-h-[200px]">
            <Terminal 
              logs={logs} 
              clearLogs={clearLogs} 
              onExport={handleExportLogs}
            />
          </div>

        </div>

        {/* RIGHT PANEL: CHART */}
        <div className="h-full min-h-[300px]">
          <ChartPanel 
            data={chartData} 
            rxConfigLabel={enableHeaderCheck 
              ? `Strict Packet (Bytes 6-7, ${rxIsBigEndian ? 'High First' : 'Low First'})`
              : `Received (Bytes ${rxByteIndex}-${rxByteIndex+1}, ${rxIsBigEndian ? 'High First' : 'Low First'})`
            }
            totalPoints={totalSweepPoints}
          />
        </div>

      </main>
    </div>
  );
}
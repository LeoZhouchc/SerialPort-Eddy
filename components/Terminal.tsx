import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../types';
import { ArrowDown, ArrowUp, Info, AlertCircle, Save } from 'lucide-react';

interface TerminalProps {
  logs: LogEntry[];
  clearLogs: () => void;
  onExport: () => void;
}

export const Terminal: React.FC<TerminalProps> = ({ logs, clearLogs, onExport }) => {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="flex flex-col h-full bg-black rounded-lg border border-slate-800 font-mono text-sm shadow-inner">
      <div className="flex justify-between items-center px-4 py-2 bg-slate-900 border-b border-slate-800">
        <span className="text-slate-400 font-bold uppercase tracking-wider text-xs">Terminal</span>
        <div className="flex items-center gap-3">
          <button 
            onClick={onExport}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-blue-400 transition-colors"
            title="Export all logs to file"
          >
            <Save size={14} /> Export
          </button>
          <button 
            onClick={clearLogs}
            className="text-xs text-slate-500 hover:text-red-400 transition-colors"
          >
            Clear
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
        {logs.length === 0 && (
          <div className="text-slate-600 text-center italic mt-10">No activity yet...</div>
        )}
        {logs.map((log) => (
          <div key={log.id} className="flex gap-3 animate-fade-in">
            <span className="text-slate-600 shrink-0 text-xs mt-0.5 w-[70px]">{log.timestamp}</span>
            <div className="flex items-start gap-2 break-all">
              {log.type === 'tx' && <ArrowUp size={14} className="text-blue-500 mt-0.5 shrink-0" />}
              {log.type === 'rx' && <ArrowDown size={14} className="text-green-500 mt-0.5 shrink-0" />}
              {log.type === 'info' && <Info size={14} className="text-yellow-500 mt-0.5 shrink-0" />}
              {log.type === 'error' && <AlertCircle size={14} className="text-red-500 mt-0.5 shrink-0" />}
              
              <span className={`
                ${log.type === 'tx' ? 'text-blue-300' : ''}
                ${log.type === 'rx' ? 'text-green-300' : ''}
                ${log.type === 'info' ? 'text-yellow-300 italic' : ''}
                ${log.type === 'error' ? 'text-red-300 font-bold' : ''}
              `}>
                {log.data}
              </span>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
};
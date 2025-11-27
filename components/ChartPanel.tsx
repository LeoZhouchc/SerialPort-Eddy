import React, { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceDot,
  Label
} from 'recharts';
import { ChartDataPoint } from '../types';

interface ChartPanelProps {
  data: ChartDataPoint[];
  rxConfigLabel?: string;
  totalPoints?: number;
}

export const ChartPanel: React.FC<ChartPanelProps> = ({ 
  data, 
  rxConfigLabel = "Received (Bytes 7-8)",
  totalPoints = 0
}) => {
  // Calculate Peak
  const peakPoint = useMemo(() => {
    if (data.length === 0) return null;
    return data.reduce((max, current) => (current.y > max.y ? current : max), data[0]);
  }, [data]);

  return (
    <div className="w-full h-full bg-slate-900 rounded-lg border border-slate-800 p-4 shadow-lg flex flex-col">
      <div className="flex justify-between items-start mb-2">
        <div className="flex flex-col">
          <h3 className="text-slate-400 text-sm font-bold uppercase tracking-wider">
            Frequency Response
          </h3>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs font-mono bg-slate-800 text-blue-400 px-2 py-0.5 rounded border border-slate-700">
              Points: {data.length} / {totalPoints > 0 ? totalPoints : '-'}
            </span>
          </div>
        </div>
        <span className="text-xs font-normal normal-case opacity-50 text-right">
           X: (Val / 65536 * 32000) kHz <br/> Y: {rxConfigLabel}
        </span>
      </div>
      
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 20, right: 30, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis 
              dataKey="x" 
              type="number"
              domain={['auto', 'auto']}
              tickCount={10}
              label={{ value: 'Frequency (kHz)', position: 'insideBottom', offset: -10, fill: '#94a3b8' }}
              stroke="#94a3b8" 
              fontSize={12} 
              tick={{fill: '#94a3b8'}}
            />
            <YAxis 
              label={{ value: 'Response', angle: -90, position: 'insideLeft', fill: '#94a3b8' }}
              stroke="#94a3b8" 
              fontSize={12} 
              tick={{fill: '#94a3b8'}} 
            />
            <Tooltip 
              contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f8fafc' }}
              itemStyle={{ color: '#f8fafc' }}
              labelFormatter={(val) => `Freq: ${val} kHz`}
            />
            <Legend verticalAlign="top" height={36}/>
            
            <Line 
              type="monotone" 
              dataKey="y" 
              name="Response Value" 
              stroke="#10b981" 
              strokeWidth={2} 
              dot={{ r: 3, fill: '#10b981' }}
              activeDot={{ r: 6 }}
              isAnimationActive={false}
              connectNulls
            />

            {/* Peak Annotation */}
            {peakPoint && (
              <ReferenceDot 
                x={peakPoint.x} 
                y={peakPoint.y} 
                r={6} 
                fill="#f87171" 
                stroke="#fff"
              >
                <Label 
                  value={`Peak: ${peakPoint.y} @ ${peakPoint.x}kHz`} 
                  position="top" 
                  fill="#f87171"
                  fontSize={12}
                  fontWeight="bold"
                />
              </ReferenceDot>
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
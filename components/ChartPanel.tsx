import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { ChartDataPoint } from '../types';

interface ChartPanelProps {
  data: ChartDataPoint[];
}

export const ChartPanel: React.FC<ChartPanelProps> = ({ data }) => {
  return (
    <div className="w-full h-full bg-slate-900 rounded-lg border border-slate-800 p-4 shadow-lg flex flex-col">
      <h3 className="text-slate-400 text-sm font-bold mb-2 uppercase tracking-wider flex justify-between">
        <span>Data Visualization</span>
        <span className="text-xs font-normal normal-case opacity-50">
           Sent (Bytes 4-5) vs Received (Bytes 7-8)
        </span>
      </h3>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis 
              dataKey="time" 
              stroke="#94a3b8" 
              fontSize={12} 
              tick={{fill: '#94a3b8'}}
            />
            <YAxis 
              stroke="#94a3b8" 
              fontSize={12} 
              tick={{fill: '#94a3b8'}} 
            />
            <Tooltip 
              contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f8fafc' }}
              itemStyle={{ color: '#f8fafc' }}
            />
            <Legend />
            <Line 
              type="monotone" 
              dataKey="sentValue" 
              name="Sent Value" 
              stroke="#3b82f6" 
              strokeWidth={2} 
              dot={false} 
              activeDot={{ r: 6 }}
              isAnimationActive={false}
            />
            <Line 
              type="monotone" 
              dataKey="receivedValue" 
              name="Received Value" 
              stroke="#10b981" 
              strokeWidth={2} 
              dot={false}
              activeDot={{ r: 6 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
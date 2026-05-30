'use client';

import { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import dayjs from 'dayjs';

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
}

const PRESETS = [
  { label: 'Yesterday', getRange: () => ({ startDate: dayjs().subtract(1, 'day').startOf('day').toDate(), endDate: dayjs().subtract(1, 'day').endOf('day').toDate() }) },
  { label: 'Last week', getRange: () => ({ startDate: dayjs().subtract(1, 'week').startOf('week').toDate(), endDate: dayjs().subtract(1, 'week').endOf('week').toDate() }) },
  { label: 'Current month', getRange: () => ({ startDate: dayjs().startOf('month').toDate(), endDate: dayjs().endOf('month').toDate() }) },
  { label: 'Last 30 days', getRange: () => ({ startDate: dayjs().subtract(29, 'days').toDate(), endDate: dayjs().toDate() }) },
  { label: 'Previous month', getRange: () => ({ startDate: dayjs().subtract(1, 'month').startOf('month').toDate(), endDate: dayjs().subtract(1, 'month').endOf('month').toDate() }) },
  { label: 'Last 3 months', getRange: () => ({ startDate: dayjs().subtract(90, 'days').toDate(), endDate: dayjs().toDate() }) },
  { label: 'Last 6 months', getRange: () => ({ startDate: dayjs().subtract(180, 'days').toDate(), endDate: dayjs().toDate() }) },
  { label: 'Last 12 months', getRange: () => ({ startDate: dayjs().subtract(365, 'days').toDate(), endDate: dayjs().toDate() }) },
];

export function DateRangePicker({ value, onChange, className }: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(dayjs(value.startDate));
  const containerRef = useRef<HTMLDivElement>(null);

  // Close popup when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handlePresetClick = (presetRange: DateRange) => {
    onChange(presetRange);
    setIsOpen(false);
  };

  const handleDateClick = (date: dayjs.Dayjs) => {
    const clickedDate = date.toDate();
    const isSameRange = dayjs(value.startDate).isSame(value.endDate, 'day');

    if (isSameRange) {
      if (date.isBefore(dayjs(value.startDate), 'day')) {
        onChange({ startDate: clickedDate, endDate: clickedDate });
      } else {
        onChange({ startDate: value.startDate, endDate: clickedDate });
        setIsOpen(false);
      }
    } else {
      onChange({ startDate: clickedDate, endDate: clickedDate });
    }
  };

  const renderMonthDays = (month: dayjs.Dayjs) => {
    const startOfMonth = month.startOf('month');
    const endOfMonth = month.endOf('month');
    const startDay = startOfMonth.day();
    const daysInMonth = endOfMonth.date();

    const days = [];
    // Render blank cells for offset
    for (let i = 0; i < startDay; i++) {
      days.push(<div key={`blank-${i}`} className="h-8 w-8" />);
    }

    // Render month days
    for (let d = 1; d <= daysInMonth; d++) {
      const date = month.date(d);
      const isSelectedStart = dayjs(value.startDate).isSame(date, 'day');
      const isSelectedEnd = dayjs(value.endDate).isSame(date, 'day');
      const isInRange = date.isAfter(value.startDate, 'day') && date.isBefore(value.endDate, 'day');

      days.push(
        <button
          key={`day-${d}`}
          onClick={() => handleDateClick(date)}
          className={clsx(
            'h-8 w-8 rounded-full text-xs font-semibold flex items-center justify-center transition-all hover:bg-brand-500 hover:text-white',
            isSelectedStart && 'bg-brand-500 text-white shadow-lg shadow-brand-500/35 scale-105',
            isSelectedEnd && 'bg-brand-500 text-white shadow-lg shadow-brand-500/35 scale-105',
            isInRange && 'bg-brand-500/20 text-brand-300 hover:bg-brand-500/40',
            !isSelectedStart && !isSelectedEnd && !isInRange && 'text-text-secondary hover:scale-105'
          )}
        >
          {d}
        </button>
      );
    }

    return days;
  };

  return (
    <div ref={containerRef} className={clsx('relative inline-block text-left z-50', className)}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 bg-surface-card border border-surface-border text-text-primary px-4 py-2.5 rounded-xl hover:border-brand-500/30 transition-all hover:bg-surface-hover shadow-lg font-medium text-sm"
      >
        <Calendar size={15} className="text-text-muted" />
        <span>
          {dayjs(value.startDate).format('MMM D, YYYY')} - {dayjs(value.endDate).format('MMM D, YYYY')}
        </span>
      </button>

      {/* Dropdown Calendar Panel */}
      {isOpen && (
        <div className="absolute right-0 mt-3 flex flex-col md:flex-row bg-[#0b0c16]/95 border border-surface-border/80 backdrop-blur-xl rounded-2xl shadow-[0_10px_50px_-12px_rgba(0,0,0,0.8)] p-2 md:p-4 gap-4 animate-in fade-in duration-200">
          
          {/* Calendar Preset Picker Side */}
          <div className="flex flex-col gap-1 border-r border-surface-border/50 pr-4 w-44">
            {PRESETS.map((p) => {
              const presetRange = p.getRange();
              const isActive = dayjs(value.startDate).isSame(presetRange.startDate, 'day') && dayjs(value.endDate).isSame(presetRange.endDate, 'day');
              return (
                <button
                  key={p.label}
                  onClick={() => handlePresetClick(presetRange)}
                  className={clsx(
                    'text-left px-3 py-2 rounded-lg text-xs font-semibold transition-all',
                    isActive 
                      ? 'bg-brand-500 text-white' 
                      : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Calendar Months Grids Side */}
          <div className="flex flex-col gap-2">
            {/* Header controls */}
            <div className="flex items-center justify-between px-2">
              <button
                onClick={() => setCurrentMonth(currentMonth.subtract(1, 'month'))}
                className="p-1 hover:bg-surface-hover rounded-lg text-text-secondary hover:text-text-primary transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm font-bold text-text-primary">
                {currentMonth.format('MMMM YYYY')}
              </span>
              <button
                onClick={() => setCurrentMonth(currentMonth.add(1, 'month'))}
                className="p-1 hover:bg-surface-hover rounded-lg text-text-secondary hover:text-text-primary transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            {/* Week Labels */}
            <div className="grid grid-cols-7 gap-1 text-center w-64 px-2 mt-2">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day) => (
                <div key={day} className="text-[10px] font-bold text-text-muted select-none">
                  {day}
                </div>
              ))}
            </div>

            {/* Grid days */}
            <div className="grid grid-cols-7 gap-1 w-64 p-2">
              {renderMonthDays(currentMonth)}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, X } from 'lucide-react';
import { parentApi, useSelectedChild } from './ParentPortal';

const tones = {
  holiday: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  exam: 'bg-amber-50 text-amber-700 border-amber-200',
  meeting: 'bg-purple-50 text-purple-700 border-purple-200',
  deadline: 'bg-red-50 text-red-700 border-red-200',
  other: 'bg-slate-50 text-slate-700 border-slate-200',
};
const dateKey = value => new Date(value).toISOString().slice(0, 10);

const EventCard = ({ event, onOpen }) => {
  const start = new Date(event.start_date);
  const hasTime = !Number.isNaN(start.getTime()) && (start.getHours() !== 0 || start.getMinutes() !== 0);
  return (
    <button type="button" onClick={() => onOpen(event)} className="w-full min-w-0 rounded-2xl border border-[#dce7eb] bg-white p-4 text-left shadow-sm">
      <div className="flex min-w-0 items-start gap-3">
        <div className="w-12 shrink-0 rounded-xl bg-[#e8f1ef] py-2 text-center">
          <p className="text-[10px] font-bold uppercase text-[#176b73]">{start.toLocaleDateString(undefined, { month: 'short' })}</p>
          <p className="text-xl font-bold text-[#19324a]">{start.getDate()}</p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="break-words font-semibold leading-5 text-[#19324a]">{event.title}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className={`rounded-full border px-2 py-0.5 font-medium ${tones[event.event_type] || tones.other}`}>{event.event_type || 'other'}</span>
            {hasTime && <span className="inline-flex items-center gap-1 text-[#617487]"><Clock className="h-3.5 w-3.5" />{start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
            {event.grade_name && <span className="max-w-full break-words text-[#617487]">{event.grade_name}{event.class_name ? ` · ${event.class_name}` : ''}</span>}
          </div>
        </div>
      </div>
    </button>
  );
};

const ParentCalendar = () => {
  const { child } = useSelectedChild();
  const [mode, setMode] = useState('calendar');
  const [selectedDate, setSelectedDate] = useState(dateKey(new Date()));
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const selected = new Date(`${selectedDate}T12:00:00`);

  useEffect(() => {
    setLoading(true);
    const path = mode === 'upcoming'
      ? '/calendar?upcoming=true'
      : `/calendar?month=${selected.getMonth() + 1}&year=${selected.getFullYear()}`;
    parentApi(path).then(data => setEvents(data?.events || [])).catch(() => setEvents([])).finally(() => setLoading(false));
  }, [child?.id, mode, selected.getMonth(), selected.getFullYear()]);

  const visible = useMemo(() => mode === 'upcoming'
    ? events
    : events.filter(event => dateKey(event.start_date) === selectedDate), [events, mode, selectedDate]);
  const moveDay = amount => {
    const next = new Date(`${selectedDate}T12:00:00`);
    next.setDate(next.getDate() + amount);
    setSelectedDate(dateKey(next));
  };

  return (
    <div className="min-w-0 space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b5473a]">Harmony Learning Institute</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-[#19324a]">Calendar</h1>
        <p className="mt-1 text-sm text-[#617487]">{child ? `Events for ${child.first_name} and school-wide Parent events` : 'Select a linked learner to view events'}</p>
      </header>
      <div className="grid grid-cols-2 rounded-xl bg-[#e4eceb] p-1">
        {['calendar', 'upcoming'].map(value => <button key={value} onClick={() => setMode(value)} className={`rounded-lg px-3 py-2.5 text-sm font-semibold ${mode === value ? 'bg-white text-[#176b73] shadow-sm' : 'text-[#617487]'}`}>{value === 'calendar' ? 'Calendar' : 'Upcoming events'}</button>)}
      </div>
      {mode === 'calendar' && (
        <section className="rounded-2xl border border-[#dce7eb] bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <button onClick={() => moveDay(-1)} aria-label="Previous day" className="grid h-11 w-11 place-items-center rounded-xl bg-[#e8f1ef] text-[#176b73]"><ChevronLeft /></button>
            <label className="min-w-0 text-center">
              <span className="block text-xs font-semibold uppercase tracking-wider text-[#617487]">Choose a date</span>
              <input type="date" value={selectedDate} onChange={event => setSelectedDate(event.target.value)} className="mt-1 max-w-full rounded-lg border border-[#cbd9df] px-2 py-1.5 text-sm font-semibold text-[#19324a]" />
            </label>
            <button onClick={() => moveDay(1)} aria-label="Next day" className="grid h-11 w-11 place-items-center rounded-xl bg-[#e8f1ef] text-[#176b73]"><ChevronRight /></button>
          </div>
          <button onClick={() => setSelectedDate(dateKey(new Date()))} className="mx-auto mt-3 block text-xs font-semibold text-[#176b73]">Today</button>
        </section>
      )}
      <section className="min-w-0">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.12em] text-[#617487]">{mode === 'calendar' ? selected.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) : 'Upcoming'}</h2>
        {loading ? <div className="h-28 animate-pulse rounded-2xl bg-[#dfe9e7]" /> : visible.length ? (
          <div className="space-y-3">{visible.map(event => <EventCard key={event.id} event={event} onOpen={setSelectedEvent} />)}</div>
        ) : <div className="rounded-2xl border border-[#dce7eb] bg-white p-8 text-center text-sm text-[#84929e]">No events to show.</div>}
      </section>
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-0 sm:items-center sm:justify-center sm:p-4" onClick={() => setSelectedEvent(null)}>
          <article className="max-h-[85dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 sm:max-w-lg sm:rounded-3xl sm:p-6" onClick={event => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3"><h2 className="break-words text-xl font-bold text-[#19324a]">{selectedEvent.title}</h2><button onClick={() => setSelectedEvent(null)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100"><X className="h-5 w-5" /></button></div>
            <p className="mt-3 text-sm font-medium text-[#176b73]">{new Date(selectedEvent.start_date).toLocaleString()}</p>
            {selectedEvent.end_date && <p className="mt-1 text-xs text-[#617487]">Ends {new Date(selectedEvent.end_date).toLocaleString()}</p>}
            <div className="mt-4 flex flex-wrap gap-2"><span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[selectedEvent.event_type] || tones.other}`}>{selectedEvent.event_type}</span>{selectedEvent.grade_name && <span className="max-w-full break-words rounded-full bg-[#e8f1ef] px-2.5 py-1 text-xs text-[#176b73]">{selectedEvent.grade_name}{selectedEvent.class_name ? ` · ${selectedEvent.class_name}` : ''}</span>}</div>
            {selectedEvent.description && <p className="mt-5 whitespace-pre-wrap break-words text-sm leading-6 text-[#526879]">{selectedEvent.description}</p>}
          </article>
        </div>
      )}
    </div>
  );
};

export default ParentCalendar;
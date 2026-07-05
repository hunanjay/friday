import React, { useState, useEffect } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { useTranslation } from 'react-i18next';
import { Calendar, ChevronLeft, ChevronRight, X, Trash } from '../components/common/Icons';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8005';

export default function CalendarPage() {
  const {
    events,
    handleAddEvent,
    handleDeleteEvent,
    showToast,
    authToken,
    handleSyncEvents
  } = useWorkspace();

  const { t, i18n } = useTranslation();

  const [currentDate, setCurrentDate] = useState(new Date(2026, 6, 5)); // July 5, 2026
  const [isSyncingEvents, setIsSyncingEvents] = useState(false);

  // Pull real events via our backend, which proxies Microsoft Graph and
  // holds the Graph token server-side.
  useEffect(() => {
    if (!authToken) return;
    setIsSyncingEvents(true);
    fetch(`${API_URL}/api/graph/calendar/events`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(res => res.json())
      .then(data => {
        const calendarEvents = (data.value || []).map(ev => ({
          id: ev.id,
          subject: ev.subject,
          start: ev.start,
          end: ev.end,
          body: ev.body,
          categories: ev.categories,
          location: ev.location,
        }));
        handleSyncEvents(calendarEvents);
      })
      .catch(() => showToast(t('calendar.syncFailed', { defaultValue: 'Failed to sync calendar from Outlook' })))
      .finally(() => setIsSyncingEvents(false));
  }, [authToken, showToast, handleSyncEvents, t]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDateStr, setSelectedDateStr] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [eventStart, setEventStart] = useState('09:00');
  const [eventEnd, setEventEnd] = useState('10:00');
  const [eventDesc, setEventDesc] = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [eventCategory, setEventCategory] = useState('work'); // work, personal, urgent, study
  const [selectedEvent, setSelectedEvent] = useState(null);

  // Month navigation
  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Calendar grid calculations
  const firstDayIndex = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const calendarCells = [];

  // Previous month buffer days
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const dayNum = prevMonthDays - i;
    const m = month === 0 ? 11 : month - 1;
    const y = month === 0 ? year - 1 : year;
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    calendarCells.push({ dayNum, isCurrentMonth: false, dateStr });
  }

  // Current month days
  for (let i = 1; i <= totalDays; i++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
    calendarCells.push({ dayNum: i, isCurrentMonth: true, dateStr });
  }

  // Next month buffer days to fill 42 cells
  const remainingCells = 42 - calendarCells.length;
  for (let i = 1; i <= remainingCells; i++) {
    const m = month === 11 ? 0 : month + 1;
    const y = month === 11 ? year + 1 : year;
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
    calendarCells.push({ dayNum: i, isCurrentMonth: false, dateStr });
  }

  // Get events on a specific date
  const getEventsForDate = (dateStr) => {
    return events.filter(e => {
      const eventDate = e.start?.dateTime?.split('T')[0];
      return eventDate === dateStr;
    });
  };

  const handleCellClick = (dateStr) => {
    setSelectedDateStr(dateStr);
    setIsModalOpen(true);
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    if (!eventTitle) {
      alert('Event title is required');
      return;
    }

    const newEvent = {
      id: 'event_' + Date.now(),
      subject: eventTitle,
      start: {
        dateTime: `${selectedDateStr}T${eventStart}:00`,
        timeZone: 'UTC'
      },
      end: {
        dateTime: `${selectedDateStr}T${eventEnd}:00`,
        timeZone: 'UTC'
      },
      body: {
        content: eventDesc,
        contentType: 'text'
      },
      categories: [eventCategory.charAt(0).toUpperCase() + eventCategory.slice(1)],
      location: {
        displayName: eventLocation || 'Microsoft Teams Meeting'
      }
    };

    handleAddEvent(newEvent);
    setIsModalOpen(false);

    // Reset fields
    setEventTitle('');
    setEventStart('09:00');
    setEventEnd('10:00');
    setEventDesc('');
    setEventLocation('');
    setEventCategory('work');

    showToast(t('calendar.addedSuccess'));
  };

  const handleDeleteEventClick = (eventId, e) => {
    e.stopPropagation();
    handleDeleteEvent(eventId);
    setSelectedEvent(null);
    showToast(t('calendar.deletedSuccess'));
  };

  const getCleanCategory = (categories) => {
    const cat = categories?.[0] || 'Work';
    return cat.toLowerCase();
  };

  // Localized Month/Date representation
  const langKey = i18n.language === 'zh' ? 'zh-CN' : 'en-US';
  const monthYearTitle = currentDate.toLocaleDateString(langKey, { month: 'long', year: 'numeric' });
  const todayFormatted = new Date(2026, 6, 5).toLocaleDateString(langKey, { month: 'long', day: 'numeric', year: 'numeric' });

  // Map weekdays
  const weekDays = i18n.language === 'zh' 
    ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="calendar-tab-container">
      {/* Calendar Sidebar */}
      <div className="calendar-sidebar">
        <div className="mini-today-card">
          <div className="calendar-icon-container">
            <Calendar size={28} />
          </div>
          <h3>{i18n.language === 'zh' ? "今日日期" : "Today's Date"}</h3>
          <p className="today-display-date">{todayFormatted}</p>
        </div>

        <div className="upcoming-events">
          <h4>{i18n.language === 'zh' ? "近期日程" : "Upcoming Events"}</h4>
          <div className="upcoming-list">
            {events.length === 0 ? (
              <p className="no-events-text">{i18n.language === 'zh' ? "无已安排日程" : "No scheduled events."}</p>
            ) : (
              events
                .filter(e => {
                  const evDate = new Date(e.start?.dateTime);
                  return evDate >= new Date(2026, 6, 1);
                })
                .sort((a, b) => a.start.dateTime.localeCompare(b.start.dateTime))
                .slice(0, 5)
                .map(event => {
                  const evDateStr = event.start.dateTime.split('T')[0];
                  const formattedDate = evDateStr.split('-').slice(1).join('/');
                  const sTime = event.start.dateTime.split('T')[1].substring(0, 5);
                  const eTime = event.end.dateTime.split('T')[1].substring(0, 5);
                  const cat = getCleanCategory(event.categories);

                  return (
                    <div
                      key={event.id}
                      className={`upcoming-item category-${cat}`}
                      onClick={() => setSelectedEvent(event)}
                    >
                      <div className="upcoming-item-color"></div>
                      <div className="upcoming-item-details">
                        <h5>{event.subject}</h5>
                        <span className="upcoming-item-time">
                          {formattedDate} &bull; {sTime} - {eTime}
                        </span>
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        </div>
      </div>

      {/* Main Calendar Month View */}
      <div className="calendar-grid-panel">
        <div className="calendar-header-bar">
          <div className="calendar-month-year">
            <h2>{monthYearTitle}</h2>
          </div>
          <div className="calendar-nav-buttons">
            <button onClick={prevMonth} className="nav-btn" title={t('calendar.prevMonth')}><ChevronLeft size={16} /></button>
            <button onClick={() => setCurrentDate(new Date(2026, 6, 5))} className="today-btn">{i18n.language === 'zh' ? "今天" : "Today"}</button>
            <button onClick={nextMonth} className="nav-btn" title={t('calendar.nextMonth')}><ChevronRight size={16} /></button>
          </div>
        </div>

        {isSyncingEvents && (
          <div className="calendar-sync-banner">
            <Calendar size={14} />
            <span>{i18n.language === 'zh' ? "正在同步 Outlook 日历..." : "Syncing Outlook calendar…"}</span>
          </div>
        )}

        <div className="calendar-grid">
          {/* Days of week header */}
          {weekDays.map(d => (
            <div key={d} className="grid-header-cell">{d}</div>
          ))}

          {/* Grid cells */}
          {calendarCells.map((cell, idx) => {
            const cellEvents = getEventsForDate(cell.dateStr);
            const isToday = cell.dateStr === '2026-07-05';

            return (
              <div
                key={idx}
                className={`grid-cell ${cell.isCurrentMonth ? '' : 'outside-month'} ${isToday ? 'today-cell' : ''}`}
                onClick={() => handleCellClick(cell.dateStr)}
              >
                <span className="cell-day-num">{cell.dayNum}</span>
                <div className="cell-events-container">
                  {cellEvents.map(event => {
                    const sTime = event.start.dateTime.split('T')[1].substring(0, 5);
                    const cat = getCleanCategory(event.categories);

                    return (
                      <div
                        key={event.id}
                        className={`cell-event category-${cat}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedEvent(event);
                        }}
                        title={`${sTime} - ${event.subject}`}
                      >
                        {event.subject}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* New Event Modal */}
      {isModalOpen && (
        <div className="calendar-modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="calendar-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('calendar.newEvent')}</h3>
              <button className="close-modal-btn" onClick={() => setIsModalOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleFormSubmit} className="modal-form">
              <div className="modal-date-display">
                {i18n.language === 'zh' ? "日期" : "Date"}: <strong>{selectedDateStr}</strong>
              </div>
              <div className="form-group">
                <label htmlFor="event-title">{t('calendar.subject')}</label>
                <input
                  type="text"
                  id="event-title"
                  placeholder="e.g. Project Sync Meeting"
                  value={eventTitle}
                  onChange={e => setEventTitle(e.target.value)}
                  required
                />
              </div>

              <div className="form-row">
                <div className="form-group half">
                  <label htmlFor="event-start">{t('calendar.start')}</label>
                  <input
                    type="time"
                    id="event-start"
                    value={eventStart}
                    onChange={e => setEventStart(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group half">
                  <label htmlFor="event-end">{t('calendar.end')}</label>
                  <input
                    type="time"
                    id="event-end"
                    value={eventEnd}
                    onChange={e => setEventEnd(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="event-location">{t('calendar.location')}</label>
                <input
                  type="text"
                  id="event-location"
                  placeholder="e.g. Microsoft Teams Room, Room 3B"
                  value={eventLocation}
                  onChange={e => setEventLocation(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>{t('calendar.category')}</label>
                <div className="category-selector">
                  {['work', 'personal', 'urgent', 'study'].map(cat => {
                    const label = t(`calendar.categories.${cat.charAt(0).toUpperCase() + cat.slice(1)}`);
                    return (
                      <label key={cat} className={`category-radio category-${cat} ${eventCategory === cat ? 'selected' : ''}`}>
                        <input
                          type="radio"
                          name="category"
                          value={cat}
                          checked={eventCategory === cat}
                          onChange={() => setEventCategory(cat)}
                        />
                        <span>{label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="event-desc">{t('calendar.description')}</label>
                <textarea
                  id="event-desc"
                  placeholder="Add meeting agenda details..."
                  value={eventDesc}
                  onChange={e => setEventDesc(e.target.value)}
                />
              </div>

              <div className="modal-footer">
                <button type="button" className="cancel-btn" onClick={() => setIsModalOpen(false)}>{t('common.cancel')}</button>
                <button type="submit" className="save-btn">{t('calendar.newEvent')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Event Details Viewer Drawer/Modal */}
      {selectedEvent && (
        <div className="calendar-modal-overlay" onClick={() => setSelectedEvent(null)}>
          <div className="calendar-modal details-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className={`event-badge category-${getCleanCategory(selectedEvent.categories)}`}>
                {t(`calendar.categories.${selectedEvent.categories?.[0] || 'Work'}`)}
              </span>
              <button className="close-modal-btn" onClick={() => setSelectedEvent(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="details-body">
              <h2 className="details-title">{selectedEvent.subject}</h2>
              <div className="details-meta-row">
                <span className="meta-icon">📅</span>
                <span>{selectedEvent.start.dateTime.split('T')[0]}</span>
              </div>
              <div className="details-meta-row">
                <span className="meta-icon">⏰</span>
                <span>
                  {selectedEvent.start.dateTime.split('T')[1].substring(0, 5)} - {selectedEvent.end.dateTime.split('T')[1].substring(0, 5)}
                </span>
              </div>
              <div className="details-meta-row">
                <span className="meta-icon">📍</span>
                <span>{selectedEvent.location?.displayName || 'Virtual Meeting'}</span>
              </div>
              {selectedEvent.body?.content && (
                <div className="details-desc">
                  <h4>{i18n.language === 'zh' ? "议程" : "Agenda"}</h4>
                  <p>{selectedEvent.body.content}</p>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button 
                type="button" 
                className="delete-event-btn" 
                onClick={(e) => handleDeleteEventClick(selectedEvent.id, e)}
              >
                <Trash size={16} />
                <span>{t('calendar.deleteEvent')}</span>
              </button>
              <button type="button" className="close-details-btn" onClick={() => setSelectedEvent(null)}>{i18n.language === 'zh' ? "关闭" : "Close"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

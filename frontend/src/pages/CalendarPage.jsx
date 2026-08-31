import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCalendarEvents } from '../features/calendar/hooks';
import { useUi } from '../hooks/useUi';
import { useTranslation } from 'react-i18next';
import { Calendar, ChevronLeft, ChevronRight, Edit3, X, Trash } from '../components/common/Icons';
import EmailContentRenderer from '../components/common/EmailContentRenderer';

function hasVisibleEventBody(body) {
  const content = body?.content || '';
  if (!content.trim()) return false;
  if ((body?.contentType || '').toLowerCase() !== 'html') return true;

  const documentNode = new DOMParser().parseFromString(content, 'text/html');
  const visibleText = (documentNode.body?.textContent || '').replace(/\u00a0/g, ' ').trim();
  return Boolean(visibleText || documentNode.body?.querySelector('img, table, hr'));
}

export default function CalendarPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { showToast } = useUi();

  const [currentDate, setCurrentDate] = useState(() => new Date());
  const calendarRange = useMemo(() => ({
    start: new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).toISOString(),
    end: new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1).toISOString(),
  }), [currentDate]);
  const {
    events,
    addCalendarEvent,
    updateCalendarEvent,
    deleteCalendarEvent,
    calendarError,
  } = useCalendarEvents(calendarRange);

  // Pull real events via our backend, which proxies Microsoft Graph and
  // holds the Graph token server-side. Scoped to the visible month only,
  // cached by range so month navigation doesn't overwrite another consumer.
  useEffect(() => {
    if (!calendarError) return;
    showToast(t('calendar.syncFailed', { defaultValue: 'Failed to sync calendar from Outlook' }));
  }, [calendarError, showToast, t]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDateStr, setSelectedDateStr] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [eventStart, setEventStart] = useState('09:00');
  const [eventEnd, setEventEnd] = useState('10:00');
  const [eventDesc, setEventDesc] = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [eventCategory, setEventCategory] = useState('work'); // work, personal, urgent, study
  const [editingEventId, setEditingEventId] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const searchParams = new URLSearchParams(location.search);
  const targetEventId = location.state?.eventId || searchParams.get('eventId');
  const targetEventStart = location.state?.eventStart || searchParams.get('eventStart');

  useEffect(() => {
    if (!targetEventStart) return;
    const targetDate = new Date(targetEventStart);
    if (!Number.isNaN(targetDate.valueOf())) setCurrentDate(targetDate);
  }, [targetEventStart]);

  useEffect(() => {
    if (!targetEventId) return;
    const event = events.find(item => item.id === targetEventId);
    if (!event) return;
    setSelectedEvent(event);
    navigate('/calendar', { replace: true, state: null });
  }, [events, navigate, targetEventId]);

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

  const resetEventForm = () => {
    setEventTitle('');
    setEventStart('09:00');
    setEventEnd('10:00');
    setEventDesc('');
    setEventLocation('');
    setEventCategory('work');
  };

  const closeEventModal = () => {
    setIsModalOpen(false);
    setEditingEventId(null);
  };

  const handleCellClick = (dateStr) => {
    setEditingEventId(null);
    resetEventForm();
    setSelectedDateStr(dateStr);
    setIsModalOpen(true);
  };

  const handleEditEventClick = (event) => {
    const [date, startTime] = (event.start?.dateTime || '').split('T');
    const endTime = (event.end?.dateTime || '').split('T')[1];
    setEditingEventId(event.id);
    setSelectedDateStr(date || '');
    setEventTitle(event.subject || '');
    setEventStart((startTime || '09:00').substring(0, 5));
    setEventEnd((endTime || '10:00').substring(0, 5));
    setEventLocation(event.location?.displayName || '');
    setEventDesc('');
    setEventCategory(getCleanCategory(event.categories));
    setSelectedEvent(null);
    setIsModalOpen(true);
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    if (!eventTitle) {
      alert('Event title is required');
      return;
    }

    try {
      if (editingEventId) {
        await updateCalendarEvent({
          id: editingEventId,
          subject: eventTitle,
          start: `${selectedDateStr}T${eventStart}:00`,
          end: `${selectedDateStr}T${eventEnd}:00`,
          location: eventLocation,
        });
      } else {
        await addCalendarEvent({
          subject: eventTitle,
          start: `${selectedDateStr}T${eventStart}:00`,
          end: `${selectedDateStr}T${eventEnd}:00`,
          location: eventLocation || 'Microsoft Teams Meeting',
          body: { content: eventDesc, contentType: 'text' },
          categories: [eventCategory.charAt(0).toUpperCase() + eventCategory.slice(1)],
        });
      }
      const wasEditing = Boolean(editingEventId);
      closeEventModal();
      resetEventForm();

      showToast(t(wasEditing ? 'calendar.updatedSuccess' : 'calendar.addedSuccess'));
    } catch {
      showToast(t('calendar.syncFailed', { defaultValue: 'Failed to sync calendar from Outlook' }));
    }
  };

  const handleDeleteEventClick = async (eventId, e) => {
    e.stopPropagation();
    try {
      await deleteCalendarEvent(eventId);
      setSelectedEvent(null);
      showToast(t('calendar.deletedSuccess'));
    } catch {
      showToast(t('calendar.syncFailed', { defaultValue: 'Failed to sync calendar from Outlook' }));
    }
  };

  const getCleanCategory = (categories) => {
    const cat = categories?.[0] || 'Work';
    return cat.toLowerCase();
  };

  // Localized Month/Date representation
  const langKey = i18n.language === 'zh' ? 'zh-CN' : 'en-US';
  const monthYearTitle = currentDate.toLocaleDateString(langKey, { month: 'long', year: 'numeric' });
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const todayFormatted = today.toLocaleDateString(langKey, { month: 'long', day: 'numeric', year: 'numeric' });

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
                  return evDate >= todayStart;
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
            <button onClick={() => setCurrentDate(new Date())} className="today-btn">{i18n.language === 'zh' ? "今天" : "Today"}</button>
            <button onClick={nextMonth} className="nav-btn" title={t('calendar.nextMonth')}><ChevronRight size={16} /></button>
          </div>
        </div>

        <div className="calendar-grid">
          {/* Days of week header */}
          {weekDays.map(d => (
            <div key={d} className="grid-header-cell">{d}</div>
          ))}

          {/* Grid cells */}
          {calendarCells.map((cell, idx) => {
            const cellEvents = getEventsForDate(cell.dateStr);
            const isToday = cell.dateStr === todayStr;

            return (
              <div
                key={idx}
                className={`grid-cell ${cell.isCurrentMonth ? '' : 'outside-month'} ${isToday ? 'today-cell' : ''}`}
                onClick={() => handleCellClick(cell.dateStr)}
              >
                <span className="cell-day-num">{cell.dayNum}</span>
                {cellEvents.length > 0 && (
                  <div className="cell-dots-indicator" aria-hidden="true">
                    {cellEvents.slice(0, 3).map((ev) => (
                      <span
                        key={ev.id}
                        className={`cell-dot category-${getCleanCategory(ev.categories)}`}
                      />
                    ))}
                    {cellEvents.length > 3 && <span className="cell-dot-more">+{cellEvents.length - 3}</span>}
                  </div>
                )}
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

      {/* New / Edit Event Modal */}
      {isModalOpen && (
        <div className="calendar-modal-overlay" onClick={closeEventModal}>
          <div className="calendar-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t(editingEventId ? 'calendar.editEvent' : 'calendar.newEvent')}</h3>
              <button className="close-modal-btn" onClick={closeEventModal}>
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
                <button type="button" className="cancel-btn" onClick={closeEventModal}>{t('common.cancel')}</button>
                <button type="submit" className="save-btn">{t(editingEventId ? 'calendar.saveEvent' : 'calendar.newEvent')}</button>
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
              <div className="details-desc">
                <h4>{t('calendar.agenda')}</h4>
                {hasVisibleEventBody(selectedEvent.body) ? (
                  <EmailContentRenderer body={selectedEvent.body} />
                ) : (
                  <p className="details-empty-desc">{t('calendar.noAgenda')}</p>
                )}
              </div>
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
              <button
                type="button"
                className="close-details-btn"
                onClick={() => handleEditEventClick(selectedEvent)}
              >
                <Edit3 size={16} />
                <span>{t('calendar.editEvent')}</span>
              </button>
              <button type="button" className="close-details-btn" onClick={() => setSelectedEvent(null)}>{i18n.language === 'zh' ? "关闭" : "Close"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

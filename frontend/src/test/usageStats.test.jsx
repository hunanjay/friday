import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import UsageStatsPanel from '../components/UsageStatsPanel';

const stats = {
  window_days: 7,
  users: {
    registered: { total: 42, new_in_window: 5, truncated: false },
    dau: 8, wau: 19, mau: 30, wau_over_mau: 0.63,
  },
  agent: {
    turns: 310, active_users: 19, sessions: 120, errors: 9,
    error_rate: 0.029, paused_for_approval: 4, tool_calls: 402,
    turns_per_user: 16.32, median_duration_ms: 2480,
    by_route: { slash_command: 55, supervisor: 255 },
    by_agent: { mail_agent: 200, none: 40, calendar_agent: 70 },
  },
  hitl: {
    by_status: { succeeded: 40, cancelled: 7 },
    by_tool: { send_email: { succeeded: 30, cancelled: 2 }, delete_event: { succeeded: 10, cancelled: 5 } },
    approval_rate: 0.8511,
  },
};

const renderPanel = (overrides = {}) =>
  render(
    <UsageStatsPanel
      stats={{ ...stats, ...overrides }}
      days={7}
      onDaysChange={() => {}}
      isZh={false}
    />,
  );

const labelled = text => screen.getByText(text).closest('.usage-kpi');

describe('UsageStatsPanel', () => {
  it('formats rates as percentages and latency in seconds', () => {
    renderPanel();
    expect(within(labelled('Error rate')).getByText('2.9%')).toBeTruthy();
    expect(within(labelled('Approval rate')).getByText('85.1%')).toBeTruthy();
    expect(within(labelled('Median latency')).getByText('2.5s')).toBeTruthy();
  });

  it('orders a breakdown by size so the dominant path reads first', () => {
    renderPanel();
    const rows = document.querySelectorAll('.usage-breakdown');
    const routeLabels = [...rows[0].querySelectorAll('.usage-bar-label')].map(el => el.textContent);
    expect(routeLabels).toEqual(['supervisor', 'slash_command']);
    const agentLabels = [...rows[1].querySelectorAll('.usage-bar-label')].map(el => el.textContent);
    expect(agentLabels).toEqual(['mail_agent', 'calendar_agent', 'none']);
  });

  it('scales bars against the largest value, not the total', () => {
    renderPanel();
    const fills = document.querySelectorAll('.usage-breakdown .usage-bar-fill');
    expect(fills[0].style.width).toBe('100%');
    expect(fills[1].style.width).toBe(`${(55 / 255) * 100}%`);
  });

  it('sums approval outcomes per tool', () => {
    renderPanel();
    const toolRows = [...document.querySelectorAll('.usage-breakdown')].at(-1);
    const values = [...toolRows.querySelectorAll('.usage-bar-value')].map(el => el.textContent);
    expect(values).toEqual(['32', '15']);
  });

  it('says so when Supabase cannot supply registration counts', () => {
    renderPanel({ users: { ...stats.users, registered: null } });
    expect(within(labelled('Registered')).getByText('N/A')).toBeTruthy();
    expect(screen.getByText(/Registration counts unavailable/i)).toBeTruthy();
    // Local activity still renders - one dead dependency must not blank the panel.
    expect(within(labelled('DAU')).getByText('8')).toBeTruthy();
  });

  it('shows an empty state rather than a bare axis before any traffic', () => {
    renderPanel({
      agent: { ...stats.agent, turns: 0, by_route: {}, by_agent: {}, error_rate: 0, median_duration_ms: null },
      hitl: { by_status: {}, by_tool: {}, approval_rate: null },
    });
    expect(screen.getAllByText('No data yet').length).toBe(3);
    expect(within(labelled('Median latency')).getByText('N/A')).toBeTruthy();
    expect(within(labelled('Approval rate')).getByText('N/A')).toBeTruthy();
  });
});

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import UsageStatsPanel from '../components/UsageStatsPanel';

describe('UsageStatsPanel', () => {
  it('shows only the total registered user count', () => {
    render(
      <UsageStatsPanel
        stats={{ users: { registered: { total: 12480, truncated: false } } }}
        isZh={false}
      />,
    );

    expect(screen.getByLabelText('Total registered users')).toHaveTextContent('12,480');
    expect(screen.getByText('Source: Supabase Auth')).toBeTruthy();
    expect(screen.queryByText('DAU')).toBeNull();
    expect(screen.queryByText('Agent usage')).toBeNull();
  });

  it('shows all-time calls for every known agent and any future agent keys', () => {
    render(
      <UsageStatsPanel
        stats={{
          users: { registered: { total: 42 } },
          agents: { by_agent: { supervisor: 12, calendar_agent: 27, custom_agent: 3 } },
        }}
        isZh={false}
      />,
    );

    expect(screen.getByText('Supervisor').closest('.agent-call-row')).toHaveTextContent('12');
    expect(screen.getByText('Calendar').closest('.agent-call-row')).toHaveTextContent('27');
    expect(screen.getByText('Mail').closest('.agent-call-row')).toHaveTextContent('0');
    expect(screen.getByText('custom_agent').closest('.agent-call-row')).toHaveTextContent('3');
  });

  it('shows a clear unavailable state when Supabase cannot supply the total', () => {
    render(<UsageStatsPanel stats={{ users: { registered: null } }} isZh />);

    expect(screen.getByLabelText('注册用户总数')).toHaveTextContent('N/A');
    expect(screen.getByText('暂时无法获取用户总数')).toBeTruthy();
  });
});

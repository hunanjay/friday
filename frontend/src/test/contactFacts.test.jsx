import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FactGroup, SourceBadge } from '../pages/ContactsPage';
import { factDimensionOrder } from '../pages/contactDimensions';

const ORIGIN = {
  'i-1': { id: 'i-1', event_date: '2026-08-01T10:00:00Z', summary: '微信聊天记录提炼' },
};

describe('SourceBadge', () => {
  it('labels a known source in the active language', () => {
    const { rerender } = render(<SourceBadge sourceType="chat_paste" origin={null} isZh />);
    expect(screen.getByText('聊天记录提炼')).toBeTruthy();

    rerender(<SourceBadge sourceType="chat_paste" origin={null} isZh={false} />);
    expect(screen.getByText('Chat log')).toBeTruthy();
  });

  it('falls back to the raw source_type rather than hiding an unknown source', () => {
    render(<SourceBadge sourceType="crm_import" origin={null} isZh={false} />);
    expect(screen.getByText('crm_import')).toBeTruthy();
  });

  it('names the linked record when source_id resolves to an interaction', () => {
    render(<SourceBadge sourceType="chat_paste" origin={ORIGIN['i-1']} isZh />);
    expect(screen.getByText('聊天记录提炼').title).toContain('微信聊天记录提炼');
  });

  it('says so when a fact has no linked source record', () => {
    render(<SourceBadge sourceType="manual" origin={undefined} isZh={false} />);
    expect(screen.getByText('Manual').title).toBe('No linked source record');
  });
});

describe('FactGroup', () => {
  const facts = [
    { id: 'f-1', fact_key: 'tea_preference', fact_value: '喜欢普洱茶', source_type: 'chat_paste', source_id: 'i-1' },
    { id: 'f-2', fact_key: 'hometown', fact_value: '杭州', source_type: 'manual', source_id: '' },
  ];

  const renderGroup = (props = {}) =>
    render(
      <FactGroup
        title="Basic Facts"
        icon={null}
        color="#000"
        facts={facts}
        emptyText="No facts recorded"
        originsById={ORIGIN}
        isZh={false}
        onDelete={vi.fn()}
        {...props}
      />,
    );

  it('shows every fact with its own provenance badge', () => {
    renderGroup();
    expect(screen.getByText('喜欢普洱茶')).toBeTruthy();
    expect(screen.getByText('Chat log')).toBeTruthy();
    expect(screen.getByText('Manual')).toBeTruthy();
  });

  it('renders the empty text instead of an empty panel', () => {
    renderGroup({ facts: [] });
    expect(screen.getByText('No facts recorded')).toBeTruthy();
  });

  it('tolerates a missing facts array', () => {
    renderGroup({ facts: undefined });
    expect(screen.getByText('No facts recorded')).toBeTruthy();
  });

  it('deletes the fact that was clicked', () => {
    const onDelete = vi.fn();
    renderGroup({ onDelete });
    fireEvent.click(screen.getAllByRole('button')[1]);
    expect(onDelete).toHaveBeenCalledWith('f-2');
  });
});

describe('factDimensionOrder', () => {
  it('keeps the built-in dimensions in a fixed order even when empty', () => {
    expect(factDimensionOrder({})).toEqual(['basic', 'business', 'private', 'dynamic']);
  });

  it('renders a dimension the agent coined rather than dropping its facts', () => {
    const order = factDimensionOrder({ hobby: [{ id: 1 }], business: [{ id: 2 }] });
    expect(order).toContain('hobby');
    expect(order.indexOf('hobby')).toBeGreaterThan(order.indexOf('dynamic'));
  });

  it('lists coined dimensions in a stable order and never twice', () => {
    const order = factDimensionOrder({ zeta: [], hobby: [], basic: [] });
    expect(order).toEqual(['basic', 'business', 'private', 'dynamic', 'hobby', 'zeta']);
  });
});

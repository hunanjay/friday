import React from 'react';
import { Bot24Regular, PeopleCommunity24Regular } from '@fluentui/react-icons';

const AGENTS = [
  ['supervisor', 'Supervisor', 'Supervisor'],
  ['mail_agent', '邮件', 'Mail'],
  ['calendar_agent', '日历', 'Calendar'],
  ['contact_agent', '联系人', 'Contacts'],
  ['memos_agent', '备忘录', 'Memos'],
  ['github_agent', 'GitHub', 'GitHub'],
];

const formatUserCount = (value, isZh) => (
  typeof value === 'number'
    ? new Intl.NumberFormat(isZh ? 'zh-CN' : 'en-US').format(value)
    : 'N/A'
);

export default function UsageStatsPanel({ stats, isZh }) {
  const registered = stats?.users?.registered;
  const agentCounts = stats?.agents?.by_agent;
  const knownAgentKeys = new Set(AGENTS.map(([key]) => key));
  const agentRows = agentCounts
    ? [
        ...AGENTS,
        ...Object.keys(agentCounts)
          .filter(key => !knownAgentKeys.has(key))
          .map(key => [key, key, key]),
      ]
    : [];

  return (
    <div className="usage-overview-stack">
      <div className="user-volume-card">
        <div className="user-volume-card-header">
          <span className="user-volume-icon" aria-hidden="true">
            <PeopleCommunity24Regular />
          </span>
          <div>
            <h3>{isZh ? '注册用户总数' : 'Total registered users'}</h3>
            <p>
              {isZh
                ? '已在此工作区完成注册的账户数量'
                : 'Accounts that have registered for this workspace'}
            </p>
          </div>
        </div>

        <div className="user-volume-value" aria-label={isZh ? '注册用户总数' : 'Total registered users'}>
          {formatUserCount(registered?.total, isZh)}
        </div>

        <div className="user-volume-card-footer">
          {registered
            ? (isZh ? '数据来源：Supabase Auth' : 'Source: Supabase Auth')
            : (isZh ? '暂时无法获取用户总数' : 'User count is currently unavailable')}
        </div>
      </div>

      <section className="agent-call-card" aria-labelledby="agent-call-title">
        <div className="agent-call-header">
          <span className="agent-call-icon" aria-hidden="true"><Bot24Regular /></span>
          <div>
            <h3 id="agent-call-title">{isZh ? 'Agent 累计调用' : 'Agent calls'}</h3>
            <p>
              {isZh
                ? '每次 Agent 被委派处理任务记为一次调用'
                : 'Each task delegated to an agent counts as one call'}
            </p>
          </div>
        </div>

        {agentCounts ? (
          <div className={`agent-call-list ${agentRows.length % 2 ? 'has-odd-count' : ''}`}>
            {agentRows.map(([key, zhLabel, enLabel]) => (
              <div className="agent-call-row" key={key}>
                <span className="agent-call-name">{isZh ? zhLabel : enLabel}</span>
                <strong className="agent-call-value">{formatUserCount(agentCounts[key] || 0, isZh)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <div className="agent-call-unavailable">
            {isZh ? '暂时无法获取 Agent 调用次数' : 'Agent call counts are currently unavailable'}
          </div>
        )}
      </section>
    </div>
  );
}

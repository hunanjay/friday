import React from 'react';

// Numbers only - no charts. These are current values, not trends, so stat
// tiles read faster than any plot would (and the backend keeps no history
// per day). The two breakdowns get bars because comparing magnitude across a
// handful of categories is exactly what a bar is for; one accent hue for all
// of them, since the bars carry magnitude, not identity.

function Kpi({ label, value }) {
  return (
    <div className="usage-kpi">
      <div className="usage-kpi-value">{value}</div>
      <div className="usage-kpi-label">{label}</div>
    </div>
  );
}

function BarList({ title, entries, empty }) {
  const max = Math.max(...entries.map(([, count]) => count), 1);
  return (
    <div className="usage-breakdown">
      <div className="usage-breakdown-title">{title}</div>
      {entries.length === 0 ? (
        <div className="usage-empty">{empty}</div>
      ) : (
        <div className="usage-bars">
          {entries.map(([label, count]) => (
            <div className="usage-bar-row" key={label}>
              <div className="usage-bar-label" title={label}>{label}</div>
              <div className="usage-bar-track">
                <div className="usage-bar-fill" style={{ width: `${(count / max) * 100}%` }} />
              </div>
              <div className="usage-bar-value">{count}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const percent = value => (value == null ? 'N/A' : `${(value * 100).toFixed(1)}%`);

const duration = ms => {
  if (ms == null) return 'N/A';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
};

// Biggest first: a breakdown is read for "what dominates", not alphabetically.
const ranked = counts => Object.entries(counts || {}).sort((a, b) => b[1] - a[1]);

export default function UsageStatsPanel({ stats, days, onDaysChange, isZh }) {
  const { users, agent, hitl } = stats;
  const registered = users.registered;

  return (
    <>
      <div className="usage-toolbar">
        <div className="settings-field-hint">
          {isZh
            ? '所有用户的汇总数据。日活/周活/月活固定为 1/7/30 天，不受下方窗口影响。'
            : 'Aggregated across all users. DAU/WAU/MAU keep their 1/7/30-day windows regardless of the range below.'}
        </div>
        <div className="settings-segmented">
          {[7, 30].map(option => (
            <button
              key={option}
              type="button"
              className={days === option ? 'on' : ''}
              onClick={() => onDaysChange(option)}
            >
              {isZh ? `${option} 天` : `${option}d`}
            </button>
          ))}
        </div>
      </div>

      <div className="usage-group-title">{isZh ? '用户' : 'Users'}</div>
      <div className="usage-kpis">
        <Kpi label={isZh ? '注册用户' : 'Registered'} value={registered ? registered.total : 'N/A'} />
        <Kpi
          label={isZh ? `${days} 天新增` : `New in ${days}d`}
          value={registered ? registered.new_in_window : 'N/A'}
        />
        <Kpi label={isZh ? '日活' : 'DAU'} value={users.dau} />
        <Kpi label={isZh ? '周活' : 'WAU'} value={users.wau} />
        <Kpi label={isZh ? '月活' : 'MAU'} value={users.mau} />
        <Kpi label={isZh ? '周活 / 月活' : 'WAU / MAU'} value={users.wau_over_mau} />
      </div>
      {!registered && (
        <div className="usage-note">
          {isZh
            ? '注册数暂不可用：Supabase 管理接口没有响应。'
            : 'Registration counts unavailable: the Supabase admin API did not respond.'}
        </div>
      )}

      <div className="usage-group-title">{isZh ? '智能体调用' : 'Agent usage'}</div>
      <div className="usage-kpis">
        <Kpi label={isZh ? '对话轮次' : 'Turns'} value={agent.turns} />
        <Kpi label={isZh ? '活跃用户' : 'Active users'} value={agent.active_users} />
        <Kpi label={isZh ? '人均轮次' : 'Turns / user'} value={agent.turns_per_user} />
        <Kpi label={isZh ? '工具调用' : 'Tool calls'} value={agent.tool_calls} />
        <Kpi label={isZh ? '出错率' : 'Error rate'} value={percent(agent.error_rate)} />
        <Kpi label={isZh ? '耗时中位数' : 'Median latency'} value={duration(agent.median_duration_ms)} />
      </div>

      <div className="usage-breakdowns">
        <BarList
          title={isZh ? '入口分布' : 'By entry path'}
          entries={ranked(agent.by_route)}
          empty={isZh ? '暂无数据' : 'No data yet'}
        />
        <BarList
          title={isZh ? '智能体分布' : 'By agent'}
          entries={ranked(agent.by_agent)}
          empty={isZh ? '暂无数据' : 'No data yet'}
        />
      </div>

      <div className="usage-group-title">{isZh ? '审批' : 'Approvals'}</div>
      <div className="usage-kpis">
        <Kpi label={isZh ? '通过率' : 'Approval rate'} value={percent(hitl.approval_rate)} />
        <Kpi label={isZh ? '已通过' : 'Approved'} value={hitl.by_status.succeeded || 0} />
        <Kpi label={isZh ? '已取消' : 'Cancelled'} value={hitl.by_status.cancelled || 0} />
        <Kpi label={isZh ? '待处理' : 'Pending'} value={hitl.by_status.pending || 0} />
      </div>
      <BarList
        title={isZh ? '按工具' : 'By tool'}
        entries={ranked(
          Object.fromEntries(
            Object.entries(hitl.by_tool).map(([tool, statuses]) => [
              tool,
              Object.values(statuses).reduce((sum, count) => sum + count, 0),
            ]),
          ),
        )}
        empty={isZh ? '暂无数据' : 'No data yet'}
      />
    </>
  );
}

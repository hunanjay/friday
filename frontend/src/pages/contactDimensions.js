import {
  Heart,
  Briefcase as BusinessIcon,
  UserIcon,
  Zap,
} from '../components/common/Icons';

// How each memory dimension is presented. The agent can coin new dimensions, so
// this is a lookup with a fallback, not the list of what can exist - anything
// missing here still renders, labelled by its raw name.
export const DIMENSION_META = {
  basic: { zh: '基础信息 (Basic)', en: 'Basic Facts', emptyZh: '暂无基础事实', icon: UserIcon, color: '#0891b2' },
  business: { zh: '商务事实 (Business)', en: 'Business Facts', emptyZh: '暂无商务事实', icon: BusinessIcon, color: '#2563eb' },
  private: { zh: '私人喜好 (Private)', en: 'Private Preferences', emptyZh: '暂无私人喜好', icon: Heart, color: '#ec4899' },
  dynamic: { zh: '动态与约定 (Dynamic)', en: 'Dynamic Status', emptyZh: '暂无动态约定', icon: Zap, color: '#8b5cf6' },
};
// Always shown, even when empty, so the built-in buckets stay discoverable.
const DIMENSION_ORDER = ['basic', 'business', 'private', 'dynamic'];

// Built-in dimensions in a fixed order, then any the agent coined, sorted. A
// dimension with no panel used to drop its facts from the UI silently.
export function factDimensionOrder(profilesByDimension) {
  const extra = Object.keys(profilesByDimension || {})
    .filter((d) => !DIMENSION_ORDER.includes(d))
    .sort();
  return [...DIMENSION_ORDER, ...extra];
}

import { Tab, TabList, type SelectTabData } from '@fluentui/react-components';
import { ChartMultipleRegular, HomeRegular, PeopleRegular, WalletRegular, MailRegular } from '@fluentui/react-icons';
import type { UserPermissions } from '../api/types';

const routes = [
  { value: '/', label: 'Home', icon: <HomeRegular />, permission: 'dashboard' as const },
  { value: '/plans', label: 'Products', icon: <ChartMultipleRegular />, permission: 'products' as const },
  { value: '/team', label: 'My Team', icon: <PeopleRegular />, permission: 'myTeam' as const },
  { value: '/wallet', label: 'My Wallet', icon: <WalletRegular />, permission: 'wallet' as const },
  { value: '/messages', label: 'Messages', icon: <MailRegular />, permission: 'messages' as const },
  { value: '/support', label: 'Support', icon: <PeopleRegular />, permission: 'support' as const },
];

export function BottomNavigation({ path, permissions }: { path: string; permissions: UserPermissions }) {
  const visibleRoutes = routes.filter((route) => permissions[route.permission]);
  const selectedValue = visibleRoutes.some((route) => route.value === path) ? path : '';
  return <TabList className="app-nav" selectedValue={selectedValue} onTabSelect={(_: unknown, data: SelectTabData) => { window.history.pushState({}, '', data.value as string); window.dispatchEvent(new PopStateEvent('popstate')); }}>
    {visibleRoutes.map((route) => <Tab key={route.value} value={route.value} icon={route.icon}>{route.label}</Tab>)}
  </TabList>;
}

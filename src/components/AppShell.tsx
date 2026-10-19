import { Avatar, MessageBar, MessageBarBody, Toolbar, ToolbarButton } from '@fluentui/react-components';
import { SettingsRegular, SignOutRegular, Speaker2Regular, SpeakerMuteRegular, WeatherMoonRegular, WeatherSunnyRegular } from '@fluentui/react-icons';
import type { ReactNode } from 'react';
import { BottomNavigation } from './BottomNavigation';
import type { AccountStatus, UserPermissions } from '../api/types';

interface AppShellProps { path: string; dark: boolean; isAdmin?: boolean; permissions: UserPermissions; accountStatus: AccountStatus; notificationSoundEnabled?: boolean; onToggleNotificationSound?: () => void | Promise<void>; onToggleTheme: () => void; onLogout: () => void; userName: string; children: ReactNode; }

export function AppShell({ path, dark, isAdmin = false, permissions, accountStatus, notificationSoundEnabled = false, onToggleNotificationSound, onToggleTheme, onLogout, userName, children }: AppShellProps) {
  const notificationActionLabel = notificationSoundEnabled
    ? typeof Notification !== 'undefined' && Notification.permission === 'granted'
      ? 'Mute notification sounds and alerts'
      : typeof Notification !== 'undefined' && Notification.permission === 'denied'
        ? 'Notifications are blocked in browser settings'
        : 'Allow background notifications'
    : 'Enable notification sounds and alerts';
  return <div className={path === '/' ? 'app-root app-root--home' : 'app-root'}>
    <header className="app-header">
      <Toolbar className="app-header__toolbar">
        <div className="app-header__actions">
          <ToolbarButton aria-label={dark ? 'Use light theme' : 'Use dark theme'} icon={dark ? <WeatherSunnyRegular /> : <WeatherMoonRegular />} onClick={onToggleTheme} />
          {onToggleNotificationSound && <ToolbarButton aria-label={notificationActionLabel} title={notificationActionLabel} icon={notificationSoundEnabled ? <Speaker2Regular /> : <SpeakerMuteRegular />} onClick={() => { void onToggleNotificationSound(); }} />}
          {isAdmin && <ToolbarButton aria-label="Open Admin Console" title="Admin Console" icon={<SettingsRegular />} onClick={() => { window.history.pushState({}, '', '/admin'); window.dispatchEvent(new PopStateEvent('popstate')); }} />}
          <button className="app-profile-button" type="button" aria-label="Open My Account" title="My Account" onClick={() => { window.history.pushState({}, '', '/me'); window.dispatchEvent(new PopStateEvent('popstate')); }}><Avatar name={userName} color="brand" /></button>
          <ToolbarButton aria-label="Log out" icon={<SignOutRegular />} onClick={onLogout} />
        </div>
      </Toolbar>
      <BottomNavigation path={path} permissions={permissions} />
    </header>
    <main className="app-main">{accountStatus !== 'ACTIVE' && <MessageBar intent="warning"><MessageBarBody>{accountStatus === 'FROZEN' ? 'Your account is frozen. Contact support to restore access.' : accountStatus === 'SUSPENDED' ? 'Your account is suspended. Contact support if you need help.' : 'Some account features are restricted by an administrator.'}</MessageBarBody></MessageBar>}{children}</main>
  </div>;
}

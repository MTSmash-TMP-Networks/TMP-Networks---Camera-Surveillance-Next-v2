import {
  Activity,
  BellRing,
  Clapperboard,
  Laptop,
  Grid2X2,
  ListTree,
  MonitorPlay,
  Plus,
  Radio,
  RefreshCw,
  Users,
} from 'lucide-react';

export const NAVIGATION_SECTIONS = Object.freeze([
  {
    id: 'monitoring',
    labelKey: 'nav.group.monitoring',
    items: [
      { to: '/', labelKey: 'nav.overview', icon: Grid2X2, end: true },
      { to: '/live', labelKey: 'nav.live', icon: Radio },
      { to: '/kiosk', labelKey: 'nav.kiosk', icon: MonitorPlay },
      { to: '/recordings', labelKey: 'nav.recordings', icon: Clapperboard },
      { to: '/desktop-client', labelKey: 'nav.desktopClient', icon: Laptop },
    ],
  },
  {
    id: 'administration',
    labelKey: 'nav.group.administration',
    adminOnly: true,
    items: [
      { to: '/cameras/add', labelKey: 'nav.addCamera', icon: Plus },
      { to: '/users', labelKey: 'nav.users', icon: Users },
      { to: '/events', labelKey: 'nav.events', icon: ListTree },
      { to: '/system/status', labelKey: 'nav.systemStatus', icon: Activity },
      { to: '/system/notifications', labelKey: 'nav.notifications', icon: BellRing },
      { to: '/system/update', labelKey: 'nav.updates', icon: RefreshCw },
    ],
  },
]);

function navigationItemMatches(item, pathname) {
  const path = String(pathname || '/');
  if (item.end) return path === item.to;
  if (item.to === '/cameras/add' && path.startsWith('/cameras/')) return true;
  return path === item.to || path.startsWith(`${item.to}/`);
}

export function activeNavigationSection(pathname, role) {
  const sections = NAVIGATION_SECTIONS.filter((section) => !section.adminOnly || role === 'admin');
  return sections.find((section) => section.items.some((item) => navigationItemMatches(item, pathname))) || sections[0];
}

export function activeNavigationItem(pathname, role) {
  const section = activeNavigationSection(pathname, role);
  return section?.items.find((item) => navigationItemMatches(item, pathname)) || section?.items[0] || null;
}

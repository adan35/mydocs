import { FileText, FolderOpen, Home, MoreHorizontal, Search } from 'lucide-react';
import { useRouter, navigate } from '@/app/router';
import { useEditor } from '@/app/editor-store';
import { useUi } from '@/app/ui-store';
import { openMenuAt } from '../components/Menu';
import * as A from '@/app/actions';
import {
  Clock,
  Star,
  Hash,
  Trash2,
  Settings,
  FilePlus2,
  FolderPlus,
  Upload,
  Moon,
  Sun,
  Command,
  CalendarDays,
  Palette,
} from 'lucide-react';
import { useResolvedTheme } from '../hooks';
import { toggleTheme } from '../components/ThemeToggle';
import { themeMenuItems } from '../components/ThemePicker';
import { importSubmenu } from '../entry-menu';

/** Phone navigation: Documents, Search, the open document, and More. */
export function MobileNav() {
  const route = useRouter((s) => s.route);
  const activeId = useEditor((s) => s.activeId);
  const theme = useResolvedTheme();
  const items = [
    {
      label: 'Home',
      icon: <Home size={20} />,
      active: route.name === 'home',
      onClick: () => navigate({ name: 'home' }),
    },
    {
      label: 'Files',
      icon: <FolderOpen size={20} />,
      active: route.name === 'folder',
      onClick: () => navigate({ name: 'folder', id: null }),
    },
    {
      label: 'Search',
      icon: <Search size={20} />,
      active: route.name === 'search',
      onClick: () => navigate({ name: 'search', q: '' }),
    },
    ...(activeId
      ? [
          {
            label: 'Editor',
            icon: <FileText size={20} />,
            active: route.name === 'doc',
            onClick: () => void A.openEntry(activeId),
          },
        ]
      : []),
  ];
  return (
    <nav
      aria-label="Main"
      className="safe-bottom flex shrink-0 border-t border-hairline bg-canvas no-print"
    >
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          aria-current={it.active ? 'page' : undefined}
          className={`flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${it.active ? 'text-ink' : 'text-steel'}`}
          onClick={it.onClick}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
      <button
        type="button"
        className="flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-steel"
        onClick={(e) =>
          openMenuAt(
            e.currentTarget,
            [
              { label: 'New file…', icon: <FilePlus2 />, onSelect: () => void A.newFile() },
              { label: 'New document', icon: <FilePlus2 />, onSelect: () => void A.newDocument() },
              { label: 'New folder', icon: <FolderPlus />, onSelect: () => void A.newFolder() },
              { label: 'Import', icon: <Upload />, submenu: importSubmenu(null) },
              {
                label: "Today's note",
                icon: <CalendarDays />,
                onSelect: () => void A.openDailyNote(),
              },
              'separator',
              {
                label: 'All commands…',
                icon: <Command />,
                onSelect: () => useUi.getState().setOverlay('palette'),
              },
              { label: 'Recent', icon: <Clock />, onSelect: () => navigate({ name: 'recent' }) },
              {
                label: 'Favorites',
                icon: <Star />,
                onSelect: () => navigate({ name: 'favorites' }),
              },
              { label: 'Tags', icon: <Hash />, onSelect: () => navigate({ name: 'tags' }) },
              { label: 'Trash', icon: <Trash2 />, onSelect: () => navigate({ name: 'trash' }) },
              'separator',
              {
                label: theme === 'dark' ? 'Light theme' : 'Dark theme',
                icon: theme === 'dark' ? <Sun /> : <Moon />,
                onSelect: () => toggleTheme(theme),
              },
              { label: 'Theme', icon: <Palette />, submenu: themeMenuItems() },
              {
                label: 'Settings',
                icon: <Settings />,
                onSelect: () => navigate({ name: 'settings' }),
              },
              {
                label: 'Switch workspace…',
                icon: <Home />,
                onSelect: () => useUi.getState().setDrawer(true),
              },
            ],
            'More',
          )
        }
      >
        <MoreHorizontal size={20} />
        More
      </button>
    </nav>
  );
}

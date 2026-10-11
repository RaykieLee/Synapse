import { Bell, Building2, Monitor, Palette, Settings, UserCog, Users, Wrench } from 'lucide-react'
import { type SidebarData } from '../types'

/** Static navigation contains only Synapse product routes. Workspace business
 * routes are loaded separately after the current workspace has been verified.
 */
export const sidebarData: SidebarData = {
  user: { name: '', email: '', avatar: '' },
  teams: [],
  navGroups: [
    {
      title: '平台管理',
      items: [
        { title: '租户管理', url: '/tenants', icon: Building2 },
        { title: '全局用户', url: '/users', icon: Users },
      ],
    },
    {
      title: '个人设置',
      items: [
        {
          title: '设置',
          icon: Settings,
          items: [
            { title: '个人资料', url: '/settings', icon: UserCog },
            { title: '账号', url: '/settings/account', icon: Wrench },
            { title: '外观', url: '/settings/appearance', icon: Palette },
            { title: '通知', url: '/settings/notifications', icon: Bell },
            { title: '显示', url: '/settings/display', icon: Monitor },
          ],
        },
      ],
    },
  ],
}
